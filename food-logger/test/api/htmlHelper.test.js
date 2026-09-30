'use strict';

// Unit tests for the escape-by-default `html` tagged template in public/js/dom.js.
// dom.js is a browser ES module with no top-level DOM access, so node can import it.

const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const load = () => import(pathToFileURL(path.join(__dirname, '..', '..', 'public', 'js', 'dom.js')).href);

// Text of an html`` result (a trusted fragment carries its markup in `__raw`).
const text = (frag) => frag.__raw;

test('interpolated strings are escaped, template literals are left as written', async () => {
  const { html } = await load();
  const out = html`<div title="${'"><img src=x onerror=1>'}">${'<b>&\'"'}</div>`;
  assert.equal(text(out), '<div title="&quot;&gt;&lt;img src=x onerror=1&gt;">&lt;b&gt;&amp;&#39;&quot;</div>');
});

test('escapeHtml keeps its semantics and still handles null/undefined/numbers', async () => {
  const { escapeHtml } = await load();
  assert.equal(escapeHtml(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
  assert.equal(escapeHtml(7), '7');
});

test('null, undefined and false render as nothing; numbers and 0 are stringified', async () => {
  const { html } = await load();
  assert.equal(text(html`[${null}][${undefined}][${false}][${0}][${12.5}][${true}]`), '[][][][0][12.5][true]');
});

test('raw() and nested html results are trusted; a plain string of markup is not', async () => {
  const { html, raw } = await load();
  const inner = html`<b>${'<i>'}</b>`;
  assert.equal(text(html`<p>${inner}</p>`), '<p><b>&lt;i&gt;</b></p>');
  assert.equal(text(html`<p>${raw('<br>')}</p>`), '<p><br></p>');
  assert.equal(text(html`<p>${'<br>'}</p>`), '<p>&lt;br&gt;</p>');
});

test('arrays are escaped item by item then joined; an array of fragments stays trusted', async () => {
  const { html } = await load();
  assert.equal(text(html`${['<a>', 'b', 3]}`), '&lt;a&gt;b3');
  const items = ['<x>', 'y'].map((v) => html`<li>${v}</li>`);
  assert.equal(text(html`<ul>${items}</ul>`), '<ul><li>&lt;x&gt;</li><li>y</li></ul>');
  assert.equal(text(html`<ul>${[]}</ul>`), '<ul></ul>');
  // mixed arrays: fragments pass through, plain strings are escaped, nulls vanish
  assert.equal(text(html`${[html`<b/>`, '<b/>', null, false]}`), '<b/>&lt;b/&gt;');
});

test('an object that merely looks like a fragment but is not from raw()/html() is escaped', async () => {
  const { html } = await load();
  assert.equal(text(html`${{ toString: () => '<script>' }}`), '&lt;script&gt;');
});

test('a plain { __raw } object is not trusted: it is escaped as [object Object]', async () => {
  const { html } = await load();
  assert.equal(text(html`${{ __raw: '<b>' }}`), '[object Object]');
});

test('setHtml assigns trusted results and refuses plain strings', async () => {
  const { html, raw, setHtml } = await load();
  const el = { innerHTML: 'old' };
  setHtml(el, html`<p>${'<x>'}</p>`);
  assert.equal(el.innerHTML, '<p>&lt;x&gt;</p>');
  setHtml(el, raw('<hr>'));
  assert.equal(el.innerHTML, '<hr>');
  assert.throws(() => setHtml(el, '<img src=x onerror=1>'), /setHtml/);
  assert.throws(() => setHtml(el, null), /setHtml/);
  assert.throws(() => setHtml(el, { __raw: '<hr>' }), /setHtml/);
  assert.equal(el.innerHTML, '<hr>');
});
