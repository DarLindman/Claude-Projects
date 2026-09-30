import { navigate } from '../router.js';
import { switchAuthTab } from './auth.js';

export function goToAuth(tab = 'register') {
  navigate('auth');
  switchAuthTab(tab);
}
