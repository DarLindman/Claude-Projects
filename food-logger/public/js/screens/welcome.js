import { navigate } from '../router.js';
import { cloneCapybara } from '../pet.js';
import { switchAuthTab } from './auth.js';

// The original capybara in her salad bowl, happy, on the leather cover (the welcome screen has no walker).
export function mountWelcomePet() {
  const slot = document.getElementById('welcome-pet');
  if (!slot || slot.firstChild) return;
  const pet = cloneCapybara(206, { bowl: true });
  pet.classList.add('pet--happy');
  slot.appendChild(pet);
}

export function goToAuth(tab = 'register') {
  navigate('auth');
  switchAuthTab(tab);
}

export const actions = {
  goToAuth: (el) => goToAuth(el.dataset.arg),
};
