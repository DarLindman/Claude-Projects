'use strict';

const express = require('express');
const { z } = require('zod');
const { AppError, asyncHandler } = require('../middleware/errors');
const { validate } = require('../middleware/validate');
const { noNul } = require('../lib/schemas');
const passwords = require('../lib/passwords');
const { setSessionCookie, clearSessionCookie } = require('../lib/sessions');

// New passwords: zod only checks the type and bounds the work (1024 characters);
// the policy (8 characters minimum, 72 bytes maximum) is passwords.validateNewPassword.
const registerBody = z.object({
  username: noNul.trim().min(3).max(50),
  password: noNul.max(1024),
});
const loginBody = z.object({
  username: noNul.max(100),
  password: noNul.min(1).max(1024),
});
const changePasswordBody = z.object({
  currentPassword: noNul.min(1).max(1024),
  newPassword: noNul.max(1024),
});

// The limiters come from createApp (see middleware/rateLimit.js).
module.exports = function authRoutes({ pool, config, auth, ipLimiter, usernameLimiter, changePasswordIpLimiter, changePasswordUserLimiter }) {
  const router = express.Router();

  // ─── Auth routes ───────────────────────────────────────────────────────────
  router.post('/register', ipLimiter, validate({ body: registerBody }), asyncHandler(async (req, res) => {
    const { username, password } = req.valid.body;
    passwords.validateNewPassword(password);
    const hash = await passwords.hashPassword(password);
    let user;
    try {
      const { rows } = await pool.query(
        'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username, token_version',
        [username.toLowerCase(), hash]
      );
      user = rows[0];
    } catch (e) {
      if (e.code === '23505') throw new AppError(409, 'USERNAME_TAKEN');
      throw e;
    }
    setSessionCookie(res, config, user);
    res.json({ username: user.username });
  }));

  router.post('/login', ipLimiter, validate({ body: loginBody }), asyncHandler(async (req, res) => {
    const { username, password } = req.valid.body;
    usernameLimiter.check(username); // before any DB or bcrypt work
    const { rows } = await pool.query('SELECT * FROM users WHERE username = $1', [username.trim().toLowerCase()]);
    const user = rows[0];
    // Always run bcrypt to prevent timing-based username enumeration
    const valid = await passwords.verifyPassword(password, user ? user.password_hash : passwords.DUMMY_HASH);
    if (!valid || !user) {
      usernameLimiter.recordFailure(username);
      throw new AppError(401, 'INVALID_CREDENTIALS');
    }
    usernameLimiter.reset(username);
    if (passwords.needsRehash(user.password_hash)) {
      // Existing accounts move to the current cost on their next successful login.
      // A failed upgrade must not fail the login. Compare-and-swap on the hash read above:
      // if the password was changed meanwhile, the rehash of the old one must not overwrite it.
      try {
        const upgraded = await passwords.hashPassword(password);
        await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2 AND password_hash = $3', [upgraded, user.id, user.password_hash]);
      } catch (e) {
        console.error(`[${req.id}] password rehash failed`, e);
      }
    }
    setSessionCookie(res, config, user);
    res.json({ username: user.username });
  }));

  router.get('/me', auth, (req, res) => {
    res.json({ username: req.user.username });
  });

  // Signs out this device only: other sessions stay valid (see /logout-all).
  // 200 even without a session; the CSRF check still applies (app.js).
  router.post('/logout', (req, res) => {
    clearSessionCookie(res, config);
    res.json({ ok: true });
  });

  // Revokes every session of the user, this one included.
  router.post('/logout-all', auth, asyncHandler(async (req, res) => {
    await pool.query('UPDATE users SET token_version = token_version + 1 WHERE id = $1', [req.user.id]);
    clearSessionCookie(res, config);
    res.json({ ok: true });
  }));

  router.post('/change-password', changePasswordIpLimiter, auth, validate({ body: changePasswordBody }), asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = req.valid.body;
    const limiterKey = String(req.user.id);
    changePasswordUserLimiter.check(limiterKey); // before any bcrypt work
    passwords.validateNewPassword(newPassword);
    const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
    if (!rows[0] || !(await passwords.verifyPassword(currentPassword, rows[0].password_hash))) {
      changePasswordUserLimiter.recordFailure(limiterKey);
      throw new AppError(401, 'WRONG_CURRENT_PASSWORD');
    }
    changePasswordUserLimiter.reset(limiterKey);
    const hash = await passwords.hashPassword(newPassword);
    // Revokes every other session; this device gets a fresh cookie with the new version.
    const updated = await pool.query(
      'UPDATE users SET password_hash = $1, token_version = token_version + 1 WHERE id = $2 RETURNING id, token_version',
      [hash, req.user.id]
    );
    if (!updated.rows[0]) { // the user was deleted meanwhile
      clearSessionCookie(res, config);
      throw new AppError(401, 'SESSION_EXPIRED');
    }
    setSessionCookie(res, config, updated.rows[0]);
    res.json({ ok: true });
  }));

  return router;
};
