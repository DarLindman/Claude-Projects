'use strict';

const rateLimit = require('express-rate-limit');
const { AppError } = require('./errors');

// Rejections go through the error contract: { error: { code: 'RATE_LIMITED' } } with 429.
function engine(options) {
  return rateLimit({
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res, next) => next(new AppError(429, 'RATE_LIMITED')),
    ...options,
  });
}

// Per-IP limiter for /auth/register and /auth/login. The client address comes from
// req.ip, so it honours the app's `trust proxy` setting (X-Forwarded-For only when trusted).
function createIpLimiter({ windowMs = 60_000, max = 10 } = {}) {
  return engine({ windowMs, max });
}

// Per-user limiter for the AI endpoints. Must be mounted after `auth` (needs req.user).
function createAnalyzeLimiter({ windowMs = 3_600_000, max = 20 } = {}) {
  return engine({ windowMs, max, keyGenerator: (req) => String(req.user.id) });
}

// Per-user limiter for storing meal thumbnails (PUT /api/food/:id/photo). Mounted after `auth` (needs req.user).
function createPhotoLimiter({ windowMs = 3_600_000, max = 200 } = {}) {
  return engine({ windowMs, max, keyGenerator: (req) => String(req.user.id) });
}

// Per-IP limiter for storing thumbnails: registration is open, so the per-user limit alone lets a script mint accounts and fill
// the database with 120 KB rows; this caps the total per client address. Mounted after `auth` like the per-user one.
function createPhotoIpLimiter({ windowMs = 3_600_000, max = 300 } = {}) {
  return engine({ windowMs, max });
}

// Per-IP limiter for the AI endpoints, one budget shared by /api/analyze and /api/analyze-text.
// Registration is open, so the per-user limit alone lets a script mint accounts and multiply
// billed Anthropic calls; this caps the total per client address. Mounted after `auth` like
// the per-user one. The address comes from req.ip (honours `trust proxy`).
function createAnalyzeIpLimiter({ windowMs = 3_600_000, max = 60 } = {}) {
  return engine({ windowMs, max });
}

// Failed-login counter per username, so a password can't be guessed from many IPs.
// Known trade-off: anyone who knows a username can lock that account out, even when the
// real owner enters the correct password, for up to 15 minutes (the window). Accepted for a
// single-user app. The state is in memory: it resets on restart and assumes one instance.
// Sliding window: `max` failures within `windowMs` lock the username until the oldest
// of them ages out. Keys are trimmed and lowercased. The Map is kept in order of each
// key's latest failure, so pruning expired keys only ever looks at the front.
function createUsernameLimiter({ max = 10, windowMs = 900_000, now = Date.now } = {}) {
  const failures = new Map(); // key -> timestamps (ms), oldest first, at most `max`
  const keyOf = (username) => String(username).trim().toLowerCase();

  function prune(t) {
    for (const [key, stamps] of failures) {
      if (stamps[stamps.length - 1] > t - windowMs) break;
      failures.delete(key);
    }
  }

  function recent(key, t) {
    const stamps = failures.get(key);
    return stamps ? stamps.filter((s) => s > t - windowMs) : [];
  }

  return {
    check(username) {
      if (recent(keyOf(username), now()).length >= max) throw new AppError(429, 'RATE_LIMITED');
    },
    recordFailure(username) {
      const t = now();
      const key = keyOf(username);
      const stamps = recent(key, t);
      stamps.push(t);
      if (stamps.length > max) stamps.shift();
      failures.delete(key); // re-insert so the Map stays ordered by latest failure
      failures.set(key, stamps);
      prune(t);
    },
    reset(username) {
      failures.delete(keyOf(username));
    },
    // Number of tracked usernames (for tests and diagnostics).
    size() {
      return failures.size;
    },
  };
}

module.exports = { createUsernameLimiter, createIpLimiter, createAnalyzeLimiter, createAnalyzeIpLimiter, createPhotoLimiter, createPhotoIpLimiter };
