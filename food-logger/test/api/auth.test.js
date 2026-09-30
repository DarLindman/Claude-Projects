'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { buildTestApp, signedIn, csrfHeaders, sessionCookie, PASSWORD } = require('../helpers/app');

let ctx;
before(async () => { ctx = await buildTestApp(); });
after(async () => { await ctx.pool.end(); });

test('register sets the session cookie and returns only the lowercased username', async () => {
  const res = await request(ctx.app).post('/auth/register').set(csrfHeaders(ctx.config)).send({ username: 'AliceX', password: PASSWORD });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { username: 'alicex' });
  assert.ok(sessionCookie(res), 'fl_session cookie set');
});

test('duplicate register returns 409', async () => {
  await request(ctx.app).post('/auth/register').set(csrfHeaders(ctx.config)).send({ username: 'dup', password: PASSWORD });
  const res = await request(ctx.app).post('/auth/register').set(csrfHeaders(ctx.config)).send({ username: 'DUP', password: PASSWORD });
  assert.equal(res.status, 409);
});

test('login with wrong password returns 401', async () => {
  await request(ctx.app).post('/auth/register').set(csrfHeaders(ctx.config)).send({ username: 'bob', password: PASSWORD });
  const res = await request(ctx.app).post('/auth/login').set(csrfHeaders(ctx.config)).send({ username: 'bob', password: 'wrong-password' });
  assert.equal(res.status, 401);
});

test('login success sets the session cookie and returns only the username', async () => {
  await request(ctx.app).post('/auth/register').set(csrfHeaders(ctx.config)).send({ username: 'carol', password: PASSWORD });
  const res = await request(ctx.app).post('/auth/login').set(csrfHeaders(ctx.config)).send({ username: 'Carol', password: PASSWORD });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { username: 'carol' });
  assert.ok(sessionCookie(res), 'fl_session cookie set');
});

test('change-password: wrong current 401; right current ok and new password works', async () => {
  const c = await signedIn(ctx.app, 'dave');
  const bad = await c.post('/auth/change-password', { currentPassword: 'nope-nope', newPassword: 'brand-new-pw' });
  assert.equal(bad.status, 401);
  const ok = await c.post('/auth/change-password', { currentPassword: PASSWORD, newPassword: 'brand-new-pw' });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body, { ok: true });
  const login = await request(ctx.app).post('/auth/login').set(csrfHeaders(ctx.config)).send({ username: 'dave', password: 'brand-new-pw' });
  assert.equal(login.status, 200);
});

test('protected route without a session cookie returns 401', async () => {
  const res = await request(ctx.app).get('/api/food');
  assert.equal(res.status, 401);
  assert.deepEqual(res.body, { error: { code: 'UNAUTHORIZED' } });
});
