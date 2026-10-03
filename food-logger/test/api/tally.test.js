'use strict';

// tallySvg (public/js/tally.js): the hand-drawn streak tally. Pure, no DOM, no randomness.

const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const load = () => import(pathToFileURL(path.join(__dirname, '..', '..', 'public', 'js', 'tally.js')).href);

const markup = (frag) => frag.__raw;
const strokes = (frag) => (markup(frag).match(/class="tally-stroke[ "]/g) || []).length;
const ghosts = (frag) => (markup(frag).match(/class="tally-ghost"/g) || []).length;

test('the stroke count equals the number given, up to five groups', async () => {
  const { tallySvg } = await load();
  for (const [count, expected] of [[1, 1], [2, 2], [4, 4], [5, 5], [6, 6], [7, 7], [10, 10], [24, 24], [25, 25]]) {
    assert.equal(strokes(tallySvg(count)), expected, `count ${count}`);
  }
});

test('counts above 25 draw five full groups', async () => {
  const { tallySvg } = await load();
  assert.equal(strokes(tallySvg(26)), 25);
  assert.equal(strokes(tallySvg(40)), 25);
  assert.equal(strokes(tallySvg(1000)), 25);
});

test('a group of five has four vertical strokes and one diagonal', async () => {
  const { tallySvg } = await load();
  const svg = markup(tallySvg(5));
  assert.equal((svg.match(/tally-diag/g) || []).length, 1);
  assert.equal(markup(tallySvg(4)).includes('tally-diag'), false);
  assert.equal((markup(tallySvg(12)).match(/tally-diag/g) || []).length, 2);
});

test('every stroke is drawn twice: a primary pass and a faint offset pass', async () => {
  const { tallySvg } = await load();
  const out = tallySvg(7);
  assert.equal(strokes(out), 7);
  assert.equal(ghosts(out), 7);
  const svg = markup(out);
  assert.match(svg, /stroke-width="2\.7"/);
  assert.match(svg, /stroke-width="1\.5"/);
  assert.match(svg, /stroke="#25304f"/);
  assert.match(svg, /stroke-linecap="round"/);
  assert.match(svg, /filter="url\(#wobS\)"/);
});

test('the output is deterministic: two calls are byte-identical', async () => {
  const { tallySvg } = await load();
  for (const count of [1, 5, 7, 13, 25, 40]) {
    assert.equal(markup(tallySvg(count)), markup(tallySvg(count)));
  }
  assert.equal(markup(tallySvg(7, { width: 120 })), markup(tallySvg(7, { width: 120 })));
});

test('strokes are not copies of each other (jitter by index)', async () => {
  const { tallySvg } = await load();
  const ds = [...markup(tallySvg(4)).matchAll(/class="tally-stroke" d="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(ds.length, 4);
  assert.equal(new Set(ds).size, 4);
});

test('0, negative, NaN and non-numbers give an empty fragment', async () => {
  const { tallySvg } = await load();
  for (const bad of [0, -3, NaN, Infinity, -Infinity, 0.9, undefined, null, 'x']) {
    const out = tallySvg(bad);
    assert.equal(markup(out), '', `input ${String(bad)}`);
  }
});

test('a fractional count is floored and a numeric string is not trusted as a number', async () => {
  const { tallySvg } = await load();
  assert.equal(strokes(tallySvg(3.9)), 3);
  assert.equal(markup(tallySvg('7')), '');
});

test('the width option is a maximum: natural size by default, shrunk to fit with the aspect ratio kept', async () => {
  const { tallySvg } = await load();
  const dims = (svg) => {
    const vb = markup(svg).match(/viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/);
    const w = markup(svg).match(/ width="(\d+(?:\.\d+)?)"/);
    const h = markup(svg).match(/ height="(\d+(?:\.\d+)?)"/);
    assert.ok(vb && w && h);
    return { vw: +vb[1], vh: +vb[2], w: +w[1], h: +h[1] };
  };
  const natural = dims(tallySvg(7));
  assert.equal(natural.w, natural.vw);
  assert.equal(natural.h, natural.vh);
  assert.deepEqual(dims(tallySvg(7, { width: 5000 })), natural);
  const small = dims(tallySvg(7, { width: 60 }));
  assert.equal(small.w, 60);
  assert.ok(Math.abs(small.h - (60 * small.vh) / small.vw) < 0.06);
  assert.deepEqual(dims(tallySvg(7, { width: -4 })), natural);
});

test('no event handlers, scripts or external references', async () => {
  const { tallySvg } = await load();
  for (const count of [1, 7, 25]) {
    const svg = markup(tallySvg(count));
    assert.equal(/\son\w+\s*=/i.test(svg), false);
    assert.equal(/<script|href|xlink|https?:|<image|<use/i.test(svg), false);
  }
});

test('it returns a trusted fragment, so html`` embeds it unescaped', async () => {
  const { tallySvg } = await load();
  const { html } = await import(pathToFileURL(path.join(__dirname, '..', '..', 'public', 'js', 'dom.js')).href);
  const out = html`<div>${tallySvg(2)}</div>`;
  assert.match(out.__raw, /^<div><svg /);
});
