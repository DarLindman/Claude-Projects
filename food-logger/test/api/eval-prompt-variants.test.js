'use strict';

// The image-prompt variants of the evaluation tool (scripts/eval/prompts/): their shape, the
// reply-field order they ask for, and that portionV2 differs from prePortion only in the
// portion estimation. No database, no API.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PROMPTS_DIR = path.join(__dirname, '../../scripts/eval/prompts');
const prePortion = require('../../scripts/eval/prompts/prePortion');
const portionV2 = require('../../scripts/eval/prompts/portionV2');

// The two lines of prePortion that portionV2 replaces on purpose.
const OLD_STEP3_LINE = 'שלב 3 — כמויות: הערך weight_g לפי יחסים בתמונה (צלחת, כלים, ידיים כהשוואה).';
const OLD_RESTAURANT_LINE = '- מנת מסעדה: הכל גדול יותר ממה שנראה, שמן/חמאה נסתרים תמיד נכללים.';
const NEW_RESTAURANT_LINE = '- מנת מסעדה: רק כשההגשה נראית בבירור כמו במסעדה (הכלים, עיצוב המנה בצלחת), שמן/חמאה נסתרים תמיד נכללים.';

const templateOf = (m) => JSON.parse(m.split('\n').find((l) => l.startsWith('{')));
const ITEM_KEYS = ['name', 'weight_g', 'calories', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g'];

test('the variant files are prePortion and portionV2, each exporting the two prompt strings', () => {
  const files = fs.readdirSync(PROMPTS_DIR).filter((f) => f.endsWith('.js')).sort();
  assert.ok(files.includes('prePortion.js') && files.includes('portionV2.js'));
  assert.deepEqual(Object.keys(prePortion).sort(), ['IMAGE_SYSTEM_PROMPT', 'IMAGE_USER_MESSAGE']);
  // portionV2 also exports its new method text (SCALE_METHOD) for this test
  assert.deepEqual(Object.keys(portionV2).sort(), ['IMAGE_SYSTEM_PROMPT', 'IMAGE_USER_MESSAGE', 'SCALE_METHOD']);
  for (const v of [prePortion, portionV2]) {
    assert.equal(typeof v.IMAGE_SYSTEM_PROMPT, 'string');
    assert.equal(typeof v.IMAGE_USER_MESSAGE, 'string');
    assert.ok(v.IMAGE_SYSTEM_PROMPT.trim() && v.IMAGE_USER_MESSAGE.trim());
  }
  assert.equal(typeof portionV2.SCALE_METHOD, 'string');
});

test('prePortion keeps its own reply-field order', () => {
  const m = prePortion.IMAGE_USER_MESSAGE;
  assert.deepEqual(Object.keys(templateOf(m)), ['visual_description', 'draft_name', 'dish_name', 'items']);
  assert.ok(!m.includes('scale_reference'));
});

test('portionV2 lists the reply fields in order: visual_description, scale_reference, draft_name, dish_name, items', () => {
  const m = portionV2.IMAGE_USER_MESSAGE;
  const template = templateOf(m);
  assert.deepEqual(Object.keys(template), ['visual_description', 'scale_reference', 'draft_name', 'dish_name', 'items']);
  assert.deepEqual(Object.keys(template.items[0]), ITEM_KEYS);
  // the same order spelled out in words after the JSON shape
  const after = m.slice(m.indexOf('}]}') + 3);
  const pos = ['visual_description', 'scale_reference', 'draft_name', 'dish_name', 'items'].map((k) => after.indexOf(k));
  assert.ok(pos[0] >= 0);
  for (let i = 1; i < pos.length; i += 1) assert.ok(pos[i - 1] < pos[i], `field ${i} out of order`);
  assert.ok(after.includes('קלוריות לפי weight_g בלבד'));
  assert.ok(!m.includes('volume'));
});

test('portionV2: the method asks for scale_reference, derives the plate size, and names no dish', () => {
  const s = portionV2.SCALE_METHOD;
  assert.ok(portionV2.IMAGE_SYSTEM_PROMPT.includes('scale_reference'));
  assert.ok(portionV2.IMAGE_SYSTEM_PROMPT.includes(s));
  assert.ok(s.startsWith('שלב 3 — כמויות'));
  for (const phrase of ['scale_reference', 'weight_g', 'מזלג', 'כוס', 'כף יד', 'אינה תמיד בקוטר 26', '24 ס״מ', 'אל תנפח']) {
    assert.ok(s.includes(phrase), `missing: ${phrase}`);
  }
  for (const dish of ['שניצל', 'פלאפל', 'המבורגר', 'פיצה']) assert.ok(!s.includes(dish), `a dish in the method: ${dish}`);
  assert.ok(!s.includes('volume') && !s.includes('none'));
  // the method sits between step 2 and the portion anchors
  const p = portionV2.IMAGE_SYSTEM_PROMPT;
  assert.ok(p.indexOf('שלב 2') < p.indexOf(s) && p.indexOf(s) < p.indexOf('עוגני כמויות'));
});

test('portionV2 differs from prePortion only in step 3 and the restaurant line', () => {
  const v2 = portionV2.IMAGE_SYSTEM_PROMPT;
  assert.ok(v2.includes(NEW_RESTAURANT_LINE));
  assert.ok(!v2.includes(OLD_STEP3_LINE) && !v2.includes(OLD_RESTAURANT_LINE));
  const back = v2.replace(portionV2.SCALE_METHOD, OLD_STEP3_LINE).replace(NEW_RESTAURANT_LINE, OLD_RESTAURANT_LINE);
  assert.equal(back, prePortion.IMAGE_SYSTEM_PROMPT);
  // the user message: only the scale_reference field and its words are added
  const userBack = portionV2.IMAGE_USER_MESSAGE
    .replace('"scale_reference":"reference objects and the plate diameter",', '')
    .replace(' אחריו scale_reference (קנה המידה וקוטר הצלחת),', '');
  assert.equal(userBack, prePortion.IMAGE_USER_MESSAGE);
});

test('portionV2 adds no Latin word to the system prompt except the field name scale_reference', () => {
  const latin = (t) => new Set(t.match(/[A-Za-z_]+/g));
  const added = [...latin(portionV2.IMAGE_SYSTEM_PROMPT)].filter((w) => !latin(prePortion.IMAGE_SYSTEM_PROMPT).has(w));
  assert.deepEqual(added, ['scale_reference']);
});
