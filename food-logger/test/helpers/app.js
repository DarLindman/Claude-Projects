'use strict';

const request = require('supertest');
const { loadConfig } = require('../../src/config');
const { migrate } = require('../../src/db/migrate');
const { createApp } = require('../../src/app');
const { createTestPool, resetDb } = require('./db');
const { fakeAnthropic } = require('./fakeAnthropic');

const PASSWORD = 'correct-horse-1';

async function buildTestApp(overrides = {}) {
  const pool = await createTestPool();
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || 'postgres://localhost/foodlogger_test',
    JWT_SECRET: 'test-secret-test-secret-test-secret-1234',
    ORIGIN: 'http://localhost:3000',
  });
  await migrate(pool);
  await resetDb(pool);
  const anthropic = fakeAnthropic();
  const { limits = {}, ...rest } = overrides;
  const app = createApp({ config, pool, anthropic, limits: { loginPerMin: 1000, ...limits }, ...rest });
  return { app, pool, config, anthropic };
}

// Credentials are the old Bearer token; Task 11 changes only this helper.
async function signedIn(app, username = 'alice') {
  const res = await request(app).post('/auth/register').send({ username, password: PASSWORD });
  if (res.status !== 200) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  const token = res.body.token;
  const send = (method) => (path, body) => {
    const req = request(app)[method](path).set('Authorization', `Bearer ${token}`);
    return body === undefined ? req : req.send(body);
  };
  return {
    token,
    username: res.body.username,
    get: send('get'),
    post: send('post'),
    put: send('put'),
    delete: send('delete'),
  };
}

module.exports = { buildTestApp, signedIn, PASSWORD };
