// The printed receipt of an analysis: no title, one row per item (name, dotted leader, the
// item's calories), a dashed rule, the total in large type and one row of macros. Never any
// weights. The server returns at most 8 items, so it cannot say whether any were dropped: only
// when a full 8 arrive and the rows add up to clearly less than the total (by more than the at
// most 4 kcal that rounding 8 items can drift) does one row `ועוד` carry the remainder. Pure (no
// DOM); the result is a Trusted fragment (see dom.js), so every name is escaped by `html`.
import { html } from './dom.js';
import { formatNumber } from './format.js';

const MAX_ITEMS = 8;
const MAX_DRIFT = 4; // the server rounds each item (at most 0.5 off); 8 items -> 4
const MAX_NAME_CHARS = 40;

// A number or a numeric string (a NUMERIC column arrives as '722'); anything else is 0.
const whole = (v) => {
  const n = typeof v === 'number' || (typeof v === 'string' && v.trim() !== '') ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
};
const cut = (name) => Array.from(String(name ?? '')).slice(0, MAX_NAME_CHARS).join('');

const row = (name, calories) =>
  html`<div class="l"><span class="nm">${name}</span><span class="d"></span><b>${formatNumber(calories)}</b></div>`;

export function receiptHtml(r) {
  const data = r || {};
  const given = Array.isArray(data.items) ? data.items : [];
  const items = given.slice(0, MAX_ITEMS)
    .map((it) => ({ name: cut(it && it.name), calories: whole(it && it.calories) }));
  const total = whole(data.calories);
  const rest = total - items.reduce((sum, it) => sum + it.calories, 0);

  const rows = items.map((it) => row(it.name, it.calories));
  if (given.length >= MAX_ITEMS && rest > MAX_DRIFT) rows.push(row('ועוד', rest));

  return html`<div class="receipt receipt-slip">${rows}${items.length ? html`<hr>` : ''}<div class="tt"><span>סה״כ</span><b>${formatNumber(total)}</b></div><div class="mac"><span>חלבון ${whole(data.protein_g)}ג</span><span>פחמימות ${whole(data.carbs_g)}ג</span><span>שומן ${whole(data.fat_g)}ג</span></div><div class="bar" aria-hidden="true"></div></div>`;
}
