'use strict';

const { test, before, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { buildTestApp, signedIn, csrfHeaders } = require('../helpers/app');
const { MODEL } = require('../../src/lib/anthropic');
const { IMAGE_SYSTEM_PROMPT, IMAGE_USER_MESSAGE, TEXT_SYSTEM_PROMPT } = require('../../src/lib/analysis');
const { REPAIR_TEXT_SYSTEM_PROMPT } = require('../../src/lib/hebrewName');

// Real JPEG magic bytes (FF D8 FF E0 ... JFIF) so a future magic-byte check accepts it.
const JPEG_BASE64 = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]).toString('base64');

let ctx;
before(async () => {
  ctx = await buildTestApp({ limits: { analyzePerHour: 1000 } });
  mock.method(console, 'warn', () => {}); // the name guard logs every repaired or cleaned name
});
after(async () => { mock.restoreAll(); await ctx.pool.end(); });

test('MODEL is the pinned Haiku id', () => {
  assert.equal(MODEL, 'claude-haiku-4-5-20251001');
});

test('POST /api/analyze sums items, returns the clean dish name, sends model and image prompt', async () => {
  const c = await signedIn(ctx.app, 'imgUser');
  ctx.anthropic.calls.length = 0;
  const res = await c.post('/api/analyze', { imageBase64: JPEG_BASE64, mimeType: 'image/jpeg' });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, {
    foodName: 'עוף עם אורז',
    calories: 450,
    protein_g: 34,
    carbs_g: 44,
    fat_g: 12.5,
    fiber_g: 1,
  });
  assert.equal(ctx.anthropic.calls.length, 1);
  const call = ctx.anthropic.calls[0];
  // the image analysis runs on the configured model (IMAGE_MODEL, default Sonnet: no temperature)
  assert.equal(call.model, 'claude-sonnet-5-5');
  assert.equal(call.system, IMAGE_SYSTEM_PROMPT);
  assert.equal('temperature' in call, false);
  assert.equal(call.messages[0].content[1].text, IMAGE_USER_MESSAGE);
  assert.equal(call.messages[0].content[0].source.data, JPEG_BASE64);
  assert.equal(call.messages[0].content[0].source.media_type, 'image/jpeg');
});

test('POST /api/analyze strips a data: URL prefix and falls back to image/jpeg for unknown mime', async () => {
  const c = await signedIn(ctx.app, 'imgUser2');
  ctx.anthropic.calls.length = 0;
  const res = await c.post('/api/analyze', { imageBase64: `data:image/jpeg;base64,${JPEG_BASE64}`, mimeType: 'application/x-evil' });
  assert.equal(res.status, 200);
  const src = ctx.anthropic.calls[0].messages[0].content[0].source;
  assert.equal(src.data, JPEG_BASE64);
  assert.equal(src.media_type, 'image/jpeg');
});

test('POST /api/analyze without image returns 400', async () => {
  const c = await signedIn(ctx.app, 'imgUser3');
  const res = await c.post('/api/analyze', {});
  assert.equal(res.status, 400);
  assert.deepEqual(res.body, { error: { code: 'VALIDATION' }, fields: { imageBase64: 'REQUIRED' } });
});

// The old silent "translator" call was replaced by the guard's repair call
// (see hebrewName.js, text mode): same trigger (non-Hebrew letters only), same number of calls.
test('POST /api/analyze-text repairs a non-Hebrew name with the guard repair call', async () => {
  const c = await signedIn(ctx.app, 'txtUser');
  ctx.anthropic.calls.length = 0;
  const res = await c.post('/api/analyze-text', { text: 'salad' });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { foodName: 'סלט', calories: 145, protein_g: 4, carbs_g: 22, fat_g: 5, fiber_g: 4 });
  assert.equal(ctx.anthropic.calls.length, 2);
  assert.equal(ctx.anthropic.calls[0].model, MODEL);
  assert.equal(ctx.anthropic.calls[0].system, TEXT_SYSTEM_PROMPT);
  assert.equal(ctx.anthropic.calls[1].system, REPAIR_TEXT_SYSTEM_PROMPT);
});

test('POST /api/analyze-text keeps a Hebrew name unchanged (no translation call)', async () => {
  const c = await signedIn(ctx.app, 'txtUser2');
  ctx.anthropic.calls.length = 0;
  const res = await c.post('/api/analyze-text', { text: '  סלט ולחם  ' });
  assert.equal(res.status, 200);
  assert.equal(res.body.foodName, 'סלט ולחם');
  assert.equal(ctx.anthropic.calls.length, 1);
});

test('POST /api/analyze-text validates input', async () => {
  const c = await signedIn(ctx.app, 'txtUser3');
  const empty = await c.post('/api/analyze-text', { text: '   ' });
  assert.equal(empty.status, 400);
  assert.deepEqual(empty.body, { error: { code: 'VALIDATION' }, fields: { text: 'REQUIRED' } });
  const long = await c.post('/api/analyze-text', { text: 'א'.repeat(501) });
  assert.equal(long.status, 400);
  assert.deepEqual(long.body, { error: { code: 'VALIDATION' }, fields: { text: 'TOO_LONG' } });
});

test('analyze endpoints require auth', async () => {
  const a = await request(ctx.app).post('/api/analyze').set(csrfHeaders(ctx.config)).send({ imageBase64: JPEG_BASE64 });
  assert.equal(a.status, 401);
  const t = await request(ctx.app).post('/api/analyze-text').set(csrfHeaders(ctx.config)).send({ text: 'salad' });
  assert.equal(t.status, 401);
});

test('analyze limiter allows analyzePerHour requests then returns 429', async () => {
  const limited = await buildTestApp({ limits: { analyzePerHour: 1 } });
  try {
    const c = await signedIn(limited.app, 'limited');
    assert.equal((await c.post('/api/analyze-text', { text: 'סלט' })).status, 200);
    assert.equal((await c.post('/api/analyze-text', { text: 'סלט' })).status, 429);
  } finally {
    await limited.pool.end();
  }
});
