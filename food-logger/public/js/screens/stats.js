import { state } from '../state.js';
import { apiFetch } from '../api.js';
import { renderLineChart, renderStatAvgBox, renderStatMacros } from '../charts.js';
import { addMonths, formatDateShort, formatMonth, todayStr } from '../dates.js';
import { html, setHtml } from '../dom.js';
import { cloneCapybara, setPetState } from '../pet.js';
import { calcRecommendedCal } from '../profile.js';

// ════════════════════════════════════════════════════
// Walking capybara (stats screen)
// ════════════════════════════════════════════════════
let _capyWalkRaf = null;
let _capyWalkX = 0;
let _capyWalkDir = 1;

function startStatsCapyWalk() {
  if (_capyWalkRaf) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const wrap = document.getElementById('pet-stats-wrap');
  const stage = wrap?.querySelector('.capy-walk-stage');
  const pet = wrap?.querySelector('.pet-wrap');
  if (!stage || !pet) return;

  let lastT = null;
  function tick(t) {
    if (!lastT) lastT = t;
    const dt = Math.min(t - lastT, 50);
    lastT = t;
    const maxX = wrap.offsetWidth - 64;
    _capyWalkX += _capyWalkDir * 0.85 * (dt / 16);
    if (_capyWalkX >= maxX) {
      _capyWalkX = maxX;
      _capyWalkDir = -1;
      pet.classList.add('pet-hopping');
      setTimeout(() => {
        pet.style.transform = 'scaleX(-1)';
        pet.classList.remove('pet-hopping');
      }, 75);
    } else if (_capyWalkX <= 0) {
      _capyWalkX = 0;
      _capyWalkDir = 1;
      pet.classList.add('pet-hopping');
      setTimeout(() => {
        pet.style.transform = 'scaleX(1)';
        pet.classList.remove('pet-hopping');
      }, 75);
    }
    stage.style.transform = `translateX(${_capyWalkX}px)`;
    _capyWalkRaf = requestAnimationFrame(tick);
  }
  _capyWalkRaf = requestAnimationFrame(tick);
}

export function stopStatsCapyWalk() {
  if (_capyWalkRaf) { cancelAnimationFrame(_capyWalkRaf); _capyWalkRaf = null; }
}

// ════════════════════════════════════════════════════
// Stats
// ════════════════════════════════════════════════════
export function switchStats(tab) {
  state.currentStatsTab = tab;
  const tabs = document.querySelectorAll('.stats-tab');
  tabs.forEach(t => t.classList.remove('active'));
  const idx = ['weekly','monthly','yearly'].indexOf(tab);
  if (tabs[idx]) tabs[idx].classList.add('active');
  ['weekly','monthly','yearly'].forEach(t => {
    document.getElementById(`stats-${t}`).style.display = t === tab ? '' : 'none';
  });
  loadStats();
}

export function statsChangeMonth(n) {
  const next = addMonths(state.statsMonth, n);
  if (next > todayStr().slice(0, 7)) return; // no future month
  state.statsMonth = next;
  loadStats();
}
export function statsChangeYear(n) {
  const next = +state.statsYear + n;
  if (next > new Date().getFullYear()) return; // no future year
  state.statsYear = String(next);
  loadStats();
}

export async function loadStats() {
  if (state.currentStatsTab === 'weekly') await loadWeeklyStats();
  if (state.currentStatsTab === 'monthly') await loadMonthlyStats();
  if (state.currentStatsTab === 'yearly') await loadYearlyStats();
}

async function loadWeeklyStats() {
  try {
    const rows = await apiFetch('/api/stats/weekly');
    const rec = calcRecommendedCal();
    renderStatAvgBox('weekly-avg-box', rows, rec, "ממוצע קל' יומי");
    const chartEl = document.getElementById('weekly-chart');
    // Build last 7 days including today, filling zeros for missing days
    const todayDate = new Date();
    const todayDs = todayStr();
    const chartDays = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(todayDate); d.setDate(todayDate.getDate() - i);
      const ds = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      const found = rows.find(r => r.day.slice(0,10) === ds);
      chartDays.push(found || { day: ds, calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 });
    }
    const hebrewDays = ['א','ב','ג','ד','ה','ו','ש'];
    setHtml(chartEl, renderLineChart(chartDays, {
      getValue: r => +r.calories || 0,
      getLabel: r => formatDateShort(r.day.slice(0, 10)),
      isToday: r => r.day.slice(0, 10) === todayDs,
      recommended: rec,
      dayLetters: chartDays.map(r => {
        const parts = r.day.slice(0, 10).split('-');
        const d = new Date(+parts[0], +parts[1] - 1, +parts[2]);
        return hebrewDays[d.getDay()];
      }),
    }));
    // Trigger draw-on animation for the polyline
    const polylineEl = chartEl.querySelector('polyline[id^="lc-"]');
    if (polylineEl) {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        polylineEl.style.strokeDashoffset = '0';
      } else {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            polylineEl.style.strokeDashoffset = '0';
          });
        });
      }
    }
    renderStatMacros('weekly-macro', rows, `ממוצע יומי ב-${rows.length} ימים`);
    const wrapEl = document.getElementById('pet-stats-wrap');
    if (wrapEl) {
      if (!wrapEl.querySelector('.capy-walk-stage')) {
        const stage = document.createElement('div');
        stage.className = 'capy-walk-stage';
        stage.appendChild(cloneCapybara(56));
        wrapEl.replaceChildren(stage);
      }
      const avgCal = rows.length
        ? rows.reduce((s, r) => s + (+r.calories || 0), 0) / rows.length
        : 0;
      const pct = rec > 0 ? avgCal / rec : 0;
      const weeklyState = 'happy';
      const petWrap = wrapEl.querySelector('.pet-wrap');
      if (petWrap) setPetState(petWrap, weeklyState);
      stopStatsCapyWalk();
      startStatsCapyWalk();
    }
  } catch { }
}

async function loadMonthlyStats() {
  document.getElementById('stats-month-label').textContent = formatMonth(state.statsMonth);
  try {
    const rows = await apiFetch(`/api/stats/monthly?month=${state.statsMonth}`);
    const rec = calcRecommendedCal();
    renderStatAvgBox('monthly-avg-box', rows, rec, "ממוצע קל' יומי");
    const chartEl = document.getElementById('monthly-chart');
    if (!rows.length) { setHtml(chartEl, html`<div class="empty-state"><p>אין נתונים</p></div>`); return; }
    const todayS = todayStr();
    setHtml(chartEl, renderLineChart(rows, {
      getValue: r => +r.calories || 0,
      getLabel: r => String(+r.day.slice(8, 10)),
      isToday: r => r.day.slice(0, 10) === todayS,
      recommended: rec,
    }));
    const polylineEl = chartEl.querySelector('polyline[id^="lc-"]');
    if (polylineEl) {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        polylineEl.style.strokeDashoffset = '0';
      } else {
        requestAnimationFrame(() => requestAnimationFrame(() => {
          polylineEl.style.strokeDashoffset = '0';
        }));
      }
    }
    renderStatMacros('monthly-macro', rows, `ממוצע יומי ב-${rows.length} ימים`);
  } catch { }
}

async function loadYearlyStats() {
  document.getElementById('stats-year-label').textContent = state.statsYear;
  try {
    const rows = await apiFetch(`/api/stats/yearly?year=${state.statsYear}`);
    const rec = calcRecommendedCal();
    const monthNames = ['ינו','פבר','מרץ','אפר','מאי','יונ','יול','אוג','ספט','אוק','נוב','דצמ'];
    const totalCal = rows.reduce((s, r) => s + (+r.calories || 0), 0);
    const totalDays = rows.reduce((s, r) => s + (parseInt(r.day_count, 10) || 0), 0);
    const yearlyDailyAvg = totalDays > 0 ? Math.round(totalCal / totalDays) : (rows.length > 0 ? Math.round(totalCal / (rows.length * 30)) : 0);
    const yearlyAvgEl = document.getElementById('yearly-avg-box');
    if (yearlyAvgEl && rows.length) {
      let diffHtml = '';
      if (rec > 0) {
        const diff = yearlyDailyAvg - rec;
        const cls = diff <= 0 ? 'under' : 'over';
        diffHtml = html`<div class="avg-diff ${cls}">${diff > 0 ? '+' : ''}${diff} קל'</div><div style="font-size:11px;color:var(--muted)">מהמומלץ</div>`;
      }
      setHtml(yearlyAvgEl, html`<div class="avg-box"><div class="avg-box-left"><div class="avg-val">${yearlyDailyAvg}</div><div class="avg-label">ממוצע קל' יומי</div></div><div class="avg-box-right">${diffHtml}</div></div>`);
    }
    const chartEl = document.getElementById('yearly-chart');
    if (!rows.length) { setHtml(chartEl, html`<div class="empty-state"><p>אין נתונים</p></div>`); return; }
    const currentMonth = todayStr().slice(0, 7);
    setHtml(chartEl, renderLineChart(rows, {
      getValue: r => r.day_count > 0 ? Math.round((+r.calories || 0) / r.day_count) : 0,
      getLabel: r => monthNames[+(r.month.slice(5, 7)) - 1],
      isToday: r => r.month === currentMonth,
      recommended: rec,
    }));
    renderStatMacros('yearly-macro', rows, `ממוצע יומי על בסיס ${totalDays} ימים`, totalDays);
  } catch { }
}

export const actions = {
  switchStats: (el) => switchStats(el.dataset.arg),
  statsChangeMonth: (el) => statsChangeMonth(+el.dataset.arg),
  statsChangeYear: (el) => statsChangeYear(+el.dataset.arg),
};
