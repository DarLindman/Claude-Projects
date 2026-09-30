import { html, setHtml } from './dom.js';

// ── Shared stat helpers ──────────────────────────────────────────────────────
export function renderStatAvgBox(elId, rows, rec, label, customAvg) {
  const el = document.getElementById(elId);
  if (!rows.length) { el.replaceChildren(); return; }
  const avgCal = customAvg !== undefined ? customAvg : Math.round(rows.reduce((s, r) => s + (+r.calories || 0), 0) / rows.length);
  let diffHtml = '';
  if (rec > 0) {
    const diff = avgCal - rec;
    const cls = diff <= 0 ? 'under' : 'over';
    diffHtml = html`<div class="avg-diff ${cls}">${diff > 0 ? '+' : ''}${diff} קל'</div><div style="font-size:11px;color:var(--muted)">מהמומלץ</div>`;
  }
  setHtml(el, html`<div class="avg-box"><div class="avg-box-left"><div class="avg-val">${avgCal}</div><div class="avg-label">${label}</div></div><div class="avg-box-right">${diffHtml}</div></div>`);
}

export function renderStatMacros(elId, rows, footnote, divisor) {
  const n = divisor || rows.length;
  const sum = rows.reduce((a, r) => ({
    pro: a.pro + (+r.protein_g || 0), carb: a.carb + (+r.carbs_g || 0),
    fat: a.fat + (+r.fat_g || 0), fiber: a.fiber + (+r.fiber_g || 0),
  }), { pro: 0, carb: 0, fat: 0, fiber: 0 });
  const avgt = { protein_g: sum.pro / n, carbs_g: sum.carb / n, fat_g: sum.fat / n, fiber_g: sum.fiber / n };
  setHtml(document.getElementById(elId), html`${renderMacroProgressBars(avgt)}<p style="font-size:11px;color:var(--muted);margin-top:10px;text-align:center">${footnote}</p>`);
}

// ════════════════════════════════════════════════════
// SVG line chart with dots and date labels
// ════════════════════════════════════════════════════
export function renderLineChart(rows, { getValue, getLabel, isToday, recommended, dayLetters }) {
  const W = 320, H = 150, BOTTOM = 28, TOP = 16, LEFT = 8, RIGHT = 14;
  const chartW = W - LEFT - RIGHT;
  const chartH = H - BOTTOM - TOP;
  const n = rows.length;
  const values = rows.map(getValue);
  const maxVal = Math.max(...values, recommended || 0, 1);
  const range = maxVal || 1;

  const pts = rows.map((r, i) => {
    const x = n === 1 ? W / 2 : LEFT + (i / (n - 1)) * chartW;
    const y = TOP + chartH - (getValue(r) / range) * chartH;
    const hasData = getValue(r) > 0;
    return { x, y, r, hasData };
  });

  // Polyline only for points that have data
  const dataPoints = pts.filter(p => p.hasData);
  const polyline = dataPoints.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

  // Estimated total path length for dashoffset animation
  let pathLen = 0;
  for (let i = 1; i < dataPoints.length; i++) {
    const dx = dataPoints[i].x - dataPoints[i-1].x;
    const dy = dataPoints[i].y - dataPoints[i-1].y;
    pathLen += Math.sqrt(dx*dx + dy*dy);
  }

  const dots = pts.map(p => {
    const isT = isToday(p.r);
    if (p.hasData) {
      return html`<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${isT ? 4.5 : 3.5}"
        fill="${isT ? 'var(--accent)' : 'rgba(232,112,58,0.8)'}" stroke="var(--bg)" stroke-width="1.5"/>`;
    } else {
      return html`<circle cx="${p.x.toFixed(1)}" cy="${(TOP + chartH).toFixed(1)}" r="2"
        fill="var(--muted)" opacity="0.5"/>`;
    }
  });

  // Labels: prefer dayLetters if provided, else getLabel
  const step = n <= 10 ? 1 : n <= 20 ? 2 : 5;
  const labels = pts.map((p, i) => {
    if (i % step !== 0 && i !== n - 1) return '';
    const isT = isToday(p.r);
    const lbl = (dayLetters && dayLetters[i]) ? dayLetters[i] : getLabel(p.r);
    return html`<text x="${p.x.toFixed(1)}" y="${H - 6}" text-anchor="middle"
      font-size="9" fill="${isT ? 'var(--accent)' : 'var(--muted)'}"
      font-family="IBM Plex Mono,monospace">${lbl}</text>`;
  });

  let recLine = '';
  if (recommended > 0) {
    const ry = TOP + chartH - (recommended / range) * chartH;
    const labelY = ry < TOP + 12 ? ry + 10 : ry - 3;
    recLine = html`<line x1="${LEFT}" y1="${ry.toFixed(1)}" x2="${W - RIGHT}" y2="${ry.toFixed(1)}"
      stroke="var(--gold)" stroke-dasharray="4,3" opacity="0.7" stroke-width="1"/>
      <text x="${W - RIGHT - 2}" y="${labelY.toFixed(1)}" text-anchor="end"
      font-size="8" fill="var(--gold)" opacity="0.9" font-family="IBM Plex Mono,monospace">${recommended}</text>`;
  }

  const polylineId = 'lc-' + Math.random().toString(36).slice(2, 7);

  return html`<svg viewBox="0 0 ${W} ${H}" overflow="visible" xmlns="http://www.w3.org/2000/svg">
    ${recLine}
    ${dataPoints.length > 1 ? html`<polyline id="${polylineId}" points="${polyline}" fill="none"
      stroke="rgba(232,112,58,0.7)" stroke-width="1.8"
      stroke-linejoin="round" stroke-linecap="round"
      stroke-dasharray="${pathLen.toFixed(0)}"
      stroke-dashoffset="${pathLen.toFixed(0)}"
      style="transition: stroke-dashoffset 0.6s var(--ease-out, cubic-bezier(0.22,1,0.36,1))"/>` : ''}
    ${dots}
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

function renderMacroProgressBars(t) {
  const items = [
    { label: 'חלבון',    val: Math.round(t.protein_g || 0), target: 50,  color: '#5eead4' },
    { label: 'פחמימות', val: Math.round(t.carbs_g || 0),   target: 250, color: '#93c5fd' },
    { label: 'שומן',    val: Math.round(t.fat_g || 0),     target: 65,  color: '#fca5a5' },
    { label: 'סיבים',   val: Math.round(t.fiber_g || 0),   target: 25,  color: '#c4b5fd' },
  ];
  return html`${items.map(item => html`
    <div class="prog-row">
      <div class="prog-label"><span>${item.label}</span><span style="font-family:'IBM Plex Mono',monospace">${item.val} גרם</span></div>
      <div class="prog-track"><div class="prog-fill" style="width:${Math.min(item.val / item.target * 100, 100)}%;background:${item.color}"></div></div>
    </div>
  `)}`;
}
