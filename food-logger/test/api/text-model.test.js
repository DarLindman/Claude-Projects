'use strict';

// TEXT_MODEL (the model of the text analysis and of the name-repair call), the request rules
// per model family (src/lib/modelRules.js) and the reply parsing of a Haiku 5 reply (thinking
// blocks). Fakes only, never the real API.
const { test, mock, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig, startupLine } = require('../../src/config');
const { buildTestApp, signedIn } = require('../helpers/app');
const { fakeAnthropic, TEXT_ITEMS, TEXT_REPLY_ITEMS } = require('../helpers/fakeAnthropic');
const { MODEL } = require('../../src/lib/anthropic');
const rules = require('../../src/lib/modelRules');
const {
  TEXT_SYSTEM_PROMPT, AnalysisParseError, analyzeImage, analyzeText, temperatureFor, maxTokensFor, requestOptionsFor,
} = require('../../src/lib/analysis');
const { TEXT_REPLY_TEMPLATE } = require('../../src/lib/prompts');
const { REPAIR_PROMPT_PREFIX, REPAIR_SYSTEM_PROMPT, ensureHebrewDishName } = require('../../src/lib/hebrewName');

const HAIKU45 = 'claude-haiku-4-5-20251001';
const HAIKU55 = 'claude-haiku-5-5';
const SONNET = 'claude-sonnet-5-5';
const JPEG_BASE64 = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]).toString('base64');
const isRepairCall = (c) => typeof c.system === 'string' && c.system.startsWith(REPAIR_PROMPT_PREFIX);
const base = { DATABASE_URL: 'postgresql://u:p@localhost:5432/db', JWT_SECRET: 'x'.repeat(32), ANTHROPIC_API_KEY: 'sk-ant-test' };

afterEach(() => mock.restoreAll());

// The text request of production before TEXT_MODEL existed, key for key, in order.
const textUserMessage = (text) => `זהה כל מאכל בטקסט וחשב ערכים תזונתיים מדויקים.\nהחזר JSON array בלבד, ללא markdown, ללא הסבר:\n${JSON.stringify(TEXT_REPLY_TEMPLATE)}\nכל הערכים מספרים. weight_g חובה — קבע אותו קודם כל.\n\nהטקסט: ${text}`;
const haiku45TextRequest = (text) => ({
  model: HAIKU45,
  max_tokens: 1200,
  temperature: 0,
  system: TEXT_SYSTEM_PROMPT,
  messages: [{ role: 'user', content: textUserMessage(text) }],
});
const haiku55TextRequest = (text) => ({
  model: HAIKU55,
  max_tokens: 4000,
  output_config: { effort: 'low' },
  system: TEXT_SYSTEM_PROMPT,
  messages: [{ role: 'user', content: textUserMessage(text) }],
});

// ─── Config ───────────────────────────────────────────────────────────────────
test('TEXT_MODEL defaults to claude-haiku-4-5-20251001 (also in production)', () => {
  assert.equal(loadConfig({ ...base }).textModel, HAIKU45);
  assert.equal(loadConfig({ ...base, NODE_ENV: 'production', ORIGIN: 'https://a.example' }).textModel, HAIKU45);
  assert.equal(MODEL, HAIKU45);
});

test('TEXT_MODEL overrides the default and is trimmed', () => {
  assert.equal(loadConfig({ ...base, TEXT_MODEL: HAIKU55 }).textModel, HAIKU55);
  assert.equal(loadConfig({ ...base, TEXT_MODEL: `  ${HAIKU55}\n` }).textModel, HAIKU55);
  assert.equal(loadConfig({ ...base, TEXT_MODEL: 'claude-sonnet-4.5_x' }).textModel, 'claude-sonnet-4.5_x');
});

test('an invalid or blank TEXT_MODEL is a startup error naming TEXT_MODEL, reported with other problems', () => {
  for (const bad of ['gpt-4', '', '   ', '\n', 'CLAUDE-HAIKU-5-5', 'claude-', 'claude', 'claude-haiku 5', 'claude-haiku/5', 'xclaude-haiku', 'claude-haiku-5-5;rm']) {
    assert.throws(
      () => loadConfig({ ...base, TEXT_MODEL: bad }),
      (e) => e instanceof Error && e.message.includes('TEXT_MODEL') && !e.message.includes('rm'),
      `TEXT_MODEL ${JSON.stringify(bad)} must be rejected`
    );
  }
  assert.throws(
    () => loadConfig({ ...base, JWT_SECRET: 'short', TEXT_MODEL: 'gpt-4' }),
    (e) => e.message.includes('JWT_SECRET') && e.message.includes('TEXT_MODEL')
  );
});

test('TEXT_MODEL does not change IMAGE_MODEL and the other way round', () => {
  const c = loadConfig({ ...base, TEXT_MODEL: HAIKU55, IMAGE_MODEL: HAIKU45 });
  assert.equal(c.textModel, HAIKU55);
  assert.equal(c.imageModel, HAIKU45);
});

test('the startup log line states imageModel, imageEffort and the configured textModel, and no secret', () => {
  const line = startupLine(loadConfig({ ...base, TEXT_MODEL: HAIKU55 }));
  assert.match(line, /^config: nodeEnv=development /);
  assert.ok(line.includes('imageModel=claude-sonnet-5-5'));
  assert.ok(line.includes('imageEffort=low'));
  assert.ok(line.endsWith(`textModel=${HAIKU55}`));
  assert.ok(!line.includes('sk-ant') && !line.includes('xxxx'));
  assert.ok(startupLine(loadConfig({ ...base })).endsWith(`textModel=${HAIKU45}`));
});

// ─── The rule functions ───────────────────────────────────────────────────────
test('family detection: Haiku 1-4 is legacy, Haiku 5 and later is new, everything else is neither', () => {
  for (const m of [HAIKU45, 'claude-haiku-4-0', 'claude-haiku-3', 'claude-haiku', 'claude-haiku-test']) {
    assert.equal(rules.isLegacyHaiku(m), true, m);
    assert.equal(rules.isHaiku5Plus(m), false, m);
  }
  for (const m of [HAIKU55, 'claude-haiku-5-0', 'claude-haiku-5', 'claude-haiku-9', 'claude-haiku-10-1', 'claude-haiku-5-5-20271201']) {
    assert.equal(rules.isLegacyHaiku(m), false, m);
    assert.equal(rules.isHaiku5Plus(m), true, m);
  }
  for (const m of [SONNET, 'claude-opus-5-5', 'claude-fable-1', 'claude-3-5-haiku-20241022', 'claude-unknown']) {
    assert.equal(rules.isLegacyHaiku(m), false, m);
    assert.equal(rules.isHaiku5Plus(m), false, m);
  }
});

test('temperatureFor: 0 for Haiku 1-4 only; max_tokens image/text/repair per family', () => {
  assert.equal(temperatureFor(HAIKU45), 0);
  for (const m of [HAIKU55, 'claude-haiku-6', SONNET, 'claude-opus-5-5', 'claude-fable-1', 'claude-unknown']) assert.equal(temperatureFor(m), null, m);

  assert.equal(maxTokensFor(HAIKU45), 1500);
  assert.equal(maxTokensFor(HAIKU55), 4000);
  assert.equal(rules.HAIKU5_MAX_TOKENS, 4000);
  for (const m of [SONNET, 'claude-opus-5-5', 'claude-unknown']) assert.equal(maxTokensFor(m), 6000, m);

  assert.equal(rules.textMaxTokensFor(HAIKU45), 1200);
  assert.equal(rules.textMaxTokensFor(HAIKU55), 4000);
  for (const m of [SONNET, 'claude-unknown']) assert.equal(rules.textMaxTokensFor(m), 6000, m);

  assert.equal(rules.repairMaxTokensFor(HAIKU45, false), 40);
  assert.equal(rules.repairMaxTokensFor(HAIKU45, true), 400);
  assert.equal(rules.repairMaxTokensFor(HAIKU55, false), 2000);
  assert.equal(rules.repairMaxTokensFor(HAIKU55, true), 2000);
});

test('requestOptionsFor: Sonnet 5 unchanged; Haiku 5 gets only output_config.effort (never thinking); others nothing', () => {
  const sonnetLow = { thinking: { type: 'between_tools' }, output_config: { effort: 'low' } };
  assert.deepEqual(requestOptionsFor(SONNET), sonnetLow);
  assert.deepEqual(requestOptionsFor(SONNET, 'high'), { thinking: { type: 'between_tools' }, output_config: { effort: 'high' } });
  assert.deepEqual(requestOptionsFor(SONNET, 'off'), {});
  assert.deepEqual(requestOptionsFor(SONNET, null), {});

  assert.deepEqual(requestOptionsFor(HAIKU55), { output_config: { effort: 'low' } });
  assert.deepEqual(requestOptionsFor(HAIKU55, undefined), { output_config: { effort: 'low' } });
  assert.deepEqual(requestOptionsFor(HAIKU55, 'medium'), { output_config: { effort: 'medium' } });
  assert.deepEqual(requestOptionsFor(HAIKU55, 'high'), { output_config: { effort: 'high' } });
  assert.deepEqual(requestOptionsFor(HAIKU55, 'off'), {});
  assert.deepEqual(requestOptionsFor(HAIKU55, null), {});
  assert.throws(() => requestOptionsFor(HAIKU55, 'max'), TypeError);

  for (const m of [HAIKU45, 'claude-opus-5-5', 'claude-fable-1', 'claude-sonnet-4-5', 'claude-unknown']) {
    for (const e of [undefined, 'low', 'high', null]) assert.deepEqual(requestOptionsFor(m, e), {}, `${m} ${e}`);
  }
});

test('textRequestOptionsFor: effort is the fixed constant low whatever IMAGE_EFFORT says', () => {
  assert.equal(rules.TEXT_EFFORT, 'low');
  assert.deepEqual(rules.textRequestOptionsFor(HAIKU55), { output_config: { effort: 'low' } });
  assert.deepEqual(rules.textRequestOptionsFor(HAIKU45), {});
  assert.deepEqual(rules.textRequestOptionsFor('claude-opus-5-5'), {});
});

// ─── The text request ─────────────────────────────────────────────────────────
test('text analysis without a model is the Haiku 4.5 request of today, byte for byte', async () => {
  const fake = fakeAnthropic();
  await analyzeText(fake, '  סלט ולחם ');
  assert.equal(fake.calls.length, 1);
  assert.equal(JSON.stringify(fake.calls[0]), JSON.stringify(haiku45TextRequest('סלט ולחם')));
  const explicit = fakeAnthropic();
  await analyzeText(explicit, 'סלט ולחם', { model: HAIKU45 });
  assert.equal(JSON.stringify(explicit.calls[0]), JSON.stringify(haiku45TextRequest('סלט ולחם')));
});

test('text analysis on claude-haiku-5-5: no temperature, effort low, max_tokens 4000, no thinking, no fallbacks', async () => {
  const fake = fakeAnthropic();
  const out = await analyzeText(fake, 'סלט ולחם', { model: HAIKU55 });
  assert.equal(fake.calls.length, 1);
  const call = fake.calls[0];
  assert.equal(JSON.stringify(call), JSON.stringify(haiku55TextRequest('סלט ולחם')));
  for (const key of ['temperature', 'top_p', 'top_k', 'thinking', 'fallbacks']) assert.equal(key in call, false, key);
  assert.deepEqual(out, { foodName: 'סלט ולחם', calories: 145, protein_g: 4, carbs_g: 22, fat_g: 5, fiber_g: 4, items: TEXT_REPLY_ITEMS });
});

test('the key order of the recorded text requests per family', async () => {
  const a = fakeAnthropic();
  const b = fakeAnthropic();
  await analyzeText(a, 'סלט', { model: HAIKU45 });
  await analyzeText(b, 'סלט', { model: HAIKU55 });
  const brief = (c) => ({ ...c, system: '<TEXT_SYSTEM_PROMPT>', messages: '<user message>' });
  assert.deepEqual(Object.keys(brief(a.calls[0])), ['model', 'max_tokens', 'temperature', 'system', 'messages']);
  assert.deepEqual(Object.keys(brief(b.calls[0])), ['model', 'max_tokens', 'output_config', 'system', 'messages']);
});

test('analyzeText rejects an empty model', async () => {
  await assert.rejects(() => analyzeText(fakeAnthropic(), 'סלט', { model: ' ' }), TypeError);
});

// ─── The name-repair call uses the text model ─────────────────────────────────
test('repair call on Haiku 4.5 is unchanged: temperature 0, max_tokens 40 (400 for a user text), no extra fields', async () => {
  const dish = fakeAnthropic();
  dish.repairReply = 'פסטה';
  await ensureHebrewDishName(dish, 'pasta', { log: () => {} });
  assert.equal(JSON.stringify(dish.calls[0]), JSON.stringify({ model: HAIKU45, max_tokens: 40, temperature: 0, system: REPAIR_SYSTEM_PROMPT, messages: [{ role: 'user', content: 'pasta' }] }));

  const text = fakeAnthropic();
  text.repairReply = 'פסטה בשר';
  await ensureHebrewDishName(text, 'pasta בשר', { mode: 'userText', maxWords: Infinity, maxChars: 200, requireHebrewLetter: false, log: () => {} });
  assert.equal(text.calls[0].max_tokens, 400);
  assert.equal(text.calls[0].temperature, 0);
  assert.equal(text.calls[0].model, HAIKU45);
});

test('repair call on Haiku 5.5: no temperature, room for thinking, effort low; a thinking block before the text is skipped', async () => {
  const fake = fakeAnthropic();
  fake.repairReply = () => ({ content: [{ type: 'thinking', thinking: 'hmm', signature: 'x' }, { type: 'text', text: 'פסטה ברוטב עגבניות' }], stop_reason: 'end_turn' });
  const r = await ensureHebrewDishName(fake, 'pasta pomodoro', { model: HAIKU55, log: () => {} });
  assert.deepEqual(r, { name: 'פסטה ברוטב עגבניות', action: 'repaired' });
  const call = fake.calls[0];
  assert.equal(JSON.stringify(call), JSON.stringify({ model: HAIKU55, max_tokens: 2000, output_config: { effort: 'low' }, system: REPAIR_SYSTEM_PROMPT, messages: [{ role: 'user', content: 'pasta pomodoro' }] }));
});

test('analyzeText on Haiku 5.5: a foreign typed text is repaired on the text model, in the same family rules', async () => {
  const fake = fakeAnthropic();
  fake.repairReply = 'פסטה בשר';
  const out = await analyzeText(fake, 'pasta בשר', { model: HAIKU55 });
  assert.equal(out.foodName, 'פסטה בשר');
  const repair = fake.calls.filter(isRepairCall);
  assert.equal(repair.length, 1);
  assert.equal(repair[0].model, HAIKU55);
  assert.equal('temperature' in repair[0], false);
  assert.deepEqual(repair[0].output_config, { effort: 'low' });
});

test('analyzeImage sends its name repair to repairModel (default MODEL) while the image call stays on its own model', async () => {
  const foreign = JSON.stringify({ visual_description: 'x', draft_name: 'עוף', dish_name: 'chicken rice', items: TEXT_ITEMS });
  const a = fakeAnthropic();
  a.imageReply = foreign;
  await analyzeImage(a, { imageBase64: JPEG_BASE64, mimeType: 'image/jpeg', model: SONNET });
  assert.equal(a.calls.filter(isRepairCall)[0].model, MODEL);
  const b = fakeAnthropic();
  b.imageReply = foreign;
  await analyzeImage(b, { imageBase64: JPEG_BASE64, mimeType: 'image/jpeg', model: SONNET, repairModel: HAIKU55 });
  assert.equal(b.calls.filter((c) => !isRepairCall(c))[0].model, SONNET);
  assert.equal(b.calls.filter(isRepairCall)[0].model, HAIKU55);
  assert.equal('temperature' in b.calls.filter(isRepairCall)[0], false);
});

// ─── Reply parsing with adaptive thinking ─────────────────────────────────────
test('a thinking block before the text block is read past: the reply is the text block', async () => {
  const fake = fakeAnthropic();
  fake.textContent = [{ type: 'thinking', thinking: 'let me think', signature: 'sig' }, { type: 'text', text: JSON.stringify(TEXT_ITEMS) }];
  const out = await analyzeText(fake, 'סלט ולחם', { model: HAIKU55 });
  assert.equal(out.calories, 145);
  assert.equal(fake.calls.length, 1);
});

test('only a thinking block and stop_reason max_tokens: unusable reply, one call, not retried as a cut reply', async () => {
  const fake = fakeAnthropic();
  fake.textContent = [{ type: 'thinking', thinking: 'a long thought', signature: 'sig' }];
  fake.textStopReason = 'max_tokens';
  const warn = mock.method(console, 'warn', () => {});
  const error = mock.method(console, 'error', () => {});
  await assert.rejects(() => analyzeText(fake, 'סלט ולחם', { model: HAIKU55 }), (e) => e instanceof AnalysisParseError && e.stopReason === 'max_tokens' && e.kind === 'no text block');
  assert.equal(fake.calls.length, 1);
  assert.ok(!warn.mock.calls.some((c) => /retrying/.test(String(c.arguments[0]))));
  assert.ok(error.mock.calls.some((c) => /blocks thinking, stop_reason max_tokens/.test(String(c.arguments[0]))));
});

test('only a thinking block and stop_reason end_turn is retried once (like any reply without a text block)', async () => {
  const fake = fakeAnthropic();
  fake.textContent = [{ type: 'thinking', thinking: 'x', signature: 's' }];
  mock.method(console, 'warn', () => {});
  mock.method(console, 'error', () => {});
  await assert.rejects(() => analyzeText(fake, 'סלט', { model: HAIKU55 }), AnalysisParseError);
  assert.equal(fake.calls.length, 2);
});

test('a refusal (stop_reason refusal) is an unusable reply: one call, no retry, no fallbacks field', async () => {
  const fake = fakeAnthropic();
  fake.textContent = [{ type: 'text', text: 'I cannot help with that.' }];
  fake.textStopReason = 'refusal';
  mock.method(console, 'warn', () => {});
  mock.method(console, 'error', () => {});
  await assert.rejects(() => analyzeText(fake, 'סלט', { model: HAIKU55 }), (e) => e instanceof AnalysisParseError && e.stopReason === 'refusal');
  assert.equal(fake.calls.length, 1);
  assert.equal('fallbacks' in fake.calls[0], false);
});

// ─── Through the app (config -> routes) ───────────────────────────────────────
async function withApp(env, fn) {
  const ctx = await buildTestApp({ env, limits: { analyzePerHour: 1000 } });
  try {
    const client = await signedIn(ctx.app, 'tmUser');
    await fn(ctx, client);
  } finally {
    await ctx.pool.end();
  }
}

test('POST /api/analyze-text uses config.textModel: Haiku 5.5 request, and the Haiku 4.5 default is unchanged', async () => {
  await withApp({ TEXT_MODEL: HAIKU55 }, async (ctx, client) => {
    const res = await client.post('/api/analyze-text', { text: 'סלט ולחם' });
    assert.equal(res.status, 200, res.text);
    assert.equal(JSON.stringify(ctx.anthropic.calls[0]), JSON.stringify(haiku55TextRequest('סלט ולחם')));
  });
  await withApp({}, async (ctx, client) => {
    const res = await client.post('/api/analyze-text', { text: 'סלט ולחם' });
    assert.equal(res.status, 200, res.text);
    assert.equal(JSON.stringify(ctx.anthropic.calls[0]), JSON.stringify(haiku45TextRequest('סלט ולחם')));
  });
});

test('IMAGE_EFFORT never changes the text request; the image path on Sonnet is unchanged and its repair goes to the text model', async () => {
  await withApp({ TEXT_MODEL: HAIKU55, IMAGE_EFFORT: 'high' }, async (ctx, client) => {
    assert.equal((await client.post('/api/analyze-text', { text: 'סלט ולחם' })).status, 200);
    assert.deepEqual(ctx.anthropic.calls[0].output_config, { effort: 'low' });
    ctx.anthropic.calls.length = 0;
    ctx.anthropic.imageReply = JSON.stringify({ visual_description: 'x', draft_name: 'עוף', dish_name: 'chicken rice', items: TEXT_ITEMS });
    const res = await client.post('/api/analyze', { imageBase64: JPEG_BASE64 });
    assert.equal(res.status, 200, res.text);
    const image = ctx.anthropic.calls.filter((c) => !isRepairCall(c));
    assert.equal(image.length, 1);
    assert.equal(image[0].model, SONNET);
    assert.deepEqual(Object.keys(image[0]), ['model', 'max_tokens', 'thinking', 'output_config', 'system', 'messages']);
    assert.equal(image[0].max_tokens, 6000);
    assert.deepEqual(image[0].output_config, { effort: 'high' });
    const repair = ctx.anthropic.calls.filter(isRepairCall);
    assert.equal(repair.length, 1);
    assert.equal(repair[0].model, HAIKU55);
  });
});

test('IMAGE_MODEL set to a Haiku 5 id: valid image request (no temperature, no thinking field), effort from IMAGE_EFFORT, off sends none', async () => {
  const run = async (env) => {
    let call;
    await withApp(env, async (ctx, client) => {
      const res = await client.post('/api/analyze', { imageBase64: JPEG_BASE64 });
      assert.equal(res.status, 200, res.text);
      call = ctx.anthropic.calls.find((c) => !isRepairCall(c));
    });
    return call;
  };
  const dflt = await run({ IMAGE_MODEL: HAIKU55 });
  assert.deepEqual(Object.keys(dflt), ['model', 'max_tokens', 'output_config', 'system', 'messages']);
  assert.equal(dflt.max_tokens, 4000);
  assert.deepEqual(dflt.output_config, { effort: 'low' });
  const medium = await run({ IMAGE_MODEL: HAIKU55, IMAGE_EFFORT: 'medium' });
  assert.deepEqual(medium.output_config, { effort: 'medium' });
  const off = await run({ IMAGE_MODEL: HAIKU55, IMAGE_EFFORT: 'off' });
  assert.deepEqual(Object.keys(off), ['model', 'max_tokens', 'system', 'messages']);
  for (const c of [dflt, medium, off]) for (const key of ['temperature', 'thinking', 'fallbacks']) assert.equal(key in c, false, key);
});

test('a repair reply cut by max_tokens or refused is no repair: the name comes from cleaning or the fallback, never the partial text', async () => {
  for (const stop of ['max_tokens', 'refusal']) {
    for (const model of [HAIKU45, HAIKU55]) {
      const fake = fakeAnthropic();
      fake.repairReply = () => ({ content: [{ type: 'text', text: 'פסטה ברוטב עג' }], stop_reason: stop });
      const dish = await ensureHebrewDishName(fake, 'pasta pomodoro', { model, log: () => {} });
      assert.deepEqual(dish, { name: 'מנה', action: 'fallback' }, `${stop} ${model}`);
      assert.equal(fake.calls.length, 1);

      const typed = fakeAnthropic();
      typed.repairReply = () => ({ content: [{ type: 'text', text: 'פסטה בשר חלקי' }], stop_reason: stop });
      const user = await ensureHebrewDishName(typed, 'pasta בשר', { model, mode: 'userText', maxWords: Infinity, maxChars: 200, requireHebrewLetter: false, log: () => {} });
      assert.equal(user.action, 'cleaned', `${stop} ${model}`);
      assert.equal(user.name, 'בשר');
    }
  }
});

test('a repair reply with stop_reason end_turn (or none) is used as before', async () => {
  for (const stop of ['end_turn', undefined]) {
    const fake = fakeAnthropic();
    fake.repairReply = () => ({ content: [{ type: 'text', text: 'פסטה' }], ...(stop ? { stop_reason: stop } : {}) });
    const r = await ensureHebrewDishName(fake, 'pasta', { log: () => {} });
    assert.deepEqual(r, { name: 'פסטה', action: 'repaired' });
  }
});
