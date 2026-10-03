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
