'use strict';

// The Hebrew-name guard wired into both analysis routes, end to end with the fake AI.
const { test, before, after, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const { buildTestApp, signedIn } = require('../helpers/app');
const { REPAIR_PROMPT_PREFIX, REPAIR_TEXT_SYSTEM_PROMPT, DEFAULT_DISH_NAME } = require('../../src/lib/hebrewName');
const { IMAGE_ITEMS, IMAGE_REPLY_ITEMS, TEXT_REPLY_ITEMS } = require('../helpers/fakeAnthropic');

const JPEG_BASE64 = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]).toString('base64');
const IMAGE_TOTALS = { calories: 450, protein_g: 34, carbs_g: 44, fat_g: 12.5, fiber_g: 1, items: IMAGE_REPLY_ITEMS };
const TEXT_TOTALS = { calories: 145, protein_g: 4, carbs_g: 22, fat_g: 5, fiber_g: 4, items: TEXT_REPLY_ITEMS };

let ctx;
let client;
let warn;
before(async () => {
  ctx = await buildTestApp({ limits: { analyzePerHour: 1000 } });
  client = await signedIn(ctx.app, 'guardUser');
});
after(async () => { await ctx.pool.end(); });
// The guard logs every non-ok outcome with console.warn; keep the test output quiet
// and let tests assert on the lines.
beforeEach(() => {
  mock.restoreAll();
  warn = mock.method(console, 'warn', () => {});
  ctx.anthropic.calls.length = 0;
  ctx.anthropic.repairReply = 'סלט';
  ctx.anthropic.imageReply = undefined;
});

const repairCalls = () => ctx.anthropic.calls.filter((c) => typeof c.system === 'string' && c.system.startsWith(REPAIR_PROMPT_PREFIX));

// Make the fake answer the image request with this dish_name (any JSON value).
function imageDishName(value) {
  const dish = value === undefined ? {} : { dish_name: value };
  ctx.anthropic.imageReply = JSON.stringify({ ...dish, items: IMAGE_ITEMS });
}

async function analyzeImage() {
  return client.post('/api/analyze', { imageBase64: JPEG_BASE64 });
}

test('image: foreign script in dish_name is repaired with exactly one repair call, totals unchanged', async () => {
  imageDishName('חזה עוף 米飯');
  ctx.anthropic.repairReply = 'חזה עוף עם אורז';
  const res = await analyzeImage();
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { foodName: 'חזה עוף עם אורז', ...IMAGE_TOTALS });
  assert.equal(ctx.anthropic.calls.length, 2);
  assert.equal(repairCalls().length, 1);
  assert.equal(repairCalls()[0].messages[0].content, 'חזה עוף 米飯');
  assert.equal(warn.mock.callCount(), 1);
  assert.match(warn.mock.calls[0].arguments[0], /repaired/);
});

test('image: a failing repair call never fails the analysis (careful cleaning keeps the clean words)', async () => {
  imageDishName('חזה עוף 米飯');
  ctx.anthropic.repairReply = new Error('upstream down');
  const res = await analyzeImage();
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { foodName: 'חזה עוף', ...IMAGE_TOTALS });
  assert.equal(repairCalls().length, 1);
  assert.match(warn.mock.calls[0].arguments[0], /cleaned/);
});

test('image: a repair reply in English falls back to careful cleaning', async () => {
  imageDishName('חזה עוף 米飯');
  ctx.anthropic.repairReply = 'chicken breast';
  const res = await analyzeImage();
  assert.equal(res.status, 200);
  assert.equal(res.body.foodName, 'חזה עוף');
});

test('image: a clean Hebrew dish_name makes no repair call and no log line', async () => {
  const res = await analyzeImage();
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { foodName: 'עוף עם אורז', ...IMAGE_TOTALS });
  assert.equal(ctx.anthropic.calls.length, 1);
  assert.equal(repairCalls().length, 0);
  assert.equal(warn.mock.callCount(), 0);
});

test('image: a dish_name of only foreign script with a failing repair becomes the default name', async () => {
  imageDishName('米飯');
  ctx.anthropic.repairReply = new Error('nope');
  const res = await analyzeImage();
  assert.equal(res.status, 200);
  assert.equal(res.body.foodName, DEFAULT_DISH_NAME);
  assert.equal(res.body.calories, 450);
});

for (const [label, value] of [['missing', undefined], ['null', null], ['a number', 42], ['an array', ['x']], ['an object', {}], ['blank', '   ']]) {
  test(`image: dish_name ${label} gives the default name, never a failure`, async () => {
    imageDishName(value);
    const res = await analyzeImage();
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { foodName: DEFAULT_DISH_NAME, ...IMAGE_TOTALS });
    assert.equal(repairCalls().length, 0);
  });
}

// Dish-name limits (tuning round): 8 words and 70 characters.
test('image: a clean 8-word dish_name is shown unchanged with no log line', async () => {
  const eight = 'אחד שתיים שלוש ארבע חמש שש שבע שמונה';
  imageDishName(eight);
  const res = await analyzeImage();
  assert.equal(res.status, 200);
  assert.equal(res.body.foodName, eight);
  assert.equal(repairCalls().length, 0);
  assert.equal(warn.mock.callCount(), 0);
});

test('image: a 9-word dish_name is shortened to 8 words, without a dangling connector', async () => {
  imageDishName('אחד שתיים שלוש ארבע חמש שש שבע שמונה תשע');
  let res = await analyzeImage();
  assert.equal(res.status, 200);
  assert.equal(res.body.foodName, 'אחד שתיים שלוש ארבע חמש שש שבע שמונה');
  imageDishName('אחד שתיים שלוש ארבע חמש שש שבע עם תשע');
  res = await analyzeImage();
  assert.equal(res.body.foodName, 'אחד שתיים שלוש ארבע חמש שש שבע');
  assert.equal(repairCalls().length, 0);
  assert.equal(warn.mock.callCount(), 2);
  assert.match(warn.mock.calls[0].arguments[0], /^hebrewName cleaned: /);
});

test('text: a Latin text is repaired through the repair call (one extra call)', async () => {
  const res = await client.post('/api/analyze-text', { text: 'salad' });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { foodName: 'סלט', ...TEXT_TOTALS });
  assert.equal(ctx.anthropic.calls.length, 2);
  assert.equal(repairCalls().length, 1);
  assert.equal(repairCalls()[0].messages[0].content, 'salad');
});

test('text: a failing repair keeps the analysis and cleans the name', async () => {
  ctx.anthropic.repairReply = new Error('upstream down');
  const res = await client.post('/api/analyze-text', { text: 'אורז salad' });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { foodName: 'אורז', ...TEXT_TOTALS });
});

test('text: a 12-word Hebrew description comes back unchanged with no repair call', async () => {
  const text = 'אני אכלתי היום בארוחת הצהריים חצי צלחת אורז עם עוף וסלט ירקות';
  assert.equal(text.split(' ').length, 12);
  const res = await client.post('/api/analyze-text', { text });
  assert.equal(res.status, 200);
  assert.equal(res.body.foodName, text);
  assert.equal(ctx.anthropic.calls.length, 1);
  assert.equal(repairCalls().length, 0);
  assert.equal(warn.mock.callCount(), 0);
});

test('text: a text without letters is kept as typed', async () => {
  const res = await client.post('/api/analyze-text', { text: '100' });
  assert.equal(res.status, 200);
  assert.equal(res.body.foodName, '100');
  assert.equal(repairCalls().length, 0);
});

test('text: 200 characters pass untouched; a 201-character text is shortened at a word boundary and logged as cleaned', async () => {
  const exactly200 = Array(40).fill('אורזים').join(' ').slice(0, 200).trim();
  const ok = await client.post('/api/analyze-text', { text: exactly200 });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.foodName, exactly200);
  assert.equal(warn.mock.callCount(), 0);

  // The route accepts up to 500 characters of description; the shown name must fit 200.
  const long = Array(41).fill('אורז').join(' ').slice(0, 201);
  assert.equal(long.length, 201);
  const res = await client.post('/api/analyze-text', { text: long });
  assert.equal(res.status, 200);
  assert.equal(res.body.foodName, Array(40).fill('אורז').join(' ')); // 199 characters, 40 whole words
  assert.equal(repairCalls().length, 0);
  assert.equal(warn.mock.callCount(), 1);
  assert.match(warn.mock.calls[0].arguments[0], /^hebrewName cleaned: /);
});

// Text the user typed is shown as typed: only non-Hebrew LETTERS are translated.
const AS_TYPED = [
  ['אורז עם עוף!', 'אורז עם עוף!'],
  ['מה אכלתי? סלט', 'מה אכלתי? סלט'],
  ['ארוחה 25₪', 'ארוחה 25₪'],
  ['שניצל 🍗', 'שניצל 🍗'],
  ['מבשל 👨\u200D🍳 בבית', 'מבשל 👨\u200D🍳 בבית'],
  ['100', '100'],
  ['שווארמה 50%', 'שווארמה 50%'],
  ['סלט  ולחם', 'סלט ולחם'],
  ['סלט\nולחם', 'סלט ולחם'],
  ['סלט\u00A0ולחם', 'סלט ולחם'],
  ['סלט… ולחם – טוב', 'סלט… ולחם – טוב'],
];
for (const [typed, shown] of AS_TYPED) {
  test(`text: ${JSON.stringify(typed)} comes back as typed with no AI repair and no log`, async () => {
    const res = await client.post('/api/analyze-text', { text: typed });
    assert.equal(res.status, 200);
    assert.equal(res.body.foodName, shown);
    assert.equal(ctx.anthropic.calls.length, 1);
    assert.equal(warn.mock.callCount(), 0);
  });
}

const PASTA_TEXT = 'אני אכלתי היום בארוחת הצהריים חצי צלחת pasta עם עוף וסלט ירקות';
const WITHOUT_PASTA = 'אני אכלתי היום בארוחת הצהריים חצי צלחת עם עוף וסלט ירקות';
const WITH_FUSILLI = PASTA_TEXT.replace('pasta', 'פסטה');

test('text: one English word in a 12-word description is translated with the text prompt, the other words are kept', async () => {
  assert.equal(PASTA_TEXT.split(' ').length, 12);
  ctx.anthropic.repairReply = (req) => req.messages[0].content.replace('pasta', 'פסטה');
  const res = await client.post('/api/analyze-text', { text: PASTA_TEXT });
  assert.equal(res.status, 200);
  assert.equal(res.body.foodName, WITH_FUSILLI);
  assert.equal(ctx.anthropic.calls.length, 2);
  assert.equal(repairCalls().length, 1);
  const repair = repairCalls()[0];
  assert.equal(repair.system, REPAIR_TEXT_SYSTEM_PROMPT);
  assert.ok(!/six words|at most/i.test(repair.system));
  assert.equal(repair.messages[0].content, PASTA_TEXT);
  assert.equal(warn.mock.callCount(), 1);
  assert.match(warn.mock.calls[0].arguments[0], /^hebrewName repaired: /);
});

test('text: punctuation around the translated word is kept', async () => {
  ctx.anthropic.repairReply = (req) => req.messages[0].content.replace('pasta', 'פסטה');
  const res = await client.post('/api/analyze-text', { text: 'אורז עם עוף! pasta?' });
  assert.equal(res.body.foodName, 'אורז עם עוף! פסטה?');
});

for (const [label, reply] of [
  ['throws', new Error('upstream down')],
  ['returns a six-word summary', 'אכלתי פסטה עם עוף וסלט'],
  ['returns an empty string', ''],
  ['returns English', 'I ate pasta with chicken and salad'],
]) {
  test(`text: when the repair call ${label}, only the English word is removed and every other word is kept`, async () => {
    ctx.anthropic.repairReply = reply;
    const res = await client.post('/api/analyze-text', { text: PASTA_TEXT });
    assert.equal(res.status, 200);
    assert.equal(res.body.foodName, WITHOUT_PASTA);
    assert.equal(repairCalls().length, 1);
    assert.match(warn.mock.calls[0].arguments[0], /^hebrewName cleaned: /);
  });
}

test('text: invisible characters are never kept (no repair call when no foreign letter is present)', async () => {
  const res = await client.post('/api/analyze-text', { text: '\uFEFFסלט\u200B ולחם\u202E' });
  assert.equal(res.status, 200);
  assert.equal(res.body.foodName, 'סלט ולחם');
  assert.equal(repairCalls().length, 0);
  assert.equal(warn.mock.callCount(), 1);
  assert.match(warn.mock.calls[0].arguments[0], /^hebrewName cleaned: /);
});

test('text: invisible characters plus an English word are repaired without the invisible characters in the request', async () => {
  ctx.anthropic.repairReply = (req) => req.messages[0].content.replace('pasta', 'פסטה');
  const res = await client.post('/api/analyze-text', { text: '\uFEFFסלט\u200B pasta' });
  assert.equal(res.body.foodName, 'סלט פסטה');
  assert.equal(repairCalls()[0].messages[0].content, 'סלט pasta');
});

test('text: a text of only English words with a failing repair falls back to the default name', async () => {
  ctx.anthropic.repairReply = new Error('down');
  const res = await client.post('/api/analyze-text', { text: 'chicken salad' });
  assert.equal(res.status, 200);
  assert.equal(res.body.foodName, DEFAULT_DISH_NAME);
  assert.match(warn.mock.calls[0].arguments[0], /^hebrewName fallback: /);
});

test('text: 501 characters are rejected by the existing validation, not by the guard', async () => {
  const res = await client.post('/api/analyze-text', { text: 'א'.repeat(501) });
  assert.equal(res.status, 400);
  assert.deepEqual(res.body, { error: { code: 'VALIDATION' }, fields: { text: 'TOO_LONG' } });
  assert.equal(ctx.anthropic.calls.length, 0);
});
