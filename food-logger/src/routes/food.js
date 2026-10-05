'use strict';

const express = require('express');
const { z } = require('zod');
const { AppError, asyncHandler } = require('../middleware/errors');
const { validate } = require('../middleware/validate');
const S = require('../lib/schemas');

// Shared by POST and PUT. Out-of-range numbers are rejected; missing/null/'' store NULL.
const foodBody = z.object({
  meal_type: S.mealType,
  food_name: S.foodName,
  calories: S.nullableNumber(99999, { integer: true }), // INTEGER column
  protein_g: S.nullableNumber(9999),
  carbs_g: S.nullableNumber(9999),
  fat_g: S.nullableNumber(9999),
  fiber_g: S.nullableNumber(9999),
  notes: S.noNul.nullish(),
  logged_at: S.loggedAt,
});
const idParams = z.object({ id: S.id });
// The list rows are the table's columns plus whether the meal has a thumbnail (never its bytes).
const LIST_COLUMNS = 'f.*, EXISTS (SELECT 1 FROM food_photos p WHERE p.food_log_id = f.id) AS has_photo';
const listQuery = z.object({ date: S.optionalQuery(S.dateStr) });

module.exports = function foodRoutes({ pool, auth }) {
  const router = express.Router();

  // ─── Food log CRUD ──────────────────────────────────────────────────────────
  router.post('/', auth, validate({ body: foodBody }), asyncHandler(async (req, res) => {
    const b = req.valid.body;
    const { rows } = await pool.query(
      `INSERT INTO food_logs (user_id, meal_type, food_name, calories, protein_g, carbs_g, fat_g, fiber_g, notes, logged_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, COALESCE($10::timestamptz, NOW())) RETURNING *`,
      [req.user.id, b.meal_type, b.food_name, b.calories, b.protein_g, b.carbs_g, b.fat_g, b.fiber_g, b.notes ?? null, b.logged_at]
    );
    res.json(rows[0]);
  }));

  router.get('/', auth, validate({ query: listQuery }), asyncHandler(async (req, res) => {
    const { date } = req.valid.query; // YYYY-MM-DD
    let query, params;
    if (date) {
      query = `SELECT ${LIST_COLUMNS} FROM food_logs f WHERE f.user_id=$1 AND f.logged_at::date = $2::date ORDER BY f.logged_at ASC`;
      params = [req.user.id, date];
    } else {
      query = `SELECT ${LIST_COLUMNS} FROM food_logs f WHERE f.user_id=$1 ORDER BY f.logged_at DESC LIMIT 500`;
      params = [req.user.id];
    }
    const { rows } = await pool.query(query, params);
    res.json(rows);
  }));

  router.delete('/:id', auth, validate({ params: idParams }), asyncHandler(async (req, res) => {
    const { rowCount } = await pool.query(
      'DELETE FROM food_logs WHERE id=$1 AND user_id=$2',
      [req.valid.params.id, req.user.id]
    );
    if (rowCount === 0) throw new AppError(404, 'NOT_FOUND');
    res.json({ ok: true });
  }));

  router.put('/:id', auth, validate({ params: idParams, body: foodBody }), asyncHandler(async (req, res) => {
    const b = req.valid.body;
    const { rows, rowCount } = await pool.query(
      `UPDATE food_logs
       SET food_name=$3, calories=$4, protein_g=$5, carbs_g=$6, fat_g=$7, fiber_g=$8,
           meal_type=$9, logged_at=COALESCE($10::timestamptz, logged_at), notes=$11
       WHERE id=$1 AND user_id=$2
       RETURNING *`,
      [req.valid.params.id, req.user.id, b.food_name, b.calories, b.protein_g, b.carbs_g, b.fat_g, b.fiber_g,
       b.meal_type, b.logged_at, b.notes ?? null]
    );
    if (rowCount === 0) throw new AppError(404, 'NOT_FOUND');
    res.json(rows[0]);
  }));

  return router;
};
