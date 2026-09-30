'use strict';

// The image prompt: recognise first (visual_description), then name (dish_name) by
// general naming principles; the old prompt is frozen for evaluation only.
const { test, before, after, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { buildTestApp, signedIn } = require('../helpers/app');
const { IMAGE_ITEMS } = require('../helpers/fakeAnthropic');
const { IMAGE_SYSTEM_PROMPT, IMAGE_USER_MESSAGE } = require('../../src/lib/analysis');
const { DEFAULT_DISH_NAME } = require('../../src/lib/hebrewName');
const { IMAGE_SYSTEM_PROMPT_V1, imageUserMessageV1 } = require('../../scripts/eval/imagePromptV1');

const JPEG_BASE64 = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]).toString('base64');
const IMAGE_TOTALS = { calories: 450, protein_g: 34, carbs_g: 44, fat_g: 12.5, fiber_g: 1 };
const sha256 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

// ─── The frozen old prompt ────────────────────────────────────────────────────
// Computed once (2026-10-01) from `git show 929c25d:food-logger/src/lib/analysis.js`:
// the IMAGE_SYSTEM_PROMPT template literal and the user-message template literal of
// analyzeImage were evaluated as JavaScript strings (escapes such as \n resolved) and
// hashed as UTF-8. The same values come out of e0bd052 (the text was unchanged there).
const V1_PROMPT_SHA256 = '7c936a07a5ed39ac75b067419e81cad45cd0a70e80d89e31091b5e0310b76658';
const V1_USER_MESSAGE_SHA256 = '1011a14b6e15a4cc47db983f211fe5f8a40e3d5f7a29e89f4b8c7fb34e00eb02';

test('the frozen V1 prompt and user message are byte-identical to the old ones', () => {
  assert.equal(sha256(IMAGE_SYSTEM_PROMPT_V1), V1_PROMPT_SHA256);
  assert.equal(sha256(imageUserMessageV1), V1_USER_MESSAGE_SHA256);
});

test('the runtime prompt is not the frozen V1 prompt', () => {
  assert.notEqual(IMAGE_SYSTEM_PROMPT, IMAGE_SYSTEM_PROMPT_V1);
  assert.notEqual(IMAGE_USER_MESSAGE, imageUserMessageV1);
});

// src/ must never load anything from scripts/ (the V1 prompt is for evaluation only).
test('src/ never requires scripts/', () => {
  const srcDir = path.join(__dirname, '../../src');
  const files = fs.readdirSync(srcDir, { recursive: true }).filter((f) => f.endsWith('.js'));
  assert.ok(files.length > 10);
  for (const f of files) {
    const text = fs.readFileSync(path.join(srcDir, f), 'utf8');
    assert.ok(!/require\(\s*['"`][^'"`]*scripts[\\/]/.test(text), `${f} requires scripts/`);
    assert.ok(!/from\s+['"][^'"]*scripts[\\/]/.test(text), `${f} imports scripts/`);
    assert.ok(!text.includes('imagePromptV1') && !text.includes('_V1'), `${f} mentions the V1 prompt`);
  }
});

// ─── The runtime prompt ───────────────────────────────────────────────────────
// Stable key phrases of the naming principles (spec 3.1). Change them here together
// with the prompt.
const NAMING_PHRASES = [
  'ישראלי ממוצע',             // the name an average Israeli would say ...
  'בתפריט',                    // ... on a menu,
  'בסופר',                     // ... in a supermarket
  'לחבר',                      // ... or to a friend
  'לזהות בו מיד את הארוחה שלו', // why: the user must recognise their own meal
  'המילה היומיומית עדיפה',     // the everyday word beats ...
  'תעתיק',                     // ... a transliteration,
  'מיושנת',                    // ... an old-fashioned word
  'נדירה או תנ"כית',           // ... or a rare or biblical word
  'המילה העברית המקובלת',      // a loanword only when it is the standard Hebrew word
  'עד חמש מילים',              // short: at most about five words
  'אותיות עבריות בלבד',        // Hebrew letters only
  'להמחשה בלבד',               // the examples are illustrations ...
  'אינן רשימה',                // ... not a list to look up
  'אותו היגיון חל על כל מאכל', // the same reasoning applies to every food
];

test('the image prompt holds the recognise-then-name steps and the naming principles', () => {
  assert.ok(IMAGE_SYSTEM_PROMPT.includes('visual_description'));
  assert.ok(IMAGE_SYSTEM_PROMPT.includes('dish_name'));
  assert.ok(IMAGE_SYSTEM_PROMPT.indexOf('visual_description') < IMAGE_SYSTEM_PROMPT.indexOf('dish_name:'));
  for (const phrase of NAMING_PHRASES) assert.ok(IMAGE_SYSTEM_PROMPT.includes(phrase), `missing: ${phrase}`);
  // the old "up to 10 words" rule is gone
  assert.ok(!IMAGE_SYSTEM_PROMPT.includes('עד 10 מילים'));
});

test('the nutrition method of the old prompt is kept word for word', () => {
  const methodStart = IMAGE_SYSTEM_PROMPT_V1.indexOf('שלב 1');
  const methodEnd = IMAGE_SYSTEM_PROMPT_V1.indexOf('- dish_name:');
  const method = IMAGE_SYSTEM_PROMPT_V1.slice(methodStart, methodEnd);
  assert.ok(method.includes('עוגני כמויות') && method.includes('שלב 2 — נסתרים'));
  assert.ok(IMAGE_SYSTEM_PROMPT.includes(method));
});

test('the user message asks for visual_description first, then dish_name, then items', () => {
  const m = IMAGE_USER_MESSAGE;
  const vd = m.indexOf('"visual_description"');
  const dn = m.indexOf('"dish_name"');
  const it = m.indexOf('"items"');
  assert.ok(vd >= 0 && vd < dn && dn < it);
  assert.ok(m.includes('weight_g קודם'));
});

// Illustrative examples are lines starting with EXAMPLE_MARKER. They explain a
// principle; there must be only a handful and no dictionary-like mapping anywhere.
const EXAMPLE_MARKER = '* ';
test('prompt hygiene: a handful of examples and no food dictionary', () => {
  const lines = IMAGE_SYSTEM_PROMPT.split('\n');
  const examples = lines.filter((l) => l.startsWith(EXAMPLE_MARKER));
  assert.ok(examples.length >= 4 && examples.length <= 6, `examples: ${examples.length}`);
  // no arrows, and no line mapping a foreign word to a Hebrew word ("cutlet = שניצל");
  // the JSON field names (with an underscore) introducing an instruction are fine
  assert.ok(!/→|->|=>|⇒/.test(IMAGE_SYSTEM_PROMPT));
  for (const l of lines) {
    assert.ok(!/(?<!\w)[A-Za-z][A-Za-z ]*\s*[=:]\s*["״']?[א-ת]/.test(l), `mapping-like line: ${l}`);
  }
  // the only Latin words are the JSON field names
  const latin = new Set(IMAGE_SYSTEM_PROMPT.match(/[A-Za-z_]+/g));
  assert.deepEqual([...latin].sort(), ['dish_name', 'items', 'visual_description', 'weight_g']);
});

// ─── The call and the reply ───────────────────────────────────────────────────
let ctx;
let client;
let errorLog;
before(async () => {
  ctx = await buildTestApp({ limits: { analyzePerHour: 1000 } });
  client = await signedIn(ctx.app, 'promptUser');
});
after(async () => { mock.restoreAll(); await ctx.pool.end(); });
beforeEach(() => {
  mock.restoreAll();
  mock.method(console, 'warn', () => {});
  errorLog = mock.method(console, 'error', () => {});
  ctx.anthropic.calls.length = 0;
  ctx.anthropic.imageReply = undefined;
});

const analyze = () => client.post('/api/analyze', { imageBase64: JPEG_BASE64 });
const logged = () => JSON.stringify(errorLog.mock.calls.map((c) => c.arguments.map(String)));

test('analyzeImage sends the new prompt and user message with temperature 0 and room for the description', async () => {
  const res = await analyze();
  assert.equal(res.status, 200);
  const call = ctx.anthropic.calls[0];
  assert.equal(call.temperature, 0);
  assert.ok(call.max_tokens >= 1260);
  assert.equal(call.system, IMAGE_SYSTEM_PROMPT);
  assert.equal(call.messages[0].content[1].text, IMAGE_USER_MESSAGE);
});

test('the fake image reply carries a visual_description and the response never returns it', async () => {
  const fakeReply = await ctx.anthropic.messages.create({ messages: [{ role: 'user', content: [] }] });
  assert.equal(typeof JSON.parse(fakeReply.content[0].text).visual_description, 'string');
  const res = await analyze();
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { foodName: 'עוף עם אורז', ...IMAGE_TOTALS });
  assert.ok(!res.text.includes('visual_description'));
});

test('a 50 KB visual_description is ignored without error, not returned and not logged', async () => {
  const marker = 'VISUAL-MARKER ';
  const big = marker.repeat(Math.ceil(50 * 1024 / marker.length));
  assert.ok(big.length >= 50 * 1024);
  ctx.anthropic.imageReply = JSON.stringify({ visual_description: big, dish_name: 'שניצל', items: IMAGE_ITEMS });
  const res = await analyze();
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { foodName: 'שניצל', ...IMAGE_TOTALS });
  assert.ok(!res.text.includes('VISUAL-MARKER') && !res.text.includes('visual_description'));
  assert.ok(!logged().includes('VISUAL-MARKER'));
});

for (const [label, value] of [['a number', 42], ['null', null], ['an object', { en: 'x' }]]) {
  test(`a visual_description that is ${label} is ignored`, async () => {
    ctx.anthropic.imageReply = JSON.stringify({ visual_description: value, dish_name: 'שניצל', items: IMAGE_ITEMS });
    const res = await analyze();
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { foodName: 'שניצל', ...IMAGE_TOTALS });
  });
}

// Review Focus 4 (the same cases are in analyze-guard.test.js, here with a description)
for (const [label, value] of [['missing', undefined], ['null', null], ['42', 42], ["['x']", ['x']], ['{}', {}]]) {
  test(`dish_name ${label} next to a visual_description gives 200 with the default name`, async () => {
    const reply = { visual_description: 'breaded chicken cutlet with rice', items: IMAGE_ITEMS };
    if (value !== undefined) reply.dish_name = value;
    ctx.anthropic.imageReply = JSON.stringify(reply);
    const res = await analyze();
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { foodName: DEFAULT_DISH_NAME, ...IMAGE_TOTALS });
  });
}

test('a reply without items is the existing 502 AI_UNAVAILABLE and the description is not logged', async () => {
  ctx.anthropic.imageReply = JSON.stringify({ visual_description: 'VISUAL-MARKER plate', dish_name: 'שניצל' });
  const res = await analyze();
  assert.equal(res.status, 502);
  assert.deepEqual(res.body, { error: { code: 'AI_UNAVAILABLE' } });
  assert.ok(!logged().includes('VISUAL-MARKER'));
});

test('a broken JSON reply with a description is a 502 and the description is not logged', async () => {
  ctx.anthropic.imageReply = '{"visual_description":"VISUAL-MARKER plate","dish_name":"שניצל","items":[';
  const broken = await analyze();
  assert.equal(broken.status, 502);
  ctx.anthropic.imageReply = '{"visual_description":"VISUAL-MARKER plate", oops}';
  const invalid = await analyze();
  assert.equal(invalid.status, 502);
  assert.deepEqual(invalid.body, { error: { code: 'AI_UNAVAILABLE' } });
  assert.ok(!logged().includes('VISUAL-MARKER'));
});
