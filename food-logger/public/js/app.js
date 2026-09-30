// ════════════════════════════════════════════════════
// Config & State
// ════════════════════════════════════════════════════
let pendingToken = null;
let pendingUsername = null;

import { state } from './state.js';
import { apiFetch } from './api.js';
import { todayStr } from './dates.js';
import { closeModal, openModal } from './dom.js';
import { stopFireCanvas } from './effects.js';
import { _cameraCapyState } from './pet.js';
import { loadProfile } from './profile.js';
import { navigate, registerScreen } from './router.js';
import { saveEntry, selectMeal } from './screens/analysis.js';
import { analyzeFood, analyzeText, animatePlaceholder, autoResizeTextarea, onImageSelected } from './screens/camera.js';
import { animateDashStagger, loadDashboard } from './screens/dashboard.js';
import { changeDay, closeEditModal, deleteEntry, editRecalculate, editSave, loadDiary, openEditModal, selectEditMeal } from './screens/home.js';
import { doChangePassword, openProfileModal, populateProfileSelects, saveMpProfile, setMpActivity, setMpGender, setMpGoal, updateMpPreview } from './screens/settings.js';
import { loadStats, statsChangeMonth, statsChangeYear, stopStatsCapyWalk, switchStats } from './screens/stats.js';
import { addWeightLog, deleteWeightLog, loadWeightScreen } from './screens/weight.js';
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
