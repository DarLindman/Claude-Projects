'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { buildTestApp, signedIn } = require('../helpers/app');

let ctx;
before(async () => { ctx = await buildTestApp(); });
after(async () => { await ctx.pool.end(); });

test('a brand-new account gets empty results, not errors, from every read endpoint', async () => {
  const c = await signedIn(ctx.app, 'newbie');
  for (const p of ['/api/food', '/api/weight', '/api/stats/weekly', '/api/stats/monthly', '/api/stats/yearly']) {
    const res = await c.get(p);
    assert.equal(res.status, 200, p);
    assert.deepEqual(res.body, [], p);
  }
  const profile = await c.get('/api/profile');
  assert.equal(profile.status, 200);
  assert.deepEqual(profile.body, {});
  const streak = await c.get('/api/streak');
  assert.equal(streak.status, 200);
  assert.deepEqual(streak.body, { streak: 0, lastLogDate: null });
});
