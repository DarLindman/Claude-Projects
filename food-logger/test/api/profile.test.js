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

// ── goalWeight (the target weight in kg; 0 or absent = unset) ──────────────────────────────────────────────

test('goalWeight: a valid value is stored as a number and returned; the other fields are untouched', async () => {
  const c = await signedIn(ctx.app, 'pfg1');
  const body = { gender: 'male', birthDate: '1990-05-15', height: 175, weight: 80, activity: 'light', goalKg: -0.5, goalWeight: 68.5 };
  assert.equal((await c.put('/api/profile', body)).status, 200);
  assert.deepEqual((await c.get('/api/profile')).body, body);
  for (const [sent, stored] of [[70, 70], ['72.5', 72.5], [20, 20], [400, 400], [68.54, 68.5], ['69.96', 70]]) {
    assert.equal((await c.put('/api/profile', { goalWeight: sent })).status, 200, String(sent));
    assert.deepEqual((await c.get('/api/profile')).body, { goalWeight: stored }, String(sent));
  }
});

test('goalWeight: 0 means unset and is kept as 0; a profile without the field still loads', async () => {
  const c = await signedIn(ctx.app, 'pfg2');
  assert.equal((await c.put('/api/profile', { height: 170, goalWeight: 0 })).status, 200);
  assert.deepEqual((await c.get('/api/profile')).body, { height: 170, goalWeight: 0 });
  const old = await signedIn(ctx.app, 'pfg3');
  assert.equal((await old.put('/api/profile', { gender: 'f', height: 160, weight: 55, goalKg: 0 })).status, 200);
  const got = await old.get('/api/profile');
  assert.equal(got.status, 200);
  assert.deepEqual(got.body, { gender: 'f', height: 160, weight: 55, goalKg: 0 });
  assert.equal('goalWeight' in got.body, false);
});

test('goalWeight: out of range, negative and non-numbers are rejected with VALIDATION and a fields entry', async () => {
  const c = await signedIn(ctx.app, 'pfg4');
  const bad = [19.9, 1, 400.1, 1e9, -5, -0.1, 'heavy', '70kg', '', '  ', null, true, [70], { a: 1 }, 'NaN', 'Infinity'];
  for (const goalWeight of bad) {
    const res = await c.put('/api/profile', { height: 170, goalWeight });
    assert.equal(res.status, 400, JSON.stringify(goalWeight));
    assert.deepEqual(res.body.error, { code: 'VALIDATION' }, JSON.stringify(goalWeight));
    assert.deepEqual(res.body.fields, { goalWeight: 'INVALID' }, JSON.stringify(goalWeight));
  }
  // nothing was stored by the rejected requests
  assert.deepEqual((await c.get('/api/profile')).body, {});
});
