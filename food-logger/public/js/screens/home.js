import { state } from '../state.js';
import { apiFetch } from '../api.js';
import { formatDate, formatDateTitle, todayStr, addDays, weekOf } from '../dates.js';
import { closeModal, html, openModal, setHtml, showToast } from '../dom.js';
import { formatNumber } from '../format.js';
import { plateSvg } from '../placeholder.js';
import { photoSrc } from '../photos.js';
import { calcRecommendedCal } from '../profile.js';
import { analysisMessageFor, messageFor } from '../errors.js';

const byId = (id) => document.getElementById(id);
const WEEKDAY_LETTERS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];   // Sunday first, like weekOf()

// ════════════════════════════════════════════════════
// Diary
// ════════════════════════════════════════════════════
function showDay(day) {
  if (day > todayStr()) return; // no future
  state.diaryDate = day;
  const content = document.querySelector('#screen-home .content');
  if (content) content.scrollTop = 0;
  loadDiary();
}

export function changeDay(n) {
  showDay(addDays(state.diaryDate, n));
}

// A tap on a day of the week strip (a future day is a disabled button, and showDay refuses it as well).
export function pickDay(day) {
  if (day === state.diaryDate) return;
  showDay(day);
}

export async function loadDiary() {
  try {
    const day = state.diaryDate ?? todayStr();
    renderWeek(day);
    const label = byId('diary-date-label');
    if (label) label.textContent = formatDate(day);
    const entries = await apiFetch(`/api/food?date=${day}`);
    if (day !== state.diaryDate) return;   // the user moved to another day while this one loaded: its answer is stale
    renderMealList(entries);
    renderDailySummary(entries);
  } catch (e) { showToast('שגיאה בטעינת היומן'); }
}

// The seven days of the displayed week: the shown day is circled in red pen, a future day is dimmed and disabled.
function renderWeek(shownDay) {
  const today = todayStr();
  const week = byId('diary-week');
  setHtml(week, html`${weekOf(shownDay).map((day, i) => {
    const shown = day === shownDay;
    return html`<button class="day${shown ? ' sel' : ''}${day > today ? ' future' : ''}" data-action="pickDay" data-arg="${day}" aria-label="${formatDateTitle(day)}" aria-current="${shown ? 'date' : 'false'}">${WEEKDAY_LETTERS[i]}</button>`;
  })}`);
  week.querySelectorAll('.future').forEach((b) => { b.disabled = true; });
  // the arrows keep an accessible name: the date they lead to (previous day on the right, next on the left)
  const [previous, next] = document.querySelectorAll('#screen-home .date-nav button');
  previous.setAttribute('aria-label', formatDateTitle(addDays(shownDay, -1)));
  next.setAttribute('aria-label', formatDateTitle(addDays(shownDay, 1)));
  next.disabled = shownDay >= today;
}

function renderMealList(entries) {
  const el = byId('meal-list');
  if (!entries.length) {
    setHtml(el, html`<div class="empty-state"><div class="empty-icon">${plateSvg()}</div><p>אין ארוחות מתועדות<br>לחץ על ➕ כדי להוסיף ארוחה</p></div>`);
    return;
  }
  _mealEntries.clear();
  entries.forEach(e => _mealEntries.set(e.id, e));

  // One taped polaroid per meal, alternating sides (CSS: odd rows have the photo on the right). The photo is the stored
  // thumbnail when the meal has one, else the drawn plate; the time is under the photo; the name, the circled calories
  // and the two text buttons are beside it.
  setHtml(el, html`${entries.map(e => html`<div class="meal-item-row" id="entry-${e.id}">
  <div class="polaroid"><i class="tape"></i><div class="ph">${e.has_photo ? html`<img class="ph-img" data-photo src="${photoSrc(e.id)}" alt="">` : plateSvg()}</div><div class="cp">${e.logged_at ? String(e.logged_at).slice(11, 16) : ''}</div></div>
  <div class="mir-body">
    <div class="mir-name">${e.food_name || ''}</div>
    <span class="circ">${formatNumber(+e.calories)}</span>
    <div class="acts"><button data-action="openEditModal" data-id="${e.id}">ערוך</button><button class="del" data-action="deleteEntry" data-id="${e.id}">מחק</button></div>
  </div>
</div>`)}`);
}

function renderDailySummary(entries) {
  const totals = entries.reduce((a, e) => ({
    cal: a.cal + (+e.calories || 0),
    pro: a.pro + (+e.protein_g || 0),
    carb: a.carb + (+e.carbs_g || 0),
    fat: a.fat + (+e.fat_g || 0),
    fiber: a.fiber + (+e.fiber_g || 0),
  }), { cal: 0, pro: 0, carb: 0, fat: 0, fiber: 0 });

  byId('sum-cal').textContent = formatNumber(totals.cal);
  byId('sum-pro').textContent = Math.round(totals.pro);
  byId('sum-carb').textContent = Math.round(totals.carb);
  byId('sum-fat').textContent = Math.round(totals.fat);
  byId('sum-fiber').textContent = Math.round(totals.fiber);

  // "of the goal" and the red bar (the share of the goal eaten, never wider than its track); no goal, no bar
  const rec = calcRecommendedCal();
  const bar = byId('diary-bar');
  const fill = byId('diary-cal-fill');
  const sep = byId('diary-goal-sep');
  if (rec > 0) {
    byId('diary-goal-label').textContent = formatNumber(rec);
    sep.hidden = false;
    const pct = Math.max(0, Math.min(100, Math.round((totals.cal / rec) * 100)));
    bar.hidden = false;
    bar.setAttribute('aria-valuenow', String(pct));
    fill.style.width = pct + '%';
  } else {
    sep.hidden = true;
    bar.hidden = true;
    fill.style.width = '0%';
  }
}

export async function deleteEntry(id) {
  try {
    await apiFetch(`/api/food/${id}`, { method: 'DELETE' });
    const row = document.getElementById(`entry-${id}`);
    const nextId = row?.nextElementSibling?.id;
    row?.remove();
    await loadDiary();
    // keyboard focus must not fall to <body>: the next meal's "ערוך", or the list itself when none is left
    (nextId && document.querySelector(`#${nextId} [data-action="openEditModal"]`) || byId('meal-list'))?.focus();
    showToast('המנה נמחקה');
  } catch (e) { showToast('שגיאה במחיקה'); }
}

// ════════════════════════════════════════════════════
// Meal Edit Modal
// ════════════════════════════════════════════════════
const _mealEntries = new Map(); // id → entry; used by openEditModal (data-id lookup)

let _editEntryId     = null;
let _editOriginalName = '';
let _editOriginalDate = '';
let _editNotes        = null;
let _editAnalyzing    = false;
let _editGen          = 0;   // bumped by resetEditModal: a reply that was in flight at a sign-out is dropped

// Sign-out: the slip is closed (by closeAllModals) and emptied, so the next person finds nothing of this meal.
export function resetEditModal() {
  _editGen += 1;
  _editEntryId = null;
  _editOriginalName = '';
  _editOriginalDate = '';
  _editNotes = null;
  _editAnalyzing = false;
  _mealEntries.clear();
  for (const id of ['edit-name', 'edit-cal', 'edit-pro', 'edit-carb', 'edit-fat', 'edit-fiber', 'edit-time']) {
    document.getElementById(id).value = '';
  }
  document.querySelectorAll('#edit-modal .meal-opt').forEach(b => b.classList.remove('selected'));
  document.getElementById('edit-btn-row').replaceChildren();
  const closeBtn = document.getElementById('edit-modal-close');
  closeBtn.disabled = false;
  closeBtn.style.opacity = '';
}

export function openEditModal(id) {
  const entry = _mealEntries.get(id);
  if (!entry) return;

  _editEntryId      = entry.id;
  _editOriginalName = entry.food_name || '';
  _editOriginalDate = (entry.logged_at || '').slice(0, 10);
  _editNotes        = entry.notes ?? null;
  _editAnalyzing    = false;

  document.getElementById('edit-name').value  = _editOriginalName;
  document.getElementById('edit-cal').value   = entry.calories  ?? '';
  document.getElementById('edit-pro').value   = entry.protein_g ?? '';
  document.getElementById('edit-carb').value  = entry.carbs_g   ?? '';
  document.getElementById('edit-fat').value   = entry.fat_g     ?? '';
  document.getElementById('edit-fiber').value = entry.fiber_g   ?? '';
  document.getElementById('edit-time').value  = (entry.logged_at || '').slice(11, 16);

  document.querySelectorAll('#edit-modal .meal-opt').forEach(b => {
    b.classList.toggle('selected', b.dataset.meal === entry.meal_type);
  });

  const closeBtn = document.getElementById('edit-modal-close');
  closeBtn.disabled = false;
  closeBtn.style.opacity = '';

  // Wire name input → button toggler (idempotent: replaces any previous listener via named ref)
  const nameInput = document.getElementById('edit-name');
  nameInput.removeEventListener('input', updateEditButtons);
  nameInput.addEventListener('input', updateEditButtons);

  updateEditButtons();
  openModal('edit-modal');
}

export function closeEditModal() {
  if (_editAnalyzing) return;
  closeModal('edit-modal');
}

export function selectEditMeal(btn) {
  // Scope to edit modal only — does NOT affect the analysis screen's .meal-opt buttons
  document.querySelectorAll('#edit-modal .meal-opt').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
}

function updateEditButtons() {
  const nameChanged = document.getElementById('edit-name').value !== _editOriginalName;
  const row = document.getElementById('edit-btn-row');
  if (nameChanged) {
    setHtml(row, html`
      <button class="penbtn" data-action="editRecalculate">חשב מחדש</button>
      <button class="penbtn alt" data-action="editSave">שמור מבלי לחשב מחדש</button>`);
  } else {
    setHtml(row, html`<button class="penbtn" data-action="editSave">שמור</button>`);
  }
}

export async function editRecalculate() {
  if (_editAnalyzing) return;
  _editAnalyzing = true;

  const closeBtn = document.getElementById('edit-modal-close');
  closeBtn.disabled = true;
  closeBtn.style.opacity = '0.4';
  setHtml(document.getElementById('edit-btn-row'),
    html`<button class="penbtn" disabled>מחשב... 🔄</button>`);

  const foodName = document.getElementById('edit-name').value.trim();
  const gen = _editGen;
  try {
    const data = await apiFetch('/api/analyze-text', {
      method: 'POST',
      body: JSON.stringify({ text: foodName }),
    });
    if (gen !== _editGen) return;   // signed out meanwhile: the reply belongs to the previous person
    document.getElementById('edit-name').value  = data.foodName || foodName;
    document.getElementById('edit-cal').value   = (+data.calories  || 0).toFixed(1);
    document.getElementById('edit-pro').value   = (+data.protein_g || 0).toFixed(1);
    document.getElementById('edit-carb').value  = (+data.carbs_g   || 0).toFixed(1);
    document.getElementById('edit-fat').value   = (+data.fat_g     || 0).toFixed(1);
    document.getElementById('edit-fiber').value = (+data.fiber_g   || 0).toFixed(1);
    setHtml(document.getElementById('edit-btn-row'),
      html`<button class="penbtn" data-action="editSave">שמור</button>`);
  } catch (e) {
    showToast(analysisMessageFor(e));
    if (gen === _editGen) updateEditButtons();
  } finally {
    if (gen === _editGen) {
      _editAnalyzing = false;
      closeBtn.disabled = false;
      closeBtn.style.opacity = '';
    }
  }
}

export async function editSave() {
  const mealTypeBtn = document.querySelector('#edit-modal .meal-opt.selected');
  const timeVal     = document.getElementById('edit-time').value;
  const nameVal     = document.getElementById('edit-name').value.trim();
  // Send blank name — server will reject with 400 and caller sees the toast
  const body = {
    food_name:  nameVal,
    calories:   +document.getElementById('edit-cal').value   || 0,
    protein_g:  +document.getElementById('edit-pro').value   || 0,
    carbs_g:    +document.getElementById('edit-carb').value  || 0,
    fat_g:      +document.getElementById('edit-fat').value   || 0,
    fiber_g:    +document.getElementById('edit-fiber').value || 0,
    meal_type:  mealTypeBtn?.dataset.meal || 'snack',
    logged_at:  (timeVal && _editOriginalDate)
                  ? _editOriginalDate + 'T' + timeVal + ':00'
                  : null,
    notes:      _editNotes,
  };
  const gen = _editGen;
  try {
    await apiFetch(`/api/food/${_editEntryId}`, { method: 'PUT', body: JSON.stringify(body) });
    if (gen !== _editGen) return;   // signed out meanwhile: nothing of this meal is shown to the next person
    closeModal('edit-modal');
    loadDiary();
    showToast('✅ המנה עודכנה');
  } catch (e) {
    showToast(messageFor(e));
  }
}

// Actions for the diary screen and the edit-meal modal.
export const actions = {
  changeDay: (el) => changeDay(+el.dataset.arg),
  pickDay: (el) => pickDay(el.dataset.arg),
  openEditModal: (el) => openEditModal(+el.dataset.id),
  deleteEntry: (el) => deleteEntry(+el.dataset.id),
  closeEditModal: () => closeEditModal(),
  closeEditBackdrop: (el, event) => { if (event.target === el) closeEditModal(); },
  selectEditMeal: (el) => selectEditMeal(el),
  editRecalculate: () => editRecalculate(),
  editSave: () => editSave(),
};
