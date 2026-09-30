'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { AppError, asyncHandler, requestId, errorHandler } = require('../../src/middleware/errors');
const { buildTestApp, signedIn } = require('../helpers/app');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Silences the server-side log of an expected 500 while `fn` runs; returns what was logged.
async function withQuietErrors(fn) {
  const logged = [];
  const original = console.error;
  console.error = (...args) => logged.push(args);
  try { await fn(); } finally { console.error = original; }
  return logged;
}

function unitApp() {
  const app = express();
  app.use(requestId);
  app.use(express.json({ limit: '100kb' }));
  app.get('/boom', asyncHandler(async () => { throw new Error('secret internal detail'); }));
  app.get('/sync-boom', () => { throw new Error('secret sync detail'); });
  app.get('/app-error', asyncHandler(async () => { throw new AppError(404, 'NOT_FOUND'); }));
  app.get('/fields', asyncHandler(async () => { throw new AppError(400, 'VALIDATION', { food_name: 'REQUIRED' }); }));
  app.post('/echo', (req, res) => res.json(req.body));
  app.use(errorHandler);
  return app;
}

test('an AppError becomes its status and { error: { code } } (plus fields)', async () => {
  const app = unitApp();
  const nf = await request(app).get('/app-error');
  assert.equal(nf.status, 404);
  assert.deepEqual(nf.body, { error: { code: 'NOT_FOUND' } });
  const v = await request(app).get('/fields');
  assert.equal(v.status, 400);
  assert.deepEqual(v.body, { error: { code: 'VALIDATION' }, fields: { food_name: 'REQUIRED' } });
});

test('an unknown thrown error becomes 500 INTERNAL with no message text and an X-Request-Id', async () => {
  const app = unitApp();
  const logged = await withQuietErrors(async () => {
    for (const path of ['/boom', '/sync-boom']) {
      const res = await request(app).get(path);
      assert.equal(res.status, 500);
      assert.deepEqual(res.body, { error: { code: 'INTERNAL' } });
      assert.match(res.headers['x-request-id'], UUID);
      assert.ok(!res.text.includes('secret'));
    }
  });
  assert.equal(logged.length, 2, 'server logs each unexpected error');
  assert.match(String(logged[0][0]), /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/, 'the log line carries the request id');
});

test('each request gets its own X-Request-Id', async () => {
  const app = unitApp();
  const a = await request(app).get('/app-error');
  const b = await request(app).get('/app-error');
  assert.match(a.headers['x-request-id'], UUID);
  assert.notEqual(a.headers['x-request-id'], b.headers['x-request-id']);
});

test('malformed JSON and oversize bodies map to 400 VALIDATION', async () => {
  const app = unitApp();
  const bad = await request(app).post('/echo').set('Content-Type', 'application/json').send('{"a":');
  assert.equal(bad.status, 400);
  assert.deepEqual(bad.body, { error: { code: 'VALIDATION' } });
  const big = await request(app).post('/echo').send({ blob: 'x'.repeat(200 * 1024) });
  assert.equal(big.status, 400);
  assert.deepEqual(big.body, { error: { code: 'VALIDATION' } });
});

let ctx;
before(async () => { ctx = await buildTestApp({ limits: { analyzePerHour: 1000 } }); });
after(async () => { await ctx.pool.end(); });

test('a database failure inside a real route gives 500 INTERNAL without leaking the SQL error', async () => {
  const c = await signedIn(ctx.app, 'boomer');
  const original = ctx.pool.query;
  ctx.pool.query = async () => { throw new Error('relation "secret_table" does not exist'); };
  try {
    await withQuietErrors(async () => {
      const res = await c.get('/api/food');
      assert.equal(res.status, 500);
      assert.deepEqual(res.body, { error: { code: 'INTERNAL' } });
      assert.ok(!res.text.includes('secret_table'));
      assert.match(res.headers['x-request-id'], UUID);
    });
  } finally {
    ctx.pool.query = original;
  }
});

test('malformed JSON on the real app gives 400 VALIDATION', async () => {
  const c = await signedIn(ctx.app, 'badjson');
  const res = await c.post('/api/food', '{"food_name": ').type('json');
  assert.equal(res.status, 400);
  assert.deepEqual(res.body, { error: { code: 'VALIDATION' } });
});

test('a body over 100 KB is rejected with 400 on /api/food and /api/analyze-text', async () => {
  const c = await signedIn(ctx.app, 'bigbody');
  const food = await c.post('/api/food', { meal_type: 'lunch', food_name: 'x', notes: 'n'.repeat(101 * 1024) });
  assert.equal(food.status, 400);
  assert.deepEqual(food.body, { error: { code: 'VALIDATION' } });
  const text = await c.post('/api/analyze-text', { text: 'x'.repeat(101 * 1024) });
  assert.equal(text.status, 400);
  assert.deepEqual(text.body, { error: { code: 'VALIDATION' } });
});

test('/api/analyze accepts a 2 MB image body but rejects one over 8 MB', async () => {
  const c = await signedIn(ctx.app, 'bigimg');
  const jpeg = (bytes) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.alloc(bytes)]);
  const ok = await c.post('/api/analyze', { imageBase64: jpeg(2 * 1024 * 1024).toString('base64'), mimeType: 'image/jpeg' });
  assert.equal(ok.status, 200);
  const tooBig = await c.post('/api/analyze', { imageBase64: jpeg(7 * 1024 * 1024).toString('base64'), mimeType: 'image/jpeg' });
  assert.equal(tooBig.status, 400);
  assert.deepEqual(tooBig.body, { error: { code: 'VALIDATION' } });
});

test('missing or invalid credentials use the error contract', async () => {
  const none = await request(ctx.app).get('/api/food');
  assert.equal(none.status, 401);
  assert.deepEqual(none.body, { error: { code: 'UNAUTHORIZED' } });
  const bad = await request(ctx.app).get('/api/food').set('Authorization', 'Bearer not-a-token');
  assert.equal(bad.status, 401);
  assert.deepEqual(bad.body, { error: { code: 'SESSION_EXPIRED' } });
});

test('rate-limit 429s use the error contract', async () => {
  const limited = await buildTestApp({ limits: { analyzePerHour: 1 } });
  try {
    const c = await signedIn(limited.app, 'limited2');
    assert.equal((await c.post('/api/analyze-text', { text: 'סלט' })).status, 200);
    const res = await c.post('/api/analyze-text', { text: 'סלט' });
    assert.equal(res.status, 429);
    assert.deepEqual(res.body, { error: { code: 'RATE_LIMITED' } });
  } finally {
    await limited.pool.end();
  }
});

test('unknown API routes give a JSON 404, not an HTML page', async () => {
  const res = await request(ctx.app).get('/api/nope');
  assert.equal(res.status, 404);
  assert.deepEqual(res.body, { error: { code: 'NOT_FOUND' } });
});

test('register duplicate, wrong login and wrong current password use stable codes', async () => {
  const c = await signedIn(ctx.app, 'codes1');
  const dup = await request(ctx.app).post('/auth/register').send({ username: 'CODES1', password: 'correct-horse-1' });
  assert.equal(dup.status, 409);
  assert.deepEqual(dup.body, { error: { code: 'USERNAME_TAKEN' } });
  const login = await request(ctx.app).post('/auth/login').send({ username: 'codes1', password: 'wrong-password' });
  assert.equal(login.status, 401);
  assert.deepEqual(login.body, { error: { code: 'INVALID_CREDENTIALS' } });
  const unknownUser = await request(ctx.app).post('/auth/login').send({ username: 'nobody-here', password: 'whatever1' });
  assert.deepEqual(unknownUser.body, { error: { code: 'INVALID_CREDENTIALS' } });
  const cp = await c.post('/auth/change-password', { currentPassword: 'nope-nope', newPassword: 'brand-new-pw' });
  assert.equal(cp.status, 401);
  assert.deepEqual(cp.body, { error: { code: 'WRONG_CURRENT_PASSWORD' } });
});

test('delete of a missing row gives 404 NOT_FOUND', async () => {
  const c = await signedIn(ctx.app, 'gone');
  for (const path of ['/api/food/999999', '/api/weight/999999']) {
    const res = await c.delete(path);
    assert.equal(res.status, 404);
    assert.deepEqual(res.body, { error: { code: 'NOT_FOUND' } });
  }
  const put = await c.put('/api/food/999999', { meal_type: 'lunch', food_name: 'x' });
  assert.equal(put.status, 404);
  assert.deepEqual(put.body, { error: { code: 'NOT_FOUND' } });
});
