import { state } from '../state.js';
import { apiFetch } from '../api.js';
import { todayStr } from '../dates.js';
import { html, setHtml } from '../dom.js';
import { animateCountUp, startFireCanvas, stopFireCanvas } from '../effects.js';
import { getFoodEmoji } from '../format.js';
import { PET_MESSAGES, cloneCapybara, getIdleWrap, getPetState, setIdleWrap, setPetState, startIdleAnimations } from '../pet.js';
import { calcRecommendedCal } from '../profile.js';
import { getUsername } from '../session.js';

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

export function animateDashStagger() {
  var els = document.querySelectorAll('.dash-stagger');
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  els.forEach(function(el) { el.classList.remove('anim-visible'); });
  var delays = [0, 150, 300, 450];
  els.forEach(function(el, i) {
    if (reduced) { el.classList.add('anim-visible'); return; }
    setTimeout(function() { el.classList.add('anim-visible'); }, delays[i] || 0);
  });
}

// Dashboard

export async function loadDashboard() {
  let entries = [], cal = 0, goal = 0;

  try {
    entries = await apiFetch(`/api/food?date=${todayStr()}`);
    const { cal: c, pro, carb, fat, fiber } = entries.reduce(
      (s, e) => ({
        cal:   s.cal   + (+e.calories  || 0),
        pro:   s.pro   + (+e.protein_g || 0),
        carb:  s.carb  + (+e.carbs_g   || 0),
        fat:   s.fat   + (+e.fat_g     || 0),
        fiber: s.fiber + (+e.fiber_g   || 0),
      }),
      { cal: 0, pro: 0, carb: 0, fat: 0, fiber: 0 }
    );
    cal = c;
    goal = calcRecommendedCal(state.userProfile);
    const calEl  = document.getElementById('dash-cal-remaining');
    const sepEl  = document.getElementById('dash-cal-sep');
    const goalEl = document.getElementById('dash-cal-goal-label');
    const pctEl  = document.getElementById('dash-cal-pct');
    if (cal === 0 && goal === 0) {
      calEl.textContent = '—';
    } else if (cal === 0) {
      calEl.textContent = '0';
    } else {
      animateCountUp(calEl, cal);
    }
    if (goal > 0) {
      goalEl.textContent = goal.toLocaleString('he-IL');
      goalEl.style.display = '';
      sepEl.style.display  = '';
      const pct = Math.round((cal / goal) * 100);
      pctEl.textContent    = pct + '%';
      pctEl.style.display  = '';
    } else {
      goalEl.style.display = 'none';
      sepEl.style.display  = 'none';
      pctEl.style.display  = 'none';
    }
  } catch {}

  try {
    const { streak, lastLogDate } = await apiFetch('/api/streak');
    const numEl = document.getElementById('dash-streak-num');
    if (numEl) numEl.textContent = streak ?? '—';
    // the label under the number: "1 יום ברצף", not "1 ימים ברצף"
    const lblEl = document.querySelector('.dash-streak-lbl');
    if (lblEl) lblEl.textContent = streak === 1 ? 'יום ברצף' : 'ימים ברצף';
    if (streak >= 1) startFireCanvas();
    else stopFireCanvas();

    // Pet state — use Israel timezone to match server streak calculation
    const toIsraelDate = d => d.toLocaleString('sv', { timeZone: 'Asia/Jerusalem' }).slice(0, 10);
    const today = toIsraelDate(new Date());
    const yesterday = toIsraelDate(new Date(Date.now() - 86400000));
    const hasLoggedToday = entries && entries.length > 0;
    const hasLoggedYesterday = lastLogDate === yesterday;
    const daysSinceLastLog = lastLogDate
      ? Math.round((new Date(today) - new Date(lastLogDate)) / 86400000)
      : 999;

    const petState = getPetState(cal / (goal || 2000), hasLoggedToday, hasLoggedYesterday, daysSinceLastLog);
    const wrapEl = document.getElementById('pet-dashboard-wrap');
    if (wrapEl && !wrapEl.querySelector('svg')) {
      wrapEl.appendChild(cloneCapybara(80));
      setIdleWrap('dash', wrapEl.querySelector('.pet-wrap'));
    }
    if (getIdleWrap('dash')) startIdleAnimations(getIdleWrap('dash'));
    const petWrap = wrapEl?.querySelector('.pet-wrap');
    if (petWrap) setPetState(petWrap, petState);

    const petUsername = getUsername() || '';
    document.getElementById('pet-name-label').textContent = petUsername;
    document.getElementById('pet-status-text').textContent = PET_MESSAGES[petState](petUsername);

  } catch {}
}
