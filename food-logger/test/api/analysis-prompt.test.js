'use strict';

// The image prompt: recognise first (visual_description), then a first attempt at the
// name (draft_name), then the checked final name (dish_name) by general naming
// principles; the old prompt is frozen for evaluation only.
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
const {
  SCALE_METHOD, IMAGE_REPLY_TEMPLATE, TEXT_REPLY_TEMPLATE, PORTION_ANCHORS, TEXT_SYSTEM_PROMPT,
} = require('../../src/lib/prompts');
const portionV2 = require('../../scripts/eval/prompts/portionV2');

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

// The frozen pre-portion prompt (the evaluation variant `prePortion`). Computed once
// (2026-10-03) from `git show b67661f:food-logger/src/lib/prompts.js`: that module was
// evaluated in node (the PORTION_ANCHORS values filled in) and the sha256 of the UTF-8 bytes
// of its IMAGE_SYSTEM_PROMPT and IMAGE_USER_MESSAGE strings taken.
const PRE_PORTION_PROMPT_SHA256 = 'e8b36b23f0f341fd12d213965a5fd28b5255397fec3ccd40a5110ab71b57d395';
const PRE_PORTION_USER_MESSAGE_SHA256 = 'e4c67d9b197a932d10c6e92092658d32fdd6d8f33f44100b66f12634c7005b57';

test('the frozen prePortion prompt and user message are byte-identical to the ones at b67661f', () => {
  const frozen = require('../../scripts/eval/prompts/prePortion');
  assert.deepEqual(Object.keys(frozen).sort(), ['IMAGE_SYSTEM_PROMPT', 'IMAGE_USER_MESSAGE']);
  assert.equal(typeof frozen.IMAGE_SYSTEM_PROMPT, 'string');
  assert.equal(sha256(frozen.IMAGE_SYSTEM_PROMPT), PRE_PORTION_PROMPT_SHA256);
  assert.equal(sha256(frozen.IMAGE_USER_MESSAGE), PRE_PORTION_USER_MESSAGE_SHA256);
});

// The frozen portionV2 prompt (the scale-grounded evaluation variant the owner approved on
// 2026-10-03 after the real runs). Computed once (2026-10-03) from
// `git show 4826029:food-logger/scripts/eval/prompts/portionV2.js`: the module was evaluated
// in node and the sha256 of the UTF-8 bytes of its two strings taken. It is also the runtime
// image prompt (next test): a future prompt change updates src/lib/prompts.js, this file and
// these hashes together, on purpose.
const PORTION_V2_PROMPT_SHA256 = 'a07183e16a8cfac47109339385d6932415d2adb01fd121a879d52424bd8dcf69';
const PORTION_V2_USER_MESSAGE_SHA256 = '9bb37d4c27951f4ad5139a39b34caecfe81cfe52b051c7d36fe0dc7d594a4b3d';

test('the frozen portionV2 prompt and user message are byte-identical to the ones at 4826029', () => {
  assert.equal(sha256(portionV2.IMAGE_SYSTEM_PROMPT), PORTION_V2_PROMPT_SHA256);
  assert.equal(sha256(portionV2.IMAGE_USER_MESSAGE), PORTION_V2_USER_MESSAGE_SHA256);
});

test('the runtime image prompt and user message are exactly the portionV2 strings', () => {
  assert.equal(IMAGE_SYSTEM_PROMPT, portionV2.IMAGE_SYSTEM_PROMPT);
  assert.equal(IMAGE_USER_MESSAGE, portionV2.IMAGE_USER_MESSAGE);
  assert.equal(SCALE_METHOD, portionV2.SCALE_METHOD);
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

// Prompt v2 (tuning round): a draft, a self-check and simpler words. Principles only.
const V2_PHRASES = [
  'רק מילים שכל ישראלי מכיר',            // (a) only words every Israeli knows ...
  'בכתיב המקובל',                         // ... in the accepted spelling
  'קרא שוב כל מילה',                      // ... re-read each word of the name ...
  'מילה שישראלים באמת אומרים',            // ... is it a word Israelis really say ...
  'כתובה נכון',                           // ... spelled correctly ...
  'החלף אותה',                            // ... if not, replace it
  'אל תמציא מילה',                        // (b) never invent a word ...
  'שם לועזי של מנה שישראלים לא אומרים',   // ... nor write, in Hebrew letters, a foreign dish name Israelis do not use
  'תאר את האוכל בפשטות',                  // ... describe the food simply ...
  'המרכיב העיקרי ואיך הוא הוכן',          // ... by its main component and its preparation
  'שלא נהוג בעברית',                      // the schnitzel example: not a transliteration of a foreign name that is not in use
  'שאינה נהוגה',                          // the everyday word beats a transliteration that is not in use
  'שישראלים אומרים בפועל',                // a loanword is fine when it is the word Israelis say
  'עדיף שם כללי ונכון',                   // (c) a correct general category ...
  'ניחוש מפורט ושגוי',                    // ... beats a specific wrong guess
  'כשרואים בבירור מה זה',                 // ... but when it is clearly seen, ...
  'השם המוכר והמדויק',                    // ... give the familiar, exact name
  'במרקם, בצורת החיתוך, בצבע ובתוספות',   // ... look at texture, cut, colour and the sides
  'קרא שוב את הטיוטה',                    // the self-check step
];

test('the image prompt holds the recognise, draft, check steps and the naming principles', () => {
  const p = IMAGE_SYSTEM_PROMPT;
  const vd = p.indexOf('visual_description');
  const draft = p.indexOf('draft_name');
  const dish = p.indexOf('dish_name');
  assert.ok(vd >= 0 && vd < draft && draft < dish, 'visual_description, then draft_name, then dish_name');
  // the numbered work order says the same, and the dish_name step re-reads the draft
  const s1 = p.indexOf('1. visual_description');
  const s2 = p.indexOf('2. draft_name');
  const s3 = p.indexOf('3. dish_name');
  const s4 = p.indexOf('4. items');
  assert.ok(s1 >= 0 && s1 < s2 && s2 < s3 && s3 < s4);
  assert.ok(p.slice(s3, s4).includes('קרא שוב את הטיוטה'));
  for (const phrase of [...NAMING_PHRASES, ...V2_PHRASES]) assert.ok(p.includes(phrase), `missing: ${phrase}`);
  // the old "up to 10 words" rule is gone
  assert.ok(!p.includes('עד 10 מילים'));
});

// The nutrition method of the old prompt is kept word for word EXCEPT step 1, step 3 and the
// restaurant line. Step 1's per-food recognition hints were removed on purpose (owner
// decision 2026-10-02: general rules only, no food dictionary) and replaced by one general
// sentence; the one-line step 3 became the scale-grounded method (SCALE_METHOD, owner
// decision 2026-10-03), and the restaurant line no longer inflates sizes. Step 2, the portion
// anchors and the other assumptions are frozen as they were.
const OLD_STEP1_LINE = 'שלב 1 — זיהוי: זהה כל מרכיב גלוי תוך שימוש בהקשר המלא. דוגמאות: בשר אדום ליד אצות/אבוקדו/סויה = טונה/סשימי ולא בקר; בשר בתוך בצק עלים = וולינגטון; עיגול כהה שטוח = פטייה ולא שניצל. לגבי דגים: אל תניח סלמון אלא אם הצבע ורוד-כתום בבירור — דג לבן = דג לבן/בקלה/פילה דג, דג מטוגן שלא ברור = פילה דג מטוגן.';
const NEW_STEP1_LINE = 'שלב 1 — זיהוי: זהה כל מרכיב גלוי תוך שימוש בהקשר המלא של הצלחת: המרקם, הצבע, צורת החיתוך והתוספות.';
const OLD_STEP3_LINE = 'שלב 3 — כמויות: הערך weight_g לפי יחסים בתמונה (צלחת, כלים, ידיים כהשוואה).';
const OLD_RESTAURANT_LINE = '- מנת מסעדה: הכל גדול יותר ממה שנראה, שמן/חמאה נסתרים תמיד נכללים.';
const NEW_RESTAURANT_LINE = '- מנת מסעדה: רק כשההגשה נראית בבירור כמו במסעדה (הכלים, עיצוב המנה בצלחת), שמן/חמאה נסתרים תמיד נכללים.';
test('the nutrition method of the old prompt is kept word for word, except the new steps 1 and 3 and the restaurant line', () => {
  const methodStart = IMAGE_SYSTEM_PROMPT_V1.indexOf('שלב 1');
  const methodEnd = IMAGE_SYSTEM_PROMPT_V1.indexOf('- dish_name:');
  const oldMethod = IMAGE_SYSTEM_PROMPT_V1.slice(methodStart, methodEnd);
  assert.ok(oldMethod.includes('עוגני כמויות') && oldMethod.includes('שלב 2 — נסתרים'));
  assert.ok(oldMethod.startsWith(OLD_STEP1_LINE), 'the V1 prompt still has the old step 1');
  assert.ok(oldMethod.includes(OLD_STEP3_LINE), 'the V1 prompt still has the old step 3');
  assert.ok(oldMethod.includes(OLD_RESTAURANT_LINE), 'the V1 prompt still has the old restaurant line');
  const method = (NEW_STEP1_LINE + oldMethod.slice(OLD_STEP1_LINE.length))
    .replace(OLD_STEP3_LINE, SCALE_METHOD)
    .replace(OLD_RESTAURANT_LINE, NEW_RESTAURANT_LINE);
  assert.ok(IMAGE_SYSTEM_PROMPT.includes(method));
  for (const old of [OLD_STEP1_LINE, OLD_STEP3_LINE, OLD_RESTAURANT_LINE]) assert.ok(!IMAGE_SYSTEM_PROMPT.includes(old));
});

// ─── The scale-grounded method: reference objects, scale_reference, weight; no volume ─
test('the image prompt contains the scale method', () => {
  assert.equal(typeof SCALE_METHOD, 'string');
  assert.ok(IMAGE_SYSTEM_PROMPT.includes(SCALE_METHOD));
  assert.ok(SCALE_METHOD.startsWith('שלב 3 — כמויות'));
  for (const s of ['scale_reference', 'weight_g', 'מזלג', 'כוס', 'כף יד', 'אינה תמיד בקוטר 26', '24 ס״מ', 'אל תנפח']) {
    assert.ok(SCALE_METHOD.includes(s), `missing: ${s}`);
  }
  // in this order: the reference, then the weight
  assert.ok(SCALE_METHOD.indexOf('scale_reference') < SCALE_METHOD.indexOf('weight_g'));
  // the method sits between step 2 and the portion anchors
  const p = IMAGE_SYSTEM_PROMPT;
  assert.ok(p.indexOf('שלב 2') < p.indexOf(SCALE_METHOD) && p.indexOf(SCALE_METHOD) < p.indexOf('עוגני כמויות'));
});

// (the method may still mention that density matters, but asks for no volume field)
test('the image prompt and user message ask for no volume field', () => {
  for (const t of [IMAGE_SYSTEM_PROMPT, IMAGE_USER_MESSAGE]) assert.ok(!t.includes('volume'));
});

test('the method names no dish', () => {
  for (const dish of ['שניצל', 'פלאפל', 'המבורגר', 'פיצה', 'אורז', 'עוף', 'פסטה', 'סלט']) {
    assert.ok(!SCALE_METHOD.includes(dish), `a dish in the method: ${dish}`);
  }
  assert.deepEqual(foodMappingLines(SCALE_METHOD), []);
});

test('the user message lists the reply fields in order, scale_reference second', () => {
  const m = IMAGE_USER_MESSAGE;
  const keys = ['"visual_description"', '"scale_reference"', '"draft_name"', '"dish_name"', '"items"'].map((k) => m.indexOf(k));
  assert.ok(keys[0] >= 0, 'visual_description is listed');
  for (let i = 1; i < keys.length; i += 1) assert.ok(keys[i - 1] < keys[i], `field ${i} out of order`);
  const template = JSON.parse(m.split('\n').find((l) => l.startsWith('{')));
  assert.deepEqual(Object.keys(template), ['visual_description', 'scale_reference', 'draft_name', 'dish_name', 'items']);
  assert.deepEqual(Object.keys(template.items[0]), ['name', 'weight_g', 'calories', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g']);
  // the words after the JSON shape: scale_reference between the description and the draft,
  // then the weight first and the calories from the weight only
  const after = m.slice(m.indexOf('}]}') + 3);
  const wSr = after.indexOf('scale_reference');
  assert.ok(after.indexOf('visual_description') < wSr && wSr < after.indexOf('draft_name'));
  assert.ok(after.includes('קלוריות לפי weight_g בלבד'));
});

test('the image template is the original one plus scale_reference; the text template is unchanged', () => {
  assert.deepEqual(Object.keys(IMAGE_REPLY_TEMPLATE), ['visual_description', 'scale_reference', 'draft_name', 'dish_name', 'items']);
  assert.equal(IMAGE_REPLY_TEMPLATE.items, TEXT_REPLY_TEMPLATE, 'the image items use the one item template');
  assert.deepEqual(Object.keys(IMAGE_REPLY_TEMPLATE.items[0]), ['name', 'weight_g', 'calories', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g']);
  assert.deepEqual(Object.keys(TEXT_REPLY_TEMPLATE[0]), ['name', 'weight_g', 'calories', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g']);
  assert.ok(!TEXT_SYSTEM_PROMPT.includes('volume_ml') && !TEXT_SYSTEM_PROMPT.includes('scale_reference'));
  const prompts = require('../../src/lib/prompts');
  assert.ok(!('PORTION_METHOD' in prompts), 'the volume method is gone');
});

test('the user message asks for visual_description, then draft_name, then dish_name, then items', () => {
  const m = IMAGE_USER_MESSAGE;
  const vd = m.indexOf('"visual_description"');
  const dr = m.indexOf('"draft_name"');
  const dn = m.indexOf('"dish_name"');
  const it = m.indexOf('"items"');
  assert.ok(vd >= 0 && vd < dr && dr < dn && dn < it);
  // the order is also spelled out in words after the JSON shape, with the self-check
  const after = m.slice(m.indexOf('}]}') + 3);
  const wVd = after.indexOf('visual_description');
  const wDr = after.indexOf('draft_name');
  const wDn = after.indexOf('dish_name');
  const wIt = after.indexOf('items');
  assert.ok(wVd >= 0 && wVd < wDr && wDr < wDn && wDn < wIt);
  assert.ok(after.includes('קרא שוב את הטיוטה'));
  assert.ok(m.includes('weight_g קודם'));
});

// Illustrative examples are lines starting with EXAMPLE_MARKER. They explain a
// principle; there must be only a handful (at most six) and no dictionary-like
// mapping anywhere.
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
  assert.deepEqual([...latin].sort(), ['dish_name', 'draft_name', 'items', 'scale_reference', 'visual_description', 'weight_g']);
});

// Lines that map food words to food words with "=" or an arrow ("red meat next to
// seaweed = tuna"): a food dictionary in disguise. A quantity line of the portion anchors
// ("ביצה = 55 גרם": a digit after the "=") is a nutrition amount, not a mapping.
function foodMappingLines(text) {
  return text.split('\n').filter((l) => {
    const m = /^(.*?)(?:=|→|->)\s*["״']?(.*)$/.exec(l);
    if (!m) return false;
    const [, left, right] = m;
    if (/^\d/.test(right)) return false;
    return /[א-ת]/.test(left) && /[א-ת]/.test(right);
  });
}

test('prompt hygiene: no line maps food words to food words with = or an arrow', () => {
  assert.deepEqual(foodMappingLines(IMAGE_SYSTEM_PROMPT), []);
  // negative self-test: the old step 1 (and its arrow variants) would be flagged ...
  assert.equal(foodMappingLines(OLD_STEP1_LINE).length, 1);
  assert.equal(foodMappingLines('בשר אדום ליד אצות → טונה ולא בקר').length, 1);
  assert.equal(foodMappingLines('בשר בתוך בצק עלים -> וולינגטון').length, 1);
  assert.equal(foodMappingLines(IMAGE_SYSTEM_PROMPT_V1.split('\n').find((l) => l.startsWith('שלב 1'))).length, 1);
  // ... while the portion-anchor quantity lines are allowed
  assert.deepEqual(foodMappingLines('- ביצה = 55 גרם\n- כף שמן = 13 גרם (120 קלוריות)'), []);
  assert.ok(IMAGE_SYSTEM_PROMPT.includes('- ביצה = 55 גרם'), 'the portion anchors are still there');
});

test('the runtime prompt no longer holds the removed per-food recognition hints', () => {
  for (const removed of ['וולינגטון', 'סשימי', 'פטייה', 'אל תניח סלמון', 'בצק עלים', 'אצות']) {
    assert.ok(!IMAGE_SYSTEM_PROMPT.includes(removed), `still in the prompt: ${removed}`);
  }
  assert.ok(IMAGE_SYSTEM_PROMPT.includes(NEW_STEP1_LINE));
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

// The default image model is Sonnet, which gets no temperature (Haiku keeps 0: analyze-model.test.js).
test('analyzeImage sends the new prompt and user message without temperature (Sonnet) and room for the description and the draft', async () => {
  const res = await analyze();
  assert.equal(res.status, 200);
  const call = ctx.anthropic.calls[0];
  assert.equal(call.model, ctx.config.imageModel);
  assert.equal('temperature' in call, false);
  assert.ok(call.max_tokens >= 1500);
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

// ─── draft_name: model-only, like visual_description ─────────────────────────
test('the fake image reply carries a draft_name and the response never returns it', async () => {
  const fakeReply = await ctx.anthropic.messages.create({ messages: [{ role: 'user', content: [] }] });
  assert.equal(typeof JSON.parse(fakeReply.content[0].text).draft_name, 'string');
  ctx.anthropic.calls.length = 0;
  const res = await analyze();
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { foodName: 'עוף עם אורז', ...IMAGE_TOTALS });
  assert.ok(!res.text.includes('draft_name') && !res.text.includes('visual_description'));
});

test('a 50 KB draft_name and visual_description are ignored, not returned and not logged', async () => {
  const marker = 'DRAFT-MARKER ';
  const big = marker.repeat(Math.ceil(50 * 1024 / marker.length));
  assert.ok(big.length >= 50 * 1024);
  ctx.anthropic.imageReply = JSON.stringify({ visual_description: big, draft_name: big, dish_name: 'שניצל', items: IMAGE_ITEMS });
  const res = await analyze();
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { foodName: 'שניצל', ...IMAGE_TOTALS });
  assert.ok(!res.text.includes('DRAFT-MARKER') && !res.text.includes('draft_name'));
  assert.ok(!logged().includes('DRAFT-MARKER'));
});

test('the final dish_name wins over a different draft_name', async () => {
  ctx.anthropic.imageReply = JSON.stringify({ visual_description: 'x', draft_name: 'טיוטה אחרת', dish_name: 'שניצל', items: IMAGE_ITEMS });
  const res = await analyze();
  assert.equal(res.status, 200);
  assert.equal(res.body.foodName, 'שניצל');
  assert.ok(!res.text.includes('טיוטה אחרת'));
});

for (const [label, value] of [['missing', undefined], ['a number', 42], ['null', null], ['an object', { he: 'טיוטה' }], ['an array', ['טיוטה']], ['foreign script', 'chicken 米飯']]) {
  test(`a draft_name that is ${label} is ignored (no repair call, not returned)`, async () => {
    const reply = { visual_description: 'grilled chicken', dish_name: 'שניצל', items: IMAGE_ITEMS };
    if (value !== undefined) reply.draft_name = value;
    ctx.anthropic.imageReply = JSON.stringify(reply);
    const res = await analyze();
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { foodName: 'שניצל', ...IMAGE_TOTALS });
    assert.equal(ctx.anthropic.calls.length, 1);
    assert.ok(!res.text.includes('draft_name') && !res.text.includes('טיוטה') && !res.text.includes('米飯'));
  });
}

test('a dish_name missing next to a draft_name gives the default name, never the draft', async () => {
  ctx.anthropic.imageReply = JSON.stringify({ visual_description: 'x', draft_name: 'שניצל', items: IMAGE_ITEMS });
  const res = await analyze();
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { foodName: DEFAULT_DISH_NAME, ...IMAGE_TOTALS });
});

// ─── scale_reference: model-only, like visual_description ─────────────────────
test('the fake image reply carries a scale_reference and items in the template shape', async () => {
  const fakeReply = await ctx.anthropic.messages.create({ messages: [{ role: 'user', content: [] }] });
  const reply = JSON.parse(fakeReply.content[0].text);
  assert.equal(typeof reply.scale_reference, 'string');
  assert.deepEqual(Object.keys(reply), ['visual_description', 'scale_reference', 'draft_name', 'dish_name', 'items']);
  for (const item of reply.items) {
    assert.deepEqual(Object.keys(item), ['name', 'weight_g', 'calories', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g']);
  }
});

test('a reply without scale_reference is accepted', async () => {
  ctx.anthropic.imageReply = JSON.stringify({ visual_description: 'x', draft_name: 'עוף', dish_name: 'עוף עם אורז', items: IMAGE_ITEMS });
  const res = await analyze();
  assert.equal(res.status, 200, res.text);
  assert.deepEqual(res.body, { foodName: 'עוף עם אורז', ...IMAGE_TOTALS });
  assert.equal(ctx.anthropic.calls.length, 1);
});

test('model-only fields are never returned', async () => {
  const infoLog = mock.method(console, 'info', () => {});
  const warnLog = mock.method(console, 'warn', () => {});
  const marker = 'SCALE-MARKER dinner plate about 26 cm';
  ctx.anthropic.imageReply = JSON.stringify({
    visual_description: 'x', scale_reference: marker, draft_name: 'עוף', dish_name: 'עוף עם אורז', items: IMAGE_ITEMS,
  });
  const res = await analyze();
  assert.equal(res.status, 200, res.text);
  assert.deepEqual(Object.keys(res.body), ['foodName', 'calories', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g']);
  assert.deepEqual(res.body, { foodName: 'עוף עם אורז', ...IMAGE_TOTALS });
  assert.ok(!res.text.includes('scale_reference') && !res.text.includes('SCALE-MARKER'));
  const all = [infoLog, warnLog, errorLog].flatMap((l) => l.mock.calls.map((c) => c.arguments.map(String).join(' '))).join('\n');
  assert.ok(!all.includes('SCALE-MARKER'));
});

test('an echoed template is still rejected', async () => {
  const template = IMAGE_USER_MESSAGE.split('\n').find((l) => l.startsWith('{'));
  assert.deepEqual(JSON.parse(template), JSON.parse(JSON.stringify(IMAGE_REPLY_TEMPLATE)));
  assert.ok('scale_reference' in JSON.parse(template) && !('volume_ml' in JSON.parse(template).items[0]));
  for (const text of [
    template,
    JSON.stringify({ ...JSON.parse(template), dish_name: 'עוף' }),
    JSON.stringify({ ...JSON.parse(template), items: IMAGE_ITEMS }),
  ]) {
    ctx.anthropic.imageReply = text;
    const res = await analyze();
    assert.equal(res.status, 502, text);
    assert.deepEqual(res.body, { error: { code: 'AI_UNAVAILABLE' } });
  }
});

// ─── parse failures log stop_reason (to diagnose truncation), never the reply ─
test('a truncated reply logs its stop_reason and length, not the draft or the description', async () => {
  ctx.anthropic.imageStopReason = 'max_tokens';
  try {
    ctx.anthropic.imageReply = '{"visual_description":"VISUAL-MARKER plate","draft_name":"DRAFT-MARKER","dish_name":"שניצל","items":[{"name":"x"}, oops}';
    const invalid = await analyze();
    assert.equal(invalid.status, 502);
    ctx.anthropic.imageReply = '{"visual_description":"VISUAL-MARKER plate","draft_name":"DRAFT-MARKER","dish_name":"שניצ';
    const noObject = await analyze();
    assert.equal(noObject.status, 502);
    ctx.anthropic.imageReply = '{"visual_description":"VISUAL-MARKER plate","draft_name":"DRAFT-MARKER","dish_name":"שניצל"}';
    const noItems = await analyze();
    assert.equal(noItems.status, 502);
  } finally {
    ctx.anthropic.imageStopReason = undefined;
  }
  // (the route adds its own "AI request failed" line with the error kind)
  const lines = errorLog.mock.calls.map((c) => c.arguments.map(String).join(' ')).filter((l) => l.startsWith('[analyze]'));
  assert.equal(lines.length, 3);
  for (const l of lines) assert.match(l, /stop_reason max_tokens/);
  assert.ok(!logged().includes('VISUAL-MARKER') && !logged().includes('DRAFT-MARKER') && !logged().includes('שניצ'));
});

test('an odd stop_reason value is not logged as is', async () => {
  ctx.anthropic.imageStopReason = 'DRAFT-MARKER "quoted" value';
  try {
    ctx.anthropic.imageReply = 'no json here';
    const res = await analyze();
    assert.equal(res.status, 502);
  } finally {
    ctx.anthropic.imageStopReason = undefined;
  }
  assert.ok(!logged().includes('DRAFT-MARKER'));
  assert.match(logged(), /stop_reason unknown/);
});

// ─── The shared portion anchors ───────────────────────────────────────────────
const anchorText = (v) => (Array.isArray(v) ? v.join('-') : String(v));

test('every shared anchor appears in the prompts with its single value', () => {
  assert.deepEqual(Object.keys(PORTION_ANCHORS).sort(), ['breadSliceG', 'butterTablespoonG', 'cheeseSliceG', 'eggG', 'oilTablespoonG']);
  const lines = {
    breadSliceG: `פרוסת לחם = ${anchorText(PORTION_ANCHORS.breadSliceG)} גרם`,
    eggG: `ביצה = ${anchorText(PORTION_ANCHORS.eggG)} גרם`,
    oilTablespoonG: `כף שמן = ${anchorText(PORTION_ANCHORS.oilTablespoonG)} גרם`,
    butterTablespoonG: `חמאה כף = ${anchorText(PORTION_ANCHORS.butterTablespoonG)} גרם`,
    cheeseSliceG: `גבינה פרוסה = ${anchorText(PORTION_ANCHORS.cheeseSliceG)} גרם`,
  };
  for (const [key, line] of Object.entries(lines)) {
    assert.ok(IMAGE_SYSTEM_PROMPT.includes(line), `image prompt lacks ${key}: ${line}`);
  }
  assert.ok(TEXT_SYSTEM_PROMPT.includes(`לחם = 1 פרוסה = ${PORTION_ANCHORS.breadSliceG[0]} גרם`));
  assert.ok(TEXT_SYSTEM_PROMPT.includes(`כף שמן = ${PORTION_ANCHORS.oilTablespoonG} גרם`));
});

test('the two prompts do not contradict each other', () => {
  const oilIn = (p) => p.match(/כף שמן = (\d+) (גרם|מ"ל)/);
  const img = oilIn(IMAGE_SYSTEM_PROMPT);
  const txt = oilIn(TEXT_SYSTEM_PROMPT);
  assert.ok(img && txt, 'both prompts describe the tablespoon of oil');
  assert.equal(img[2], 'גרם');
  assert.equal(txt[2], 'גרם');
  assert.equal(img[1], txt[1]);
  const [lo, hi] = PORTION_ANCHORS.breadSliceG;
  const bread = Number(TEXT_SYSTEM_PROMPT.match(/לחם = 1 פרוסה = (\d+) גרם/)[1]);
  assert.ok(bread >= lo && bread <= hi, 'the text bread default lies inside the image range');
});

test('PORTION_ANCHORS is frozen', () => {
  assert.ok(Object.isFrozen(PORTION_ANCHORS));
  assert.ok(Object.isFrozen(PORTION_ANCHORS.breadSliceG));
  assert.ok(Object.isFrozen(PORTION_ANCHORS.cheeseSliceG));
});
