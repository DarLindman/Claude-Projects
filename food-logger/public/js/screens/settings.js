import { state } from '../state.js';
import { apiFetch } from '../api.js';
import { closeModal, html, openModal, setHtml, showToast } from '../dom.js';
import { mountWalkingCapybara } from '../pet.js';
import { formatNumber } from '../format.js';
import { calcRecommendedCal, updateSettingsProfileSub } from '../profile.js';
import { messageFor } from '../errors.js';
import { todayStr } from '../dates.js';
import { doLogout } from '../session.js';

// ════════════════════════════════════════════════════
// The walking capybara (along the bottom of the page): mounted when the screen is entered, stopped when it is left
// (router hooks registered in main.js). Mounting the same page twice returns the same walker.
// ════════════════════════════════════════════════════
let _walker = null;
export function enterSettings() {
  const page = document.querySelector('#screen-settings .page');
  if (page) _walker = mountWalkingCapybara(page, { state: 'neutral', size: 96, bottom: 4 });
}
export function leaveSettings() {
  if (_walker) { _walker.stop(); _walker = null; }
}

// Populate dropdown selects for profile fields
export function populateProfileSelects() {
  const todayISO = todayStr();
  const minBD = `${+todayISO.slice(0, 4) - 100}${todayISO.slice(4)}`;
  ['reg-birthdate', 'mp-birthdate'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.max = todayISO; el.min = minBD; }
  });
  // Height: 100–220 cm
  ['reg-height', 'mp-height'].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const options = [];
    for (let h = 220; h >= 100; h--) {
      options.push(html`<option value="${h}">${h} ס״מ</option>`);
    }
    setHtml(sel, html`<option value="">גובה</option>${options}`);
  });
  // Weight: 30–250 kg in 0.5 steps
  ['reg-weight'].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const options = [];
    for (let w = 250; w >= 30; w -= 0.5) {
      const v = w.toFixed(1);
      options.push(html`<option value="${v}">${v} ק״ג</option>`);
    }
    setHtml(sel, html`<option value="">משקל</option>${options}`);
  });
  // Default registration selects/inputs to average values
  document.getElementById('reg-birthdate').value = todayISO;
  document.getElementById('reg-height').value = '175';
  document.getElementById('reg-weight').value = '70.0';
}

// Opens the change-password slip empty: what was typed before (and the last error) never comes back.
export function openChangePassModal() {
  clearChangePassModal();
  openModal('modal-change-pass');
}
function clearChangePassModal() {
  document.getElementById('cp-current').value = '';
  document.getElementById('cp-new').value = '';
  document.getElementById('cp-error').textContent = '';
}

// Sign-out: both slips are emptied (they are closed by closeAllModals), so the next person finds nothing of this one.
export function resetSettingsModals() {
  _cpGen += 1;
  _cpBusy = false;
  document.querySelector('#modal-change-pass [data-action="doChangePassword"]').disabled = false;
  clearChangePassModal();
  document.getElementById('mp-birthdate').value = '';
  document.getElementById('mp-height').value = '';
  document.getElementById('mp-error').textContent = '';
  document.getElementById('mp-cal-preview').textContent = '—';
  state.mpGender = 'male';
  state.mpActivity = 'light';
  state.mpGoalKg = 0;
}

// One request at a time (the button is disabled while it is in flight); _cpGen is bumped by a sign-out, and a reply that was in
// flight at that moment is dropped: no toast and no error text on the next person's screen.
let _cpGen = 0;
let _cpBusy = false;
export async function doChangePassword() {
  if (_cpBusy) return;
  const cur = document.getElementById('cp-current').value;
  const nw = document.getElementById('cp-new').value;
  const btn = document.querySelector('#modal-change-pass [data-action="doChangePassword"]');
  document.getElementById('cp-error').textContent = '';
  const gen = _cpGen;
  _cpBusy = true;
  btn.disabled = true;
  try {
    await apiFetch('/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword: cur, newPassword: nw }) });
    if (gen !== _cpGen) return;
    closeModal('modal-change-pass');
    showToast('הסיסמה שונתה בהצלחה');
  } catch (e) {
    if (gen === _cpGen) document.getElementById('cp-error').textContent = messageFor(e);
  } finally {
    if (gen === _cpGen) { _cpBusy = false; btn.disabled = false; }
  }
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
  document.getElementById('mp-cal-preview').textContent = rec > 0 ? `${formatNumber(rec)} קק״ל` : '—';
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
  openChangePassModal: () => openChangePassModal(),
  doLogout: () => doLogout(),
  doChangePassword: () => doChangePassword(),
  setMpGender: (el) => setMpGender(el.dataset.arg),
  setMpActivity: (el) => setMpActivity(el.dataset.arg),
  setMpGoal: (el) => setMpGoal(+el.value),
  updateMpPreview: () => updateMpPreview(),
  saveMpProfile: () => saveMpProfile(),
};
