'use strict';

const express = require('express');
const { z } = require('zod');
const { asyncHandler } = require('../middleware/errors');
const { validate } = require('../middleware/validate');
const S = require('../lib/schemas');

const weeklyQuery = z.object({ start: S.optionalQuery(S.dateStr) });
const monthlyQuery = z.object({ month: S.optionalQuery(S.monthStr) });
const yearlyQuery = z.object({ year: S.optionalQuery(S.yearStr) });

module.exports = function statsRoutes({ pool, auth }) {
  const router = express.Router();

  // ─── Statistics ─────────────────────────────────────────────────────────────
  // Weekly summary — returns 7 days of daily totals
  router.get('/weekly', auth, validate({ query: weeklyQuery }), asyncHandler(async (req, res) => {
    const { start } = req.valid.query; // YYYY-MM-DD (start of week), defaults to 7 days ago
    const { rows } = await pool.query(`
    SELECT
      logged_at::date AS day,
      SUM(calories) AS calories,
      SUM(protein_g) AS protein_g,
      SUM(carbs_g) AS carbs_g,
      SUM(fat_g) AS fat_g,
      SUM(fiber_g) AS fiber_g
    FROM food_logs
    WHERE user_id=$1
      AND logged_at::date >= COALESCE($2::date, CURRENT_DATE - INTERVAL '6 days')
      AND logged_at::date <= COALESCE($2::date + INTERVAL '6 days', CURRENT_DATE)
    GROUP BY day
    ORDER BY day ASC
    `, [req.user.id, start || null]);
    res.json(rows);
  }));

  // Monthly summary — returns daily totals for a month
  router.get('/monthly', auth, validate({ query: monthlyQuery }), asyncHandler(async (req, res) => {
    const { month } = req.valid.query; // YYYY-MM, defaults to current month
    const { rows } = await pool.query(`
    SELECT
      logged_at::date AS day,
      SUM(calories) AS calories,
      SUM(protein_g) AS protein_g,
      SUM(carbs_g) AS carbs_g,
      SUM(fat_g) AS fat_g,
      SUM(fiber_g) AS fiber_g
    FROM food_logs
    WHERE user_id=$1
      AND logged_at::date >= DATE_TRUNC('month', COALESCE($2::date, CURRENT_DATE))::date
      AND logged_at::date <  (DATE_TRUNC('month', COALESCE($2::date, CURRENT_DATE)) + INTERVAL '1 month')::date
    GROUP BY day
    ORDER BY day ASC
    `, [req.user.id, month ? month + '-01' : null]);
    res.json(rows);
  }));

  // Yearly summary — returns monthly totals for a year
  router.get('/yearly', auth, validate({ query: yearlyQuery }), asyncHandler(async (req, res) => {
    const { year } = req.valid.query; // YYYY, defaults to current year
    const { rows } = await pool.query(`
    SELECT
      TO_CHAR(logged_at, 'YYYY-MM') AS month,
      SUM(calories) AS calories,
      SUM(protein_g) AS protein_g,
      SUM(carbs_g) AS carbs_g,
      SUM(fat_g) AS fat_g,
      SUM(fiber_g) AS fiber_g,
      COUNT(DISTINCT logged_at::date) AS day_count
    FROM food_logs
    WHERE user_id=$1
      AND logged_at >= make_date(COALESCE($2::int, EXTRACT(YEAR FROM CURRENT_DATE)::int), 1, 1)
      AND logged_at <  make_date(COALESCE($2::int, EXTRACT(YEAR FROM CURRENT_DATE)::int) + 1, 1, 1)
    GROUP BY month
    ORDER BY month ASC
    `, [req.user.id, year ?? null]);
    res.json(rows);
  }));

  return router;
};
