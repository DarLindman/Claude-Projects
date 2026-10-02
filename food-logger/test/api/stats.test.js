'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { buildTestApp, signedIn } = require('../helpers/app');
const { addDaysUtc } = require('../../src/lib/dates');

let ctx;
before(async () => { ctx = await buildTestApp(); });
after(async () => { await ctx.pool.end(); });

const log = (c, food_name, logged_at, calories, extra = {}) =>
  c.post('/api/food', { meal_type: 'lunch', food_name, calories, protein_g: 1, carbs_g: 2, fat_g: 3, fiber_g: 4, logged_at, ...extra });

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
  assert.equal(res.body[0].day, '2024-03-04');
  assert.equal(Number(res.body[0].calories), 150);
  assert.equal(Number(res.body[0].protein_g), 2);
  assert.equal(Number(res.body[0].carbs_g), 4);
  assert.equal(Number(res.body[0].fat_g), 6);
  assert.equal(Number(res.body[0].fiber_g), 8);
  assert.equal(res.body[1].day, '2024-03-06');
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
  assert.equal(res.body[0].day, '2024-03-01');
  assert.equal(Number(res.body[0].calories), 30);
  assert.equal(res.body[1].day, '2024-03-31');
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

// Fixed dates and the `today` query: nothing here depends on the clock or on any time zone.
const D = '2026-05-10';
const DAY_BEFORE = '2026-05-09';
const DAY_AFTER = '2026-05-11';
const TWO_AFTER = '2026-05-12';

test('streak counts consecutive days ending today', async () => {
  const c = await signedIn(ctx.app, 'streaker');
  await log(c, 'yesterday', `${DAY_BEFORE}T23:30:00`, 1);
  await log(c, 'today', `${D}T00:30:00`, 1);
  const res = await c.get(`/api/streak?today=${D}`);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { streak: 2, lastLogDate: D });
});

test('streak is 1 the day after', async () => {
  const c = await signedIn(ctx.app, 'streakNext');
  await log(c, 'a', `${D}T12:00:00`, 1);
  const res = await c.get(`/api/streak?today=${DAY_AFTER}`);
  assert.deepEqual(res.body, { streak: 1, lastLogDate: D });
});

test('streak is 0 two days later', async () => {
  const c = await signedIn(ctx.app, 'lapsed');
  await log(c, 'a', `${D}T12:00:00`, 1);
  const res = await c.get(`/api/streak?today=${TWO_AFTER}`);
  assert.deepEqual(res.body, { streak: 0, lastLogDate: D });
});

test('streak crosses 28 Feb, 29 Feb and 1 Mar 2024', async () => {
  const c = await signedIn(ctx.app, 'leaper');
  await log(c, 'a', '2024-02-28T23:30:00', 1);
  await log(c, 'b', '2024-02-29T23:30:00', 1);
  await log(c, 'c', '2024-03-01T23:30:00', 1);
  const res = await c.get('/api/streak?today=2024-03-01');
  assert.deepEqual(res.body, { streak: 3, lastLogDate: '2024-03-01' });
});

test('a meal dated after today is ignored', async () => {
  const c = await signedIn(ctx.app, 'futurist');
  await log(c, 'a', `${DAY_BEFORE}T12:00:00`, 1);
  await log(c, 'b', `${D}T12:00:00`, 1);
  await log(c, 'future', `${DAY_AFTER}T12:00:00`, 1);
  const res = await c.get(`/api/streak?today=${D}`);
  assert.deepEqual(res.body, { streak: 2, lastLogDate: D });
});

test('no today parameter still works', async () => {
  const c = await signedIn(ctx.app, 'noparam');
  await log(c, 'now', new Date().toISOString(), 1);
  const res = await c.get('/api/streak');
  assert.equal(res.status, 200);
  assert.equal(res.body.streak, 1);
});

test('bad today is 400 VALIDATION', async () => {
  const c = await signedIn(ctx.app, 'badtoday');
  for (const p of ['/api/streak?today=garbage', '/api/stats/weekly?today=2026-02-31']) {
    const res = await c.get(p);
    assert.equal(res.status, 400, p);
    assert.deepEqual(res.body, { error: { code: 'VALIDATION' }, fields: { today: 'INVALID' } }, p);
  }
});

test('weekly with today covers today-6..today', async () => {
  const c = await signedIn(ctx.app, 'weeklyToday');
  await log(c, 'in-end', `${D}T23:30:00`, 10);
  await log(c, 'in-start', `${addDaysUtc(D, -6)}T00:30:00`, 20);
  await log(c, 'out-before', `${addDaysUtc(D, -7)}T23:30:00`, 999);
  await log(c, 'out-after', `${addDaysUtc(D, 1)}T00:30:00`, 999);
  const res = await c.get(`/api/stats/weekly?today=${D}`);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.map((r) => r.day), [addDaysUtc(D, -6), D]);
  assert.deepEqual(res.body.map((r) => Number(r.calories)), [20, 10]);
});

test('yearly puts 31 Dec 23:30 and 1 Jan 00:30 in different years', async () => {
  const c = await signedIn(ctx.app, 'yearBoundary');
  await log(c, 'old', '2025-12-31T23:30:00', 11);
  await log(c, 'new', '2026-01-01T00:30:00', 22);
  const a = await c.get('/api/stats/yearly?year=2025');
  assert.deepEqual(a.body.map((r) => [r.month, Number(r.calories)]), [['2025-12', 11]]);
  const b = await c.get('/api/stats/yearly?year=2026');
  assert.deepEqual(b.body.map((r) => [r.month, Number(r.calories)]), [['2026-01', 22]]);
});
