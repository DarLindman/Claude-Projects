'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  REPAIR_SYSTEM_PROMPT, REPAIR_TEXT_SYSTEM_PROMPT, REPAIR_PROMPT_PREFIX, DEFAULT_DISH_NAME, DISH_MAX_WORDS,
  findForeignScript, isValidDishName, cleanDishName, ensureHebrewDishName,
} = require('../../src/lib/hebrewName');
const { MODEL } = require('../../src/lib/anthropic');
const { fakeAnthropic } = require('../helpers/fakeAnthropic');

const setup = (repairReply) => {
  const fake = fakeAnthropic();
  if (repairReply !== undefined) fake.repairReply = repairReply;
  const logs = [];
  return { fake, logs, log: (line) => logs.push(line) };
};

test('constants: prompt prefix and default name', () => {
  assert.equal(REPAIR_PROMPT_PREFIX, 'You are a Hebrew food-name editor.');
  assert.ok(REPAIR_SYSTEM_PROMPT.startsWith(REPAIR_PROMPT_PREFIX));
  assert.equal(DEFAULT_DISH_NAME, 'מנה');
});

test('the dish repair prompt asks for about five words and does not state the guard limit', () => {
  assert.equal(DISH_MAX_WORDS, 8);
  assert.ok(REPAIR_SYSTEM_PROMPT.includes('about five words'));
  assert.ok(!/six words|at most/i.test(REPAIR_SYSTEM_PROMPT));
});

test('findForeignScript accepts legitimate Hebrew names (no repair trigger)', () => {
  for (const s of [
    'עוף עם אורז', 'שָׁלוֹם', 'חזה עוף 200 גרם', '2 ביצים', 'קפה - נס', 'שווארמה 50%', 'עוף + אורז',
    'קק״ל', 'צ׳יפס', 'עוף – אורז', 'עוף — אורז', 'סלט "ירוק"', 'סלט ’ירוק’', 'סלט “ירוק”', 'סלט (גדול)',
    'פסטה, רוטב', 'עוגה 1.5', 'חומוס/טחינה', 'שניצל & צ׳יפס', 'ארוחה: עוף; אורז', 'ך ם ן ף ץ', '',
  ]) assert.equal(findForeignScript(s), false, s);
});

test('findForeignScript flags other scripts, emoji and mixed names', () => {
  for (const s of ['米飯', 'chicken', 'دجاج', 'курица', '🍗', '🍗 שניצל', 'עוף chicken', 'עוף é', 'עוף​אורז', 'עוף * אורז', 'עוף_אורז', 'עוף #1'])
    assert.equal(findForeignScript(s), true, s);
});

test('cleanDishName removes foreign characters with the word they touch', () => {
  assert.equal(cleanDishName('חזה עוף עם 米飯'), 'חזה עוף');
  assert.equal(cleanDishName('🍗 שניצל'), 'שניצל');
  assert.equal(cleanDishName('שניצל 🍗'), 'שניצל');
  assert.equal(cleanDishName('עוף chicken עם אורז'), 'עוף עם אורז');
  assert.equal(cleanDishName('עוףplate אורז'), 'אורז');
  assert.equal(cleanDishName('米飯 עוף'), 'עוף');
  assert.equal(cleanDishName('  עוף    עם   אורז  '), 'עוף עם אורז');
  assert.equal(cleanDishName('chicken 米飯 🍗'), '');
  assert.equal(cleanDishName(''), '');
});

test('cleanDishName strips dangling connectors and stray punctuation until stable', () => {
  assert.equal(cleanDishName('עם עוף'), 'עוף');
  assert.equal(cleanDishName('של עם עוף עם של'), 'עוף');
  assert.equal(cleanDishName('עוף או'), 'עוף');
  assert.equal(cleanDishName('את על עוף'), 'עוף');
  assert.equal(cleanDishName('- עוף , '), 'עוף');
  assert.equal(cleanDishName('(עוף) -'), '(עוף)');
  assert.equal(cleanDishName(') עוף ('), 'עוף');
  assert.equal(cleanDishName('שווארמה 50%'), 'שווארמה 50%');
  assert.equal(cleanDishName('עוף עם - '), 'עוף');
  assert.equal(cleanDishName('!!! 123'), '123');
  assert.equal(cleanDishName('עם'), '');
  // A connector in the middle stays.
  assert.equal(cleanDishName('עוף עם אורז'), 'עוף עם אורז');
  // A word merely starting with a connector is not a connector.
  assert.equal(cleanDishName('עמוד עוף'), 'עמוד עוף');
});

test('isValidDishName enforces length, word count and control characters', () => {
  assert.equal(isValidDishName('עוף עם אורז'), true);
  assert.equal(isValidDishName(''), false);
  assert.equal(isValidDishName('   '), false);
  assert.equal(isValidDishName(null), false);
  assert.equal(isValidDishName(42), false);
  // dish defaults (tuning round): at most 8 words and 70 characters
  assert.equal(isValidDishName('אחד שתיים שלוש ארבע חמש שש שבע שמונה'), true);
  assert.equal(isValidDishName('אחד שתיים שלוש ארבע חמש שש שבע שמונה תשע'), false);
  assert.equal(isValidDishName('אחד שתיים שלוש ארבע חמש שש שבע שמונה תשע', { maxWords: Infinity, maxChars: 200 }), true);
  assert.equal(isValidDishName('א'.repeat(70)), true);
  assert.equal(isValidDishName('א'.repeat(71)), false);
  assert.equal(isValidDishName('א'.repeat(200), { maxWords: Infinity, maxChars: 200 }), true);
  assert.equal(isValidDishName('א'.repeat(201), { maxWords: Infinity, maxChars: 200 }), false);
  assert.equal(isValidDishName('עוף\u0000אורז'), false);
  assert.equal(isValidDishName('עוף\nאורז'), false);
  assert.equal(isValidDishName('עוף\u007Fאורז'), false);
});

test('ensureHebrewDishName: clean name is ok, unchanged, with zero AI calls', async () => {
  const { fake, logs, log } = setup();
  const r = await ensureHebrewDishName(fake, 'עוף עם אורז', { log });
  assert.deepEqual(r, { name: 'עוף עם אורז', action: 'ok' });
  assert.equal(fake.calls.length, 0);
  assert.equal(logs.length, 0);
});

test('ensureHebrewDishName: legitimate punctuation and digits never trigger a repair call', async () => {
  const { fake, logs, log } = setup();
  for (const s of ['2 ביצים', 'קפה - נס', 'שווארמה 50%', 'עוף + אורז', 'קק״ל', 'סלט “ירוק” – גדול']) {
    const r = await ensureHebrewDishName(fake, s, { log });
    assert.deepEqual(r, { name: s, action: 'ok' }, s);
  }
  assert.equal(fake.calls.length, 0);
  assert.equal(logs.length, 0);
});

test('ensureHebrewDishName: foreign name with valid repair is repaired via exactly one call', async () => {
  const { fake, logs, log } = setup('פסטה ברוטב עגבניות');
  const r = await ensureHebrewDishName(fake, 'pasta pomodoro', { log });
  assert.deepEqual(r, { name: 'פסטה ברוטב עגבניות', action: 'repaired' });
  assert.equal(fake.calls.length, 1);
  const call = fake.calls[0];
  assert.equal(call.model, MODEL);
  assert.equal(call.temperature, 0);
  assert.equal(call.max_tokens, 40);
  assert.equal(call.system, REPAIR_SYSTEM_PROMPT);
  assert.deepEqual(call.messages, [{ role: 'user', content: 'pasta pomodoro' }]);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /repaired/);
  assert.match(logs[0], /pasta pomodoro/);
});

test('ensureHebrewDishName: repair reply uses first line, trimmed, quotes stripped', async () => {
  for (const reply of ['"שניצל"', '  שניצל  \nהסבר נוסף', '״שניצל״', '\'שניצל\'', '“שניצל”']) {
    const { fake, log } = setup(reply);
    const r = await ensureHebrewDishName(fake, 'schnitzel', { log });
    assert.deepEqual(r, { name: 'שניצל', action: 'repaired' }, reply);
  }
});

test('ensureHebrewDishName: a repair function may inspect the request', async () => {
  const { fake, log } = setup((req) => `${req.messages[0].content === 'sushi' ? 'סושי' : 'אחר'}`);
  const r = await ensureHebrewDishName(fake, 'sushi', { log });
  assert.deepEqual(r, { name: 'סושי', action: 'repaired' });
});

test('ensureHebrewDishName: invalid repair reply falls back to careful cleaning', async () => {
  const badReplies = ['chicken rice', '', '   ', 'אחד שתיים שלוש ארבע חמש שש שבע שמונה תשע עשר', 'עוף chicken'];
  for (const reply of badReplies) {
    const { fake, logs, log } = setup(reply);
    const r = await ensureHebrewDishName(fake, 'חזה עוף עם 米飯', { log });
    assert.deepEqual(r, { name: 'חזה עוף', action: 'cleaned' }, JSON.stringify(reply));
    assert.equal(fake.calls.length, 1);
    assert.equal(logs.length, 1);
    assert.match(logs[0], /cleaned/);
  }
});

test('ensureHebrewDishName: repaired name is validated before being returned', async () => {
  const { fake, log } = setup('א'.repeat(80));
  const r = await ensureHebrewDishName(fake, 'עוף chicken', { log });
  assert.deepEqual(r, { name: 'עוף', action: 'cleaned' });
});

test('ensureHebrewDishName: a failing repair call is treated like an invalid reply', async () => {
  for (const reply of [new Error('boom'), () => { throw new Error('boom'); }, () => ({ content: [] })]) {
    const { fake, logs, log } = setup(reply);
    const r = await ensureHebrewDishName(fake, 'עוף chicken', { log });
    assert.deepEqual(r, { name: 'עוף', action: 'cleaned' });
    assert.equal(logs.length, 1);
  }
});

test('ensureHebrewDishName: malformed repair response shapes are survived', async () => {
  for (const bad of [null, {}, { content: null }, { content: [{ text: 5 }] }]) {
    const anthropic = { messages: { async create() { return bad; } } };
    const logs = [];
    const r = await ensureHebrewDishName(anthropic, 'עוף chicken', { log: (l) => logs.push(l) });
    assert.deepEqual(r, { name: 'עוף', action: 'cleaned' });
    assert.equal(logs.length, 1);
  }
});

test('ensureHebrewDishName: all-foreign name with failing repair is the default name', async () => {
  const { fake, logs, log } = setup(new Error('down'));
  const r = await ensureHebrewDishName(fake, '米飯 rice', { log });
  assert.deepEqual(r, { name: DEFAULT_DISH_NAME, action: 'fallback' });
  assert.equal(logs.length, 1);
  assert.match(logs[0], /fallback/);
  assert.match(logs[0], /米飯 rice/);
});

test('ensureHebrewDishName: empty, non-string and punctuation-only input fall back', async () => {
  for (const input of ['!!! 123', '', '   ', null, undefined, 42, [], {}, '---', '100']) {
    const { fake, logs, log } = setup();
    const r = await ensureHebrewDishName(fake, input, { log });
    assert.deepEqual(r, { name: DEFAULT_DISH_NAME, action: 'fallback' }, String(input));
    assert.equal(fake.calls.length, 0, String(input));
    assert.equal(logs.length, 1, String(input));
  }
});

test('ensureHebrewDishName: log is called once per non-ok outcome and never for ok', async () => {
  const { fake, logs, log } = setup();
  await ensureHebrewDishName(fake, 'עוף', { log });
  assert.equal(logs.length, 0);
  await ensureHebrewDishName(fake, 'pasta', { log }); // repaired (default reply)
  assert.equal(logs.length, 1);
  assert.equal(typeof logs[0], 'string');
  assert.match(logs[0], /repaired/);
});

test('ensureHebrewDishName: log defaults to console.warn', async (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const { fake } = setup();
  await ensureHebrewDishName(fake, 'עוף', {});
  assert.equal(warn.mock.callCount(), 0);
  await ensureHebrewDishName(fake, null);
  assert.equal(warn.mock.callCount(), 1);
});

test('ensureHebrewDishName: a long clean name is shortened, never replaced by the default (R-C)', async () => {
  const { fake, logs, log } = setup();
  const nine = 'אחד שתיים שלוש ארבע חמש שש שבע שמונה תשע';
  const r = await ensureHebrewDishName(fake, nine, { maxWords: 6, log });
  assert.deepEqual(r, { name: 'אחד שתיים שלוש ארבע חמש שש', action: 'cleaned' });
  assert.equal(fake.calls.length, 0);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /cleaned/);
});

test('ensureHebrewDishName: shortening drops a dangling connector at the cut', async () => {
  const { fake, log } = setup();
  const r = await ensureHebrewDishName(fake, 'אחד שתיים שלוש ארבע חמש עם שבע שמונה', { maxWords: 6, log });
  assert.deepEqual(r, { name: 'אחד שתיים שלוש ארבע חמש', action: 'cleaned' });
  assert.equal(fake.calls.length, 0);
});

test('ensureHebrewDishName: shortening by characters cuts at a word boundary', async () => {
  const { fake, log } = setup();
  const r = await ensureHebrewDishName(fake, 'אבגדה ואבגדה זחטיכ', { maxWords: 6, maxChars: 14, log });
  assert.deepEqual(r, { name: 'אבגדה ואבגדה', action: 'cleaned' });
  assert.equal(fake.calls.length, 0);
});

test('ensureHebrewDishName: a single over-long word is cut to maxChars', async () => {
  const { fake, log } = setup();
  const r = await ensureHebrewDishName(fake, 'א'.repeat(90), { log });
  assert.deepEqual(r, { name: 'א'.repeat(70), action: 'cleaned' });
});

test('ensureHebrewDishName: long names pass with relaxed limits', async () => {
  const { fake, logs, log } = setup();
  const seven = 'אחד שתיים שלוש ארבע חמש שש שבע';
  const r = await ensureHebrewDishName(fake, seven, { maxWords: Infinity, maxChars: 200, log });
  assert.deepEqual(r, { name: seven, action: 'ok' });
  assert.equal(logs.length, 0);
});

test('ensureHebrewDishName: a foreign name too long after cleaning is shortened', async () => {
  const { fake, log } = setup(new Error('down'));
  const r = await ensureHebrewDishName(fake, 'אחד שתיים שלוש ארבע חמש שש שבע שמונה תשע chicken', { log });
  assert.deepEqual(r, { name: 'אחד שתיים שלוש ארבע חמש שש שבע שמונה', action: 'cleaned' });
});

// ─── default dish limits: 8 words, 70 characters (tuning round) ──────────────
test('ensureHebrewDishName defaults: a clean 8-word name is ok, unchanged, with no call and no log', async () => {
  const { fake, logs, log } = setup();
  const eight = 'אחד שתיים שלוש ארבע חמש שש שבע שמונה';
  assert.deepEqual(await ensureHebrewDishName(fake, eight, { log }), { name: eight, action: 'ok' });
  assert.deepEqual([fake.calls.length, logs.length], [0, 0]);
});

test('ensureHebrewDishName defaults: a 9-word name is shortened to 8 at a word boundary', async () => {
  const { fake, logs, log } = setup();
  const r = await ensureHebrewDishName(fake, 'אחד שתיים שלוש ארבע חמש שש שבע שמונה תשע', { log });
  assert.deepEqual(r, { name: 'אחד שתיים שלוש ארבע חמש שש שבע שמונה', action: 'cleaned' });
  assert.equal(fake.calls.length, 0);
  assert.equal(logs.length, 1);
});

test('ensureHebrewDishName defaults: a connector left dangling by the 8-word cut is trimmed', async () => {
  const { fake, log } = setup();
  const r = await ensureHebrewDishName(fake, 'אחד שתיים שלוש ארבע חמש שש שבע עם תשע', { log });
  assert.deepEqual(r, { name: 'אחד שתיים שלוש ארבע חמש שש שבע', action: 'cleaned' });
  assert.equal(fake.calls.length, 0);
});

test('ensureHebrewDishName defaults: 70 characters are ok, 71 are cut at a word boundary', async () => {
  const { fake, log } = setup();
  const seventy = `${'א'.repeat(34)} ${'ב'.repeat(35)}`;
  assert.equal(seventy.length, 70);
  assert.deepEqual(await ensureHebrewDishName(fake, seventy, { log }), { name: seventy, action: 'ok' });
  const seventyOne = `${'א'.repeat(35)} ${'ב'.repeat(35)}`;
  assert.deepEqual(await ensureHebrewDishName(fake, seventyOne, { log }), { name: 'א'.repeat(35), action: 'cleaned' });
  assert.equal(fake.calls.length, 0);
});

// ---- fix round 1 ----
// Invisible characters are built from code points so the source stays readable.
const ch = (n) => String.fromCharCode(n);
const INVISIBLE = { BOM: ch(0xFEFF), NBSP: ch(0xA0), LS: ch(0x2028), PS: ch(0x2029), HAIR: ch(0x200A), IDEO: ch(0x3000), ZWSP: ch(0x200B) };
const RAW_SEPARATORS = new RegExp('[\n\r' + ch(0x2028) + ch(0x2029) + ']');

test('findForeignScript: every non-ASCII space or invisible character is foreign', () => {
  for (const [label, c] of Object.entries(INVISIBLE)) {
    assert.equal(findForeignScript(`עוף${c}אורז`), true, label);
    assert.equal(findForeignScript(`${c}עוף`), true, `${label} leading`);
  }
  assert.equal(findForeignScript('עוף אורז'), false);
  assert.equal(findForeignScript('עוף\tאורז'), false);
});

test('ensureHebrewDishName: invisible characters are never ok (repaired by default reply)', async () => {
  for (const [label, c] of Object.entries(INVISIBLE)) {
    for (const input of [`עוף${c}אורז`, `${c}עוף אורז`]) {
      const { fake, logs, log } = setup();
      const r = await ensureHebrewDishName(fake, input, { log });
      assert.notEqual(r.action, 'ok', label);
      assert.equal(r.action, 'repaired', label);
      assert.equal(fake.calls.length, 1, label);
      assert.equal(logs.length, 1, label);
    }
  }
});

test('ensureHebrewDishName: invisible character with failing repair is cleaned (whole word dropped) or fallback', async () => {
  const { fake, log } = setup(new Error('down'));
  assert.deepEqual(await ensureHebrewDishName(fake, `חזה עוף ${INVISIBLE.BOM} אורז`, { log }), { name: 'חזה עוף אורז', action: 'cleaned' });
  assert.deepEqual(await ensureHebrewDishName(fake, `עוף${INVISIBLE.NBSP}אורז`, { log }), { name: DEFAULT_DISH_NAME, action: 'fallback' });
});

test('ensureHebrewDishName: padded or double-spaced names are normalised as cleaned, no AI call', async () => {
  const { fake, logs, log } = setup();
  assert.deepEqual(await ensureHebrewDishName(fake, '  עוף  ', { log }), { name: 'עוף', action: 'cleaned' });
  assert.deepEqual(await ensureHebrewDishName(fake, 'עוף  עם   אורז', { log }), { name: 'עוף עם אורז', action: 'cleaned' });
  assert.deepEqual(await ensureHebrewDishName(fake, 'עוף\nאורז', { log }), { name: 'עוף אורז', action: 'cleaned' });
  assert.equal(fake.calls.length, 0);
  assert.equal(logs.length, 3);
});

test('ensureHebrewDishName: emoji-only foreign names go to the repair call', async () => {
  let ctx = setup();
  assert.deepEqual(await ensureHebrewDishName(ctx.fake, '🍗', { log: ctx.log }), { name: 'סלט', action: 'repaired' });
  assert.equal(ctx.fake.calls.length, 1);
  for (const bad of [new Error('down'), 'garbage reply', '']) {
    ctx = setup(bad);
    assert.deepEqual(await ensureHebrewDishName(ctx.fake, '🍗', { log: ctx.log }), { name: DEFAULT_DISH_NAME, action: 'fallback' });
    assert.equal(ctx.fake.calls.length, 1);
    assert.equal(ctx.logs.length, 1);
  }
});

test('ensureHebrewDishName: names with no Hebrew letter and nothing recoverable fall back without a call', async () => {
  // "!!! 123" contains "!" (foreign) but no letter and no emoji, so there is nothing for the AI to rewrite.
  for (const input of ['100', '---', '123 456', '( )', '!!! 123']) {
    const { fake, logs, log } = setup();
    assert.deepEqual(await ensureHebrewDishName(fake, input, { log }), { name: DEFAULT_DISH_NAME, action: 'fallback' }, input);
    assert.equal(fake.calls.length, 0, input);
    assert.equal(logs.length, 1, input);
  }
});

test('requireHebrewLetter:false lets a letterless name through (R-D)', async () => {
  assert.equal(isValidDishName('100'), false);
  assert.equal(isValidDishName('100', { requireHebrewLetter: false }), true);
  assert.equal(isValidDishName('', { requireHebrewLetter: false }), false);
  const { fake, logs, log } = setup();
  assert.deepEqual(await ensureHebrewDishName(fake, '100', { requireHebrewLetter: false, log }), { name: '100', action: 'ok' });
  assert.deepEqual(await ensureHebrewDishName(fake, '100', { log }), { name: DEFAULT_DISH_NAME, action: 'fallback' });
  assert.equal(fake.calls.length, 0);
  assert.equal(logs.length, 1);
});

test('very long input is handled in linear time and returns a valid result', async () => {
  const inputs = ['!'.repeat(100000), '-'.repeat(100000), ' -'.repeat(50000), 'א'.repeat(100000), '( '.repeat(50000) + 'עוף', 'עם '.repeat(40000)];
  for (const input of inputs) {
    const { fake, logs, log } = setup(new Error('down'));
    const t0 = process.hrtime.bigint();
    const r = await ensureHebrewDishName(fake, input, { log });
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    assert.ok(ms < 500, `took ${ms} ms for ${input.slice(0, 6)}`);
    assert.ok(r.name === DEFAULT_DISH_NAME || isValidDishName(r.name), r.name);
    assert.notEqual(r.action, 'ok');
    assert.equal(logs.length, 1);
  }
  const t0 = process.hrtime.bigint();
  cleanDishName('- '.repeat(100000));
  assert.ok(Number(process.hrtime.bigint() - t0) / 1e6 < 500);
});

test('repair reply is edge-trimmed like cleanDishName before validation', async () => {
  for (const [reply, expected] of [['- עוף', 'עוף'], ['עוף עם', 'עוף'], ['  עם  עוף  עם  ', 'עוף'], ['עוף   אורז', 'עוף אורז'], ['"עוף אורז".', 'עוף אורז']]) {
    const { fake, log } = setup(reply);
    assert.deepEqual(await ensureHebrewDishName(fake, 'chicken', { log }), { name: expected, action: 'repaired' }, reply);
  }
  for (const reply of ['עם', '- -', '.', '"" ""']) {
    const { fake, log } = setup(reply);
    assert.deepEqual(await ensureHebrewDishName(fake, 'chicken', { log }), { name: DEFAULT_DISH_NAME, action: 'fallback' }, reply);
  }
});

test('log line truncates the original name and never contains raw line or paragraph separators', async () => {
  let ctx = setup(new Error('down'));
  await ensureHebrewDishName(ctx.fake, 'x'.repeat(300), { log: ctx.log });
  assert.equal(ctx.logs.length, 1);
  assert.ok(ctx.logs[0].length < 140, String(ctx.logs[0].length));
  assert.match(ctx.logs[0], /fallback/);

  ctx = setup(new Error('down'));
  const weird = `עוף\nאורז${INVISIBLE.LS}x${INVISIBLE.PS}y\r\tz`;
  await ensureHebrewDishName(ctx.fake, weird, { log: ctx.log });
  assert.equal(ctx.logs.length, 1);
  assert.ok(!RAW_SEPARATORS.test(ctx.logs[0]));
  assert.ok(ctx.logs[0].includes(ch(92) + 'u2028'));

  ctx = setup();
  await ensureHebrewDishName(ctx.fake, undefined, { log: ctx.log });
  assert.equal(ctx.logs.length, 1);
});

test('input is capped at 500 characters and a truncated name is never ok', async () => {
  const { fake, log } = setup();
  const long = 'א'.repeat(1000);
  const r = await ensureHebrewDishName(fake, long, { maxWords: Infinity, maxChars: 2000, log });
  assert.equal(r.action, 'cleaned');
  assert.equal(r.name.length, 500);
  assert.equal(fake.calls.length, 0);
});

// ─── mode: 'userText' (Ruling R-I) ───────────────────────────────────────────
const USER_TEXT = { mode: 'userText', maxWords: Infinity, maxChars: 200, requireHebrewLetter: false };

test('userText prompt starts with the shared prefix, tells the AI to keep everything else and never to summarise', () => {
  assert.ok(REPAIR_TEXT_SYSTEM_PROMPT.startsWith(REPAIR_PROMPT_PREFIX));
  assert.match(REPAIR_TEXT_SYSTEM_PROMPT, /Do not shorten, summarise/);
  assert.ok(!/six words/.test(REPAIR_TEXT_SYSTEM_PROMPT));
});

test("default mode is 'dish': punctuation still triggers a repair there, but not in userText", async () => {
  const dish = setup('אורז עם עוף');
  const r1 = await ensureHebrewDishName(dish.fake, 'אורז עם עוף!', { log: dish.log });
  assert.deepEqual([r1.name, r1.action, dish.fake.calls.length], ['אורז עם עוף', 'repaired', 1]);
  const text = setup();
  const r2 = await ensureHebrewDishName(text.fake, 'אורז עם עוף!', { ...USER_TEXT, log: text.log });
  assert.deepEqual([r2, text.fake.calls.length, text.logs.length], [{ name: 'אורז עם עוף!', action: 'ok' }, 0, 0]);
});

test('userText: emoji, symbols, digits and normalised whitespace are ok with no call and no log', async () => {
  for (const [typed, shown] of [['🍗', '🍗'], ['100', '100'], ['ארוחה 25₪', 'ארוחה 25₪'], ['  סלט \t\n ולחם  ', 'סלט ולחם'], ['סלט　ולחם', 'סלט ולחם'], ['👨‍🍳', '👨‍🍳']]) {
    const { fake, logs, log } = setup();
    assert.deepEqual(await ensureHebrewDishName(fake, typed, { ...USER_TEXT, log }), { name: shown, action: 'ok' }, JSON.stringify(typed));
    assert.deepEqual([fake.calls.length, logs.length], [0, 0]);
  }
});

test('userText: a lone zero-width joiner, bidi marks, a BOM and a lone surrogate are never ok', async () => {
  for (const typed of ['סלט‍ולחם', 'סלט\u202Bולחם', '﻿סלט', 'סלט\uD800ולחם', 'סלט\u0000ולחם']) {
    const { fake, logs, log } = setup();
    const r = await ensureHebrewDishName(fake, typed, { ...USER_TEXT, log });
    assert.equal(r.action, 'cleaned', JSON.stringify(typed));
    assert.ok(!/[\u0000-\u001F​-\u200F\u202A-\u202E﻿\uD800-\uDFFF]/.test(r.name), JSON.stringify(typed));
    assert.equal(fake.calls.length, 0);
    assert.equal(logs.length, 1);
  }
});

test('userText: cleaning removes only the words with foreign letters and keeps punctuation and emoji', async () => {
  const { fake, log } = setup(new Error('down'));
  assert.deepEqual(await ensureHebrewDishName(fake, 'אורז 🍗 pasta, עם עוף!', { ...USER_TEXT, log }), { name: 'אורז 🍗 עם עוף!', action: 'cleaned' });
  assert.deepEqual(await ensureHebrewDishName(fake, 'סלט עם pasta', { ...USER_TEXT, log }), { name: 'סלט', action: 'cleaned' });
  assert.deepEqual(await ensureHebrewDishName(fake, 'pasta', { ...USER_TEXT, log }), { name: DEFAULT_DISH_NAME, action: 'fallback' });
});

test('userText: a repair that drops a word is refused, a faithful one is accepted', async () => {
  const dropped = setup('סלט');
  assert.equal((await ensureHebrewDishName(dropped.fake, 'סלט ולחם pasta', { ...USER_TEXT, log: dropped.log })).action, 'cleaned');
  const faithful = setup('סלט ולחם פסטה');
  assert.deepEqual(await ensureHebrewDishName(faithful.fake, 'סלט ולחם pasta', { ...USER_TEXT, log: faithful.log }), { name: 'סלט ולחם פסטה', action: 'repaired' });
  const tooLong = setup('סלט ולחם ' + 'פסטה '.repeat(60));
  assert.equal((await ensureHebrewDishName(tooLong.fake, 'סלט ולחם pasta', { ...USER_TEXT, log: tooLong.log })).action, 'cleaned');
});
