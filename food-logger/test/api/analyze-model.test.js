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
  IMAGE_SYSTEM_PROMPT, IMAGE_USER_MESSAGE, TEXT_SYSTEM_PROMPT, analyzeImage, analyzeText, temperatureFor, requestOptionsFor,
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
  assert.deepEqual(Object.keys(s), ['model', 'max_tokens', 'thinking', 'output_config', 'system', 'messages']);
  assert.equal(s.model, SONNET);
  assert.equal('temperature' in s, false);
  const { temperature, ...rest } = haikuImageRequest(SONNET);
  assert.equal(temperature, 0);
  assert.equal(JSON.stringify(s), JSON.stringify({
    model: rest.model, max_tokens: 6000, thinking: { type: 'between_tools' }, output_config: { effort: 'low' }, system: rest.system, messages: rest.messages,
  }));

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

// ─── Low-latency request options (Sonnet 5 only) ──────────────────────────────
test('requestOptionsFor: Sonnet 5 gets between_tools thinking and an effort; every other model gets nothing', () => {
  const low = { thinking: { type: 'between_tools' }, output_config: { effort: 'low' } };
  assert.deepEqual(requestOptionsFor(SONNET), low);
  assert.deepEqual(requestOptionsFor(SONNET, undefined), low);
  assert.deepEqual(requestOptionsFor(SONNET, 'low'), low);
  assert.deepEqual(requestOptionsFor('claude-sonnet-5-0', 'medium'), { thinking: { type: 'between_tools' }, output_config: { effort: 'medium' } });
  assert.deepEqual(requestOptionsFor(SONNET, 'high'), { thinking: { type: 'between_tools' }, output_config: { effort: 'high' } });
  assert.deepEqual(requestOptionsFor(SONNET, null), {});
  assert.deepEqual(requestOptionsFor(SONNET, 'off'), {});
  for (const m of ['claude-haiku-4-5-20251001', 'claude-opus-5-5', 'claude-fable-1', 'claude-sonnet-4-5']) {
    for (const e of [undefined, 'low', 'high', null]) assert.deepEqual(requestOptionsFor(m, e), {}, `${m} ${e}`);
  }
});

test('analyzeImage on Sonnet 5: low by default, medium when asked, none for null; never a temperature', async () => {
  const run = async (opts) => {
    const fake = fakeAnthropic();
    await analyzeImage(fake, { imageBase64: JPEG_BASE64, mimeType: 'image/jpeg', model: SONNET, ...opts });
    return fake.calls.find((c) => !isRepairCall(c));
  };
  const d = await run({});
  assert.deepEqual(d.thinking, { type: 'between_tools' });
  assert.deepEqual(d.output_config, { effort: 'low' });
  assert.equal('temperature' in d, false);
  assert.deepEqual((await run({ effort: 'medium' })).output_config, { effort: 'medium' });
  const off = await run({ effort: null });
  assert.equal('thinking' in off, false);
  assert.equal('output_config' in off, false);
  assert.deepEqual(Object.keys(off), ['model', 'max_tokens', 'system', 'messages']);
});

test('Haiku and Opus image requests never carry thinking or output_config', async () => {
  for (const model of ['claude-haiku-4-5-20251001', 'claude-opus-5-5']) {
    const fake = fakeAnthropic();
    await analyzeImage(fake, { imageBase64: JPEG_BASE64, mimeType: 'image/jpeg', model, effort: 'high' });
    const call = fake.calls.find((c) => !isRepairCall(c));
    assert.equal('thinking' in call, false, model);
    assert.equal('output_config' in call, false, model);
  }
});

test('the evaluation-only prompts option replaces the system and user texts', async () => {
  const fake = fakeAnthropic();
  await analyzeImage(fake, { imageBase64: JPEG_BASE64, mimeType: 'image/jpeg', model: SONNET, prompts: { system: 'SYS-OVERRIDE', user: 'USER-OVERRIDE' } });
  const call = fake.calls.find((c) => !isRepairCall(c));
  assert.equal(call.system, 'SYS-OVERRIDE');
  assert.deepEqual(call.messages[0].content[1], { type: 'text', text: 'USER-OVERRIDE' });
  assert.equal(call.messages[0].content[0].type, 'image');
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
  assert.deepEqual(Object.keys(call), ['model', 'max_tokens', 'thinking', 'output_config', 'system', 'messages']);
  assert.deepEqual(call.thinking, { type: 'between_tools' });
  assert.deepEqual(call.output_config, { effort: 'low' });
});

test('IMAGE_EFFORT reaches the request: high is sent, off sends neither field', async () => {
  for (const [effort, expected] of [['high', { effort: 'high' }], ['off', undefined]]) {
    const app = await buildTestApp({ env: { IMAGE_EFFORT: effort }, limits: { analyzePerHour: 1000 } });
    try {
      const c = await signedIn(app.app, `effortUser${effort}`);
      const res = await c.post('/api/analyze', { imageBase64: JPEG_BASE64 });
      assert.equal(res.status, 200);
      const call = app.anthropic.calls[0];
      assert.deepEqual(call.output_config, expected);
      assert.equal('thinking' in call, expected !== undefined);
      assert.equal('output_config' in call, expected !== undefined);
      assert.equal('temperature' in call, false);
    } finally {
      await app.pool.end();
    }
  }
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
    // an unparseable reply is tried twice (see analysis-retry.test.js): one failure line per attempt
    assert.equal(own.length, 2);
    for (const l of own) {
      assert.match(l, /no text block/);
      assert.match(l, /stop_reason end_turn/);
      for (const block of content) assert.ok(l.includes(block.type));
    }
    assert.equal(ctx.anthropic.calls.length, 2);
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
    assert.equal(own.length, 2); // one failure line per attempt (the reply is retried once)
    for (const l of own) {
      assert.match(l, /stop_reason end_turn/);
      assert.match(l, new RegExp(`blocks ${content[0].type}`));
    }
    assert.ok(!logged().includes(MARKER));
  });
}

test('analyzeText (direct) rejects a reply without a text block with an AnalysisParseError', async () => {
  const fake = fakeAnthropic();
  fake.textContent = [{ type: 'redacted_thinking', data: MARKER }];
  await assert.rejects(analyzeText(fake, 'סלט'), (e) => e.constructor.name === 'AnalysisParseError' && !e.message.includes(MARKER));
});

// ─── The prompt's own JSON template is never taken as the answer ─────────────
// The templates are read from the prompts as sent, so the tests follow any prompt change.
const IMAGE_TEMPLATE = IMAGE_USER_MESSAGE.split('\n').find((l) => l.startsWith('{'));
const TEXT_TEMPLATE = (content) => content.split('\n').find((l) => l.startsWith('[{'));
const WATER = [{ name: 'מים', weight_g: 250, calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 }];

test('the templates are found in the prompts', async () => {
  assert.ok(JSON.parse(IMAGE_TEMPLATE).items.length === 1);
  await analyzeTextReq();
  assert.ok(JSON.parse(TEXT_TEMPLATE(ctx.anthropic.calls[0].messages[0].content)).length === 1);
});

test('image: an echoed template followed by the real answer gives the real answer', async () => {
  ctx.anthropic.imageContent = [{ type: 'text', text: `You asked for: ${IMAGE_TEMPLATE}\nHere it is: ${imageJson()}` }];
  const res = await analyze();
  assert.equal(res.status, 200, res.text);
  assert.deepEqual(res.body, { foodName: 'עוף עם אורז', ...IMAGE_TOTALS });
});

for (const [label, text] of [
  ['the template only', () => IMAGE_TEMPLATE],
  ['the template only, after prose', () => `Format: ${IMAGE_TEMPLATE} (${MARKER})`],
  ['the template items under another name', () => JSON.stringify({ dish_name: 'עוף', items: JSON.parse(IMAGE_TEMPLATE).items })],
  ['the template name with other items', () => JSON.stringify({ dish_name: JSON.parse(IMAGE_TEMPLATE).dish_name, items: IMAGE_ITEMS })],
]) {
  test(`image: ${label} is a 502`, async () => {
    ctx.anthropic.imageContent = [{ type: 'text', text: text() }];
    assertUnavailable(await analyze());
    assert.ok(!logged().includes(MARKER));
  });
}

test('image: a prose object without items before the real answer is skipped', async () => {
  ctx.anthropic.imageContent = [{ type: 'text', text: `Confidence {"a":1}: ${imageJson()}` }];
  const res = await analyze();
  assert.equal(res.status, 200, res.text);
  assert.deepEqual(res.body, { foodName: 'עוף עם אורז', ...IMAGE_TOTALS });
});

test('image: a real zero-calorie meal (water) is not taken for the template', async () => {
  ctx.anthropic.imageContent = [{ type: 'text', text: JSON.stringify({ dish_name: 'מים', items: WATER }) }];
  const res = await analyze();
  assert.equal(res.status, 200, res.text);
  assert.deepEqual(res.body, { foodName: 'מים', calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 });
});

test('text: an echoed template followed by the real array gives the real array', async () => {
  await analyzeTextReq();
  const template = TEXT_TEMPLATE(ctx.anthropic.calls[0].messages[0].content);
  ctx.anthropic.textContent = [{ type: 'text', text: `Format ${template}, answer: ${textJson()}` }];
  const res = await analyzeTextReq();
  assert.equal(res.status, 200, res.text);
  assert.deepEqual(res.body, { foodName: 'סלט ולחם', ...TEXT_TOTALS });
});

test('text: the template only is a 502', async () => {
  await analyzeTextReq();
  const template = TEXT_TEMPLATE(ctx.anthropic.calls[0].messages[0].content);
  ctx.anthropic.textContent = [{ type: 'text', text: template }];
  assertUnavailable(await analyzeTextReq());
});

test('text: an empty [] before the real array is skipped', async () => {
  ctx.anthropic.textContent = [{ type: 'text', text: `[] then ${textJson()}` }];
  const res = await analyzeTextReq();
  assert.equal(res.status, 200, res.text);
  assert.deepEqual(res.body, { foodName: 'סלט ולחם', ...TEXT_TOTALS });
});

test('text: a real zero-calorie item (water) is not taken for the template', async () => {
  ctx.anthropic.textContent = [{ type: 'text', text: JSON.stringify(WATER) }];
  const res = await analyzeTextReq('מים');
  assert.equal(res.status, 200, res.text);
  assert.deepEqual(res.body, { foodName: 'מים', calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 });
});

// ─── max_tokens: room for thinking on non-Haiku models ───────────────────────
test('maxTokensFor: 1500 for a claude-haiku id, 6000 for every other model', () => {
  const { maxTokensFor } = require('../../src/lib/analysis');
  assert.equal(maxTokensFor('claude-haiku-4-5-20251001'), 1500);
  for (const m of [SONNET, 'claude-opus-5-5', 'claude-3-haiku-20240307']) assert.equal(maxTokensFor(m), 6000, m);
});

test('the image request has max_tokens 6000 on Sonnet (route and eval extra path) and 1500 on Haiku', async () => {
  assert.equal((await analyze()).status, 200);
  assert.equal(ctx.anthropic.calls[0].max_tokens, 6000);
  const extra = fakeAnthropic();
  await analyzeImage(extra, { imageBase64: JPEG_BASE64, mimeType: 'image/jpeg', model: SONNET, temperature: null });
  assert.equal(extra.calls[0].max_tokens, 6000);
  const haiku = fakeAnthropic();
  await analyzeImage(haiku, { imageBase64: JPEG_BASE64, mimeType: 'image/jpeg' });
  assert.equal(haiku.calls[0].max_tokens, 1500);
});

test('a thinking block then a text block cut by max_tokens is the 502 path, logged with stop_reason max_tokens only', async () => {
  ctx.anthropic.imageContent = [{ type: 'thinking', thinking: MARKER }, { type: 'text', text: imageJson().slice(0, 200) }];
  ctx.anthropic.imageStopReason = 'max_tokens';
  assertUnavailable(await analyze());
  assert.match(logged(), /blocks thinking,text, stop_reason max_tokens/);
  assert.ok(!logged().includes(MARKER));
});
