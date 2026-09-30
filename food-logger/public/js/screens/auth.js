import { state } from '../state.js';
import { apiFetch } from '../api.js';
import { todayStr } from '../dates.js';
import { loadProfile } from '../profile.js';
import { setLoggedIn } from '../session.js';
import { messageFor } from '../errors.js';

// ════════════════════════════════════════════════════
// Auth
// ════════════════════════════════════════════════════
export function switchAuthTab(tab) {
  document.getElementById('auth-login').style.display = tab === 'login' ? '' : 'none';
  document.getElementById('auth-register').style.display = tab === 'register' ? '' : 'none';
  document.querySelectorAll('.tab-btn').forEach((b, i) => b.classList.toggle('active', (i === 0) === (tab === 'login')));
}

export async function doLogin() {
  const u = document.getElementById('login-user').value.trim();
  const p = document.getElementById('login-pass').value;
  document.getElementById('auth-error').textContent = '';
  try {
    const data = await apiFetch('/auth/login', { method: 'POST', body: JSON.stringify({ username: u, password: p }) });
    setLoggedIn(data.username);
  } catch (e) { document.getElementById('auth-error').textContent = messageFor(e); }
}

export function doRegister() {
  const u = document.getElementById('reg-user').value.trim();
  const p = document.getElementById('reg-pass').value;
  document.getElementById('auth-error2').textContent = '';
  if (u.length < 3 || u.length > 50 || p.length < 8) {
    document.getElementById('auth-error2').textContent = 'שם משתמש חייב להכיל 3–50 תווים, סיסמא לפחות 8';
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

export function setRegGender(g) {
  state.regGender = g;
  document.getElementById('reg-male-btn').classList.toggle('selected', g === 'male');
  document.getElementById('reg-female-btn').classList.toggle('selected', g === 'female');
}

export function setRegActivity(a) {
  state.regActivity = a;
  document.querySelectorAll('#reg-activity-list .activity-opt').forEach(b => {
    b.classList.toggle('selected', b.dataset.val === a);
  });
}

export function setRegGoal(v) {
  state.regGoalKg = v;
  const sel = document.getElementById('reg-goal-select');
  if (sel) sel.value = String(v);
}

// Registering sets the session cookie, so the profile step's requests below are
// authenticated by the browser without any token handling here.
export async function saveRegProfile() {
  document.getElementById('auth-error3').textContent = '';
  let username;
  try {
    const data = await apiFetch('/auth/register', { method: 'POST', body: JSON.stringify({ username: state.pendingRegUser, password: state.pendingRegPass }) });
    username = data.username;
  } catch(e) { document.getElementById('auth-error3').textContent = messageFor(e); return; }
  const birthDate = document.getElementById('reg-birthdate').value || '';
  const height = +document.getElementById('reg-height').value || 0;
  const weight = +document.getElementById('reg-weight').value || 0;
  const profile = { gender: state.regGender, birthDate, height, weight, activity: state.regActivity, goalKg: state.regGoalKg };
  localStorage.setItem('fl_profile', JSON.stringify(profile));
  try { await apiFetch('/api/profile', { method: 'PUT', body: JSON.stringify(profile) }); } catch(e) {}
  if (weight > 0) {
    try { await apiFetch('/api/weight', { method: 'POST', body: JSON.stringify({ weight_kg: weight, logged_at: todayStr() }) }); } catch(e) {}
  }
  finishLogin(username);
}

export async function skipRegProfile() {
  document.getElementById('auth-error3').textContent = '';
  let username;
  try {
    const data = await apiFetch('/auth/register', { method: 'POST', body: JSON.stringify({ username: state.pendingRegUser, password: state.pendingRegPass }) });
    username = data.username;
  } catch(e) { document.getElementById('auth-error3').textContent = messageFor(e); return; }
  finishLogin(username);
}

function finishLogin(username) {
  loadProfile();
  setLoggedIn(username);
  state.pendingRegUser = null; state.pendingRegPass = null;
  document.getElementById('auth-step1').style.display = '';
  document.getElementById('auth-step2').style.display = 'none';
}
