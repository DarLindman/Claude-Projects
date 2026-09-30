'use strict';

const path = require('path');
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const { createAuth } = require('./middleware/auth');
const { AppError, requestId, errorHandler } = require('./middleware/errors');
const authRoutes = require('./routes/auth');
const foodRoutes = require('./routes/food');
const weightRoutes = require('./routes/weight');
const profileRoutes = require('./routes/profile');
const analyzeRoutes = require('./routes/analyze');
const statsRoutes = require('./routes/stats');
const streakRoutes = require('./routes/streak');

// Builds the Express app from injected dependencies. Never calls listen().
// `icon` is the PWA icon PNG buffer (or null); `limits` overrides rate limits.
function createApp({ config, pool, anthropic, icon = null, limits = {} }) {
  const { loginPerMin = 10, analyzePerHour = 20 } = limits;
  const app = express();

  app.use(requestId);
  app.use(cors({ origin: config.origin }));
  // Only the image upload gets a large body; body-parser skips a body that is already
  // parsed, so this must be mounted before the 100 KB default.
  app.use('/api/analyze', express.json({ limit: '8mb' }));
  app.use(express.json({ limit: '100kb' }));

  const limiterOptions = {
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res, next) => next(new AppError(429, 'RATE_LIMITED')),
  };
  const loginLimiter = rateLimit({ ...limiterOptions, windowMs: 60_000, max: loginPerMin });
  const analyzeLimiter = rateLimit({ ...limiterOptions, windowMs: 3_600_000, max: analyzePerHour });

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

  app.use('/auth', authRoutes({ ...deps, loginLimiter }));
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
