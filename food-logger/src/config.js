'use strict';

const NODE_ENVS = ['development', 'test', 'production'];
const DEFAULT_ORIGIN = 'http://localhost:3000';
const MIN_JWT_SECRET_LENGTH = 32;

// Treat unset and empty/whitespace-only values the same way.
function read(env, name) {
  const v = env[name];
  if (v === undefined || v === null) return undefined;
  return String(v).trim() === '' ? undefined : String(v);
}

function parseNonNegativeInt(raw) {
  return /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : null;
}

// The normalised origin (no trailing slash) of an http(s) URL that is exactly an origin, or
// null. One trailing slash is tolerated ("https://food.example.com/"); a scheme-less value
// ("localhost:3000" parses as scheme "localhost:") and any path, query or fragment are not.
// The CSRF check compares the browser's Origin header with this value.
function parseOrigin(value) {
  const stripped = value.endsWith('/') ? value.slice(0, -1) : value;
  let url;
  try {
    url = new URL(stripped);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  return url.origin === stripped ? stripped : null;
}

function loadConfig(env = process.env) {
  const errors = [];

  const nodeEnvRaw = read(env, 'NODE_ENV') ?? 'development';
  let nodeEnv = nodeEnvRaw.trim();
  if (!NODE_ENVS.includes(nodeEnv)) {
    errors.push(`NODE_ENV must be one of ${NODE_ENVS.join('|')} (got "${nodeEnvRaw}")`);
    nodeEnv = 'development';
  }
  const isProd = nodeEnv === 'production';

  const databaseUrl = read(env, 'DATABASE_URL');
  if (!databaseUrl) errors.push('DATABASE_URL is required');

  // Trimmed: a stray newline or space from a pasted value must not count towards the length
  // check or end up in the signing key.
  const jwtSecret = read(env, 'JWT_SECRET')?.trim();
  if (!jwtSecret) {
    errors.push('JWT_SECRET is required');
  } else if (jwtSecret.length < MIN_JWT_SECRET_LENGTH) {
    errors.push(`JWT_SECRET must be at least ${MIN_JWT_SECRET_LENGTH} characters`);
  }

  const anthropicApiKey = read(env, 'ANTHROPIC_API_KEY');
  if (isProd && !anthropicApiKey) {
    errors.push('ANTHROPIC_API_KEY is required in production');
  }

  let origin = DEFAULT_ORIGIN;
  const originRaw = read(env, 'ORIGIN');
  if (originRaw === undefined) {
    if (isProd) errors.push('ORIGIN is required in production');
  } else {
    origin = parseOrigin(originRaw.trim());
    if (origin === null) {
      errors.push(`ORIGIN must be an exact http(s) origin such as https://food.example.com, without a path (got "${originRaw.trim()}")`);
      origin = DEFAULT_ORIGIN;
    }
  }

  let port = 3000;
  const portRaw = read(env, 'PORT');
  if (portRaw !== undefined) {
    const n = parseNonNegativeInt(portRaw);
    if (n === null || n > 65535) {
      errors.push(`PORT must be an integer between 0 and 65535 (got "${portRaw}")`);
    } else {
      port = n;
    }
  }

  let trustProxy = isProd ? 1 : 0;
  const trustRaw = read(env, 'TRUST_PROXY');
  if (trustRaw !== undefined) {
    const n = parseNonNegativeInt(trustRaw);
    if (n === null) {
      errors.push(`TRUST_PROXY must be a non-negative integer number of proxy hops (got "${trustRaw}")`);
    } else {
      trustProxy = n;
    }
  }

  const databaseCa = read(env, 'DATABASE_CA');

  if (errors.length) {
    throw new Error(`Invalid configuration:\n- ${errors.join('\n- ')}`);
  }

  return Object.freeze({
    databaseUrl,
    jwtSecret,
    anthropicApiKey,
    origin,
    port,
    nodeEnv,
    trustProxy,
    databaseCa,
    isProd,
  });
}

module.exports = { loadConfig };
