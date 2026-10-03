import { state } from '../state.js';
import { apiFetch } from '../api.js';
import { _cameraCapyState, scheduleCameraHappy } from '../pet.js';
import { navigate } from '../router.js';
import { nowTimeStr } from '../dates.js';
import { analysisMessageFor } from '../errors.js';
import { blobFromBase64 } from '../photos.js';

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

// The camera page back to its empty state (after a save): no photo, no text.
export function resetCamera() {
  state.capturedImageBase64 = null;
  state.photoBlob = null;
  byId('screen-camera').classList.remove('has-photo');
  byId('preview-img').removeAttribute('src');
  byId('analyze-btn').disabled = true;
  byId('file-input').value = '';
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
  const reader = new FileReader();
  reader.onload = ev => {
    const img = new Image();
    img.onload = () => {
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

export async function analyzeText() {
  const text = document.getElementById('food-text-input').value.trim();
  if (!text) return;
  const btn = document.getElementById('text-analyze-btn');
  btn.disabled = true;
  state.photoBlob = null;   // this meal comes from the text, so no thumbnail is made even if a photo was chosen before
  navigate('analysis');
  _cameraCapyState('thinking');
  document.getElementById('analysis-img').style.display = 'none';
  document.getElementById('analysis-loading').style.display = 'block';
  document.getElementById('analysis-result').style.display = 'none';
  document.getElementById('analysis-error').textContent = '';
  try {
    const data = await apiFetch('/api/analyze-text', { method: 'POST', body: JSON.stringify({ text }) });
    _cameraCapyState('ecstatic');
    scheduleCameraHappy();
    const resName = document.getElementById('res-name');
    resName.value = data.foodName || '';
    requestAnimationFrame(() => autoResizeTextarea(resName));
    document.getElementById('res-cal').value = (+data.calories || 0).toFixed(1);
    document.getElementById('res-pro').value = (+data.protein_g || 0).toFixed(1);
    document.getElementById('res-carb').value = (+data.carbs_g || 0).toFixed(1);
    document.getElementById('res-fat').value = (+data.fat_g || 0).toFixed(1);
    document.getElementById('res-fiber').value = (+data.fiber_g || 0).toFixed(1);

    document.getElementById('analysis-loading').style.display = 'none';
    const hhmm = nowTimeStr();
    const rtEl = document.getElementById('receipt-time');
    if (rtEl) rtEl.textContent = hhmm;
    const timeInput = document.getElementById('res-time');
    if (timeInput) timeInput.value = hhmm;
    // Re-trigger stagger animation by forcing reflow
    const rb = document.getElementById('receipt-body');
    if (rb) { rb.querySelectorAll('.receipt-entry').forEach(r => { r.style.animation = 'none'; r.offsetHeight; r.style.animation = ''; }); }
    document.getElementById('analysis-result').style.display = 'block';
  } catch (e) {
    _cameraCapyState('sad');
    document.getElementById('analysis-loading').style.display = 'none';
    document.getElementById('analysis-error').textContent = analysisMessageFor(e);
  }
  btn.disabled = false;
}

export async function analyzeFood() {
  if (!state.capturedImageBase64) return;
  state.photoBlob = blobFromBase64(state.capturedImageBase64, state.capturedMime);   // the saved meal's thumbnail is made from it
  navigate('analysis');
  _cameraCapyState('thinking');
  document.getElementById('analysis-img').src = `data:${state.capturedMime};base64,${state.capturedImageBase64}`;
  document.getElementById('analysis-img').style.display = 'block';
  document.getElementById('analysis-loading').style.display = 'block';
  document.getElementById('analysis-result').style.display = 'none';
  document.getElementById('analysis-error').textContent = '';

  try {
    const data = await apiFetch('/api/analyze', {
      method: 'POST',
      body: JSON.stringify({ imageBase64: state.capturedImageBase64, mimeType: state.capturedMime })
    });
    const resName = document.getElementById('res-name');
    resName.value = data.foodName || '';
    autoResizeTextarea(resName);
    document.getElementById('res-cal').value = (+data.calories || 0).toFixed(1);
    document.getElementById('res-pro').value = (+data.protein_g || 0).toFixed(1);
    document.getElementById('res-carb').value = (+data.carbs_g || 0).toFixed(1);
    document.getElementById('res-fat').value = (+data.fat_g || 0).toFixed(1);
    document.getElementById('res-fiber').value = (+data.fiber_g || 0).toFixed(1);

    document.getElementById('analysis-loading').style.display = 'none';
    const hhmm = nowTimeStr();
    const rtEl = document.getElementById('receipt-time');
    if (rtEl) rtEl.textContent = hhmm;
    const timeInput = document.getElementById('res-time');
    if (timeInput) timeInput.value = hhmm;
    // Re-trigger stagger animation by forcing reflow
    const rb = document.getElementById('receipt-body');
    if (rb) { rb.querySelectorAll('.receipt-entry').forEach(r => { r.style.animation = 'none'; r.offsetHeight; r.style.animation = ''; }); }
    _cameraCapyState('ecstatic');
    scheduleCameraHappy();
    document.getElementById('analysis-result').style.display = 'block';
  } catch (e) {
    _cameraCapyState('sad');
    document.getElementById('analysis-loading').style.display = 'none';
    document.getElementById('analysis-error').textContent = analysisMessageFor(e);
  }
}

export const actions = {
  pickImage: () => document.getElementById('file-input').click(),
  analyzeFood: () => analyzeFood(),
  analyzeText: () => analyzeText(),
  selectCameraMeal: (el) => selectCameraMeal(el),
  onImageSelected: (el, event) => onImageSelected(event),
};
