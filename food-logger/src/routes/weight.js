'use strict';

const express = require('express');
const { z } = require('zod');
const { AppError, asyncHandler } = require('../middleware/errors');
const { validate } = require('../middleware/validate');
const S = require('../lib/schemas');

const weightBody = z.object({
  weight_kg: S.rangedNumber(20, 500),
  logged_at: S.optionalQuery(S.dateStr).transform((v) => v ?? null), // missing/null/'' -> today
});
const idParams = z.object({ id: S.id });

module.exports = function weightRoutes({ pool, auth }) {
  const router = express.Router();

  // ─── Weight log endpoints ───────────────────────────────────────────────────
  router.post('/', auth, validate({ body: weightBody }), asyncHandler(async (req, res) => {
    const { weight_kg, logged_at } = req.valid.body;
    const { rows } = await pool.query(
      `INSERT INTO weight_logs (user_id, weight_kg, logged_at) VALUES ($1, $2, COALESCE($3::date, CURRENT_DATE)) RETURNING id, logged_at::text, weight_kg`,
      [req.user.id, weight_kg, logged_at]
    );
    res.json(rows[0]);
  }));

  router.get('/', auth, asyncHandler(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT id, logged_at::text, weight_kg FROM weight_logs WHERE user_id=$1 ORDER BY logged_at ASC LIMIT 1095`,
      [req.user.id]
    );
    res.json(rows);
  }));

  router.delete('/:id', auth, validate({ params: idParams }), asyncHandler(async (req, res) => {
    const { rowCount } = await pool.query(
      'DELETE FROM weight_logs WHERE id=$1 AND user_id=$2',
      [req.valid.params.id, req.user.id]
    );
    if (rowCount === 0) throw new AppError(404, 'NOT_FOUND');
    res.json({ ok: true });
  }));

  return router;
};
