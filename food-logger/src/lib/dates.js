'use strict';

// Real-calendar checks (a regex alone accepts 2026-02-31). Year 0000 is rejected
// because PostgreSQL has no year 0 and would raise an error (a 500).
const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const daysInMonth = (y, m) => (m === 2 ? (isLeap(y) ? 29 : 28) : [4, 6, 9, 11].includes(m) ? 30 : 31);

function isRealDate(str) {
  if (typeof str !== 'string') return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return y >= 1 && mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo);
}

function isRealMonth(str) {
  if (typeof str !== 'string') return false;
  const m = /^(\d{4})-(\d{2})$/.exec(str);
  if (!m) return false;
  const [y, mo] = [Number(m[1]), Number(m[2])];
  return y >= 1 && mo >= 1 && mo <= 12;
}

// YYYY-MM-DDTHH:mm[:ss[.fff]] with an optional Z or +-HH:MM offset.
const LOGGED_AT = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,6})?)?(Z|[+-](\d{2}):(\d{2}))?$/;
function isRealDateTime(str) {
  if (typeof str !== 'string') return false;
  const m = LOGGED_AT.exec(str);
  if (!m) return false;
  if (!isRealDate(m[1])) return false;
  if (Number(m[2]) > 23 || Number(m[3]) > 59) return false;
  if (m[4] !== undefined && Number(m[4]) > 59) return false;
  if (m[6] !== undefined && (Number(m[6]) > 15 || Number(m[7]) > 59)) return false; // PostgreSQL's offset range
  return true;
}

module.exports = { isRealDate, isRealMonth, isRealDateTime };
