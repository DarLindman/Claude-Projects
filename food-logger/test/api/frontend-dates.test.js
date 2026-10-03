'use strict';

// formatDateTitle (public/js/dates.js): the home page's title, "שבת, 3 באוקטובר". Pure, local-date arithmetic only.

const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const load = () => import(pathToFileURL(path.join(__dirname, '..', '..', 'public', 'js', 'dates.js')).href);

test('formatDateTitle: weekday, day of the month and the full month name with the ב prefix', async () => {
  const { formatDateTitle } = await load();
  assert.equal(formatDateTitle('2026-10-03'), 'שבת, 3 באוקטובר');     // a Saturday
  assert.equal(formatDateTitle('2026-01-01'), 'חמישי, 1 בינואר');     // 1 January, a Thursday
  assert.equal(formatDateTitle('2026-12-31'), 'חמישי, 31 בדצמבר');    // 31 December, a Thursday
  assert.equal(formatDateTitle('2028-02-29'), 'שלישי, 29 בפברואר');   // a leap day, a Tuesday
  assert.equal(formatDateTitle('2026-03-08'), 'ראשון, 8 במרץ');       // a Sunday (index 0)
});

test('formatDate and formatMonth still use their own month names after the arrays were shared', async () => {
  const { formatDate, formatMonth } = await load();
  assert.equal(formatDate('2000-10-03'), 'יום שלישי, 3 באוק׳');
  assert.equal(formatMonth('2026-10'), 'אוקטובר 2026');
});

// weekOf (public/js/dates.js): the seven YYYY-MM-DD strings of the Sunday-Saturday week that holds a date. Pure calendar arithmetic.
test('weekOf: a Sunday starts its own week', async () => {
  const { weekOf } = await load();
  assert.deepEqual(weekOf('2026-09-27'), ['2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03']);
});

test('weekOf: a Saturday ends its own week', async () => {
  const { weekOf } = await load();
  assert.deepEqual(weekOf('2026-10-03'), ['2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03']);
});

test('weekOf: a mid-week day gets the same seven days as the rest of its week', async () => {
  const { weekOf } = await load();
  const week = ['2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10'];
  for (const day of week) assert.deepEqual(weekOf(day), week);
});

test('weekOf: crosses the year change in both directions', async () => {
  const { weekOf } = await load();
  const week = ['2026-12-27', '2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02'];
  assert.deepEqual(weekOf('2026-12-31'), week);
  assert.deepEqual(weekOf('2027-01-01'), week);
});

test('weekOf: the leap day 2028-02-29 (a Tuesday) and the days around it', async () => {
  const { weekOf } = await load();
  assert.deepEqual(weekOf('2028-02-29'), ['2028-02-27', '2028-02-28', '2028-02-29', '2028-03-01', '2028-03-02', '2028-03-03', '2028-03-04']);
  assert.deepEqual(weekOf('2027-02-28'), ['2027-02-28', '2027-03-01', '2027-03-02', '2027-03-03', '2027-03-04', '2027-03-05', '2027-03-06']);
});
