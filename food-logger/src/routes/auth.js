'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const { AppError, asyncHandler } = require('../middleware/errors');
const { validate } = require('../middleware/validate');
const { noNul } = require('../lib/schemas');

// Task 9 replaces the password rules (WEAK_PASSWORD / PASSWORD_TOO_LONG); until then
// the old minimum of 6 applies, with a 1024-character cap.
const registerBody = z.object({
  username: noNul.trim().min(3).max(50),
  password: noNul.min(6).max(1024),
});
const loginBody = z.object({
  username: noNul.max(100),
  password: noNul.min(1).max(1024),
});
const changePasswordBody = z.object({
  currentPassword: noNul.min(1).max(1024),
  newPassword: noNul.min(6).max(1024),
});

// deps.loginLimiter is supplied by createApp (Task 10 replaces the limiters).
module.exports = function authRoutes({ pool, config, auth, loginLimiter }) {
  const router = express.Router();

  // ─── Auth helpers ───────────────────────────────────────────────────────────
  const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing-parity', 10); // for timing parity
  function createToken(user) {
    return jwt.sign({ id: user.id, username: user.username }, config.jwtSecret, { expiresIn: '7d' });
  }

  // ─── Auth routes ───────────────────────────────────────────────────────────
  router.post('/register', loginLimiter, validate({ body: registerBody }), asyncHandler(async (req, res) => {
    const { username, password } = req.valid.body;
    const hash = await bcrypt.hash(password, 10);
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

  router.post('/login', loginLimiter, validate({ body: loginBody }), asyncHandler(async (req, res) => {
    const { username, password } = req.valid.body;
    const { rows } = await pool.query('SELECT * FROM users WHERE username = $1', [username.toLowerCase()]);
    const user = rows[0];
    // Always run bcrypt to prevent timing-based username enumeration
    const valid = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
    if (!valid || !user) throw new AppError(401, 'INVALID_CREDENTIALS');
    res.json({ token: createToken(user), username: user.username });
  }));

  router.post('/change-password', auth, validate({ body: changePasswordBody }), asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = req.valid.body;
    const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
    if (!rows[0] || !(await bcrypt.compare(currentPassword, rows[0].password_hash)))
      throw new AppError(401, 'WRONG_CURRENT_PASSWORD');
    const hash = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.user.id]);
    res.json({ ok: true });
  }));

  return router;
};
