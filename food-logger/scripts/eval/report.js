'use strict';

// Pure functions of the naming evaluation: flags of a name, the summary counts and the
// standalone HTML report. Every name, file name and note is HTML-escaped: the names come
// from an AI and the file names from the disk.

const { findForeignScript } = require('../../src/lib/hebrewName');

const FLAGS = ['foreign', 'repaired', 'cleaned', 'fallback', 'long', 'empty'];
const MAX_WORDS = 6;

const LEGEND = {
  foreign: 'השם מכיל אותיות שאינן עבריות (לטינית, סינית ועוד)',
  repaired: 'המשמר ביקש מה-AI לכתוב את השם מחדש בעברית',
  cleaned: 'המשמר הסיר מילה זרה או קיצר את השם',
  fallback: 'לא נותר שם תקין, והוצג "מנה"',
  long: `יותר מ-${MAX_WORDS} מילים`,
  empty: 'אין שם בכלל',
  stripped: 'רק אצל הישן: ה-AI כתב שם עם אותיות זרות והן נמחקו בשקט',
};

function flagsFor(name, action) {
  const flags = [];
  const text = typeof name === 'string' ? name : '';
  if (!text.trim()) return ['empty'];
  if (findForeignScript(text)) flags.push('foreign');
  if (action === 'repaired' || action === 'cleaned' || action === 'fallback') flags.push(action);
  if (text.trim().split(/\s+/).length > MAX_WORDS) flags.push('long');
  return flags;
}

// The old pipeline's name differs from what the AI wrote beyond whitespace: it was stripped.
const wasStripped = (rec) => typeof rec.raw === 'string' && rec.raw.trim().replace(/\s+/g, ' ') !== rec.name;

const emptyCounts = () => ({ ...Object.fromEntries(FLAGS.map((f) => [f, 0])), stripped: 0, errors: 0 });

function countSide(runs, side) {
  const counts = emptyCounts();
  for (const r of runs) {
    const rec = r[side];
    if (!rec || rec.error) { counts.errors++; continue; }
    for (const f of flagsFor(rec.name, rec.action)) counts[f]++;
    if (side === 'old' && wasStripped(rec)) counts.stripped++;
  }
  return counts;
}

function naturalOf(results, ratings) {
  let rated = 0;
  let natural = 0;
  for (const photo of results.photos) {
    const verdict = ratings?.[photo.file]?.natural;
    if (typeof verdict !== 'boolean') continue;
    rated++;
    if (verdict) natural++;
  }
  return rated ? { rated, natural, percent: Math.round((natural / rated) * 1000) / 10 } : null;
}

function summarize(results, ratings) {
  const photos = results.photos || [];
  const all = photos.flatMap((p) => p.runs || []);
  return {
    photos: photos.length,
    runsPerPhoto: results.runsPerPhoto ?? Math.max(0, ...photos.map((p) => (p.runs || []).length)),
    totalRuns: all.length,
    old: countSide(all, 'old'),
    new: countSide(all, 'new'),
    natural: naturalOf({ photos }, ratings),
  };
}

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

function photoCard(photo, ratings) {
  const runs = (photo.runs || []).map((r, i) =>
    `<tr><td>${i + 1}</td>${nameCell(r.old, 'old')}${nameCell(r.new, 'new')}</tr>`).join('');
  const rating = ratings?.[photo.file];
  let verdict = '';
  if (rating && typeof rating.natural === 'boolean') {
    const note = rating.note ? ` &ndash; ${esc(rating.note)}` : '';
    verdict = `<div class="verdict ${rating.natural ? 'yes' : 'no'}">${rating.natural ? 'טבעי' : 'לא טבעי'}${note}</div>`;
  }
  const img = photo.thumb ? `<img src="${esc(photo.thumb)}" alt="${esc(photo.file)}" loading="lazy">` : '';
  return `<section class="card">${img}<div class="body"><h2 dir="auto">${esc(photo.file)}</h2>
<table><thead><tr><th>#</th><th>לפני (פרומפט ישן)</th><th>עכשיו (פרומפט חדש + משמר)</th></tr></thead><tbody>${runs}</tbody></table>${verdict}</div></section>`;
}

function renderReport(results, ratings) {
  const s = summarize(results, ratings);
  const rows = [...FLAGS, 'stripped', 'errors'].map((f) =>
    `<tr><td>${esc(f)}</td><td>${s.old[f]}</td><td>${s.new[f]}</td><td class="muted">${esc(LEGEND[f] || (f === 'errors' ? 'הקריאה נכשלה' : ''))}</td></tr>`).join('');
  const natural = s.natural
    ? `<p>שמות טבעיים (לפי הדירוג שלך): <strong>${s.natural.percent}%</strong> (${s.natural.natural} מתוך ${s.natural.rated} תמונות מדורגות)</p>`
    : '<p class="muted">אין דירוגים (אפשר להוסיף eval/ratings.json).</p>';
  const when = results.generatedAt ? ` &middot; ${esc(results.generatedAt)}` : '';
  return `<!doctype html>
<html lang="he" dir="rtl">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>השוואת שמות מנות</title><style>${CSS}</style></head>
<body><main>
<h1>השוואת שמות מנות: לפני ואחרי</h1>
<p class="muted">${s.photos} תמונות &middot; ${s.runsPerPhoto} הרצות לכל תמונה &middot; ${s.totalRuns} הרצות בסך הכול${when}</p>
<h2>סיכום (מספר הרצות עם כל סימון)</h2>
<table><thead><tr><th>סימון</th><th>לפני</th><th>עכשיו</th><th>משמעות</th></tr></thead><tbody>${rows}</tbody></table>
${natural}
${(results.photos || []).map((p) => photoCard(p, ratings)).join('\n')}
</main></body></html>
`;
}

module.exports = { flagsFor, summarize, renderReport, FLAGS };
