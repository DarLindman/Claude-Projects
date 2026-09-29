'use strict';

const express = require('express');

module.exports = function profileRoutes({ pool, auth }) {
  const router = express.Router();

  // ─── Profile endpoints ──────────────────────────────────────────────────────
  router.get('/', auth, async (req, res) => {
    try {
      const { rows } = await pool.query('SELECT profile_json FROM user_profiles WHERE user_id=$1', [req.user.id]);
      if (!rows[0]) return res.json({});
      try {
        res.json(JSON.parse(rows[0].profile_json));
      } catch {
        console.error('Corrupt profile_json for user', req.user.id);
        res.json({});
      }
    } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
  });

  const PROFILE_ALLOWED_KEYS = new Set(['gender', 'birthDate', 'height', 'weight', 'activity', 'goalKg']);
  router.put('/', auth, async (req, res) => {
    try {
      const sanitized = Object.fromEntries(
        Object.entries(req.body).filter(([k]) => PROFILE_ALLOWED_KEYS.has(k))
      );
      const json = JSON.stringify(sanitized);
      await pool.query(
        `INSERT INTO user_profiles (user_id, profile_json) VALUES ($1,$2)
       ON CONFLICT (user_id) DO UPDATE SET profile_json=$2`,
        [req.user.id, json]
      );
      res.json({ ok: true });
    } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
  });

  return router;
};
