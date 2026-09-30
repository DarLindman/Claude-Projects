'use strict';

const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');

const { createAuth } = require('./middleware/auth');
const { AppError, requestId, errorHandler } = require('./middleware/errors');
const { createCsrf } = require('./middleware/csrf');
const { securityMiddleware } = require('./middleware/security');
const { createUsernameLimiter, createIpLimiter, createAnalyzeLimiter, createAnalyzeIpLimiter } = require('./middleware/rateLimit');
const authRoutes = require('./routes/auth');
const foodRoutes = require('./routes/food');
const weightRoutes = require('./routes/weight');
const profileRoutes = require('./routes/profile');
const analyzeRoutes = require('./routes/analyze');
const statsRoutes = require('./routes/stats');
const streakRoutes = require('./routes/streak');

// The two AI endpoints parse their own bodies after auth and their rate limit (see
// routes/analyze.js), so unauthenticated or over-limit callers never get a body parsed.
// Case-insensitive and slash-tolerant like Express's own routing.
const OWN_PARSER = /^\/api\/analyze(-text)?\/?$/i;

// Builds the Express app from injected dependencies. Never calls listen().
// `icon` is the PWA icon PNG buffer (or null); `limits` overrides rate limits
// (`now` is an injectable clock for the username lockouts).

function createApp({ config, pool, anthropic, icon = null, limits = {} }) {
  const {
    loginPerMin = 10,
    analyzePerHour = 20,
    analyzePerIpPerHour = 60,
    usernameFailures = 10,
    changePasswordPerMin = 10,
    changePasswordFailures = 10,
    usernameWindowMs = 900_000,
    now = Date.now,
  } = limits;
  const app = express();
  app.set('trust proxy', config.trustProxy);

  // First, so every response (static files, 404s, errors) carries the security headers.
  app.use(securityMiddleware(config));
  app.use(requestId);
  app.use(cookieParser());
  // Before the body parser, static files and every router: a CSRF failure costs no
  // parsing, auth, rate-limit budget or handler work.
  app.use(createCsrf(config));
  const defaultJson = express.json({ limit: '100kb' });
  app.use((req, res, next) => (OWN_PARSER.test(req.path) ? next() : defaultJson(req, res, next)));

  const ipLimiter = createIpLimiter({ max: loginPerMin });
  const usernameLimiter = createUsernameLimiter({ max: usernameFailures, windowMs: usernameWindowMs, now });
  // change-password is a bcrypt path behind a (possibly copied) session cookie: a per-IP cap
  // bounds the CPU cost, a per-user failure lockout bounds guessing of the current password.
  const changePasswordIpLimiter = createIpLimiter({ max: changePasswordPerMin });
  const changePasswordUserLimiter = createUsernameLimiter({ max: changePasswordFailures, windowMs: usernameWindowMs, now });
  const analyzeLimiter = createAnalyzeLimiter({ max: analyzePerHour });
  const analyzeIpLimiter = createAnalyzeIpLimiter({ max: analyzePerIpPerHour });

  const serveIcon = (_, res) => {
    if (icon) return res.type('png').send(icon);
    res.redirect('/icon.svg');
  };
  app.get('/favicon.ico', serveIcon);
  app.get('/apple-touch-icon.png', serveIcon);
  app.get('/apple-touch-icon-precomposed.png', serveIcon);
  app.use(express.static(path.join(__dirname, '..', 'public')));

  const auth = createAuth({ pool, config });
  const deps = { pool, anthropic, config, auth };

  app.use('/auth', authRoutes({ ...deps, ipLimiter, usernameLimiter, changePasswordIpLimiter, changePasswordUserLimiter }));
  app.use('/api', analyzeRoutes({ ...deps, analyzeLimiter, analyzeIpLimiter }));
  app.use('/api/food', foodRoutes(deps));
  app.use('/api/weight', weightRoutes(deps));
  app.use('/api/profile', profileRoutes(deps));
  app.use('/api/stats', statsRoutes(deps));
  app.use('/api/streak', streakRoutes(deps));

  // Unknown API paths get the JSON error contract instead of Express's HTML 404.
  app.use(['/api', '/auth'], (req, res, next) => next(new AppError(404, 'NOT_FOUND')));
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
