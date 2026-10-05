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

const eight = (each) => Array.from({ length: 8 }, (_, i) => item(`מנה ${i + 1}`, each));

test('a remainder row ועוד appears with the remainder calories when a full 8 items sum clearly below the total', async () => {
  const { receiptHtml } = await load();
  const out = receiptHtml({ ...base, calories: 900, items: eight(100) });
  const r = rows(out);
  assert.equal(r.length, 9);
  assert.equal(rowName(r[8]), 'ועוד');
  assert.equal(rowCal(r[8]), '100');
});

test('the remainder row needs 8 items and a remainder above 4 (rounding drift of 8 items)', async () => {
  const { receiptHtml } = await load();
  const make = (total, items) => rows(receiptHtml({ ...base, calories: total, items }));
  assert.equal(make(804, eight(100)).length, 8, 'remainder 4: drift');
  const five = make(805, eight(100));
  assert.equal(five.length, 9, 'remainder 5');
  assert.equal(rowCal(five[8]), '5');
  assert.equal(make(799, eight(100)).length, 8, 'negative remainder');
  assert.equal(make(800, eight(100)).length, 8, 'remainder 0');
});

test('fewer than 8 items never get a remainder row, however large the gap', async () => {
  const { receiptHtml } = await load();
  assert.equal(rows(receiptHtml({ ...base, calories: 900, items: [item('א', 300), item('ב', 200)] })).length, 2);
  assert.equal(rows(receiptHtml({ ...base, calories: 5000, items: Array.from({ length: 7 }, (_, i) => item(`מנה ${i}`, 10)) })).length, 7);
});

test('ordinary rounding drift never shows a false remainder row', async () => {
  const { receiptHtml } = await load();
  // the server rounds each item, the total is a raw float sum
  assert.equal(rows(receiptHtml({ ...base, calories: 301.2, items: [item('א', 100), item('ב', 100), item('ג', 100)] })).length, 3);
  assert.equal(rows(receiptHtml({ ...base, calories: 722, items: [item('א', 380.4), item('ב', 341.2)] })).length, 2);
  const eightDrift = receiptHtml({ ...base, calories: 803.6, items: eight(100) });
  assert.equal(rows(eightDrift).length, 8);
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

test('numeric strings (a NUMERIC column) count as numbers', async () => {
  const { receiptHtml } = await load();
  const out = markup(receiptHtml({ calories: '722', protein_g: '38.4', carbs_g: '68', fat_g: '33.2', items: [item('א', '380.4'), item('ב', '341.6')] }));
  assert.deepEqual(rowsOf(out).map(rowCal), ['380', '342']);
  assert.ok(out.includes('<div class="tt"><span>סה״כ</span><b>722</b>'));
  assert.match(out, /חלבון 38ג/);
  const junk = markup(receiptHtml({ calories: '', protein_g: ' ', carbs_g: true, fat_g: '12abc', items: [item('א', '')] }));
  assert.ok(junk.includes('<b>0</b>'));
  assert.equal(/NaN/.test(junk), false);
});
