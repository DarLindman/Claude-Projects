'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { buildTestApp, signedIn } = require('../helpers/app');

let ctx;
before(async () => { ctx = await buildTestApp(); });
after(async () => { await ctx.pool.end(); });

const log = (c, food_name, logged_at, calories, extra = {}) =>
  c.post('/api/food', { meal_type: 'lunch', food_name, calories, protein_g: 1, carbs_g: 2, fat_g: 3, fiber_g: 4, logged_at, ...extra });

// pg returns `date` columns as local-midnight Date objects; read them back with local getters.
const localDay = (v) => {
  const d = new Date(v);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();

test('weekly with start returns daily sums within start..start+6', async () => {
  const c = await signedIn(ctx.app, 'weeklyA');
  await log(c, 'a', '2024-03-04T12:00:00Z', 100);
  await log(c, 'b', '2024-03-04T18:00:00Z', 50);
  await log(c, 'c', '2024-03-06T12:00:00Z', 30);
  await log(c, 'out', '2024-03-11T12:00:00Z', 999);
  await log(c, 'before', '2024-03-03T12:00:00Z', 999);
  const res = await c.get('/api/stats/weekly?start=2024-03-04');
  assert.equal(res.status, 200);
  assert.equal(res.body.length, 2);
  assert.deepEqual(Object.keys(res.body[0]).sort(), ['calories', 'carbs_g', 'day', 'fat_g', 'fiber_g', 'protein_g']);
  assert.equal(localDay(res.body[0].day), '2024-03-04');
  assert.equal(Number(res.body[0].calories), 150);
  assert.equal(Number(res.body[0].protein_g), 2);
  assert.equal(Number(res.body[0].carbs_g), 4);
  assert.equal(Number(res.body[0].fat_g), 6);
  assert.equal(Number(res.body[0].fiber_g), 8);
  assert.equal(localDay(res.body[1].day), '2024-03-06');
  assert.equal(Number(res.body[1].calories), 30);
});

test('weekly without start covers the last 7 days only', async () => {
  const c = await signedIn(ctx.app, 'weeklyB');
  await log(c, 'now', new Date().toISOString(), 70);
  await log(c, 'old', daysAgo(30), 999);
  const res = await c.get('/api/stats/weekly');
  assert.equal(res.status, 200);
  assert.equal(res.body.length, 1);
  assert.equal(Number(res.body[0].calories), 70);
});

test('monthly with month returns daily sums for that month', async () => {
  const c = await signedIn(ctx.app, 'monthlyA');
  await log(c, 'a', '2024-03-01T12:00:00Z', 10);
  await log(c, 'b', '2024-03-01T15:00:00Z', 20);
  await log(c, 'c', '2024-03-31T12:00:00Z', 5);
  await log(c, 'apr', '2024-04-01T12:00:00Z', 999);
  await log(c, 'feb', '2024-02-29T12:00:00Z', 999);
  const res = await c.get('/api/stats/monthly?month=2024-03');
  assert.equal(res.status, 200);
  assert.equal(res.body.length, 2);
  assert.deepEqual(Object.keys(res.body[0]).sort(), ['calories', 'carbs_g', 'day', 'fat_g', 'fiber_g', 'protein_g']);
  assert.equal(localDay(res.body[0].day), '2024-03-01');
  assert.equal(Number(res.body[0].calories), 30);
  assert.equal(localDay(res.body[1].day), '2024-03-31');
  assert.equal(Number(res.body[1].calories), 5);
});

test('monthly without month defaults to the current month', async () => {
  const c = await signedIn(ctx.app, 'monthlyB');
  await log(c, 'now', new Date().toISOString(), 40);
  await log(c, 'old', daysAgo(40), 999);
  const res = await c.get('/api/stats/monthly');
  assert.equal(res.status, 200);
  assert.equal(res.body.length, 1);
  assert.equal(Number(res.body[0].calories), 40);
});

test('yearly with year returns per-month sums and day_count', async () => {
  const c = await signedIn(ctx.app, 'yearlyA');
  await log(c, 'a', '2024-03-01T12:00:00Z', 10);
  await log(c, 'b', '2024-03-01T15:00:00Z', 20);
  await log(c, 'c', '2024-03-05T12:00:00Z', 5);
  await log(c, 'd', '2024-04-10T12:00:00Z', 7);
  await log(c, 'prev', '2023-12-31T12:00:00Z', 999);
  await log(c, 'next', '2025-01-02T12:00:00Z', 999);
  const res = await c.get('/api/stats/yearly?year=2024');
  assert.equal(res.status, 200);
  assert.equal(res.body.length, 2);
  assert.deepEqual(Object.keys(res.body[0]).sort(), ['calories', 'carbs_g', 'day_count', 'fat_g', 'fiber_g', 'month', 'protein_g']);
  assert.equal(res.body[0].month, '2024-03');
  assert.equal(Number(res.body[0].calories), 35);
  assert.equal(Number(res.body[0].day_count), 2);
  assert.equal(res.body[1].month, '2024-04');
  assert.equal(Number(res.body[1].calories), 7);
  assert.equal(Number(res.body[1].day_count), 1);
});

test('yearly without year defaults to the current year', async () => {
  const c = await signedIn(ctx.app, 'yearlyB');
  await log(c, 'now', new Date().toISOString(), 60);
  await log(c, 'old', daysAgo(400), 999);
  const res = await c.get('/api/stats/yearly');
  assert.equal(res.status, 200);
  assert.equal(res.body.length, 1);
  assert.equal(Number(res.body[0].calories), 60);
});

test('stats and streak endpoints require auth', async () => {
  for (const p of ['/api/stats/weekly', '/api/stats/monthly', '/api/stats/yearly', '/api/streak']) {
    assert.equal((await request(ctx.app).get(p)).status, 401, p);
  }
});

// Same expression the route uses to compute Israel dates.
const toIsraelDate = (d) => d.toLocaleString('sv', { timeZone: 'Asia/Jerusalem' }).slice(0, 10);

test('streak counts consecutive days ending today (Israel time)', async () => {
  const c = await signedIn(ctx.app, 'streaker');
  const today = toIsraelDate(new Date());
  const yesterday = toIsraelDate(new Date(Date.now() - 86400000));
  await log(c, 'today', `${today}T12:00:00Z`, 1);
  let res = await c.get('/api/streak');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { streak: 1, lastLogDate: today });
  await log(c, 'yesterday', `${yesterday}T12:00:00Z`, 1);
  res = await c.get('/api/streak');
  assert.deepEqual(res.body, { streak: 2, lastLogDate: today });
});

test('streak is 0 with the last log date when the latest log is older than yesterday', async () => {
  const c = await signedIn(ctx.app, 'lapsed');
  const old = toIsraelDate(new Date(Date.now() - 5 * 86400000));
  await log(c, 'old', `${old}T12:00:00Z`, 1);
  const res = await c.get('/api/streak');
  assert.deepEqual(res.body, { streak: 0, lastLogDate: old });
});
