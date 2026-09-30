// ════════════════════════════════════════════════════
// Config & State
// ════════════════════════════════════════════════════
let pendingToken = null;
let pendingUsername = null;

import { state } from './state.js';
import { apiFetch } from './api.js';
import { addDays, formatDate, formatDateShort, todayStr } from './dates.js';
import { closeModal, escapeHtml, openModal, showToast } from './dom.js';
import { stopFireCanvas } from './effects.js';
import { getFoodEmoji } from './format.js';
import { _cameraCapyState, cloneCapybara, setIdleWrap, setPetState, startIdleAnimations } from './pet.js';
import { calcRecommendedCal, loadProfile, updateSettingsProfileSub } from './profile.js';
import { navigate, registerScreen } from './router.js';
import { saveEntry, selectMeal } from './screens/analysis.js';
import { analyzeFood, analyzeText, animatePlaceholder, autoResizeTextarea, onImageSelected } from './screens/camera.js';
import { animateDashStagger, loadDashboard } from './screens/dashboard.js';
import { doChangePassword, openProfileModal, populateProfileSelects, saveMpProfile, setMpActivity, setMpGender, setMpGoal, updateMpPreview } from './screens/settings.js';
import { loadStats, statsChangeMonth, statsChangeYear, stopStatsCapyWalk, switchStats } from './screens/stats.js';
import { doLogout, getToken, getUsername, setLoggedIn } from './session.js';

// ════════════════════════════════════════════════════
// Date helpers (timezone-safe, local time)
// ════════════════════════════════════════════════════

// ════════════════════════════════════════════════════
// Profile & TDEE
// ════════════════════════════════════════════════════

// ════════════════════════════════════════════════════
// Security helpers
// ════════════════════════════════════════════════════

// ════════════════════════════════════════════════════
// API helpers
// ════════════════════════════════════════════════════

// ════════════════════════════════════════════════════
// Auth
// ════════════════════════════════════════════════════
function switchAuthTab(tab) {
  document.getElementById('auth-login').style.display = tab === 'login' ? '' : 'none';
  document.getElementById('auth-register').style.display = tab === 'register' ? '' : 'none';
  document.querySelectorAll('.tab-btn').forEach((b, i) => b.classList.toggle('active', (i === 0) === (tab === 'login')));
}

function goToAuth(tab = 'register') {
  navigate('auth');
  switchAuthTab(tab);
}

async function doLogin() {
  const u = document.getElementById('login-user').value.trim();
  const p = document.getElementById('login-pass').value;
  document.getElementById('auth-error').textContent = '';
  try {
    const data = await apiFetch('/auth/login', { method: 'POST', body: JSON.stringify({ username: u, password: p }) });
    setLoggedIn(data.token, data.username);
  } catch (e) { document.getElementById('auth-error').textContent = e.message; }
}

function doRegister() {
  const u = document.getElementById('reg-user').value.trim();
  const p = document.getElementById('reg-pass').value;
  document.getElementById('auth-error2').textContent = '';
  if (u.length < 3 || u.length > 50 || p.length < 6) {
    document.getElementById('auth-error2').textContent = 'שם משתמש חייב להכיל 3–50 תווים, סיסמא לפחות 6';
    return;
  }
  // Store credentials; advance to profile step WITHOUT creating the account yet
  state.pendingRegUser = u;
  state.pendingRegPass = p;
  document.getElementById('auth-step1').style.display = 'none';
  document.getElementById('auth-step2').style.display = '';
  document.getElementById('auth-error3').textContent = '';
  state.regGender = 'male'; state.regActivity = 'light'; state.regGoalKg = 0;
  document.getElementById('reg-male-btn').classList.add('selected');
  document.getElementById('reg-female-btn').classList.remove('selected');
  document.querySelectorAll('#reg-activity-list .activity-opt').forEach(b => {
    b.classList.toggle('selected', b.dataset.val === 'light');
  });
  const regGoalSel = document.getElementById('reg-goal-select');
  if (regGoalSel) regGoalSel.value = '0';
}

function setRegGender(g) {
  state.regGender = g;
  document.getElementById('reg-male-btn').classList.toggle('selected', g === 'male');
  document.getElementById('reg-female-btn').classList.toggle('selected', g === 'female');
}

function setRegActivity(a) {
  state.regActivity = a;
  document.querySelectorAll('#reg-activity-list .activity-opt').forEach(b => {
    b.classList.toggle('selected', b.dataset.val === a);
  });
}

function setRegGoal(v) {
  state.regGoalKg = v;
  const sel = document.getElementById('reg-goal-select');
  if (sel) sel.value = String(v);
}

async function saveRegProfile() {
  document.getElementById('auth-error3').textContent = '';
  try {
    const data = await apiFetch('/auth/register', { method: 'POST', body: JSON.stringify({ username: state.pendingRegUser, password: state.pendingRegPass }) });
    pendingToken = data.token; pendingUsername = data.username;
  } catch(e) { document.getElementById('auth-error3').textContent = e.message; return; }
  const birthDate = document.getElementById('reg-birthdate').value || '';
  const height = +document.getElementById('reg-height').value || 0;
  const weight = +document.getElementById('reg-weight').value || 0;
  const profile = { gender: state.regGender, birthDate, height, weight, activity: state.regActivity, goalKg: state.regGoalKg };
  localStorage.setItem('fl_profile', JSON.stringify(profile));
  const authHeader = { Authorization: `Bearer ${pendingToken}` };
  try { await apiFetch('/api/profile', { method: 'PUT', body: JSON.stringify(profile), headers: authHeader }); } catch(e) {}
  if (weight > 0) {
    try { await apiFetch('/api/weight', { method: 'POST', body: JSON.stringify({ weight_kg: weight, logged_at: todayStr() }), headers: authHeader }); } catch(e) {}
  }
  finishLogin();
}

async function skipRegProfile() {
  document.getElementById('auth-error3').textContent = '';
  try {
    const data = await apiFetch('/auth/register', { method: 'POST', body: JSON.stringify({ username: state.pendingRegUser, password: state.pendingRegPass }) });
    pendingToken = data.token; pendingUsername = data.username;
  } catch(e) { document.getElementById('auth-error3').textContent = e.message; return; }
  finishLogin();
}

function finishLogin() {
  loadProfile();
  setLoggedIn(pendingToken, pendingUsername);
  pendingToken = null; pendingUsername = null; state.pendingRegUser = null; state.pendingRegPass = null;
  document.getElementById('auth-step1').style.display = '';
  document.getElementById('auth-step2').style.display = 'none';
}

// ════════════════════════════════════════════════════
// Navigation
// ════════════════════════════════════════════════════

// ════════════════════════════════════════════════════

// Dashboard
// ════════════════════════════════════════════════════

// ════════════════════════════════════════════════════
// Diary
// ════════════════════════════════════════════════════
function changeDay(n) {
  const next = addDays(state.diaryDate, n);
  if (next > todayStr()) return; // no future
  state.diaryDate = next;
  loadDiary();
}

async function loadDiary() {
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

async function deleteEntry(id) {
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

function openEditModal(id) {
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

function closeEditModal() {
  if (_editAnalyzing) return;
  closeModal('edit-modal');
}

function selectEditMeal(btn) {
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

async function editRecalculate() {
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
      : (e?.message || 'שגיאה בניתוח');
    showToast(msg);
    updateEditButtons();
  } finally {
    _editAnalyzing = false;
    closeBtn.disabled = false;
    closeBtn.style.opacity = '';
  }
}

async function editSave() {
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
    showToast(e?.message || 'שגיאה בשמירה');
  }
}

// ════════════════════════════════════════════════════
// Weight screen
// ════════════════════════════════════════════════════
async function loadWeightScreen() {
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

async function addWeightLog() {
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

async function deleteWeightLog(id) {
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

// ════════════════════════════════════════════════════
// Modals & Toast
// ════════════════════════════════════════════════════

// ════════════════════════════════════════════════════
// Init
// ════════════════════════════════════════════════════
// Screen hooks: the per-screen enter/leave behaviour that navigate() used to hard-code.
// Registration order matches the order of the original if/else chain in navigate().
registerScreen('dashboard', { enter: () => { loadDashboard(); animateDashStagger(); }, leave: stopFireCanvas });
registerScreen('home',      { enter: loadDiary });
registerScreen('stats',     { enter: () => { loadStats(); }, leave: stopStatsCapyWalk });
registerScreen('weight',    { enter: loadWeightScreen });
registerScreen('camera',    { enter: animatePlaceholder });
registerScreen('analysis',  { enter: () => _cameraCapyState('neutral') });

populateProfileSelects();
loadProfile();

if (getToken()) {
  setLoggedIn(getToken(), getUsername());
} else {
  navigate('welcome');
}

document.getElementById('login-pass').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
document.getElementById('reg-pass').addEventListener('keydown', e => { if (e.key === 'Enter') doRegister(); });
document.getElementById('res-name').addEventListener('input', function() { autoResizeTextarea(this); });
document.getElementById('food-text-input').addEventListener('input', function() { autoResizeTextarea(this); });

// TEMPORARY bridge for inline handlers — removed in Task 12
// Module scope makes top-level functions non-global; the inline onclick/onchange
// attributes in index.html (and in JS template strings) still resolve names on window.
Object.assign(window, {
  addWeightLog,
  analyzeFood,
  analyzeText,
  changeDay,
  closeEditModal,
  closeModal,
  deleteEntry,
  deleteWeightLog,
  doChangePassword,
  doLogin,
  doLogout,
  doRegister,
  editRecalculate,
  editSave,
  goToAuth,
  navigate,
  onImageSelected,
  openEditModal,
  openModal,
  openProfileModal,
  saveEntry,
  saveMpProfile,
  saveRegProfile,
  selectEditMeal,
  selectMeal,
  setMpActivity,
  setMpGender,
  setMpGoal,
  setRegActivity,
  setRegGender,
  setRegGoal,
  skipRegProfile,
  statsChangeMonth,
  statsChangeYear,
  switchAuthTab,
  switchStats,
  updateMpPreview,
});
// TEMPORARY bridge accessors, removed in Task 12 together with the inline handlers.
// One inline handler (the register step-2 "back" button) assigns to these names by bare
// name (pendingRegUser=null;...); the accessors delegate to state.pendingRegUser/Pass.
Object.defineProperties(window, {
  pendingRegUser: { get: () => state.pendingRegUser, set: v => { state.pendingRegUser = v; }, configurable: true },
  pendingRegPass: { get: () => state.pendingRegPass, set: v => { state.pendingRegPass = v; }, configurable: true },
});
