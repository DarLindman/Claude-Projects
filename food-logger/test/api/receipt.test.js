'use strict';

// receiptHtml (public/js/receipt.js): the printed receipt of an analysis. Pure, no DOM.

const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const load = () => import(pathToFileURL(path.join(__dirname, '..', '..', 'public', 'js', 'receipt.js')).href);

const markup = (frag) => frag.__raw;
const rowsOf = (str) => [...str.matchAll(/<div class="l">(.*?)<\/div>/g)].map((m) => m[1]);
const rows = (frag) => rowsOf(markup(frag));
const rowName = (row) => row.match(/<span class="nm">(.*?)<\/span>/)[1];
const rowCal = (row) => row.match(/<b>(.*?)<\/b>/)[1];

const base = { calories: 722, protein_g: 38.4, carbs_g: 68, fat_g: 33.2 };
const item = (name, calories) => ({ name, calories });

test('item rows carry the name, a leader and the item calories', async () => {
  const { receiptHtml } = await load();
  const out = receiptHtml({ ...base, items: [item('שניצל', 380), item('כוסמת', 272), item('סלט ירקות', 70)] });
  const r = rows(out);
  assert.equal(r.length, 3, 'the items sum to the total, so there is no remainder row');
  assert.deepEqual(r.map(rowName), ['שניצל', 'כוסמת', 'סלט ירקות']);
  assert.deepEqual(r.map(rowCal), ['380', '272', '70']);
  assert.ok(r.every((x) => x.includes('<span class="d"></span>')));
});

test('a hostile item name is escaped', async () => {
  const { receiptHtml } = await load();
  const out = markup(receiptHtml({ ...base, items: [item('<img src=x onerror=alert(1)>', 722)] }));
  assert.equal(out.includes('<img'), false);
  assert.ok(out.includes('&lt;img src=x onerror=alert(1)&gt;'));
});

test('names are cut to the server limit of 40 characters', async () => {
  const { receiptHtml } = await load();
  const out = receiptHtml({ ...base, items: [item('א'.repeat(60), 722)] });
  assert.equal(rowName(rows(out)[0]), 'א'.repeat(40));
});

test('a remainder row ועוד appears with the remainder calories when the items sum below the total', async () => {
  const { receiptHtml } = await load();
  const out = receiptHtml({ ...base, calories: 900, items: [item('א', 300), item('ב', 200)] });
  const r = rows(out);
  assert.equal(r.length, 3);
  assert.equal(rowName(r[2]), 'ועוד');
  assert.equal(rowCal(r[2]), '400');
});

test('the remainder row appears exactly when the remainder is at least 1', async () => {
  const { receiptHtml } = await load();
  const make = (total, a, b) => rows(receiptHtml({ ...base, calories: total, items: [item('א', a), item('ב', b)] }));
  assert.equal(make(500, 300, 200).length, 2, 'remainder 0');
  assert.equal(make(500.4, 300, 200).length, 2, 'remainder rounds to 0');
  assert.equal(make(499, 300, 200).length, 2, 'negative remainder');
  assert.equal(make(400, 300, 200).length, 2, 'items above the total');
  const one = make(501, 300, 200);
  assert.equal(one.length, 3, 'remainder exactly 1');
  assert.equal(rowCal(one[2]), '1');
  assert.equal(rowName(one[2]), 'ועוד');
});

test('with 12 items only the first 8 rows render, plus a remainder row when the totals require it', async () => {
  const { receiptHtml } = await load();
  const items = Array.from({ length: 12 }, (_, i) => item(`מנה ${i + 1}`, 100));
  const out = receiptHtml({ ...base, calories: 1200, items });
  const r = rows(out);
  assert.equal(r.length, 9);
  assert.deepEqual(r.slice(0, 8).map(rowName), Array.from({ length: 8 }, (_, i) => `מנה ${i + 1}`));
  assert.equal(rowName(r[8]), 'ועוד');
  assert.equal(rowCal(r[8]), '400');
  assert.equal(markup(out).includes('מנה 9'), false);
});

test('with 12 items whose first 8 already sum to the total there is no remainder row', async () => {
  const { receiptHtml } = await load();
  const items = Array.from({ length: 12 }, (_, i) => item(`מנה ${i + 1}`, 100));
  const out = receiptHtml({ ...base, calories: 800, items });
  assert.equal(rows(out).length, 8);
});

test('no items renders only the total (no rows, no separator, no remainder row)', async () => {
  const { receiptHtml } = await load();
  for (const items of [[], undefined]) {
    const out = markup(receiptHtml({ ...base, items }));
    assert.equal(rowsOf(out).length, 0);
    assert.equal(out.includes('ועוד'), false);
    assert.equal(out.includes('<hr'), false);
    assert.ok(out.includes('<div class="tt">'));
    assert.ok(out.includes('<b>722</b>'));
  }
});

test('numbers use the thousands separator of the rest of the app', async () => {
  const { receiptHtml } = await load();
  const out = markup(receiptHtml({ ...base, calories: 1142, items: [item('ארוחה', 1142)] }));
  assert.ok(out.includes('<b>1,142</b>'));
  assert.equal((out.match(/1,142/g) || []).length, 2);
});

test('the macros row shows grams of protein, carbs and fat, rounded', async () => {
  const { receiptHtml } = await load();
  const out = markup(receiptHtml({ ...base, items: [item('א', 722)] }));
  const mac = out.match(/<div class="mac">(.*?)<\/div>/)[1];
  assert.match(mac, /חלבון 38/);
  assert.match(mac, /פחמימות 68/);
  assert.match(mac, /שומן 33/);
});

test('no title, no word "receipt", and no weights next to an item', async () => {
  const { receiptHtml } = await load();
  const out = markup(receiptHtml({ ...base, items: [item('שניצל', 400), item('כוסמת', 100)] }));
  assert.equal(out.includes('קבלה'), false);
  assert.equal(/receipt-title|<h\d|<header/i.test(out), false);
  assert.equal(out.includes('גרם'), false);
  assert.equal(/weight/i.test(out), false);
  for (const row of rowsOf(out)) assert.equal(/גר|גרם|\dg\b/.test(row), false);
});

test('bad numbers become 0 and never print NaN or a negative', async () => {
  const { receiptHtml } = await load();
  const out = markup(receiptHtml({ items: [item('א', NaN), item('ב', -5), item('ג', '12')], calories: undefined, protein_g: 'x', carbs_g: null, fat_g: -1 }));
  assert.equal(/NaN|undefined|null|-\d/.test(out), false);
});

test('the markup is a fragment, so html`` embeds it unescaped and setHtml accepts it', async () => {
  const { receiptHtml } = await load();
  const { html, setHtml } = await import(pathToFileURL(path.join(__dirname, '..', '..', 'public', 'js', 'dom.js')).href);
  const out = html`<section>${receiptHtml({ ...base, items: [] })}</section>`;
  assert.match(out.__raw, /^<section><div class="receipt receipt-slip"/);
  const el = {};
  setHtml(el, receiptHtml({ ...base, items: [] }));
  assert.ok(el.innerHTML.startsWith('<div class="receipt receipt-slip"'));
});

test('the receipt has no event handlers, scripts or external references', async () => {
  const { receiptHtml } = await load();
  const out = markup(receiptHtml({ ...base, items: [item('א', 722)] }));
  assert.equal(/\son\w+\s*=/i.test(out), false);
  assert.equal(/<script|href|src=|https?:/i.test(out), false);
});
