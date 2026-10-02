'use strict';

const { Pool } = require('pg');

// TLS policy for the database connection (spec 3.2).
function sslConfig(config) {
  if (!config.isProd) return false;
  if (config.databaseCa) return { ca: config.databaseCa };
  return { rejectUnauthorized: false };
}

const SSL_PARAMS = new Set(['ssl', 'sslmode', 'sslcert', 'sslkey', 'sslrootcert', 'sslcrl', 'uselibpqcompat']);

// pg merges ssl settings parsed from the connection string over the `ssl`
// option, so a `?sslmode=require` in DATABASE_URL would silently discard our
// policy. Strip those params so sslConfig() is always the effective TLS setting.
function stripSslParams(connectionString) {
  const q = connectionString.indexOf('?');
  if (q === -1) return connectionString;
  const kept = connectionString
    .slice(q + 1)
    .split('&')
    .filter((kv) => kv !== '' && !SSL_PARAMS.has(decodeURIComponent(kv.split('=')[0])));
  return connectionString.slice(0, q) + (kept.length ? `?${kept.join('&')}` : '');
}

// Every connection runs in UTC, so ::date and timestamptz casts never depend on
// the database server's (or PGOPTIONS') time zone. pg queues queries per client,
// so this SET always runs before the first query handed out on a new connection.
function pinUtcSession(pool) {
  pool.on('connect', (client) => {
    client.query("SET TIME ZONE 'UTC'").catch((err) => {
      console.error('failed to set the database session time zone to UTC:', err.message);
    });
  });
  return pool;
}

function createPool(config) {
  const ssl = sslConfig(config);
  if (config.isProd && !config.databaseCa) {
    console.warn('DATABASE_CA is not set: database TLS certificate verification is OFF');
  }
  return pinUtcSession(new Pool({ connectionString: stripSslParams(config.databaseUrl), ssl }));
}

module.exports = { createPool, sslConfig, stripSslParams, pinUtcSession };
