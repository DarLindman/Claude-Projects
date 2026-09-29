'use strict';

const express = require('express');

module.exports = function streakRoutes({ pool, auth }) {
  const router = express.Router();

  // ─── Streak ─────────────────────────────────────────────────────────────────
  router.get('/', auth, async (req, res) => {
    try {
      // ::text forces pg to return 'YYYY-MM-DD' string, not a Date object
      const { rows } = await pool.query(
        `SELECT DISTINCT (logged_at AT TIME ZONE 'UTC')::date::text AS day FROM food_logs WHERE user_id=$1 ORDER BY day DESC`,
        [req.user.id]
      );
      const days = rows.map(r => r.day); // already 'YYYY-MM-DD' strings
      if (!days.length) return res.json({ streak: 0, lastLogDate: null });
      // Use Israel timezone to match how the frontend stores logged_at (local time sent as-is)
      const toIsraelDate = (d) => d.toLocaleString('sv', { timeZone: 'Asia/Jerusalem' }).slice(0, 10);
      const today = toIsraelDate(new Date());
      const yesterday = toIsraelDate(new Date(Date.now() - 86400000));
      if (days[0] !== today && days[0] !== yesterday) return res.json({ streak: 0, lastLogDate: days[0] });
      let streak = 0;
      let expected = days[0];
      for (const day of days) {
        if (day !== expected) break;
        streak++;
        // advance expected to previous day using UTC arithmetic
        const d = new Date(expected + 'T12:00:00Z');
        d.setUTCDate(d.getUTCDate() - 1);
        expected = d.toISOString().slice(0, 10);
      }
      // Get the most recent log date in Israel timezone (consistent with streak calculation)
      const lastRow = await pool.query(
        `SELECT MAX((logged_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Jerusalem')::date)::text AS last_date FROM food_logs WHERE user_id = $1`,
        [req.user.id]
      );
      const lastLogDate = lastRow.rows[0]?.last_date ?? null;
      res.json({ streak, lastLogDate });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'שגיאת שרת' });
    }
  });

  return router;
};
