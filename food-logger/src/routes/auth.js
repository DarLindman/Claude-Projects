'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// deps.loginLimiter is supplied by createApp (Task 10 replaces the limiters).
module.exports = function authRoutes({ pool, config, auth, loginLimiter }) {
  const router = express.Router();

  // ─── Auth helpers ───────────────────────────────────────────────────────────
  const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing-parity', 10); // for timing parity
  function createToken(user) {
    return jwt.sign({ id: user.id, username: user.username }, config.jwtSecret, { expiresIn: '7d' });
  }

  // ─── Auth routes ───────────────────────────────────────────────────────────
  router.post('/register', loginLimiter, async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password || username.length < 3 || username.length > 50 || password.length < 6)
      return res.status(400).json({ error: 'שם משתמש חייב להכיל 3–50 תווים, סיסמא לפחות 6' });
    try {
      const hash = await bcrypt.hash(password, 10);
      const { rows } = await pool.query(
        'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username',
        [username.toLowerCase(), hash]
      );
      res.json({ token: createToken(rows[0]), username: rows[0].username });
    } catch (e) {
      if (e.code === '23505') return res.status(409).json({ error: 'שם המשתמש כבר קיים' });
      console.error(e);
      res.status(500).json({ error: 'שגיאת שרת' });
    }
  });

  router.post('/login', loginLimiter, async (req, res) => {
    const { username, password } = req.body;
    const lowerUser = (username || '').toLowerCase();
    try {
      const { rows } = await pool.query('SELECT * FROM users WHERE username = $1', [lowerUser]);
      const user = rows[0];
      // Always run bcrypt to prevent timing-based username enumeration
      const valid = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
      if (!valid || !user) return res.status(401).json({ error: 'שם משתמש או סיסמא שגויים' });
      res.json({ token: createToken(user), username: user.username });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'שגיאת שרת' });
    }
  });

  router.post('/change-password', auth, async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    if (!newPassword || newPassword.length < 6)
      return res.status(400).json({ error: 'סיסמא חדשה חייבת להכיל לפחות 6 תווים' });
    try {
      const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
      if (!rows[0] || !(await bcrypt.compare(currentPassword, rows[0].password_hash)))
        return res.status(401).json({ error: 'סיסמא נוכחית שגויה' });
      const hash = await bcrypt.hash(newPassword, 10);
      await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.user.id]);
      res.json({ ok: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'שגיאת שרת' });
    }
  });

  return router;
};
