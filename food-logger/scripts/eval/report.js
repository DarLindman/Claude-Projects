'use strict';

// The standalone HTML report of the naming evaluation (the counting lives in summary.js).
// Every name, file name and note is HTML-escaped: the names come from an AI and the file
// names from the disk.

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
.detail { margin-top:4px; font-size:.85rem; color:var(--muted); } .detail strong { color:var(--ink); }
.num { direction:ltr; unicode-bidi:isolate; } .err .detail { direction:rtl; }
.verdict { margin-top:8px; font-size:.9rem; } .verdict.yes { color:var(--good); } .verdict.no { color:var(--bad); }
`;

const flagSpans = (flags) => flags.map((f) => `<span class="flag ${esc(f)}">${esc(f)}</span>`).join('');

function nameCell(rec, side, detail = '') {
  if (!rec) return '<td class="err">-</td>';
  if (rec.error) return `<td class="err">${esc(rec.error)}${detail}</td>`;
  const flags = flagsFor(rec.name, rec.action);
  if (side === 'old' && wasStripped(rec)) flags.push('stripped');
  const raw = rec.raw !== undefined && rec.raw !== rec.name ? `<div class="raw">${esc(rec.raw)}</div>` : '';
  return `<td>${esc(rec.name)} ${flagSpans(flags)}${raw}${detail}</td>`;
}

// ─── the portions of the extra column ─────────────────────────────────────────
// Stored results from earlier runs lack items, scale and sanity: every part is optional.
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const shown = (v) => (num(v) === null ? '?' : String(num(v)));
const line = (label, value) => `<div class="detail">${label}: ${value}</div>`;
const ltr = (text) => `<span class="num">${esc(text)}</span>`;

// The calories this photo got before: the stored old and new sides and the replaced extra.
function earlierHtml(run) {
  const earlier = [['ישן', run?.old?.calories], ['חדש', run?.new?.calories], ['מודל קודם', run?.previousExtra?.calories]]
    .filter(([, c]) => c !== undefined && c !== null);
  return earlier.length ? line('קלוריות קודם', earlier.map(([label, c]) => `${esc(label)} ${ltr(String(c))}`).join(' &middot; ')) : '';
}

// Seconds with one decimal, from the milliseconds of a call.
const seconds = (ms) => `${(ms / 1000).toFixed(1)} s`;
const usable = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);

// The latency, tokens and stop reason of the call behind a record; nothing for results
// recorded before these fields existed.
function callHtml(rec) {
  const ms = usable(rec.ms);
  if (ms === null) return '';
  const parts = [seconds(ms)];
  if (usable(rec.inputTokens) !== null) parts.push(`in ${rec.inputTokens}`);
  if (usable(rec.outputTokens) !== null) parts.push(`out ${rec.outputTokens}`);
  if (typeof rec.stopReason === 'string' && rec.stopReason) parts.push(rec.stopReason);
  return line('זמן תגובה', ltr(parts.join(' · ')));
}

// The detail lines under the extra name: for an error record only the call and the earlier calories.
function portionsHtml(rec, run) {
  if (rec.error) return callHtml(rec) + earlierHtml(run);
  const out = [];
  // a reply the evaluation could not read has no numbers to show (old results lack the flag)
  if (rec.parsed === false) return line('תשובה', esc('לא נקראה')) + callHtml(rec) + earlierHtml(run);
  const items = Array.isArray(rec.items) ? rec.items.filter((it) => it && typeof it === 'object') : [];
  const grams = items.map((it) => num(it.weight_g)).filter((g) => g !== null);
  const total = [];
  if (items.length) {
    // a missing weight makes the sum a lower bound: say so instead of a clean, too low total
    const sum = Math.round(grams.reduce((a, b) => a + b, 0) * 10) / 10;
    const partial = grams.length < items.length;
    total.push(`${esc('משקל כולל')}: ${ltr(grams.length ? `${sum}${partial ? '+?' : ''} g` : '? g')}${partial ? ` ${esc('(חסר משקל לחלק מהפריטים)')}` : ''}`);
  }
  if (num(rec.calories) !== null) total.push(`${esc('קלוריות')}: ${ltr(`${rec.calories} kcal`)}`);
  if (total.length) out.push(`<div class="detail"><strong>${total.join(' &middot; ')}</strong></div>`);
  if (items.length) {
    const each = items.map((it) => `${shown(it.weight_g)} g${num(it.volume_ml) === null ? '' : ` / ${shown(it.volume_ml)} ml`}`).join(', ');
    out.push(line('גרמים לפי פריט (נפח)', ltr(each)));
  }
  if (typeof rec.scale === 'string' && rec.scale.trim()) out.push(line('קנה מידה', `<span dir="auto">${esc(rec.scale)}</span>`));
  const sanity = rec.sanity;
  if (sanity && typeof sanity === 'object') {
    const rules = sanity.rules && typeof sanity.rules === 'object' ? Object.entries(sanity.rules) : [];
    out.push(line('כללי תקינות', rules.length
      ? `${ltr(rules.map(([id, n]) => `${id} x${n}`).join(', '))} (${esc(`פריטים שתוקנו: ${num(sanity.adjusted) ?? 0}, שינוי קלוריות: ${num(sanity.calories_delta) ?? 0}`)})`
      : esc('לא הופעלו')));
  }
  out.push(callHtml(rec), earlierHtml(run));
  return out.join('');
}

// The label of the extra column: the model id the results say it ran on, with the prompt
// variant and the effort when the results record them (plain text: callers escape it).
function extraLabel(results) {
  const extra = results?.variants?.extra;
  const base = `עכשיו על ${extra?.label ?? extra?.model ?? 'מודל נוסף'}`;
  const how = [];
  if (extra?.prompt !== undefined && extra?.prompt !== null) how.push(`פרומפט ${extra.prompt}`);
  if (extra?.effort !== undefined && extra?.effort !== null) how.push(`מאמץ ${extra.effort}`);
  return how.length ? `${base} (${how.join(', ')})` : base;
}

function verdictDiv(rating, field, prefix) {
  if (!rating || typeof rating[field] !== 'boolean') return '';
  const yes = rating[field];
  // the note belongs to the new variant's verdict
  const note = field === 'natural' && rating.note ? ` &ndash; ${esc(rating.note)}` : '';
  return `<div class="verdict ${yes ? 'yes' : 'no'}">${prefix}${yes ? 'טבעי' : 'לא טבעי'}${note}</div>`;
}

function photoCard(photo, ratings, results, extra) {
  const runs = (photo.runs || []).map((r, i) =>
    `<tr><td>${i + 1}</td>${nameCell(r.old, 'old')}${nameCell(r.new, 'new')}${extra ? nameCell(r.extra, 'extra', r.extra ? portionsHtml(r.extra, r) : '') : ''}</tr>`).join('');
  const rating = ratings?.[photo.file];
  const verdict = verdictDiv(rating, 'natural', extra ? 'חדש: ' : '') + (extra ? verdictDiv(rating, 'extra', `${esc(extraLabel(results))}: `) : '');
  const img = photo.thumb ? `<img src="${esc(photo.thumb)}" alt="${esc(photo.file)}" loading="lazy">` : '';
  const head = `<th>#</th><th>לפני (פרומפט ישן)</th><th>עכשיו (פרומפט חדש + משמר)</th>${extra ? `<th>${esc(extraLabel(results))}</th>` : ''}`;
  return `<section class="card">${img}<div class="body"><h2 dir="auto">${esc(photo.file)}</h2>
<table><thead><tr>${head}</tr></thead><tbody>${runs}</tbody></table>${verdict}</div></section>`;
}

// The latency and token averages of the extra variant (null: none measured).
function statsLine(label, st) {
  const tokens = [];
  if (st.avgInputTokens !== null) tokens.push(`${esc('קלט')} ${ltr(String(st.avgInputTokens))}`);
  if (st.avgOutputTokens !== null) tokens.push(`${esc('פלט')} ${ltr(String(st.avgOutputTokens))}`);
  return `<p>${esc('זמן תגובה')}, ${label}: ${esc('ממוצע')} <strong>${ltr(seconds(st.avgMs))}</strong> &middot; ${esc('מקסימום')} <strong>${ltr(seconds(st.maxMs))}</strong>`
    + `${tokens.length ? ` &middot; ${esc('טוקנים בממוצע')}: ${tokens.join(', ')}` : ''} (${st.calls} ${esc('קריאות')})</p>`;
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
  if (extra && s.extraStats) lines.push(statsLine(esc(extraLabel(results)), s.extraStats));
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
