'use strict';

// Both analysis replies carry `items`: [{ name, calories }], built from the sanity-checked
// items (never any weight or volume field). Fakes only, never the real API.
const { test, before, after, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const { buildTestApp, signedIn } = require('../helpers/app');
const { IMAGE_ITEMS, TEXT_ITEMS } = require('../helpers/fakeAnthropic');

const JPEG_BASE64 = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]).toString('base64');
const DEFAULT_LABEL = 'פריט';

const item = (name, calories = 100, extra = {}) => ({ name, weight_g: 100, calories, protein_g: 5, carbs_g: 10, fat_g: 2, fiber_g: 1, ...extra });
const imageReply = (items) => JSON.stringify({ visual_description: 'x', scale_reference: 'fork', draft_name: 'עוף', dish_name: 'עוף עם אורז', items });

let ctx;
let client;
before(async () => {
  ctx = await buildTestApp({ limits: { analyzePerHour: 1000 } });
  client = await signedIn(ctx.app, 'itemsUser');
});
after(async () => { mock.restoreAll(); await ctx.pool.end(); });
beforeEach(() => {
  mock.restoreAll();
  mock.method(console, 'info', () => {});
  mock.method(console, 'warn', () => {});
  ctx.anthropic.imageReply = undefined;
  ctx.anthropic.textReply = undefined;
  ctx.anthropic.calls.length = 0;
});

const analyze = () => client.post('/api/analyze', { imageBase64: JPEG_BASE64 });
const analyzeText = () => client.post('/api/analyze-text', { text: 'מנה לבדיקה' });
const PATHS = [
  ['image', analyze, (items) => { ctx.anthropic.imageReply = imageReply(items); }],
  ['text', analyzeText, (items) => { ctx.anthropic.textReply = JSON.stringify(items); }],
];

test('image: the two items of the default reply come back with their names and calories', async () => {
  const res = await analyze();
  assert.equal(res.status, 200, res.text);
  assert.deepEqual(res.body.items, [{ name: 'עוף', calories: 250 }, { name: 'אורז', calories: 200 }]);
  assert.deepEqual(Object.keys(res.body), ['foodName', 'calories', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g', 'items']);
  assert.equal(res.body.foodName, 'עוף עם אורז');
  assert.equal(res.body.calories, 450);
});

test('text: the two items of the default reply come back with their names and calories', async () => {
  const res = await analyzeText();
  assert.equal(res.status, 200, res.text);
  assert.deepEqual(res.body.items, [{ name: 'סלט', calories: 80 }, { name: 'לחם', calories: 65 }]);
  assert.deepEqual(Object.keys(res.body), ['foodName', 'calories', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g', 'items']);
  assert.equal(res.body.foodName, 'מנה לבדיקה');
  assert.equal(res.body.calories, 145);
  assert.deepEqual(TEXT_ITEMS.map((i) => i.name), ['סלט', 'לחם'], 'the fixture is what the test assumes');
  assert.equal(IMAGE_ITEMS.length, 2);
});

for (const [label, call, setReply] of PATHS) {
  test(`${label}: no weight or volume field anywhere in the response`, async () => {
    setReply([item('אורז', 200, { volume_ml: 300 }), item('עוף', 250)]);
    const res = await call();
    assert.equal(res.status, 200, res.text);
    assert.ok(!/weight_g|volume_ml|weight|volume/.test(res.text), res.text);
    for (const it of res.body.items) assert.deepEqual(Object.keys(it), ['name', 'calories']);
  });

  test(`${label}: at most 8 items, the first 8 in model order`, async () => {
    setReply(Array.from({ length: 12 }, (_, i) => item(`פריט${'אבגדהוזחטיכל'[i]}`, 100 + i)));
    const res = await call();
    assert.equal(res.status, 200, res.text);
    assert.equal(res.body.items.length, 8);
    assert.deepEqual(res.body.items.map((i) => i.calories), [100, 101, 102, 103, 104, 105, 106, 107]);
    assert.equal(res.body.calories, Array.from({ length: 12 }, (_, i) => 100 + i).reduce((a, b) => a + b), 'the totals still cover every item');
  });

  test(`${label}: a foreign word is dropped from an item name (the existing cleaning)`, async () => {
    setReply([item('chicken עוף')]);
    const res = await call();
    assert.deepEqual(res.body.items, [{ name: 'עוף', calories: 100 }]);
  });

  test(`${label}: an empty or unusable name becomes the neutral label`, async () => {
    setReply([item(''), item('???'), item('chicken'), item('123'), item(undefined), item(42), item('  -  ')]);
    const res = await call();
    assert.equal(res.status, 200, res.text);
    assert.deepEqual(res.body.items.map((i) => i.name), Array(7).fill(DEFAULT_LABEL));
  });

  test(`${label}: a long name is cut to 40 characters`, async () => {
    const long = Array.from({ length: 12 }, () => 'שניצל').join(' '); // 71 characters
    setReply([item(long)]);
    const res = await call();
    assert.ok(res.body.items[0].name.length <= 40, res.body.items[0].name);
    assert.ok(res.body.items[0].name.startsWith('שניצל שניצל'));
    assert.equal(res.body.items[0].name, res.body.items[0].name.trim());
  });

  test(`${label}: calories are the sanity-checked values, rounded and never negative`, async () => {
    // 900 kcal in 100 g with 10 g protein, 10 g carbs, 5 g fat: the macros say 125 (rule calories_macros)
    setReply([
      item('מנה', 900, { protein_g: 10, carbs_g: 10, fat_g: 5, fiber_g: 0 }),
      item('עוד', 80.6, { protein_g: 5, carbs_g: 10, fat_g: 0, fiber_g: 0 }),
      item('שלילי', -50, { protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 }),
    ]);
    const res = await call();
    assert.equal(res.status, 200, res.text);
    assert.deepEqual(res.body.items, [
      { name: 'מנה', calories: 125 },
      { name: 'עוד', calories: 81 },
      { name: 'שלילי', calories: 0 },
    ]);
    for (const it of res.body.items) assert.ok(Number.isInteger(it.calories) && it.calories >= 0);
  });

  test(`${label}: the old fields are unchanged`, async () => {
    setReply([item('אחד', 100), item('שניים', 50)]);
    const res = await call();
    assert.equal(res.status, 200, res.text);
    const { items, ...rest } = res.body;
    assert.deepEqual(rest, {
      foodName: label === 'image' ? 'עוף עם אורז' : 'מנה לבדיקה',
      calories: 150, protein_g: 10, carbs_g: 20, fat_g: 4, fiber_g: 2,
    });
    assert.equal(items.length, 2);
  });

  test(`${label}: item names are never logged`, async () => {
    const logs = [];
    for (const m of ['info', 'warn', 'error']) mock.method(console, m, (...a) => { logs.push(a.map(String).join(' ')); });
    setReply([item('שם-סודי-של-פריט', 900, { protein_g: 10, carbs_g: 10, fat_g: 5, fiber_g: 0 })]);
    const res = await call();
    assert.equal(res.status, 200, res.text);
    assert.ok(!logs.join('\n').includes('שם-סודי-של-פריט'), logs.join('\n'));
  });
}
