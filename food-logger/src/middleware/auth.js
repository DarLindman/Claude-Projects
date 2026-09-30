'use strict';

const jwt = require('jsonwebtoken');
const { AppError } = require('./errors');

// ─── Auth middleware ──────────────────────────────────────────────────────────
function createAuth({ config }) {
  return function auth(req, res, next) {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return next(new AppError(401, 'UNAUTHORIZED'));
    try {
      req.user = jwt.verify(token, config.jwtSecret);
      next();
    } catch {
      next(new AppError(401, 'SESSION_EXPIRED'));
    }
  };
}

module.exports = { createAuth };
