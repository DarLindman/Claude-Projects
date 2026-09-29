'use strict';

const express = require('express');

module.exports = function weightRoutes({ pool, auth }) {
  const router = express.Router();

  // ─── Weight log endpoints ───────────────────────────────────────────────────
  router.post('/', auth, async (req, res) => {
    const { weight_kg, logged_at } = req.body;
    if (!weight_kg || isNaN(+weight_kg)) return res.status(400).json({ error: 'משקל לא תקין' });
    try {
      const { rows } = await pool.query(
        `INSERT INTO weight_logs (user_id, weight_kg, logged_at) VALUES ($1, $2, COALESCE($3::date, CURRENT_DATE)) RETURNING id, logged_at::text, weight_kg`,
        [req.user.id, +weight_kg, logged_at || null]
      );
      res.json(rows[0]);
    } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
  });

  router.get('/', auth, async (req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT id, logged_at::text, weight_kg FROM weight_logs WHERE user_id=$1 ORDER BY logged_at ASC LIMIT 1095`,
        [req.user.id]
      );
      res.json(rows);
    } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
  });

  router.delete('/:id', auth, async (req, res) => {
    try {
      const { rowCount } = await pool.query(
        'DELETE FROM weight_logs WHERE id=$1 AND user_id=$2',
        [req.params.id, req.user.id]
      );
      if (rowCount === 0) return res.status(404).json({ error: 'לא נמצא' });
      res.json({ ok: true });
    } catch (e) { console.error(e); res.status(500).json({ error: 'שגיאת שרת' }); }
  });

  return router;
};
