'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { migrate } = require('../../src/db/migrate');
const { sslConfig } = require('../../src/db/pool');
const { createTestPool } = require('../helpers/db');

let pool;

// Drops and recreates `public`. Guarded: only ever runs against a *_test database.
async function freshSchema() {
  const { rows } = await pool.query('SELECT current_database() AS db');
  assert.match(rows[0].db, /_test$/);
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
}

async function snapshot() {
  const cols = await pool.query(
    `SELECT table_name, column_name, data_type, is_nullable, column_default
       FROM information_schema.columns WHERE table_schema = 'public'
      ORDER BY table_name, column_name`
  );
  const idx = await pool.query(
    `SELECT tablename, indexname, indexdef FROM pg_indexes
      WHERE schemaname = 'public' ORDER BY tablename, indexname`
  );
  return { columns: cols.rows, indexes: idx.rows };
}

before(async () => { pool = await createTestPool(); });
after(async () => { await pool.end(); });

test('migrate applies all migrations on an empty schema', async () => {
  await freshSchema();
  assert.deepEqual(await migrate(pool), ['001_baseline', '002_token_version']);
  const { rows } = await pool.query(`SELECT to_regclass('public.schema_migrations') AS t`);
  assert.ok(rows[0].t);
  const applied = await pool.query('SELECT version FROM schema_migrations ORDER BY version');
  assert.deepEqual(applied.rows.map((r) => r.version), ['001_baseline', '002_token_version']);
});

test('migrate is idempotent', async () => {
  await freshSchema();
  await migrate(pool);
  assert.deepEqual(await migrate(pool), []);
});

test('users.token_version defaults to 0', async () => {
  await freshSchema();
  await migrate(pool);
  const { rows } = await pool.query(
    `INSERT INTO users (username, password_hash) VALUES ('a', 'h') RETURNING token_version`
  );
  assert.equal(rows[0].token_version, 0);
});

test('migrate upgrades a legacy database in place and matches a fresh one', async () => {
  await freshSchema();
  await migrate(pool);
  const fresh = await snapshot();

  await freshSchema();
  await pool.query(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'legacy-schema.sql'), 'utf8'));
  await pool.query(`INSERT INTO users (username, password_hash) VALUES ('legacy', 'hash')`);
  assert.deepEqual(await migrate(pool), ['001_baseline', '002_token_version']);

  const { rows } = await pool.query('SELECT username, password_hash, token_version FROM users');
  assert.deepEqual(rows, [{ username: 'legacy', password_hash: 'hash', token_version: 0 }]);
  assert.deepEqual(await snapshot(), fresh);
});

test('sslConfig: no TLS outside production', () => {
  assert.equal(sslConfig({ isProd: false, databaseCa: undefined }), false);
  assert.equal(sslConfig({ isProd: false, databaseCa: 'CERT' }), false);
});

test('sslConfig: production without CA disables verification', () => {
  assert.deepEqual(sslConfig({ isProd: true, databaseCa: undefined }), { rejectUnauthorized: false });
});

test('sslConfig: production with CA verifies against it', () => {
  assert.deepEqual(sslConfig({ isProd: true, databaseCa: 'CERT' }), { ca: 'CERT' });
});
