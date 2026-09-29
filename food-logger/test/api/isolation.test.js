'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { buildTestApp, signedIn } = require('../helpers/app');

let ctx;
before(async () => { ctx = await buildTestApp(); });
after(async () => { await ctx.pool.end(); });

test('user B can never READ user A data (food, food by date, weight, profile)', async () => {
  const a = await signedIn(ctx.app, 'isoA');
  const b = await signedIn(ctx.app, 'isoB');
  await a.post('/api/food', { meal_type: 'lunch', food_name: 'A-secret-meal', calories: 100, logged_at: '2024-03-01T12:00:00Z' });
  await a.post('/api/weight', { weight_kg: 77.7, logged_at: '2024-03-01' });
  await a.put('/api/profile', { gender: 'f', height: 171 });

  // Sanity: A sees their own data.
  assert.equal((await a.get('/api/food')).body.length, 1);
  assert.equal((await a.get('/api/weight')).body.length, 1);
  assert.equal((await a.get('/api/profile')).body.height, 171);

  const food = await b.get('/api/food');
  assert.equal(food.status, 200);
  assert.deepEqual(food.body, []);
  const foodDay = await b.get('/api/food?date=2024-03-01');
  assert.equal(foodDay.status, 200);
  assert.deepEqual(foodDay.body, []);
  const weight = await b.get('/api/weight');
  assert.equal(weight.status, 200);
  assert.deepEqual(weight.body, []);
  const profile = await b.get('/api/profile');
  assert.equal(profile.status, 200);
  assert.deepEqual(profile.body, {});
});
