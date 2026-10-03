import { state } from '../state.js';
import { apiFetch } from '../api.js';
import { addDays, daysBetween, formatDateTitle, formatDayCount, todayStr } from '../dates.js';
import { html, setHtml } from '../dom.js';
import { animateCountUp } from '../effects.js';
import { formatNumber, getFoodEmoji } from '../format.js';
import { PET_MESSAGES, cloneCapybara, getIdleWrap, getPetState, setIdleWrap, setPetState, startIdleAnimations } from '../pet.js';
import { plateSvg } from '../placeholder.js';
import { photoSrc } from '../photos.js';
import { calcRecommendedCal } from '../profile.js';
import { getUsername } from '../session.js';
import { tallySvg } from '../tally.js';

const PET_SIZE = 132;

// ════════════════════════════════════════════════════
// Dashboard helpers
// ════════════════════════════════════════════════════
export function renderDashLogPreview(entries) {
  const el = document.getElementById('dash-log-preview');
  if (!el) return;
  const last3 = entries.slice(-3).reverse();
  if (!last3.length) { el.replaceChildren(); return; }
  setHtml(el, html`${last3.map(e => {
    const t = e.logged_at ? e.logged_at.slice(11, 16) : '';
    return html`<div class="dash-log-row">
      <div class="dash-log-time-col">
        <div class="dash-log-icon">${getFoodEmoji(e.food_name)}</div>
        <div class="dash-log-time">${t}</div>
      </div>
      <div class="dash-log-name">${e.food_name || ''}</div>
      <div class="dash-log-kcal">${Math.round(e.calories || 0)}</div>
      <div class="dash-log-macros">ח ${Math.round(e.protein_g||0)} · פ ${Math.round(e.carbs_g||0)} · ש ${Math.round(e.fat_g||0)}</div>
    </div>`;
  })}`);
}

const byId = (id) => document.getElementById(id);

// The meal list of a day is ordered oldest first, so the last entry is the latest meal.
// Left: the name in handwriting and the circled calories; right: the polaroid (the thumbnail when the meal has one,
// else the drawn plate) with the time under it.
function lastMealHtml(entry) {
  const time = entry.logged_at ? String(entry.logged_at).slice(11, 16) : '';
  const picture = entry.has_photo
    ? html`<img class="ph-img" src="${photoSrc(entry.id)}" alt="">`
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

// The weight line shows only when a weight was logged today (registration logs one; the weight screen keeps the list fresh).
function renderWeight() {
  const el = byId('dash-weight');
  if (!el) return;
  const last = state.weightLogs.length ? state.weightLogs[state.weightLogs.length - 1] : null;
  const kg = last ? +last.weight_kg : 0;
  if (!last || last.logged_at !== todayStr() || !(kg > 0)) { el.hidden = true; return; }
  byId('dash-weight-val').textContent = kg.toFixed(1);
  el.hidden = false;
}

// A streak of 0 draws nothing: no line, no tally.
function renderStreak(streak) {
  const box = byId('dash-streak');
  if (!box) return;
  if (!(streak >= 1)) { box.hidden = true; byId('dash-tally').replaceChildren(); return; }
  byId('dash-streak-num').textContent = formatDayCount(streak);
  setHtml(byId('dash-tally'), tallySvg(streak, { width: 288 }));
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
  const last = byId('dash-last');
  if (last) { last.hidden = true; last.replaceChildren(); }
  const streak = byId('dash-streak');
  if (streak) streak.hidden = true;
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
    renderStreak(streak);

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
    byId('pet-status-text').textContent = PET_MESSAGES[petState](petUsername);

  } catch {}
}
