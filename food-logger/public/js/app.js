// ════════════════════════════════════════════════════
// Config & State
// ════════════════════════════════════════════════════

import { state } from './state.js';
import { closeModal, openModal } from './dom.js';
import { stopFireCanvas } from './effects.js';
import { _cameraCapyState } from './pet.js';
import { loadProfile } from './profile.js';
import { navigate, registerScreen } from './router.js';
import { saveEntry, selectMeal } from './screens/analysis.js';
import { doLogin, doRegister, saveRegProfile, setRegActivity, setRegGender, setRegGoal, skipRegProfile, switchAuthTab } from './screens/auth.js';
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

function goToAuth(tab = 'register') {
  navigate('auth');
  switchAuthTab(tab);
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
