'use strict';

// Test-only database helpers. SAFETY: these must never touch the dev database;
// createTestPool() refuses any database whose name does not end in `_test`.

const path = require('node:path');
const { Pool } = require('pg');
const { pinUtcSession } = require('../../src/db/pool');

require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env'), quiet: true });

const DEFAULT_TEST_DB = 'foodlogger_test';

function dbName(url) {
  return decodeURIComponent(url.pathname.replace(/^\//, ''));
}

function resolveTestUrl() {
  if (process.env.TEST_DATABASE_URL) return new URL(process.env.TEST_DATABASE_URL);
  if (!process.env.DATABASE_URL) {
    throw new Error('Set TEST_DATABASE_URL or DATABASE_URL to run database tests');
  }
  const url = new URL(process.env.DATABASE_URL);
  url.pathname = `/${DEFAULT_TEST_DB}`;
  return url;
}

async function createTestPool() {
  const url = resolveTestUrl();
  const name = dbName(url);
  // Safety check happens before any connection is made.
  if (!/^[A-Za-z0-9_]+_test$/.test(name)) {
    throw new Error(`Refusing to use database "${name}": test database name must end in _test`);
  }

  const admin = new URL(url.toString());
  admin.pathname = '/postgres';
  const adminPool = new Pool({ connectionString: admin.toString() });
  try {
    const { rowCount } = await adminPool.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (!rowCount) await adminPool.query(`CREATE DATABASE "${name}"`);
  } finally {
    await adminPool.end();
  }
  return pinUtcSession(new Pool({ connectionString: url.toString() }));
}

async function resetDb(pool) {
  await pool.query('TRUNCATE users, food_logs, weight_logs, user_profiles RESTART IDENTITY CASCADE');
}

module.exports = { createTestPool, resetDb, resolveTestUrl };
