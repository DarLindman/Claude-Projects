// The analysis page (#screen-analysis) in its three states: waiting (the capybara with a magnifier, her bubble and a progress
// bar; the photo as a polaroid for a photo analysis), the result (name, circled calories, the printed receipt, macro rows) and
// the error. camera.js drives it; analysis.js saves from the fields it fills. No timers live here: the progress bar and the
// print-out are CSS animations, so nothing has to be stopped when the page is left (leaveAnalysis only drops the pending
// analysis, so a late reply of an abandoned analysis never paints over the page).
import { state } from '../state.js';
import { nowTimeStr } from '../dates.js';
import { html, setHtml } from '../dom.js';
import { MEAL_LABELS } from '../format.js';
import { cloneCapybara, setPetState } from '../pet.js';
import { receiptHtml } from '../receipt.js';

const byId = (id) => document.getElementById(id);

// The analysis that may still show its result: every new analysis and every leaving of the page moves it on.
let _current = 0;
export const isCurrent = (token) => token === _current;
export const currentToken = () => _current;
export function leaveAnalysis() { _current += 1; }

// 722 -> "722", 38.04 -> "38"; the value of a number input (no trailing ".0" in a circled number).
const num = (v) => String(Math.round((+v || 0) * 10) / 10);

// The circled calories shrink with the length of the value (a CSS var read by .res-cal .circ), so even 1234.6 stays whole.
export function fitCalories() {
  const el = byId('res-cal');
  el.closest('.res-cal').style.setProperty('--len', String(Math.max(2, el.value.length)));
}

function fitName(el) {
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}

// One capybara per slot, made on first use.
function petIn(slotId, size, before) {
  const slot = byId(slotId);
  let wrap = slot.querySelector('.pet-wrap');
  if (!wrap) {
    wrap = cloneCapybara(size);
    slot.insertBefore(wrap, before || null);
  }
  return wrap;
}

function show(id, on) { byId(id).hidden = !on; }

// The waiting state. `photo` is a data: URL for a photo analysis, null for a text one. Returns the token of this analysis.
export function beginWaiting(photo) {
  const token = ++_current;
  show('analysis-result', false);
  show('analysis-fail', false);
  show('analysis-loading', true);
  byId('analysis-error').textContent = '';

  const polaroid = byId('analysis-polaroid');
  const stage = byId('wait-stage');
  stage.append(polaroid);                       // it may be on the result page from the last analysis
  if (photo) {
    byId('analysis-img').src = photo;
    byId('analysis-caption').textContent = MEAL_LABELS[state.selectedMeal] || '';
  }
  polaroid.hidden = !photo;
  stage.hidden = !photo;

  const pet = petIn('wait-pet', 100, byId('wait-pet').firstChild);
  setPetState(pet, 'happy');
  pet.classList.add('pet--thinking');           // the "?" and the head tilt

  const bar = byId('wait-bar');                 // restart the fill
  bar.classList.remove('running');
  void bar.offsetWidth;
  bar.classList.add('running');
  return token;
}

// The result: fills the fields, mounts the receipt (printed with CSS animations) and, for a photo, moves the polaroid next
// to the circled calories.
export function showResult(data, photo) {
  show('analysis-loading', false);
  show('analysis-fail', false);
  byId('analysis-error').textContent = '';
  show('analysis-result', true);

  const name = byId('res-name');
  name.value = data.foodName || '';
  fitName(name);
  byId('res-cal').value = num(data.calories);
  fitCalories();
  byId('res-pro').value = num(data.protein_g);
  byId('res-carb').value = num(data.carbs_g);
  byId('res-fat').value = num(data.fat_g);
  byId('res-fiber').value = num(data.fiber_g);
  const hhmm = nowTimeStr();
  byId('res-time').value = hhmm;

  const polaroid = byId('analysis-polaroid');
  if (photo) {
    byId('res-top').prepend(polaroid);
    byId('analysis-caption').textContent = hhmm;
  }
  polaroid.hidden = !photo;
  byId('res-top').classList.toggle('has-photo', !!photo);

  const mount = byId('receipt-mount');
  setHtml(mount, html`<div class="receipt-lift"><i class="tape"></i>${receiptHtml(data)}<div class="stamp">נרשם</div></div>`);
  mount.querySelector('.receipt-slip').classList.add('receipt-printing');
  mount.querySelector('.stamp').classList.add('stamp-thud');
  document.querySelector('#screen-analysis .content').scrollTop = 0;
}

// The error: a sad capybara and the message (Hebrew, from errors.js).
export function showError(message) {
  show('analysis-loading', false);
  show('analysis-result', false);
  const pet = petIn('fail-pet', 90);
  setPetState(pet, 'sad');
  byId('analysis-error').textContent = message;
  show('analysis-fail', true);
}

// "ערוך": the totals are the fields themselves, so it takes the pen to the calories.
export function editTotals() {
  const cal = byId('res-cal');
  cal.focus();
  cal.select();
}
