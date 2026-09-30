'use strict';

// The Hebrew-name guard wired into both analysis routes, end to end with the fake AI.
const { test, before, after, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const { buildTestApp, signedIn } = require('../helpers/app');
const { REPAIR_PROMPT_PREFIX, DEFAULT_DISH_NAME } = require('../../src/lib/hebrewName');
const { IMAGE_ITEMS } = require('../helpers/fakeAnthropic');

const JPEG_BASE64 = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]).toString('base64');
const IMAGE_TOTALS = { calories: 450, protein_g: 34, carbs_g: 44, fat_g: 12.5, fiber_g: 1 };
const TEXT_TOTALS = { calories: 145, protein_g: 4, carbs_g: 22, fat_g: 5, fiber_g: 4 };

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

test('text: 200 characters pass untouched; 201 is not rejected by validation but is shortened to fit the food-name limit', async () => {
  const exactly200 = Array(40).fill('אורזים').join(' ').slice(0, 200).trim();
  const ok = await client.post('/api/analyze-text', { text: exactly200 });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.foodName, exactly200);

  // The route accepts up to 500 characters of description; the shown name must fit 200.
  const long = Array(40).fill('אורז').join(' ').slice(0, 201);
  const res = await client.post('/api/analyze-text', { text: long });
  assert.equal(res.status, 200);
  assert.ok(res.body.foodName.length <= 200);
  assert.notEqual(res.body.foodName, DEFAULT_DISH_NAME);
  assert.equal(repairCalls().length, 0);
});

test('text: 501 characters are rejected by the existing validation, not by the guard', async () => {
  const res = await client.post('/api/analyze-text', { text: 'א'.repeat(501) });
  assert.equal(res.status, 400);
  assert.deepEqual(res.body, { error: { code: 'VALIDATION' }, fields: { text: 'TOO_LONG' } });
  assert.equal(ctx.anthropic.calls.length, 0);
});
