'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { buildTestApp, signedIn } = require('../helpers/app');

let ctx;
before(async () => { ctx = await buildTestApp(); });
after(async () => { await ctx.pool.end(); });

test('POST returns { id, logged_at, weight_kg }', async () => {
  const c = await signedIn(ctx.app, 'wt1');
  const res = await c.post('/api/weight', { weight_kg: 70.5, logged_at: '2024-03-01' });
  assert.equal(res.status, 200);
  assert.deepEqual(Object.keys(res.body).sort(), ['id', 'logged_at', 'weight_kg']);
  assert.equal(res.body.logged_at, '2024-03-01');
  assert.equal(Number(res.body.weight_kg), 70.5);
});

test('GET returns entries ascending by date', async () => {
  const c = await signedIn(ctx.app, 'wt2');
  await c.post('/api/weight', { weight_kg: 71, logged_at: '2024-03-05' });
  await c.post('/api/weight', { weight_kg: 72, logged_at: '2024-03-01' });
  const res = await c.get('/api/weight');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.map((r) => r.logged_at), ['2024-03-01', '2024-03-05']);
});

test('DELETE own ok, other user 404', async () => {
  const a = await signedIn(ctx.app, 'wt3');
  const b = await signedIn(ctx.app, 'wt4');
  const { body: row } = await a.post('/api/weight', { weight_kg: 80 });
  assert.equal((await b.delete(`/api/weight/${row.id}`)).status, 404);
  const own = await a.delete(`/api/weight/${row.id}`);
  assert.equal(own.status, 200);
  assert.deepEqual(own.body, { ok: true });
});
