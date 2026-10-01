// ── Idle animation refs ──────────────────────────────────────────────────────
const _idleWraps = { dash: null, diary: null, camera: null };
export function setIdleWrap(name, wrap) { _idleWraps[name] = wrap; }
export function getIdleWrap(name) { return _idleWraps[name]; }
export function stopAllIdleAnimations() {
  stopIdleAnimations(_idleWraps.dash);
  stopIdleAnimations(_idleWraps.diary);
  stopIdleAnimations(_idleWraps.camera);
}
let _cameraHappyTimer = null;
export function clearCameraHappyTimer() { clearTimeout(_cameraHappyTimer); }
export function scheduleCameraHappy() {
  clearTimeout(_cameraHappyTimer);
  _cameraHappyTimer = setTimeout(() => _cameraCapyState('happy'), 2000);
}

export function startIdleAnimations(petWrap) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  stopIdleAnimations(petWrap);
  const intervals = [];
  // Tail wag: random 5–8s
  intervals.push(setInterval(() => {
    petWrap.classList.add('pet-wagging');
    setTimeout(() => petWrap.classList.remove('pet-wagging'), 600);
  }, 5000 + Math.random() * 3000));
  // Ear twitch: random 8–12s
  intervals.push(setInterval(() => {
    petWrap.classList.add('pet-ear-twitching');
    setTimeout(() => petWrap.classList.remove('pet-ear-twitching'), 150);
  }, 8000 + Math.random() * 4000));
  petWrap._idleIntervals = intervals;
}

export function stopIdleAnimations(petWrap) {
  if (!petWrap?._idleIntervals) return;
  petWrap._idleIntervals.forEach(clearInterval);
  petWrap._idleIntervals = [];
}

// ── Capybara pet helpers ─────────────────────────
export function _cameraCapyState(state) {
  const wrap = document.getElementById('pet-camera-wrap');
  if (!wrap) return;
  if (!wrap.querySelector('svg')) {
    const pet = cloneCapybara(56);
    wrap.appendChild(pet);
    _idleWraps.camera = pet;
    startIdleAnimations(pet);
  }
  const pet = wrap.querySelector('.pet-wrap');
  if (!pet) return;
  const baseState = state === 'thinking' ? 'neutral' : state;
  setPetState(pet, baseState);
  pet.classList.toggle('pet--thinking', state === 'thinking');
  if (state === 'ecstatic') {
    pet.style.animation = 'none';
    void pet.offsetWidth;
    pet.style.animation = 'pet-tap 0.4s var(--ease-spring) forwards';
    setTimeout(() => {
      pet.style.animation = 'none';
      void pet.offsetWidth;
      pet.style.animation = 'pet-tap 0.4s var(--ease-spring) forwards';
    }, 450);
  }
}

export function cloneCapybara(size) {
  const tpl = document.getElementById('capy-tpl');
  const wrap = document.createElement('div');
  wrap.className = 'pet-wrap';
  const svg = tpl.content.querySelector('svg').cloneNode(true);
  if (size) { svg.setAttribute('width', size); svg.setAttribute('height', Math.round(size * 0.91)); }
  wrap.appendChild(svg);
  wrap.addEventListener('click', () => {
    wrap.classList.remove('tapped');
    void wrap.offsetWidth; // force reflow
    wrap.classList.add('tapped');
    wrap.addEventListener('animationend', () => wrap.classList.remove('tapped'), { once: true });
  });
  return wrap;
}

export function getPetState(pct, hasLoggedToday, hasLoggedYesterday, daysSinceLastLog) {
  if (daysSinceLastLog >= 3) return 'sleeping';
  if (!hasLoggedToday && !hasLoggedYesterday) return 'sad';
  if (!hasLoggedToday) return 'neutral';
  if (pct >= 1.0) return 'ecstatic';
  return 'happy';
}

export const PET_MESSAGES = {
  ecstatic: name => `כל הכבוד, ${name}! הגעת ליעד! 🎉`,
  happy:    name => `יופי, ${name}! ככה ממשיכים 😊`,
  neutral:  name => `עוד לא רשמת היום 😐`,
  sad:      name => `פספסנו אתמול... נתחיל מחדש? 😢`,
  sleeping: name => `כמה זמן לא ראיתי אותך, ${name} 🥺`,
};

export function setPetState(wrapEl, state) {
  ['ecstatic','happy','neutral','sad','sleeping','surprised'].forEach(s =>
    wrapEl.classList.toggle(`pet--${s}`, s === state)
  );
  // brief pop animation on state change
  wrapEl.classList.remove('pet-state-pop');
  void wrapEl.offsetWidth; // force reflow to restart animation
  wrapEl.classList.add('pet-state-pop');
  setTimeout(() => wrapEl.classList.remove('pet-state-pop'), 250);
}
