import { state } from '../state.js';
import { apiFetch } from '../api.js';
import { renderBarChart, renderStatAvgBox, renderStatMacros } from '../charts.js';
import { addDays, addMonths, formatDayCount, formatMonth, monthDays, todayStr, weekdayLetter, yearMonths } from '../dates.js';
import { setHtml } from '../dom.js';
import { mountWalkingCapybara } from '../pet.js';
import { calcRecommendedCal } from '../profile.js';

const AVG_UNIT = 'קק״ל ליום, בממוצע';
const MONTH_NAMES = ['ינו׳','פבר׳','מרץ','אפר׳','מאי','יוני','יולי','אוג׳','ספט׳','אוק׳','נוב׳','דצמ׳'];

// ════════════════════════════════════════════════════
// The walking capybara (above the index tabs): mounted when the screen is entered, stopped when it is left
// (router hooks registered in main.js). Mounting the same page twice returns the same walker.
// ════════════════════════════════════════════════════
let _walker = null;
export function enterStats() {
  const page = document.querySelector('#screen-stats .page');
  if (page) _walker = mountWalkingCapybara(page, { state: 'happy', size: 84, bottom: 46 });
  loadStats();
}
export function leaveStats() {
  if (_walker) { _walker.stop(); _walker = null; }
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
  if (next > +todayStr().slice(0, 4)) return; // no future year
  state.statsYear = String(next);
  loadStats();
}

// The line under the macro averages; empty (the line is hidden) when there are no days.
const averageFootnote = (days) => (days > 0 ? `ממוצע יומי על בסיס ${formatDayCount(days)}` : '');

const emptyDay = (day) => ({ day, calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 });
const dayOf = (r) => String(r.day).slice(0, 10);

export async function loadStats() {
  if (state.currentStatsTab === 'weekly') await loadWeeklyStats();
  if (state.currentStatsTab === 'monthly') await loadMonthlyStats();
  if (state.currentStatsTab === 'yearly') await loadYearlyStats();
}

async function loadWeeklyStats() {
  try {
    const todayDs = todayStr();
    const rows = await apiFetch(`/api/stats/weekly?today=${todayDs}`);
    const rec = calcRecommendedCal();
    renderStatAvgBox('weekly-avg-box', rows, rec, AVG_UNIT);
    // the last 7 days including today, a zero day where there is no data
    const byDay = new Map(rows.map(r => [dayOf(r), r]));
    const chartDays = Array.from({ length: 7 }, (_, k) => {
      const ds = addDays(todayDs, k - 6);
      return byDay.get(ds) || emptyDay(ds);
    });
    setHtml(document.getElementById('weekly-chart'), renderBarChart(chartDays, {
      getValue: r => +r.calories || 0,
      getLabel: r => weekdayLetter(dayOf(r)),
      isToday: r => dayOf(r) === todayDs,
      recommended: rec,
    }));
    renderStatMacros('weekly-macro', rows, averageFootnote(rows.length));
  } catch { }
}

async function loadMonthlyStats() {
  document.getElementById('stats-month-label').textContent = formatMonth(state.statsMonth);
  try {
    const rows = await apiFetch(`/api/stats/monthly?month=${state.statsMonth}`);
    const rec = calcRecommendedCal();
    renderStatAvgBox('monthly-avg-box', rows, rec, AVG_UNIT);
    const todayS = todayStr();
    const byDay = new Map(rows.map(r => [dayOf(r), r]));
    const chartDays = monthDays(state.statsMonth).map(ds => byDay.get(ds) || emptyDay(ds));
    setHtml(document.getElementById('monthly-chart'), renderBarChart(chartDays, {
      getValue: r => +r.calories || 0,
      getLabel: r => String(+dayOf(r).slice(8, 10)),
      isToday: r => dayOf(r) === todayS,
      isFuture: r => dayOf(r) > todayS,
      showLabel: r => { const d = +dayOf(r).slice(8, 10); return d === 1 || d % 5 === 0; },
      recommended: rec,
      labelSize: 13,
    }));
    renderStatMacros('monthly-macro', rows, averageFootnote(rows.length));
  } catch { }
}

async function loadYearlyStats() {
  document.getElementById('stats-year-label').textContent = state.statsYear;
  try {
    const rows = await apiFetch(`/api/stats/yearly?year=${state.statsYear}`);
    const rec = calcRecommendedCal();
    const totalCal = rows.reduce((s, r) => s + (+r.calories || 0), 0);
    const totalDays = rows.reduce((s, r) => s + (parseInt(r.day_count, 10) || 0), 0);
    const yearlyDailyAvg = totalDays > 0 ? Math.round(totalCal / totalDays) : (rows.length > 0 ? Math.round(totalCal / (rows.length * 30)) : 0);
    renderStatAvgBox('yearly-avg-box', rows, rec, AVG_UNIT, yearlyDailyAvg);
    const currentMonth = todayStr().slice(0, 7);
    const byMonth = new Map(rows.map(r => [String(r.month).slice(0, 7), r]));
    const chartMonths = yearMonths(state.statsYear).map(m => byMonth.get(m) || { month: m, calories: 0, day_count: 0 });
    setHtml(document.getElementById('yearly-chart'), renderBarChart(chartMonths, {
      getValue: r => (r.day_count > 0 ? Math.round((+r.calories || 0) / r.day_count) : 0),
      getLabel: r => MONTH_NAMES[+String(r.month).slice(5, 7) - 1],
      isToday: r => String(r.month).slice(0, 7) === currentMonth,
      isFuture: r => String(r.month).slice(0, 7) > currentMonth,
      recommended: rec,
      labelSize: 10.5,
    }));
    renderStatMacros('yearly-macro', rows, averageFootnote(totalDays), totalDays);
  } catch { }
}

export const actions = {
  switchStats: (el) => switchStats(el.dataset.arg),
  statsChangeMonth: (el) => statsChangeMonth(+el.dataset.arg),
  statsChangeYear: (el) => statsChangeYear(+el.dataset.arg),
};
