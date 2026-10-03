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

// ── Drawing: the original SVG, redrawn in a soft hand-inked style ───────────────
// The shared filter (#capyink), the shading gradients (#g-body, #g-head) and the blur (#softsh) live
// once in a hidden SVG in index.html; the outline CSS is `.pet-inked` in base.css. Everything here is
// applied to a CLONE, never to the template.
const SVG_NS = 'http://www.w3.org/2000/svg';
function mk(name, attrs) {
  const el = document.createElementNS(SVG_NS, name);
  for (const k in attrs) el.setAttribute(k, attrs[k]);
  return el;
}

// Body/head/cheek/shadow geometry in the 110x100 viewBox of the capybara.
const PET_GEOMETRY = { body: [55, 68, 38, 24], head: [25, 26, 60, 46, 18], ch: [32, 43, 78], sh: [55, 96, 40, 4.5] };

// Soft shading over the body and head, faint cheeks and (optionally) the ground shadow.
function soften(svg, g, withShadow) {
  const snout = [...svg.querySelectorAll('rect')].find(r => r.getAttribute('fill') === '#b07d50');
  if (!snout) return;
  const parts = [
    mk('ellipse', { cx: g.body[0], cy: g.body[1], rx: g.body[2], ry: g.body[3], fill: 'url(#g-body)' }),
    mk('rect', { x: g.head[0], y: g.head[1], width: g.head[2], height: g.head[3], rx: g.head[4], fill: 'url(#g-head)' }),
    mk('ellipse', { cx: g.ch[0], cy: g.ch[1], rx: 6.5, ry: 3.6, fill: '#E8703A', opacity: '.16' }),
    mk('ellipse', { cx: g.ch[2], cy: g.ch[1], rx: 6.5, ry: 3.6, fill: '#E8703A', opacity: '.16' }),
  ];
  let ref = snout;
  parts.forEach(n => { ref.after(n); ref = n; });
  if (withShadow) {
    svg.insertBefore(mk('ellipse', { cx: g.sh[0], cy: g.sh[1], rx: g.sh[2], ry: g.sh[3], fill: 'rgba(43,31,22,.26)', filter: 'url(#softsh)' }), svg.firstChild);
  }
}

// The "loaf" legs (reference option B1): the four old leg ellipses are replaced by two large paws with toes.
function loafLegs(svg) {
  const olds = [['28', '90'], ['45', '92'], ['65', '92'], ['82', '90']]
    .map(c => svg.querySelector(`ellipse[cx="${c[0]}"][cy="${c[1]}"]`)).filter(Boolean);
  const ref = svg.querySelector('ellipse[cx="47"][cy="56"]');   // the left nostril: the paws go just before it
  if (olds.length !== 4 || !ref) return;
  const parent = ref.parentNode;
  olds.forEach(e => e.remove());
  const toes = (cx, y, k) => mk('path', {
    d: `M${cx - 3.6 * k} ${y} v${2.3 * k} M${cx} ${y + .3} v${2.6 * k} M${cx + 3.6 * k} ${y} v${2.3 * k}`,
    stroke: '#7a5230', 'stroke-width': '.9', fill: 'none', 'stroke-linecap': 'round', opacity: '.7',
  });
  const [cx, cy, rx, ry, k] = [42.5, 90.4, 10.5, 6, 1.3];
  const cx2 = 55 + (55 - cx);
  [
    mk('ellipse', { cx, cy, rx, ry, fill: '#C4956A' }),
    mk('ellipse', { cx: cx2, cy, rx, ry, fill: '#C4956A' }),
    toes(cx, cy + 0.2, k),
    toes(cx2, cy + 0.2, k),
  ].forEach(n => parent.insertBefore(n, ref));
}

// The salad bowl of the welcome screen, in the original colours; extends the viewBox downwards.
function addBowl(svg) {
  const w = parseFloat(svg.getAttribute('width')) || 80;
  svg.setAttribute('viewBox', '0 -4 110 120');
  svg.setAttribute('height', Math.round(w * 120 / 110));
  const bg = mk('g', {});
  bg.appendChild(mk('ellipse', { cx: 55, cy: 109, rx: 46, ry: 4.5, fill: 'rgba(43,31,22,.28)', filter: 'url(#softsh)' }));
  bg.appendChild(mk('path', { d: 'M13 85 Q13 108 55 108 Q97 108 97 85 Z', fill: '#fffaf0', stroke: '#6b4426', 'stroke-width': '.9', 'stroke-opacity': '.65', 'stroke-linejoin': 'round' }));
  bg.appendChild(mk('ellipse', { cx: 55, cy: 85, rx: 42, ry: 8, fill: '#fffdf6', stroke: '#6b4426', 'stroke-width': '.9', 'stroke-opacity': '.65' }));
  [[24, 95, 5, '#2E7D32'], [35, 99, 4.5, '#EF5350'], [48, 101, 4, '#FFD54F'], [61, 102, 4.5, '#A5D6A7'],
   [74, 100, 4, '#E53935'], [86, 96, 4.5, '#2E7D32'], [92, 91, 3.6, '#A5D6A7'], [30, 89, 3.8, '#FFD54F'],
   [44, 90, 4.2, '#EF5350'], [68, 90, 3.8, '#2E7D32'], [56, 86, 3.8, '#A5D6A7'], [80, 88, 3.4, '#FFD54F'],
  ].forEach(c => bg.appendChild(mk('circle', { cx: c[0], cy: c[1], r: c[2], fill: c[3], stroke: '#4a2f1a', 'stroke-width': '.5', 'stroke-opacity': '.45' })));
  svg.appendChild(bg);
}

// Applies the drawn style to a clone of the capybara SVG (idempotent). opts.bowl adds the salad bowl.
export function decorateCapybara(svg, opts = {}) {
  if (svg.classList.contains('pet-inked')) return svg;
  svg.classList.add('pet-inked');
  const grin = svg.querySelector('.pet-mouth-grin');
  if (grin) grin.setAttribute('d', 'M 41 59.5 Q 55 66 69 59.5');
  svg.appendChild(mk('path', {
    d: 'M22 62 l4 2 M27 76 l4 1.5 M88 62 l-4 2 M83 76 l-4 1.5 M44 83 l2 3 M64 83 l2 3 M44 31 l2 2.5 M56 30 l2 2.5 M66 31 l2 2.5',
    stroke: '#7a5230', 'stroke-width': '1.1', opacity: '.38', fill: 'none', 'stroke-linecap': 'round',
  }));
  loafLegs(svg);
  if (opts.bowl) addBowl(svg);
  soften(svg, PET_GEOMETRY, true);
  return svg;
}

// ── The walking lane ─────────────────────────────────────────────────────────
// Appends a lane inside `pageEl` (a .page): the left wall is the page edge, the right wall the red margin
// line. The travel distance comes from the VISIBLE bounding box of the capybara (getBBox in viewBox units,
// scaled to pixels), not from the SVG box, so the body touches both walls; the direction flips with
// scaleX(-1) at the wall (CSS keyframes walkx/flipx in base.css). Under prefers-reduced-motion the CSS stops
// every animation and she stands at the left wall.
const WALK_LEFT = 2;                  // the lane's left offset in the page, px
const WALK_RIGHT_RESERVED = 49;       // from the page's right edge: the margin line (46 px) + a little air

export function mountWalkingCapybara(pageEl, { state = 'neutral', size = 104, bottom = 4 } = {}) {
  const lane = document.createElement('div');
  lane.className = 'walker';
  lane.style.bottom = `${bottom}px`;
  const x = document.createElement('div');
  x.className = 'walk-x';
  const flip = document.createElement('div');
  flip.className = 'walk-flip';
  const pet = cloneCapybara(size);
  applyPetState(pet, state === 'thinking' ? 'neutral' : state);
  pet.classList.toggle('pet--thinking', state === 'thinking');
  flip.appendChild(pet);
  x.appendChild(flip);
  lane.appendChild(x);
  pageEl.appendChild(lane);

  const svg = pet.querySelector('svg');
  function layout() {
    const laneW = Math.max(0, pageEl.clientWidth - WALK_LEFT - WALK_RIGHT_RESERVED);
    lane.style.width = `${laneW}px`;
    let bb;
    try { bb = svg.getBBox(); } catch { bb = null; }     // a hidden (display: none) page has no geometry
    const vbW = svg.viewBox.baseVal.width || 110;
    const k = (parseFloat(svg.getAttribute('width')) || size) / vbW;
    if (!bb || !bb.width) { x.style.marginLeft = '0px'; x.style.setProperty('--span', '0px'); return; }
    x.style.marginLeft = `${-bb.x * k}px`;
    x.style.setProperty('--span', `${Math.max(0, laneW - bb.width * k)}px`);
  }
  layout();
  window.addEventListener('resize', layout);

  let stopped = false;
  return {
    stop() {
      if (stopped) return;
      stopped = true;
      window.removeEventListener('resize', layout);
      lane.remove();
    },
  };
}

export function cloneCapybara(size, opts) {
  const tpl = document.getElementById('capy-tpl');
  const wrap = document.createElement('div');
  wrap.className = 'pet-wrap';
  const svg = tpl.content.querySelector('svg').cloneNode(true);
  if (size) { svg.setAttribute('width', size); svg.setAttribute('height', Math.round(size * 0.91)); }
  decorateCapybara(svg, opts);
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

function applyPetState(wrapEl, state) {
  ['ecstatic','happy','neutral','sad','sleeping','surprised'].forEach(s =>
    wrapEl.classList.toggle(`pet--${s}`, s === state)
  );
}

export function setPetState(wrapEl, state) {
  applyPetState(wrapEl, state);
  // brief pop animation on state change
  wrapEl.classList.remove('pet-state-pop');
  void wrapEl.offsetWidth; // force reflow to restart animation
  wrapEl.classList.add('pet-state-pop');
  setTimeout(() => wrapEl.classList.remove('pet-state-pop'), 250);
}
