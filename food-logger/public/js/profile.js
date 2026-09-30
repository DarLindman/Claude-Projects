import { state } from './state.js';

export function loadProfile() {
  try { state.userProfile = JSON.parse(localStorage.getItem('fl_profile')); } catch {}
}

function profileAge(p) {
  const pr = p || state.userProfile;
  if (!pr) return 0;
  if (pr.birthDate) {
    const [by, bm, bd] = pr.birthDate.split('-').map(Number);
    const t = new Date();
    let age = t.getFullYear() - by;
    if (t.getMonth() + 1 < bm || (t.getMonth() + 1 === bm && t.getDate() < bd)) age--;
    return age;
  }
  if (pr.birthYear) return new Date().getFullYear() - +pr.birthYear; // backwards compat
  return +pr.age || 0;
}

export function calcRecommendedCal(profile) {
  const p = profile || state.userProfile;
  if (!p) return 0;
  const { gender, height, activity, goalKg } = p;
  // Always use latest weight log for current user; fall back to stored profile weight
  // weightLogs is ordered ASC by date from server, so last element is newest
  let weight = +p.weight || 0;
  if (!profile && state.weightLogs.length) {
    const latestLog = state.weightLogs[state.weightLogs.length - 1];
    if (+latestLog.weight_kg > 0) weight = +latestLog.weight_kg;
  }
  const age = profileAge(p);
  if (!age || !height || !weight) return 0;
  let bmr = 10 * weight + 6.25 * (+height) - 5 * age;
  bmr += gender === 'male' ? 5 : -161;
  const mult = { sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, vactive: 1.9 };
  const tdee = bmr * (mult[activity] || 1.2);
  const adj = (+goalKg || 0) * 7700 / 7;
  return Math.max(Math.round(tdee + adj), 1000);
}

export function updateSettingsProfileSub() {
  const sub = document.getElementById('settings-profile-sub');
  if (!sub) return;
  const rec = calcRecommendedCal();
  sub.textContent = rec > 0 ? `${rec} קל' מומלצות ביום` : 'לא הוגדר';
}
