import { state } from '../state.js';
import { apiFetch } from '../api.js';
import { navigate } from '../router.js';
import { analysisMessageFor } from '../errors.js';
import { blobFromBase64 } from '../photos.js';
import { beginWaiting, isCurrent, showError, showResult } from './analysisView.js';

const byId = (id) => document.getElementById(id);

let _placeholderIv = null;
export function animatePlaceholder() {
  const ta = document.getElementById('food-text-input');
  if (!ta) return;
  clearInterval(_placeholderIv);
  const full = ta.getAttribute('data-placeholder') || '';
  ta.placeholder = '';
  let i = 0;
  _placeholderIv = setInterval(() => {
    if (i >= full.length) { clearInterval(_placeholderIv); return; }
    ta.placeholder = full.slice(0, ++i);
  }, 15);
}

export function autoResizeTextarea(el) {
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}

// ════════════════════════════════════════════════════
// Meal type: the camera page's chips and the analysis page's buttons show the same choice (state.selectedMeal).
// ════════════════════════════════════════════════════
export function syncMealChips() {
  document.querySelectorAll('#cam-chips .chip').forEach(c => c.classList.toggle('on', c.dataset.meal === state.selectedMeal));
  document.querySelectorAll('#screen-analysis .meal-opt').forEach(b => b.classList.toggle('selected', b.dataset.meal === state.selectedMeal));
  const caption = byId('cam-caption');
  if (caption) caption.textContent = document.querySelector('#cam-chips .chip.on')?.textContent || '';
}

export function selectCameraMeal(chip) {
  state.selectedMeal = chip.dataset.meal;
  syncMealChips();
}

// Only the latest pick may apply: a slower decode of an older pick must not overwrite a newer photo (nor bring back a
// photo that a save or a sign-out has already cleared).
let _pickSeq = 0;

// The photo part of the camera page back to its empty frame.
function clearPhoto() {
  _pickSeq += 1;
  state.capturedImageBase64 = null;
  state.photoBlob = null;
  byId('screen-camera').classList.remove('has-photo');
  byId('preview-img').removeAttribute('src');
  byId('analyze-btn').disabled = true;
  byId('file-input').value = '';
}

// The camera page back to its empty state (after a save or a sign-out): no photo, no text.
export function resetCamera() {
  clearPhoto();
  const text = byId('food-text-input');
  text.value = '';
  autoResizeTextarea(text);
}

export function enterCamera() {
  syncMealChips();
  animatePlaceholder();
}

// ════════════════════════════════════════════════════
// Camera & Analysis
// ════════════════════════════════════════════════════
export function onImageSelected(e) {
  const file = e.target.files[0];
  if (!file) return;
  state.capturedMime = 'image/jpeg';
  const seq = ++_pickSeq;
  // a file that cannot be read or decoded leaves the empty frame, silently (the user just picks again)
  const fail = () => { if (seq === _pickSeq) clearPhoto(); };
  const reader = new FileReader();
  reader.onerror = fail;
  reader.onload = ev => {
    if (seq !== _pickSeq) return;
    const img = new Image();
    img.onerror = fail;
    img.onload = () => {
      if (seq !== _pickSeq) return;
      const canvas = document.createElement('canvas');
      const MAX = 1024;
      let w = img.width, h = img.height;
      if (w > MAX || h > MAX) {
        if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
        else { w = Math.round(w * MAX / h); h = MAX; }
      }
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      const compressed = canvas.toDataURL('image/jpeg', 0.8);
      state.capturedImageBase64 = compressed.split(',')[1];
      byId('preview-img').src = compressed;
      byId('screen-camera').classList.add('has-photo');
      byId('analyze-btn').disabled = false;
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}

// The text button is disabled while a text analysis runs; leaving the analysis page frees it at once (the abandoned reply is ignored).
export function releaseAnalyzeButtons() {
  byId('text-analyze-btn').disabled = false;
}

// One analysis: the waiting page, the request, then the result or the error. A reply that arrives after the user left the page
// (or started another analysis) is dropped (analysisView.js).
async function runAnalysis(url, payload, photo) {
  byId('save-entry-btn').disabled = false;
  navigate('analysis');
  const token = beginWaiting(photo);
  try {
    const data = await apiFetch(url, { method: 'POST', body: JSON.stringify(payload) });
    if (isCurrent(token)) showResult(data, photo);
  } catch (e) {
    if (isCurrent(token)) showError(analysisMessageFor(e));
  }
  return token;
}

export async function analyzeText() {
  const text = document.getElementById('food-text-input').value.trim();
  if (!text) return;
  const btn = document.getElementById('text-analyze-btn');
  btn.disabled = true;
  state.photoBlob = null;   // this meal comes from the text, so no thumbnail is made even if a photo was chosen before
  const token = await runAnalysis('/api/analyze-text', { text }, null);
  // an abandoned analysis must not free the button of a newer one (leaving the page already freed it)
  if (isCurrent(token)) btn.disabled = false;
}

export async function analyzeFood() {
  if (!state.capturedImageBase64) return;
  state.photoBlob = blobFromBase64(state.capturedImageBase64, state.capturedMime);   // the saved meal's thumbnail is made from it
  await runAnalysis('/api/analyze', { imageBase64: state.capturedImageBase64, mimeType: state.capturedMime },
    `data:${state.capturedMime};base64,${state.capturedImageBase64}`);
}

export const actions = {
  pickImage: () => document.getElementById('file-input').click(),
  analyzeFood: () => analyzeFood(),
  analyzeText: () => analyzeText(),
  selectCameraMeal: (el) => selectCameraMeal(el),
  onImageSelected: (el, event) => onImageSelected(event),
};
