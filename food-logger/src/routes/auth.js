'use strict';

const express = require('express');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const { AppError, asyncHandler } = require('../middleware/errors');
const { validate } = require('../middleware/validate');
const { noNul } = require('../lib/schemas');
const passwords = require('../lib/passwords');

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

// ipLimiter and usernameLimiter come from createApp (see middleware/rateLimit.js).
module.exports = function authRoutes({ pool, config, auth, ipLimiter, usernameLimiter }) {
  const router = express.Router();

  // ─── Auth helpers ───────────────────────────────────────────────────────────
  function createToken(user) {
    return jwt.sign({ id: user.id, username: user.username }, config.jwtSecret, { expiresIn: '7d' });
  }

  // ─── Auth routes ───────────────────────────────────────────────────────────
  router.post('/register', ipLimiter, validate({ body: registerBody }), asyncHandler(async (req, res) => {
    const { username, password } = req.valid.body;
    passwords.validateNewPassword(password);
    const hash = await passwords.hashPassword(password);
    try {
      const { rows } = await pool.query(
        'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username',
        [username.toLowerCase(), hash]
      );
      res.json({ token: createToken(rows[0]), username: rows[0].username });
    } catch (e) {
      if (e.code === '23505') throw new AppError(409, 'USERNAME_TAKEN');
      throw e;
    }
  }));

  router.post('/login', ipLimiter, validate({ body: loginBody }), asyncHandler(async (req, res) => {
    const { username, password } = req.valid.body;
    usernameLimiter.check(username); // before any DB or bcrypt work
    const { rows } = await pool.query('SELECT * FROM users WHERE username = $1', [username.toLowerCase()]);
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
      // A failed upgrade must not fail the login.
      try {
        const upgraded = await passwords.hashPassword(password);
        await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [upgraded, user.id]);
      } catch (e) {
        console.error(`[${req.id}] password rehash failed`, e);
      }
    }
    res.json({ token: createToken(user), username: user.username });
  }));

  router.post('/change-password', auth, validate({ body: changePasswordBody }), asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = req.valid.body;
    passwords.validateNewPassword(newPassword);
    const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
    if (!rows[0] || !(await passwords.verifyPassword(currentPassword, rows[0].password_hash)))
      throw new AppError(401, 'WRONG_CURRENT_PASSWORD');
    const hash = await passwords.hashPassword(newPassword);
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.user.id]);
    res.json({ ok: true });
  }));

  return router;
};
