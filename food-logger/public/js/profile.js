import { state } from './state.js';
import { formatNumber } from './format.js';

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

// The weight entries oldest first; entries of the same day by id, so the newest added is last whatever order the server
// returned (calcRecommendedCal, the dashboard and the weight screen read the last element as the newest).
export function sortWeightLogs(rows) {
  const day = (r) => String(r.logged_at).slice(0, 10);
  return [...rows].sort((a, b) => (day(a) < day(b) ? -1 : day(a) > day(b) ? 1 : a.id - b.id));
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

// The weekly change goal as the profile modal's list shows it: a sign (marked left-to-right so it stays in front in RTL), a
// whole number or a fraction glyph, and the unit; 0 is "keeping the weight". A value off the list snaps to the closest option
// (the modal does the same when it opens).
const GOAL_STEPS = [-1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1];
const GOAL_GLYPH = { 0.25: '¼', 0.5: '½', 0.75: '¾', 1: '1' };
export function formatWeeklyGoal(goalKg) {
  const g = +goalKg || 0;
  const step = GOAL_STEPS.reduce((a, b) => (Math.abs(b - g) < Math.abs(a - g) ? b : a));
  if (step === 0) return 'שמירה על משקל';
  return `\u200e${step > 0 ? '+' : '-'}${GOAL_GLYPH[Math.abs(step)]}\u200e ק״ג`;
}

// The profile rows of the settings page (height, weekly goal, calorie goal); "לא הוגדר" for whatever the profile lacks.
// The elements are plain text targets: nothing here is markup.
export function updateSettingsProfileSub() {
  const NOT_SET = 'לא הוגדר';
  const p = state.userProfile;
  const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
  const height = p ? +p.height : 0;
  set('settings-height', height > 0 ? `${height} ס״מ` : NOT_SET);
  set('settings-goalkg', p && p.goalKg != null ? formatWeeklyGoal(p.goalKg) : NOT_SET);
  const rec = calcRecommendedCal();
  set('settings-profile-sub', rec > 0 ? `${formatNumber(rec)} קק״ל` : NOT_SET);
}
