// The streak of the home page as a strip of seven small hand-drawn circles, one for each of the last seven days: the oldest at the
// left, today at the right (like the time axis of the stats charts). A day of the current streak is a filled red-pen circle, any
// other day an empty graphite outline, and today carries a larger ink ring whether it is filled or not. Pure (no DOM, no clock, no
// randomness: the wobble of every circle is a function of its position), numbers only: the markup holds no text.
import { html } from './dom.js';

const PITCH = 36;      // distance between two circle centres
const VIEW_H = 34;
const R = 10;          // radius of a day's circle
const RING = 13.5;     // radius of today's ring
const K = 0.5523;      // a quarter of a circle as a cubic curve

// A repeatable value in -1..1 for (circle, slot).
function wobble(i, slot) {
  const x = Math.sin((i + 1) * 12.9898 + (slot + 1) * 78.233) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}
const n1 = (v) => Math.round(v * 10) / 10;

// A circle drawn by hand: four curves whose radii and starting point drift a little, the end overshooting the start.
function circlePath(cx, cy, r, i, salt) {
  const start = wobble(i, salt) * 0.5;
  const pts = [0, 1, 2, 3, 4].map((k) => {
    const a = start + (k * Math.PI) / 2;
    const rr = r * (1 + 0.07 * wobble(i, salt + 1 + k)) + (k === 4 ? 0.9 : 0);   // the closing point lands a little outside the start
    return { x: cx + rr * Math.cos(a), y: cy + rr * Math.sin(a), tx: -Math.sin(a), ty: Math.cos(a), r: rr };
  });
  let d = `M${n1(pts[0].x)} ${n1(pts[0].y)}`;
  for (let k = 0; k < 4; k++) {
    const p = pts[k], q = pts[k + 1];
    d += ` C${n1(p.x + p.tx * K * p.r)} ${n1(p.y + p.ty * K * p.r)} ${n1(q.x - q.tx * K * q.r)} ${n1(q.y - q.ty * K * q.r)} ${n1(q.x)} ${n1(q.y)}`;
  }
  return d;
}

// days: seven { day: 'YYYY-MM-DD', filled: boolean, today: boolean }, oldest first.
export function daysStripSvg(days) {
  const w = PITCH * days.length;
  const cy = VIEW_H / 2;
  const items = days.map((d, i) => {
    const cx = PITCH * i + PITCH / 2;
    const ring = d.today ? html`<path class="day-ring" d="${circlePath(cx, cy, RING, i, 40)}"/>` : '';
    return html`<g class="day${d.filled ? ' filled' : ''}${d.today ? ' today' : ''}" data-day="${d.day}" data-filled="${d.filled ? 'true' : 'false'}" data-today="${d.today ? 'true' : 'false'}"><path class="day-dot" d="${circlePath(cx, cy, R, i, 0)}"/>${ring}</g>`;
  });
  return html`<svg class="days" viewBox="0 0 ${w} ${VIEW_H}" xmlns="http://www.w3.org/2000/svg">${items}</svg>`;
}
