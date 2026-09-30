'use strict';

const jwt = require('jsonwebtoken');

// Session cookie: an HS256 JWT with payload { id, tv }, where tv is the user's
// token_version at issue time. Bumping users.token_version revokes every session.
const COOKIE_NAME = 'fl_session';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days, the same as the JWT lifetime
const ALGORITHM = 'HS256';
const PG_INT_MAX = 2_147_483_647; // users.id and token_version are PostgreSQL INTEGER

const isDbInt = (v, min) => Number.isSafeInteger(v) && v >= min && v <= PG_INT_MAX;

function signSession({ id, tv }, secret) {
  return jwt.sign({ id, tv }, secret, { algorithm: ALGORITHM, expiresIn: '7d' });
}

// Returns { id, tv } or throws. The algorithm is pinned, so `alg: none` and any other
// algorithm are refused; the payload must be exactly what signSession produces.
function verifySession(token, secret) {
  if (typeof token !== 'string' || !token) throw new Error('session token missing');
  const payload = jwt.verify(token, secret, { algorithms: [ALGORITHM] });
  if (!payload || typeof payload !== 'object' || typeof payload.exp !== 'number'
      || !isDbInt(payload.id, 1) || !isDbInt(payload.tv, 0)) {
    throw new Error('invalid session payload');
  }
  return { id: payload.id, tv: payload.tv };
}

// Secure only in production (local http development and tests have no TLS).
function cookieOptions(config) {
  return { httpOnly: true, sameSite: 'strict', path: '/', secure: Boolean(config.isProd), maxAge: MAX_AGE_MS };
}

function setSessionCookie(res, config, user) {
  res.cookie(COOKIE_NAME, signSession({ id: user.id, tv: user.token_version }, config.jwtSecret), cookieOptions(config));
}

// Same attributes minus maxAge (res.clearCookie sets an expiry in the past; a maxAge
// would override it).
function clearSessionCookie(res, config) {
  const { maxAge: _ignored, ...options } = cookieOptions(config);
  res.clearCookie(COOKIE_NAME, options);
}

module.exports = {
  COOKIE_NAME, MAX_AGE_MS, signSession, verifySession, cookieOptions, setSessionCookie, clearSessionCookie,
};
