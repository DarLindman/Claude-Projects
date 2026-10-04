'use strict';

// Owner preview seed (a developer tool, not part of the app). Fills a RUNNING test server with a realistic user so the
// screens can be photographed: a Hebrew username, a profile, about 80 days of meals (some days over the goal), about eight
// meals today (three with drawn food thumbnails, uploaded through the real route), weights over the last eight weeks
// trending down and a current streak of several days.
//
// It talks to the app over HTTP only (the session cookie, the CSRF headers) and never touches a database itself, so the
// server it points at decides which database is filled. Start the e2e server first (it uses the *_test database and the
// fake Anthropic client): `node test/e2e/server.js`. It refuses any base URL that is not on localhost.
//
//   node scripts/seed-preview.js [--base http://localhost:3100] [--user נועה_לוי] [--password preview-pass-1234]
//
// Also exported for scripts that drive the browser: seedPreview(base, opts), registerUser(base, ...).

const { createCanvas } = require('@napi-rs/canvas');

const DEFAULT_BASE = 'http://localhost:3100';
const DEFAULT_USER = 'נועה_לוי';
const DEFAULT_PASSWORD = 'preview-pass-1234';
const HISTORY_DAYS = 80;
const WEIGHT_WEEKS = 8;

// ─── small HTTP client (cookie + CSRF headers) ───────────────────────────────────────────────────────────────────────
function client(base) {
  const url = new URL(base);
  if (!['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error(`seed-preview refuses a non-local server: ${url.hostname}`);
  const origin = url.origin;
  let cookie = '';
  async function call(method, path, body, headers = {}) {
    const res = await fetch(origin + path, {
      method,
      headers: { Origin: origin, 'X-FL-Client': '1', ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body,
    });
    const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; ');
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : null;
  }
  const json = (method, path, data) => call(method, path, JSON.stringify(data), { 'Content-Type': 'application/json' });
  return {
    origin,
    get cookie() { return cookie; },
    post: (p, d) => json('POST', p, d),
    put: (p, d) => json('PUT', p, d),
    putJpeg: (p, buf) => call('PUT', p, buf, { 'Content-Type': 'image/jpeg' }),
  };
}

async function registerUser(base, username, password) {
  const c = client(base);
  await c.post('/auth/register', { username, password });
  return c;
}

// ─── the browser's wall clock, from the Node process's local clock (like test/e2e/helpers.js localNow) ───────────────
const p2 = (n) => String(n).padStart(2, '0');
function dayStr(offsetDays) {
  const d = new Date();
  d.setDate(d.getDate() - offsetDays);   // calendar arithmetic on the local date; the time of day is never used
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}

// ─── deterministic randomness, so every run draws the same preview ────────────────────────────────────────────────────
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

// ─── the meal pool (name, kcal, protein, carbs, fat, fibre) ───────────────────────────────────────────────────────────────────
const POOL = {
  breakfast: [
    ['חביתה משתי ביצים עם סלט ולחם מלא', 420, 24, 28, 22, 5],
    ['יוגורט עם גרנולה ופירות', 310, 14, 46, 8, 4],
    ['טוסט גבינה עם עגבנייה', 380, 18, 36, 17, 3],
    ['קערת שיבולת שועל עם בננה', 340, 11, 58, 7, 7],
    ['אבוקדו על לחם קלוי עם ביצה', 450, 17, 34, 28, 9],
    ['שקשוקה עם פיתה', 480, 22, 40, 25, 6],
  ],
  lunch: [
    ['שניצל עם אורז וסלט ירקות', 640, 38, 62, 24, 5],
    ['חזה עוף בגריל עם בטטה', 520, 44, 46, 14, 6],
    ['פסטה ברוטב עגבניות', 580, 19, 92, 13, 6],
    ['סלט טונה גדול עם חמוצים', 390, 31, 14, 23, 5],
    ['המבורגר בלחמנייה עם צ׳יפס', 820, 36, 78, 40, 5],
    ['אורז עם עדשים וסלט', 540, 20, 88, 10, 11],
    ['פיתה עם חומוס וסלט', 520, 18, 70, 19, 10],
  ],
  dinner: [
    ['סלט ירקות עם גבינה לבנה', 280, 18, 12, 16, 4],
    ['דג סלמון עם ירקות בתנור', 510, 36, 18, 32, 5],
    ['פיצה, שלושה משולשים', 690, 28, 84, 24, 4],
    ['מרק ירקות עם פרוסת לחם', 320, 9, 52, 8, 9],
    ['קציצות בעגבניות עם פירה', 560, 30, 46, 26, 5],
    ['סנדוויץ׳ טונה', 430, 26, 40, 18, 4],
  ],
  snack: [
    ['תפוח וחופן שקדים', 190, 5, 22, 10, 5],
    ['קפה הפוך ועוגיית שוקולד צ׳יפס', 230, 5, 32, 9, 1],
    ['בננה', 105, 1, 27, 0, 3],
    ['חטיף שוקולד', 250, 3, 30, 13, 1],
    ['גבינה לבנה עם מלפפון', 120, 12, 6, 5, 1],
    ['כדור גלידה וניל', 180, 3, 21, 9, 0],
  ],
};
const TIMES = { breakfast: [7, 9], lunch: [12, 14], dinner: [18, 21], snack: [10, 17] };

function pick(r, list) { return list[Math.floor(r() * list.length)]; }
function jitter(r, v, pct = 0.1) { return Math.round(v * (1 + (r() * 2 - 1) * pct)); }
function meal(r, type, hour) {
  const [name, kcal, pro, carb, fat, fib] = pick(r, POOL[type]);
  const f = 1 + (r() * 2 - 1) * 0.1;
  const minute = Math.floor(r() * 60);
  return {
    meal_type: type, food_name: name, calories: Math.round(kcal * f),
    protein_g: Math.round(pro * f * 10) / 10, carbs_g: Math.round(carb * f * 10) / 10,
    fat_g: Math.round(fat * f * 10) / 10, fiber_g: Math.round(fib * f * 10) / 10,
    time: `${p2(hour)}:${p2(minute)}`,
  };
}

// A past day: breakfast, lunch, dinner and zero to two snacks. Some days add a heavy dinner so the day ends over the goal.
function pastDay(r, heavy) {
  const meals = [meal(r, 'breakfast', TIMES.breakfast[0] + Math.floor(r() * 2)), meal(r, 'lunch', TIMES.lunch[0] + Math.floor(r() * 2)),
    meal(r, 'dinner', TIMES.dinner[0] + Math.floor(r() * 3))];
  const snacks = Math.floor(r() * 3);
  for (let i = 0; i < snacks; i++) meals.push(meal(r, 'snack', TIMES.snack[0] + Math.floor(r() * 7)));
  if (heavy) {
    const extra = meal(r, 'dinner', 21);
    extra.food_name = 'פיצה, שלושה משולשים'; extra.calories = jitter(r, 700); extra.protein_g = 26; extra.carbs_g = 82; extra.fat_g = 26; extra.fiber_g = 4;
    meals.push(extra);
  }
  return meals.sort((a, b) => a.time.localeCompare(b.time));
}

// Today: eight meals, three with a thumbnail ('photo' names the drawing). About 1,620 kcal against a goal near 1,710.
const TODAY = [
  { meal_type: 'breakfast', food_name: 'חביתה משתי ביצים עם סלט ולחם מלא', time: '07:40', calories: 380, protein_g: 22, carbs_g: 26, fat_g: 20, fiber_g: 5, photo: 'eggs' },
  { meal_type: 'snack', food_name: 'קפה הפוך', time: '10:15', calories: 90, protein_g: 5, carbs_g: 8, fat_g: 4, fiber_g: 0 },
  { meal_type: 'snack', food_name: 'יוגורט עם פירות', time: '12:05', calories: 130, protein_g: 7, carbs_g: 20, fat_g: 3, fiber_g: 2 },
  { meal_type: 'lunch', food_name: 'חזה עוף בגריל עם אורז וסלט', time: '13:10', calories: 440, protein_g: 38, carbs_g: 44, fat_g: 11, fiber_g: 5, photo: 'chicken' },
  { meal_type: 'snack', food_name: 'תפוח', time: '16:30', calories: 80, protein_g: 0.4, carbs_g: 21, fat_g: 0.3, fiber_g: 4 },
  { meal_type: 'snack', food_name: 'חופן שקדים', time: '17:45', calories: 150, protein_g: 5.5, carbs_g: 5, fat_g: 13, fiber_g: 3 },
  { meal_type: 'snack', food_name: 'תה עם דבש ועוגייה', time: '18:20', calories: 70, protein_g: 1, carbs_g: 14, fat_g: 1.5, fiber_g: 0 },
  { meal_type: 'dinner', food_name: 'סלט ירקות עם טונה וביצה', time: '20:40', calories: 280, protein_g: 24, carbs_g: 11, fat_g: 15, fiber_g: 5, photo: 'salad' },
];
// Yesterday keeps two thumbnails as well, so a "different day" in the diary has photos too.
const YESTERDAY = [
  { meal_type: 'breakfast', food_name: 'שקשוקה עם פיתה', time: '08:05', calories: 480, protein_g: 22, carbs_g: 40, fat_g: 25, fiber_g: 6 },
  { meal_type: 'snack', food_name: 'בננה', time: '11:00', calories: 105, protein_g: 1, carbs_g: 27, fat_g: 0.4, fiber_g: 3 },
  { meal_type: 'lunch', food_name: 'פסטה ברוטב עגבניות', time: '13:25', calories: 580, protein_g: 19, carbs_g: 92, fat_g: 13, fiber_g: 6, photo: 'pasta' },
  { meal_type: 'dinner', food_name: 'סלט ירקות עם גבינה לבנה', time: '19:15', calories: 290, protein_g: 18, carbs_g: 12, fat_g: 16, fiber_g: 4, photo: 'salad' },
  { meal_type: 'snack', food_name: 'חטיף שוקולד', time: '21:10', calories: 250, protein_g: 3, carbs_g: 30, fat_g: 13, fiber_g: 1 },
];

// ─── food thumbnails: a plate on a wooden table, drawn with canvas (480x360 JPEG, well under 120 KB) ─────────────────────────────
const W = 480;
const H = 360;

function blob(ctx, cx, cy, rx, ry, fill, rot = 0, wobble = 0.12, r = Math.random) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rot);
  ctx.beginPath();
  const n = 22;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = 1 + (r() * 2 - 1) * wobble;
    const x = Math.cos(a) * rx * k;
    const y = Math.sin(a) * ry * k;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.restore();
}

function radial(ctx, cx, cy, r0, r1, c0, c1) {
  const g = ctx.createRadialGradient(cx, cy, r0, cx, cy, r1);
  g.addColorStop(0, c0);
  g.addColorStop(1, c1);
  return g;
}

function table(ctx, r) {
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, '#b98a5b'); g.addColorStop(1, '#8e6339');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 4; i++) {   // planks
    ctx.strokeStyle = 'rgba(60,35,15,.35)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, i * 92 + 8); ctx.lineTo(W, i * 92 + 8); ctx.stroke();
  }
  for (let i = 0; i < 260; i++) {   // grain
    ctx.strokeStyle = `rgba(${r() > .5 ? '70,40,15' : '230,190,140'},${0.05 + r() * 0.08})`;
    ctx.lineWidth = 1;
    const y = r() * H; const x = r() * W;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 40 + r() * 120, y + (r() - .5) * 4); ctx.stroke();
  }
}

function plate(ctx, cx, cy, rad) {
  ctx.save();
  ctx.shadowColor = 'rgba(40,20,5,.45)'; ctx.shadowBlur = 22; ctx.shadowOffsetY = 10;
  ctx.fillStyle = '#f6f2ea';
  ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  ctx.fillStyle = radial(ctx, cx - 20, cy - 20, rad * 0.2, rad, '#ffffff', '#e5ded0');
  ctx.beginPath(); ctx.arc(cx, cy, rad - 4, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(160,150,130,.5)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(cx, cy, rad * 0.72, 0, Math.PI * 2); ctx.stroke();
}

function fork(ctx, x, y, rot) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
  ctx.shadowColor = 'rgba(40,20,5,.4)'; ctx.shadowBlur = 6; ctx.shadowOffsetY = 3;
  ctx.fillStyle = '#d7d9dc';
  ctx.fillRect(-4, -10, 8, 130);
  for (let i = -3; i <= 3; i += 2) ctx.fillRect(i * 3 - 1, -50, 3, 44);
  ctx.fillRect(-9, -12, 18, 8);
  ctx.restore();
}

function leaf(ctx, x, y, rot, s, color) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.ellipse(0, 0, s, s * 0.55, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(-s, 0); ctx.lineTo(s, 0); ctx.stroke();
  ctx.restore();
}

function tomatoSlice(ctx, x, y, s) {
  ctx.fillStyle = '#d93a2b'; ctx.beginPath(); ctx.arc(x, y, s, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#f26a52'; ctx.beginPath(); ctx.arc(x, y, s * 0.78, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#ffd7c4';
  for (let a = 0; a < 6; a++) { ctx.beginPath(); ctx.arc(x + Math.cos(a * 1.05) * s * 0.4, y + Math.sin(a * 1.05) * s * 0.4, s * 0.12, 0, Math.PI * 2); ctx.fill(); }
}
function cucumberSlice(ctx, x, y, s) {
  ctx.fillStyle = '#4c8a3a'; ctx.beginPath(); ctx.arc(x, y, s, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#b9dc8e'; ctx.beginPath(); ctx.arc(x, y, s * 0.82, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#e6f3c6'; ctx.beginPath(); ctx.arc(x, y, s * 0.35, 0, Math.PI * 2); ctx.fill();
}

function eggs(ctx, r) {
  plate(ctx, 250, 185, 150);
  // omelette, folded
  blob(ctx, 235, 160, 78, 52, radial(ctx, 225, 150, 5, 90, '#ffe27a', '#f0b83c'), -0.25, 0.07, r);
  blob(ctx, 225, 152, 60, 36, 'rgba(255,244,190,.7)', -0.25, 0.1, r);
  for (let i = 0; i < 14; i++) blob(ctx, 190 + r() * 90, 130 + r() * 60, 4, 3, '#4f9a3a', r() * 3, 0.3, r);   // herbs
  // salad
  for (let i = 0; i < 6; i++) leaf(ctx, 330 + r() * 40, 200 + r() * 40, r() * 3, 26, i % 2 ? '#5aa842' : '#7cc04f');
  tomatoSlice(ctx, 345, 225, 18); tomatoSlice(ctx, 318, 240, 15); cucumberSlice(ctx, 365, 195, 15);
  // bread
  ctx.save(); ctx.translate(195, 255); ctx.rotate(-0.15);
  ctx.fillStyle = '#c98c4a'; ctx.fillRect(-48, -22, 96, 46);
  ctx.fillStyle = '#e8bd84'; ctx.fillRect(-42, -17, 84, 36);
  ctx.restore();
  fork(ctx, 80, 190, 0.1);
}

function chicken(ctx, r) {
  plate(ctx, 245, 185, 158);
  // rice
  blob(ctx, 195, 215, 62, 48, radial(ctx, 190, 205, 5, 70, '#fffdf6', '#ecdfbd'), 0.2, 0.1, r);
  for (let i = 0; i < 90; i++) {
    ctx.fillStyle = r() > .5 ? '#fff' : '#efe3c3';
    ctx.save(); ctx.translate(150 + r() * 90, 180 + r() * 70); ctx.rotate(r() * 3);
    ctx.fillRect(-3, -1, 6, 2.2); ctx.restore();
  }
  // grilled chicken breast, sliced
  for (let i = 0; i < 4; i++) {
    blob(ctx, 270 + i * 18, 150 + i * 6, 40, 24, radial(ctx, 270 + i * 18, 145 + i * 6, 3, 40, '#e0a463', '#a8672b'), -0.5, 0.06, r);
    ctx.strokeStyle = 'rgba(70,35,10,.55)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(250 + i * 18, 140 + i * 6); ctx.lineTo(284 + i * 18, 160 + i * 6); ctx.stroke();
  }
  // salad corner
  for (let i = 0; i < 5; i++) leaf(ctx, 285 + r() * 40, 235 + r() * 30, r() * 3, 24, i % 2 ? '#4f9d3c' : '#78bd4c');
  tomatoSlice(ctx, 330, 238, 15); tomatoSlice(ctx, 300, 258, 13);
  // lemon wedge
  ctx.fillStyle = '#f4d33d'; ctx.beginPath(); ctx.moveTo(175, 120); ctx.quadraticCurveTo(205, 95, 225, 125); ctx.closePath(); ctx.fill();
  fork(ctx, 70, 200, -0.08);
}

function salad(ctx, r) {
  // a deep white bowl seen from above
  ctx.save();
  ctx.shadowColor = 'rgba(40,20,5,.5)'; ctx.shadowBlur = 24; ctx.shadowOffsetY = 12;
  ctx.fillStyle = '#f2eee6'; ctx.beginPath(); ctx.arc(240, 182, 152, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  ctx.fillStyle = radial(ctx, 230, 170, 20, 150, '#ffffff', '#ddd5c4'); ctx.beginPath(); ctx.arc(240, 182, 146, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#e9e2d3'; ctx.beginPath(); ctx.arc(240, 182, 118, 0, Math.PI * 2); ctx.fill();
  // leaves
  for (let i = 0; i < 40; i++) {
    const a = r() * Math.PI * 2; const d = Math.sqrt(r()) * 108;
    leaf(ctx, 240 + Math.cos(a) * d, 182 + Math.sin(a) * d, r() * 3.14, 20 + r() * 12, ['#3f8f3a', '#5cae45', '#86c85a', '#2f7a33'][i % 4]);
  }
  for (let i = 0; i < 7; i++) tomatoSlice(ctx, 190 + r() * 100, 130 + r() * 100, 13 + r() * 4);
  for (let i = 0; i < 5; i++) cucumberSlice(ctx, 190 + r() * 100, 130 + r() * 100, 11 + r() * 3);
  // tuna chunks and a half egg
  for (let i = 0; i < 5; i++) blob(ctx, 205 + r() * 70, 150 + r() * 60, 15, 10, '#d9b48a', r() * 3, 0.2, r);
  ctx.save(); ctx.translate(262, 215);
  ctx.fillStyle = '#fbfaf3'; ctx.beginPath(); ctx.ellipse(0, 0, 30, 22, 0.4, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#f5b82e'; ctx.beginPath(); ctx.arc(0, 0, 11, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  for (let i = 0; i < 10; i++) { ctx.fillStyle = '#7a1f5e'; ctx.beginPath(); ctx.arc(200 + r() * 90, 140 + r() * 90, 3, 0, Math.PI * 2); ctx.fill(); }   // red onion bits
  fork(ctx, 425, 120, 0.25);
}

function pasta(ctx, r) {
  plate(ctx, 245, 185, 158);
  // a nest of pasta with red sauce
  for (let i = 0; i < 70; i++) {
    const a = r() * Math.PI * 2; const d = Math.sqrt(r()) * 82;
    ctx.strokeStyle = i % 3 ? '#e9c25f' : '#d9a93f'; ctx.lineWidth = 7; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(245 + Math.cos(a) * d * 0.5, 190 + Math.sin(a) * d * 0.5, 20 + r() * 30, a, a + 1.4 + r()); ctx.stroke();
  }
  blob(ctx, 245, 175, 52, 34, radial(ctx, 240, 170, 4, 55, '#e3553a', '#b3261a'), 0.2, 0.18, r);
  for (let i = 0; i < 6; i++) leaf(ctx, 225 + r() * 40, 160 + r() * 30, r() * 3, 12, '#2e8b3d');
  ctx.fillStyle = '#f4ebd0';
  for (let i = 0; i < 14; i++) { ctx.beginPath(); ctx.arc(205 + r() * 80, 150 + r() * 60, 2 + r() * 2, 0, Math.PI * 2); ctx.fill(); }   // parmesan
  fork(ctx, 85, 190, 0.12);
}

const DRAWERS = { eggs, chicken, salad, pasta };

function thumbnail(kind, seed = 7) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const r = rng(seed);
  table(ctx, r);
  DRAWERS[kind](ctx, r);
  const v = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, W * 0.65);   // a soft vignette
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(25,10,0,.38)');
  ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
  let buf = canvas.toBuffer('image/jpeg', 80);
  if (buf.length > 110 * 1024) buf = canvas.toBuffer('image/jpeg', 60);
  return buf;
}

// ─── weights ────────────────────────────────────────────────────────────────────────────────────────────────────────────
function weightSeries(r) {
  const out = [];
  const total = WEIGHT_WEEKS * 7;
  for (let d = total; d >= 0; d -= (2 + Math.floor(r() * 2))) {
    const w = 77.6 - 3.4 * ((total - d) / total) + (r() - 0.5) * 0.7;
    out.push({ offset: d, kg: Math.round(w * 10) / 10 });
  }
  if (out[out.length - 1].offset !== 0) out.push({ offset: 0, kg: 74.2 });
  else out[out.length - 1].kg = 74.2;
  return out;
}

// ─── the whole preview user ───────────────────────────────────────────────────────────────────────────────────────────────
async function seedPreview(base = DEFAULT_BASE, { username = DEFAULT_USER, password = DEFAULT_PASSWORD, log = () => {} } = {}) {
  const c = await registerUser(base, username, password);
  await c.put('/api/profile', { gender: 'female', birthDate: '1992-03-14', height: 168, weight: 74.2, activity: 'moderate', goalKg: -0.5, goalWeight: 68.5 });

  const r = rng(20261004);
  const SKIP = new Set([6, 14, 29, 43, 58]);   // days with nothing logged: the streak ends at day 5 (six days with today); day 6 stays empty
  const HEAVY = new Set([2, 9, 11, 17, 21, 24, 33, 38, 45, 52, 60, 66, 71]);   // days that end over the goal
  const jobs = [];
  let photos = 0;
  const post = async (day, m) => {
    const saved = await c.post('/api/food', {
      meal_type: m.meal_type, food_name: m.food_name, calories: m.calories, protein_g: m.protein_g, carbs_g: m.carbs_g,
      fat_g: m.fat_g, fiber_g: m.fiber_g, logged_at: `${day}T${m.time}:00`,
    });
    if (m.photo) { await c.putJpeg(`/api/food/${saved.id}/photo`, thumbnail(m.photo, 100 + photos)); photos++; }
  };
  for (let off = 0; off < HISTORY_DAYS; off++) {
    if (SKIP.has(off)) continue;
    const day = dayStr(off);
    const meals = off === 0 ? TODAY : off === 1 ? YESTERDAY : pastDay(r, HEAVY.has(off));
    for (const m of meals) jobs.push(post(day, m));
    if (jobs.length > 24) await Promise.all(jobs.splice(0));
  }
  await Promise.all(jobs);

  for (const w of weightSeries(r)) await c.post('/api/weight', { weight_kg: w.kg, logged_at: dayStr(w.offset) });
  log(`seeded ${username}: ${HISTORY_DAYS - SKIP.size} days of meals, ${photos} thumbnails`);
  return { username, password, cookie: c.cookie, today: dayStr(0), emptyDay: dayStr(6), yesterday: dayStr(1), photos };
}

module.exports = { seedPreview, registerUser, thumbnail, dayStr, DEFAULT_USER, DEFAULT_PASSWORD };

if (require.main === module) {
  const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : dflt; };
  seedPreview(arg('base', DEFAULT_BASE), { username: arg('user', DEFAULT_USER), password: arg('password', DEFAULT_PASSWORD), log: console.log })
    .then((s) => console.log(`done. today=${s.today}`))
    .catch((e) => { console.error(e.message); process.exit(1); });
}
