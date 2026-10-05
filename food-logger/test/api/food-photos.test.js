'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { buildTestApp, signedIn, csrfHeaders } = require('../helpers/app');
const { realJpeg, jpegHeader } = require('../helpers/jpeg');
const { resetDb } = require('../helpers/db');

let ctx;
before(async () => { ctx = await buildTestApp(); });
after(async () => { await ctx.pool.end(); });

const meal = (extra = {}) => ({ meal_type: 'lunch', food_name: 'Salad', calories: 100, ...extra });
const putPhoto = (c, id, body, type = 'image/jpeg') => c.put(`/api/food/${id}/photo`).set('Content-Type', type).send(body);
// Photos stored for one meal, or for all meals when no id is given.
const photoCount = async (id) => Number((await (id === undefined
  ? ctx.pool.query('SELECT count(*) AS n FROM food_photos')
  : ctx.pool.query('SELECT count(*) AS n FROM food_photos WHERE food_log_id = $1', [id]))).rows[0].n);
const newMeal = async (c, extra) => (await c.post('/api/food', meal(extra))).body.id;

// Collects a binary response body into a Buffer.
const binary = (res, cb) => {
  const chunks = [];
  res.on('data', (d) => chunks.push(d));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};
const getPhoto = (c, id) => c.get(`/api/food/${id}/photo`).buffer(true).parse(binary);

test('PUT then GET returns the same bytes with private no-cache, a strong ETag and Vary: Cookie', async () => {
  const c = await signedIn(ctx.app, 'pic1');
  const id = await newMeal(c);
  const jpeg = realJpeg(16, 16, 1);
  const put = await putPhoto(c, id, jpeg);
  assert.equal(put.status, 200);
  assert.deepEqual(put.body, { ok: true });
  const get = await getPhoto(c, id);
  assert.equal(get.status, 200);
  assert.match(get.headers['content-type'], /^image\/jpeg/);
  assert.equal(get.headers['cache-control'], 'private, no-cache');
  assert.match(get.headers.etag, /^"[0-9a-f]{40}"$/, 'a strong ETag');
  assert.match(get.headers.vary, /Cookie/);
  assert.ok(Buffer.compare(get.body, jpeg) === 0, 'same bytes');
});

test('a second PUT replaces the thumbnail (one row)', async () => {
  const c = await signedIn(ctx.app, 'pic2');
  const id = await newMeal(c);
  const first = realJpeg(16, 16, 10);
  const second = realJpeg(24, 24, 200);
  assert.equal((await putPhoto(c, id, first)).status, 200);
  assert.equal((await putPhoto(c, id, second)).status, 200);
  const { rows } = await ctx.pool.query('SELECT bytes FROM food_photos WHERE food_log_id=$1', [id]);
  assert.equal(rows.length, 1);
  assert.ok(Buffer.compare(rows[0].bytes, second) === 0);
});

test('GET for a meal without a photo is 404', async () => {
  const c = await signedIn(ctx.app, 'pic3');
  const id = await newMeal(c);
  const res = await c.get(`/api/food/${id}/photo`);
  assert.equal(res.status, 404);
  assert.deepEqual(res.body, { error: { code: 'NOT_FOUND' } });
});

test('another user and a nonexistent id answer identically with 404 (PUT and GET)', async () => {
  const owner = await signedIn(ctx.app, 'pic4-owner');
  const other = await signedIn(ctx.app, 'pic4-other');
  const id = await newMeal(owner);
  const original = realJpeg(16, 16, 77);
  assert.equal((await putPhoto(owner, id, original)).status, 200);
  const missingId = id + 100000;
  for (const [label, run] of [
    ['PUT', (cid) => putPhoto(other, cid, realJpeg())],
    ['GET', (cid) => other.get(`/api/food/${cid}/photo`)],
  ]) {
    const foreign = await run(id);
    const missing = await run(missingId);
    assert.equal(foreign.status, 404, label);
    assert.equal(missing.status, 404, label);
    assert.deepEqual(foreign.body, missing.body, label);
    assert.deepEqual(foreign.body, { error: { code: 'NOT_FOUND' } }, label);
  }
  // The foreign PUT changed nothing: the owner's photo is intact.
  const still = await getPhoto(owner, id);
  assert.equal(still.status, 200);
  assert.ok(Buffer.compare(still.body, original) === 0);
});

test('rejects non-JPEG, too short and over-sized JPEGs with 400 VALIDATION photo=INVALID', async () => {
  const c = await signedIn(ctx.app, 'pic5');
  const id = await newMeal(c);
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
  const cases = {
    'a PNG body labelled image/jpeg': () => putPhoto(c, id, png),
    'a 3-byte body': () => putPhoto(c, id, Buffer.from([0xff, 0xd8, 0xff])),
    'a JPEG header claiming 2000x2000': () => putPhoto(c, id, jpegHeader(2000, 2000)),
    'a JPEG header claiming 641x100': () => putPhoto(c, id, jpegHeader(641, 100)),
    'a JPEG header claiming 100x641': () => putPhoto(c, id, jpegHeader(100, 641)),
    'a JPEG with no readable size': () => putPhoto(c, id, Buffer.from([0xff, 0xd8, 0xff, 0xd9])),
    'a PNG content type': () => putPhoto(c, id, realJpeg(), 'image/png'),
    'no content type': () => c.put(`/api/food/${id}/photo`).send(),
    'an empty body': () => putPhoto(c, id, Buffer.alloc(0)),
  };
  for (const [label, run] of Object.entries(cases)) {
    const res = await run();
    assert.equal(res.status, 400, label);
    assert.deepEqual(res.body, { error: { code: 'VALIDATION' }, fields: { photo: 'INVALID' } }, label);
  }
  assert.equal(await photoCount(id), 0);
});

test('a 640x640 header is accepted', async () => {
  const c = await signedIn(ctx.app, 'pic6');
  const id = await newMeal(c);
  assert.equal((await putPhoto(c, id, jpegHeader(640, 640))).status, 200);
});

test('a body over 120 KB is rejected, both just over the cap and over the parser limit', async () => {
  const c = await signedIn(ctx.app, 'pic7');
  const id = await newMeal(c);
  const base = realJpeg();
  // Trailing zero bytes after the image keep the header valid and only change the size.
  const padded = (n) => Buffer.concat([base, Buffer.alloc(n - base.length, 0)]);
  for (const size of [122_881, 130 * 1024 + 1024]) {
    const res = await putPhoto(c, id, padded(size));
    assert.equal(res.status, 400, String(size));
    assert.equal(res.body.error.code, 'VALIDATION', String(size));
  }
  assert.equal(await photoCount(id), 0);
  assert.equal((await putPhoto(c, id, padded(122_880))).status, 200); // exactly 120 KB is fine
});

test('PUT needs the CSRF headers and a session; GET needs a session', async () => {
  const c = await signedIn(ctx.app, 'pic8');
  const id = await newMeal(c);
  const noHeaders = await request(ctx.app).put(`/api/food/${id}/photo`).set('Cookie', c.cookie).set('Content-Type', 'image/jpeg').send(realJpeg());
  assert.equal(noHeaders.status, 403);
  assert.equal(noHeaders.body.error.code, 'CSRF');
  const noSession = await request(ctx.app).put(`/api/food/${id}/photo`).set(csrfHeaders()).set('Content-Type', 'image/jpeg').send(realJpeg());
  assert.equal(noSession.status, 401);
  assert.equal((await request(ctx.app).get(`/api/food/${id}/photo`)).status, 401);
  assert.equal(await photoCount(id), 0);
});

test('a malformed id is a validation error, not a crash', async () => {
  const c = await signedIn(ctx.app, 'pic9');
  assert.equal((await putPhoto(c, 'abc', realJpeg())).status, 400);
  assert.equal((await c.get('/api/food/abc/photo')).status, 400);
});

test('deleting the meal removes its photo; has_photo is true/false in the list', async () => {
  await resetDb(ctx.pool);
  const c = await signedIn(ctx.app, 'pic10');
  const withPhoto = await newMeal(c, { food_name: 'with', logged_at: '2026-03-01T10:00:00' });
  const without = await newMeal(c, { food_name: 'without', logged_at: '2026-03-01T11:00:00' });
  await putPhoto(c, withPhoto, realJpeg());
  const list = await c.get('/api/food?date=2026-03-01');
  assert.deepEqual(list.body.map((r) => [r.id, r.has_photo]), [[withPhoto, true], [without, false]]);
  const all = await c.get('/api/food');
  assert.ok(all.body.every((r) => typeof r.has_photo === 'boolean'));
  assert.equal(await photoCount(), 1);
  assert.equal((await c.delete(`/api/food/${withPhoto}`)).status, 200);
  assert.equal(await photoCount(), 0);
});

test('resetDb truncates food_photos', async () => {
  const c = await signedIn(ctx.app, 'pic11');
  const id = await newMeal(c);
  await putPhoto(c, id, realJpeg());
  assert.equal(await photoCount(), 1);
  await resetDb(ctx.pool);
  assert.equal(await photoCount(), 0);
});

test('the rate limit counts PUTs per user (limits.photoPerHour)', async () => {
  const local = await buildTestApp({ limits: { photoPerHour: 2 } });
  try {
    const a = await signedIn(local.app, 'rl-a');
    const b = await signedIn(local.app, 'rl-b');
    const ida = (await a.post('/api/food', meal())).body.id;
    const idb = (await b.post('/api/food', meal())).body.id;
    assert.equal((await putPhoto(a, ida, realJpeg())).status, 200);
    assert.equal((await putPhoto(a, ida, realJpeg())).status, 200);
    const limited = await putPhoto(a, ida, realJpeg());
    assert.equal(limited.status, 429);
    assert.deepEqual(limited.body, { error: { code: 'RATE_LIMITED' } });
    // Reading is not limited, and another user has their own budget.
    assert.equal((await a.get(`/api/food/${ida}/photo`)).status, 200);
    assert.equal((await putPhoto(b, idb, realJpeg())).status, 200);
  } finally {
    await local.pool.end();
  }
});

test('revalidation: the owner gets 304 for a matching If-None-Match; nobody else ever does, with or without a session', async () => {
  const owner = await signedIn(ctx.app, 'etag-owner');
  const other = await signedIn(ctx.app, 'etag-other');
  const id = await newMeal(owner);
  assert.equal((await putPhoto(owner, id, realJpeg(16, 16, 5))).status, 200);
  const first = await getPhoto(owner, id);
  const etag = first.headers.etag;
  assert.ok(etag);

  const again = await owner.get(`/api/food/${id}/photo`).set('If-None-Match', etag);
  assert.equal(again.status, 304);
  assert.equal(again.headers['cache-control'], 'private, no-cache');

  // another user sending the owner's ETag: the same 404 as for any foreign id, never a 304 or the bytes
  const foreign = await other.get(`/api/food/${id}/photo`).set('If-None-Match', etag);
  assert.equal(foreign.status, 404);
  assert.deepEqual(foreign.body, { error: { code: 'NOT_FOUND' } });
  // no session at all (a signed-out browser with the cached validator): 401, not 304
  const anonymous = await request(ctx.app).get(`/api/food/${id}/photo`).set('If-None-Match', etag);
  assert.equal(anonymous.status, 401);
  // a replaced thumbnail has a new ETag, so the old validator no longer matches
  assert.equal((await putPhoto(owner, id, realJpeg(24, 24, 200))).status, 200);
  const replaced = await owner.get(`/api/food/${id}/photo`).set('If-None-Match', etag);
  assert.equal(replaced.status, 200);
  assert.notEqual(replaced.headers.etag, etag);
});

test('the per-IP limit counts PUTs of every user from one address (limits.photoPerIpPerHour)', async () => {
  const local = await buildTestApp({ limits: { photoPerHour: 100, photoPerIpPerHour: 2 } });
  try {
    const a = await signedIn(local.app, 'ip-a');
    const b = await signedIn(local.app, 'ip-b');
    const ida = (await a.post('/api/food', meal())).body.id;
    const idb = (await b.post('/api/food', meal())).body.id;
    assert.equal((await putPhoto(a, ida, realJpeg())).status, 200);
    assert.equal((await putPhoto(b, idb, realJpeg())).status, 200);
    const limited = await putPhoto(b, idb, realJpeg());   // a different account, the same address
    assert.equal(limited.status, 429);
    assert.deepEqual(limited.body, { error: { code: 'RATE_LIMITED' } });
    assert.equal((await a.get(`/api/food/${ida}/photo`)).status, 200, 'reading is not limited');
  } finally {
    await local.pool.end();
  }
});
