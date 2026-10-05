import { state } from './state.js';
import { apiFetch, configureApi } from './api.js';
import { sortWeightLogs, updateSettingsProfileSub } from './profile.js';
import { navigate } from './router.js';
import { closeAllModals } from './dom.js';
import { resetCamera } from './screens/camera.js';
import { resetEditModal } from './screens/home.js';
import { resetSettingsModals } from './screens/settings.js';
import { resetWeightAdd } from './screens/weight.js';

// The session itself is an HttpOnly cookie set by the server; JavaScript never sees it.
// Only the username is kept here, in memory, for display.
let username = null;
export function getUsername() { return username; }

// Before cookie sessions the token and username lived in localStorage; drop them.
function removeLegacyKeys() {
  try {
    localStorage.removeItem('fl_token');
    localStorage.removeItem('fl_username');
  } catch { /* storage unavailable */ }
}

// On page load: ask the server who is signed in (the cookie goes along by itself).
export async function bootSession() {
  removeLegacyKeys();
  let me = null;
  try {
    me = await apiFetch('/auth/me', { silent: true });
  } catch { /* not signed in, session expired or network error */ }
  if (me && me.username) await setLoggedIn(me.username);
  else navigate('welcome');
}

// Bumped by every doLogout(). setLoggedIn compares it after each await: apiFetch runs the
// unauthorized handler (doLogout) the moment a call reports a lost session, before it
// throws, so an unchanged value means the session is still the one this call started with.
let logoutCount = 0;

export async function setLoggedIn(u) {
  const startedAt = logoutCount;
  username = u;
  document.getElementById('settings-username').textContent = u;
  // Load profile from server; fall back to localStorage
  try {
    const serverProfile = await apiFetch('/api/profile');
    if (serverProfile && Object.keys(serverProfile).length) {
      state.userProfile = serverProfile;
      localStorage.setItem('fl_profile', JSON.stringify(serverProfile));
    }
  } catch {}
  if (logoutCount !== startedAt) return; // the session was lost: stay on the auth screen
  // Load weight logs at startup so calcRecommendedCal always has current weight
  try { state.weightLogs = sortWeightLogs(await apiFetch('/api/weight')); } catch {}
  if (logoutCount !== startedAt) return;
  updateSettingsProfileSub();
  document.getElementById('bottom-nav').style.display = 'flex';
  navigate('dashboard');
}

// Signs out this device: the server clears the cookie (a failure is ignored, the local
// state is cleared either way).
export async function doLogout() {
  logoutCount += 1;
  try { await apiFetch('/auth/logout', { method: 'POST', silent: true }); } catch {}
  localStorage.removeItem('fl_profile');
  username = null; state.userProfile = null;
  state.weightLogs = [];   // the next person must not see this one's weights (the dashboard and the weight screen read them)
  resetCamera();   // the next person must not see this one's photo or text
  closeAllModals();   // a slip left open (profile, password, meal) must not cover the next person's screen,
  resetSettingsModals();   // nor keep what was typed or loaded into it,
  resetEditModal();
  resetWeightAdd();   // an add in flight for this person must not hold the next person's button
  document.getElementById('settings-username').textContent = '';
  updateSettingsProfileSub();   // and the settings rows show "not set" until the next sign-in fills them
  document.getElementById('bottom-nav').style.display = 'none';
  navigate('auth');
}

// Wire the 401 handler into apiFetch
configureApi({ onUnauthorized: doLogout });
