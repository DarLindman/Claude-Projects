'use strict';

const express = require('express');
const { z } = require('zod');
const { asyncHandler } = require('../middleware/errors');
const { validate } = require('../middleware/validate');
const S = require('../lib/schemas');

// Allow-listed keys only (unknown keys are stripped); permissive on ranges. The numeric fields
// accept numeric strings too (legacy stored profiles) and are stored as numbers.
// Values mirror what the client sends: gender 'male'|'female', activity one of
// sedentary|light|moderate|active|vactive (a legacy numeric multiplier is tolerated),
// goalKg (the UI offers -1..1; kept loose, an existing test stores 55), birthDate '' or YYYY-MM-DD, height/weight numbers (0 = unset),
// goalWeight (the target weight in kg: 0 = unset, else 20..400, stored with one decimal).
const profileBody = z.object({
  gender: S.noNul.max(20),
  birthDate: z.union([z.literal(''), S.dateStr]),
  height: S.looseNumber(0, 300),
  weight: S.looseNumber(0, 700),
  activity: z.union([S.noNul.max(20), z.number().min(0).max(10)]),
  goalKg: S.looseNumber(-1000, 1000),
  goalWeight: S.zeroOrRangedNumber(20, 400),
}).partial();

module.exports = function profileRoutes({ pool, auth }) {
  const router = express.Router();

  // ─── Profile endpoints ──────────────────────────────────────────────────────
  router.get('/', auth, asyncHandler(async (req, res) => {
    const { rows } = await pool.query('SELECT profile_json FROM user_profiles WHERE user_id=$1', [req.user.id]);
    if (!rows[0]) return res.json({});
    try {
      res.json(JSON.parse(rows[0].profile_json));
    } catch {
      console.error('Corrupt profile_json for user', req.user.id);
      res.json({});
    }
  }));

  router.put('/', auth, validate({ body: profileBody }), asyncHandler(async (req, res) => {
    const json = JSON.stringify(req.valid.body);
    await pool.query(
      `INSERT INTO user_profiles (user_id, profile_json) VALUES ($1,$2)
       ON CONFLICT (user_id) DO UPDATE SET profile_json=$2`,
      [req.user.id, json]
    );
    res.json({ ok: true });
  }));

  return router;
};
