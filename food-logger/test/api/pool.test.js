'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { parse } = require('pg-connection-string');
const { Pool } = require('pg');
const { createPool, stripSslParams, pinUtcSession } = require('../../src/db/pool');
const { createTestPool, resolveTestUrl } = require('../helpers/db');

const BASE = 'postgres://u:p@localhost:5432/db';

function poolFor(config) {
  const warn = console.warn;
  console.warn = () => {};
  try {
    return createPool(config);
  } finally {
    console.warn = warn;
  }
}

test('production with CA: ssl.ca wins over ?sslmode=require in the URL', async () => {
  const pool = poolFor({ isProd: true, databaseCa: 'CERT', databaseUrl: `${BASE}?sslmode=require` });
  try {
    assert.deepEqual(pool.options.ssl, { ca: 'CERT' });
  } finally {
    await pool.end();
  }
});

test('production without CA: ?sslmode=disable cannot switch TLS off', async () => {
  const pool = poolFor({ isProd: true, databaseCa: undefined, databaseUrl: `${BASE}?sslmode=disable` });
  try {
    assert.deepEqual(pool.options.ssl, { rejectUnauthorized: false });
  } finally {
    await pool.end();
  }
});

test('non-production: ssl stays false even with ?sslmode=require', async () => {
  const pool = poolFor({ isProd: false, databaseCa: undefined, databaseUrl: `${BASE}?sslmode=require` });
  try {
    assert.equal(pool.options.ssl, false);
  } finally {
    await pool.end();
  }
});

test('connection parameters other than ssl survive stripping', async () => {
  const pool = poolFor({
    isProd: true,
    databaseCa: 'CERT',
    databaseUrl: `${BASE}?sslmode=verify-full&application_name=fl&sslrootcert=/x.pem`,
  });
  try {
    const parsed = parse(pool.options.connectionString);
    assert.equal(parsed.host, 'localhost');
    assert.equal(parsed.database, 'db');
    assert.equal(parsed.application_name, 'fl');
    assert.equal(parsed.ssl, undefined);
    assert.deepEqual(pool.options.ssl, { ca: 'CERT' });
  } finally {
    await pool.end();
  }
});

test('stripSslParams removes only ssl params', () => {
  assert.equal(stripSslParams(BASE), BASE);
  assert.equal(stripSslParams(`${BASE}?sslmode=require`), BASE);
  assert.equal(stripSslParams(`${BASE}?a=1&ssl=true&b=2`), `${BASE}?a=1&b=2`);
});

// ─── The session time zone is pinned to UTC ──────────────────────────────────

// A pool whose connections ask the server for `zone` at startup (like PGOPTIONS).
async function pinnedPoolWithServerZone(zone, extra = {}) {
  await (await createTestPool()).end(); // makes sure the test database exists
  return pinUtcSession(
    new Pool({ connectionString: resolveTestUrl().toString(), options: `-c timezone=${zone}`, ...extra }),
  );
}

test('a pinned pool reports UTC even when the server and PGOPTIONS say otherwise', async () => {
  const pool = await pinnedPoolWithServerZone('Asia/Jerusalem');
  try {
    const { rows } = await pool.query('SHOW TIME ZONE');
    assert.deepEqual(rows[0], { TimeZone: 'UTC' });
  } finally {
    await pool.end();
  }
});

test('every connection of the pool is pinned', async () => {
  const pool = await pinnedPoolWithServerZone('Asia/Jerusalem', { max: 5 });
  try {
    const results = await Promise.all(
      Array.from({ length: 5 }, () => pool.query("SELECT current_setting('TimeZone') AS tz, pg_sleep(0.1)")),
    );
    assert.deepEqual(results.map((r) => r.rows[0].tz), ['UTC', 'UTC', 'UTC', 'UTC', 'UTC']);
  } finally {
    await pool.end();
  }
});

test('a timestamp without offset is read back as the same wall-clock date', async () => {
  const pool = await pinnedPoolWithServerZone('America/New_York');
  try {
    const d = await pool.query("SELECT '2026-03-01T23:30:00'::timestamptz::date::text AS d");
    assert.equal(d.rows[0].d, '2026-03-01');
    const t = await pool.query("SELECT ('2026-03-01T23:30:00'::timestamptz AT TIME ZONE 'UTC')::text AS t");
    assert.equal(t.rows[0].t, '2026-03-01 23:30:00');
  } finally {
    await pool.end();
  }
});

test('createTestPool and createPool both return pinned pools', async () => {
  const testPool = await createTestPool();
  const prodPool = poolFor({ isProd: false, databaseUrl: resolveTestUrl().toString() });
  try {
    for (const pool of [testPool, prodPool]) {
      const { rows } = await pool.query("SELECT current_setting('TimeZone') AS tz");
      assert.equal(rows[0].tz, 'UTC');
    }
  } finally {
    await testPool.end();
    await prodPool.end();
  }
});

test('a failed SET TIME ZONE is logged, not thrown', async () => {
  const handlers = [];
  const fakePool = { on: (event, fn) => handlers.push([event, fn]) };
  assert.equal(pinUtcSession(fakePool), fakePool);
  assert.equal(handlers[0][0], 'connect');
  const logged = [];
  const error = console.error;
  console.error = (...args) => logged.push(args);
  try {
    handlers[0][1]({ query: () => Promise.reject(new Error('boom')) });
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    console.error = error;
  }
  assert.equal(logged.length, 1);
});
