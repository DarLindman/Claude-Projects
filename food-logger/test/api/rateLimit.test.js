'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { buildTestApp, PASSWORD } = require('../helpers/app');

test('login limiter: with loginPerMin=1 the second login attempt gets 429', async () => {
  const ctx = await buildTestApp({ limits: { loginPerMin: 1 } });
  try {
    const first = await request(ctx.app).post('/auth/login').send({ username: 'nobody', password: PASSWORD });
    assert.equal(first.status, 401);
    const second = await request(ctx.app).post('/auth/login').send({ username: 'nobody', password: PASSWORD });
    assert.equal(second.status, 429);
  } finally {
    await ctx.pool.end();
  }
});
