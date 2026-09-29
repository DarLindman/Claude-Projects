'use strict';

const path = require('path');
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const { createAuth } = require('./middleware/auth');
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

  app.use(cors({ origin: config.origin }));
  app.use(express.json({ limit: '15mb' }));

  const loginLimiter = rateLimit({ windowMs: 60_000, max: loginPerMin, standardHeaders: true, legacyHeaders: false });
  const analyzeLimiter = rateLimit({ windowMs: 3_600_000, max: analyzePerHour, standardHeaders: true, legacyHeaders: false });

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

  return app;
}

module.exports = { createApp };
