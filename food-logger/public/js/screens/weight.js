import { state } from '../state.js';
import { apiFetch } from '../api.js';
import { renderWeightChart } from '../charts.js';
import { formatDayMonth, todayStr } from '../dates.js';
import { html, setHtml, showToast } from '../dom.js';
import { formatKg } from '../format.js';
import { cloneCapybara, setPetState } from '../pet.js';
import { goalWeightOf, sortWeightLogs, updateSettingsProfileSub } from '../profile.js';
import { getUsername } from '../session.js';
import { loadDiary } from './home.js';
import { messageFor } from '../errors.js';

// ════════════════════════════════════════════════════
// The coach: a small happy capybara at the top left of the page with a speech bubble that cheers the user on. She is a
// static drawing (no walker, nothing to stop). The message rotates with the number of entries (so adding one changes it);
// the wording says nothing about the numbers and judges neither a rise nor a fall.
// ════════════════════════════════════════════════════
const COACH_START = 'בוא נתחיל לעקוב, אני איתך';
const COACH_MESSAGES = [
  'כל הכבוד על ההתמדה!',
  'שקילה אחר שקילה, זה מצטבר',
  'עבודה מצוינת, ממשיכים!',
  'צעד קטן כל יום עושה הבדל גדול',
  'מעקב עקבי הוא חצי מהדרך',
  'יופי של התמדה, אני גאה בך',
  'כל שקילה היא צעד קדימה',
  'ממשיכים בקצב שלך, זה עובד',
];
export const coachMessage = (entries) => (entries > 0 ? COACH_MESSAGES[entries % COACH_MESSAGES.length] : COACH_START);

function renderCoach() {
  const slot = document.getElementById('weight-pet');
  if (slot && !slot.querySelector('.pet-wrap')) {
    const pet = cloneCapybara(68);
    slot.appendChild(pet);
    setPetState(pet, 'happy');
  }
  const text = document.getElementById('weight-coach-text');
  if (text) text.textContent = coachMessage(state.weightLogs.length);
}

// Bumped by every leave: a load that was started before it is stale and its reply is dropped (a slow reply must never land on
// the next person's screen, nor write their profile).
let loadSeq = 0;
export function enterWeight() {
  loadWeightScreen();
}
export function leaveWeight() {
  loadSeq += 1;
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
  const seq = ++loadSeq;
  try {
    const rows = sortWeightLogs(await apiFetch('/api/weight'));
    if (seq !== loadSeq) return;
    state.weightLogs = rows;
    renderWeightScreen();
    syncProfileWeight();
  } catch (e) { if (seq === loadSeq) showToast('שגיאה בטעינת נתוני משקל'); }
}

// One add at a time: the button is disabled while the request runs and a second tap sends nothing (it would add the weight twice).
// A sign-out bumps the generation, so a request that was running for the previous person cannot touch the next one's button.
let _addBusy = false;
let _addGen = 0;
const addButton = () => document.querySelector('#screen-weight .wt-add .penbtn');
export function resetWeightAdd() {
  _addGen += 1;
  _addBusy = false;
  const btn = addButton();
  if (btn) btn.disabled = false;
  document.getElementById('weight-add-error').textContent = '';
  document.getElementById('weight-val').value = '';
}

export async function addWeightLog() {
  if (_addBusy) return;
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
  const who = getUsername();
  const gen = _addGen;
  _addBusy = true;
  const btn = addButton();
  if (btn) btn.disabled = true;
  try {
    await apiFetch('/api/weight', { method: 'POST', body: JSON.stringify({ weight_kg: +val, logged_at: date || todayStr() }) });
    document.getElementById('weight-val').value = '';
    const rows = sortWeightLogs(await apiFetch('/api/weight'));
    if (getUsername() !== who) return;   // signed out meanwhile: the reply belongs to the previous person
    state.weightLogs = rows;
    renderWeightScreen();
    syncProfileWeight();
    // weightLogs refreshed — update all calorie displays
    updateSettingsProfileSub();
    loadDiary(); // refresh home screen calorie bar regardless of current screen
    showToast('המשקל נשמר');
  } catch (e) { if (gen === _addGen) document.getElementById('weight-add-error').textContent = messageFor(e); }
  finally { if (gen === _addGen) { _addBusy = false; if (btn) btn.disabled = false; } }
}

// Ids whose DELETE is in flight: a second tap on the same cross sends nothing (it would only come back as a 404).
const deleting = new Set();
export async function deleteWeightLog(id) {
  if (deleting.has(id)) return;
  deleting.add(id);
  const who = getUsername();
  try {
    await apiFetch(`/api/weight/${id}`, { method: 'DELETE' });
    if (getUsername() !== who) return;
    state.weightLogs = state.weightLogs.filter(w => w.id !== id);
    renderWeightScreen();
    syncProfileWeight();
    showToast('המדידה נמחקה');
  } catch (e) { showToast('שגיאה במחיקה'); }
  finally { deleting.delete(id); }
}

function renderWeightScreen() {
  renderWeightHead();
  drawWeightChart();
  renderWeightList();
  renderCoach();
}


// The target weight of the profile (`goalWeight`, a number, a numeric string from an older client, or absent), a positive number or 0 (none: no goal line, no goal text).
function weightGoal() {
  return goalWeightOf(state.userProfile);
}

// The newest weight, big, with the unit and the goal beside it; no entries, no head.
function renderWeightHead() {
  const el = document.getElementById('weight-head');
  const logs = state.weightLogs;
  if (!logs.length) { el.hidden = true; el.replaceChildren(); return; }
  const goal = weightGoal();
  const kg = +logs[logs.length - 1].weight_kg;
  setHtml(el, html`<span class="wt-big">${kg.toFixed(1)}</span><span class="wt-unit">${goal > 0 ? `ק״ג · יעד ${formatKg(goal)}` : 'ק״ג'}</span>`);
  el.hidden = false;
}

function drawWeightChart() {
  setHtml(document.getElementById('weight-chart'), renderWeightChart(state.weightLogs.map(w => +w.weight_kg), { goal: weightGoal() }));
}

// The profile keeps the newest weight (the calorie goal reads it). Called where the data changes (after a load, an add, a delete),
// never from a render; nothing is stored or sent when the profile already holds that weight.
function syncProfileWeight() {
  if (!state.weightLogs.length || !state.userProfile) return;
  const latest = +state.weightLogs[state.weightLogs.length - 1].weight_kg;
  if (!(latest > 0) || +state.userProfile.weight === latest) return;
  state.userProfile.weight = latest;
  try { localStorage.setItem('fl_profile', JSON.stringify(state.userProfile)); } catch { /* storage unavailable */ }
  apiFetch('/api/profile', { method: 'PUT', body: JSON.stringify(state.userProfile) }).catch(() => {});
}

function renderWeightList() {
  const el = document.getElementById('weight-list');
  if (!state.weightLogs.length) {
    setHtml(el, html`<div class="empty-state"><p>אין מדידות עדיין</p></div>`);
    return;
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
