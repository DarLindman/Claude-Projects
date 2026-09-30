'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');
const { buildTestApp } = require('../helpers/app');
const { buildIcon } = require('../../src/lib/icon');

const ICON_PATHS = ['/favicon.ico', '/apple-touch-icon.png', '/apple-touch-icon-precomposed.png'];

test('icon routes serve the PNG buffer when one is provided', async () => {
  const icon = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  const ctx = await buildTestApp({ icon });
  try {
    for (const p of ICON_PATHS) {
      const res = await request(ctx.app).get(p);
      assert.equal(res.status, 200, p);
      assert.equal(res.headers['content-type'], 'image/png', p);
      assert.deepEqual(res.body, icon, p);
    }
  } finally {
    await ctx.pool.end();
  }
});

test('icon routes redirect to /icon.svg when there is no icon buffer', async () => {
  const ctx = await buildTestApp();
  try {
    for (const p of ICON_PATHS) {
      const res = await request(ctx.app).get(p).redirects(0);
      assert.equal(res.status, 302, p);
      assert.equal(res.headers.location, '/icon.svg', p);
    }
  } finally {
    await ctx.pool.end();
  }
});

test('buildIcon renders a 180x180 PNG and writes apple-touch-icon.png into the given dir', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'icon-'));
  try {
    const buf = buildIcon(dir);
    assert.ok(Buffer.isBuffer(buf));
    assert.deepEqual([...buf.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
    assert.equal(buf.readUInt32BE(16), 180);
    assert.equal(buf.readUInt32BE(20), 180);
    assert.deepEqual(fs.readFileSync(path.join(dir, 'apple-touch-icon.png')), buf);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
