'use strict';

// The standalone RTL Hebrew HTML report of the text evaluation (scripts/eval-text.js).
// Every value (the typed texts, the AI's names and items, the error messages) is
// HTML-escaped: the names come from an AI.

const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };
const esc = (v) => String(v ?? '').replace(/[&<>"'`]/g, (c) => ENTITIES[c]);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const ltr = (v) => `<span class="num">${esc(v)}</span>`;
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const round = (v, digits = 0) => (isNum(v) ? Number(v.toFixed(digits)) : null);

// Per model: the number of runs, failed runs, name actions, averages of latency / tokens / calories.
function summarize(results) {
  const out = {};
  for (const model of results.models) {
    const recs = results.inputs.flatMap((input) => input.results[model] || []);
    const ok = recs.filter((r) => !r.error);
    out[model] = {
      runs: recs.length,
      errors: recs.length - ok.length,
      repaired: ok.filter((r) => r.nameAction === 'repaired').length,
      cleaned: ok.filter((r) => r.nameAction === 'cleaned').length,
      fallback: ok.filter((r) => r.nameAction === 'fallback').length,
      avgMs: round(avg(ok.map((r) => r.ms).filter(isNum))),
      avgInputTokens: round(avg(ok.map((r) => r.inputTokens).filter(isNum))),
      avgOutputTokens: round(avg(ok.map((r) => r.outputTokens).filter(isNum))),
      avgCalories: round(avg(ok.map((r) => r.calories).filter(isNum))),
    };
  }
  return out;
}

const CSS = `
:root { --bg:#fafaf7; --card:#fff; --ink:#1d1d1b; --muted:#6b6b66; --line:#e3e1da; --bad:#b3261e; --warn:#8a5a00; }
@media (prefers-color-scheme: dark) { :root { --bg:#161614; --card:#1f1f1c; --ink:#ecebe6; --muted:#a09f98; --line:#34332f; --bad:#ff8a80; --warn:#ffcc66; } }
* { box-sizing:border-box; }
body { margin:0; padding:16px; background:var(--bg); color:var(--ink); font:16px/1.5 system-ui, "Segoe UI", Arial, sans-serif; }
main { max-width:1100px; margin:0 auto; }
h1 { font-size:1.5rem; margin:0 0 4px; } h2 { font-size:1.15rem; margin:24px 0 8px; }
.muted { color:var(--muted); font-size:.9rem; }
table { width:100%; border-collapse:collapse; background:var(--card); border:1px solid var(--line); }
th, td { padding:6px 10px; text-align:start; border-bottom:1px solid var(--line); vertical-align:top; }
.num { direction:ltr; unicode-bidi:isolate; display:inline-block; }
.err { color:var(--bad); direction:ltr; unicode-bidi:plaintext; }
.flag { display:inline-block; font-size:.75rem; padding:0 6px; border:1px solid currentColor; border-radius:10px; color:var(--warn); direction:ltr; }
.detail { font-size:.85rem; color:var(--muted); } .items { margin:4px 0 0; padding-inline-start:18px; font-size:.9rem; }
.input { font-weight:600; }
`;

function recordCell(rec) {
  if (!rec) return '<td class="err">-</td>';
  if (rec.error) return `<td class="err">${esc(rec.error)}</td>`;
  const macros = `חלבון ${ltr(round(rec.protein_g, 1))} · פחמימות ${ltr(round(rec.carbs_g, 1))} · שומן ${ltr(round(rec.fat_g, 1))} · סיבים ${ltr(round(rec.fiber_g, 1))}`;
  const items = (rec.items || []).map((it) => `<li>${esc(it.name)} ${ltr(it.calories)}</li>`).join('');
  const action = rec.nameAction && rec.nameAction !== 'ok' ? ` <span class="flag">${esc(rec.nameAction)}</span>` : '';
  return `<td><div><strong>${esc(rec.foodName)}</strong>${action}</div>`
    + `<div>${ltr(rec.calories)} קק״ל</div>`
    + `<div class="detail">${macros}</div>`
    + (items ? `<ul class="items">${items}</ul>` : '')
    + `<div class="detail">${ltr(`${rec.ms ?? '?'} ms`)} · טוקנים ${ltr(`in ${rec.inputTokens ?? '?'} / out ${rec.outputTokens ?? '?'}`)}${rec.calls > 1 ? ` · ${ltr(rec.calls)} קריאות` : ''}</div></td>`;
}

function renderReport(results) {
  const summary = summarize(results);
  const head = results.models.map((m) => `<th>${ltr(m)}</th>`).join('');
  const summaryRows = results.models.map((m) => {
    const s = summary[m];
    return `<tr><td>${ltr(m)}</td><td>${ltr(s.runs)}</td><td>${ltr(s.errors)}</td>`
      + `<td>${ltr(s.repaired)} / ${ltr(s.cleaned)} / ${ltr(s.fallback)}</td>`
      + `<td>${ltr(s.avgMs ?? '?')}</td><td>${ltr(`${s.avgInputTokens ?? '?'} / ${s.avgOutputTokens ?? '?'}`)}</td><td>${ltr(s.avgCalories ?? '?')}</td></tr>`;
  }).join('');
  const rows = results.inputs.map((input) => {
    const maxRuns = Math.max(0, ...results.models.map((m) => (input.results[m] || []).length));
    let html = '';
    for (let n = 0; n < maxRuns; n++) {
      const label = n === 0 ? `<td class="input" rowspan="${maxRuns}">${esc(input.text)}</td>` : '';
      html += `<tr>${label}${results.models.map((m) => recordCell((input.results[m] || [])[n])).join('')}</tr>`;
    }
    return html;
  }).join('');
  return `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>השוואת ניתוח טקסט בין מודלים</title>
<style>${CSS}</style>
</head>
<body>
<main>
<h1>השוואת ניתוח טקסט בין מודלים</h1>
<p class="muted">נוצר ${ltr(results.generatedAt)} · ${ltr(results.inputs.length)} תיאורי ארוחה · ${ltr(results.runsPerInput)} הרצות לכל תיאור · ${ltr(results.apiCalls)} קריאות API. אותו קוד כמו בייצור: המשמר של השם, כללי ההיגיון התזונתי והניסיון החוזר.</p>
<h2>סיכום</h2>
<table>
<thead><tr><th>מודל</th><th>הרצות</th><th>שגיאות</th><th>שם: תוקן / נוקה / ברירת מחדל</th><th>זמן ממוצע (ms)</th><th>טוקנים ממוצע (in / out)</th><th>קלוריות ממוצע</th></tr></thead>
<tbody>${summaryRows}</tbody>
</table>
<h2>כל התיאורים</h2>
<table>
<thead><tr><th>טקסט</th>${head}</tr></thead>
<tbody>${rows}</tbody>
</table>
</main>
</body>
</html>
`;
}

module.exports = { renderReport, summarize, esc };
