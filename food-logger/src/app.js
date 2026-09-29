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

// Builds the Express app from injected dependencies. Never calls listen().
// `icon` and `limits.analyzePerHour` are accepted now; the routes that use them arrive in Task 4.
function createApp({ config, pool, anthropic, icon = null, limits = {} }) {
  const { loginPerMin = 10, analyzePerHour = 20 } = limits; // eslint-disable-line no-unused-vars
  const app = express();

  app.use(cors({ origin: config.origin }));
  app.use(express.json({ limit: '15mb' }));

  const loginLimiter = rateLimit({ windowMs: 60_000, max: loginPerMin, standardHeaders: true, legacyHeaders: false });
  app.use(express.static(path.join(__dirname, '..', 'public')));

  const auth = createAuth({ pool, config });
  const deps = { pool, anthropic, config, auth };

  app.use('/auth', authRoutes({ ...deps, loginLimiter }));
  app.use('/api/food', foodRoutes(deps));
  app.use('/api/weight', weightRoutes(deps));
  app.use('/api/profile', profileRoutes(deps));

  return app;
}

module.exports = { createApp };
