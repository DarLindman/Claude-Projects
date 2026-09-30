'use strict';

const { AppError } = require('./errors');
const { COOKIE_NAME, verifySession, clearSessionCookie } = require('../lib/sessions');

// ─── Auth middleware ──────────────────────────────────────────────────────────
// Reads the fl_session cookie (never the Authorization header). No cookie: 401
// UNAUTHORIZED. A cookie that fails verification, belongs to a user that no longer
// exists or carries an outdated token_version: 401 SESSION_EXPIRED and the cookie is
// cleared. Sets req.user = { id, username }.
function createAuth({ pool, config }) {
  return async function auth(req, res, next) {
    const token = req.cookies?.[COOKIE_NAME];
    if (token === undefined || token === '') return next(new AppError(401, 'UNAUTHORIZED'));

    const expired = () => {
      clearSessionCookie(res, config);
      next(new AppError(401, 'SESSION_EXPIRED'));
    };

    let session;
    try {
      session = verifySession(token, config.jwtSecret);
    } catch {
      return expired();
    }

    let user;
    try {
      const { rows } = await pool.query('SELECT id, username, token_version FROM users WHERE id = $1', [session.id]);
      user = rows[0];
    } catch (e) {
      return next(e);
    }
    if (!user || user.token_version !== session.tv) return expired();
    req.user = { id: user.id, username: user.username };
    next();
  };
}

module.exports = { createAuth };
