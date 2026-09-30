import { state } from '../state.js';
import { apiFetch } from '../api.js';
import { formatDate, formatDateShort, todayStr } from '../dates.js';
import { escapeHtml, showToast } from '../dom.js';
import { updateSettingsProfileSub } from '../profile.js';
import { loadDiary } from './home.js';

// ════════════════════════════════════════════════════
// Weight screen
// ════════════════════════════════════════════════════
export async function loadWeightScreen() {
  // Set date input default to today, block future
  const dateEl = document.getElementById('weight-date');
  dateEl.value = todayStr();
  dateEl.max = todayStr();
  try {
    state.weightLogs = await apiFetch('/api/weight');
    renderWeightChart();
    renderWeightList();
  } catch (e) { showToast('שגיאה בטעינת נתוני משקל'); }
}

export async function addWeightLog() {
  const val = document.getElementById('weight-val').value;
  const date = document.getElementById('weight-date').value;
  document.getElementById('weight-add-error').textContent = '';
  if (!val || isNaN(+val) || +val <= 0) {
    document.getElementById('weight-add-error').textContent = 'הכנס משקל תקין';
    return;
  }
  if (date && date > todayStr()) {
    document.getElementById('weight-add-error').textContent = 'לא ניתן לרשום משקל לתאריך עתידי';
    return;
  }
  try {
    await apiFetch('/api/weight', { method: 'POST', body: JSON.stringify({ weight_kg: +val, logged_at: date || null }) });
    document.getElementById('weight-val').value = '';
    state.weightLogs = await apiFetch('/api/weight');
    renderWeightChart();
    renderWeightList();
    // weightLogs refreshed — update all calorie displays
    updateSettingsProfileSub();
    loadDiary(); // refresh home screen calorie bar regardless of current screen
    showToast('המשקל נשמר');
  } catch (e) { document.getElementById('weight-add-error').textContent = e.message; }
}

export async function deleteWeightLog(id) {
  try {
    await apiFetch(`/api/weight/${id}`, { method: 'DELETE' });
    state.weightLogs = state.weightLogs.filter(w => w.id !== id);
    renderWeightChart();
    renderWeightList();
    showToast('המדידה נמחקה');
  } catch (e) { showToast('שגיאה במחיקה'); }
}

function renderWeightChart() {
  const el = document.getElementById('weight-chart');
  if (!state.weightLogs.length) {
    el.innerHTML = `<div class="empty-state" style="padding:20px"><p>אין נתונים עדיין</p></div>`;
    return;
  }

  const W = 300, H = 130, LEFT = 38, RIGHT = 24, TOP = 12, BOTTOM = 24;
  const chartW = W - LEFT - RIGHT;
  const chartH = H - BOTTOM - TOP;
  const n = state.weightLogs.length;
  const weights = state.weightLogs.map(w => +w.weight_kg);
  const minW = Math.min(...weights);
  const maxW = Math.max(...weights);
  const range = maxW - minW || 1;

  const pts = state.weightLogs.map((w, i) => {
    const x = LEFT + (n === 1 ? chartW / 2 : (i / (n - 1)) * chartW);
    const y = TOP + chartH - ((+w.weight_kg - minW) / range) * chartH;
    return { x, y, w };
  });

  const polyline = pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const areaPath = `M ${pts[0].x.toFixed(1)},${(TOP + chartH).toFixed(1)} ` +
    pts.map(p => `L ${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ') +
    ` L ${pts[pts.length-1].x.toFixed(1)},${(TOP + chartH).toFixed(1)} Z`;

  const showDots = n <= 20;
  const dots = showDots ? pts.map(p =>
    `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3" fill="#5eead4" stroke="#0d0b09" stroke-width="1.5"/>`
  ).join('') : '';

  // Y labels on left side (min/max)
  const yLabels = `
    <text x="${LEFT - 4}" y="${(TOP + chartH).toFixed(1)}" text-anchor="end" font-size="8" fill="#7a6e62" font-family="IBM Plex Mono,monospace">${minW.toFixed(1)}</text>
    <text x="${LEFT - 4}" y="${(TOP + 8).toFixed(1)}" text-anchor="end" font-size="8" fill="#7a6e62" font-family="IBM Plex Mono,monospace">${maxW.toFixed(1)}</text>
  `;

  // X labels: first and last date (only show last if different from first)
  const firstDate = escapeHtml(formatDateShort(state.weightLogs[0].logged_at));
  const lastDate = escapeHtml(formatDateShort(state.weightLogs[n-1].logged_at));
  const xLabels = n > 1 ? `
    <text x="${LEFT}" y="${H - 4}" text-anchor="start" font-size="8" fill="#7a6e62" font-family="IBM Plex Mono,monospace">${firstDate}</text>
    ${firstDate !== lastDate ? `<text x="${W - RIGHT}" y="${H - 4}" text-anchor="end" font-size="8" fill="#7a6e62" font-family="IBM Plex Mono,monospace">${lastDate}</text>` : ''}
  ` : '';

  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" overflow="visible" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="wgrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#5eead4" stop-opacity="0.25"/>
        <stop offset="100%" stop-color="#5eead4" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <path d="${areaPath}" fill="url(#wgrad)"/>
    <polyline points="${polyline}" fill="none" stroke="#5eead4" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    ${dots}
    ${yLabels}
    ${xLabels}
  </svg>`;
}

function renderWeightList() {
  const el = document.getElementById('weight-list');
  if (!state.weightLogs.length) {
    el.innerHTML = `<div class="empty-state"><div class="empty-icon">⚖️</div><p>אין מדידות עדיין</p></div>`;
    return;
  }
  // Update profile weight from latest log (last item = newest, server orders ASC)
  const latestWeight = +state.weightLogs[state.weightLogs.length - 1].weight_kg;
  if (state.userProfile && latestWeight) {
    state.userProfile.weight = latestWeight;
    localStorage.setItem('fl_profile', JSON.stringify(state.userProfile));
    apiFetch('/api/profile', { method: 'PUT', body: JSON.stringify(state.userProfile) }).catch(() => {});
  }
  // Display newest first
  el.innerHTML = [...state.weightLogs].reverse().map(w => `
    <div class="weight-entry">
      <button class="delete-btn" onclick="deleteWeightLog(${w.id})" aria-label="מחק">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
      </button>
      <div class="weight-entry-info">
        <div class="weight-val-big">${(+w.weight_kg).toFixed(1)} ק"ג</div>
        <div class="weight-entry-date">${escapeHtml(formatDate(w.logged_at))}</div>
      </div>
    </div>
  `).join('');
}
