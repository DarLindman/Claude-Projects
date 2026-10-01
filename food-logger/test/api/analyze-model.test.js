'use strict';

// Image analysis on the configured model (IMAGE_MODEL, default Sonnet), the temperature
// rule (sent only to Haiku) and the reply parsing of both analysis paths. Fakes only,
// never the real API.
const { test, before, after, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const { buildTestApp, signedIn } = require('../helpers/app');
const { fakeAnthropic, IMAGE_ITEMS, TEXT_ITEMS } = require('../helpers/fakeAnthropic');
const { MODEL } = require('../../src/lib/anthropic');
const {
  IMAGE_SYSTEM_PROMPT, IMAGE_USER_MESSAGE, TEXT_SYSTEM_PROMPT, analyzeImage, analyzeText, temperatureFor,
} = require('../../src/lib/analysis');
const { REPAIR_PROMPT_PREFIX } = require('../../src/lib/hebrewName');

const JPEG_BASE64 = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]).toString('base64');
const SONNET = 'claude-sonnet-5-5';
const IMAGE_TOTALS = { calories: 450, protein_g: 34, carbs_g: 44, fat_g: 12.5, fiber_g: 1 };
const TEXT_TOTALS = { calories: 145, protein_g: 4, carbs_g: 22, fat_g: 5, fiber_g: 4 };
const MARKER = 'REPLY-MARKER';
const isRepairCall = (c) => typeof c.system === 'string' && c.system.startsWith(REPAIR_PROMPT_PREFIX);
const imageJson = (extra = {}) => JSON.stringify({ visual_description: `${MARKER} chicken`, draft_name: 'עוף', dish_name: 'עוף עם אורז', items: IMAGE_ITEMS, ...extra });
const textJson = () => JSON.stringify(TEXT_ITEMS);

// The production Haiku image request of before this change, key for key, in order.
const haikuImageRequest = (model) => ({
  model,
  max_tokens: 1500,
  temperature: 0,
  system: IMAGE_SYSTEM_PROMPT,
  messages: [{
    role: 'user',
    content: [
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: JPEG_BASE64 } },
      { type: 'text', text: IMAGE_USER_MESSAGE },
    ],
  }],
});

// ─── The temperature rule ─────────────────────────────────────────────────────
test('temperatureFor: 0 for a claude-haiku id, null (omitted) for every other model', () => {
  assert.equal(temperatureFor('claude-haiku-4-5-20251001'), 0);
  assert.equal(temperatureFor('claude-haiku-9'), 0);
  for (const m of [SONNET, 'claude-opus-5-5', 'claude-3-haiku-20240307', 'claude-fable-1']) {
    assert.equal(temperatureFor(m), null, m);
  }
});

test('analyzeImage without a model is the Haiku request of today, byte for byte', async () => {
  const fake = fakeAnthropic();
  await analyzeImage(fake, { imageBase64: JPEG_BASE64, mimeType: 'image/jpeg' });
  const call = fake.calls.find((c) => !isRepairCall(c));
  assert.equal(JSON.stringify(call), JSON.stringify(haikuImageRequest(MODEL)));
});

test('analyzeImage on a non-Haiku model omits temperature; on any claude-haiku id it sends 0', async () => {
  const sonnet = fakeAnthropic();
  await analyzeImage(sonnet, { imageBase64: JPEG_BASE64, mimeType: 'image/jpeg', model: SONNET });
  const s = sonnet.calls.find((c) => !isRepairCall(c));
  assert.deepEqual(Object.keys(s), ['model', 'max_tokens', 'system', 'messages']);
  assert.equal(s.model, SONNET);
  const { temperature, ...rest } = haikuImageRequest(SONNET);
  assert.equal(temperature, 0);
  assert.equal(JSON.stringify(s), JSON.stringify(rest));

  const haiku = fakeAnthropic();
  await analyzeImage(haiku, { imageBase64: JPEG_BASE64, mimeType: 'image/jpeg', model: 'claude-haiku-5-0' });
  assert.equal(JSON.stringify(haiku.calls.find((c) => !isRepairCall(c))), JSON.stringify(haikuImageRequest('claude-haiku-5-0')));
});

test('an explicit temperature wins over the rule: null omits, a number is sent', async () => {
  const a = fakeAnthropic();
  await analyzeImage(a, { imageBase64: JPEG_BASE64, mimeType: 'image/jpeg', model: SONNET, temperature: 0.3 });
  assert.equal(a.calls[0].temperature, 0.3);
  const b = fakeAnthropic();
  await analyzeImage(b, { imageBase64: JPEG_BASE64, mimeType: 'image/jpeg', model: MODEL, temperature: null });
  assert.equal('temperature' in b.calls[0], false);
});

// ─── The route on the configured model ───────────────────────────────────────
let ctx;
let client;
let errorLog;
before(async () => {
  ctx = await buildTestApp({ limits: { analyzePerHour: 1000 } });
  client = await signedIn(ctx.app, 'modelUser');
});
after(async () => { mock.restoreAll(); await ctx.pool.end(); });
beforeEach(() => {
  mock.restoreAll();
  mock.method(console, 'warn', () => {});
  errorLog = mock.method(console, 'error', () => {});
  ctx.anthropic.calls.length = 0;
  Object.assign(ctx.anthropic, { imageReply: undefined, imageContent: undefined, imageStopReason: undefined, textReply: undefined, textContent: undefined });
});

const analyze = () => client.post('/api/analyze', { imageBase64: JPEG_BASE64 });
const analyzeTextReq = (text = 'סלט ולחם') => client.post('/api/analyze-text', { text });
const logged = () => JSON.stringify(errorLog.mock.calls.map((c) => c.arguments.map(String)));

test('by default the image route uses the configured model (Sonnet) without temperature', async () => {
  assert.equal(ctx.config.imageModel, SONNET);
  const res = await analyze();
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { foodName: 'עוף עם אורז', ...IMAGE_TOTALS });
  const call = ctx.anthropic.calls[0];
  assert.equal(call.model, SONNET);
  assert.deepEqual(Object.keys(call), ['model', 'max_tokens', 'system', 'messages']);
});

test('IMAGE_MODEL=claude-haiku-4-5-20251001 gives the Haiku request of today, byte for byte', async () => {
  const haiku = await buildTestApp({ env: { IMAGE_MODEL: 'claude-haiku-4-5-20251001' }, limits: { analyzePerHour: 1000 } });
  try {
    const c = await signedIn(haiku.app, 'haikuUser');
    const res = await c.post('/api/analyze', { imageBase64: JPEG_BASE64 });
    assert.equal(res.status, 200);
    assert.equal(JSON.stringify(haiku.anthropic.calls[0]), JSON.stringify(haikuImageRequest(MODEL)));
  } finally {
    await haiku.pool.end();
  }
});

test('text analysis stays on MODEL at temperature 0 whatever the image model', async () => {
  const res = await analyzeTextReq();
  assert.equal(res.status, 200);
  const call = ctx.anthropic.calls[0];
  assert.equal(call.model, MODEL);
  assert.equal(call.temperature, 0);
  assert.equal(call.system, TEXT_SYSTEM_PROMPT);
  assert.deepEqual(Object.keys(call), ['model', 'max_tokens', 'temperature', 'system', 'messages']);
});

// ─── Image reply parsing ──────────────────────────────────────────────────────
const imageOk = [
  ['a non-text first block (thinking)', () => [{ type: 'thinking', thinking: `${MARKER} hmm`, signature: 'x' }, { type: 'text', text: imageJson() }]],
  ['a text block whose text is not a string, then a real one', () => [{ type: 'text', text: null }, { type: 'text', text: imageJson() }]],
  ['the JSON split over several text blocks', () => { const j = imageJson(); return [{ type: 'text', text: j.slice(0, 40) }, { type: 'text', text: j.slice(40, 90) }, { type: 'text', text: j.slice(90) }]; }],
  ['a ```json fence', () => [{ type: 'text', text: '```json\n' + imageJson() + '\n```' }]],
  ['a bare ``` fence with surrounding whitespace', () => [{ type: 'text', text: '\n ```\n' + imageJson() + '\n```  \n' }]],
  ['JSON followed by prose with braces and brackets', () => [{ type: 'text', text: imageJson() + '\n\nNote: portions {estimated} from the plate [approx], see } and ].' }]],
  ['JSON preceded by prose (with braces)', () => [{ type: 'text', text: 'Here is my {careful} analysis of the photo:\n' + imageJson() }]],
  ['a fenced reply followed by prose', () => [{ type: 'text', text: 'Sure.\n```json\n' + imageJson() + '\n```\nHope this helps {really}.' }]],
  ['nested braces, brackets, quotes and escapes inside strings, then prose', () => [{ type: 'text', text: imageJson({ visual_description: `${MARKER} a "quoted" {brace} } ] [x] \\ back\\slash "}"`, extra: { a: { b: [1, { c: '}' }] } } }) + ' trailing } text {' }]],
];
for (const [label, content] of imageOk) {
  test(`image reply with ${label} is parsed`, async () => {
    ctx.anthropic.imageContent = content();
    const res = await analyze();
    assert.equal(res.status, 200, res.text);
    assert.deepEqual(res.body, { foodName: 'עוף עם אורז', ...IMAGE_TOTALS });
  });
}

const assertUnavailable = (res) => {
  assert.equal(res.status, 502);
  assert.deepEqual(res.body, { error: { code: 'AI_UNAVAILABLE' } });
  assert.ok(!res.text.includes(MARKER));
};

for (const [label, content] of [
  ['only a thinking block', [{ type: 'thinking', thinking: `${MARKER} hmm` }]],
  ['only a tool_use block', [{ type: 'tool_use', id: 't', name: 'x', input: { note: MARKER } }]],
  ['an empty content array', []],
  ['a text block with non-string text', [{ type: 'text', text: { v: MARKER } }]],
]) {
  test(`image reply with ${label} (no text block) is a 502; the log has the block types and stop_reason, never the reply`, async () => {
    ctx.anthropic.imageContent = content;
    ctx.anthropic.imageStopReason = 'end_turn';
    assertUnavailable(await analyze());
    const lines = errorLog.mock.calls.map((c) => c.arguments.map(String).join(' '));
    const own = lines.filter((l) => l.startsWith('[analyze]'));
    assert.equal(own.length, 1);
    assert.match(own[0], /no text block/);
    assert.match(own[0], /stop_reason end_turn/);
    for (const block of content) assert.ok(own[0].includes(block.type));
    // the route's request-id line carries the same details
    assert.ok(lines.some((l) => /AI request failed/.test(l) && /no text block/.test(l) && /stop_reason end_turn/.test(l)));
    assert.ok(!logged().includes(MARKER));
  });
}

test('a response without a content array is a 502', async () => {
  ctx.anthropic.imageContent = null;
  assertUnavailable(await analyze());
  assert.match(logged(), /no text block \(reply of 0 characters in blocks missing, stop_reason end_turn\)/);
});

test('a block type that is not an API enum value is logged as unknown', async () => {
  ctx.anthropic.imageContent = [{ type: `${MARKER} "x"` }, { type: 42 }];
  assertUnavailable(await analyze());
  assert.match(logged(), /blocks unknown,unknown/);
  assert.ok(!logged().includes(MARKER));
});

for (const [label, text] of [
  ['truncated JSON', () => imageJson().slice(0, -30)],
  ['truncated JSON after prose', () => 'Here it is: ' + imageJson().slice(0, -5)],
  ['prose only, with braces', () => `I cannot see {${MARKER}} food here.`],
  ['an invalid object', () => `{"visual_description":"${MARKER}", oops}`],
]) {
  test(`image reply with ${label} is a 502 and the reply is not logged`, async () => {
    ctx.anthropic.imageContent = [{ type: 'text', text: text() }];
    ctx.anthropic.imageStopReason = 'max_tokens';
    assertUnavailable(await analyze());
    const own = errorLog.mock.calls.map((c) => c.arguments.map(String).join(' ')).filter((l) => l.startsWith('[analyze]'));
    assert.equal(own.length, 1);
    assert.match(own[0], /stop_reason max_tokens/);
    assert.match(own[0], /blocks text/);
    assert.ok(!logged().includes(MARKER));
  });
}

// ─── Text reply parsing ───────────────────────────────────────────────────────
for (const [label, content] of [
  ['prose around the array (with brackets and braces)', () => [{ type: 'text', text: 'Items [estimated] {roughly}:\n' + textJson() + '\nThat is [about] right {ok}.' }]],
  ['a non-text first block', () => [{ type: 'thinking', thinking: MARKER }, { type: 'text', text: textJson() }]],
  ['a ```json fence', () => [{ type: 'text', text: '```json\n' + textJson() + '\n```' }]],
  ['several text blocks', () => [{ type: 'text', text: textJson().slice(0, 20) }, { type: 'text', text: textJson().slice(20) }]],
  ['an array nested in an object', () => [{ type: 'text', text: JSON.stringify({ items: TEXT_ITEMS }) }]],
  ['arrays of non-objects and bracketed prose before the items', () => [{ type: 'text', text: 'Scale [1, 2] and [approx]: ' + textJson() + ' [done]' }]],
  ['an array of non-objects in an earlier object field', () => [{ type: 'text', text: JSON.stringify({ scale: [1, 2], items: TEXT_ITEMS }) + ' ok' }]],
]) {
  test(`text reply with ${label} is parsed`, async () => {
    ctx.anthropic.textContent = content();
    const res = await analyzeTextReq();
    assert.equal(res.status, 200, res.text);
    assert.deepEqual(res.body, { foodName: 'סלט ולחם', ...TEXT_TOTALS });
  });
}

for (const [label, content] of [
  ['no text block', [{ type: 'thinking', thinking: MARKER }]],
  ['truncated JSON', [{ type: 'text', text: `[{"name":"${MARKER}","weight_g":100,"calories":5` }]],
  ['truncated JSON with a string holding brackets', [{ type: 'text', text: `[{"name":"${MARKER} [x]","weight_g":100},{"name":"["` }]],
  ['an empty array', [{ type: 'text', text: '[]' }]],
  ['no array at all', [{ type: 'text', text: `{"${MARKER}": 1}` }]],
]) {
  test(`text reply with ${label} is a 502 and the reply is not logged`, async () => {
    ctx.anthropic.textContent = content;
    assertUnavailable(await analyzeTextReq());
    const own = errorLog.mock.calls.map((c) => c.arguments.map(String).join(' ')).filter((l) => l.startsWith('[analyze-text]'));
    assert.equal(own.length, 1);
    assert.match(own[0], /stop_reason end_turn/);
    assert.match(own[0], new RegExp(`blocks ${content[0].type}`));
    assert.ok(!logged().includes(MARKER));
  });
}

test('analyzeText (direct) rejects a reply without a text block with an AnalysisParseError', async () => {
  const fake = fakeAnthropic();
  fake.textContent = [{ type: 'redacted_thinking', data: MARKER }];
  await assert.rejects(analyzeText(fake, 'סלט'), (e) => e.constructor.name === 'AnalysisParseError' && !e.message.includes(MARKER));
});
