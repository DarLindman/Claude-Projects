'use strict';

// The small copy helpers of the frontend (browser ES modules with no top-level DOM access,
// so node can import them): dates with the prefix ב, the day count in words, and the
// analysis-limit message.

const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const load = (file) => import(pathToFileURL(path.join(__dirname, '..', '..', 'public', 'js', file)).href);

test('formatDate: weekday, day and ב + the month for all twelve months', async () => {
  const { formatDate } = await load('dates.js');
  const months = ['ינו׳', 'פבר׳', 'מרץ', 'אפר׳', 'מאי', 'יוני', 'יולי', 'אוג׳', 'ספט׳', 'אוק׳', 'נוב׳', 'דצמ׳'];
  months.forEach((m, i) => {
    const out = formatDate(`2025-${String(i + 1).padStart(2, '0')}-01`);
    assert.match(out, new RegExp(`^יום [א-ת]+, 1 ב${m}$`), out);
  });
  assert.equal(formatDate('2025-10-02'), 'יום חמישי, 2 באוק׳');
  assert.equal(formatDate('2025-06-01'), 'יום ראשון, 1 ביוני');
  assert.equal(formatDate('2025-03-01'), 'יום שבת, 1 במרץ');
  assert.equal(formatDate('2025-05-01'), 'יום חמישי, 1 במאי');
});

test('formatDayCount: one day in words, otherwise the number and ימים', async () => {
  const { formatDayCount } = await load('dates.js');
  assert.equal(formatDayCount(1), 'יום אחד');
  assert.equal(formatDayCount(2), '2 ימים');
  assert.equal(formatDayCount(30), '30 ימים');
});

test('analysisMessageFor: the hourly analysis limit has its own text, other errors use messageFor', async () => {
  const { analysisMessageFor, messageFor, ANALYSIS_LIMIT, errors } = await load('errors.js');
  assert.equal(ANALYSIS_LIMIT, 'הגעת למגבלת הניתוחים לשעה, נסה שוב מאוחר יותר');
  assert.equal(analysisMessageFor({ status: 429, code: 'RATE_LIMITED' }), ANALYSIS_LIMIT);
  assert.equal(analysisMessageFor({ status: 503, code: 'AI_UNAVAILABLE' }), errors.AI_UNAVAILABLE);
  assert.equal(analysisMessageFor(new TypeError('network')), errors.INTERNAL);
  // elsewhere RATE_LIMITED keeps the generic text
  assert.equal(messageFor({ code: 'RATE_LIMITED' }), 'יותר מדי בקשות, נסה שוב מאוחר יותר');
});
