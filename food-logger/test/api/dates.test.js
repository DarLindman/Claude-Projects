'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isRealDate, isRealMonth, isRealDateTime, utcToday, addDaysUtc } = require('../../src/lib/dates');

test('isRealDate rejects impossible or malformed dates', () => {
  for (const s of ['2026-02-31', '2026-13-01', '2026-1-1', '2026-00-10', '2026-04-31', '2025-02-29', '2026-01-00', '0000-01-01',
    '2026-01-01T10:00', ' 2026-01-01', '2026-01-01\n', '', 'abc', '２０２６-01-01']) {
    assert.equal(isRealDate(s), false, s);
  }
  for (const v of [null, undefined, 20260101, ['2026-01-01'], {}]) assert.equal(isRealDate(v), false, String(v));
});

test('isRealDate accepts real dates including leap days', () => {
  for (const s of ['2024-02-29', '2000-02-29', '2026-12-31', '2026-01-01', '0001-01-01']) {
    assert.equal(isRealDate(s), true, s);
  }
  assert.equal(isRealDate('1900-02-29'), false, '1900 is not a leap year');
});

test('isRealMonth checks YYYY-MM', () => {
  for (const s of ['2026-13', '2026-00', '2026-1', '2026-02-01', '26-02', '0000-05', '']) assert.equal(isRealMonth(s), false, s);
  for (const s of ['2026-01', '2026-12', '1999-06']) assert.equal(isRealMonth(s), true, s);
});

test('isRealDateTime accepts the client format and offsets, rejects impossible values', () => {
  for (const s of ['2024-03-01T18:00', '2024-03-01T18:00:00', '2024-03-01T18:00:00.123', '2024-03-01T18:00:00Z',
    '2024-03-01T18:00:00+02:00', '2024-03-01T18:00-05:30', '2024-02-29T23:59:59']) {
    assert.equal(isRealDateTime(s), true, s);
  }
  for (const s of ['2026-02-31T10:00', '2024-03-01T24:00', '2024-03-01T10:60', '2024-03-01T10:00:60', '2024-03-01', '2024-03-01 10:00',
    '2024-03-01T10:00+99:00', '2024-03-01T10:00+02:60', '2024-03-01t10:00', '2024-03-01T10:00:00.', '2024-03-01T1:00', 'tomorrow']) {
    assert.equal(isRealDateTime(s), false, s);
  }
});

test('addDaysUtc is pure calendar arithmetic, leap years included', () => {
  assert.equal(addDaysUtc('2024-02-28', 1), '2024-02-29');
  assert.equal(addDaysUtc('2024-02-29', 1), '2024-03-01');
  assert.equal(addDaysUtc('2023-02-28', 1), '2023-03-01');
  assert.equal(addDaysUtc('2026-01-01', -1), '2025-12-31');
  assert.equal(addDaysUtc('2026-03-31', 1), '2026-04-01');
  assert.equal(addDaysUtc('2026-03-10', 0), '2026-03-10');
  assert.equal(addDaysUtc('2026-03-10', -6), '2026-03-04');
  assert.equal(addDaysUtc('2024-03-01', -1), '2024-02-29');
});

test('utcToday is a YYYY-MM-DD string', () => {
  assert.match(utcToday(), /^\d{4}-\d{2}-\d{2}$/);
});
