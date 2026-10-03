import { state } from '../state.js';
import { apiFetch } from '../api.js';
import { renderWeightChart } from '../charts.js';
import { formatDayMonth, todayStr } from '../dates.js';
import { html, setHtml, showToast } from '../dom.js';
import { formatNumber } from '../format.js';
import { mountWalkingCapybara } from '../pet.js';
import { sortWeightLogs, updateSettingsProfileSub } from '../profile.js';
import { loadDiary } from './home.js';
import { messageFor } from '../errors.js';

// ════════════════════════════════════════════════════
// The walking capybara (along the bottom of the page): mounted when the screen is entered, stopped when it is left
// (router hooks registered in main.js). Mounting the same page twice returns the same walker.
// ════════════════════════════════════════════════════
let _walker = null;
export function enterWeight() {
  const page = document.querySelector('#screen-weight .page');
  if (page) _walker = mountWalkingCapybara(page, { state: 'neutral', size: 96, bottom: 4 });
  loadWeightScreen();
}
export function leaveWeight() {
  if (_walker) { _walker.stop(); _walker = null; }
}

// ════════════════════════════════════════════════════
// Weight screen
// ════════════════════════════════════════════════════
export async function loadWeightScreen() {
  // Set date input default to today, block future
  const dateEl = document.getElementById('weight-date');
  dateEl.value = todayStr();
  dateEl.max = todayStr();
  // draw what is held first (empty after a sign-out), so a failed load never leaves the previous person's entries on the page
  renderWeightScreen();
  try {
    state.weightLogs = sortWeightLogs(await apiFetch('/api/weight'));
    renderWeightScreen();
  } catch (e) { showToast('שגיאה בטעינת נתוני משקל'); }
}

export async function addWeightLog() {
  const val = document.getElementById('weight-val').value;
  const date = document.getElementById('weight-date').value;
  document.getElementById('weight-add-error').textContent = '';
  if (!val || isNaN(+val) || +val <= 0) {
    document.getElementById('weight-add-error').textContent = 'הזן משקל תקין';
    return;
  }
  if (date && date > todayStr()) {
    document.getElementById('weight-add-error').textContent = 'לא ניתן לרשום משקל לתאריך עתידי';
    return;
  }
  try {
    await apiFetch('/api/weight', { method: 'POST', body: JSON.stringify({ weight_kg: +val, logged_at: date || todayStr() }) });
    document.getElementById('weight-val').value = '';
    state.weightLogs = sortWeightLogs(await apiFetch('/api/weight'));
    renderWeightScreen();
    // weightLogs refreshed — update all calorie displays
    updateSettingsProfileSub();
    loadDiary(); // refresh home screen calorie bar regardless of current screen
    showToast('המשקל נשמר');
  } catch (e) { document.getElementById('weight-add-error').textContent = messageFor(e); }
}

export async function deleteWeightLog(id) {
  try {
    await apiFetch(`/api/weight/${id}`, { method: 'DELETE' });
    state.weightLogs = state.weightLogs.filter(w => w.id !== id);
    renderWeightScreen();
    showToast('המדידה נמחקה');
  } catch (e) { showToast('שגיאה במחיקה'); }
}

function renderWeightScreen() {
  renderWeightHead();
  drawWeightChart();
  renderWeightList();
}

// The weight goal of the profile (none yet: the profile has no such field, so no goal line and no goal text), a positive number or 0.
function weightGoal() {
  const g = +(state.userProfile && state.userProfile.goalWeight);
  return Number.isFinite(g) && g > 0 ? g : 0;
}
const formatGoal = (g) => (Number.isInteger(g) ? formatNumber(g) : g.toFixed(1));

// The newest weight, big, with the unit and the goal beside it; no entries, no head.
function renderWeightHead() {
  const el = document.getElementById('weight-head');
  const logs = state.weightLogs;
  if (!logs.length) { el.hidden = true; el.replaceChildren(); return; }
  const goal = weightGoal();
  const kg = +logs[logs.length - 1].weight_kg;
  setHtml(el, html`<span class="wt-big">${kg.toFixed(1)}</span><span class="wt-unit">${goal > 0 ? `ק״ג · יעד ${formatGoal(goal)}` : 'ק״ג'}</span>`);
  el.hidden = false;
}

function drawWeightChart() {
  setHtml(document.getElementById('weight-chart'), renderWeightChart(state.weightLogs.map(w => +w.weight_kg), { goal: weightGoal() }));
}

function renderWeightList() {
  const el = document.getElementById('weight-list');
  if (!state.weightLogs.length) {
    setHtml(el, html`<div class="empty-state"><p>אין מדידות עדיין</p></div>`);
    return;
  }
  // Update profile weight from latest log (last item = newest, sortWeightLogs orders ASC)
  const latestWeight = +state.weightLogs[state.weightLogs.length - 1].weight_kg;
  if (state.userProfile && latestWeight) {
    state.userProfile.weight = latestWeight;
    localStorage.setItem('fl_profile', JSON.stringify(state.userProfile));
    apiFetch('/api/profile', { method: 'PUT', body: JSON.stringify(state.userProfile) }).catch(() => {});
  }
  // Display newest first
  setHtml(el, html`${[...state.weightLogs].reverse().map(w => html`
    <div class="weight-entry">
      <span class="weight-entry-date">${formatDayMonth(w.logged_at)}</span>
      <span class="weight-val-big">${(+w.weight_kg).toFixed(1)}</span>
      <button class="delete-btn" data-action="deleteWeightLog" data-id="${w.id}" aria-label="מחק">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
      </button>
    </div>
  `)}`);
}

export const actions = {
  addWeightLog: () => addWeightLog(),
  deleteWeightLog: (el) => deleteWeightLog(+el.dataset.id),
};
