import { html, setHtml } from './dom.js';
import { formatNumber } from './format.js';

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
// One SVG, viewBox 248 x 194 (it scales with the page). Time runs right to left like the page: the first row is the
// rightmost column. The goal label and its arrow sit ABOVE the plot (the plot starts at PLOT_TOP, so no bar can
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
  const cx = (i) => W - slot * (i + 0.5);

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
// Plate chart (arc SVG with tap tooltips)
// ════════════════════════════════════════════════════
export function renderPlate(svgId, legendId, tooltipId, totals) {
  const macros = [
    { key: 'pro',   label: 'חלבון',   color: '#5eead4', grams: Math.round(totals.pro   || 0), target: (window.userProfile?.protein_g  || 0) },
    { key: 'carb',  label: 'פחמימות', color: '#93c5fd', grams: Math.round(totals.carb  || 0), target: (window.userProfile?.carbs_g    || 0) },
    { key: 'fat',   label: 'שומן',    color: '#fca5a5', grams: Math.round(totals.fat   || 0), target: (window.userProfile?.fat_g      || 0) },
    { key: 'fiber', label: 'סיבים',   color: '#c4b5fd', grams: Math.round(totals.fiber || 0), target: 25 },
  ];

  const totalGrams = macros.reduce((s, m) => s + m.grams, 0) || 1;
  const CX = 100, CY = 100, R = 72, GAP_DEG = 3;
  const SVG_NS = 'http://www.w3.org/2000/svg';

  function degToRad(d) { return d * Math.PI / 180; }
  function arcPath(startDeg, sweepDeg, cx, cy, r) {
    if (sweepDeg <= 0) return null;
    const s = degToRad(startDeg);
    const e = degToRad(startDeg + sweepDeg);
    const x1 = cx + r * Math.cos(s), y1 = cy + r * Math.sin(s);
    const x2 = cx + r * Math.cos(e), y2 = cy + r * Math.sin(e);
    const large = sweepDeg > 180 ? 1 : 0;
    return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
  }

  const svgEl = document.getElementById(svgId);
  if (!svgEl) return;
  svgEl.replaceChildren();

  // Background ring
  const bg = document.createElementNS(SVG_NS, 'circle');
  bg.setAttribute('cx', CX); bg.setAttribute('cy', CY); bg.setAttribute('r', R);
  bg.setAttribute('fill', 'none'); bg.setAttribute('stroke', 'var(--surface2)'); bg.setAttribute('stroke-width', '20');
  svgEl.appendChild(bg);

  let currentDeg = -90;
  macros.forEach((m, i) => {
    const pct = m.grams / totalGrams;
    const sweepDeg = pct * 360 - GAP_DEG;
    if (sweepDeg <= 0) { currentDeg += pct * 360; return; }

    const d = arcPath(currentDeg, sweepDeg, CX, CY, R);
    if (!d) { currentDeg += pct * 360; return; }

    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', m.color);
    path.setAttribute('stroke-width', '20');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('data-macro', i);
    path.setAttribute('data-label', `${m.label}: ${m.grams}גר׳${m.target ? ' / ' + m.target + 'גר׳' : ''}`);
    path.style.cursor = 'pointer';

    // Tap/click handler — inline tooltip
    path.addEventListener('click', (e) => {
      const tip = document.getElementById(tooltipId);
      if (!tip) return;
      const active = path.getAttribute('data-active') === '1';
      // Clear all
      svgEl.querySelectorAll('[data-macro]').forEach(p => p.removeAttribute('data-active'));
      if (active) { tip.style.display = 'none'; return; }
      path.setAttribute('data-active', '1');
      tip.textContent = path.getAttribute('data-label');
      tip.style.display = 'block';
    });

    svgEl.appendChild(path);
    currentDeg += pct * 360;
  });

  // Close click-outside — use a stored handler to avoid duplicates
  if (svgEl._plateClickHandler) {
    svgEl.removeEventListener('click', svgEl._plateClickHandler);
  }
  svgEl._plateClickHandler = (e) => {
    if (!e.target.hasAttribute('data-macro')) {
      const tip = document.getElementById(tooltipId);
      if (tip) tip.style.display = 'none';
      svgEl.querySelectorAll('[data-macro]').forEach(p => p.removeAttribute('data-active'));
    }
  };
  svgEl.addEventListener('click', svgEl._plateClickHandler);

  // Legend
  const legendEl = document.getElementById(legendId);
  if (legendEl) {
    setHtml(legendEl, html`${macros.map(m => html`
      <div class="plate-legend-item">
        <div class="plate-legend-dot" style="background:${m.color}"></div>
        <span>${m.label} ${m.grams}גר׳</span>
      </div>`)}`);
  }
}
