'use strict';

const NODE_ENVS = ['development', 'test', 'production'];
const DEFAULT_ORIGIN = 'http://localhost:3000';
const MIN_JWT_SECRET_LENGTH = 32;
const DEFAULT_IMAGE_MODEL = 'claude-sonnet-5-5';
const DEFAULT_TEXT_MODEL = 'claude-haiku-4-5-20251001';
const DEFAULT_IMAGE_EFFORT = 'low';
const IMAGE_EFFORTS = ['low', 'medium', 'high', 'off'];
const MODEL_ID = /^claude-[A-Za-z0-9._-]+$/;

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

  // The model of the image analysis. Unlike the values
  // above, a set-but-blank IMAGE_MODEL is an error, not the default: it is a typo to fix.
  // The value is not echoed, in case a secret was pasted into the wrong variable.
  let imageModel = DEFAULT_IMAGE_MODEL;
  if (env.IMAGE_MODEL !== undefined && env.IMAGE_MODEL !== null) {
    const m = String(env.IMAGE_MODEL).trim();
    if (MODEL_ID.test(m)) {
      imageModel = m;
    } else {
      errors.push(`IMAGE_MODEL must be a Claude model id such as ${DEFAULT_IMAGE_MODEL} or claude-haiku-4-5-20251001 (lowercase "claude-" then letters, digits, ".", "_" or "-")`);
    }
  }

  // The model of the text analysis and of the Hebrew name-repair call (default Haiku 4.5), with
  // the same rules as IMAGE_MODEL: a set-but-blank value is an error, the value is not echoed.
  // The request rules per model family are in src/lib/modelRules.js.
  let textModel = DEFAULT_TEXT_MODEL;
  if (env.TEXT_MODEL !== undefined && env.TEXT_MODEL !== null) {
    const m = String(env.TEXT_MODEL).trim();
    if (MODEL_ID.test(m)) {
      textModel = m;
    } else {
      errors.push(`TEXT_MODEL must be a Claude model id such as ${DEFAULT_TEXT_MODEL} or claude-haiku-5-5 (lowercase "claude-" then letters, digits, ".", "_" or "-"; a set but blank value is an error: delete the variable to use the default)`);
    }
  }

  // The effort of the Sonnet 5 image request (see requestOptionsFor in analysis.js); `off`
  // sends no thinking/output_config fields. Like IMAGE_MODEL, a set-but-blank value is an
  // error, not the default, and the value is not echoed.
  let imageEffort = DEFAULT_IMAGE_EFFORT;
  if (env.IMAGE_EFFORT !== undefined && env.IMAGE_EFFORT !== null) {
    const e = String(env.IMAGE_EFFORT).trim();
    if (IMAGE_EFFORTS.includes(e)) {
      imageEffort = e;
    } else {
      errors.push(`IMAGE_EFFORT must be one of ${IMAGE_EFFORTS.join('|')} (default ${DEFAULT_IMAGE_EFFORT}; a set but blank value is an error: delete the variable to use the default)`);
    }
  }

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
    imageModel,
    textModel,
    imageEffort,
    isProd,
  });
}

// Warnings about a deploy that loaded a valid config but is probably misconfigured.
// Railway sets RAILWAY_ENVIRONMENT / RAILWAY_PUBLIC_DOMAIN; without NODE_ENV=production the
// app treats ORIGIN as optional (defaulting to localhost), so every browser POST fails the CSRF check.
function deployWarnings(config, env = process.env) {
  const warnings = [];
  const onRailway = read(env, 'RAILWAY_ENVIRONMENT') !== undefined || read(env, 'RAILWAY_PUBLIC_DOMAIN') !== undefined;
  if (onRailway && config.nodeEnv !== 'production') {
    warnings.push(
      `Railway deploy detected but NODE_ENV=${config.nodeEnv}. Set NODE_ENV=production and ORIGIN to the public URL; ` +
      `otherwise ORIGIN defaults to ${config.origin} and every POST is rejected with 403 (CSRF).`
    );
  }
  return warnings;
}

// The startup log line: what the deploy actually runs with (never secrets); a wrong ORIGIN or
// NODE_ENV otherwise shows up only as 403s, a wrong model id only as 502s.
function startupLine(config) {
  return `config: nodeEnv=${config.nodeEnv} origin=${config.origin} trustProxy=${config.trustProxy} imageModel=${config.imageModel} imageEffort=${config.imageEffort} textModel=${config.textModel}`;
}

module.exports = { loadConfig, deployWarnings, startupLine };
