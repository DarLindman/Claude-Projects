'use strict';

const express = require('express');

module.exports = function foodRoutes({ pool, auth }) {
  const router = express.Router();

  // ─── Food log CRUD ──────────────────────────────────────────────────────────
  router.post('/', auth, async (req, res) => {
    const { meal_type, food_name, calories, protein_g, carbs_g, fat_g, fiber_g, notes, logged_at } = req.body;
    if (!food_name) return res.status(400).json({ error: 'שם האוכל חסר' });
    if (food_name.length > 200) return res.status(400).json({ error: 'שם האוכל ארוך מדי (מקסימום 200 תווים)' });
    const toNum = (v, max = 99999) => { const n = v === undefined || v === null || v === '' ? null : +v; return (n === null || isNaN(n) || n < 0 || n > max) ? null : Math.round(n * 10) / 10; };
    const safeCalories = toNum(calories, 99999);
    const safeProtein = toNum(protein_g, 9999);
    const safeCarbs = toNum(carbs_g, 9999);
    const safeFat = toNum(fat_g, 9999);
    const safeFiber = toNum(fiber_g, 9999);
    try {
      const { rows } = await pool.query(
        `INSERT INTO food_logs (user_id, meal_type, food_name, calories, protein_g, carbs_g, fat_g, fiber_g, notes, logged_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, COALESCE($10::timestamptz, NOW())) RETURNING *`,
        [req.user.id, meal_type, food_name, safeCalories, safeProtein, safeCarbs, safeFat, safeFiber, notes, logged_at || null]
      );
      res.json(rows[0]);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'שגיאת שרת' });
    }
  });

  router.get('/', auth, async (req, res) => {
    const { date } = req.query; // YYYY-MM-DD
    try {
      let query, params;
      if (date) {
        query = `SELECT * FROM food_logs WHERE user_id=$1 AND logged_at::date = $2::date ORDER BY logged_at ASC`;
        params = [req.user.id, date];
      } else {
        query = `SELECT * FROM food_logs WHERE user_id=$1 ORDER BY logged_at DESC LIMIT 500`;
        params = [req.user.id];
      }
      const { rows } = await pool.query(query, params);
      res.json(rows);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'שגיאת שרת' });
    }
  });

  router.delete('/:id', auth, async (req, res) => {
    try {
      const { rowCount } = await pool.query(
        'DELETE FROM food_logs WHERE id=$1 AND user_id=$2',
        [req.params.id, req.user.id]
      );
      if (rowCount === 0) return res.status(404).json({ error: 'לא נמצא' });
      res.json({ ok: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'שגיאת שרת' });
    }
  });

  router.put('/:id', auth, async (req, res) => {
    const { food_name, calories, protein_g, carbs_g, fat_g, fiber_g, meal_type, logged_at, notes } = req.body;
    const VALID_MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack'];
    const trimmed = (food_name || '').trim();
    if (!trimmed) return res.status(400).json({ error: 'שם האוכל חסר' });
    if (trimmed.length > 200) return res.status(400).json({ error: 'שם האוכל ארוך מדי (מקסימום 200 תווים)' });
    if (!VALID_MEAL_TYPES.includes(meal_type)) return res.status(400).json({ error: 'סוג ארוחה לא תקין' });
    const toNum = (v, max = 99999) => { const n = (v === undefined || v === null || v === '') ? null : +v; return (n === null || isNaN(n) || n < 0 || n > max) ? null : Math.round(n * 10) / 10; };
    try {
      const { rows, rowCount } = await pool.query(
        `UPDATE food_logs
       SET food_name=$3, calories=$4, protein_g=$5, carbs_g=$6, fat_g=$7, fiber_g=$8,
           meal_type=$9, logged_at=COALESCE($10::timestamptz, logged_at), notes=$11
       WHERE id=$1 AND user_id=$2
       RETURNING *`,
        [req.params.id, req.user.id, trimmed,
         toNum(calories, 99999), toNum(protein_g, 9999), toNum(carbs_g, 9999),
         toNum(fat_g, 9999), toNum(fiber_g, 9999),
         meal_type, logged_at || null, notes ?? null]
      );
      if (rowCount === 0) return res.status(404).json({ error: 'לא נמצא' });
      res.json(rows[0]);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'שגיאת שרת' });
    }
  });

  return router;
};
