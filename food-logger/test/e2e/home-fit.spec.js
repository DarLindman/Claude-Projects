'use strict';

// The home screen is ONE page: date, greeting, the capybara with her bubble, the big calories and the goal line, the red bar, the
// streak, the last meal as a polaroid (with its name and circled calories) and the weight line all fit above the dock without
// scrolling, at 390x844, 360x740, 360x640 and 320x640, with data (a photo meal with a long name, a long user name) and in the fresh
// and no-profile states. Height-based compaction in screens.css makes room; no element is removed.

const { test, expect } = require('@playwright/test');
const { attachGuards, expectNoGuardEvents, SIGNED_OUT_ME, localNow } = require('./helpers');
const { realJpeg } = require('../helpers/jpeg');

const PASSWORD = 'fit-pass-1234';
const CSRF = { Origin: 'http://localhost:3100', 'X-FL-Client': '1' };
const post = (page, url, data) => page.request.post(url, { headers: CSRF, data });
const put = (page, url, data) => page.request.put(url, { headers: CSRF, data });
const TAG = String(Date.now()).slice(-6);
let counter = 0;
const unique = (base) => `${base}${TAG}${counter++}`;
const suffix = () => `${TAG}${counter++}`;   // user names are unique

const SIZES = [[390, 844], [360, 740], [360, 640], [320, 640]];
const PROFILE = { gender: 'male', birthDate: '1990-05-15', height: 175, weight: 70, activity: 'light', goalKg: 0 };
const LONG_MEAL = 'חזה עוף בגריל עם אורז מלא וסלט ירקות גדול ורוטב טחינה ביתי';
const LONG_USER = 'אברמוביץ בן דוד ירושלמי המאוד ארוך של הפרויקט';

const dayBack = (n) => {
  const [y, m, d] = localNow().date.split('-').map(Number);
  const date = new Date(y, m - 1, d - n);
  const p = (x) => String(x).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
};

async function seed(page, { username, profile = PROFILE, meals = 0, photo = false, weights = false, streakDays = 1 }) {
  const reg = await post(page, '/auth/register', { username, password: PASSWORD });
  expect(reg.status(), await reg.text()).toBe(200);
  if (profile) expect((await put(page, '/api/profile', profile)).status()).toBe(200);
  for (let back = 0; back < streakDays && meals > 0; back++) {
    const res = await post(page, '/api/food', {
      meal_type: 'lunch', food_name: back === 0 ? LONG_MEAL : 'ארוחה', calories: 640, protein_g: 30, carbs_g: 80, fat_g: 20, fiber_g: 4,
      logged_at: `${dayBack(back)}T${back === 0 ? '13:00' : '12:00'}:00`,
    });
    expect(res.status(), await res.text()).toBe(200);
    if (photo && back === 0) {
      const up = await page.request.put(`/api/food/${(await res.json()).id}/photo`, { headers: { ...CSRF, 'Content-Type': 'image/jpeg' }, data: realJpeg(24, 24, 90) });
      expect(up.status()).toBe(200);
    }
  }
  if (weights) expect((await post(page, '/api/weight', { weight_kg: 74.2, logged_at: dayBack(0) })).status()).toBe(200);
}

const STATES = [
  ['a photo meal with a long name, a long user name, a streak and a weight', () => ({ username: `${LONG_USER.slice(0, 36)} ${suffix()}`, meals: 1, photo: true, weights: true, streakDays: 6 })],
  ['a user name of 40 letters without a space (the greeting and the bubble wrap anywhere)', () => ({ username: `${'א'.repeat(30)}${suffix()}`, meals: 1, photo: true, weights: true, streakDays: 3 })],
  ['a meal without a photo, short names', () => ({ username: unique('fit'), meals: 1, streakDays: 2 })],
  ['a fresh user (the first-meal prompt, the sleeping capybara)', () => ({ username: unique('fresh'), meals: 0, weights: true })],
  ['a user without a profile (no goal, no bar) who ate today', () => ({ username: unique('noprof'), profile: null, meals: 1, photo: true, streakDays: 4 })],
  ['a user without a profile and without meals', () => ({ username: unique('nopnone'), profile: null, meals: 0 })],
];

const NAMED = [
  ['ribbon', '#screen-dashboard .content > .ribbon'], ['date', '#dash-date'], ['greeting', '#screen-dashboard .dash-hello'],
  ['bubble', '#pet-bubble'], ['capybara', '#pet-dashboard-wrap svg'], ['number', '#screen-dashboard .eat'], ['bar', '#dash-bar'],
  ['streak line', '#dash-streak .dash-streak-line'], ['tally', '#dash-tally svg'], ['polaroid', '#screen-dashboard .dash-polaroid'],
  ['meal name', '#screen-dashboard .dash-meal-name'], ['calories circle', '#screen-dashboard .dash-meal .circ'], ['kcal', '#screen-dashboard .dash-kcal'],
  ['weight', '#dash-weight'],
];

for (const [width, height] of SIZES) {
  for (const [label, make] of STATES) {
    test(`${width}x${height}: the home page fits without scrolling, nothing overlaps: ${label}`, async ({ page }) => {
      const guards = attachGuards(page);
      await page.setViewportSize({ width, height });
      await seed(page, make());
      await page.goto('/');
      await expect(page.locator('#screen-dashboard')).toBeVisible();
      await expect(page.locator('#pet-status-text')).not.toHaveText('טוען...');
      await page.evaluate(() => document.fonts.ready);
      // the polaroid drops in with an animation; measure it where it rests
      await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect.getComputedTiming().iterations !== Infinity).map((a) => a.finished.catch(() => {}))));

      const r = await page.evaluate((NAMED) => {
        const content = document.querySelector('#screen-dashboard .content');
        const cr = content.getBoundingClientRect();
        const pr = document.querySelector('#screen-dashboard .page').getBoundingClientRect();
        const dock = document.getElementById('bottom-nav').getBoundingClientRect();
        const boxes = {};
        for (const [name, sel] of NAMED) {
          const el = document.querySelector(sel);
          if (!el || el.hidden || el.closest('[hidden]')) continue;
          const b = el.getBoundingClientRect();
          if (!b.width || !b.height) continue;
          boxes[name] = { l: b.left, t: b.top, r: b.right, b: b.bottom };
        }
        content.scrollTop = 100000;
        return { overflow: content.scrollHeight - content.clientHeight, scrolled: content.scrollTop, cr: { l: cr.left, t: cr.top, r: cr.right, b: cr.bottom }, pr: { l: pr.left, t: pr.top, r: pr.right, b: pr.bottom }, dockTop: dock.top, boxes, vw: innerWidth, vh: innerHeight };
      }, NAMED);

      // the bookmark hangs from the very top edge of the paper page
      expect(Math.abs(r.boxes.ribbon.t - r.pr.t), `the ribbon starts ${r.boxes.ribbon.t - r.pr.t}px below the top of the page`).toBeLessThanOrEqual(2);
      expect(r.overflow, `the content is taller than its box by ${r.overflow}px`).toBeLessThanOrEqual(0);
      expect(r.scrolled, 'nothing to scroll').toBe(0);
      const names = Object.keys(r.boxes);
      expect(names, 'the elements that must be there are measured').toEqual(expect.arrayContaining(['date', 'greeting', 'bubble', 'capybara', 'number', 'ribbon']));
      const hit = (a, c) => a.l < c.r - 0.5 && c.l < a.r - 0.5 && a.t < c.b - 0.5 && c.t < a.b - 0.5;
      for (const name of names) {
        const b = r.boxes[name];
        expect(b.l >= r.pr.l - 1 && b.r <= r.pr.r + 1, `${name} inside the page horizontally`).toBe(true);
        expect(b.t >= r.cr.t - 1 && b.b <= r.cr.b + 1, `${name} inside the visible content (${JSON.stringify(b)} vs ${JSON.stringify(r.cr)})`).toBe(true);
        expect(b.b, `${name} above the dock`).toBeLessThanOrEqual(r.dockTop + 1);
      }
      for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
        expect(hit(r.boxes[names[i]], r.boxes[names[j]]), `${names[i]} overlaps ${names[j]}`).toBe(false);
      }
      expectNoGuardEvents(guards, [SIGNED_OUT_ME]);
    });
  }
}
