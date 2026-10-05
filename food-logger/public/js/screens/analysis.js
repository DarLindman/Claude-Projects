import { state } from '../state.js';
import { apiFetch } from '../api.js';
import { nowTimeStr, todayStr } from '../dates.js';
import { showToast } from '../dom.js';
import { spawnConfetti } from '../effects.js';
import { cloneCapybara, setPetState } from '../pet.js';
import { navigate } from '../router.js';
import { messageFor } from '../errors.js';
import { makeThumbnail, uploadThumbnail } from '../photos.js';
import { getUsername } from '../session.js';
import { currentToken, editTotals } from './analysisView.js';
import { resetCamera } from './camera.js';

// The thumbnail of a saved photo meal, made and sent in the background. It never rejects and never shows anything: a
// meal without its thumbnail is complete (the diary draws the plate), so a failure here is silent by design.
async function saveThumbnail(foodId, photo) {
  try {
    const thumb = await makeThumbnail(photo);
    if (thumb) await uploadThumbnail(foodId, thumb);
  } catch { /* the meal is saved; the thumbnail is a nicety */ }
}

export function selectMeal(btn) {
  document.querySelectorAll('.meal-opt').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  state.selectedMeal = btn.dataset.meal;
}

export async function saveEntry() {
  const saveBtn = document.getElementById('save-entry-btn');
  if (saveBtn.disabled) return;
  saveBtn.disabled = true;
  saveBtn.textContent = 'שומר...';
  const body = {
    meal_type: state.selectedMeal,
    food_name: document.getElementById('res-name').value.trim() || 'מנה ללא שם',
    calories: +document.getElementById('res-cal').value || 0,
    protein_g: +document.getElementById('res-pro').value || 0,
    carbs_g: +document.getElementById('res-carb').value || 0,
    fat_g: +document.getElementById('res-fat').value || 0,
    fiber_g: +document.getElementById('res-fiber').value || 0,
    logged_at: todayStr() + 'T' + (document.getElementById('res-time')?.value || nowTimeStr()) + ':00',
  };
  try {
    const saved = await apiFetch('/api/food', { method: 'POST', body: JSON.stringify(body) });
    // a meal that came from a photo also gets its thumbnail; the diary opens after it settles (bounded below), so it shows it
    const photo = state.photoBlob;
    const thumbnail = photo && saved?.id ? saveThumbnail(saved.id, photo) : Promise.resolve();
    // the button stays disabled until the diary opens (a second click during the celebration would save the meal twice);
    // a new analysis enables it again (camera.js), and so does the timer below
    saveBtn.textContent = 'שמור ביומן';
    state.diaryDate = todayStr();
    // Fly-in celebration popup
    const savePopup = document.getElementById('capy-save-popup');
    const savePetSlot = document.getElementById('capy-save-pet');
    if (savePopup && savePetSlot) {
      if (!savePetSlot.querySelector('svg')) {
        const w = cloneCapybara(80); setPetState(w, 'ecstatic'); savePetSlot.appendChild(w);
      }
      const pw = savePetSlot.querySelector('.pet-wrap');
      if (pw) setPetState(pw, 'ecstatic');
      savePopup.classList.add('visible');
      // Bounce after spring lands (~650ms)
      setTimeout(() => {
        if (pw) { pw.style.animation = 'none'; void pw.offsetWidth; pw.style.animation = 'pet-tap 0.4s var(--ease-spring) 2'; }
      }, 650);
      setTimeout(() => savePopup.classList.remove('visible'), 2400);
    }
    spawnConfetti();
    // the celebration runs 2.7 s; the diary opens after it, and after the thumbnail when that is not slower than 1.5 s more
    // The diary opens only if the user is still on this page and still signed in (they may have left or signed out meanwhile).
    // ...and only if no newer analysis has been started meanwhile (it would be abandoned by the navigation)
    const analysis = currentToken();
    setTimeout(() => Promise.race([thumbnail, new Promise(r => setTimeout(r, 1500))]).then(() => {
      saveBtn.disabled = false;
      if (state.currentScreen === 'analysis' && currentToken() === analysis && getUsername()) navigate('home');
    }), 2700);
    showToast('✅ נשמר ביומן!');
    resetCamera();
  } catch (e) {
    showToast('שגיאה בשמירה: ' + messageFor(e));
    saveBtn.disabled = false;
    saveBtn.textContent = 'שמור ביומן';
  }
}

export const actions = {
  selectMeal: (el) => selectMeal(el),
  saveEntry: () => saveEntry(),
  editTotals: () => editTotals(),
};
