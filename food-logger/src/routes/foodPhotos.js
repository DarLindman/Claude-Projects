'use strict';

const crypto = require('crypto');
const express = require('express');
const { z } = require('zod');
const { AppError, asyncHandler } = require('../middleware/errors');
const { validate } = require('../middleware/validate');
const { detectImageType, parseJpegSize } = require('../lib/image');
const S = require('../lib/schemas');

const MAX_PHOTO_BYTES = 122_880; // 120 KB: a thumbnail, never a full photo
const MAX_PHOTO_SIDE = 640; // pixels, each side
const idParams = z.object({ id: S.id });

// The parser's own cap sits a little above the real one so that a body just over 120 KB is
// refused by the explicit check below; both end in the same 400 VALIDATION (the existing
// body-too-large mapping of errors.js). Only `image/jpeg` is parsed; any other content type
// leaves req.body unparsed and fails the Buffer check.
const rawJpeg = express.raw({ type: 'image/jpeg', limit: '130kb' });

// Thumbnails of meals: PUT stores or replaces one, GET serves it to its owner. Ownership is
// part of every query, so a foreign meal id and a nonexistent one are indistinguishable (404).
module.exports = function foodPhotoRoutes({ pool, auth, photoLimiter, photoIpLimiter }) {
  const router = express.Router();

  router.put('/:id/photo', auth, photoIpLimiter, photoLimiter, validate({ params: idParams }), rawJpeg, asyncHandler(async (req, res) => {
    const bytes = req.body;
    const size = Buffer.isBuffer(bytes) ? parseJpegSize(bytes) : null;
    if (!Buffer.isBuffer(bytes) || bytes.length === 0 || detectImageType(bytes) !== 'image/jpeg'
        || !size || size.width > MAX_PHOTO_SIDE || size.height > MAX_PHOTO_SIDE) {
      throw new AppError(400, 'VALIDATION', { photo: 'INVALID' });
    }
    if (bytes.length > MAX_PHOTO_BYTES) throw new AppError(400, 'VALIDATION');
    // One statement: the row is written only when the meal exists and belongs to this user.
    const { rowCount } = await pool.query(
      `INSERT INTO food_photos (food_log_id, bytes)
       SELECT id, $3 FROM food_logs WHERE id = $1 AND user_id = $2
       ON CONFLICT (food_log_id) DO UPDATE SET bytes = EXCLUDED.bytes, created_at = NOW()`,
      [req.valid.params.id, req.user.id, bytes]
    );
    if (rowCount === 0) throw new AppError(404, 'NOT_FOUND');
    res.json({ ok: true });
  }));

  router.get('/:id/photo', auth, validate({ params: idParams }), asyncHandler(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT p.bytes FROM food_photos p JOIN food_logs f ON f.id = p.food_log_id
       WHERE p.food_log_id = $1 AND f.user_id = $2`,
      [req.valid.params.id, req.user.id]
    );
    if (rows.length === 0) throw new AppError(404, 'NOT_FOUND');
    // Never served from the browser cache without asking: after a sign-out on a shared device the next person would otherwise
    // be handed the previous one's thumbnail. The ETag (a strong hash of the bytes) makes the revalidation cheap, and it is
    // answered only here, after auth and the ownership query above, so another user can never get a 304 or the bytes.
    const bytes = rows[0].bytes;
    res.set('Cache-Control', 'private, no-cache');
    res.vary('Cookie');
    res.set('ETag', `"${crypto.createHash('sha1').update(bytes).digest('hex')}"`);
    res.type('image/jpeg').send(bytes);   // Express answers 304 itself when If-None-Match matches
  }));

  return router;
};
