'use strict';

const jwt = require('jsonwebtoken');

// ─── Auth middleware ──────────────────────────────────────────────────────────
function createAuth({ config }) {
  return function auth(req, res, next) {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    try {
      req.user = jwt.verify(token, config.jwtSecret);
      next();
    } catch {
      res.status(401).json({ error: 'Invalid token' });
    }
  };
}

module.exports = { createAuth };
