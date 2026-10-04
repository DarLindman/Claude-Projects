'use strict';

const { z } = require('zod');
const { isRealDate, isRealMonth, isRealDateTime } = require('./dates');

// PostgreSQL rejects NUL in text (turning it into a 500), so every string refuses it.
const noNul = z.string().refine((s) => !s.includes('\u0000'));

const id = z.string().regex(/^\d{1,10}$/).transform(Number).refine((n) => n >= 1 && n <= 2147483647); // INTEGER column
const dateStr = z.string().refine(isRealDate);
const monthStr = z.string().refine(isRealMonth);
const yearStr = z.string().regex(/^\d{4}$/).transform(Number).refine((n) => n >= 2000 && n <= 2100);
const mealType = z.enum(['breakfast', 'lunch', 'dinner', 'snack']);
const foodName = noNul.trim().min(1).max(200);

// Query strings send '' for an empty value; treat '' (and null) as absent.
const optionalQuery = (schema) => z.preprocess((v) => (v === '' || v === null ? undefined : v), schema.optional());

// Food timestamps: missing/null/'' -> null (the route then keeps its default), else a real date-time.
const loggedAt = z.preprocess(
  (v) => (v === '' || v === undefined ? null : v),
  z.union([z.null(), z.string().refine(isRealDateTime)]),
);

// Accepts numbers and numeric strings (the old `+v`); NaN for anything else.
function toFinite(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  if (typeof v === 'string' && v.trim() !== '') return Number(v);
  return NaN;
}

const reject = (ctx, v) => {
  ctx.issues.push({ code: 'custom', message: 'invalid', input: v });
  return z.NEVER;
};

// Missing/null/'' -> null; otherwise a number in 0..max rounded to 1 decimal
// (whole number with { integer: true }); anything else is INVALID.
function nullableNumber(max, { integer = false } = {}) {
  return z.unknown().optional().transform((v, ctx) => {
    if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) return null;
    const n = toFinite(v);
    if (Number.isNaN(n) || n < 0 || n > max) return reject(ctx, v);
    return integer ? Math.round(n) : Math.round(n * 10) / 10;
  });
}

// Required number in [min, max], NOT rounded. Accepts numbers and numeric strings ("70.5") and
// always yields a number: profiles stored by older clients hold numeric strings, and the client
// re-sends them as they are. '' and non-numeric strings are INVALID.
function looseNumber(min, max) {
  return z.unknown().transform((v, ctx) => {
    const n = toFinite(v);
    if (Number.isNaN(n) || n < min || n > max) return reject(ctx, v);
    return n;
  });
}

// Required number in [min, max], rounded to 1 decimal.
function rangedNumber(min, max) {
  return z.unknown().optional().transform((v, ctx) => {
    const n = toFinite(v);
    if (Number.isNaN(n) || n < min || n > max) return reject(ctx, v);
    return Math.round(n * 10) / 10;
  });
}

// 0 ("not set") or a number in [min, max], rounded to 1 decimal; numeric strings are accepted like looseNumber. '' and
// non-numeric values are INVALID (the client sends 0, never '', for an empty field).
function zeroOrRangedNumber(min, max) {
  return z.unknown().transform((v, ctx) => {
    const n = toFinite(v);
    if (Number.isNaN(n)) return reject(ctx, v);
    if (n === 0) return 0;
    const r = Math.round(n * 10) / 10;
    if (r < min || r > max) return reject(ctx, v);
    return r;
  });
}

module.exports = { noNul, id, dateStr, monthStr, yearStr, mealType, loggedAt, nullableNumber, rangedNumber, looseNumber, zeroOrRangedNumber, foodName, optionalQuery };
