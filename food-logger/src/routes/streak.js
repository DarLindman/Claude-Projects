'use strict';

const express = require('express');
const { z } = require('zod');
const { asyncHandler } = require('../middleware/errors');
const { validate } = require('../middleware/validate');
const S = require('../lib/schemas');
const { utcToday, addDaysUtc } = require('../lib/dates');

const streakQuery = z.object({ today: S.optionalQuery(S.dateStr) });

module.exports = function streakRoutes({ pool, auth }) {
  const router = express.Router();

  // ─── Streak ─────────────────────────────────────────────────────────────────
  // Days are the wall-clock dates stored in logged_at (the session is pinned to UTC, and the
  // browser writes its local time), and `today` is the browser's own date.
  router.get('/', auth, validate({ query: streakQuery }), asyncHandler(async (req, res) => {
    const today = req.valid.query.today ?? utcToday();
    // ::text forces pg to return a 'YYYY-MM-DD' string, not a Date object
    const { rows } = await pool.query(
      `SELECT DISTINCT logged_at::date::text AS day FROM food_logs
       WHERE user_id=$1 AND logged_at::date <= $2::date ORDER BY day DESC`,
      [req.user.id, today]
    );
    const days = rows.map((r) => r.day);
    if (!days.length) return res.json({ streak: 0, lastLogDate: null });
    const lastLogDate = days[0];
    if (lastLogDate !== today && lastLogDate !== addDaysUtc(today, -1)) return res.json({ streak: 0, lastLogDate });
    let streak = 0;
    let expected = lastLogDate;
    for (const day of days) {
      if (day !== expected) break;
      streak++;
      expected = addDaysUtc(expected, -1);
    }
    res.json({ streak, lastLogDate });
  }));

  return router;
};
