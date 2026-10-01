'use strict';

// The standalone HTML report of the naming evaluation (the counting lives in summary.js). Every name, file name and note is HTML-escaped: the names come
// from an AI and the file names from the disk.

const { FLAGS, MAX_WORDS, flagsFor, wasStripped, summarize, hasExtra } = require('./summary');

const LEGEND = {
  foreign: 'השם מכיל אותיות שאינן עבריות (לטינית, סינית ועוד)',
  repaired: 'המשמר ביקש מה-AI לכתוב את השם מחדש בעברית',
  cleaned: 'המשמר הסיר מילה זרה או קיצר את השם',
  fallback: 'לא נותר שם תקין, והוצג "מנה"',
  long: `יותר מ-${MAX_WORDS} מילים`,
  empty: 'אין שם בכלל',
  stripped: 'רק אצל הישן: ה-AI כתב שם עם אותיות זרות והן נמחקו בשקט',
};

// ─── HTML ─────────────────────────────────────────────────────────────────────
const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };
const esc = (v) => String(v ?? '').replace(/[&<>"'`]/g, (c) => ENTITIES[c]);

const CSS = `
:root { --bg:#fafaf7; --card:#fff; --ink:#1d1d1b; --muted:#6b6b66; --line:#e3e1da; --bad:#b3261e; --warn:#8a5a00; --good:#1b6e3c; }
@media (prefers-color-scheme: dark) { :root { --bg:#161614; --card:#1f1f1c; --ink:#ecebe6; --muted:#a09f98; --line:#34332f; --bad:#ff8a80; --warn:#ffcc66; --good:#7fd6a0; } }
* { box-sizing:border-box; }
body { margin:0; padding:16px; background:var(--bg); color:var(--ink); font:16px/1.5 system-ui, "Segoe UI", Arial, sans-serif; }
main { max-width:980px; margin:0 auto; }
h1 { font-size:1.5rem; margin:0 0 4px; } h2 { font-size:1.15rem; margin:24px 0 8px; }
.muted { color:var(--muted); font-size:.9rem; }
table { width:100%; border-collapse:collapse; background:var(--card); border:1px solid var(--line); }
th, td { padding:6px 10px; text-align:start; border-bottom:1px solid var(--line); vertical-align:top; }
.card { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:12px; margin:12px 0; display:flex; gap:12px; flex-wrap:wrap; }
.card img { width:160px; max-width:100%; height:auto; border-radius:8px; align-self:flex-start; }
.card .body { flex:1 1 320px; min-width:0; }
.flag { display:inline-block; font-size:.75rem; padding:0 6px; margin-inline-end:4px; border:1px solid currentColor; border-radius:10px; color:var(--warn); direction:ltr; }
.flag.foreign, .flag.fallback, .flag.empty { color:var(--bad); }
.err { color:var(--bad); direction:ltr; } .raw { color:var(--muted); font-size:.8rem; direction:ltr; unicode-bidi:plaintext; }
.verdict { margin-top:8px; font-size:.9rem; } .verdict.yes { color:var(--good); } .verdict.no { color:var(--bad); }
`;

const flagSpans = (flags) => flags.map((f) => `<span class="flag ${esc(f)}">${esc(f)}</span>`).join('');

function nameCell(rec, side) {
  if (!rec) return '<td class="err">-</td>';
  if (rec.error) return `<td class="err">${esc(rec.error)}</td>`;
  const flags = flagsFor(rec.name, rec.action);
  if (side === 'old' && wasStripped(rec)) flags.push('stripped');
  const raw = rec.raw !== undefined && rec.raw !== rec.name ? `<div class="raw">${esc(rec.raw)}</div>` : '';
  return `<td>${esc(rec.name)} ${flagSpans(flags)}${raw}</td>`;
}

// The label of the extra column: the model id the results say it ran on.
const extraLabel = (results) => `עכשיו על ${results?.variants?.extra?.label ?? results?.variants?.extra?.model ?? 'מודל נוסף'}`;

function verdictDiv(rating, field, prefix) {
  if (!rating || typeof rating[field] !== 'boolean') return '';
  const yes = rating[field];
  // the note belongs to the new variant's verdict
  const note = field === 'natural' && rating.note ? ` &ndash; ${esc(rating.note)}` : '';
  return `<div class="verdict ${yes ? 'yes' : 'no'}">${prefix}${yes ? 'טבעי' : 'לא טבעי'}${note}</div>`;
}

function photoCard(photo, ratings, results, extra) {
  const runs = (photo.runs || []).map((r, i) =>
    `<tr><td>${i + 1}</td>${nameCell(r.old, 'old')}${nameCell(r.new, 'new')}${extra ? nameCell(r.extra, 'extra') : ''}</tr>`).join('');
  const rating = ratings?.[photo.file];
  const verdict = verdictDiv(rating, 'natural', extra ? 'חדש: ' : '') + (extra ? verdictDiv(rating, 'extra', `${esc(extraLabel(results))}: `) : '');
  const img = photo.thumb ? `<img src="${esc(photo.thumb)}" alt="${esc(photo.file)}" loading="lazy">` : '';
  const head = `<th>#</th><th>לפני (פרומפט ישן)</th><th>עכשיו (פרומפט חדש + משמר)</th>${extra ? `<th>${esc(extraLabel(results))}</th>` : ''}`;
  return `<section class="card">${img}<div class="body"><h2 dir="auto">${esc(photo.file)}</h2>
<table><thead><tr>${head}</tr></thead><tbody>${runs}</tbody></table>${verdict}</div></section>`;
}

const naturalLine = (label, n) => `<p>${label}: <strong>${n.percent}%</strong> (${n.natural} מתוך ${n.rated} תמונות מדורגות)</p>`;

function renderReport(results, ratings) {
  const s = summarize(results, ratings);
  const extra = hasExtra(results);
  const rows = [...FLAGS, 'stripped', 'errors'].map((f) =>
    `<tr><td>${esc(f)}</td><td>${s.old[f]}</td><td>${s.new[f]}</td>${extra ? `<td>${s.extra[f]}</td>` : ''}<td class="muted">${esc(LEGEND[f] || (f === 'errors' ? 'הקריאה נכשלה' : ''))}</td></tr>`).join('');
  const lines = [];
  if (s.natural) lines.push(naturalLine('שמות טבעיים (לפי הדירוג שלך)', s.natural));
  if (extra && s.naturalExtra) lines.push(naturalLine(`שמות טבעיים, ${esc(extraLabel(results))}`, s.naturalExtra));
  const natural = lines.length ? lines.join('\n') : '<p class="muted">אין דירוגים (אפשר להוסיף eval/ratings.json).</p>';
  const when = results.generatedAt ? ` &middot; ${esc(results.generatedAt)}` : '';
  const extraHead = extra ? `<th>${esc(extraLabel(results))}</th>` : '';
  return `<!doctype html>
<html lang="he" dir="rtl">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>השוואת שמות מנות</title><style>${CSS}</style></head>
<body><main>
<h1>השוואת שמות מנות: לפני ואחרי</h1>
<p class="muted">${s.photos} תמונות &middot; ${s.runsPerPhoto} הרצות לכל תמונה &middot; ${s.totalRuns} הרצות בסך הכול${when}</p>
<h2>סיכום (מספר הרצות עם כל סימון)</h2>
<table><thead><tr><th>סימון</th><th>לפני</th><th>עכשיו</th>${extraHead}<th>משמעות</th></tr></thead><tbody>${rows}</tbody></table>
${natural}
${(results.photos || []).map((p) => photoCard(p, ratings, results, extra)).join('\n')}
</main></body></html>
`;
}

module.exports = { flagsFor, summarize, renderReport, FLAGS };
