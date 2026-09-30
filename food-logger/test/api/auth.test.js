'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { buildTestApp, signedIn, PASSWORD } = require('../helpers/app');

let ctx;
before(async () => { ctx = await buildTestApp(); });
after(async () => { await ctx.pool.end(); });

test('register returns token and lowercased username', async () => {
  const res = await request(ctx.app).post('/auth/register').send({ username: 'AliceX', password: PASSWORD });
  assert.equal(res.status, 200);
  assert.equal(typeof res.body.token, 'string');
  assert.equal(res.body.username, 'alicex');
});

test('duplicate register returns 409', async () => {
  await request(ctx.app).post('/auth/register').send({ username: 'dup', password: PASSWORD });
  const res = await request(ctx.app).post('/auth/register').send({ username: 'DUP', password: PASSWORD });
  assert.equal(res.status, 409);
});

test('login with wrong password returns 401', async () => {
  await request(ctx.app).post('/auth/register').send({ username: 'bob', password: PASSWORD });
  const res = await request(ctx.app).post('/auth/login').send({ username: 'bob', password: 'wrong-password' });
  assert.equal(res.status, 401);
});

test('login success returns token', async () => {
  await request(ctx.app).post('/auth/register').send({ username: 'carol', password: PASSWORD });
  const res = await request(ctx.app).post('/auth/login').send({ username: 'Carol', password: PASSWORD });
  assert.equal(res.status, 200);
  assert.equal(typeof res.body.token, 'string');
  assert.equal(res.body.username, 'carol');
});

test('change-password: wrong current 401; right current ok and new password works', async () => {
  const c = await signedIn(ctx.app, 'dave');
  const bad = await c.post('/auth/change-password', { currentPassword: 'nope-nope', newPassword: 'brand-new-pw' });
  assert.equal(bad.status, 401);
  const ok = await c.post('/auth/change-password', { currentPassword: PASSWORD, newPassword: 'brand-new-pw' });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body, { ok: true });
  const login = await request(ctx.app).post('/auth/login').send({ username: 'dave', password: 'brand-new-pw' });
  assert.equal(login.status, 200);
});

test('protected route without token returns 401', async () => {
  const res = await request(ctx.app).get('/api/food');
  assert.equal(res.status, 401);
  assert.deepEqual(res.body, { error: { code: 'UNAUTHORIZED' } });
});
