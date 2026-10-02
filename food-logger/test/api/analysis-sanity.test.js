'use strict';

// The nutrition sanity rules (src/lib/nutrition.js) run on every analysis, image and text:
// the totals come from the checked items, and a changed reply logs one numbers-only line.
// Fakes only, never the real API.
const { test, before, after, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const { buildTestApp, signedIn } = require('../helpers/app');
const { IMAGE_ITEMS, TEXT_ITEMS } = require('../helpers/fakeAnthropic');

const JPEG_BASE64 = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]).toString('base64');
const ITEM_NAME = 'פריט-סודי-למבחן';
const DISH_NAME = 'מנה-סודית-למבחן';
const KEYS = ['foodName', 'calories', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g'];

// 900 kcal in 100 g with 10 g protein, 10 g carbs, 5 g fat: the macros say 4*10 + 4*10 + 9*5 = 125.
const BAD_ITEM = { name: ITEM_NAME, weight_g: 100, calories: 900, protein_g: 10, carbs_g: 10, fat_g: 5, fiber_g: 0 };
const badImage = JSON.stringify({ visual_description: 'x', draft_name: DISH_NAME, dish_name: DISH_NAME, items: [BAD_ITEM] });
const badText = JSON.stringify([BAD_ITEM]);
const goodImage = JSON.stringify({ visual_description: 'x', draft_name: 'עוף', dish_name: 'עוף עם אורז', items: IMAGE_ITEMS });
const goodText = JSON.stringify(TEXT_ITEMS);

let ctx;
let client;
let infoLog;
before(async () => {
  ctx = await buildTestApp({ limits: { analyzePerHour: 1000 } });
  client = await signedIn(ctx.app, 'sanityUser');
});
after(async () => { mock.restoreAll(); await ctx.pool.end(); });
beforeEach(() => {
  mock.restoreAll();
  infoLog = mock.method(console, 'info', () => {});
  ctx.anthropic.imageReply = undefined;
  ctx.anthropic.textReply = undefined;
  ctx.anthropic.calls.length = 0;
});

const lines = () => infoLog.mock.calls.map((c) => c.arguments.map(String).join(' '));
const sanityLines = () => lines().filter((l) => /sanity/.test(l));
const analyze = () => client.post('/api/analyze', { imageBase64: JPEG_BASE64 });
const analyzeText = () => client.post('/api/analyze-text', { text: 'מנה לבדיקה' });

test('image: an item whose calories contradict its macros is corrected before the totals', async () => {
  ctx.anthropic.imageReply = badImage;
  const res = await analyze();
  assert.equal(res.status, 200, res.text);
  assert.deepEqual(res.body, { foodName: DISH_NAME, calories: 125, protein_g: 10, carbs_g: 10, fat_g: 5, fiber_g: 0 });
  assert.deepEqual(Object.keys(res.body), KEYS);
});

test('text: an item whose calories contradict its macros is corrected before the totals', async () => {
  ctx.anthropic.textReply = badText;
  const res = await analyzeText();
  assert.equal(res.status, 200, res.text);
  assert.deepEqual(res.body, { foodName: 'מנה לבדיקה', calories: 125, protein_g: 10, carbs_g: 10, fat_g: 5, fiber_g: 0 });
  assert.deepEqual(Object.keys(res.body), KEYS);
});

test('image: a consistent reply logs no sanity line', async () => {
  ctx.anthropic.imageReply = goodImage;
  assert.equal((await analyze()).status, 200);
  assert.equal(sanityLines().length, 0);
});

test('text: a consistent reply logs no sanity line', async () => {
  ctx.anthropic.textReply = goodText;
  assert.equal((await analyzeText()).status, 200);
  assert.equal(sanityLines().length, 0);
});

test('image: an adjusted reply logs exactly one numbers-only line', async () => {
  ctx.anthropic.imageReply = badImage;
  assert.equal((await analyze()).status, 200);
  const s = sanityLines();
  assert.equal(s.length, 1);
  assert.match(s[0], /^\[analyze\] sanity adjusted=1 calories_delta=-775 rules=calories_macros:1$/);
  assert.ok(!lines().join('\n').includes(ITEM_NAME));
  assert.ok(!lines().join('\n').includes(DISH_NAME));
});

test('text: an adjusted reply logs exactly one numbers-only line under the text tag', async () => {
  ctx.anthropic.textReply = badText;
  assert.equal((await analyzeText()).status, 200);
  const s = sanityLines();
  assert.equal(s.length, 1);
  assert.match(s[0], /^\[analyze-text\] sanity adjusted=1 calories_delta=-775 rules=calories_macros:1$/);
  assert.ok(!lines().join('\n').includes(ITEM_NAME));
});

test('the log line lists several rules sorted by id with their counts', async () => {
  // item 1: 3000 g is capped to 2000 (weight); item 2: 900 kcal vs 125 (calories_macros)
  const heavy = { name: 'x', weight_g: 3000, calories: 1000, protein_g: 100, carbs_g: 100, fat_g: 40, fiber_g: 0 };
  ctx.anthropic.textReply = JSON.stringify([heavy, BAD_ITEM]);
  assert.equal((await analyzeText()).status, 200);
  const s = sanityLines();
  assert.equal(s.length, 1);
  assert.match(s[0], /^\[analyze-text\] sanity adjusted=2 calories_delta=-?\d+(\.\d)? rules=calories_macros:1,weight:1$/);
});
