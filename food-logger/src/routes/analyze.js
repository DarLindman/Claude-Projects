'use strict';

const express = require('express');
const { AnalysisParseError, analyzeImage, analyzeText } = require('../lib/analysis');

module.exports = function analyzeRoutes({ anthropic, auth, analyzeLimiter }) {
  const router = express.Router();

  // ─── Analyze food image ─────────────────────────────────────────────────────
  router.post('/analyze', auth, analyzeLimiter, async (req, res) => {
    const { imageBase64: raw, mimeType: mime } = req.body;
    if (!raw) return res.status(400).json({ error: 'No image provided' });
    const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    const mimeType = ALLOWED_MIME.includes(mime) ? mime : 'image/jpeg';
    const imageBase64 = raw.replace(/^data:[^;]+;base64,/, '');
    try {
      res.json(await analyzeImage(anthropic, { imageBase64, mimeType }));
    } catch (e) {
      if (e instanceof AnalysisParseError) return res.status(500).json({ error: 'לא ניתן לנתח את תגובת ה-AI' });
      console.error(e);
      res.status(500).json({ error: 'שגיאה בניתוח התמונה' });
    }
  });

  // ─── Analyze food text ──────────────────────────────────────────────────────
  router.post('/analyze-text', auth, analyzeLimiter, async (req, res) => {
    const { text } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: 'No text provided' });
    if (text.length > 500) return res.status(400).json({ error: 'תיאור ארוך מדי (מקסימום 500 תווים)' });
    try {
      res.json(await analyzeText(anthropic, text));
    } catch (e) {
      if (e instanceof AnalysisParseError) return res.status(500).json({ error: 'לא ניתן לנתח את תגובת ה-AI' });
      console.error(e);
      res.status(500).json({ error: 'שגיאה בניתוח הטקסט' });
    }
  });

  return router;
};
