'use strict';

// Support for test/e2e/hebrew-baseline.spec.js: collecting the visible Hebrew text of a
// container, keeping it in one flat { key: string } map, and comparing it with (or writing)
// test/e2e/__snapshots__/he-text.json.
//
// A capture stores, per named state:
//   "<state> :: text"                  the container's lines (innerText, or every text node
//                                      for the final sweep), whitespace-normalised, one per line
//   "<state> :: attr <path>@<attr>"    placeholder, title, aria-label, alt, data-placeholder
//
// Normalised on purpose: runs of spaces and non-breaking spaces collapse to one space, empty
// lines are dropped, database ids in element ids (#entry-12) become #entry-N. Everything else
// that could vary (clock, time zone, locale, username, entry time, typed placeholder, count-up
// animation) is pinned or awaited by the spec itself, not filtered here.

const fs = require('node:fs');
const path = require('node:path');

const SNAPSHOT_FILE = path.join(__dirname, '__snapshots__', 'he-text.json');
const ATTRS = ['placeholder', 'title', 'aria-label', 'alt', 'data-placeholder'];
const RECORD_HINT = 'UPDATE_SNAPSHOT=1 npm run test:e2e -- hebrew-baseline';

// Runs inside the page, so it must not use anything from this module.
function collectInPage({ selector, all, attrs }) {
  const root = document.querySelector(selector);
  if (!root) return null;
  const clean = (s) => s.replace(/ /g, ' ').replace(/[ \t\r\f\v]+/g, ' ').trim();
  let lines = [];
  if (all) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const tag = n.parentElement && n.parentElement.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE') continue;
      const t = clean(n.nodeValue);
      if (t) lines.push(t);
    }
  } else {
    lines = root.innerText.split('\n').map(clean).filter(Boolean);
  }
  // A stable address: the nearest id, else tag:nth-child steps up to the container.
  const pathOf = (el) => {
    const parts = [];
    for (let cur = el; cur; cur = cur.parentElement) {
      if (cur.id) { parts.unshift('#' + cur.id); break; }
      if (cur === root) { parts.unshift(selector); break; }
      const idx = Array.prototype.indexOf.call(cur.parentElement.children, cur) + 1;
      parts.unshift(cur.tagName.toLowerCase() + ':nth-child(' + idx + ')');
    }
    return parts.join(' > ');
  };
  const found = {};
  for (const el of [root, ...root.querySelectorAll('*')]) {
    for (const a of attrs) {
      const v = el.getAttribute(a);
      if (v && v.trim()) found[pathOf(el) + '@' + a] = clean(v);
    }
  }
  return { lines, attrs: found };
}

const normaliseKey = (s) => s.replace(/#entry-\d+/g, '#entry-N');

function createCollector(page) {
  const data = {};
  // In-flight API calls (fetch/xhr only: the welcome video may stream for ever).
  let pending = 0;
  const isApi = (r) => ['fetch', 'xhr'].includes(r.resourceType());
  page.on('request', (r) => { if (isApi(r)) pending++; });
  page.on('requestfinished', (r) => { if (isApi(r)) pending--; });
  page.on('requestfailed', (r) => { if (isApi(r)) pending--; });
  async function quiet() {
    for (let calm = 0, i = 0; i < 100 && calm < 3; i++) {
      calm = pending === 0 ? calm + 1 : 0;
      await page.waitForTimeout(100);
    }
  }
  // Reads until two reads 300 ms apart agree: a typed placeholder, a count-up number or a
  // chart that is still drawing settles first. Waits for the API calls to finish before.
  async function read(selector, all) {
    await quiet();
    let previous = null;
    for (let i = 0; i < 40; i++) {
      const current = await page.evaluate(collectInPage, { selector, all, attrs: ATTRS });
      if (!current) throw new Error(`hebrew baseline: no element matches ${selector}`);
      const json = JSON.stringify(current);
      if (json === previous) return current;
      previous = json;
      await page.waitForTimeout(300);
    }
    throw new Error(`hebrew baseline: the text of ${selector} never settled`);
  }
  return {
    data,
    async capture(state, selector, { all = false } = {}) {
      const got = await read(selector, all);
      data[`${state} :: text`] = got.lines.join('\n');
      for (const [k, v] of Object.entries(got.attrs)) data[`${state} :: attr ${normaliseKey(k)}`] = v;
    },
    set(key, value) { data[key] = value; },
  };
}

function loadSnapshot() {
  try { return JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf8')); } catch { return {}; }
}

function writeSnapshot(data) {
  fs.mkdirSync(path.dirname(SNAPSHOT_FILE), { recursive: true });
  fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(data, null, 2) + '\n');
}

function requireRecordedSnapshot() {
  const expected = loadSnapshot();
  if (Object.keys(expected).length === 0) {
    throw new Error(`The Hebrew baseline snapshot is empty (${SNAPSHOT_FILE}). Record it on the untouched UI: ${RECORD_HINT}`);
  }
  return expected;
}

// A readable per-key report; empty when nothing changed.
function diffSnapshots(expected, actual) {
  const out = [];
  const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])];
  for (const key of keys) {
    if (!(key in actual)) { out.push(`- missing now: ${key}\n      was: ${JSON.stringify(expected[key])}`); continue; }
    if (!(key in expected)) { out.push(`+ new: ${key}\n      now: ${JSON.stringify(actual[key])}`); continue; }
    if (expected[key] === actual[key]) continue;
    const before = expected[key].split('\n');
    const after = actual[key].split('\n');
    const removed = before.filter((l) => !after.includes(l));
    const added = after.filter((l) => !before.includes(l));
    const detail = [...removed.map((l) => `      - ${l}`), ...added.map((l) => `      + ${l}`)];
    out.push(`~ changed: ${key}\n${detail.length ? detail.join('\n') : '      (same lines, different order)'}`);
  }
  return out;
}

function checkOrRecord(actual) {
  if (process.env.UPDATE_SNAPSHOT === '1') {
    writeSnapshot(actual);
    return { recorded: true, problems: [] };
  }
  const expected = requireRecordedSnapshot();
  return { recorded: false, problems: diffSnapshots(expected, actual) };
}

module.exports = { createCollector, checkOrRecord, diffSnapshots, requireRecordedSnapshot, RECORD_HINT, SNAPSHOT_FILE };
