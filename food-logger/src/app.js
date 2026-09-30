'use strict';

const path = require('path');
const express = require('express');
const cors = require('cors');

const { createAuth } = require('./middleware/auth');
const { AppError, requestId, errorHandler } = require('./middleware/errors');
const { createUsernameLimiter, createIpLimiter, createAnalyzeLimiter } = require('./middleware/rateLimit');
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
// (`now` is an injectable clock for the username lockout).

function createApp({ config, pool, anthropic, icon = null, limits = {} }) {
  const {
    loginPerMin = 10,
    analyzePerHour = 20,
    usernameFailures = 10,
    usernameWindowMs = 900_000,
    now = Date.now,
  } = limits;
  const app = express();
  app.set('trust proxy', config.trustProxy);

  app.use(requestId);
  app.use(cors({ origin: config.origin }));
  const defaultJson = express.json({ limit: '100kb' });
  app.use((req, res, next) => (OWN_PARSER.test(req.path) ? next() : defaultJson(req, res, next)));

  const ipLimiter = createIpLimiter({ max: loginPerMin });
  const usernameLimiter = createUsernameLimiter({ max: usernameFailures, windowMs: usernameWindowMs, now });
  const analyzeLimiter = createAnalyzeLimiter({ max: analyzePerHour });

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

  app.use('/auth', authRoutes({ ...deps, ipLimiter, usernameLimiter }));
  app.use('/api', analyzeRoutes({ ...deps, analyzeLimiter }));
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
