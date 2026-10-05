import { state } from '../state.js';
import { apiFetch } from '../api.js';
import { addDays, daysBetween, formatDateTitle, formatDayCount, todayStr } from '../dates.js';
import { html, setHtml } from '../dom.js';
import { animateCountUp } from '../effects.js';
import { formatNumber } from '../format.js';
import { PET_MESSAGES, cloneCapybara, getIdleWrap, getPetState, setIdleWrap, setPetState, startIdleAnimations } from '../pet.js';
import { plateSvg } from '../placeholder.js';
import { photoSrc } from '../photos.js';
import { calcRecommendedCal } from '../profile.js';
import { getUsername } from '../session.js';
import { daysStripSvg } from '../streakDays.js';

const PET_SIZE = 132;
const FIRST_MEAL_PROMPT = 'לחץ על + כדי להוסיף את הארוחה הראשונה';

const byId = (id) => document.getElementById(id);

// The meal list of a day is ordered oldest first, so the last entry is the latest meal.
// Left: the name in handwriting and the circled calories; right: the polaroid (the thumbnail when the meal has one,
// else the drawn plate) with the time under it.
function lastMealHtml(entry) {
  const time = entry.logged_at ? String(entry.logged_at).slice(11, 16) : '';
  const picture = entry.has_photo
    ? html`<img class="ph-img" data-photo src="${photoSrc(entry.id)}" alt="">`
    : plateSvg();
  return html`<div class="polaroid dash-polaroid"><i class="tape"></i><div class="ph">${picture}</div><div class="cp">${time}</div></div>
    <div class="dash-meal hand">
      <div class="dash-meal-name">${entry.food_name || ''}</div>
      <span class="circ">${formatNumber(+entry.calories)}</span>
      <div class="dash-kcal">קק״ל</div>
    </div>`;
}

function renderLastMeal(entries) {
  const el = byId('dash-last');
  if (!el) return;
  const entry = entries && entries.length ? entries[entries.length - 1] : null;
  if (!entry) { el.hidden = true; el.replaceChildren(); return; }
  setHtml(el, lastMealHtml(entry));
  el.hidden = false;
}

// The weight line shows the newest logged weight (the list is loaded at sign-in and kept fresh by the weight screen); no weights, no line.
function renderWeight() {
  const el = byId('dash-weight');
  if (!el) return;
  const last = state.weightLogs.length ? state.weightLogs[state.weightLogs.length - 1] : null;
  const kg = last ? +last.weight_kg : 0;
  if (!(kg > 0)) { el.hidden = true; return; }
  byId('dash-weight-val').textContent = kg.toFixed(1);
  el.hidden = false;
}

// The streak: the caption "ברצף כבר N ימים" (only for a streak of at least one day) and, under it, a strip of seven circles for the
// last seven days, today at the right. The filled ones are the days of the current streak: `streak` consecutive days ending at
// `lastLogDate` (which the server makes today or yesterday), and today also when a meal of today is on the page. A user who never
// logged a meal (`lastLogDate` null and nothing today) gets neither, so the first-meal prompt stands alone. Days are the browser's
// local calendar days (todayStr, addDays), never UTC.
export function streakDays(today, streak, lastLogDate, hasToday) {
  const filled = new Set();
  if (streak >= 1 && lastLogDate) for (let i = 0; i < streak; i++) filled.add(addDays(lastLogDate, -i));
  if (hasToday) filled.add(today);
  return Array.from({ length: 7 }, (_, i) => {
    const day = addDays(today, i - 6);
    return { day, filled: filled.has(day), today: day === today };
  });
}

function renderStreak(streak, lastLogDate, hasToday) {
  const box = byId('dash-streak');
  if (!box) return;
  const hasHistory = lastLogDate !== null && lastLogDate !== undefined || hasToday;
  if (!hasHistory) { box.hidden = true; byId('dash-days').replaceChildren(); return; }
  const line = byId('dash-streak-line');
  if (streak >= 1) { byId('dash-streak-num').textContent = formatDayCount(streak); line.hidden = false; } else line.hidden = true;
  setHtml(byId('dash-days'), daysStripSvg(streakDays(todayStr(), streak, lastLogDate, hasToday)));
  box.hidden = false;
}

// The red bar: the share of the goal eaten, never wider than its track.
function renderBar(cal, goal) {
  const bar = byId('dash-bar');
  const fill = byId('dash-cal-fill');
  if (!bar || !fill) return;
  if (!(goal > 0)) { bar.hidden = true; fill.style.width = '0%'; return; }
  const pct = Math.max(0, Math.min(100, Math.round((cal / goal) * 100)));
  bar.hidden = false;
  bar.setAttribute('aria-valuenow', String(pct));
  // set after a frame so the width animates from 0 when the screen opens
  requestAnimationFrame(() => { fill.style.width = pct + '%'; });
}

// Leaving the screen empties what is user data, so the next visit (or the next user) never shows stale content.
export function resetDashboard() {
  byId('screen-dashboard')?.classList.remove('is-fresh');
  const last = byId('dash-last');
  if (last) { last.hidden = true; last.replaceChildren(); }
  const streak = byId('dash-streak');
  if (streak) streak.hidden = true;
  const days = byId('dash-days');
  if (days) days.replaceChildren();
  const weight = byId('dash-weight');
  if (weight) weight.hidden = true;
  const fill = byId('dash-cal-fill');
  if (fill) fill.style.width = '0%';
}

// Dashboard

export async function loadDashboard() {
  let entries = [], cal = 0, goal = 0;

  byId('dash-date').textContent = formatDateTitle(todayStr());
  renderWeight();

  try {
    entries = await apiFetch(`/api/food?date=${todayStr()}`);
    cal = entries.reduce((sum, e) => sum + (+e.calories || 0), 0);
    goal = calcRecommendedCal(state.userProfile);
    const calEl  = byId('dash-cal-remaining');
    const sepEl  = byId('dash-cal-sep');
    const goalEl = byId('dash-cal-goal-label');
    if (cal === 0 && goal === 0) {
      calEl.textContent = '—';
    } else if (cal === 0) {
      calEl.textContent = '0';
    } else {
      animateCountUp(calEl, Math.round(cal));
    }
    if (goal > 0) {
      goalEl.textContent = goal.toLocaleString('he-IL');
      sepEl.hidden = false;
    } else {
      sepEl.hidden = true;
    }
    renderBar(cal, goal);
    renderLastMeal(entries);
  } catch {}

  try {
    const { streak, lastLogDate } = await apiFetch(`/api/streak?today=${todayStr()}`);
    const hasLoggedTodayEarly = !!(entries && entries.length);
    renderStreak(streak, lastLogDate, hasLoggedTodayEarly);

    // Pet state: the same local "today" the server was given for the streak
    const today = todayStr();
    const yesterday = addDays(today, -1);
    const hasLoggedToday = entries && entries.length > 0;
    const hasLoggedYesterday = lastLogDate === yesterday;
    const daysSinceLastLog = lastLogDate
      ? daysBetween(lastLogDate, today)
      : 999;

    const petState = getPetState(cal / (goal || 2000), hasLoggedToday, hasLoggedYesterday, daysSinceLastLog);
    const wrapEl = byId('pet-dashboard-wrap');
    if (wrapEl && !wrapEl.querySelector('svg')) {
      wrapEl.appendChild(cloneCapybara(PET_SIZE));
      setIdleWrap('dash', wrapEl.querySelector('.pet-wrap'));
    }
    if (getIdleWrap('dash')) startIdleAnimations(getIdleWrap('dash'));
    const petWrap = wrapEl?.querySelector('.pet-wrap');
    if (petWrap) setPetState(petWrap, petState);

    const petUsername = getUsername() || '';
    byId('pet-name-label').textContent = petUsername;
    // A user with no meal at all (no entry today and the streak endpoint knows no day up to today) gets a gentle first-meal
    // prompt in the sleeping capybara's bubble instead of "how long since I saw you"; the first meal replaces it by itself.
    const neverLogged = lastLogDate === null && !hasLoggedToday;
    byId('pet-status-text').textContent = neverLogged ? FIRST_MEAL_PROMPT : PET_MESSAGES[petState](petUsername);
    byId('screen-dashboard').classList.toggle('is-fresh', neverLogged);

  } catch {}
}
