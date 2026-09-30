'use strict';

const { AppError } = require('./errors');

// Methods that never change state; every other method is checked.
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// The origin of the request: the Origin header when present (even "null", which then
// fails), otherwise the origin of the Referer. null when neither gives one.
function requestOrigin(req) {
  const origin = req.get('Origin');
  if (origin !== undefined) return origin;
  const referer = req.get('Referer');
  if (!referer) return null;
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

// CSRF protection for cookie sessions (on top of SameSite=Strict): a state-changing
// request must come from config.origin (Origin, or Referer as a fallback) and carry
// the custom header `X-FL-Client: 1`, which a cross-site form cannot send.
// Otherwise 403 CSRF, before any body parsing, auth or handler work.
function createCsrf(config) {
  let expected = config.origin;
  try {
    expected = new URL(config.origin).origin; // "http://host:3000/" -> "http://host:3000"
  } catch { /* not a URL: compare the raw value, which then simply never matches a browser */ }

  return function csrf(req, res, next) {
    if (SAFE_METHODS.has(req.method)) return next();
    if (req.get('X-FL-Client') !== '1') return next(new AppError(403, 'CSRF'));
    if (requestOrigin(req) !== expected) return next(new AppError(403, 'CSRF'));
    next();
  };
}

module.exports = { createCsrf };
