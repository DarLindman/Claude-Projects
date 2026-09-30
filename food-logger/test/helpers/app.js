'use strict';

const request = require('supertest');
const { loadConfig } = require('../../src/config');
const { migrate } = require('../../src/db/migrate');
const { createApp } = require('../../src/app');
const { createTestPool, resetDb } = require('./db');
const { fakeAnthropic } = require('./fakeAnthropic');

const PASSWORD = 'correct-horse-1';
const TEST_ORIGIN = 'http://localhost:3000';

async function buildTestApp(overrides = {}) {
  const pool = await createTestPool();
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || 'postgres://localhost/foodlogger_test',
    JWT_SECRET: 'test-secret-test-secret-test-secret-1234',
    ORIGIN: TEST_ORIGIN,
    ...overrides.env,
  });
  await migrate(pool);
  await resetDb(pool);
  const anthropic = fakeAnthropic();
  const { limits = {}, env, ...rest } = overrides;
  const app = createApp({ config, pool, anthropic, limits: { loginPerMin: 1000, ...limits }, ...rest });
  return { app, pool, config, anthropic };
}

// The headers a same-origin browser request from the real client carries; every
// non-GET request needs them to pass the CSRF check.
function csrfHeaders(config = { origin: TEST_ORIGIN }) {
  return { Origin: config.origin, 'X-FL-Client': '1' };
}

// "fl_session=<value>" from a response's Set-Cookie, or null when there is none.
// An empty value (a cleared cookie) is returned as "fl_session=".
function sessionCookie(res) {
  const header = res.headers['set-cookie'] || [];
  const line = header.find((c) => c.startsWith('fl_session='));
  return line ? line.split(';')[0] : null;
}

// Registers `username` and returns a client that behaves like one browser: it keeps the
// session cookie (updating it when a response sets or clears it) and sends it with
// `Origin` and `X-FL-Client: 1` on every call.
async function signedIn(app, username = 'alice', { origin = TEST_ORIGIN } = {}) {
  const headers = csrfHeaders({ origin });
  const res = await request(app).post('/auth/register').set(headers).send({ username, password: PASSWORD });
  if (res.status !== 200) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  const client = { cookie: sessionCookie(res), username: res.body.username };
  if (!client.cookie) throw new Error('register did not set the session cookie');

  // A request with the session cookie and CSRF headers, not yet sent (add headers, then .send()).
  client.req = (method, path) => {
    const req = request(app)[method](path).set(headers);
    if (client.cookie) req.set('Cookie', client.cookie);
    req.on('response', (r) => {
      const next = sessionCookie(r);
      if (next !== null) client.cookie = next === 'fl_session=' ? null : next;
    });
    return req;
  };
  const send = (method) => (path, body) => {
    const req = client.req(method, path);
    return body === undefined ? req : req.send(body);
  };
  Object.assign(client, { get: send('get'), post: send('post'), put: send('put'), delete: send('delete') });
  return client;
}

module.exports = { buildTestApp, signedIn, csrfHeaders, sessionCookie, PASSWORD, TEST_ORIGIN };
