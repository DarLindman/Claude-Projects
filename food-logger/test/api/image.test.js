'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { detectImageType } = require('../../src/lib/image');
const { buildTestApp, signedIn } = require('../helpers/app');

// Minimal real files: only the header bytes matter for magic-byte detection.
const FILES = {
  'image/jpeg': Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]),
  'image/png': Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'),
  'image/gif': Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00\x00;', 'latin1'),
  'image/gif87': Buffer.from('GIF87a\x01\x00\x01\x00\x00\x00\x00;', 'latin1'),
  'image/webp': Buffer.from('RIFF\x1a\x00\x00\x00WEBPVP8 ', 'latin1'),
};

test('detectImageType recognises each supported type from its magic bytes', () => {
  assert.equal(detectImageType(FILES['image/jpeg']), 'image/jpeg');
  assert.equal(detectImageType(FILES['image/png']), 'image/png');
  assert.equal(detectImageType(FILES['image/gif']), 'image/gif');
  assert.equal(detectImageType(FILES['image/gif87']), 'image/gif');
  assert.equal(detectImageType(FILES['image/webp']), 'image/webp');
});

test('detectImageType returns null for non-images, truncated headers and other RIFF files', () => {
  assert.equal(detectImageType(crypto.randomBytes(64).fill(0x41, 0, 1)), null);
  assert.equal(detectImageType(Buffer.from('not an image at all')), null);
  assert.equal(detectImageType(Buffer.alloc(0)), null);
  assert.equal(detectImageType(Buffer.from([0xff, 0xd8])), null);
  assert.equal(detectImageType(Buffer.from('89504e47', 'hex')), null);
  assert.equal(detectImageType(Buffer.from('RIFF\x1a\x00\x00\x00WAVEfmt ', 'latin1')), null, 'RIFF but WAVE');
  assert.equal(detectImageType(Buffer.from('%PDF-1.4')), null);
  assert.equal(detectImageType('a string'), null);
  assert.equal(detectImageType(null), null);
});

let ctx;
before(async () => { ctx = await buildTestApp({ limits: { analyzePerHour: 1000 } }); });
after(async () => { await ctx.pool.end(); });

test('a PNG declared as image/jpeg is sent to Anthropic as image/png', async () => {
  const c = await signedIn(ctx.app, 'imgdetect');
  ctx.anthropic.calls.length = 0;
  const b64 = FILES['image/png'].toString('base64');
  const res = await c.post('/api/analyze', { imageBase64: b64, mimeType: 'image/jpeg' });
  assert.equal(res.status, 200);
  const src = ctx.anthropic.calls[0].messages[0].content[0].source;
  assert.equal(src.media_type, 'image/png');
  assert.equal(src.data, b64);
});

test('each supported type is sent with its detected media type, even with a data: prefix and a lying mime', async () => {
  const c = await signedIn(ctx.app, 'imgdetect2');
  for (const [type, file] of [['image/jpeg', FILES['image/jpeg']], ['image/gif', FILES['image/gif']], ['image/webp', FILES['image/webp']]]) {
    ctx.anthropic.calls.length = 0;
    const res = await c.post('/api/analyze', { imageBase64: `data:image/png;base64,${file.toString('base64')}`, mimeType: 'application/x-evil' });
    assert.equal(res.status, 200, type);
    assert.equal(ctx.anthropic.calls[0].messages[0].content[0].source.media_type, type);
  }
});

test('bytes that are not an image give 400 IMAGE_INVALID and never reach Anthropic', async () => {
  const c = await signedIn(ctx.app, 'imgdetect3');
  ctx.anthropic.calls.length = 0;
  for (const payload of [Buffer.from('<?php echo 1; ?>'), Buffer.from('%PDF-1.4 hello'), crypto.randomBytes(200).fill(0x00, 0, 4)]) {
    const res = await c.post('/api/analyze', { imageBase64: payload.toString('base64'), mimeType: 'image/jpeg' });
    assert.equal(res.status, 400);
    assert.deepEqual(res.body, { error: { code: 'IMAGE_INVALID' } });
  }
  const notBase64 = await c.post('/api/analyze', { imageBase64: '!!!!', mimeType: 'image/jpeg' });
  assert.equal(notBase64.status, 400);
  assert.equal(notBase64.body.error.code, 'IMAGE_INVALID');
  assert.equal(ctx.anthropic.calls.length, 0);
});
