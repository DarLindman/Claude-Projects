import { html, setHtml } from './dom.js';
import { formatKg, formatNumber } from './format.js';

// ── Shared stat helpers ──────────────────────────────────────────────────────
const byId = (id) => document.getElementById(id);
// A value that can be drawn: a finite number above zero, else 0 (never NaN, never negative).
const positive = (v) => (Number.isFinite(+v) && +v > 0 ? +v : 0);
const r1 = (n) => Math.round(n * 10) / 10;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// The headline of a stats view: the average in handwriting with its unit, and how far it is from the recommended
// calories. With no rows the view says there is no data.
export function renderStatAvgBox(elId, rows, rec, label, customAvg) {
  const el = byId(elId);
  if (!el) return;
  if (!rows.length) { setHtml(el, html`<div class="stat-empty">אין נתונים</div>`); return; }
  const avgCal = customAvg !== undefined ? customAvg : Math.round(rows.reduce((s, r) => s + positive(r.calories), 0) / rows.length);
  let diffHtml = '';
  if (rec > 0) {
    const diff = avgCal - rec;
    const cls = diff <= 0 ? 'under' : 'over';
    // the signed number is isolated left-to-right, so its sign stays on its left in the RTL page
    diffHtml = html`<div class="stat-diff ${cls}"><bdi dir="ltr">${diff > 0 ? '+' : ''}${formatNumber(diff)}</bdi> קק״ל מהמומלץ</div>`;
  }
  setHtml(el, html`<div class="stat-head"><span class="avg-val">${formatNumber(avgCal)}</span><span class="avg-label">${label}</span></div>${diffHtml}`);
}

// The three macro bars (protein, carbs, fat) of the average day, with the footnote under them. No days: nothing.
export function renderStatMacros(elId, rows, footnote, divisor) {
  const el = byId(elId);
  if (!el) return;
  const n = divisor || rows.length;
  if (!n) { el.replaceChildren(); return; }
  const sum = rows.reduce((a, r) => ({
    pro: a.pro + positive(r.protein_g), carb: a.carb + positive(r.carbs_g), fat: a.fat + positive(r.fat_g),
  }), { pro: 0, carb: 0, fat: 0 });
  const items = [
    { key: 'pro',  label: 'חלבון',    val: Math.round(sum.pro / n),  target: 50 },
    { key: 'carb', label: 'פחמימות', val: Math.round(sum.carb / n), target: 250 },
    { key: 'fat',  label: 'שומן',    val: Math.round(sum.fat / n),  target: 65 },
  ];
  setHtml(el, html`${items.map(it => html`<div class="ink"><span>${it.label}</span><div class="track"><div class="fill ${it.key}" style="width:${clamp(it.val / it.target * 100, 0, 100)}%"></div></div><b>${it.val} גרם</b></div>`)}${footnote ? html`<p class="stat-note">${footnote}</p>` : ''}`);
}

// ════════════════════════════════════════════════════
// Hand-drawn bar chart (the stats screen)
// ════════════════════════════════════════════════════
// One SVG, viewBox 248 x 194 (it scales with the page). Time runs left to right, like the weight graph: the first row (the
// oldest) is the leftmost column and the newest the rightmost. The goal label and its arrow sit ABOVE the plot (the plot starts at PLOT_TOP, so no bar can
// reach the label); the scale always includes the goal and the largest value, so no bar leaves the plot. A day over the
// goal is red; a day without data is a short pencil dash on the baseline; future days draw nothing.
const W = 248, BASE = 170, PLOT_TOP = 48, LABEL_Y = 188, GOAL_LABEL_Y = 15, VIEW_H = 194;

export function renderBarChart(rows, { getValue, getLabel, isToday = () => false, isFuture = () => false, showLabel = () => true, recommended = 0, labelSize = 16 }) {
  const n = rows.length;
  const slot = W / Math.max(n, 1);
  const bw = r1(Math.min(22, slot * 0.64));
  const vals = rows.map(r => positive(getValue(r)));
  const goal = positive(recommended);
  const top = Math.max(...vals, goal, 1);
  const scale = (BASE - PLOT_TOP) / top;
  const yOf = (v) => BASE - v * scale;
  const cx = (i) => slot * (i + 0.5);

  const bars = rows.map((r, i) => {
    if (isFuture(r)) return '';
    const v = vals[i];
    const x = cx(i);
    if (v <= 0) return html`<path class="tick" d="M${r1(x - bw / 3)} ${BASE - 1} H${r1(x + bw / 3)}"/>`;
    const h = Math.max(v * scale, 3);
    const over = goal > 0 && v > goal;
    return html`<rect class="${over ? 'bar over' : 'bar'}" x="${r1(x - bw / 2)}" y="${r1(BASE - h)}" width="${bw}" height="${r1(h)}"/>`;
  });

  let goalInk = '';
  let goalText = '';
  if (goal > 0) {
    const gy = r1(yOf(goal));
    // the arrow comes down over a column whose bar stays below the goal line (the one nearest the middle, so the label is
    // centred), so it never crosses a bar; with every bar above the line it takes the lowest and stops above that bar
    let k = -1;
    rows.forEach((r, i) => { if (!isFuture(r) && vals[i] < goal && (k < 0 || Math.abs(cx(i) - W / 2) < Math.abs(cx(k) - W / 2))) k = i; });
    if (k < 0) rows.forEach((r, i) => { if (!isFuture(r) && (k < 0 || vals[i] < vals[k])) k = i; });
    const ax = k < 0 ? W / 2 : clamp(cx(k), 6, W - 6);
    const lowTop = k >= 0 && vals[k] > 0 ? yOf(vals[k]) : BASE;
    const endY = r1(Math.min(gy, lowTop) - 3);
    const lx = r1(clamp(ax, 38, W - 38));
    // the sideways move (label centre to the column) happens ABOVE the plot, where no bar reaches; inside the plot the
    // shaft is vertical over its own column, and the head is narrower than a column so it never touches a neighbour's bar
    const hw = r1(Math.min(5, slot / 2 - 1.5));
    const turnY = r1(Math.min(PLOT_TOP - 8, endY - 4));
    goalInk = html`<line class="goal-line" x1="0" y1="${gy}" x2="${W}" y2="${gy}" stroke-dasharray="6 5"/>
      <path class="goal-arrow" d="M${lx} 22 Q${r1(ax)} 22 ${r1(ax)} ${turnY} L${r1(ax)} ${r1(endY - 4)}"/>
      <path class="goal-arrow" d="M${r1(ax - hw)} ${r1(endY - 8)} L${r1(ax)} ${endY} L${r1(ax + hw)} ${r1(endY - 8)}"/>`;
    goalText = html`<text class="goal-label" x="${lx}" y="${GOAL_LABEL_Y}" text-anchor="middle" font-size="16">יעד <tspan>${formatNumber(goal)}</tspan></text>`;
  }

  const labels = rows.map((r, i) => (showLabel(r, i)
    ? html`<text class="${isToday(r) ? 'chart-day today' : 'chart-day'}" x="${r1(cx(i))}" y="${LABEL_Y}" text-anchor="middle" font-size="${labelSize}">${getLabel(r)}</text>`
    : ''));

  // the invisible frame keeps the filtered group's box from collapsing to a line (an empty chart is only dashes)
  return html`<svg viewBox="0 0 ${W} ${VIEW_H}" overflow="visible" xmlns="http://www.w3.org/2000/svg">
    <g class="chart-ink" filter="url(#wobS)" stroke-width="${n > 12 ? 1.4 : 2}" stroke-linejoin="round" stroke-linecap="round">
      <rect class="chart-frame" x="0" y="${PLOT_TOP - 2}" width="${W}" height="${BASE - PLOT_TOP + 2}" fill="none" stroke="none"/>
      ${goalInk}
      <line class="base-line" x1="0" y1="${BASE}" x2="${W}" y2="${BASE}"/>
      ${bars}
    </g>
    ${goalText}
    ${labels}
  </svg>`;
}

// ════════════════════════════════════════════════════
// Weight line graph on squared paper (the weight screen)
// ════════════════════════════════════════════════════
// One SVG, viewBox 248 x 130 (it scales with the page), the paper of the reference: a grid every 26 / 31 units, the line in
// ink, every point a cream circle with an ink outline and the newest one red, the goal a dashed red line. Time runs left to
// right, the newest point is the rightmost. The scale always includes the goal and spans at least MIN_SPAN kg, so a goal
// above or below every value stays on the paper, and equal values (a zero range) sit in the middle instead of dividing by
// zero. The left WGUTTER units are a gutter for the numbers: the lowest and the highest weight (and the goal) at the height of
// their value, in kg, digits only; the points and the goal line start right of it, so no label touches them. Up to MAX_DOTS points get a circle each; a longer history keeps the line and circles only the newest point.
const WW = 248, WH = 130, WGUTTER = 36, WX0 = 44, WX1 = 238, WY0 = 16, WY1 = 114, MIN_SPAN = 2, MAX_DOTS = 60;
const WGRID = 'M0 26h248M0 52h248M0 78h248M0 104h248M31 0v130M62 0v130M93 0v130M124 0v130M155 0v130M186 0v130M217 0v130';
const r2 = (n) => Math.round(n * 100) / 100;

export function renderWeightChart(values, { goal = 0 } = {}) {
  const vals = values.map(Number).filter((v) => Number.isFinite(v) && v > 0);
  const g = positive(goal);
  const scaled = g > 0 ? [...vals, g] : vals;
  let lo = scaled.length ? Math.min(...scaled) : 0;
  let hi = scaled.length ? Math.max(...scaled) : 0;
  if (hi - lo < MIN_SPAN) { const mid = (hi + lo) / 2; lo = mid - MIN_SPAN / 2; hi = mid + MIN_SPAN / 2; }
  const yOf = (v) => r2(WY1 - ((v - lo) / (hi - lo)) * (WY1 - WY0));

  const n = vals.length;
  const pts = vals.map((v, i) => ({ x: r2(n === 1 ? (WX0 + WX1) / 2 : WX0 + (i / (n - 1)) * (WX1 - WX0)), y: yOf(v) }));
  const line = n >= 2 ? html`<polyline class="wline" points="${pts.map((p) => `${p.x},${p.y}`).join(' ')}" fill="none" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"/>` : '';
  const r = n <= 14 ? 4 : n <= 30 ? 3 : 2.2;
  const shown = n > MAX_DOTS ? [n - 1] : pts.map((p, i) => i);
  const dots = shown.map((i) => (i === n - 1
    ? html`<circle class="wpt last" cx="${pts[i].x}" cy="${pts[i].y}" r="${r + 1}" stroke-width="${r > 3 ? 2.4 : 1.8}"/>`
    : html`<circle class="wpt" cx="${pts[i].x}" cy="${pts[i].y}" r="${r}" stroke-width="${r > 3 ? 2.4 : 1.8}"/>`));
  const goalLine = g > 0 ? html`<line class="goal-line" x1="${WGUTTER}" y1="${yOf(g)}" x2="${WW}" y2="${yOf(g)}" stroke-dasharray="6 5" stroke-width="2"/>` : '';

  // the gutter labels: lowest, highest and the goal, each at the height of its value; two that would touch are pushed apart
  const wants = [];
  if (n) {
    const lowest = Math.min(...vals), highest = Math.max(...vals);
    wants.push({ v: highest, cls: 'wlbl' });
    if (lowest !== highest) wants.push({ v: lowest, cls: 'wlbl' });
  }
  if (g > 0 && !wants.some((w) => Math.abs(w.v - g) < 0.05)) wants.push({ v: g, cls: 'wlbl goal' });
  wants.forEach((w) => { w.y = yOf(w.v); });
  wants.sort((a, b) => a.y - b.y);
  for (let i = 1; i < wants.length; i++) wants[i].y = Math.max(wants[i].y, r2(wants[i - 1].y + 12));
  for (let i = wants.length - 2; i >= 0 && wants.length && wants[wants.length - 1].y > WH - 6; i--) wants[i].y = Math.min(wants[i].y, wants[i + 1].y - 12);
  const numbers = wants.map((w) => html`<text class="${w.cls}" x="${WGUTTER / 2}" y="${r2(w.y)}" dy=".35em" text-anchor="middle" font-size="11">${formatKg(w.v)}</text>`);

  // the paper is inside the filtered group, so its box never collapses (a flat line would otherwise have no height and vanish)
  return html`<svg class="wchart" viewBox="0 0 ${WW} ${WH}" overflow="visible" xmlns="http://www.w3.org/2000/svg">
    <g filter="url(#wobS)" stroke-linecap="round">
      <path class="wgrid" d="${WGRID}" fill="none" stroke-width="1"/>
      ${goalLine}
      ${line}
      ${dots}
    </g>
    ${numbers}
  </svg>`;
}
