'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  REPAIR_SYSTEM_PROMPT, REPAIR_PROMPT_PREFIX, DEFAULT_DISH_NAME,
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
  assert.equal(isValidDishName('אחד שתיים שלוש ארבע חמש שש'), true);
  assert.equal(isValidDishName('אחד שתיים שלוש ארבע חמש שש שבע'), false);
  assert.equal(isValidDishName('אחד שתיים שלוש ארבע חמש שש שבע', { maxWords: Infinity, maxChars: 200 }), true);
  assert.equal(isValidDishName('א'.repeat(60)), true);
  assert.equal(isValidDishName('א'.repeat(61)), false);
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
  for (const input of ['!!! 123', '', '   ', null, undefined, 42, [], {}, '---', '🍗']) {
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
  assert.deepEqual(r, { name: 'א'.repeat(60), action: 'cleaned' });
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
  const r = await ensureHebrewDishName(fake, 'אחד שתיים שלוש ארבע חמש שש שבע chicken', { log });
  assert.deepEqual(r, { name: 'אחד שתיים שלוש ארבע חמש שש', action: 'cleaned' });
});
