import { navigate } from '../router.js';
import { switchAuthTab } from './auth.js';

export function goToAuth(tab = 'register') {
  navigate('auth');
  switchAuthTab(tab);
}

export const actions = {
  goToAuth: (el) => goToAuth(el.dataset.arg),
};
