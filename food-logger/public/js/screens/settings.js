import { state } from '../state.js';
import { apiFetch } from '../api.js';
import { closeModal, openModal, showToast } from '../dom.js';
import { calcRecommendedCal, updateSettingsProfileSub } from '../profile.js';
import { messageFor } from '../errors.js';
import { doLogout } from '../session.js';

// Populate dropdown selects for profile fields
export function populateProfileSelects() {
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

export async function doChangePassword() {
  const cur = document.getElementById('cp-current').value;
  const nw = document.getElementById('cp-new').value;
  document.getElementById('cp-error').textContent = '';
  try {
    await apiFetch('/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword: cur, newPassword: nw }) });
    closeModal('modal-change-pass');
    showToast('הסיסמא שונתה בהצלחה');
  } catch (e) { document.getElementById('cp-error').textContent = messageFor(e); }
}

// ════════════════════════════════════════════════════
// Profile modal
// ════════════════════════════════════════════════════
export function openProfileModal() {
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

export function setMpGender(g) {
  state.mpGender = g;
  document.getElementById('mp-male-btn').classList.toggle('selected', g === 'male');
  document.getElementById('mp-female-btn').classList.toggle('selected', g === 'female');
  updateMpPreview();
}

export function setMpActivity(a) {
  state.mpActivity = a;
  document.querySelectorAll('#mp-activity-list .activity-opt').forEach(b => {
    b.classList.toggle('selected', b.dataset.val === a);
  });
  updateMpPreview();
}

export function setMpGoal(v) {
  state.mpGoalKg = v;
  const sel = document.getElementById('mp-goal-select');
  if (sel) sel.value = String(v);
  updateMpPreview();
}

export function updateMpPreview() {
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

export async function saveMpProfile() {
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

// Actions for the settings screen and the profile / change-password modals (doLogout lives in session.js).
export const actions = {
  openProfileModal: () => openProfileModal(),
  doLogout: () => doLogout(),
  doChangePassword: () => doChangePassword(),
  setMpGender: (el) => setMpGender(el.dataset.arg),
  setMpActivity: (el) => setMpActivity(el.dataset.arg),
  setMpGoal: (el) => setMpGoal(+el.value),
  updateMpPreview: () => updateMpPreview(),
  saveMpProfile: () => saveMpProfile(),
};
