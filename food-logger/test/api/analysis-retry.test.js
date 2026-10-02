'use strict';

// An unparseable AI reply is retried once (both analysis paths); API errors and replies cut
// by max_tokens are not; a valid reply is one call. Fakes only, never the real API.
const { test, before, after, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const { buildTestApp, signedIn } = require('../helpers/app');
const { IMAGE_ITEMS, TEXT_ITEMS } = require('../helpers/fakeAnthropic');

const JPEG_BASE64 = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]).toString('base64');
const IMAGE_TOTALS = { calories: 450, protein_g: 34, carbs_g: 44, fat_g: 12.5, fiber_g: 1 };
const TEXT_TOTALS = { calories: 145, protein_g: 4, carbs_g: 22, fat_g: 5, fiber_g: 4 };
const MARKER = 'RETRY-REPLY-MARKER';

const goodImage = JSON.stringify({ visual_description: 'grilled chicken', draft_name: 'עוף', dish_name: 'עוף עם אורז', items: IMAGE_ITEMS });
const goodText = JSON.stringify(TEXT_ITEMS);
// a malformed reply that quotes the marker (so a leak into a log or a response is detectable)
const badImage = `{"visual_description":"${MARKER}", oops}`;
const badText = `[{"name": "${MARKER}" oops`;

let ctx;
let client;
let warnLog;
let errorLog;
let original;
before(async () => {
  ctx = await buildTestApp({ limits: { analyzePerHour: 1000 } });
  client = await signedIn(ctx.app, 'retryUser');
  original = ctx.anthropic.messages.create;
});
after(async () => { ctx.anthropic.messages.create = original; mock.restoreAll(); await ctx.pool.end(); });
beforeEach(() => {
  mock.restoreAll();
  warnLog = mock.method(console, 'warn', () => {});
  errorLog = mock.method(console, 'error', () => {});
  ctx.anthropic.messages.create = original;
  ctx.anthropic.calls.length = 0;
});

// The model answers with these steps in order: a string is the text of a reply (with an
// optional stop_reason), an Error is a rejected call. Calls past the list repeat the last step.
function script(steps) {
  let n = 0;
  ctx.anthropic.messages.create = async (args) => {
    ctx.anthropic.calls.push(args);
    const step = steps[Math.min(n++, steps.length - 1)];
    if (step instanceof Error) throw step;
    return { content: [{ type: 'text', text: step.text ?? step }], stop_reason: step.stopReason ?? 'end_turn' };
  };
}

const analyze = () => client.post('/api/analyze', { imageBase64: JPEG_BASE64 });
const analyzeText = () => client.post('/api/analyze-text', { text: 'סלט ולחם' });
const allLogs = () => JSON.stringify([...errorLog.mock.calls, ...warnLog.mock.calls].map((c) => c.arguments.map(String)));
const lines = (log) => log.mock.calls.map((c) => c.arguments.map(String).join(' '));

const PATHS = [
  ['image', analyze, goodImage, badImage, IMAGE_TOTALS, 'עוף עם אורז'],
  ['text', analyzeText, goodText, badText, TEXT_TOTALS, 'סלט ולחם'],
];

for (const [name, call, good, bad, totals, foodName] of PATHS) {
  test(`${name}: an unparseable reply then a valid one is a 200 with the valid result and exactly 2 model calls`, async () => {
    script([bad, good]);
    const res = await call();
    assert.equal(res.status, 200, res.text);
    assert.deepEqual(res.body, { foodName, ...totals });
    assert.equal(ctx.anthropic.calls.length, 2);
    // both attempts are the same request
    assert.equal(JSON.stringify(ctx.anthropic.calls[0]), JSON.stringify(ctx.anthropic.calls[1]));
  });

  test(`${name}: the retry logs one short line without any reply text`, async () => {
    script([bad, good]);
    assert.equal((await call()).status, 200);
    const retry = [...lines(errorLog), ...lines(warnLog)].filter((l) => /retrying once/.test(l));
    assert.equal(retry.length, 1);
    assert.ok(retry[0].length < 120, retry[0]);
    assert.ok(!allLogs().includes(MARKER));
  });

  test(`${name}: two unparseable replies are a 502 AI_UNAVAILABLE after exactly 2 calls, with no reply text in the response or the logs`, async () => {
    script([bad, bad]);
    const res = await call();
    assert.equal(res.status, 502);
    assert.deepEqual(res.body, { error: { code: 'AI_UNAVAILABLE' } });
    assert.equal(ctx.anthropic.calls.length, 2);
    assert.ok(!res.text.includes(MARKER));
    assert.ok(!allLogs().includes(MARKER));
  });

  test(`${name}: a reply with no text block is retried too, and a text with no JSON`, async () => {
    ctx.anthropic.messages.create = async (args) => {
      ctx.anthropic.calls.push(args);
      return ctx.anthropic.calls.length === 1 ? { content: [{ type: 'thinking', thinking: MARKER }], stop_reason: 'end_turn' }
        : ctx.anthropic.calls.length === 2 ? { content: [{ type: 'text', text: `no json ${MARKER}` }], stop_reason: 'end_turn' }
          : { content: [{ type: 'text', text: good }], stop_reason: 'end_turn' };
    };
    // 1st: no text block (retry), 2nd: no JSON (second failure): 502 after 2 calls
    const res = await call();
    assert.equal(res.status, 502);
    assert.equal(ctx.anthropic.calls.length, 2);
    assert.ok(!allLogs().includes(MARKER));
  });

  test(`${name}: an API error is not retried (1 call) and is the 502`, async () => {
    script([new Error(`${MARKER} 529 overloaded_error`), good]);
    const res = await call();
    assert.equal(res.status, 502);
    assert.deepEqual(res.body, { error: { code: 'AI_UNAVAILABLE' } });
    assert.equal(ctx.anthropic.calls.length, 1);
    assert.ok(!res.text.includes(MARKER));
    assert.ok(!lines(warnLog).some((l) => /retrying/.test(l)));
  });

  test(`${name}: a reply cut by max_tokens is not retried (1 call) and is the 502`, async () => {
    script([{ text: bad, stopReason: 'max_tokens' }, good]);
    const res = await call();
    assert.equal(res.status, 502);
    assert.deepEqual(res.body, { error: { code: 'AI_UNAVAILABLE' } });
    assert.equal(ctx.anthropic.calls.length, 1);
    assert.ok(![...lines(warnLog), ...lines(errorLog)].some((l) => /retrying/.test(l)));
  });

  test(`${name}: a valid first reply is exactly 1 call and logs no retry`, async () => {
    script([good, bad]);
    const res = await call();
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { foodName, ...totals });
    assert.equal(ctx.anthropic.calls.length, 1);
    assert.ok(![...lines(warnLog), ...lines(errorLog)].some((l) => /retrying/.test(l)));
  });
}

test('image: a valid reply on the retry still goes through the name guard (repair call is not part of the retry)', async () => {
  // dish_name in a foreign script triggers the repair call after the successful retry
  const foreign = JSON.stringify({ visual_description: 'x', draft_name: 'עוף', dish_name: 'chicken rice', items: IMAGE_ITEMS });
  let creates = 0;
  ctx.anthropic.messages.create = async (args) => {
    ctx.anthropic.calls.push(args);
    creates++;
    const isRepair = typeof args.system === 'string' && args.system !== ctx.anthropic.calls[0].system;
    if (isRepair) return { content: [{ type: 'text', text: 'עוף עם אורז' }], stop_reason: 'end_turn' };
    return { content: [{ type: 'text', text: creates === 1 ? badImage : foreign }], stop_reason: 'end_turn' };
  };
  const res = await analyze();
  assert.equal(res.status, 200);
  assert.equal(res.body.foodName, 'עוף עם אורז');
  assert.equal(ctx.anthropic.calls.length, 3); // bad, valid (retry), repair
});
