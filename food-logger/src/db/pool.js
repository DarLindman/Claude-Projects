'use strict';

const { Client, Pool } = require('pg');

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
// the database server's (or PGOPTIONS') time zone. The SET happens inside
// connect(), before pg-pool hands the client out, so no query is ever queued
// behind it. Fail closed: if the SET fails the connection fails (and is closed),
// never a silently unpinned one.
//
// pg-pool attaches its idle 'error' listener only after connect() completes, so
// a socket error during the SET round trip would reach pg's _handleErrorEvent
// with no listener and kill the process. A temporary no-op listener covers that
// window; the SET query itself still fails through pg's _errorAllQueries.
const noop = () => {};

class UtcClient extends Client {
  connect(cb) {
    if (cb) {
      super.connect((err) => {
        if (err) return cb(err);
        this.on('error', noop);
        this.query("SET TIME ZONE 'UTC'", (setErr) => {
          if (!setErr) {
            this.removeListener('error', noop);
            return cb();
          }
          return this.end(() => {
            this.removeListener('error', noop);
            cb(setErr);
          });
        });
      });
      return undefined;
    }
    return super
      .connect()
      .then(() => {
        this.on('error', noop);
        return this.query("SET TIME ZONE 'UTC'");
      })
      .then(
        () => { this.removeListener('error', noop); },
        (err) => this.end().then(
          () => { this.removeListener('error', noop); throw err; },
          () => { this.removeListener('error', noop); throw err; },
        ),
      );
  }
}

function createPinnedPool(options) {
  return new Pool({ ...options, Client: UtcClient });
}

function createPool(config) {
  const ssl = sslConfig(config);
  if (config.isProd && !config.databaseCa) {
    console.warn('DATABASE_CA is not set: database TLS certificate verification is OFF');
  }
  return createPinnedPool({ connectionString: stripSslParams(config.databaseUrl), ssl });
}

module.exports = { createPool, createPinnedPool, UtcClient, sslConfig, stripSslParams };
