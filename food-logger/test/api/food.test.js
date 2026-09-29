'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { buildTestApp, signedIn } = require('../helpers/app');

let ctx;
before(async () => { ctx = await buildTestApp(); });
after(async () => { await ctx.pool.end(); });

const entry = (extra = {}) => ({
  meal_type: 'lunch', food_name: 'Salad', calories: 123, protein_g: 5.04, carbs_g: 10, fat_g: 2.25, fiber_g: 3, notes: 'n', ...extra,
});

test('POST returns inserted row with numbers rounded to 1 decimal', async () => {
  const c = await signedIn(ctx.app, 'foodie');
  const res = await c.post('/api/food', entry());
  assert.equal(res.status, 200);
  for (const k of ['id', 'user_id', 'meal_type', 'food_name', 'calories', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g', 'notes', 'logged_at']) {
    assert.ok(k in res.body, `missing column ${k}`);
  }
  assert.equal(res.body.food_name, 'Salad');
  assert.equal(Number(res.body.calories), 123);
  assert.equal(Number(res.body.protein_g), 5);
  assert.equal(Number(res.body.fat_g), 2.3);
});

test('GET with date returns only that day ascending; without date newest first', async () => {
  const c = await signedIn(ctx.app, 'lister');
  await c.post('/api/food', entry({ food_name: 'late', logged_at: '2024-03-01T18:00:00Z' }));
  await c.post('/api/food', entry({ food_name: 'early', logged_at: '2024-03-01T08:00:00Z' }));
  await c.post('/api/food', entry({ food_name: 'other-day', logged_at: '2024-03-05T12:00:00Z' }));
  const day = await c.get('/api/food?date=2024-03-01');
  assert.equal(day.status, 200);
  assert.deepEqual(day.body.map((r) => r.food_name), ['early', 'late']);
  const all = await c.get('/api/food');
  assert.deepEqual(all.body.map((r) => r.food_name), ['other-day', 'late', 'early']);
});

test('PUT updates and returns the row', async () => {
  const c = await signedIn(ctx.app, 'editor');
  const { body: row } = await c.post('/api/food', entry());
  const res = await c.put(`/api/food/${row.id}`, entry({ food_name: 'Soup', meal_type: 'dinner', calories: 50 }));
  assert.equal(res.status, 200);
  assert.equal(res.body.id, row.id);
  assert.equal(res.body.food_name, 'Soup');
  assert.equal(res.body.meal_type, 'dinner');
  assert.equal(Number(res.body.calories), 50);
});

test('PUT and DELETE of another user entry return 404; DELETE own returns ok', async () => {
  const a = await signedIn(ctx.app, 'owner');
  const b = await signedIn(ctx.app, 'intruder');
  const { body: row } = await a.post('/api/food', entry());
  assert.equal((await b.put(`/api/food/${row.id}`, entry())).status, 404);
  assert.equal((await b.delete(`/api/food/${row.id}`)).status, 404);
  const own = await a.delete(`/api/food/${row.id}`);
  assert.equal(own.status, 200);
  assert.deepEqual(own.body, { ok: true });
});
