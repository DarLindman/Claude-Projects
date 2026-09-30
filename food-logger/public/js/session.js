import { state } from './state.js';
import { apiFetch, configureApi } from './api.js';
import { updateSettingsProfileSub } from './profile.js';
import { navigate } from './router.js';

let token = localStorage.getItem('fl_token');
let username = localStorage.getItem('fl_username');
export function getToken() { return token; }
export function getUsername() { return username; }

export async function setLoggedIn(t, u) {
  token = t; username = u;
  localStorage.setItem('fl_token', t);
  localStorage.setItem('fl_username', u);
  document.getElementById('settings-user').textContent = `מחובר כ: ${u}`;
  document.getElementById('bottom-nav').style.display = 'flex';
  // Load profile from server; fall back to localStorage
  try {
    const serverProfile = await apiFetch('/api/profile');
    if (serverProfile && Object.keys(serverProfile).length) {
      state.userProfile = serverProfile;
      localStorage.setItem('fl_profile', JSON.stringify(serverProfile));
    }
  } catch {}
  // Load weight logs at startup so calcRecommendedCal always has current weight
  try { state.weightLogs = await apiFetch('/api/weight'); } catch {}
  updateSettingsProfileSub();
  navigate('dashboard');
}

export function doLogout() {
  localStorage.removeItem('fl_token');
  localStorage.removeItem('fl_username');
  localStorage.removeItem('fl_profile');
  token = null; username = null; state.userProfile = null;
  document.getElementById('bottom-nav').style.display = 'none';
  navigate('auth');
}

// Wire the token and the 401 handler into apiFetch
configureApi({ getToken, onUnauthorized: doLogout });
