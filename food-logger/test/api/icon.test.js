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

// ── installability: the manifest lists real PNG icons ──────────────────────────────

const PUBLIC = path.join(__dirname, '..', '..', 'public');
const manifest = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'manifest.json'), 'utf8'));
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function pngSize(buf) {
  assert.deepEqual([...buf.subarray(0, 8)], PNG_SIGNATURE, 'PNG signature');
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}

test('the manifest colours are the leather colour of the cover', () => {
  const tokens = fs.readFileSync(path.join(PUBLIC, 'css', 'tokens.css'), 'utf8');
  const leather = /--leather:\s*(#[0-9a-f]{6})/i.exec(tokens)[1].toLowerCase();
  assert.equal(manifest.theme_color.toLowerCase(), leather);
  assert.equal(manifest.background_color.toLowerCase(), leather);
});

test('the manifest lists 192 and 512 PNG icons and a maskable 512, and the test app serves them', async () => {
  const pngs = manifest.icons.filter((i) => i.type === 'image/png');
  const sizesOf = (purpose) => pngs.filter((i) => (i.purpose || 'any') === purpose).map((i) => i.sizes).sort();
  assert.ok(sizesOf('any').includes('192x192'), 'a plain 192 icon');
  assert.ok(sizesOf('any').includes('512x512'), 'a plain 512 icon');
  assert.deepEqual(sizesOf('maskable'), ['512x512'], 'one maskable 512 icon');

  // /apple-touch-icon.png is a route fed by the startup buffer; the other icons are static files
  const ctx = await buildTestApp({ icon: fs.readFileSync(path.join(PUBLIC, 'apple-touch-icon.png')) });
  try {
    for (const icon of pngs) {
      const res = await request(ctx.app).get(icon.src).buffer(true).parse((r, cb) => {
        const chunks = [];
        r.on('data', (c) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
      assert.equal(res.status, 200, icon.src);
      assert.equal(res.headers['content-type'], 'image/png', icon.src);
      const [w, h] = pngSize(res.body);
      assert.equal(`${w}x${h}`, icon.sizes, `${icon.src} really is ${icon.sizes}`);
    }
  } finally {
    await ctx.pool.end();
  }
});

test('buildIcon renders every icon of the manifest into the given dir, the maskable one full-bleed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'icon-'));
  try {
    buildIcon(dir);
    for (const icon of manifest.icons.filter((i) => i.type === 'image/png')) {
      const file = path.join(dir, path.basename(icon.src));
      assert.ok(fs.existsSync(file), `${icon.src} is written by buildIcon`);
      const [w, h] = pngSize(fs.readFileSync(file));
      assert.equal(`${w}x${h}`, icon.sizes);
    }
    // Decoded corner pixels: transparent for the rounded plain icon, solid orange for the maskable one.
    const { loadImage, createCanvas } = require('@napi-rs/canvas');
    const corner = async (file) => {
      const img = await loadImage(fs.readFileSync(path.join(dir, file)));
      const c = createCanvas(img.width, img.height);
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0);
      return [...g.getImageData(1, 1, 1, 1).data];
    };
    return Promise.all([corner('icon-512.png'), corner('icon-maskable-512.png')]).then(([plain, maskable]) => {
      assert.equal(plain[3], 0, 'the plain icon has rounded (transparent) corners');
      assert.deepEqual(maskable, [0xe8, 0x70, 0x3a, 255], 'the maskable icon fills the whole square');
    }).finally(() => fs.rmSync(dir, { recursive: true, force: true }));
  } catch (e) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw e;
  }
});

test('the committed icons in public/ are exactly what buildIcon renders', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'icon-'));
  try {
    buildIcon(dir);
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.png'));
    assert.deepEqual(files.sort(), ['apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png']);
    for (const f of files) {
      assert.ok(fs.readFileSync(path.join(dir, f)).equals(fs.readFileSync(path.join(PUBLIC, f))), `public/${f} is stale: run buildIcon and commit the result`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
