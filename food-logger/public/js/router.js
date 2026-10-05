import { state } from './state.js';
import { stopAllIdleAnimations } from './pet.js';

export const SCREEN_ORDER = ['welcome','auth','dashboard','home','camera','analysis','stats','weight','settings'];

// name -> { enter, leave }. Map keeps registration order, which is the order hooks run in.
// Hooks are registered from main.js so this module imports no screen module.
const _screens = new Map();

export function registerScreen(name, { enter, leave } = {}) {
  _screens.set(name, { enter, leave });
}

export function navigate(screen) {
  // stop all idle animations unconditionally on every navigation
  stopAllIdleAnimations();

  document.querySelectorAll('.screen').forEach(s =>
    s.classList.remove('active', 'screen-enter-right', 'screen-enter-left')
  );
  const el = document.getElementById(`screen-${screen}`);
  el.classList.add('active');
  const from = SCREEN_ORDER.indexOf(state.currentScreen);
  const to   = SCREEN_ORDER.indexOf(screen);
  if (from !== -1 && to !== -1 && from !== to) {
    el.classList.add(to > from ? 'screen-enter-right' : 'screen-enter-left');
  }
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const navEl = document.getElementById(`nav-${screen}`);
  if (navEl) navEl.classList.add('active');
  state.currentScreen = screen;

  // enter hook for the target screen, leave hook for every other registered screen
  for (const [name, hooks] of _screens) {
    if (name === screen) hooks.enter?.();
    else hooks.leave?.();
  }
}

// Delegated action (see events.js): data-action="navigate" data-arg="<screen>"
export const actions = {
  navigate: (el) => navigate(el.dataset.arg),
};
