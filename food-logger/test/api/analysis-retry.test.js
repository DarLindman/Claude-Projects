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
let infoLog;
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
  infoLog = mock.method(console, 'info', () => {}); // the usage lines
  ctx.anthropic.messages.create = original;
  ctx.anthropic.calls.length = 0;
  ctx.anthropic.usage = undefined;
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
const allLogs = () => JSON.stringify([...errorLog.mock.calls, ...warnLog.mock.calls, ...infoLog.mock.calls].map((c) => c.arguments.map(String)));
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

  test(`${name}: a refusal is not retried (1 call) and is the 502`, async () => {
    script([{ text: `I cannot help with that ${MARKER}`, stopReason: 'refusal' }, good]);
    const res = await call();
    assert.equal(res.status, 502);
    assert.deepEqual(res.body, { error: { code: 'AI_UNAVAILABLE' } });
    assert.equal(ctx.anthropic.calls.length, 1);
    assert.ok(![...lines(warnLog), ...lines(errorLog)].some((l) => /retrying/.test(l)));
    assert.ok(!allLogs().includes(MARKER));
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

// ─── items must be objects (image) ───────────────────────────────────────────
for (const [label, items] of [['null', [null]], ['a number', [1]], ['a string', ['x']]]) {
  const badItems = JSON.stringify({ visual_description: MARKER, draft_name: 'עוף', dish_name: 'עוף עם אורז', items });
  test(`image: items [${label}] then a valid reply is a 200 with 2 calls`, async () => {
    script([badItems, goodImage]);
    const res = await analyze();
    assert.equal(res.status, 200, res.text);
    assert.deepEqual(res.body, { foodName: 'עוף עם אורז', ...IMAGE_TOTALS });
    assert.equal(ctx.anthropic.calls.length, 2);
  });
  test(`image: items [${label}] twice is the 502 after 2 calls, not a 500`, async () => {
    script([badItems, badItems]);
    const res = await analyze();
    assert.equal(res.status, 502);
    assert.deepEqual(res.body, { error: { code: 'AI_UNAVAILABLE' } });
    assert.equal(ctx.anthropic.calls.length, 2);
    assert.ok(!allLogs().includes(MARKER));
  });
}

// ─── the numbers-only usage line ─────────────────────────────────────────────
const usageLines = () => lines(infoLog).filter((l) => / model=/.test(l));

test('image: one usage line per call with the usage numbers, the model and stop_reason, no reply text', async () => {
  ctx.anthropic.usage = { input_tokens: 1234, output_tokens: 567 };
  ctx.anthropic.imageReply = goodImage.replace('grilled chicken', MARKER);
  const res = await analyze();
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { foodName: 'עוף עם אורז', ...IMAGE_TOTALS });
  const u = usageLines();
  assert.equal(u.length, 1);
  assert.match(u[0], /^\[analyze\] image model=claude-sonnet-5-5 in=1234 out=567 ms=\d+ stop=end_turn$/);
  assert.ok(!allLogs().includes(MARKER));
  ctx.anthropic.imageReply = undefined;
});

test('text: the usage line names the text model; a missing usage prints ?', async () => {
  const res = await analyzeText();
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { foodName: 'סלט ולחם', ...TEXT_TOTALS });
  const u = usageLines();
  assert.equal(u.length, 1);
  assert.match(u[0], /^\[analyze-text\] text model=claude-haiku-4-5-20251001 in=\? out=\? ms=\d+ stop=(end_turn|unknown)$/); // the fake's text reply has no stop_reason
});

test('a retried request logs a usage line per call; a rejected call logs stop=error', async () => {
  script([badImage, goodImage]);
  assert.equal((await analyze()).status, 200);
  assert.equal(usageLines().length, 2);
  infoLog.mock.resetCalls();
  script([new Error('boom')]);
  assert.equal((await analyze()).status, 502);
  const u = usageLines();
  assert.equal(u.length, 1);
  assert.match(u[0], /in=\? out=\? ms=\d+ stop=error$/);
  assert.ok(!u[0].includes('boom'));
});

test('the usage line leaves the request and the returned object unchanged', async () => {
  ctx.anthropic.usage = { input_tokens: 1, output_tokens: 2 };
  const res = await analyze();
  assert.deepEqual(Object.keys(ctx.anthropic.calls[0]), ['model', 'max_tokens', 'thinking', 'output_config', 'system', 'messages']);
  assert.deepEqual(Object.keys(res.body), ['foodName', 'calories', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g']);
});
