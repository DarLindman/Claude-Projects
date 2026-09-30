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

test('PUT accepts numeric strings for height, weight and goalKg and stores numbers', async () => {
  const c = await signedIn(ctx.app, 'pf3');
  const put = await c.put('/api/profile', { height: '170', weight: '70.5', goalKg: '-0.5' });
  assert.equal(put.status, 200);
  const res = await c.get('/api/profile');
  assert.deepEqual(res.body, { height: 170, weight: 70.5, goalKg: -0.5 });
});

test('PUT still rejects garbage, empty and out-of-range numeric strings', async () => {
  const c = await signedIn(ctx.app, 'pf4');
  for (const body of [{ height: 'tall' }, { weight: '70kg' }, { goalKg: 'NaN' }, { height: '' }, { weight: '  ' }, { height: '301' }, { goalKg: '-1001' }, { height: 'Infinity' }]) {
    const res = await c.put('/api/profile', body);
    assert.equal(res.status, 400, JSON.stringify(body));
  }
});
