'use strict';

// Task 13: the weight screen as a diary page. The big newest weight in the digit font with "ק״ג · יעד N", the line graph on
// squared paper (points as circles, the last one red, the goal as a dashed line), the add row (#weight-val, "הוסף שקילה"),
// the entries list (newest first, date and value) and the capybara walking along the bottom (mounted on enter, stopped on leave).
// Entries are seeded through the API the way the real client sends them (wall-clock dates from the local calendar).

const { test, expect } = require('@playwright/test');
const { attachGuards, expectNoGuardEvents, SIGNED_OUT_ME, localNow } = require('./helpers');

const PASSWORD = 'weight-pass-1234';
const CSRF = { Origin: 'http://localhost:3100', 'X-FL-Client': '1' };
const MONTHS_SHORT = ['ינו׳', 'פבר׳', 'מרץ', 'אפר׳', 'מאי', 'יוני', 'יולי', 'אוג׳', 'ספט׳', 'אוק׳', 'נוב׳', 'דצמ׳'];

const post = (page, url, data) => page.request.post(url, { headers: CSRF, data });
const put = (page, url, data) => page.request.put(url, { headers: CSRF, data });
const uniqueName = () => `wt${Date.now()}${Math.floor(Math.random() * 1000)}`;

// A calendar day `back` days before the local today, built with local getters only (like the app).
function dayBack(back) {
  const [y, m, day] = localNow().date.split('-').map(Number);
  const d = new Date(y, m - 1, day - back);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

async function register(page, username = uniqueName()) {
  const reg = await post(page, '/auth/register', { username, password: PASSWORD });
  expect(reg.status(), await reg.text()).toBe(200);
  const prof = await put(page, '/api/profile', { gender: 'male', birthDate: '1990-05-15', height: 175, weight: 70, activity: 'light', goalKg: 0 });
  expect(prof.status()).toBe(200);
  return username;
}

// Oldest first: weights[0] is `weights.length - 1` days ago, the last one is today.
async function seed(page, weights) {
  for (const [i, kg] of weights.entries()) {
    const res = await post(page, '/api/weight', { weight_kg: kg, logged_at: dayBack(weights.length - 1 - i) });
    expect(res.status(), await res.text()).toBe(200);
  }
}

// The profile has no weight goal field on the server yet (it strips unknown keys); the screen reads `goalWeight` from the
// profile the client holds, so the tests hand it one through the profile response.
async function withGoalWeight(page, goalWeight) {
  await page.route('**/api/profile', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const res = await route.fetch();
    const body = await res.json();
    await route.fulfill({ response: res, json: { ...body, goalWeight } });
  });
}

async function openWeight(page) {
  await page.goto('/');
  await expect(page.locator('#screen-dashboard')).toBeVisible();
  await page.locator('#nav-weight').click();
  await expect(page.locator('#screen-weight')).toBeVisible();
  await expect(page.locator('#weight-chart svg')).toBeVisible();
}

// Everything the graph drew, in svg units and in client pixels.
function chartInfo(page) {
  return page.evaluate(() => {
    const svg = document.querySelector('#weight-chart svg');
    const vb = svg.viewBox.baseVal;
    const attrs = [];
    for (const el of [svg, ...svg.querySelectorAll('*')]) for (const a of el.attributes) attrs.push({ tag: el.tagName, name: a.name, value: a.value });
    const pts = [...svg.querySelectorAll('circle')].map((c) => ({
      cx: +c.getAttribute('cx'), cy: +c.getAttribute('cy'), r: +c.getAttribute('r'), fill: getComputedStyle(c).fill, last: c.classList.contains('last'),
    }));
    const goal = svg.querySelector('.goal-line');
    const line = svg.querySelector('polyline');
    return {
      vb: { w: vb.width, h: vb.height },
      attrs, pts,
      goalY: goal ? +goal.getAttribute('y1') : null,
      goalY2: goal ? +goal.getAttribute('y2') : null,
      polyline: line ? line.getAttribute('points') : null,
      grid: svg.querySelectorAll('.wgrid').length,
      markup: svg.outerHTML,
    };
  });
}

// No NaN anywhere, and every numeric attribute is a finite number.
function expectCleanSvg(info, label) {
  expect(info.markup, `${label}: markup`).not.toMatch(/NaN|Infinity|undefined|null/);
  const numeric = /^(cx|cy|r|x|y|x1|x2|y1|y2|width|height|stroke-width)$/;
  let seen = 0;
  for (const a of info.attrs) {
    if (numeric.test(a.name)) { expect(Number.isFinite(+a.value), `${label}: ${a.tag} ${a.name}="${a.value}"`).toBe(true); seen += 1; }
    if (a.name === 'points' || a.name === 'd') expect(a.value, `${label}: ${a.name}`).not.toMatch(/NaN|Infinity/);
  }
  expect(seen, `${label}: numeric attributes were checked`).toBeGreaterThanOrEqual(1);
}

const RED = 'rgb(179, 49, 29)';
const CREAM = 'rgb(245, 236, 217)';

// ── 1. Adding a weight ───────────────────────────────────────────────────────────────────────
test('adding a weight shows it first in the list, in the digit family, with a short date; two on the same day: the newer first', async ({ page }) => {
  const guards = attachGuards(page);
  await register(page);
  await seed(page, [74.1, 73.6]);
  await openWeight(page);
  const rows = page.locator('#weight-list .weight-entry');
  await expect(rows).toHaveCount(2);
  // newest first: 73.6 (today), then 74.1 (yesterday)
  await expect(rows.nth(0)).toContainText('73.6');
  await expect(rows.nth(1)).toContainText('74.1');

  await page.locator('#weight-val').fill('72.4');
  await page.locator('#screen-weight').getByRole('button', { name: 'הוסף שקילה', exact: true }).click();
  await expect(rows).toHaveCount(3);
  await expect(rows.first().locator('.weight-val-big')).toHaveText('72.4');
  await expect(page.locator('#weight-val')).toHaveValue('');
  // the old ones follow
  await expect(rows.nth(1)).toContainText('73.6');
  await expect(rows.nth(2)).toContainText('74.1');

  // the date is "<day> ב<short month>" of today (the add row's date defaults to today), in the digit family
  const [y, m, d] = localNow().date.split('-').map(Number);
  await expect(rows.first().locator('.weight-entry-date')).toHaveText(`${d} ב${MONTHS_SHORT[m - 1]}`);
  const fonts = await page.evaluate(() => {
    const first = (el) => getComputedStyle(el).fontFamily.split(',')[0].trim().replace(/^["']|["']$/g, '');
    return {
      value: first(document.querySelector('#weight-list .weight-entry .weight-val-big')),
      date: first(document.querySelector('#weight-list .weight-entry .weight-entry-date')),
      big: first(document.querySelector('#screen-weight .wt-big')),
      input: first(document.getElementById('weight-val')),
    };
  });
  expect(fonts).toEqual({ value: 'Digits', date: 'Digits', big: 'Digits', input: 'Digits' });
  await expect(page.locator('#screen-weight .wt-big')).toHaveText('72.4');

  // a second weight on the same day goes above the first one (the newer first, whatever order the server returns)
  await page.locator('#weight-val').fill('72.0');
  await page.locator('#screen-weight').getByRole('button', { name: 'הוסף שקילה', exact: true }).click();
  await expect(rows).toHaveCount(4);
  await expect(rows.first().locator('.weight-val-big')).toHaveText('72.0');
  await expect(rows.nth(1).locator('.weight-val-big')).toHaveText('72.4');
  await expect(page.locator('#screen-weight .wt-big')).toHaveText('72.0');

  // the graph drew all four points, the red one is the newest
  const info = await chartInfo(page);
  expect(info.pts).toHaveLength(4);
  expect(info.pts.filter((p) => p.fill === RED)).toHaveLength(1);
  expectNoGuardEvents(guards, [SIGNED_OUT_ME]);
});

test('an invalid weight shows the error and adds nothing; a deleted weight leaves the list and the graph', async ({ page }) => {
  const guards = attachGuards(page);
  await register(page);
  await seed(page, [80, 79.5]);
  await openWeight(page);
  const rows = page.locator('#weight-list .weight-entry');
  await page.locator('#weight-val').fill('0');
  await page.locator('#screen-weight').getByRole('button', { name: 'הוסף שקילה', exact: true }).click();
  await expect(page.locator('#weight-add-error')).toHaveText('הזן משקל תקין');
  await expect(rows).toHaveCount(2);

  await rows.filter({ hasText: '80.0' }).getByRole('button', { name: 'מחק' }).click();
  await expect(rows).toHaveCount(1);
  expect((await chartInfo(page)).pts).toHaveLength(1);
  await expect(page.locator('#screen-weight .wt-big')).toHaveText('79.5');
  expectNoGuardEvents(guards, [SIGNED_OUT_ME]);
});

// ── 2. The graph with 0, 1 and 30 points ───────────────────────────────────────────────────
for (const [count, label] of [[0, 'no entries'], [1, 'one entry'], [30, '30 entries']]) {
  test(`the graph renders with ${label}: squared paper, no NaN, the last point red`, async ({ page }) => {
    const guards = attachGuards(page);
    await register(page);
    // 30 weights that wander, so the line has ups and downs
    await seed(page, Array.from({ length: count }, (_, i) => Math.round((82 - i * 0.2 + Math.sin(i) * 1.5) * 10) / 10));
    await openWeight(page);
    const info = await chartInfo(page);
    expectCleanSvg(info, label);
    expect(info.grid, 'the squared paper').toBe(1);
    expect(info.pts).toHaveLength(count);
    expect(info.polyline !== null, 'a line needs two points').toBe(count >= 2);
    for (const p of info.pts) {
      expect(p.cx).toBeGreaterThanOrEqual(0); expect(p.cx).toBeLessThanOrEqual(info.vb.w);
      expect(p.cy).toBeGreaterThanOrEqual(0); expect(p.cy).toBeLessThanOrEqual(info.vb.h);
    }
    if (count > 0) {
      // the last point is the red one and the rightmost; every other point is the cream one
      const last = info.pts[info.pts.length - 1];
      expect(last.fill).toBe(RED);
      expect(last.last).toBe(true);
      expect(Math.max(...info.pts.map((p) => p.cx))).toBe(last.cx);
      for (const p of info.pts.slice(0, -1)) { expect(p.fill).toBe(CREAM); expect(p.last).toBe(false); }
      await expect(page.locator('#weight-list .weight-entry')).toHaveCount(count);
      await expect(page.locator('#screen-weight .wt-head')).toBeVisible();
    } else {
      // an empty list: the empty text, no big number, the paper still there
      await expect(page.locator('#weight-list .weight-entry')).toHaveCount(0);
      await expect(page.locator('#weight-list')).toContainText('אין מדידות עדיין');
      await expect(page.locator('#screen-weight .wt-head')).toBeHidden();
    }
    const text = await page.locator('#screen-weight').innerText();
    expect(text).not.toMatch(/NaN|undefined|null|Infinity|\[object/);
    expectNoGuardEvents(guards, [SIGNED_OUT_ME]);
  });
}

// ── 3. The renderer on its own: arbitrary weights and goals ───────────────────────────────────
async function renderWeightChartIn(page, cases) {
  await page.goto('/');
  return page.evaluate(async (cases) => {
    const { renderWeightChart } = await import('/js/charts.js');
    const { setHtml } = await import('/js/dom.js');
    document.getElementById('t-chart')?.remove();
    const host = document.createElement('div');
    host.id = 't-chart';
    host.style.cssText = 'position:fixed;left:0;top:0;width:300px;z-index:99';
    document.body.appendChild(host);
    const out = [];
    for (const c of cases) {
      setHtml(host, renderWeightChart(c.values, { goal: c.goal }));
      const svg = host.querySelector('svg');
      const goal = svg.querySelector('.goal-line');
      out.push({
        values: c.values, goal: c.goal,
        pts: [...svg.querySelectorAll('circle')].map((p) => ({ cx: +p.getAttribute('cx'), cy: +p.getAttribute('cy'), fill: getComputedStyle(p).fill })),
        goalY: goal ? +goal.getAttribute('y1') : null,
        goalDash: goal ? goal.getAttribute('stroke-dasharray') : null,
        poly: svg.querySelector('polyline')?.getAttribute('points') ?? null,
        markup: svg.outerHTML,
        h: svg.viewBox.baseVal.height, w: svg.viewBox.baseVal.width,
      });
    }
    return out;
  }, cases);
}

function lcg(seed) { let s = seed; return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; }; }

test('arbitrary weights and goals: the colour rule, the order of the points, the goal line inside the paper, never NaN', async ({ page }) => {
  const cases = [];
  for (const [seed, n] of [[1, 2], [2, 3], [3, 7], [4, 17], [5, 30], [6, 45], [7, 60]]) {
    const rnd = lcg(seed);
    const values = Array.from({ length: n }, () => Math.round((20 + rnd() * 480) * 10) / 10);
    const lo = Math.min(...values), hi = Math.max(...values);
    for (const goal of [0, hi + 25, lo - 5 > 0 ? lo - 5 : 0, lo, hi, (lo + hi) / 2]) cases.push({ values, goal });
  }
  // the special shapes
  cases.push({ values: [70, 70, 70, 70], goal: 0 }, { values: [70, 70, 70, 70], goal: 70 }, { values: [70, 70, 70], goal: 90 }, { values: [70, 70, 70], goal: 60 });
  cases.push({ values: [100.5], goal: 0 }, { values: [100.5], goal: 100.5 }, { values: [100.5], goal: 10000 }, { values: [500, 20], goal: 0 }, { values: [70.0, 70.1, 70.0], goal: 70.05 });
  const results = await renderWeightChartIn(page, cases);
  expect(results).toHaveLength(cases.length);

  for (const r of results) {
    const label = `${r.values.length} values [${Math.min(...r.values)}..${Math.max(...r.values)}] goal ${r.goal}`;
    expect(r.markup, label).not.toMatch(/NaN|Infinity|undefined|null/);
    // up to 60 points are all drawn; the last one is red and the others cream
    expect(r.pts, label).toHaveLength(r.values.length);
    expect(r.pts[r.pts.length - 1].fill, label).toBe(RED);
    for (const p of r.pts.slice(0, -1)) expect(p.fill, label).toBe(CREAM);
    for (const p of r.pts) {
      expect(Number.isFinite(p.cx) && Number.isFinite(p.cy), label).toBe(true);
      expect(p.cx).toBeGreaterThan(0); expect(p.cx).toBeLessThan(r.w);
      expect(p.cy).toBeGreaterThan(0); expect(p.cy).toBeLessThan(r.h);
    }
    // time runs left to right
    for (let i = 1; i < r.pts.length; i++) expect(r.pts[i].cx, label).toBeGreaterThan(r.pts[i - 1].cx);
    // heavier is higher on the paper (smaller y); equal weights are at the same height
    for (let i = 0; i < r.values.length; i++) {
      for (let j = i + 1; j < r.values.length; j++) {
        if (r.values[i] > r.values[j]) expect(r.pts[i].cy, `${label}: ${r.values[i]} above ${r.values[j]}`).toBeLessThan(r.pts[j].cy);
        if (r.values[i] === r.values[j]) expect(r.pts[i].cy, label).toBe(r.pts[j].cy);
      }
    }
    // the goal: none -> no line; else one dashed line inside the paper, placed by the same scale as the points
    if (!(r.goal > 0)) {
      expect(r.goalY, label).toBeNull();
    } else {
      expect(r.goalY, label).not.toBeNull();
      expect(r.goalDash, label).toBeTruthy();
      expect(r.goalY).toBeGreaterThan(0); expect(r.goalY).toBeLessThan(r.h);
      r.values.forEach((v, i) => {
        if (v > r.goal) expect(r.pts[i].cy, `${label}: ${v} above the goal`).toBeLessThan(r.goalY);
        if (v < r.goal) expect(r.pts[i].cy, `${label}: ${v} below the goal`).toBeGreaterThan(r.goalY);
        if (v === r.goal) expect(r.pts[i].cy, `${label}: ${v} on the goal`).toBeCloseTo(r.goalY, 5);
      });
    }
    expect(r.poly !== null, label).toBe(r.values.length >= 2);
    if (r.poly) expect(r.poly.trim().split(/\s+/)).toHaveLength(r.values.length);
  }
  // non-vacuous: the cases covered both signs of "goal vs values"
  expect(results.some((r) => r.goal > 0 && r.values.every((v) => v < r.goal))).toBe(true);
  expect(results.some((r) => r.goal > 0 && r.values.every((v) => v > r.goal))).toBe(true);
  expect(results.some((r) => r.goal > 0 && r.values.every((v) => v === r.goal))).toBe(true);
  expect(results.some((r) => r.values.every((v) => v === r.values[0]) && r.values.length > 1)).toBe(true);
});

test('a long history (120 entries) draws the line through all of it and a circle only for the newest', async ({ page }) => {
  const values = Array.from({ length: 120 }, (_, i) => 90 - i * 0.1);
  const [r] = await renderWeightChartIn(page, [{ values, goal: 75 }]);
  expect(r.pts).toHaveLength(1);
  expect(r.pts[0].fill).toBe(RED);
  expect(r.poly.trim().split(/\s+/)).toHaveLength(120);
  expect(r.markup).not.toMatch(/NaN|Infinity/);
});

// ── 4. The head: the big weight and the goal ────────────────────────────────────────────────
test('the head shows the newest weight big with "ק״ג · יעד N" when the profile has a goal weight, and "ק״ג" alone when it has none', async ({ page }) => {
  const guards = attachGuards(page);
  await register(page);
  await seed(page, [74, 72.4]);
  await withGoalWeight(page, 70);
  await openWeight(page);
  await expect(page.locator('#screen-weight .wt-big')).toHaveText('72.4');
  await expect(page.locator('#screen-weight .wt-unit')).toHaveText('ק״ג · יעד 70');
  const info = await chartInfo(page);
  expect(info.goalY, 'the dashed goal line').not.toBeNull();
  expectCleanSvg(info, 'with goal');
  expectNoGuardEvents(guards, [SIGNED_OUT_ME]);

  // without a goal weight: no goal text, no goal line
  await page.unroute('**/api/profile');
  await page.goto('/');
  await expect(page.locator('#screen-dashboard')).toBeVisible();
  await page.locator('#nav-weight').click();
  await expect(page.locator('#screen-weight .wt-big')).toHaveText('72.4');
  await expect(page.locator('#screen-weight .wt-unit')).toHaveText('ק״ג');
  const none = await chartInfo(page);
  expect(none.goalY).toBeNull();
  expectCleanSvg(none, 'no goal');
});

test('a user without a profile at all: no goal line, no NaN, the weights still show', async ({ page }) => {
  const guards = attachGuards(page);
  const reg = await post(page, '/auth/register', { username: uniqueName(), password: PASSWORD });
  expect(reg.status()).toBe(200);
  await seed(page, [88.8, 88.1, 87.9]);
  await openWeight(page);
  const info = await chartInfo(page);
  expect(info.goalY).toBeNull();
  expect(info.pts).toHaveLength(3);
  expectCleanSvg(info, 'no profile');
  await expect(page.locator('#screen-weight .wt-big')).toHaveText('87.9');
  expect(await page.locator('#screen-weight').innerText()).not.toMatch(/NaN|undefined|null|Infinity/);
  expectNoGuardEvents(guards, [SIGNED_OUT_ME]);
});

// ── 5. Nothing overflows ────────────────────────────────────────────────────────────────────
for (const [width, height] of [[390, 844], [320, 640]]) {
  test(`at ${width} px a weight of 100.5 and a goal of 10,000 stay inside the page; the add row and the last entry are reachable`, async ({ page }) => {
    const guards = attachGuards(page);
    await page.setViewportSize({ width, height });
    await register(page);
    await seed(page, [101.4, 101.0, 100.9, 100.7, 100.6, 100.9, 100.5, 101.2, 100.8, 100.5]);
    await withGoalWeight(page, 10000);
    await openWeight(page);
    await expect(page.locator('#weight-list .weight-entry')).toHaveCount(10);
    await expect(page.locator('#screen-weight .wt-big')).toHaveText('100.5');
    await expect(page.locator('#screen-weight .wt-unit')).toHaveText('ק״ג · יעד 10,000');

    const m = await page.evaluate(() => {
      const doc = document.documentElement;
      const pageEl = document.querySelector('#screen-weight .page');
      const content = pageEl.querySelector('.content');
      const margin = pageEl.querySelector('.margin').getBoundingClientRect();
      const pr = pageEl.getBoundingClientRect();
      const inside = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.left >= pr.left - 1 && r.right <= margin.left + 2; };
      const names = (list) => list.filter((e) => !inside(e)).map((e) => `${e.tagName}.${e.className}`);
      const rows = [...document.querySelectorAll('#weight-list .weight-entry')];
      const head = [...document.querySelectorAll('#screen-weight .wt-head > *')];
      const form = [...document.querySelectorAll('#screen-weight .wt-add input, #screen-weight .wt-add button')];
      return {
        docOverflow: doc.scrollWidth - doc.clientWidth,
        contentOverflow: content.scrollWidth - content.clientWidth,
        outsideRows: names(rows.flatMap((r) => [r, ...r.querySelectorAll('*')])),
        outsideHead: names(head),
        outsideForm: names(form),
        chartInside: inside(document.querySelector('#weight-chart svg')),
        counts: { rows: rows.length, head: head.length, form: form.length },
      };
    });
    expect(m.counts).toEqual({ rows: 10, head: 2, form: 3 });
    expect(m.docOverflow).toBeLessThanOrEqual(0);
    expect(m.contentOverflow).toBeLessThanOrEqual(0);
    expect(m.outsideRows).toEqual([]);
    expect(m.outsideHead).toEqual([]);
    expect(m.outsideForm).toEqual([]);
    expect(m.chartInside).toBe(true);

    // the head's two parts do not overlap (they may wrap onto two lines)
    const parts = await page.locator('#screen-weight .wt-head > *').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom }; }));
    const overlap = parts[0].l < parts[1].r && parts[1].l < parts[0].r && parts[0].t < parts[1].b && parts[1].t < parts[0].b;
    expect(overlap, 'big weight vs unit').toBe(false);

    // scroll to the end: the last entry ends above the walking lane, which ends above the dock
    await page.locator('#screen-weight .content').evaluate((c) => { c.scrollTop = c.scrollHeight; });
    const gap = await page.evaluate(() => {
      const last = [...document.querySelectorAll('#weight-list .weight-entry')].pop().getBoundingClientRect();
      const lane = document.querySelector('#screen-weight .walker').getBoundingClientRect();
      const content = document.querySelector('#screen-weight .content').getBoundingClientRect();
      return { lastToLane: lane.top - last.bottom, contentToLane: lane.top - content.bottom };
    });
    expect(gap.lastToLane, 'last entry vs walker').toBeGreaterThanOrEqual(-1);
    expect(gap.contentToLane, 'content vs walker').toBeGreaterThanOrEqual(-1);

    // the add row can be reached: scroll to it, fill it, press the button
    await page.locator('#weight-val').scrollIntoViewIfNeeded();
    await page.locator('#weight-val').fill('99.5');
    await page.locator('#screen-weight').getByRole('button', { name: 'הוסף שקילה', exact: true }).click();
    await expect(page.locator('#weight-list .weight-entry')).toHaveCount(11);
    await expect(page.locator('#weight-list .weight-entry').first()).toContainText('99.5');
    expectNoGuardEvents(guards, [SIGNED_OUT_ME]);
  });
}

// ── 6. The walking capybara ─────────────────────────────────────────────────────────────────
test('the walker is mounted on entering, never stacked, and gone after leaving', async ({ page }) => {
  const guards = attachGuards(page);
  await register(page);
  await seed(page, [70, 69.5]);
  await page.goto('/');
  await expect(page.locator('#screen-dashboard')).toBeVisible();
  const all = () => page.locator('.walker').count();
  expect(await all(), 'no walker before the screen is entered').toBe(0);

  for (let round = 0; round < 3; round++) {
    await page.locator('#nav-weight').click();
    await expect(page.locator('#screen-weight')).toBeVisible();
    await expect(page.locator('#screen-weight .page > .walker')).toHaveCount(1);
    expect(await all(), `round ${round}: one walker in the whole document`).toBe(1);
    const sizes = await page.evaluate(() => {
      const lane = document.querySelector('#screen-weight .walker').getBoundingClientRect();
      const pr = document.querySelector('#screen-weight .page').getBoundingClientRect();
      const svg = document.querySelector('#screen-weight .walker svg').getBoundingClientRect();
      return { laneInsidePage: lane.left >= pr.left - 1 && lane.right <= pr.right + 1 && lane.bottom <= pr.bottom + 1, svgW: svg.width, svgH: svg.height };
    });
    expect(sizes.laneInsidePage).toBe(true);
    expect(sizes.svgW).toBeGreaterThan(40);
    // leave: to the diary, to the stats (which has its own walker), to the dashboard
    await page.locator('#nav-home').click();
    await expect(page.locator('#screen-home')).toBeVisible();
    expect(await all(), `round ${round}: no walker left after leaving`).toBe(0);
  }
  await page.locator('#nav-weight').click();
  await page.locator('#nav-stats').click();
  await expect(page.locator('#screen-stats')).toBeVisible();
  await expect(page.locator('#screen-weight .walker')).toHaveCount(0);
  expect(await all(), 'only the stats walker').toBe(1);
  await page.locator('#nav-dashboard').click();
  expect(await all()).toBe(0);
  expectNoGuardEvents(guards, [SIGNED_OUT_ME]);
});

// ── 7. Signing out ──────────────────────────────────────────────────────────────────────────
test('signing out clears the weights; the next user never sees them, even when loading theirs fails', async ({ page }) => {
  const guards = attachGuards(page);
  const userB = uniqueName();
  await register(page, userB);                       // B exists first; the cookie then moves to A
  const userA = await register(page);
  await seed(page, [91.1, 90.9, 90.7]);
  await openWeight(page);
  await expect(page.locator('#weight-list .weight-entry')).toHaveCount(3);
  expect(await page.evaluate(async () => (await import('/js/state.js')).state.weightLogs.length)).toBe(3);

  await page.evaluate(async () => { await (await import('/js/session.js')).doLogout(); });
  await expect(page.locator('#screen-auth')).toBeVisible();
  expect(await page.evaluate(async () => (await import('/js/state.js')).state.weightLogs), 'state after logout').toEqual([]);

  // B signs in on the same page while loading the weights fails: nothing of A may show
  await page.route('**/api/weight', (route) => (route.request().method() === 'GET' ? route.abort() : route.continue()));
  await page.locator('#auth-step1 .tab-btn', { hasText: 'כניסה' }).click();
  await page.locator('#login-user').fill(userB);
  await page.locator('#login-pass').fill(PASSWORD);
  await page.locator('#auth-login').getByRole('button', { name: 'כניסה' }).click();
  await expect(page.locator('#screen-dashboard')).toBeVisible();
  expect(await page.evaluate(async () => (await import('/js/state.js')).state.weightLogs), 'state of B').toEqual([]);
  await page.locator('#nav-weight').click();
  await expect(page.locator('#screen-weight')).toBeVisible();
  await expect(page.locator('#weight-list .weight-entry')).toHaveCount(0);
  await expect(page.locator('#screen-weight .wt-head')).toBeHidden();
  expect((await chartInfo(page)).pts, 'no points of A in the graph').toHaveLength(0);
  expect(await page.locator('#screen-weight').innerText()).not.toMatch(/9[01]\.\d/);
  expect(userA).not.toBe(userB);
  // the failed load is the only noise
  expectNoGuardEvents(guards, [SIGNED_OUT_ME, /api\/weight|net::ERR_FAILED|Failed to load resource/]);
});
