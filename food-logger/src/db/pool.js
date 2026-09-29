'use strict';

const { Pool } = require('pg');

// TLS policy for the database connection (spec 3.2).
function sslConfig(config) {
  if (!config.isProd) return false;
  if (config.databaseCa) return { ca: config.databaseCa };
  return { rejectUnauthorized: false };
}

function createPool(config) {
  const ssl = sslConfig(config);
  if (config.isProd && !config.databaseCa) {
    console.warn('DATABASE_CA is not set: database TLS certificate verification is OFF');
  }
  return new Pool({ connectionString: config.databaseUrl, ssl });
}

module.exports = { createPool, sslConfig };
