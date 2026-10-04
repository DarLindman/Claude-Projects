'use strict';

// sortWeightLogs (public/js/profile.js): the weight entries oldest first, same-day entries by id, whatever order they arrive in.

const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const load = () => import(pathToFileURL(path.join(__dirname, '..', '..', 'public', 'js', 'profile.js')).href);

test('sortWeightLogs: by date, then by id, from any input order; numeric ids compare as numbers', async () => {
  const { sortWeightLogs } = await load();
  const rows = [
    { id: 12, logged_at: '2026-10-03', weight_kg: '72.0' },
    { id: 9, logged_at: '2026-10-03', weight_kg: '72.4' },
    { id: 30, logged_at: '2026-09-30', weight_kg: '73.0' },
    { id: 100, logged_at: '2026-10-03', weight_kg: '71.6' },
  ];
  const expected = [30, 9, 12, 100];
  assert.deepEqual(sortWeightLogs(rows).map((r) => r.id), expected);
  assert.deepEqual(sortWeightLogs([...rows].reverse()).map((r) => r.id), expected);
  assert.deepEqual(sortWeightLogs([rows[2], rows[3], rows[0], rows[1]]).map((r) => r.id), expected);
  assert.equal(rows[0].id, 12, 'the input is not mutated');
});

test('sortWeightLogs: a timestamp-like date sorts by its day', async () => {
  const { sortWeightLogs } = await load();
  const out = sortWeightLogs([{ id: 2, logged_at: '2026-10-03T00:00:00', weight_kg: 1 }, { id: 1, logged_at: '2026-10-03', weight_kg: 2 }]);
  assert.deepEqual(out.map((r) => r.id), [1, 2]);
});

test('goalWeightOf: a positive number, or 0 for absent, 0, negative, junk; numeric strings from older clients count', async () => {
  const { goalWeightOf } = await load();
  assert.equal(goalWeightOf({ goalWeight: 68.5 }), 68.5);
  assert.equal(goalWeightOf({ goalWeight: '72.5' }), 72.5);
  for (const p of [null, undefined, {}, { goalWeight: 0 }, { goalWeight: -3 }, { goalWeight: 'abc' }, { goalWeight: null }, { goalWeight: NaN }]) {
    assert.equal(goalWeightOf(p), 0, JSON.stringify(p));
  }
});

test('formatKg: a whole number without decimals, a fraction with one, thousands separated, junk as 0', async () => {
  const { formatKg } = await import(pathToFileURL(path.join(__dirname, '..', '..', 'public', 'js', 'format.js')).href);
  assert.equal(formatKg(70), '70');
  assert.equal(formatKg(68.5), '68.5');
  assert.equal(formatKg(1000.5), '1,000.5');
  assert.equal(formatKg(10000), '10,000');
  assert.equal(formatKg(NaN), '0');
  assert.equal(formatKg('70'), '0');
});
