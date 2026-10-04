'use strict';

// Task 9: the diary (the "יומן" page). A week strip with an arrow at each end and the displayed day circled in red pen,
// the date title, the calories eaten with the red bar, and every meal as a taped polaroid with its name and circled
// calories BESIDE the photo, the time under the photo, and the text buttons "ערוך" and "מחק" under the calories.
// Meals are seeded through the API the way the real client sends them (wall-clock `logged_at` from the browser's local date).

const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { test, expect } = require('@playwright/test');
const { attachGuards, expectNoGuardEvents, SIGNED_OUT_ME, localNow } = require('./helpers');
const { realJpeg } = require('../helpers/jpeg');

const PASSWORD = 'diary-pass-1234';
const CSRF = { Origin: 'http://localhost:3100', 'X-FL-Client': '1' };
const post = (page, url, data) => page.request.post(url, { headers: CSRF, data });
const put = (page, url, data) => page.request.put(url, { headers: CSRF, data });
const uniqueName = () => `diary${Date.now()}${Math.floor(Math.random() * 1000)}`;

// The app's own date helpers (pure calendar arithmetic), so the tests count days exactly like the page does.
const loadDates = () => import(pathToFileURL(path.join(__dirname, '..', '..', 'public', 'js', 'dates.js')).href);

async function register(page, { profile = true } = {}) {
  const reg = await post(page, '/auth/register', { username: uniqueName(), password: PASSWORD });
  expect(reg.status(), await reg.text()).toBe(200);
  if (profile) {
    const prof = await put(page, '/api/profile', { gender: 'male', birthDate: '1990-05-15', height: 175, weight: 70, activity: 'light', goalKg: 0 });
    expect(prof.status()).toBe(200);
  }
}

async function meal(page, { name = 'סלט ולחם', calories = 300, day = localNow().date, time = '12:30', type = 'lunch' } = {}) {
  const res = await post(page, '/api/food', {
    meal_type: type, food_name: name, calories, protein_g: 10, carbs_g: 20, fat_g: 5, fiber_g: 2,
    logged_at: `${day}T${time}:00`,
  });
  expect(res.status(), await res.text()).toBe(200);
  return res.json();
}

async function thumbnail(page, id, shade = 90) {
  const up = await page.request.put(`/api/food/${id}/photo`, { headers: { ...CSRF, 'Content-Type': 'image/jpeg' }, data: realJpeg(24, 24, shade) });
  expect(up.status(), await up.text()).toBe(200);
}

async function openDiary(page) {
  await page.goto('/');
  await expect(page.locator('#screen-dashboard')).toBeVisible();
  await page.locator('#nav-home').click();
  await expect(page.locator('#screen-home')).toBeVisible();
}

const rows = (page) => page.locator('#meal-list .meal-item-row');
const sel = (page) => page.locator('#screen-home .week .sel');
const box = async (locator) => {
  const b = await locator.boundingBox();
  expect(b, 'element has a box').not.toBeNull();
  return b;
};
const intersects = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

async function digitOffenders(page) {
  return page.evaluate(() => {
    const out = [];
    let seen = 0;
    const walker = document.createTreeWalker(document.querySelector('#screen-home'), NodeFilter.SHOW_TEXT);
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

test('three meals appear oldest first, as polaroids with the name beside the photo and the time under it', async ({ page }) => {
  const guards = attachGuards(page);
  await register(page);
  // seeded out of order on purpose: the list is ordered by the time of the meal
  const dinner = await meal(page, { name: 'פסטה', calories: 700, time: '19:40', type: 'dinner' });
  const breakfast = await meal(page, { name: 'ביצים וטוסט', calories: 400, time: '08:10', type: 'breakfast' });
  await meal(page, { name: 'שניצל עם כוסמת', calories: 722, time: '13:05', type: 'lunch' });
  await thumbnail(page, breakfast.id);
  await openDiary(page);

  await expect(rows(page)).toHaveCount(3);
  await expect(page.locator('#meal-list .meal-item-row .mir-name')).toHaveText(['ביצים וטוסט', 'שניצל עם כוסמת', 'פסטה']);
  await expect(page.locator('#meal-list .meal-item-row .polaroid .cp')).toHaveText(['08:10', '13:05', '19:40']);
  await expect(page.locator('#meal-list .meal-item-row .circ')).toHaveText(['400', '722', '700']);
  await expect(rows(page).first()).toHaveAttribute('id', `entry-${breakfast.id}`);
  await expect(rows(page).last()).toHaveAttribute('id', `entry-${dinner.id}`);

  // a thumbnail where the meal has one, the drawn plate where it has none; every <img> is a data-photo one
  await expect(rows(page).nth(0).locator('.polaroid .ph img.ph-img')).toHaveAttribute('src', `/api/food/${breakfast.id}/photo`);
  await expect(rows(page).nth(0).locator('svg.plate-ph')).toHaveCount(0);
  await expect(rows(page).nth(1).locator('.polaroid .ph svg.plate-ph')).toBeVisible();
  await expect(rows(page).nth(1).locator('img')).toHaveCount(0);
  expect(await page.locator('#meal-list img:not([data-photo])').count()).toBe(0);

  const polaroids = [];
  for (let i = 0; i < 3; i++) {
    const row = rows(page).nth(i);
    await row.scrollIntoViewIfNeeded();
    const polaroid = await box(row.locator('.polaroid'));
    const picture = await box(row.locator('.polaroid .ph'));
    const time = await box(row.locator('.polaroid .cp'));
    const name = await box(row.locator('.mir-name'));
    const circ = await box(row.locator('.circ'));
    const edit = await box(row.getByRole('button', { name: 'ערוך' }));
    const del = await box(row.getByRole('button', { name: 'מחק' }));
    // the time is under the photo (its middle is below the photo's bottom edge) and below the name, never above it
    expect(time.y + time.height / 2, `row ${i}: the time is under the photo`).toBeGreaterThan(picture.y + picture.height);
    expect(time.y, `row ${i}: the time is below the name`).toBeGreaterThan(name.y);
    // the name, the circled calories and both buttons are beside the polaroid, never over it
    for (const [label, b] of [['name', name], ['circled calories', circ], ['ערוך', edit], ['מחק', del]]) {
      expect(intersects(b, polaroid), `row ${i}: ${label} must not touch the polaroid`).toBe(false);
    }
    // calories under the name, the two buttons under the calories
    expect(circ.y).toBeGreaterThanOrEqual(name.y + name.height - 1);
    expect(edit.y + edit.height / 2).toBeGreaterThan(circ.y + circ.height / 2);
    expect(del.y + del.height / 2).toBeGreaterThan(circ.y + circ.height / 2);
    polaroids.push({ polaroid, name });
  }
  // the polaroids alternate sides: the photo of the first meal is on the right, the second on the left, the third on the right
  const mid = (await box(page.locator('#screen-home .content'))).x + (await box(page.locator('#screen-home .content'))).width / 2;
  expect(polaroids[0].polaroid.x + polaroids[0].polaroid.width / 2).toBeGreaterThan(mid);
  expect(polaroids[1].polaroid.x + polaroids[1].polaroid.width / 2).toBeLessThan(mid);
  expect(polaroids[2].polaroid.x + polaroids[2].polaroid.width / 2).toBeGreaterThan(mid);

  // the eaten total, with the day's goal and a bar
  await expect(page.locator('#sum-cal')).toHaveText('1,822');
  await expect(page.locator('#screen-home .eat .of')).toContainText('קק״ל מתוך');
  await expect(page.locator('#diary-bar')).toBeVisible();
  // the macro totals keep their labels and ids
  await expect(page.locator('#sum-pro')).toHaveText('30');
  await expect(page.locator('#sum-carb')).toHaveText('60');
  await expect(page.locator('#sum-fat')).toHaveText('15');
  await expect(page.locator('#sum-fiber')).toHaveText('6');
  await expect(page.locator('#screen-home .macros')).toContainText('חלבון');
  await expect(page.locator('#screen-home .macros')).toContainText('פחמימות');
  await expect(page.locator('#screen-home .macros')).toContainText('שומן');
  await expect(page.locator('#screen-home .macros')).toContainText('סיבים');
  // the old diary furniture is gone
  await expect(page.locator('#screen-home .topbar, #screen-home .card, #pet-diary-wrap')).toHaveCount(0);
  await expect(page.locator('#screen-home .page > .ribbon')).toBeVisible();

  const digits = await digitOffenders(page);
  expect(digits.seen, 'the diary shows digits').toBeGreaterThan(0);
  expect(digits.out, 'digit font').toEqual([]);
  expectNoGuardEvents(guards, [SIGNED_OUT_ME]);
});

test('the ribbon sits below the week strip; the strip has an arrow at each end and exactly two buttons in .date-nav', async ({ page }) => {
  const guards = attachGuards(page);
  await register(page);
  await openDiary(page);

  await expect(page.locator('#screen-home .date-nav button')).toHaveCount(2);
  await expect(page.locator('#screen-home .week button')).toHaveCount(7);
  const strip = await box(page.locator('#screen-home .weekrow'));
  const ribbon = await box(page.locator('#screen-home .page > .ribbon'));
  const arrows = page.locator('#screen-home .date-nav button');
  const first = await box(arrows.first());
  const last = await box(arrows.last());
  const week = await box(page.locator('#screen-home .week'));
  expect(ribbon.y, 'the ribbon starts below the strip').toBeGreaterThanOrEqual(strip.y + strip.height - 1);
  // previous on the right, next on the left, the seven days between them
  expect(first.x).toBeGreaterThan(week.x + week.width - 1);
  expect(last.x + last.width).toBeLessThan(week.x + 1);
  await expect(page.locator('#diary-date-label')).toContainText('היום');
  await expect(page.locator('#diary-date-label')).toHaveText(/^היום, \d{1,2} ב[א-ת׳]+$/);
  expectNoGuardEvents(guards, [SIGNED_OUT_ME]);
});

test('the arrows move one day; the circled day in the strip follows and shows the red pen circle', async ({ page }) => {
  const guards = attachGuards(page);
  const { addDays, formatDateTitle } = await loadDates();
  await register(page);
  await openDiary(page);
  const today = localNow().date;

  await expect(sel(page)).toHaveCount(1);
  await expect(sel(page)).toHaveAttribute('data-arg', today);
  const ring = await sel(page).evaluate((el) => {
    const cs = getComputedStyle(el, '::after');
    return { color: cs.borderTopColor, width: cs.borderTopWidth, style: cs.borderTopStyle };
  });
  expect(ring).toEqual({ color: 'rgb(179, 49, 29)', width: '2px', style: 'solid' });

  const label = page.locator('#diary-date-label');
  const todayLabel = await label.textContent();
  const previous = page.locator('#screen-home .date-nav button').first();
  const next = page.locator('#screen-home .date-nav button').last();

  // both arrows keep an accessible name: the date they lead to (no new copy; formatDateTitle of the neighbouring day)
  const name = async (b) => (await b.getAttribute('aria-label')) || '';
  expect(await name(previous)).toBe(formatDateTitle(addDays(today, -1)));
  expect(await name(next)).toBe(formatDateTitle(addDays(today, 1)));
  await expect(page.getByRole('button', { name: formatDateTitle(addDays(today, -1)), exact: true }).first()).toBeVisible();
  await expect(next, 'no future: next is disabled at today').toBeDisabled();
  await previous.click();
  await expect(sel(page)).toHaveAttribute('data-arg', addDays(today, -1));
  expect(await name(previous)).toBe(formatDateTitle(addDays(today, -2)));   // the names follow the shown day
  expect(await name(next)).toBe(formatDateTitle(today));
  await expect(label).not.toHaveText(todayLabel);
  await expect(label).not.toContainText('היום');
  await expect(next).toBeEnabled();
  await previous.click();
  await expect(sel(page)).toHaveAttribute('data-arg', addDays(today, -2));
  await expect(sel(page)).toHaveCount(1);
  await next.click();
  await next.click();
  await expect(sel(page)).toHaveAttribute('data-arg', today);
  await expect(label).toHaveText(todayLabel);
  await expect(next).toBeDisabled();
  expectNoGuardEvents(guards, [SIGNED_OUT_ME]);
});

test('tapping another day of the strip loads that day', async ({ page }) => {
  const guards = attachGuards(page);
  const { addDays, weekOf } = await loadDates();
  await register(page);
  const today = localNow().date;
  const yesterday = addDays(today, -1);
  // any other day of yesterday's week that is not in the future
  const target = weekOf(yesterday).find((d) => d !== yesterday && d <= today);
  await meal(page, { name: 'ארוחה של יום אחר', calories: 345, day: target, time: '09:15' });
  await openDiary(page);
  await expect(page.locator('#meal-list .empty-state')).toBeVisible();

  await page.locator('#screen-home .date-nav button').first().click();       // yesterday (maybe the previous week)
  await expect(sel(page)).toHaveAttribute('data-arg', yesterday);
  await expect(page.locator(`#screen-home .week button[data-arg="${target}"]`)).toBeEnabled();
  await page.locator(`#screen-home .week button[data-arg="${target}"]`).click();
  await expect(sel(page)).toHaveAttribute('data-arg', target);
  await expect(sel(page)).toHaveCount(1);
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first().locator('.mir-name')).toHaveText('ארוחה של יום אחר');
  await expect(page.locator('#sum-cal')).toHaveText('345');
  await expect(page.locator('#diary-date-label')).toContainText(/^יום [א-ת]+, \d{1,2} ב/);
  // tapping the displayed day again keeps it (no flip to another day)
  await page.locator(`#screen-home .week button[data-arg="${target}"]`).click();
  await expect(sel(page)).toHaveAttribute('data-arg', target);
  await expect(rows(page)).toHaveCount(1);
  expectNoGuardEvents(guards, [SIGNED_OUT_ME]);
});

test('future days of the strip are dimmed and cannot be tapped (browser clock fixed on a Wednesday)', async ({ page }) => {
  const guards = attachGuards(page);
  await register(page);
  await page.clock.install({ time: new Date(2026, 9, 7, 12, 0) });          // Wednesday 2026-10-07
  await openDiary(page);

  await expect(page.locator('#screen-home .week button')).toHaveCount(7);
  const days = await page.locator('#screen-home .week button').evaluateAll((els) => els.map((e) => e.dataset.arg));
  expect(days).toEqual(['2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10']);
  await expect(sel(page)).toHaveAttribute('data-arg', '2026-10-07');
  for (const d of ['2026-10-08', '2026-10-09', '2026-10-10']) {
    const b = page.locator(`#screen-home .week button[data-arg="${d}"]`);
    await expect(b).toBeDisabled();
    await expect(b).toHaveClass(/future/);
    await expect(b).toHaveCSS('opacity', /^0?\.[0-9]+$/);
    await b.click({ force: true });                                         // a disabled button ignores even a forced click
    await expect(sel(page)).toHaveAttribute('data-arg', '2026-10-07');
  }
  for (const d of ['2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07']) {
    await expect(page.locator(`#screen-home .week button[data-arg="${d}"]`)).toBeEnabled();
  }
  await page.locator('#screen-home .week button[data-arg="2026-10-05"]').click();
  await expect(sel(page)).toHaveAttribute('data-arg', '2026-10-05');
  await expect(page.locator('#diary-date-label')).toHaveText('יום שני, 5 באוק׳');
  // the strip keeps the week while days inside it are visited, and the next arrow can go up to today
  await page.locator('#screen-home .date-nav button').last().click();
  await expect(sel(page)).toHaveAttribute('data-arg', '2026-10-06');
  expectNoGuardEvents(guards, [SIGNED_OUT_ME]);
});

test('delete removes the row and the totals; edit still opens the edit modal', async ({ page }) => {
  const guards = attachGuards(page);
  await register(page);
  await meal(page, { name: 'ארוחה ראשונה', calories: 300, time: '08:00' });
  await meal(page, { name: 'ארוחה שנייה', calories: 450, time: '13:00' });
  await openDiary(page);
  await expect(rows(page)).toHaveCount(2);
  await expect(page.locator('#sum-cal')).toHaveText('750');

  await rows(page).first().getByRole('button', { name: 'ערוך' }).click();
  await expect(page.locator('#edit-modal')).toHaveClass(/open/);
  await expect(page.locator('#edit-name')).toHaveValue('ארוחה ראשונה');
  await expect(page.locator('#edit-cal')).toHaveValue('300');
  await page.locator('#edit-modal-close').click();
  await expect(page.locator('#edit-modal')).not.toHaveClass(/open/);

  await rows(page).first().getByRole('button', { name: 'מחק' }).click();
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first().locator('.mir-name')).toHaveText('ארוחה שנייה');
  await expect(page.locator('#sum-cal')).toHaveText('450');
  await rows(page).first().getByRole('button', { name: 'מחק' }).click();
  await expect(rows(page)).toHaveCount(0);
  await expect(page.locator('#meal-list .empty-state')).toBeVisible();
  await expect(page.locator('#sum-cal')).toHaveText('0');
  expectNoGuardEvents(guards, [SIGNED_OUT_ME]);
});

test('an empty day shows the empty state with its wording and nothing broken', async ({ page }) => {
  const guards = attachGuards(page);
  await register(page);
  await openDiary(page);
  await expect(rows(page)).toHaveCount(0);
  const empty = page.locator('#meal-list .empty-state');
  await expect(empty).toBeVisible();
  await expect(empty).toContainText('אין ארוחות מתועדות');
  await expect(empty).toContainText('לחץ על ➕ כדי להוסיף ארוחה');
  await expect(page.locator('#sum-cal')).toHaveText('0');
  const text = await page.locator('#screen-home').innerText();
  expect(text).not.toMatch(/NaN|undefined|null|\[object/);
  const digits = await digitOffenders(page);
  expect(digits.out, 'digit font').toEqual([]);
  expectNoGuardEvents(guards, [SIGNED_OUT_ME]);
});

test('no profile: no goal, no bar, the total still shows', async ({ page }) => {
  const guards = attachGuards(page);
  await register(page, { profile: false });
  await meal(page, { calories: 250 });
  await openDiary(page);
  await expect(page.locator('#sum-cal')).toHaveText('250');
  await expect(page.locator('#diary-goal-sep')).toBeHidden();
  await expect(page.locator('#diary-bar')).toBeHidden();
  expectNoGuardEvents(guards, [SIGNED_OUT_ME]);
});

for (const width of [390, 320]) {
  test(`a name of 120 Hebrew characters (with spaces, and in one piece) stays inside its column at ${width} px`, async ({ page }) => {
    const guards = attachGuards(page);
    await page.setViewportSize({ width, height: 844 });
    await register(page);
    const spaced = 'ארוחת ערב משפחתית גדולה עם הרבה תוספות ורטבים ועוד מנות צד טעימות במיוחד של סבתא '.repeat(3).slice(0, 120).trim();
    const oneWord = 'א'.repeat(120);
    expect([...spaced].length).toBeGreaterThan(100);
    await meal(page, { name: spaced, calories: 800, time: '10:00' });
    await meal(page, { name: oneWord, calories: 900, time: '11:00' });
    await openDiary(page);
    await expect(rows(page)).toHaveCount(2);

    const content = await box(page.locator('#screen-home .content'));
    for (let i = 0; i < 2; i++) {
      const row = rows(page).nth(i);
      await row.scrollIntoViewIfNeeded();
      const name = await box(row.locator('.mir-name'));
      const polaroid = await box(row.locator('.polaroid'));
      const circ = await box(row.locator('.circ'));
      expect(name.x, `row ${i}: name inside the page (left)`).toBeGreaterThanOrEqual(content.x - 0.5);
      expect(name.x + name.width, `row ${i}: name inside the page (right)`).toBeLessThanOrEqual(content.x + content.width + 0.5);
      expect(intersects(name, polaroid), `row ${i}: name clear of the polaroid`).toBe(false);
      expect(name.height, `row ${i}: at most three lines of 30 px`).toBeLessThanOrEqual(90.5);
      expect(circ.y, `row ${i}: the calories stay under the name`).toBeGreaterThanOrEqual(name.y + name.height - 1);
      expect(await row.locator('.mir-name').evaluate((el) => el.scrollWidth <= el.clientWidth + 1), `row ${i}: no horizontal overflow of the name`).toBe(true);
      expect(intersects(await box(row.getByRole('button', { name: 'ערוך' })), polaroid)).toBe(false);
    }
    const sideways = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, w: window.innerWidth, c: document.querySelector('#screen-home .content').scrollWidth, cw: document.querySelector('#screen-home .content').clientWidth }));
    expect(sideways.s).toBeLessThanOrEqual(sideways.w);
    expect(sideways.c).toBeLessThanOrEqual(sideways.cw);
    expectNoGuardEvents(guards, [SIGNED_OUT_ME]);
  });
}

test('a day with 20 meals scrolls inside the page and the dock stays visible', async ({ page }) => {
  const guards = attachGuards(page);
  await register(page);
  for (let i = 0; i < 20; i++) {
    await meal(page, { name: `ארוחה מספר ${i + 1}`, calories: 100 + i, time: `${String(6 + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}` });
  }
  await openDiary(page);
  await expect(rows(page)).toHaveCount(20);

  const geo = await page.evaluate(() => {
    const c = document.querySelector('#screen-home .content');
    const p = document.querySelector('#screen-home .page').getBoundingClientRect();
    const dock = document.getElementById('bottom-nav').getBoundingClientRect();
    return { scrollH: c.scrollHeight, clientH: c.clientHeight, pageBottom: p.bottom, dockTop: dock.top, dockBottom: dock.bottom, inner: window.innerHeight, docScroll: document.documentElement.scrollHeight };
  });
  expect(geo.scrollH, 'the list is taller than the page').toBeGreaterThan(geo.clientH * 3);
  expect(geo.docScroll, 'the document itself never scrolls').toBeLessThanOrEqual(geo.inner);
  expect(geo.pageBottom).toBeLessThanOrEqual(geo.dockTop + 0.5);
  expect(geo.dockBottom).toBeLessThanOrEqual(geo.inner + 0.5);

  const last = rows(page).last();
  await page.locator('#screen-home .content').evaluate((c) => { c.scrollTop = c.scrollHeight; });
  await expect(last).toBeInViewport();
  await expect(page.locator('#bottom-nav')).toBeInViewport({ ratio: 1 });
  const lastBox = await box(last);
  const contentBox = await box(page.locator('#screen-home .content'));
  expect(lastBox.y + lastBox.height, 'the last meal ends inside the page').toBeLessThanOrEqual(contentBox.y + contentBox.height + 0.5);
  await expect(last.getByRole('button', { name: 'מחק' })).toBeVisible();
  await last.getByRole('button', { name: 'מחק' }).click();
  await expect(rows(page)).toHaveCount(19);
  await expect(page.locator('#bottom-nav')).toBeInViewport({ ratio: 1 });
  expectNoGuardEvents(guards, [SIGNED_OUT_ME]);
});

for (const [label, handler] of [
  ['answers 404', (route) => route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":{"code":"NOT_FOUND"}}' })],
  ['is aborted (offline)', (route) => route.abort('internetdisconnected')],
]) {
  test(`a thumbnail that ${label} falls back to the plate inside the polaroid`, async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));
    await register(page);
    const created = await meal(page, { name: 'שניצל', calories: 500 });
    await thumbnail(page, created.id, 40);
    let asked = 0;
    await page.route('**/api/food/*/photo', (route) => { asked += 1; return handler(route); });
    await openDiary(page);

    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first().locator('.polaroid .ph svg.plate-ph')).toBeVisible();
    await expect(rows(page).first().locator('.polaroid .tape')).toHaveCount(1);
    await expect(rows(page).first().locator('img')).toHaveCount(0);
    expect(asked, 'the thumbnail was requested').toBeGreaterThan(0);
    const broken = await page.evaluate(() => [...document.querySelectorAll('img[data-photo]')].filter((i) => !i.naturalWidth).length);
    expect(broken).toBe(0);
    expect(pageErrors).toEqual([]);
  });
}

test('a thumbnail that loads fills the polaroid with the picture (a real img, not a broken one)', async ({ page }) => {
  const guards = attachGuards(page);
  await register(page);
  const created = await meal(page, { name: 'שניצל', calories: 500 });
  await thumbnail(page, created.id);
  await openDiary(page);
  const img = rows(page).first().locator('.polaroid .ph img.ph-img');
  await expect(img).toHaveAttribute('src', `/api/food/${created.id}/photo`);
  await expect.poll(() => img.evaluate((el) => el.complete && el.naturalWidth)).toBeGreaterThan(0);
  const ph = await box(rows(page).first().locator('.polaroid .ph'));
  const im = await box(img);
  expect(Math.abs(ph.width - im.width)).toBeLessThan(1.5);
  expect(Math.abs(ph.height - im.height)).toBeLessThan(1.5);
  expectNoGuardEvents(guards, [SIGNED_OUT_ME]);
});

test('a slow answer for an earlier tap never overwrites the day shown last (stale-response race)', async ({ page }) => {
  const guards = attachGuards(page);
  await register(page);
  await page.clock.install({ time: new Date(2026, 9, 7, 12, 0) });          // Wednesday 2026-10-07
  await meal(page, { name: 'מנה של יום שני', calories: 111, day: '2026-10-05', time: '09:00' });
  await meal(page, { name: 'מנה של יום שלישי', calories: 222, day: '2026-10-06', time: '09:00' });
  await openDiary(page);
  // A (Monday) answers slowly, B (Tuesday) at once
  await page.route(/\/api\/food\?date=2026-10-05$/, async (route) => { await new Promise((r) => setTimeout(r, 1500)); await route.continue(); });

  await page.locator('#screen-home .week button[data-arg="2026-10-05"]').click();   // A
  await page.locator('#screen-home .week button[data-arg="2026-10-06"]').click();   // B, before A has answered
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first().locator('.mir-name')).toHaveText('מנה של יום שלישי');
  await page.waitForTimeout(2200);                                          // A's late answer arrives now
  await expect(sel(page)).toHaveAttribute('data-arg', '2026-10-06');
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first().locator('.mir-name')).toHaveText('מנה של יום שלישי');
  await expect(page.locator('#sum-cal')).toHaveText('222');
  await expect(page.locator('#diary-date-label')).toHaveText('יום שלישי, 6 באוק׳');
  expectNoGuardEvents(guards, [SIGNED_OUT_ME]);
});

test('a failing answer for an earlier tap shows no error; a failing answer for the day shown still does', async ({ page }) => {
  const guards = attachGuards(page);
  await register(page);
  await page.clock.install({ time: new Date(2026, 9, 7, 12, 0) });          // Wednesday 2026-10-07
  await meal(page, { name: 'מנה של יום שלישי', calories: 222, day: '2026-10-06', time: '09:00' });
  await openDiary(page);
  const fail = (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INTERNAL' } }) });
  // A (Monday) fails slowly, B (Tuesday) answers at once
  await page.route(/\/api\/food\?date=2026-10-05$/, async (route) => { await new Promise((r) => setTimeout(r, 1200)); await fail(route); });

  await page.locator('#screen-home .week button[data-arg="2026-10-05"]').click();   // A
  await page.locator('#screen-home .week button[data-arg="2026-10-06"]').click();   // B, before A has failed
  await expect(rows(page).first().locator('.mir-name')).toHaveText('מנה של יום שלישי');
  await page.waitForTimeout(1900);                                          // A's failure arrives now
  // read at once, not polled: a polling `not.toHaveClass` would also pass once the toast has faded
  expect(await page.locator('#toast').evaluate((el) => el.classList.contains('show')), 'no error toast for a stale answer').toBe(false);

  // the day that is shown when its own answer fails still gets the error toast
  await page.route(/\/api\/food\?date=2026-10-05$/, fail);
  await page.locator('#screen-home .week button[data-arg="2026-10-05"]').click();
  await expect(page.locator('#toast')).toHaveClass(/show/);
  await expect(page.locator('#toast')).toHaveText('שגיאה בטעינת היומן');
  expectNoGuardEvents(guards, [SIGNED_OUT_ME, /status of 500/]);
});

test('after a delete keyboard focus moves to the next meal ערוך button, or to the list when none is left', async ({ page }) => {
  const guards = attachGuards(page);
  await register(page);
  await meal(page, { name: 'ראשונה', time: '08:00' });
  await meal(page, { name: 'שנייה', time: '12:00' });
  await meal(page, { name: 'שלישית', time: '18:00' });
  await openDiary(page);
  await expect(rows(page)).toHaveCount(3);

  await rows(page).nth(1).getByRole('button', { name: 'מחק' }).click();            // the middle one
  await expect(rows(page)).toHaveCount(2);
  await expect(rows(page).nth(1).locator('.mir-name')).toHaveText('שלישית');
  await expect(rows(page).nth(1).getByRole('button', { name: 'ערוך' })).toBeFocused();
  await rows(page).nth(1).getByRole('button', { name: 'מחק' }).click();            // the last one: nothing follows
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first().locator('.mir-name')).toHaveText('ראשונה');
  await expect(page.locator('#meal-list')).toBeFocused();
  await rows(page).first().getByRole('button', { name: 'מחק' }).click();
  await expect(page.locator('#meal-list .empty-state')).toBeVisible();
  await expect(page.locator('#meal-list')).toBeFocused();
  expectNoGuardEvents(guards, [SIGNED_OUT_ME]);
});
