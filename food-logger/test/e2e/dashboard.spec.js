'use strict';

// Task 8: the home screen as a diary page. The date title, the capybara with her speech bubble, the large
// handwritten calories eaten with the red progress bar, the streak as a hand-drawn tally under "ברצף כבר N ימים",
// and the last meal as a polaroid (the thumbnail when the meal has one, else the drawn plate) with the circled
// calories. Meals are seeded through the API the way the real client sends them (wall-clock `logged_at` from the
// browser's local date); the text-analysis flow runs through the UI once.

const { test, expect } = require('@playwright/test');
const { attachGuards, expectNoGuardEvents, SIGNED_OUT_ME, SAVE_TO_DIARY, localNow } = require('./helpers');
const { realJpeg } = require('../helpers/jpeg');

const PASSWORD = 'dash-pass-1234';
const CSRF = { Origin: 'http://localhost:3100', 'X-FL-Client': '1' };

const post = (page, url, data) => page.request.post(url, { headers: CSRF, data });
const put = (page, url, data) => page.request.put(url, { headers: CSRF, data });

const uniqueName = () => `dash${Date.now()}${Math.floor(Math.random() * 1000)}`;

// A calendar day `back` days before the local today (localNow() gives today), built with local getters only (like the app).
function dayBack(back) {
  const [y, m, day] = localNow().date.split('-').map(Number);
  const d = new Date(y, m - 1, day - back);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

async function registerWithProfile(page, username) {
  const reg = await post(page, '/auth/register', { username, password: PASSWORD });
  expect(reg.status(), await reg.text()).toBe(200);
  const prof = await put(page, '/api/profile', { gender: 'male', birthDate: '1990-05-15', height: 175, weight: 70, activity: 'light', goalKg: 0 });
  expect(prof.status()).toBe(200);
}

async function meal(page, { name = 'סלט ולחם', calories = 300, day = localNow().date, time = '12:30' } = {}) {
  const res = await post(page, '/api/food', {
    meal_type: 'lunch', food_name: name, calories, protein_g: 10, carbs_g: 20, fat_g: 5, fiber_g: 2,
    logged_at: `${day}T${time}:00`,
  });
  expect(res.status(), await res.text()).toBe(200);
  return res.json();
}

async function openHome(page) {
  await page.goto('/');
  await expect(page.locator('#screen-dashboard')).toBeVisible();
  await expect(page.locator('#pet-status-text')).not.toHaveText('טוען...');
}

// Every visible text node with a digit must be drawn by a font list that starts with `Digits` (the fonts.spec rule).
async function digitOffenders(page) {
  return page.evaluate(() => {
    const out = [];
    let seen = 0;
    const walker = document.createTreeWalker(document.querySelector('#screen-dashboard'), NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!/[0-9]/.test(n.nodeValue)) continue;
      const el = n.parentElement;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      seen += 1;
      const first = getComputedStyle(el).fontFamily.split(',')[0].trim().replace(/^["']|["']$/g, '');
      if (first !== 'Digits') out.push(`${el.tagName.toLowerCase()}.${el.className} "${n.nodeValue.trim()}" -> ${first}`);
    }
    return { seen, out };
  });
}

const noBrokenText = async (page) => {
  const text = await page.locator('#screen-dashboard').innerText();
  expect(text).not.toMatch(/NaN|undefined|null|\[object/);
  expect(await page.locator('#screen-dashboard img[src=""]').count()).toBe(0);
};

test('home with no meals: date, capybara, 0 eaten of the goal, no streak, no last meal, no broken text', async ({ page }) => {
  const guards = attachGuards(page);
  await registerWithProfile(page, uniqueName());
  await openHome(page);

  await expect(page.locator('#screen-dashboard .page > .content')).toBeVisible();
  await expect(page.locator('#screen-dashboard .ribbon')).toBeVisible();
  // "שבת, 3 באוקטובר": the weekday, the day of the month and the full month name
  await expect(page.locator('#dash-date')).toHaveText(/^[א-ת]+, \d{1,2} ב[א-ת]+$/);
  await expect(page.locator('#pet-dashboard-wrap svg')).toBeVisible();
  await expect(page.locator('#pet-bubble #pet-status-text')).not.toBeEmpty();

  await expect(page.locator('#dash-cal-remaining')).toHaveText('0');
  await expect(page.locator('#dash-cal-sep')).toBeVisible();
  await expect(page.locator('#dash-cal-goal-label')).toHaveText(/^\d{1,3}(,\d{3})*$/);

  await expect(page.locator('#dash-streak')).toBeHidden();   // a streak of 0 draws nothing and says nothing
  await expect(page.locator('#dash-last')).toBeHidden();
  await expect(page.locator('#dash-weight')).toBeHidden();
  await noBrokenText(page);
  expectNoGuardEvents(guards, [SIGNED_OUT_ME]);
});

test('home with no profile: no goal, no bar, still no NaN', async ({ page }) => {
  const guards = attachGuards(page);
  const reg = await post(page, '/auth/register', { username: uniqueName(), password: PASSWORD });
  expect(reg.status()).toBe(200);
  await openHome(page);
  await expect(page.locator('#dash-cal-sep')).toBeHidden();
  await expect(page.locator('#dash-bar')).toBeHidden();
  await noBrokenText(page);
  await meal(page, { calories: 250 });
  await page.reload();
  await expect(page.locator('#dash-cal-remaining')).toHaveText('250');
  await expect(page.locator('#dash-cal-sep')).toBeHidden();
  await noBrokenText(page);
  expectNoGuardEvents(guards, [SIGNED_OUT_ME]);
});

test('one meal saved through the UI: eaten calories, circled calories, tally for 1, placeholder plate, username', async ({ page }) => {
  const guards = attachGuards(page);
  const username = uniqueName();
  await registerWithProfile(page, username);
  await openHome(page);

  await page.locator('#nav-camera').click();
  await page.locator('#food-text-input').fill('סלט ולחם');
  await page.locator('#text-analyze-btn').click();
  await expect(page.locator('#analysis-result')).toBeVisible();
  const analysedCal = Math.round(Number(await page.locator('#res-cal').inputValue()));
  expect(analysedCal).toBeGreaterThan(0);
  await page.locator('#save-entry-btn').click();
  await expect(page.locator('#screen-home')).toBeVisible(SAVE_TO_DIARY);

  await page.locator('#nav-dashboard').click();
  await expect(page.locator('#screen-dashboard')).toBeVisible();
  const eaten = analysedCal.toLocaleString('he-IL');

  await expect(page.locator('#pet-name-label')).toHaveText(username);
  const big = page.locator('.eat .n');
  await expect(big).toHaveText(eaten);                       // digits only, counted up
  await expect(big).toHaveCSS('font-size', '46px');
  await expect(page.locator('.eat .of')).toContainText('קק״ל מתוך');

  // streak 1: the line says "יום אחד" and the tally is one stroke
  await expect(page.locator('#dash-streak')).toBeVisible();
  await expect(page.locator('#dash-streak .dash-streak-line')).toHaveText('ברצף כבר יום אחד');
  await expect(page.locator('#dash-tally svg.tally')).toBeVisible();
  await expect(page.locator('#dash-tally svg.tally .tally-stroke')).toHaveCount(1);

  // the last meal: polaroid with the drawn plate (no thumbnail), circled calories and the name
  const last = page.locator('#dash-last');
  await expect(last).toBeVisible();
  await expect(last.locator('.polaroid .ph svg.plate-ph')).toBeVisible();
  await expect(last.locator('img')).toHaveCount(0);
  await expect(last.locator('.circ')).toHaveText(eaten);
  await expect(last.locator('.dash-meal-name')).not.toBeEmpty();

  await noBrokenText(page);
  const digits = await digitOffenders(page);
  expect(digits.seen, 'the home screen shows digits').toBeGreaterThan(0);
  expect(digits.out, 'digit font').toEqual([]);
  expectNoGuardEvents(guards, [SIGNED_OUT_ME]);
});

test('a meal with a thumbnail shows it as an img from /api/food/:id/photo, and today\'s weight shows', async ({ page }) => {
  const guards = attachGuards(page);
  await registerWithProfile(page, uniqueName());
  const created = await meal(page, { name: 'שניצל עם כוסמת', calories: 722 });
  const up = await page.request.put(`/api/food/${created.id}/photo`, { headers: { ...CSRF, 'Content-Type': 'image/jpeg' }, data: realJpeg(24, 24, 90) });
  expect(up.status(), await up.text()).toBe(200);
  expect((await post(page, '/api/weight', { weight_kg: 71.5, logged_at: localNow().date })).status()).toBe(200);
  await openHome(page);

  const img = page.locator('#dash-last .polaroid .ph img.ph-img');
  await expect(img).toHaveAttribute('src', /^\/api\/food\/\d+\/photo$/);
  await expect(img).toHaveAttribute('src', `/api/food/${created.id}/photo`);
  await expect.poll(() => img.evaluate((el) => el.complete && el.naturalWidth)).toBeGreaterThan(0);
  await expect(page.locator('#dash-last svg.plate-ph')).toHaveCount(0);
  await expect(page.locator('#dash-last .circ')).toHaveText('722');
  await expect(page.locator('#dash-last .dash-meal-name')).toHaveText('שניצל עם כוסמת');

  await expect(page.locator('#dash-weight')).toBeVisible();
  await expect(page.locator('#dash-weight')).toHaveText('משקל 71.5 ק״ג');
  await noBrokenText(page);
  const digits = await digitOffenders(page);
  expect(digits.out, 'digit font').toEqual([]);
  expectNoGuardEvents(guards, [SIGNED_OUT_ME]);
});

test('a streak of 7 draws seven strokes and says "ברצף כבר 7 ימים"', async ({ page }) => {
  const guards = attachGuards(page);
  await registerWithProfile(page, uniqueName());
  for (let back = 0; back < 7; back++) await meal(page, { day: dayBack(back), calories: 400 });
  await openHome(page);

  await expect(page.locator('#dash-streak .dash-streak-line')).toHaveText('ברצף כבר 7 ימים');
  await expect(page.locator('#dash-streak-num')).toHaveText('7 ימים');
  await expect(page.locator('#dash-tally svg.tally .tally-stroke')).toHaveCount(7);   // four strokes, the crossing one, two more
  await expect(page.locator('#dash-tally svg.tally .tally-diag')).toHaveCount(1);
  expectNoGuardEvents(guards, [SIGNED_OUT_ME]);
});

test('eating more than the goal keeps the bar inside its track and a long name inside the page', async ({ page }) => {
  const guards = attachGuards(page);
  await registerWithProfile(page, uniqueName());
  const longName = 'פסטה ברוטב עגבניות שמנת ופטריות עם גבינה צהובה מותכת ובצל מטוגן ועוד הרבה תוספות טעימות במיוחד'.repeat(2);
  await meal(page, { calories: 6000, name: longName });
  await openHome(page);

  await expect(page.locator('.eat .n')).toHaveText('6,000');
  const geo = await page.evaluate(() => {
    const track = document.querySelector('#dash-bar .track').getBoundingClientRect();
    const fill = document.querySelector('#dash-cal-fill').getBoundingClientRect();
    return { trackL: track.left, trackR: track.right, fillL: fill.left, fillR: fill.right, fillW: fill.width, trackW: track.width };
  });
  await expect.poll(() => page.evaluate(() => Math.round(document.querySelector('#dash-cal-fill').getBoundingClientRect().width)))
    .toBe(Math.round(geo.trackW));                                  // clamped to 100%, after its transition
  expect(geo.fillL).toBeGreaterThanOrEqual(geo.trackL - 0.5);
  expect(geo.fillR).toBeLessThanOrEqual(geo.trackR + 0.5);
  await expect(page.locator('#dash-bar')).toHaveAttribute('aria-valuenow', '100');

  // nothing sticks out of the page sideways: the last-meal block, its polaroid and the name stay in the content column
  const bounds = await page.evaluate(() => {
    const content = document.querySelector('#screen-dashboard .content').getBoundingClientRect();
    const out = [];
    for (const sel of ['#dash-last', '#dash-last .polaroid', '#dash-last .dash-meal-name', '#dash-last .circ', '.eat', '#pet-bubble']) {
      const r = document.querySelector(sel).getBoundingClientRect();
      if (r.left < content.left - 0.5 || r.right > content.right + 0.5) out.push(`${sel} ${Math.round(r.left)}..${Math.round(r.right)} vs ${Math.round(content.left)}..${Math.round(content.right)}`);
    }
    return { out, scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth };
  });
  expect(bounds.out).toEqual([]);
  expect(bounds.scrollW).toBeLessThanOrEqual(bounds.innerW);
  expectNoGuardEvents(guards, [SIGNED_OUT_ME]);
});

test('the weight line shows the newest weight even when it was logged on an earlier day, and is hidden with no weights', async ({ page }) => {
  const guards = attachGuards(page);
  await registerWithProfile(page, uniqueName());
  await openHome(page);
  await expect(page.locator('#dash-weight')).toBeHidden();               // no weight logged at all

  expect((await post(page, '/api/weight', { weight_kg: 72, logged_at: dayBack(9) })).status()).toBe(200);
  expect((await post(page, '/api/weight', { weight_kg: 69.5, logged_at: dayBack(3) })).status()).toBe(200);
  await page.reload();
  await expect(page.locator('#screen-dashboard')).toBeVisible();
  await expect(page.locator('#dash-weight')).toHaveText('משקל 69.5 ק״ג');   // the newest one, not today's
  const digits = await digitOffenders(page);
  expect(digits.out, 'digit font').toEqual([]);
  expectNoGuardEvents(guards, [SIGNED_OUT_ME]);
});

test('logging a meal and coming back to the home page shows the refreshed numbers', async ({ page }) => {
  const guards = attachGuards(page);
  await registerWithProfile(page, uniqueName());
  await openHome(page);
  await expect(page.locator('#dash-cal-remaining')).toHaveText('0');
  await expect(page.locator('#dash-last')).toBeHidden();
  await expect(page.locator('#dash-streak')).toBeHidden();

  await meal(page, { name: 'ארוחת בוקר', calories: 300, time: '08:00' });
  await page.locator('#nav-home').click();
  await expect(page.locator('#screen-home')).toBeVisible();
  await page.locator('#nav-dashboard').click();
  await expect(page.locator('#dash-cal-remaining')).toHaveText('300');
  await expect(page.locator('#dash-last .dash-meal-name')).toHaveText('ארוחת בוקר');
  await expect(page.locator('#dash-streak .dash-streak-line')).toHaveText('ברצף כבר יום אחד');

  await meal(page, { name: 'ארוחת צהריים', calories: 450, time: '13:00' });
  await page.locator('#nav-home').click();
  await page.locator('#nav-dashboard').click();
  await expect(page.locator('#dash-cal-remaining')).toHaveText('750');
  await expect(page.locator('#dash-last .dash-meal-name')).toHaveText('ארוחת צהריים');
  await expect(page.locator('#dash-last .circ')).toHaveText('450');
  expectNoGuardEvents(guards, [SIGNED_OUT_ME]);
});

// A thumbnail that cannot load (404, or the network is gone) must never show as a broken image: the drawn plate takes its
// place inside the same polaroid. The browser logs the failed request itself, so only page errors are guarded here.
for (const [label, handler] of [
  ['answers 404', (route) => route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":{"code":"NOT_FOUND"}}' })],
  ['is aborted (offline)', (route) => route.abort('internetdisconnected')],
]) {
  test(`a thumbnail that ${label} falls back to the plate, never a broken image`, async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));
    await registerWithProfile(page, uniqueName());
    const created = await meal(page, { name: 'שניצל', calories: 500 });
    const up = await page.request.put(`/api/food/${created.id}/photo`, { headers: { ...CSRF, 'Content-Type': 'image/jpeg' }, data: realJpeg(24, 24, 40) });
    expect(up.status()).toBe(200);
    let asked = 0;
    await page.route('**/api/food/*/photo', (route) => { asked += 1; return handler(route); });
    await openHome(page);

    await expect(page.locator('#dash-last .polaroid .ph svg.plate-ph')).toBeVisible();
    await expect(page.locator('#dash-last .polaroid .tape')).toHaveCount(1);          // the polaroid frame stays
    expect(asked, 'the thumbnail was requested').toBeGreaterThan(0);
    const broken = await page.evaluate(() => [...document.querySelectorAll('img[data-photo]')].filter((i) => !i.naturalWidth).length);
    expect(broken, 'no img[data-photo] without a picture is left').toBe(0);
    await expect(page.locator('#dash-last img')).toHaveCount(0);
    expect(pageErrors).toEqual([]);

    // going away and back renders the meal again: still the plate, no loop, no error
    await page.locator('#nav-home').click();
    await page.locator('#nav-dashboard').click();
    await expect(page.locator('#dash-last .polaroid .ph svg.plate-ph')).toBeVisible();
    expect(await page.evaluate(() => document.querySelectorAll('#dash-last img').length)).toBe(0);
    expect(pageErrors).toEqual([]);
  });
}
