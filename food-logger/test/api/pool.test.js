'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { parse } = require('pg-connection-string');
const { createPool, stripSslParams } = require('../../src/db/pool');

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
