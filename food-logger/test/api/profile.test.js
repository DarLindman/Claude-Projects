'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { buildTestApp, signedIn } = require('../helpers/app');

let ctx;
before(async () => { ctx = await buildTestApp(); });
after(async () => { await ctx.pool.end(); });

test('GET with no row returns {}', async () => {
  const c = await signedIn(ctx.app, 'pf1');
  const res = await c.get('/api/profile');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, {});
});

test('PUT keeps only allowed keys and GET returns them', async () => {
  const c = await signedIn(ctx.app, 'pf2');
  const put = await c.put('/api/profile', {
    gender: 'f', birthDate: '1990-01-01', height: 170, weight: 60, activity: 1.4, goalKg: 55, evil: 'x', isAdmin: true,
  });
  assert.equal(put.status, 200);
  assert.deepEqual(put.body, { ok: true });
  const res = await c.get('/api/profile');
  assert.deepEqual(res.body, { gender: 'f', birthDate: '1990-01-01', height: 170, weight: 60, activity: 1.4, goalKg: 55 });
});
