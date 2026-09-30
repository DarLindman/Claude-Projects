import { state } from '../state.js';
import { apiFetch } from '../api.js';
import { todayStr } from '../dates.js';
import { showToast } from '../dom.js';
import { spawnConfetti } from '../effects.js';
import { cloneCapybara, setPetState } from '../pet.js';
import { navigate } from '../router.js';
import { messageFor } from '../errors.js';

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
    food_name: document.getElementById('res-name').value.trim() || 'אוכל לא ידוע',
    calories: +document.getElementById('res-cal').value || 0,
    protein_g: +document.getElementById('res-pro').value || 0,
    carbs_g: +document.getElementById('res-carb').value || 0,
    fat_g: +document.getElementById('res-fat').value || 0,
    fiber_g: +document.getElementById('res-fiber').value || 0,
    logged_at: todayStr() + 'T' + (document.getElementById('res-time')?.value || new Date().toTimeString().slice(0, 5)) + ':00',
  };
  try {
    await apiFetch('/api/food', { method: 'POST', body: JSON.stringify(body) });
    saveBtn.disabled = false;
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
      const camWrap = document.getElementById('pet-camera-wrap');
      if (camWrap) camWrap.style.opacity = '0';
      savePopup.classList.add('visible');
      // Bounce after spring lands (~650ms)
      setTimeout(() => {
        if (pw) { pw.style.animation = 'none'; void pw.offsetWidth; pw.style.animation = 'pet-tap 0.4s var(--ease-spring) 2'; }
      }, 650);
      setTimeout(() => savePopup.classList.remove('visible'), 2400);
    }
    spawnConfetti();
    setTimeout(() => navigate('home'), 2700);
    showToast('✅ נשמר ביומן!');
    state.capturedImageBase64 = null;
    document.getElementById('preview-img').style.display = 'none';
    document.querySelector('.cam-placeholder').style.display = '';
    document.getElementById('analyze-btn').disabled = true;
    document.getElementById('file-input').value = '';
    document.getElementById('food-text-input').value = '';
  } catch (e) {
    showToast('שגיאה בשמירה: ' + messageFor(e));
    saveBtn.disabled = false;
    saveBtn.textContent = 'שמור ביומן';
  }
}

export const actions = {
  selectMeal: (el) => selectMeal(el),
  saveEntry: () => saveEntry(),
};
