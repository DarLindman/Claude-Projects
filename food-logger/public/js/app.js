// ════════════════════════════════════════════════════
// Config & State
// ════════════════════════════════════════════════════
let pendingToken = null;
let pendingUsername = null;

import { state } from './state.js';
import { apiFetch } from './api.js';
import { renderLineChart, renderStatAvgBox, renderStatMacros } from './charts.js';
import { addDays, addMonths, formatDate, formatDateShort, formatMonth, todayStr } from './dates.js';
import { closeModal, escapeHtml, openModal, showToast } from './dom.js';
import { animateCountUp, startFireCanvas, stopFireCanvas } from './effects.js';
import { getFoodEmoji } from './format.js';
import { PET_MESSAGES, _cameraCapyState, cloneCapybara, getIdleWrap, getPetState, scheduleCameraHappy, setIdleWrap, setPetState, startIdleAnimations } from './pet.js';
import { calcRecommendedCal, loadProfile, updateSettingsProfileSub } from './profile.js';
import { navigate, registerScreen } from './router.js';
import { saveEntry, selectMeal } from './screens/analysis.js';
import { doLogout, getToken, getUsername, setLoggedIn } from './session.js';

// ════════════════════════════════════════════════════
// Date helpers (timezone-safe, local time)
// ════════════════════════════════════════════════════

// ════════════════════════════════════════════════════
// Profile & TDEE
// ════════════════════════════════════════════════════

// Populate dropdown selects for profile fields
function populateProfileSelects() {
  const today = new Date();
  const pad = n => String(n).padStart(2, '0');
  const todayISO = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  const minBD = `${today.getFullYear() - 100}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  ['reg-birthdate', 'mp-birthdate'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.max = todayISO; el.min = minBD; }
  });
  // Height: 100–220 cm
  ['reg-height', 'mp-height'].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    sel.innerHTML = '<option value="">גובה</option>';
    for (let h = 220; h >= 100; h--) {
      sel.innerHTML += `<option value="${h}">${h} ס"מ</option>`;
    }
  });
  // Weight: 30–250 kg in 0.5 steps
  ['reg-weight'].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    sel.innerHTML = '<option value="">משקל</option>';
    for (let w = 250; w >= 30; w -= 0.5) {
      const v = w.toFixed(1);
      sel.innerHTML += `<option value="${v}">${v} ק"ג</option>`;
    }
  });
  // Default registration selects/inputs to average values
  document.getElementById('reg-birthdate').value = todayISO;
  document.getElementById('reg-height').value = '175';
  document.getElementById('reg-weight').value = '70.0';
}

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

async function doChangePassword() {
  const cur = document.getElementById('cp-current').value;
  const nw = document.getElementById('cp-new').value;
  document.getElementById('cp-error').textContent = '';
  try {
    await apiFetch('/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword: cur, newPassword: nw }) });
    closeModal('modal-change-pass');
    showToast('הסיסמא שונתה בהצלחה');
  } catch (e) { document.getElementById('cp-error').textContent = e.message; }
}

// ════════════════════════════════════════════════════
// Profile modal
// ════════════════════════════════════════════════════
function openProfileModal() {
  // Prefill from current profile
  if (state.userProfile) {
    state.mpGender = state.userProfile.gender || 'male';
    state.mpActivity = state.userProfile.activity || 'light';
    state.mpGoalKg = state.userProfile.goalKg || 0;
    const bd = state.userProfile.birthDate || (state.userProfile.birthYear ? `${state.userProfile.birthYear}-01-01` : '');
    document.getElementById('mp-birthdate').value = bd;
    document.getElementById('mp-height').value = state.userProfile.height || '';
  } else {
    state.mpGender = 'male';
    state.mpActivity = 'light';
    state.mpGoalKg = 0;
    document.getElementById('mp-birthdate').value = '';
    document.getElementById('mp-height').value = '';
  }
  document.getElementById('mp-male-btn').classList.toggle('selected', state.mpGender === 'male');
  document.getElementById('mp-female-btn').classList.toggle('selected', state.mpGender === 'female');
  document.querySelectorAll('#mp-activity-list .activity-opt').forEach(b => {
    b.classList.toggle('selected', b.dataset.val === state.mpActivity);
  });
  // Find closest goal option
  const goalOpts = [-1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1];
  const closest = goalOpts.reduce((a, b) => Math.abs(b - state.mpGoalKg) < Math.abs(a - state.mpGoalKg) ? b : a);
  state.mpGoalKg = closest;
  const goalSel = document.getElementById('mp-goal-select');
  if (goalSel) goalSel.value = String(state.mpGoalKg);
  updateMpPreview();
  openModal('modal-profile');
}

function setMpGender(g) {
  state.mpGender = g;
  document.getElementById('mp-male-btn').classList.toggle('selected', g === 'male');
  document.getElementById('mp-female-btn').classList.toggle('selected', g === 'female');
  updateMpPreview();
}

function setMpActivity(a) {
  state.mpActivity = a;
  document.querySelectorAll('#mp-activity-list .activity-opt').forEach(b => {
    b.classList.toggle('selected', b.dataset.val === a);
  });
  updateMpPreview();
}

function setMpGoal(v) {
  state.mpGoalKg = v;
  const sel = document.getElementById('mp-goal-select');
  if (sel) sel.value = String(v);
  updateMpPreview();
}

function updateMpPreview() {
  const currentWeight = state.weightLogs.length ? +state.weightLogs[state.weightLogs.length - 1].weight_kg : (state.userProfile ? +state.userProfile.weight || 0 : 0);
  const profile = {
    gender: state.mpGender,
    birthDate: document.getElementById('mp-birthdate').value || '',
    height: +document.getElementById('mp-height').value || 0,
    weight: currentWeight,
    activity: state.mpActivity,
    goalKg: state.mpGoalKg,
  };
  const rec = calcRecommendedCal(profile);
  document.getElementById('mp-cal-preview').textContent = rec > 0 ? `${rec} קל'` : '—';
}

async function saveMpProfile() {
  const currentWeight = state.weightLogs.length ? +state.weightLogs[state.weightLogs.length - 1].weight_kg : (state.userProfile ? +state.userProfile.weight || 0 : 0);
  const profile = {
    gender: state.mpGender,
    birthDate: document.getElementById('mp-birthdate').value || '',
    height: +document.getElementById('mp-height').value || 0,
    weight: currentWeight,
    activity: state.mpActivity,
    goalKg: state.mpGoalKg,
  };
  localStorage.setItem('fl_profile', JSON.stringify(profile));
  state.userProfile = profile;
  try { await apiFetch('/api/profile', { method: 'PUT', body: JSON.stringify(profile) }); } catch {}
  updateSettingsProfileSub();
  closeModal('modal-profile');
  showToast('הפרופיל נשמר');
}

// ════════════════════════════════════════════════════
// Navigation
// ════════════════════════════════════════════════════
let _placeholderIv = null;
function animatePlaceholder() {
  const ta = document.getElementById('food-text-input');
  if (!ta) return;
  clearInterval(_placeholderIv);
  const full = ta.getAttribute('data-placeholder') || '';
  ta.placeholder = '';
  let i = 0;
  _placeholderIv = setInterval(() => {
    if (i >= full.length) { clearInterval(_placeholderIv); return; }
    ta.placeholder = full.slice(0, ++i);
  }, 15);
}

function autoResizeTextarea(el) {
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}

// ════════════════════════════════════════════════════
// Dashboard helpers
// ════════════════════════════════════════════════════
function renderDashLogPreview(entries) {
  const el = document.getElementById('dash-log-preview');
  if (!el) return;
  const last3 = entries.slice(-3).reverse();
  if (!last3.length) { el.innerHTML = ''; return; }
  el.innerHTML = last3.map(e => {
    const t = e.logged_at ? e.logged_at.slice(11, 16) : '';
    return `<div class="dash-log-row">
      <div class="dash-log-time-col">
        <div class="dash-log-icon">${getFoodEmoji(e.food_name)}</div>
        <div class="dash-log-time">${t}</div>
      </div>
      <div class="dash-log-name">${escapeHtml(e.food_name || '')}</div>
      <div class="dash-log-kcal">${Math.round(e.calories || 0)}</div>
      <div class="dash-log-macros">ח ${Math.round(e.protein_g||0)} · פ ${Math.round(e.carbs_g||0)} · ש ${Math.round(e.fat_g||0)}</div>
    </div>`;
  }).join('');
}

// ════════════════════════════════════════════════════

function animateDashStagger() {
  var els = document.querySelectorAll('.dash-stagger');
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  els.forEach(function(el) { el.classList.remove('anim-visible'); });
  var delays = [0, 150, 300, 450];
  els.forEach(function(el, i) {
    if (reduced) { el.classList.add('anim-visible'); return; }
    setTimeout(function() { el.classList.add('anim-visible'); }, delays[i] || 0);
  });
}

// Dashboard
// ════════════════════════════════════════════════════
async function loadDashboard() {
  let entries = [], cal = 0, goal = 0;

  try {
    entries = await apiFetch(`/api/food?date=${todayStr()}`);
    const { cal: c, pro, carb, fat, fiber } = entries.reduce(
      (s, e) => ({
        cal:   s.cal   + (+e.calories  || 0),
        pro:   s.pro   + (+e.protein_g || 0),
        carb:  s.carb  + (+e.carbs_g   || 0),
        fat:   s.fat   + (+e.fat_g     || 0),
        fiber: s.fiber + (+e.fiber_g   || 0),
      }),
      { cal: 0, pro: 0, carb: 0, fat: 0, fiber: 0 }
    );
    cal = c;
    goal = calcRecommendedCal(state.userProfile);
    const calEl  = document.getElementById('dash-cal-remaining');
    const sepEl  = document.getElementById('dash-cal-sep');
    const goalEl = document.getElementById('dash-cal-goal-label');
    const pctEl  = document.getElementById('dash-cal-pct');
    if (cal === 0 && goal === 0) {
      calEl.textContent = '—';
    } else if (cal === 0) {
      calEl.textContent = '0';
    } else {
      animateCountUp(calEl, cal);
    }
    if (goal > 0) {
      goalEl.textContent = goal.toLocaleString('he-IL');
      goalEl.style.display = '';
      sepEl.style.display  = '';
      const pct = Math.round((cal / goal) * 100);
      pctEl.textContent    = pct + '%';
      pctEl.style.display  = '';
    } else {
      goalEl.style.display = 'none';
      sepEl.style.display  = 'none';
      pctEl.style.display  = 'none';
    }
  } catch {}

  try {
    const { streak, lastLogDate } = await apiFetch('/api/streak');
    const numEl = document.getElementById('dash-streak-num');
    if (numEl) numEl.textContent = streak ?? '—';
    if (streak >= 1) startFireCanvas();
    else stopFireCanvas();

    // Pet state — use Israel timezone to match server streak calculation
    const toIsraelDate = d => d.toLocaleString('sv', { timeZone: 'Asia/Jerusalem' }).slice(0, 10);
    const today = toIsraelDate(new Date());
    const yesterday = toIsraelDate(new Date(Date.now() - 86400000));
    const hasLoggedToday = entries && entries.length > 0;
    const hasLoggedYesterday = lastLogDate === yesterday;
    const daysSinceLastLog = lastLogDate
      ? Math.round((new Date(today) - new Date(lastLogDate)) / 86400000)
      : 999;

    const petState = getPetState(cal / (goal || 2000), hasLoggedToday, hasLoggedYesterday, daysSinceLastLog);
    const wrapEl = document.getElementById('pet-dashboard-wrap');
    if (wrapEl && !wrapEl.querySelector('svg')) {
      wrapEl.appendChild(cloneCapybara(80));
      setIdleWrap('dash', wrapEl.querySelector('.pet-wrap'));
    }
    if (getIdleWrap('dash')) startIdleAnimations(getIdleWrap('dash'));
    const petWrap = wrapEl?.querySelector('.pet-wrap');
    if (petWrap) setPetState(petWrap, petState);

    const petUsername = getUsername() || '';
    document.getElementById('pet-name-label').textContent = petUsername;
    document.getElementById('pet-status-text').textContent = PET_MESSAGES[petState](petUsername);

  } catch {}
}

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
// Camera & Analysis
// ════════════════════════════════════════════════════
function onImageSelected(e) {
  const file = e.target.files[0];
  if (!file) return;
  state.capturedMime = 'image/jpeg';
  const reader = new FileReader();
  reader.onload = ev => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const MAX = 1024;
      let w = img.width, h = img.height;
      if (w > MAX || h > MAX) {
        if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
        else { w = Math.round(w * MAX / h); h = MAX; }
      }
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      const compressed = canvas.toDataURL('image/jpeg', 0.8);
      state.capturedImageBase64 = compressed.split(',')[1];
      document.getElementById('preview-img').src = compressed;
      document.getElementById('preview-img').style.display = 'block';
      document.querySelector('.cam-placeholder').style.display = 'none';
      document.getElementById('analyze-btn').disabled = false;
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}

async function analyzeText() {
  const text = document.getElementById('food-text-input').value.trim();
  if (!text) return;
  const btn = document.getElementById('text-analyze-btn');
  btn.disabled = true;
  navigate('analysis');
  _cameraCapyState('thinking');
  document.getElementById('analysis-img').style.display = 'none';
  document.getElementById('analysis-loading').style.display = 'block';
  document.getElementById('analysis-result').style.display = 'none';
  document.getElementById('analysis-error').textContent = '';
  try {
    const data = await apiFetch('/api/analyze-text', { method: 'POST', body: JSON.stringify({ text }) });
    _cameraCapyState('ecstatic');
    scheduleCameraHappy();
    const resName = document.getElementById('res-name');
    resName.value = data.foodName || '';
    requestAnimationFrame(() => autoResizeTextarea(resName));
    document.getElementById('res-cal').value = (+data.calories || 0).toFixed(1);
    document.getElementById('res-pro').value = (+data.protein_g || 0).toFixed(1);
    document.getElementById('res-carb').value = (+data.carbs_g || 0).toFixed(1);
    document.getElementById('res-fat').value = (+data.fat_g || 0).toFixed(1);
    document.getElementById('res-fiber').value = (+data.fiber_g || 0).toFixed(1);

    document.getElementById('analysis-loading').style.display = 'none';
    const now = new Date();
    const hhmm = now.toTimeString().slice(0, 5);
    const rtEl = document.getElementById('receipt-time');
    if (rtEl) rtEl.textContent = hhmm;
    const timeInput = document.getElementById('res-time');
    if (timeInput) timeInput.value = hhmm;
    // Re-trigger stagger animation by forcing reflow
    const rb = document.getElementById('receipt-body');
    if (rb) { rb.querySelectorAll('.receipt-entry').forEach(r => { r.style.animation = 'none'; r.offsetHeight; r.style.animation = ''; }); }
    document.getElementById('analysis-result').style.display = 'block';
  } catch (e) {
    _cameraCapyState('sad');
    document.getElementById('analysis-loading').style.display = 'none';
    document.getElementById('analysis-error').textContent = e.message;
  }
  btn.disabled = false;
}

async function analyzeFood() {
  if (!state.capturedImageBase64) return;
  navigate('analysis');
  _cameraCapyState('thinking');
  document.getElementById('analysis-img').src = `data:${state.capturedMime};base64,${state.capturedImageBase64}`;
  document.getElementById('analysis-img').style.display = 'block';
  document.getElementById('analysis-loading').style.display = 'block';
  document.getElementById('analysis-result').style.display = 'none';
  document.getElementById('analysis-error').textContent = '';

  try {
    const data = await apiFetch('/api/analyze', {
      method: 'POST',
      body: JSON.stringify({ imageBase64: state.capturedImageBase64, mimeType: state.capturedMime })
    });
    const resName = document.getElementById('res-name');
    resName.value = data.foodName || '';
    autoResizeTextarea(resName);
    document.getElementById('res-cal').value = (+data.calories || 0).toFixed(1);
    document.getElementById('res-pro').value = (+data.protein_g || 0).toFixed(1);
    document.getElementById('res-carb').value = (+data.carbs_g || 0).toFixed(1);
    document.getElementById('res-fat').value = (+data.fat_g || 0).toFixed(1);
    document.getElementById('res-fiber').value = (+data.fiber_g || 0).toFixed(1);

    document.getElementById('analysis-loading').style.display = 'none';
    const now = new Date();
    const hhmm = now.toTimeString().slice(0, 5);
    const rtEl = document.getElementById('receipt-time');
    if (rtEl) rtEl.textContent = hhmm;
    const timeInput = document.getElementById('res-time');
    if (timeInput) timeInput.value = hhmm;
    // Re-trigger stagger animation by forcing reflow
    const rb = document.getElementById('receipt-body');
    if (rb) { rb.querySelectorAll('.receipt-entry').forEach(r => { r.style.animation = 'none'; r.offsetHeight; r.style.animation = ''; }); }
    _cameraCapyState('ecstatic');
    scheduleCameraHappy();
    document.getElementById('analysis-result').style.display = 'block';
  } catch (e) {
    _cameraCapyState('sad');
    document.getElementById('analysis-loading').style.display = 'none';
    document.getElementById('analysis-error').textContent = e.message;
  }
}

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

function stopStatsCapyWalk() {
  if (_capyWalkRaf) { cancelAnimationFrame(_capyWalkRaf); _capyWalkRaf = null; }
}

// ════════════════════════════════════════════════════
// Stats
// ════════════════════════════════════════════════════
function switchStats(tab) {
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

function statsChangeMonth(n) {
  const next = addMonths(state.statsMonth, n);
  if (next > todayStr().slice(0, 7)) return; // no future month
  state.statsMonth = next;
  loadStats();
}
function statsChangeYear(n) {
  const next = +state.statsYear + n;
  if (next > new Date().getFullYear()) return; // no future year
  state.statsYear = String(next);
  loadStats();
}

async function loadStats() {
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
    chartEl.innerHTML = renderLineChart(chartDays, {
      getValue: r => +r.calories || 0,
      getLabel: r => formatDateShort(r.day.slice(0, 10)),
      isToday: r => r.day.slice(0, 10) === todayDs,
      recommended: rec,
      dayLetters: chartDays.map(r => {
        const parts = r.day.slice(0, 10).split('-');
        const d = new Date(+parts[0], +parts[1] - 1, +parts[2]);
        return hebrewDays[d.getDay()];
      }),
    });
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
        wrapEl.innerHTML = '';
        wrapEl.appendChild(stage);
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
    if (!rows.length) { chartEl.innerHTML = `<div class="empty-state"><p>אין נתונים</p></div>`; return; }
    const todayS = todayStr();
    chartEl.innerHTML = renderLineChart(rows, {
      getValue: r => +r.calories || 0,
      getLabel: r => String(+r.day.slice(8, 10)),
      isToday: r => r.day.slice(0, 10) === todayS,
      recommended: rec,
    });
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
        diffHtml = `<div class="avg-diff ${cls}">${diff > 0 ? '+' : ''}${diff} קל'</div><div style="font-size:11px;color:var(--muted)">מהמומלץ</div>`;
      }
      yearlyAvgEl.innerHTML = `<div class="avg-box"><div class="avg-box-left"><div class="avg-val">${yearlyDailyAvg}</div><div class="avg-label">ממוצע קל' יומי</div></div><div class="avg-box-right">${diffHtml}</div></div>`;
    }
    const chartEl = document.getElementById('yearly-chart');
    if (!rows.length) { chartEl.innerHTML = `<div class="empty-state"><p>אין נתונים</p></div>`; return; }
    const currentMonth = todayStr().slice(0, 7);
    chartEl.innerHTML = renderLineChart(rows, {
      getValue: r => r.day_count > 0 ? Math.round((+r.calories || 0) / r.day_count) : 0,
      getLabel: r => monthNames[+(r.month.slice(5, 7)) - 1],
      isToday: r => r.month === currentMonth,
      recommended: rec,
    });
    renderStatMacros('yearly-macro', rows, `ממוצע יומי על בסיס ${totalDays} ימים`, totalDays);
  } catch { }
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
