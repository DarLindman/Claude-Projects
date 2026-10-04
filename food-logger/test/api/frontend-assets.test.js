'use strict';

// Everything under public/ is something the app uses: a stylesheet or module the page loads, a font
// the CSS declares, or an icon the page or the manifest names. A file nothing refers to (the videos
// of the old salad logo, for example) is dead weight and is removed.

const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const PUBLIC = path.join(__dirname, '..', '..', 'public');
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const rel = (f) => path.relative(PUBLIC, f).split(path.sep).join('/');
const files = walk(PUBLIC).map(rel);

test('no video file is shipped', () => {
  assert.deepEqual(files.filter((f) => /\.(mp4|webm|mov)$/i.test(f)), []);
});

test('every static file other than the page, styles, modules and fonts is named by the page, the manifest, a stylesheet or a module', () => {
  const readers = files.filter((f) => /\.(html|css|js|json)$/.test(f));
  const haystack = readers.map((f) => fs.readFileSync(path.join(PUBLIC, f), 'utf8')).join('\n');
  const loose = files.filter((f) => !/^(css|js|fonts)\//.test(f) && f !== 'index.html');
  assert.ok(loose.length > 0);
  for (const f of loose) {
    if (f === 'manifest.json') { assert.match(fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8'), /href="\/manifest\.json"/); continue; }
    assert.ok(haystack.includes(`/${f}`), `public/${f} is not referenced by anything`);
  }
});
