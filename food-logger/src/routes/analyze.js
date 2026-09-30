'use strict';

const express = require('express');
const { z } = require('zod');
const { analyzeImage, analyzeText } = require('../lib/analysis');
const { detectImageType } = require('../lib/image');
const { AppError, asyncHandler } = require('../middleware/errors');
const { validate } = require('../middleware/validate');
const { noNul } = require('../lib/schemas');

// Body parsers live here, not in app.js: they run after auth and the per-user limit so
// callers who are unauthenticated or over budget never get a body (up to 8 MB) parsed.
const jsonImage = express.json({ limit: '8mb' });
const jsonText = express.json({ limit: '100kb' });

// mimeType is deliberately not read: the real type comes from the magic bytes.
const imageBody = z.object({ imageBase64: z.string().min(1) });
// Length is checked before trimming (as before); a blank text counts as missing.
const textBody = z.object({ text: noNul.max(500).transform((s) => s.trim()).pipe(z.string().min(1)) });

// Any failure of the AI call (SDK error, empty or unparseable reply) is a 502 whose
// body never carries upstream text; the details go to the server log with the request id.
async function callAi(req, fn) {
  try {
    return await fn();
  } catch (e) {
    console.error(`[${req.id}] AI request failed:`, e);
    throw new AppError(502, 'AI_UNAVAILABLE');
  }
}

module.exports = function analyzeRoutes({ anthropic, auth, analyzeLimiter, analyzeIpLimiter }) {
  const router = express.Router();

  // ─── Analyze food image ─────────────────────────────────────────────────────
  router.post('/analyze', auth, analyzeLimiter, analyzeIpLimiter, jsonImage, validate({ body: imageBody }), asyncHandler(async (req, res) => {
    const raw = req.valid.body.imageBase64.replace(/^data:[^;]+;base64,/, '');
    const bytes = Buffer.from(raw, 'base64');
    const mimeType = detectImageType(bytes);
    if (!mimeType) throw new AppError(400, 'IMAGE_INVALID');
    const imageBase64 = bytes.toString('base64');
    res.json(await callAi(req, () => analyzeImage(anthropic, { imageBase64, mimeType })));
  }));

  // ─── Analyze food text ──────────────────────────────────────────────────────
  router.post('/analyze-text', auth, analyzeLimiter, analyzeIpLimiter, jsonText, validate({ body: textBody }), asyncHandler(async (req, res) => {
    const { text } = req.valid.body;
    res.json(await callAi(req, () => analyzeText(anthropic, text)));
  }));

  return router;
};
