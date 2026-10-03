'use strict';

// Self-hosted fonts: everything the CSS loads comes from the app's own origin, the new
// families of the redesign are declared, and their files stay within the size budget.

const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const PUBLIC = path.join(__dirname, '..', '..', 'public');
const CSS_DIR = path.join(PUBLIC, 'css');
const cssFiles = fs.readdirSync(CSS_DIR).filter((f) => f.endsWith('.css'));
const read = (p) => fs.readFileSync(p, 'utf8');
const fontsCss = read(path.join(CSS_DIR, 'fonts.css'));

// Every @font-face block as { family, weight, urls, unicodeRange }.
function faces(css) {
  const out = [];
  for (const m of css.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
    const body = m[1];
    const family = /font-family:\s*['"]([^'"]+)['"]/.exec(body)?.[1];
    const weight = /font-weight:\s*([^;]+);/.exec(body)?.[1].trim();
    const display = /font-display:\s*([^;]+);/.exec(body)?.[1].trim();
    const unicodeRange = /unicode-range:\s*([^;]+);/.exec(body)?.[1].trim();
    const urls = [...body.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)].map((u) => u[1]);
    out.push({ family, weight, display, unicodeRange, urls });
  }
  return out;
}

const NEW_FAMILIES = ['Gveret Levin', 'Suez One', 'Cousine', 'Digits', 'Playpen Sans Hebrew'];
const BUDGET = 300 * 1024;

// A data: URI is inline (the xmlns attribute inside an SVG is a name, not a request), so it is
// blanked out before the url() scans; whatever remains must be same-origin.
const withoutDataUris = (css) =>
  css.replace(/url\(\s*(["'])data:[\s\S]*?\1\s*\)/g, 'url()').replace(/url\(\s*data:[^)]*\)/g, 'url()');

test('every url() in public/css points to an existing file under public/', () => {
  for (const file of cssFiles) {
    const css = withoutDataUris(read(path.join(CSS_DIR, file)));
    for (const m of css.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) {
      const u = m[1];
      if (u.startsWith('#')) continue;   // url(#id): a reference to an element of this same document (an SVG filter), not a request
      assert.ok(u.startsWith('/') && !u.startsWith('//'), `${file}: ${u} is not an absolute path on this origin`);
      assert.ok(fs.existsSync(path.join(PUBLIC, u.split(/[?#]/)[0])), `${file}: ${u} does not exist`);
    }
  }
});

test('no third-party URL is loaded by public/css/*.css or public/index.html', () => {
  for (const file of cssFiles) {
    const css = withoutDataUris(read(path.join(CSS_DIR, file)));
    assert.doesNotMatch(css, /https?:\/\//i, `${file} contains an http(s) URL`);
    assert.doesNotMatch(css, /url\(\s*['"]?\/\//i, `${file} contains a protocol-relative url()`);
    assert.doesNotMatch(css, /@import/i, `${file} uses @import`);
  }
  // Resources the page loads. Plain <a> links are navigation, not requests, and are not checked.
  const html = read(path.join(PUBLIC, 'index.html'));
  for (const m of html.matchAll(/<(?:link|script|img|source|iframe|video|audio|embed|object)\b[^>]*>/gi)) {
    assert.doesNotMatch(m[0], /(?:src|href|data|srcset)\s*=\s*["']?\s*(?:https?:)?\/\//i, `third-party resource: ${m[0]}`);
  }
});

test('the new families are declared with the weights the redesign uses', () => {
  const all = faces(fontsCss);
  const weights = (family) => [...new Set(all.filter((f) => f.family === family).map((f) => f.weight))].sort();
  assert.deepEqual(weights('Gveret Levin'), ['400']);
  assert.deepEqual(weights('Suez One'), ['400']);
  assert.deepEqual(weights('Cousine'), ['400', '700']);
  assert.deepEqual(weights('Digits'), ['500', '600']);
  // Playpen ships 500 and 600 files; a face may declare a range ("400 500") that points at the nearest file.
  const covers = (family, w) =>
    all.some((f) => {
      if (f.family !== family) return false;
      const [lo, hi = lo] = f.weight.split(/\s+/).map(Number);
      return w >= lo && w <= hi;
    });
  for (const w of [400, 500, 600]) assert.ok(covers('Playpen Sans Hebrew', w), `Playpen Sans Hebrew ${w}`);
});

test('the new families use font-display: swap and woff2 files', () => {
  for (const f of faces(fontsCss).filter((x) => NEW_FAMILIES.includes(x.family))) {
    assert.equal(f.display, 'swap', `${f.family} ${f.weight}`);
    assert.ok(f.urls.length > 0 && f.urls.every((u) => u.endsWith('.woff2')), `${f.family} ${f.weight} files`);
  }
});

test('Digits only claims the digits and the separators of numbers', () => {
  const digits = faces(fontsCss).filter((f) => f.family === 'Digits');
  assert.equal(digits.length, 2);
  for (const f of digits) {
    assert.equal(f.unicodeRange, 'U+0030-0039, U+002C, U+002E, U+003A, U+002F');
    assert.ok(f.urls.every((u) => /PlaypenSansHebrew/.test(u)), 'Digits is the Playpen Sans Hebrew file');
  }
});

test('the files of the new families total at most 300 KB', () => {
  const files = new Set();
  for (const f of faces(fontsCss).filter((x) => NEW_FAMILIES.includes(x.family))) {
    for (const u of f.urls) files.add(u);
  }
  assert.ok(files.size > 0);
  let total = 0;
  for (const u of files) total += fs.statSync(path.join(PUBLIC, u)).size;
  assert.ok(total <= BUDGET, `new font files total ${total} bytes, budget ${BUDGET}`);
});

test('each new family has its licence text next to its files', () => {
  for (const family of NEW_FAMILIES.filter((f) => f !== 'Digits')) {
    const licence = path.join(PUBLIC, 'fonts', `OFL-${family.replace(/ /g, '-')}.txt`);
    assert.ok(fs.existsSync(licence), `missing ${path.basename(licence)}`);
    assert.match(read(licence), /SIL OPEN FONT LICENSE/i);
  }
});

test('the package versions are recorded at the top of the new section', () => {
  for (const pkg of ['gveret-levin', 'suez-one', 'cousine', 'playpen-sans-hebrew']) {
    assert.match(fontsCss, new RegExp(`@fontsource/${pkg} \\d+\\.\\d+\\.\\d+`), pkg);
  }
});
