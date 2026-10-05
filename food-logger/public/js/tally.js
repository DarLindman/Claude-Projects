// The streak as a hand-written tally: four vertical strokes crossed by a fifth, then the
// remainder. Pure (no DOM, no randomness): the small per-stroke wobble comes from a hash of
// the stroke's index, so the same count always draws the same marks. Every stroke is drawn
// twice, a bold pass and a faint offset one, like pen pressure. The `wobS` filter lives in
// the hidden SVG of index.html. Returns a Trusted fragment (see dom.js).
import { raw } from './dom.js';

const MAX_STROKES = 25;
const GROUP_PITCH = 74;
const VIEW_H = 40;
const INK = '#25304f';

// Deterministic value in [-1, 1] from a stroke index and a slot number.
function jitter(index, slot) {
  let h = (Math.imul(index + 1, 374761393) + Math.imul(slot + 1, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return ((h >>> 0) / 4294967295) * 2 - 1;
}

const n1 = (v) => String(Math.round(v * 10) / 10);

// A near-vertical stroke at x, slightly curved and never quite straight.
function vertical(x, i) {
  const j = (slot, amp) => jitter(i, slot) * amp;
  return `M${n1(x + j(0, 1))} ${n1(5.5 + j(1, 1.2))} C${n1(x + 0.8 + j(2, 1.2))} ${n1(14 + j(3, 2))} ${n1(x - 0.8 + j(4, 1.2))} ${n1(25 + j(5, 2))} ${n1(x + j(6, 1))} ${n1(35.5 + j(7, 1.2))}`;
}

// The slanted stroke through a group of four.
function diagonal(gx, i) {
  const j = (slot, amp) => jitter(i, slot) * amp;
  return `M${n1(gx + 2 + j(0, 1))} ${n1(30 + j(1, 1.5))} C${n1(gx + 16 + j(2, 1.5))} ${n1(24 + j(3, 1.5))} ${n1(gx + 42 + j(4, 1.5))} ${n1(14 + j(5, 1.5))} ${n1(gx + 64 + j(6, 1))} ${n1(7 + j(7, 1.5))}`;
}

export function tallySvg(count, { width } = {}) {
  if (typeof count !== 'number' || !Number.isFinite(count)) return raw('');
  const n = Math.min(MAX_STROKES, Math.floor(count));
  if (n < 1) return raw('');

  const groups = Math.floor(n / 5);
  const rest = n % 5;
  const units = groups + (rest ? 1 : 0);
  const lastX = rest ? 10 + 16 * (rest - 1) + 8 : 68;
  const viewW = GROUP_PITCH * (units - 1) + lastX;

  const strokes = []; // [d, isDiagonal]
  let i = 0;
  for (let g = 0; g < groups; g++) {
    const gx = GROUP_PITCH * g;
    for (let k = 0; k < 4; k++) strokes.push([vertical(gx + 10 + 15 * k, i++), false]);
    strokes.push([diagonal(gx, i++), true]);
  }
  for (let k = 0; k < rest; k++) strokes.push([vertical(GROUP_PITCH * groups + 10 + 16 * k, i++), false]);

  // 1 unit = 1 px; `width` is a maximum, so the marks keep one size and only shrink to fit a narrow column.
  const w = typeof width === 'number' && Number.isFinite(width) && width > 0 ? Math.min(width, viewW) : viewW;
  const h = Math.round(((w * VIEW_H) / viewW) * 10) / 10;

  const primary = strokes
    .map(([d, diag]) => `<path class="tally-stroke${diag ? ' tally-diag' : ''}" d="${d}"/>`)
    .join('');
  const faint = strokes.map(([d]) => `<path class="tally-ghost" d="${d}"/>`).join('');

  return raw(
    `<svg class="tally" viewBox="0 0 ${viewW} ${VIEW_H}" width="${n1(w)}" height="${n1(h)}" fill="none" stroke="${INK}" stroke-linecap="round" filter="url(#wobS)" aria-hidden="true" focusable="false">` +
    `<g stroke-width="2.7">${primary}</g>` +
    `<g stroke-width="1.5" opacity=".5" transform="translate(.7,.5)">${faint}</g>` +
    '</svg>'
  );
}
