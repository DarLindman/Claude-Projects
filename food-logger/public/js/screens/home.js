import { state } from '../state.js';
import { apiFetch } from '../api.js';
import { addDays, formatDate, todayStr } from '../dates.js';
import { closeModal, escapeHtml, openModal, showToast } from '../dom.js';
import { getFoodEmoji } from '../format.js';
import { cloneCapybara, setIdleWrap, setPetState, startIdleAnimations } from '../pet.js';
import { calcRecommendedCal } from '../profile.js';
import { messageFor } from '../errors.js';

// ════════════════════════════════════════════════════
// Diary
// ════════════════════════════════════════════════════
export function changeDay(n) {
  const next = addDays(state.diaryDate, n);
  if (next > todayStr()) return; // no future
  state.diaryDate = next;
  loadDiary();
}

export async function loadDiary() {
  try {
    const label = document.getElementById('diary-date-label');
    if (label) label.textContent = formatDate(state.diaryDate);
    const entries = await apiFetch(`/api/food?date=${state.diaryDate}`);
    renderMealList(entries);
    renderDailySummary(entries);
  } catch (e) { showToast('שגיאה בטעינת היומן'); }
}

function renderMealList(entries) {
  const el = document.getElementById('meal-list');
  if (!entries.length) {
    el.innerHTML = `<div class="empty-state"><div class="empty-icon">🍽️</div><p>אין ארוחות מתועדות<br>לחץ 📷 לצלם אוכל</p></div>`;
    return;
  }
  const ACCENT = { breakfast: 'meal-accent-breakfast', lunch: 'meal-accent-lunch', dinner: 'meal-accent-dinner', snack: 'meal-accent-snack' };
  _mealEntries.clear();
  entries.forEach(e => _mealEntries.set(e.id, e));

  el.innerHTML = entries.map(e => `<div class="meal-item-row ${ACCENT[e.meal_type] || ''}" id="entry-${e.id}">
  <div class="mir-time-col">
    <div class="mir-food-icon">${getFoodEmoji(e.food_name)}</div>
    <div class="mir-time">${e.logged_at ? e.logged_at.slice(11, 16) : ''}</div>
  </div>
  <div class="mir-body">
    <div class="mir-name">${escapeHtml(e.food_name || '')}</div>
    <div class="mir-macros"><span style="color:var(--protein)">ח ${Math.round(e.protein_g||0)}</span> · <span style="color:var(--carb)">פ ${Math.round(e.carbs_g||0)}</span> · <span style="color:var(--fat)">ש ${Math.round(e.fat_g||0)}</span> · <span style="color:var(--fiber)">ס ${Math.round(e.fiber_g||0)}</span></div>
  </div>
  <div class="mir-right">
    <div class="mir-kcal">${Math.round(e.calories || 0)}</div>
    <div style="display:flex;flex-direction:row;gap:2px">
      <button class="mir-delete" onclick="openEditModal(${e.id})" aria-label="ערוך">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
        </svg>
      </button>
      <button class="mir-delete" onclick="deleteEntry(${e.id})" aria-label="מחק">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">
          <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
        </svg>
      </button>
    </div>
  </div>
</div>`).join('');
}

function getDiaryPetState(cal, goal) {
  if (cal === 0)               return 'sleeping';
  if (goal > 0 && cal > goal)  return 'surprised';
  if (cal > 0)                 return 'happy';
  return 'neutral';
}

function renderDailySummary(entries) {
  const totals = entries.reduce((a, e) => ({
    cal: a.cal + (+e.calories || 0),
    pro: a.pro + (+e.protein_g || 0),
    carb: a.carb + (+e.carbs_g || 0),
    fat: a.fat + (+e.fat_g || 0),
    fiber: a.fiber + (+e.fiber_g || 0),
  }), { cal: 0, pro: 0, carb: 0, fat: 0, fiber: 0 });

  document.getElementById('sum-cal').textContent = Math.round(totals.cal);
  document.getElementById('sum-pro').textContent = Math.round(totals.pro);
  document.getElementById('sum-carb').textContent = Math.round(totals.carb);
  document.getElementById('sum-fat').textContent = Math.round(totals.fat);
  document.getElementById('sum-fiber').textContent = Math.round(totals.fiber);

  // Calorie goal bar
  const rec = calcRecommendedCal();
  const goalSection = document.getElementById('cal-goal-section');
  if (rec > 0) {
    goalSection.style.display = '';
    const consumed = Math.round(totals.cal);
    const pct = Math.min(Math.round(consumed / rec * 100), 200);
    const isOver = consumed > rec;
    document.getElementById('cal-goal-text').textContent = `${rec} / ${consumed} קל'`;
    const pctEl = document.getElementById('cal-goal-pct');
    pctEl.textContent = `${Math.round(consumed / rec * 100)}%`;
    pctEl.className = 'cal-goal-pct' + (isOver ? ' over' : '');
    const fill = document.getElementById('cal-goal-fill');
    const visPct = Math.min(Math.round(consumed / rec * 100), 100);
    fill.style.width = `${visPct}%`;
    fill.className = 'cal-goal-fill' + (isOver ? ' over' : '');
    const diaryPosEl = document.getElementById('pet-diary-wrap');
    if (diaryPosEl) diaryPosEl.style.right = `calc(${visPct}% - 24px)`;
    // Add glow milestone animations
    fill.classList.remove('cal-goal-fill--half', 'cal-goal-fill--done');
    void fill.offsetWidth; // force reflow to restart animation if class is re-added
    if (pct >= 100) fill.classList.add('cal-goal-fill--done');
    else if (pct >= 50) fill.classList.add('cal-goal-fill--half');
  } else {
    goalSection.style.display = 'none';
  }

  // Diary capybara
  const diaryWrapEl = document.getElementById('pet-diary-wrap');
  if (diaryWrapEl) {
    if (!diaryWrapEl.querySelector('svg')) {
      const pet = cloneCapybara(48);
      diaryWrapEl.appendChild(pet);
      setIdleWrap('diary', pet);
      startIdleAnimations(pet);
    }
    const pet = diaryWrapEl.querySelector('.pet-wrap');
    if (pet) setPetState(pet, getDiaryPetState(totals.cal, calcRecommendedCal()));
  }
}

export async function deleteEntry(id) {
  try {
    await apiFetch(`/api/food/${id}`, { method: 'DELETE' });
    document.getElementById(`entry-${id}`)?.remove();
    loadDiary();
    showToast('הרשומה נמחקה');
  } catch (e) { showToast('שגיאה במחיקה'); }
}

// ════════════════════════════════════════════════════
// Meal Edit Modal
// ════════════════════════════════════════════════════
const _mealEntries = new Map(); // id → entry; used by renderMealList onclick

let _editEntryId     = null;
let _editOriginalName = '';
let _editOriginalDate = '';
let _editNotes        = null;
let _editAnalyzing    = false;

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
    row.innerHTML = `
      <button class="btn btn-primary" style="flex:1" onclick="editRecalculate()">חשב מחדש</button>
      <button class="btn" style="flex:1;background:var(--surface2);border:1px solid var(--border);color:var(--text2)" onclick="editSave()">שמור מבלי לחשב מחדש</button>`;
  } else {
    row.innerHTML = `<button class="btn btn-primary" style="width:100%" onclick="editSave()">שמור</button>`;
  }
}

export async function editRecalculate() {
  if (_editAnalyzing) return;
  _editAnalyzing = true;

  const closeBtn = document.getElementById('edit-modal-close');
  closeBtn.disabled = true;
  closeBtn.style.opacity = '0.4';
  document.getElementById('edit-btn-row').innerHTML =
    `<button class="btn btn-primary" style="width:100%" disabled>מחשב... 🔄</button>`;

  const foodName = document.getElementById('edit-name').value.trim();
  try {
    const data = await apiFetch('/api/analyze-text', {
      method: 'POST',
      body: JSON.stringify({ text: foodName }),
    });
    document.getElementById('edit-name').value  = data.foodName || foodName;
    document.getElementById('edit-cal').value   = (+data.calories  || 0).toFixed(1);
    document.getElementById('edit-pro').value   = (+data.protein_g || 0).toFixed(1);
    document.getElementById('edit-carb').value  = (+data.carbs_g   || 0).toFixed(1);
    document.getElementById('edit-fat').value   = (+data.fat_g     || 0).toFixed(1);
    document.getElementById('edit-fiber').value = (+data.fiber_g   || 0).toFixed(1);
    document.getElementById('edit-btn-row').innerHTML =
      `<button class="btn btn-primary" style="width:100%" onclick="editSave()">שמור</button>`;
  } catch (e) {
    const msg = e?.status === 429
      ? 'הגעת למגבלת הניתוחים לשעה זו'
      : messageFor(e);
    showToast(msg);
    updateEditButtons();
  } finally {
    _editAnalyzing = false;
    closeBtn.disabled = false;
    closeBtn.style.opacity = '';
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
  try {
    await apiFetch(`/api/food/${_editEntryId}`, { method: 'PUT', body: JSON.stringify(body) });
    closeModal('edit-modal');
    loadDiary();
    showToast('✅ המנה עודכנה');
  } catch (e) {
    showToast(messageFor(e));
  }
}
