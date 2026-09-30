'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { buildTestApp, signedIn, csrfHeaders, PASSWORD } = require('../helpers/app');

let ctx;
let c;
before(async () => {
  ctx = await buildTestApp({ limits: { analyzePerHour: 100000 } });
  c = await signedIn(ctx.app, 'validator');
});
after(async () => { await ctx.pool.end(); });

const entry = (extra = {}) => ({ meal_type: 'lunch', food_name: 'Salad', calories: 100, protein_g: 1, carbs_g: 2, fat_g: 3, fiber_g: 4, ...extra });
const without = (obj, key) => { const { [key]: _omit, ...rest } = obj; return rest; };
const NOT_AN_IMAGE = Buffer.from('this is definitely not an image').toString('base64');
const VALIDATION = { code: 'VALIDATION' };

// Every row must answer with the exact status and code; a 500 can never match any row.
// `send` builds the request from the signed-in client; `raw` sends a JSON string as-is.
const authed = (method, path, body) => () => c[method](path, body);
const rawAuthed = (method, path, raw) => () => c[method](path, raw).type('json');
// No session cookie, but the CSRF headers the real client sends (CSRF itself is tested in csrf.test.js).
const anonReq = (method, path) => request(ctx.app)[method](path).set(csrfHeaders(ctx.config));
const anon = (method, path, body) => () => (body === undefined ? anonReq(method, path) : anonReq(method, path).send(body));
const rawAnon = (method, path, raw) => () => anonReq(method, path).type('json').send(raw);

const CASES = [
  // ── food POST ────────────────────────────────────────────────────────────
  ['food POST: logged_at not a date', authed('post', '/api/food', entry({ logged_at: 'yesterday' })), 400, VALIDATION, { logged_at: 'INVALID' }],
  ['food POST: logged_at 2026-02-31T10:00', authed('post', '/api/food', entry({ logged_at: '2026-02-31T10:00' })), 400, VALIDATION, { logged_at: 'INVALID' }],
  ['food POST: logged_at hour 24', authed('post', '/api/food', entry({ logged_at: '2026-01-01T24:00' })), 400, VALIDATION, { logged_at: 'INVALID' }],
  ['food POST: logged_at date only', authed('post', '/api/food', entry({ logged_at: '2026-01-01' })), 400, VALIDATION, { logged_at: 'INVALID' }],
  ['food POST: logged_at a number', authed('post', '/api/food', entry({ logged_at: 20260101 })), 400, VALIDATION, { logged_at: 'INVALID' }],
  ['food POST: meal_type missing', authed('post', '/api/food', without(entry(), 'meal_type')), 400, VALIDATION, { meal_type: 'REQUIRED' }],
  ['food POST: meal_type unknown', authed('post', '/api/food', entry({ meal_type: 'brunch' })), 400, VALIDATION, { meal_type: 'INVALID' }],
  ['food POST: meal_type a number', authed('post', '/api/food', entry({ meal_type: 5 })), 400, VALIDATION, { meal_type: 'INVALID' }],
  ['food POST: negative calories', authed('post', '/api/food', entry({ calories: -1 })), 400, VALIDATION, { calories: 'INVALID' }],
  ['food POST: calories over range', authed('post', '/api/food', entry({ calories: 100000 })), 400, VALIDATION, { calories: 'INVALID' }],
  ['food POST: protein over range', authed('post', '/api/food', entry({ protein_g: 10000 })), 400, VALIDATION, { protein_g: 'INVALID' }],
  ['food POST: carbs negative', authed('post', '/api/food', entry({ carbs_g: -0.1 })), 400, VALIDATION, { carbs_g: 'INVALID' }],
  ['food POST: fat over range', authed('post', '/api/food', entry({ fat_g: 1e9 })), 400, VALIDATION, { fat_g: 'INVALID' }],
  ['food POST: fiber non-numeric string', authed('post', '/api/food', entry({ fiber_g: 'lots' })), 400, VALIDATION, { fiber_g: 'INVALID' }],
  ['food POST: numeric string with junk', authed('post', '/api/food', entry({ calories: '12abc' })), 400, VALIDATION, { calories: 'INVALID' }],
  ['food POST: number as object', authed('post', '/api/food', entry({ calories: { a: 1 } })), 400, VALIDATION, { calories: 'INVALID' }],
  ['food POST: number as array', authed('post', '/api/food', entry({ protein_g: [5] })), 400, VALIDATION, { protein_g: 'INVALID' }],
  ['food POST: number as boolean', authed('post', '/api/food', entry({ carbs_g: true })), 400, VALIDATION, { carbs_g: 'INVALID' }],
  ['food POST: over-range numeric string', authed('post', '/api/food', entry({ calories: '100000' })), 400, VALIDATION, { calories: 'INVALID' }],
  ['food POST: food_name 201 chars', authed('post', '/api/food', entry({ food_name: 'a'.repeat(201) })), 400, VALIDATION, { food_name: 'TOO_LONG' }],
  ['food POST: food_name with NUL', authed('post', '/api/food', entry({ food_name: 'a\u0000b' })), 400, VALIDATION, { food_name: 'INVALID' }],
  ['food POST: food_name missing', authed('post', '/api/food', without(entry(), 'food_name')), 400, VALIDATION, { food_name: 'REQUIRED' }],
  ['food POST: food_name blank', authed('post', '/api/food', entry({ food_name: '   ' })), 400, VALIDATION, { food_name: 'REQUIRED' }],
  ['food POST: food_name a number', authed('post', '/api/food', entry({ food_name: 123 })), 400, VALIDATION, { food_name: 'INVALID' }],
  ['food POST: notes with NUL', authed('post', '/api/food', entry({ notes: 'a\u0000b' })), 400, VALIDATION, { notes: 'INVALID' }],
  ['food POST: notes a number', authed('post', '/api/food', entry({ notes: 5 })), 400, VALIDATION, { notes: 'INVALID' }],
  ['food POST: several bad fields are all reported', authed('post', '/api/food', entry({ meal_type: 'x', calories: -5, food_name: '' })), 400, VALIDATION,
    { meal_type: 'INVALID', calories: 'INVALID', food_name: 'REQUIRED' }],
  ['food POST: empty body', authed('post', '/api/food', {}), 400, VALIDATION, { meal_type: 'REQUIRED', food_name: 'REQUIRED' }],
  ['food POST: array body', authed('post', '/api/food', []), 400, VALIDATION, { _: 'INVALID' }],
  ['food POST: JSON null body', rawAuthed('post', '/api/food', 'null'), 400, VALIDATION, undefined],
  ['food POST: JSON string body', rawAuthed('post', '/api/food', '"str"'), 400, VALIDATION, undefined],

  // ── food PUT ─────────────────────────────────────────────────────────────
  ['food PUT: logged_at 2026-02-31T10:00', authed('put', '/api/food/1', entry({ logged_at: '2026-02-31T10:00' })), 400, VALIDATION, { logged_at: 'INVALID' }],
  ['food PUT: meal_type missing', authed('put', '/api/food/1', without(entry(), 'meal_type')), 400, VALIDATION, { meal_type: 'REQUIRED' }],
  ['food PUT: meal_type unknown', authed('put', '/api/food/1', entry({ meal_type: 'lunchh' })), 400, VALIDATION, { meal_type: 'INVALID' }],
  ['food PUT: negative calories', authed('put', '/api/food/1', entry({ calories: -1 })), 400, VALIDATION, { calories: 'INVALID' }],
  ['food PUT: fat over range', authed('put', '/api/food/1', entry({ fat_g: 10000 })), 400, VALIDATION, { fat_g: 'INVALID' }],
  ['food PUT: food_name 201 chars', authed('put', '/api/food/1', entry({ food_name: 'a'.repeat(201) })), 400, VALIDATION, { food_name: 'TOO_LONG' }],
  ['food PUT: food_name with NUL', authed('put', '/api/food/1', entry({ food_name: 'a\u0000b' })), 400, VALIDATION, { food_name: 'INVALID' }],
  ['food PUT: food_name blank', authed('put', '/api/food/1', entry({ food_name: '  ' })), 400, VALIDATION, { food_name: 'REQUIRED' }],
  ['food PUT: notes with NUL', authed('put', '/api/food/1', entry({ notes: 'a\u0000' })), 400, VALIDATION, { notes: 'INVALID' }],
  ['food PUT: bad id and bad body report both', authed('put', '/api/food/abc', entry({ meal_type: 'x' })), 400, VALIDATION, { id: 'INVALID', meal_type: 'INVALID' }],

  // ── :id params ───────────────────────────────────────────────────────────
  ...['abc', '0', '-1', '1.5', '99999999999', '1e3', '%20'].flatMap((id) => [
    [`food DELETE id ${id}`, authed('delete', `/api/food/${id}`), 400, VALIDATION, { id: 'INVALID' }],
    [`food PUT id ${id}`, authed('put', `/api/food/${id}`, entry()), 400, VALIDATION, { id: 'INVALID' }],
    [`weight DELETE id ${id}`, authed('delete', `/api/weight/${id}`), 400, VALIDATION, { id: 'INVALID' }],
  ]),

  // Malformed percent-encoding fails inside Express routing (before auth/validate): still 400, never 500.
  ...['/api/food/%E0', '/api/food/%E0%A4%A', '/api/weight/%ZZ'].flatMap((path) => [
    [`DELETE ${path} (authenticated)`, authed('delete', path), 400, VALIDATION, undefined],
    [`DELETE ${path} (no credentials)`, anon('delete', path), 400, VALIDATION, undefined],
  ]),
  ['food PUT bad percent-encoding (authenticated)', authed('put', '/api/food/%E0', entry()), 400, VALIDATION, undefined],

  // ── GET query strings ────────────────────────────────────────────────────
  ['food GET: date 2026-02-31', authed('get', '/api/food?date=2026-02-31'), 400, VALIDATION, { date: 'INVALID' }],
  ['food GET: date abc', authed('get', '/api/food?date=abc'), 400, VALIDATION, { date: 'INVALID' }],
  ['food GET: date 2026-1-1', authed('get', '/api/food?date=2026-1-1'), 400, VALIDATION, { date: 'INVALID' }],
  ['food GET: date given twice', authed('get', '/api/food?date=2026-01-01&date=2026-01-02'), 400, VALIDATION, { date: 'INVALID' }],
  ['food GET: date as object', authed('get', '/api/food?date[x]=1'), 400, VALIDATION, { date: 'INVALID' }],
  ['food GET: date year 0000', authed('get', '/api/food?date=0000-01-01'), 400, VALIDATION, { date: 'INVALID' }],
  ['stats weekly: start 2026-13-01', authed('get', '/api/stats/weekly?start=2026-13-01'), 400, VALIDATION, { start: 'INVALID' }],
  ['stats weekly: start junk', authed('get', '/api/stats/weekly?start=yesterday'), 400, VALIDATION, { start: 'INVALID' }],
  ['stats monthly: month 2026-13', authed('get', '/api/stats/monthly?month=2026-13'), 400, VALIDATION, { month: 'INVALID' }],
  ['stats monthly: month 2026-1', authed('get', '/api/stats/monthly?month=2026-1'), 400, VALIDATION, { month: 'INVALID' }],
  ['stats monthly: month is a full date', authed('get', '/api/stats/monthly?month=2026-02-01'), 400, VALIDATION, { month: 'INVALID' }],
  ['stats monthly: month 0000-01', authed('get', '/api/stats/monthly?month=0000-01'), 400, VALIDATION, { month: 'INVALID' }],
  ['stats yearly: year 1999', authed('get', '/api/stats/yearly?year=1999'), 400, VALIDATION, { year: 'INVALID' }],
  ['stats yearly: year 2101', authed('get', '/api/stats/yearly?year=2101'), 400, VALIDATION, { year: 'INVALID' }],
  ['stats yearly: year abcd', authed('get', '/api/stats/yearly?year=abcd'), 400, VALIDATION, { year: 'INVALID' }],
  ['stats yearly: year 26', authed('get', '/api/stats/yearly?year=26'), 400, VALIDATION, { year: 'INVALID' }],
  ['stats yearly: year 99999999999', authed('get', '/api/stats/yearly?year=99999999999'), 400, VALIDATION, { year: 'INVALID' }],

  // ── weight POST ──────────────────────────────────────────────────────────
  ['weight POST: 19.9 kg', authed('post', '/api/weight', { weight_kg: 19.9 }), 400, VALIDATION, { weight_kg: 'INVALID' }],
  ['weight POST: 500.1 kg', authed('post', '/api/weight', { weight_kg: 500.1 }), 400, VALIDATION, { weight_kg: 'INVALID' }],
  ['weight POST: "x"', authed('post', '/api/weight', { weight_kg: 'x' }), 400, VALIDATION, { weight_kg: 'INVALID' }],
  ['weight POST: 0', authed('post', '/api/weight', { weight_kg: 0 }), 400, VALIDATION, { weight_kg: 'INVALID' }],
  ['weight POST: null', authed('post', '/api/weight', { weight_kg: null }), 400, VALIDATION, { weight_kg: 'INVALID' }],
  ['weight POST: missing', authed('post', '/api/weight', {}), 400, VALIDATION, { weight_kg: 'REQUIRED' }],
  ['weight POST: bad logged_at', authed('post', '/api/weight', { weight_kg: 70, logged_at: '2026-02-31' }), 400, VALIDATION, { logged_at: 'INVALID' }],
  ['weight POST: logged_at is a timestamp', authed('post', '/api/weight', { weight_kg: 70, logged_at: '2026-01-01T10:00' }), 400, VALIDATION, { logged_at: 'INVALID' }],
  ['weight POST: logged_at a number', authed('post', '/api/weight', { weight_kg: 70, logged_at: 5 }), 400, VALIDATION, { logged_at: 'INVALID' }],
  ['weight POST: logged_at garbage', authed('post', '/api/weight', { weight_kg: 70, logged_at: 'not a date' }), 400, VALIDATION, { logged_at: 'INVALID' }],

  // ── analyze ──────────────────────────────────────────────────────────────
  ['analyze-text: 501 chars', authed('post', '/api/analyze-text', { text: 'a'.repeat(501) }), 400, VALIDATION, { text: 'TOO_LONG' }],
  ['analyze-text: a number', authed('post', '/api/analyze-text', { text: 12345 }), 400, VALIDATION, { text: 'INVALID' }],
  ['analyze-text: blank', authed('post', '/api/analyze-text', { text: '   ' }), 400, VALIDATION, { text: 'REQUIRED' }],
  ['analyze-text: missing', authed('post', '/api/analyze-text', {}), 400, VALIDATION, { text: 'REQUIRED' }],
  ['analyze-text: NUL', authed('post', '/api/analyze-text', { text: 'a\u0000b' }), 400, VALIDATION, { text: 'INVALID' }],
  ['analyze-text: array', authed('post', '/api/analyze-text', { text: ['a'] }), 400, VALIDATION, { text: 'INVALID' }],
  ['analyze: missing image', authed('post', '/api/analyze', {}), 400, VALIDATION, { imageBase64: 'REQUIRED' }],
  ['analyze: empty image', authed('post', '/api/analyze', { imageBase64: '' }), 400, VALIDATION, { imageBase64: 'REQUIRED' }],
  ['analyze: image a number', authed('post', '/api/analyze', { imageBase64: 5 }), 400, VALIDATION, { imageBase64: 'INVALID' }],
  ['analyze: image is not an image', authed('post', '/api/analyze', { imageBase64: NOT_AN_IMAGE, mimeType: 'image/jpeg' }), 400, { code: 'IMAGE_INVALID' }, undefined],
  ['analyze: mimeType of the wrong type is ignored, image still checked', authed('post', '/api/analyze', { imageBase64: NOT_AN_IMAGE, mimeType: { x: 1 } }), 400, { code: 'IMAGE_INVALID' }, undefined],

  // ── auth: register ───────────────────────────────────────────────────────
  ['register: password a number', anon('post', '/auth/register', { username: 'abc', password: 12345 }), 400, VALIDATION, { password: 'INVALID' }],
  ['register: username an array', anon('post', '/auth/register', { username: ['x'], password: PASSWORD }), 400, VALIDATION, { username: 'INVALID' }],
  ['register: JSON null body', rawAnon('post', '/auth/register', 'null'), 400, VALIDATION, undefined],
  ['register: JSON string body', rawAnon('post', '/auth/register', '"str"'), 400, VALIDATION, undefined],
  ['register: array body', anon('post', '/auth/register', []), 400, VALIDATION, { _: 'INVALID' }],
  ['register: no body', anon('post', '/auth/register'), 400, VALIDATION, { username: 'REQUIRED', password: 'REQUIRED' }],
  ['register: username with NUL', anon('post', '/auth/register', { username: 'a\u0000b', password: PASSWORD }), 400, VALIDATION, { username: 'INVALID' }],
  ['register: password with NUL', anon('post', '/auth/register', { username: 'abc', password: 'a\u0000bcdefgh' }), 400, VALIDATION, { password: 'INVALID' }],
  ['register: username too short', anon('post', '/auth/register', { username: 'ab', password: PASSWORD }), 400, VALIDATION, { username: 'INVALID' }],
  ['register: username only spaces', anon('post', '/auth/register', { username: '     ', password: PASSWORD }), 400, VALIDATION, { username: 'INVALID' }],
  ['register: username 51 chars', anon('post', '/auth/register', { username: 'a'.repeat(51), password: PASSWORD }), 400, VALIDATION, { username: 'TOO_LONG' }],
  ['register: password too short', anon('post', '/auth/register', { username: 'abc', password: 'abcdefg' }), 400, { code: 'WEAK_PASSWORD' }, undefined],
  ['register: password 1025 chars', anon('post', '/auth/register', { username: 'abc', password: 'a'.repeat(1025) }), 400, VALIDATION, { password: 'TOO_LONG' }],
  ['register: password null', anon('post', '/auth/register', { username: 'abc', password: null }), 400, VALIDATION, { password: 'INVALID' }],

  // ── auth: login ──────────────────────────────────────────────────────────
  ['login: password a number', anon('post', '/auth/login', { username: 'abc', password: 12345 }), 400, VALIDATION, { password: 'INVALID' }],
  ['login: no password', anon('post', '/auth/login', { username: 'abc' }), 400, VALIDATION, { password: 'REQUIRED' }],
  ['login: empty password', anon('post', '/auth/login', { username: 'abc', password: '' }), 400, VALIDATION, { password: 'REQUIRED' }],
  ['login: username an array', anon('post', '/auth/login', { username: ['x'], password: PASSWORD }), 400, VALIDATION, { username: 'INVALID' }],
  ['login: username an object', anon('post', '/auth/login', { username: { $ne: null }, password: PASSWORD }), 400, VALIDATION, { username: 'INVALID' }],
  ['login: JSON null body', rawAnon('post', '/auth/login', 'null'), 400, VALIDATION, undefined],
  ['login: username with NUL', anon('post', '/auth/login', { username: 'a\u0000b', password: PASSWORD }), 400, VALIDATION, { username: 'INVALID' }],
  ['login: password with NUL', anon('post', '/auth/login', { username: 'abc', password: 'a\u0000b' }), 400, VALIDATION, { password: 'INVALID' }],
  ['login: username over 100 chars', anon('post', '/auth/login', { username: 'a'.repeat(101), password: PASSWORD }), 400, VALIDATION, { username: 'TOO_LONG' }],
  ['login: password over 1024 chars', anon('post', '/auth/login', { username: 'abc', password: 'a'.repeat(1025) }), 400, VALIDATION, { password: 'TOO_LONG' }],
  ['login: no body', anon('post', '/auth/login'), 400, VALIDATION, { username: 'REQUIRED', password: 'REQUIRED' }],

  // ── auth: change-password ────────────────────────────────────────────────
  ['change-password: currentPassword missing', authed('post', '/auth/change-password', { newPassword: 'brand-new-pw' }), 400, VALIDATION, { currentPassword: 'REQUIRED' }],
  ['change-password: newPassword too short', authed('post', '/auth/change-password', { currentPassword: PASSWORD, newPassword: 'abcdefg' }), 400, { code: 'WEAK_PASSWORD' }, undefined],
  ['change-password: newPassword missing', authed('post', '/auth/change-password', { currentPassword: PASSWORD }), 400, VALIDATION, { newPassword: 'REQUIRED' }],
  ['change-password: numbers', authed('post', '/auth/change-password', { currentPassword: 12345, newPassword: 123456 }), 400, VALIDATION, { currentPassword: 'INVALID', newPassword: 'INVALID' }],
  ['change-password: NUL', authed('post', '/auth/change-password', { currentPassword: PASSWORD, newPassword: 'abc\u0000defgh' }), 400, VALIDATION, { newPassword: 'INVALID' }],
  ['change-password: newPassword over 1024', authed('post', '/auth/change-password', { currentPassword: PASSWORD, newPassword: 'a'.repeat(1025) }), 400, VALIDATION, { newPassword: 'TOO_LONG' }],

  // ── profile ──────────────────────────────────────────────────────────────
  ['profile PUT: array body', authed('put', '/api/profile', []), 400, VALIDATION, { _: 'INVALID' }],
  ['profile PUT: string body', rawAuthed('put', '/api/profile', '"str"'), 400, VALIDATION, undefined],
  ['profile PUT: null body', rawAuthed('put', '/api/profile', 'null'), 400, VALIDATION, undefined],
  ['profile PUT: height a string', authed('put', '/api/profile', { height: 'tall' }), 400, VALIDATION, { height: 'INVALID' }],
  ['profile PUT: height absurd', authed('put', '/api/profile', { height: 1e9 }), 400, VALIDATION, { height: 'INVALID' }],
  ['profile PUT: weight negative', authed('put', '/api/profile', { weight: -5 }), 400, VALIDATION, { weight: 'INVALID' }],
  ['profile PUT: goalKg an object', authed('put', '/api/profile', { goalKg: { a: 1 } }), 400, VALIDATION, { goalKg: 'INVALID' }],
  ['profile PUT: birthDate not real', authed('put', '/api/profile', { birthDate: '2026-02-31' }), 400, VALIDATION, { birthDate: 'INVALID' }],
  ['profile PUT: gender a number', authed('put', '/api/profile', { gender: 5 }), 400, VALIDATION, { gender: 'INVALID' }],
  ['profile PUT: gender with NUL', authed('put', '/api/profile', { gender: 'a\u0000b' }), 400, VALIDATION, { gender: 'INVALID' }],
  ['profile PUT: activity an object', authed('put', '/api/profile', { activity: { a: 1 } }), 400, VALIDATION, { activity: 'INVALID' }],
  ['profile PUT: activity string too long', authed('put', '/api/profile', { activity: 'a'.repeat(500) }), 400, VALIDATION, { activity: 'TOO_LONG' }],

  // ── unauthenticated requests are refused before validation ──────────────
  ['food POST: no credentials and bad body', anon('post', '/api/food', { meal_type: 'x' }), 401, { code: 'UNAUTHORIZED' }, undefined],
  ['weight DELETE: no credentials and bad id', anon('delete', '/api/weight/abc'), 401, { code: 'UNAUTHORIZED' }, undefined],
  ['analyze: no credentials', anon('post', '/api/analyze', {}), 401, { code: 'UNAUTHORIZED' }, undefined],
  ['profile PUT: no credentials', anon('put', '/api/profile', []), 401, { code: 'UNAUTHORIZED' }, undefined],
];

for (const [name, send, status, error, fields] of CASES) {
  test(`rejects: ${name}`, async () => {
    const res = await send();
    assert.notEqual(res.status, 500, `500 leaked: ${JSON.stringify(res.body)}`);
    assert.equal(res.status, status, JSON.stringify(res.body));
    assert.deepEqual(res.body.error, error);
    assert.deepEqual(res.body.fields, fields);
    assert.deepEqual(Object.keys(res.body).filter((k) => k !== 'error' && k !== 'fields'), []);
  });
}

// ── inputs that used to be a 500 and are now handled ───────────────────────

test('fractional calories are rounded to an integer instead of causing a 500', async () => {
  const res = await c.post('/api/food', entry({ calories: 145.6, protein_g: 5.04 }));
  assert.equal(res.status, 200);
  assert.equal(res.body.calories, 146);
  assert.equal(Number(res.body.protein_g), 5);
  const low = await c.post('/api/food', entry({ calories: 0.4 }));
  assert.equal(low.status, 200);
  assert.equal(low.body.calories, 0);
});

test('numbers as numeric strings are still accepted; missing, null and empty store NULL', async () => {
  const res = await c.post('/api/food', entry({ calories: '250', protein_g: '12.34', carbs_g: '', fat_g: null }));
  assert.equal(res.status, 200);
  assert.equal(res.body.calories, 250);
  assert.equal(Number(res.body.protein_g), 12.3);
  assert.equal(res.body.carbs_g, null);
  assert.equal(res.body.fat_g, null);
  assert.equal(Number(res.body.fiber_g), 4);
  const bare = await c.post('/api/food', { meal_type: 'snack', food_name: 'Bare' });
  assert.equal(bare.status, 200);
  for (const k of ['calories', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g', 'notes']) assert.equal(bare.body[k], null, k);
});

test('range boundaries are accepted', async () => {
  const res = await c.post('/api/food', entry({ calories: 99999, protein_g: 9999, carbs_g: 0, fat_g: 9999, fiber_g: 0 }));
  assert.equal(res.status, 200);
  assert.equal(res.body.calories, 99999);
  const w1 = await c.post('/api/weight', { weight_kg: 20, logged_at: '2024-02-29' });
  const w2 = await c.post('/api/weight', { weight_kg: 500 });
  const w3 = await c.post('/api/weight', { weight_kg: '70.44', logged_at: null });
  assert.deepEqual([w1.status, w2.status, w3.status], [200, 200, 200]);
  assert.equal(Number(w3.body.weight_kg), 70.4);
});

test('valid logged_at forms are accepted and stored', async () => {
  for (const at of ['2024-02-29T10:00', '2024-03-01T10:00:00', '2024-03-01T10:00:00.123+02:00', '2024-03-01T18:00:00Z', '2024-03-01T18:00-05:30', null, '']) {
    const res = await c.post('/api/food', entry({ logged_at: at }));
    assert.equal(res.status, 200, String(at));
  }
  const edge = await c.post('/api/food', entry({ logged_at: '0001-01-01T00:00:00+15:00' }));
  assert.equal(edge.status, 200, 'extreme but valid timestamp must not reach PostgreSQL as an error');
  const edge2 = await c.post('/api/food', entry({ logged_at: '9999-12-31T23:59:59-15:59' }));
  assert.equal(edge2.status, 200);
});

test('food_name is trimmed on POST and PUT; PUT with valid data still works', async () => {
  const { body: row } = await c.post('/api/food', entry({ food_name: '  Soup  ' }));
  assert.equal(row.food_name, 'Soup');
  const res = await c.put(`/api/food/${row.id}`, entry({ food_name: ' Stew ', notes: null, logged_at: '' }));
  assert.equal(res.status, 200);
  assert.equal(res.body.food_name, 'Stew');
  assert.equal(res.body.notes, null);
});

test('GET with an empty date/start/month/year behaves as if omitted', async () => {
  for (const p of ['/api/food?date=', '/api/stats/weekly?start=', '/api/stats/monthly?month=', '/api/stats/yearly?year=']) {
    assert.equal((await c.get(p)).status, 200, p);
  }
});

test('GET with valid date, start, month and year works', async () => {
  for (const p of ['/api/food?date=2024-02-29', '/api/stats/weekly?start=2024-02-29', '/api/stats/monthly?month=2024-02', '/api/stats/yearly?year=2024']) {
    assert.equal((await c.get(p)).status, 200, p);
  }
});

test('profile: unknown keys are stripped; __proto__ keys neither pollute nor crash', async () => {
  const put = await c.put('/api/profile', '{"__proto__":{"x":1},"constructor":{"prototype":{"y":1}},"evil":1,"height":170}').type('json');
  assert.equal(put.status, 200);
  assert.equal(({}).x, undefined);
  assert.equal(({}).y, undefined);
  assert.equal(Object.prototype.x, undefined);
  const get = await c.get('/api/profile');
  assert.deepEqual(get.body, { height: 170 });
  const only = await c.put('/api/profile', '{"__proto__":{"x":1}}').type('json');
  assert.equal(only.status, 200);
  assert.equal(({}).x, undefined);
  assert.deepEqual((await c.get('/api/profile')).body, {});
});

test('profile: the values the client sends are accepted', async () => {
  const put = await c.put('/api/profile', { gender: 'male', birthDate: '1990-05-15', height: 175, weight: 70.5, activity: 'vactive', goalKg: -0.5 });
  assert.equal(put.status, 200);
  const empty = await c.put('/api/profile', { gender: 'female', birthDate: '', height: 0, weight: 0, activity: 'light', goalKg: 0 });
  assert.equal(empty.status, 200);
  assert.deepEqual((await c.get('/api/profile')).body, { gender: 'female', birthDate: '', height: 0, weight: 0, activity: 'light', goalKg: 0 });
});

// ── AI failures never leak upstream text (Review Focus 5) ──────────────────

async function withAnthropic(create, fn) {
  const original = ctx.anthropic.messages.create;
  ctx.anthropic.messages.create = create;
  const logged = [];
  const originalLog = console.error;
  console.error = (...a) => logged.push(a);
  try { await fn(); } finally {
    ctx.anthropic.messages.create = original;
    console.error = originalLog;
  }
  return logged;
}

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]).toString('base64');
const AI_CALLS = [
  ['image', () => c.post('/api/analyze', { imageBase64: JPEG })],
  ['text', () => c.post('/api/analyze-text', { text: 'סלט' })],
];
const AI_FAILURES = [
  ['non-JSON text', async () => ({ content: [{ type: 'text', text: 'SECRET-UPSTREAM sorry, I cannot help with that' }] })],
  ['JSON with no items', async () => ({ content: [{ type: 'text', text: '{"dish_name":"SECRET-UPSTREAM","items":[]}' }] })],
  ['broken JSON', async () => ({ content: [{ type: 'text', text: '[{"name": SECRET-UPSTREAM' }] })],
  ['empty content', async () => ({ content: [] })],
  ['SDK error', async () => { throw new Error('SECRET-UPSTREAM 529 overloaded_error api key sk-ant-xyz'); }],
];
for (const [callName, call] of AI_CALLS) {
  for (const [failName, create] of AI_FAILURES) {
    test(`AI ${callName} request with ${failName} gives 502 AI_UNAVAILABLE and no upstream text`, async () => {
      await withAnthropic(create, async () => {
        const res = await call();
        assert.equal(res.status, 502);
        assert.deepEqual(res.body, { error: { code: 'AI_UNAVAILABLE' } });
        assert.ok(!res.text.includes('SECRET-UPSTREAM'));
        assert.match(res.headers['x-request-id'], /^[0-9a-f-]{36}$/);
      });
    });
  }
}
