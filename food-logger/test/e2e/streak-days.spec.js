'use strict';

// The home page's streak is a strip of seven hand-drawn circles for the last seven days: the oldest at the left, today at the right.
// A day of the current streak is filled, any other day empty, today carries a ring either way. The filled days come from what the
// page already loads (GET /api/streak and today's meals); the days are the browser's local calendar days.

const { test, expect } = require('@playwright/test');
const { attachGuards, expectNoGuardEvents, SIGNED_OUT_ME, localNow } = require('./helpers');

const PASSWORD = 'streak-pass-1234';
const CSRF = { Origin: 'http://localhost:3100', 'X-FL-Client': '1' };
const post = (page, url, data) => page.request.post(url, { headers: CSRF, data });
const put = (page, url, data) => page.request.put(url, { headers: CSRF, data });
let counter = 0;
const uniqueName = () => `streak${Date.now()}${counter++}`;

// A calendar day `back` days before `from` (YYYY-MM-DD), by local calendar arithmetic.
function before(from, back) {
  const [y, m, d] = from.split('-').map(Number);
  const date = new Date(y, m - 1, d - back);
  const p = (x) => String(x).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}
const dayBack = (n) => before(localNow().date, n);

async function register(page) {
  const reg = await post(page, '/auth/register', { username: uniqueName(), password: PASSWORD });
  expect(reg.status(), await reg.text()).toBe(200);
  expect((await put(page, '/api/profile', { gender: 'male', birthDate: '1990-05-15', height: 175, weight: 70, activity: 'light', goalKg: 0 })).status()).toBe(200);
}
const meal = async (page, day) => {
  const res = await post(page, '/api/food', { meal_type: 'lunch', food_name: 'ארוחה', calories: 400, protein_g: 10, carbs_g: 20, fat_g: 5, fiber_g: 2, logged_at: `${day}T12:00:00` });
  expect(res.status(), await res.text()).toBe(200);
};
async function openHome(page) {
  await page.goto('/');
  await expect(page.locator('#screen-dashboard')).toBeVisible();
  await expect(page.locator('#pet-status-text')).not.toHaveText('טוען...');
}

// The strip as the page shows it, left to right.
const strip = (page) => page.evaluate(() => [...document.querySelectorAll('#dash-days .day')]
  .map((g) => ({ day: g.dataset.day, filled: g.dataset.filled === 'true', today: g.dataset.today === 'true', x: g.getBoundingClientRect().left, ringed: !!g.querySelector('.day-ring') }))
  .sort((a, b) => a.x - b.x));

// Seven days ending today: which are filled (given as how many days back), which is today.
async function expectStrip(page, today, filledBack, label) {
  const days = await strip(page);
  expect(days, `${label}: seven circles`).toHaveLength(7);
  expect(days.map((d) => d.day), `${label}: oldest at the left, today at the right`).toEqual(Array.from({ length: 7 }, (_, i) => before(today, 6 - i)));
  expect(days.filter((d) => d.today).map((d) => d.day), `${label}: today is marked`).toEqual([today]);
  expect(days[6].today && days[6].ringed, `${label}: today carries the ring, the others do not`).toBe(true);
  expect(days.filter((d) => d.ringed)).toHaveLength(1);
  expect(days.filter((d) => d.filled).map((d) => d.day), `${label}: the filled days`).toEqual(filledBack.map((b) => before(today, b)).sort());
}

test('a streak of 1 (today): only the right circle is filled and marked', async ({ page }) => {
  const guards = attachGuards(page);
  await register(page);
  await meal(page, dayBack(0));
  await openHome(page);
  await expectStrip(page, dayBack(0), [0], 'streak 1');
  await expect(page.locator('#dash-streak .dash-streak-line')).toHaveText('ברצף כבר יום אחד');
  expectNoGuardEvents(guards, [SIGNED_OUT_ME]);
});

test('a streak of 3 ending today: the three right circles are filled', async ({ page }) => {
  await register(page);
  for (const b of [0, 1, 2]) await meal(page, dayBack(b));
  await openHome(page);
  await expectStrip(page, dayBack(0), [0, 1, 2], 'streak 3');
  await expect(page.locator('#dash-streak .dash-streak-line')).toHaveText('ברצף כבר 3 ימים');
});

test('a streak of 3 ending yesterday: the three circles left of today are filled, today is empty and marked', async ({ page }) => {
  await register(page);
  for (const b of [1, 2, 3]) await meal(page, dayBack(b));
  await openHome(page);
  await expectStrip(page, dayBack(0), [1, 2, 3], 'streak ending yesterday');
  await expect(page.locator('#dash-streak .dash-streak-line')).toHaveText('ברצף כבר 3 ימים');
});

test('a gap breaks the streak: only the days after it are filled', async ({ page }) => {
  await register(page);
  for (const b of [0, 1, 3, 4]) await meal(page, dayBack(b));   // day 2 missing
  await openHome(page);
  await expectStrip(page, dayBack(0), [0, 1], 'streak with a gap');
});

test('a streak longer than seven days fills all seven circles', async ({ page }) => {
  await register(page);
  for (let b = 0; b < 9; b++) await meal(page, dayBack(b));
  await openHome(page);
  await expectStrip(page, dayBack(0), [0, 1, 2, 3, 4, 5, 6], 'streak 9');
  await expect(page.locator('#dash-streak .dash-streak-line')).toHaveText('ברצף כבר 9 ימים');
});

test('a streak of 0 with older meals: all seven empty, today marked, no caption; a fresh user sees no strip at all', async ({ page }) => {
  await register(page);
  await meal(page, dayBack(5));
  await openHome(page);
  await expectStrip(page, dayBack(0), [], 'streak 0');
  await expect(page.locator('#dash-streak .dash-streak-line')).toBeHidden();
  await expect(page.locator('#dash-streak')).toBeVisible();
  expect(await page.locator('#dash-days .day.filled').count()).toBe(0);

  // a fresh user: nothing, the first-meal prompt stands alone
  const other = await page.context().newPage();
  await other.context().clearCookies();
  await register(other);
  await openHome(other);
  await expect(other.locator('#pet-status-text')).toHaveText('לחץ על + כדי להוסיף את הארוחה הראשונה');
  await expect(other.locator('#dash-streak')).toBeHidden();
  await expect(other.locator('#dash-days .day')).toHaveCount(0);
});

test('the strip sits under the caption and above the last meal and overlaps neither', async ({ page }) => {
  await register(page);
  for (const b of [0, 1]) await meal(page, dayBack(b));
  await openHome(page);
  const g = await page.evaluate(() => {
    const box = (sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return { t: r.top, b: r.bottom, l: r.left, r: r.right }; };
    return { caption: box('#dash-streak .dash-streak-line'), strip: box('#dash-days svg'), last: box('#dash-last'), page: box('#screen-dashboard .page'), margin: box('#screen-dashboard .margin') };
  });
  expect(g.strip.t, 'under the caption').toBeGreaterThanOrEqual(g.caption.b - 1);
  expect(g.last.t, 'above the last meal').toBeGreaterThanOrEqual(g.strip.b - 1);
  expect(g.strip.l).toBeGreaterThanOrEqual(g.page.l);
  expect(g.strip.r).toBeLessThanOrEqual(g.margin.l + 2);
});

test('the strip follows the browser\'s local day: 23:30 and then 00:30 the next day', async ({ page }) => {
  const guards = attachGuards(page);
  await register(page);
  // a meal on 2026-06-15 and one on 06-14: a streak of two ending on the 15th
  await meal(page, '2026-06-14');
  await meal(page, '2026-06-15');
  await page.clock.install({ time: new Date(2026, 5, 15, 23, 30) });
  await openHome(page);
  await expectStrip(page, '2026-06-15', [0, 1], 'at 23:30');

  // half an hour later it is the 16th: today (the 16th) is empty and marked, the streak (ending yesterday) is still two days
  await page.clock.setFixedTime(new Date(2026, 5, 16, 0, 30));
  await page.reload();
  await expect(page.locator('#screen-dashboard')).toBeVisible();
  await expect(page.locator('#dash-days .day')).toHaveCount(7);
  await expectStrip(page, '2026-06-16', [1, 2], 'at 00:30 the next day');
  expectNoGuardEvents(guards, [SIGNED_OUT_ME]);
});
