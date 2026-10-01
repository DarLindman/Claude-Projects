'use strict';

// Hebrew baseline: every screen and modal, with everything that could vary pinned, and all
// visible text (plus placeholder / title / aria-label / alt / data-placeholder values, and the
// home-screen name from the apple-mobile-web-app-title meta tag and the manifest)
// compared with test/e2e/__snapshots__/he-text.json. A deliberate copy change means
// re-recording the snapshot:
//
//   UPDATE_SNAPSHOT=1 npm run test:e2e -- hebrew-baseline
//
// What is pinned so the snapshot does not flake:
//   - the browser clock (page.clock.install, it keeps ticking) and time zone/locale, so dates,
//     weekdays, month names and the stats ranges never depend on the real date;
//   - the username, the registration profile and the entry time (#res-time is filled);
//   - the AI answer (the fake client in test/e2e/server.js, text analysis of one entry);
//   - animations: a capture waits for the API calls to end and for two reads 300 ms apart to
//     agree (typed placeholder, count-up numbers, charts).
// The server's own clock is not pinned: nothing in the text comes from it, because the pinned
// date is in the past (the streak stays 0 and the dashboard pet message is the same).

const { test, expect } = require('@playwright/test');
const { attachGuards, expectNoGuardEvents, SIGNED_OUT_ME, SAVE_TO_DIARY } = require('./helpers');
const { createCollector, checkOrRecord, requireRecordedSnapshot } = require('./hebrewSnapshot');

const FIXED_NOW = new Date('2026-03-18T10:00:00Z'); // 12:00 on Wednesday 18 March, Asia/Jerusalem (UTC+2)
const USERNAME = 'baseline_user';
const PASSWORD = 'baseline-pass-1';

// Every container swept once more at the end with ALL its text nodes, hidden parts included
// (an error line, the register step, the loading state).
const SWEEP = [
  '#screen-welcome', '#screen-auth', '#screen-dashboard', '#screen-home', '#screen-camera',
  '#screen-analysis', '#screen-stats', '#screen-weight', '#screen-settings', '#bottom-nav',
  '#modal-change-pass', '#modal-profile', '#edit-modal', '#toast', '#capy-save-popup',
];

test.use({ timezoneId: 'Asia/Jerusalem', locale: 'he-IL' });

test('hebrew baseline', async ({ page }) => {
  test.setTimeout(120_000);
  // Fail fast when there is nothing to compare with (unless this run records it).
  if (process.env.UPDATE_SNAPSHOT !== '1') requireRecordedSnapshot();

  const guards = attachGuards(page);
  await page.clock.install({ time: FIXED_NOW });
  const snap = createCollector(page);
  const screen = (name) => expect(page.locator(`#screen-${name}`)).toBeVisible();

  // ── welcome, auth (login tab, register tab, profile step) ──────────────
  await page.goto('/');
  await screen('welcome');
  snap.set('document title', await page.title());
  // the home-screen name: iOS reads the meta tag, Android and desktop read the manifest
  snap.set('meta apple-mobile-web-app-title', await page.locator('meta[name="apple-mobile-web-app-title"]').getAttribute('content'));
  const manifest = await (await page.request.get('/manifest.json')).json();
  snap.set('manifest name', manifest.name);
  snap.set('manifest short_name', manifest.short_name);
  await snap.capture('welcome', '#screen-welcome');

  await page.getByRole('button', { name: 'יש לי חשבון' }).click();
  await expect(page.locator('#auth-login')).toBeVisible();
  await snap.capture('auth login tab', '#screen-auth');

  await page.locator('#auth-step1 .tab-btn', { hasText: 'הרשמה' }).click();
  await expect(page.locator('#auth-register')).toBeVisible();
  await snap.capture('auth register tab', '#screen-auth');

  await page.locator('#reg-user').fill(USERNAME);
  await page.locator('#reg-pass').fill(PASSWORD);
  await page.locator('#auth-register').getByRole('button', { name: 'הרשמה' }).click();
  await expect(page.locator('#auth-step2')).toBeVisible();
  await snap.capture('auth profile step', '#screen-auth');

  // the profile step's default weight (70) becomes the one weight entry
  await page.locator('#reg-birthdate').fill('1990-05-15');
  await page.locator('#reg-height').selectOption('175');
  await page.getByRole('button', { name: /בוא נתחיל/ }).click();

  // ── dashboard (empty), diary (empty), camera ───────────────────────────
  await screen('dashboard');
  await expect(page.locator('#pet-name-label')).toHaveText(USERNAME);
  await expect(page.locator('#pet-status-text')).not.toBeEmpty();
  await snap.capture('dashboard empty', '#screen-dashboard');
  await snap.capture('bottom nav', '#bottom-nav');

  await page.locator('#nav-home').click();
  await screen('home');
  await expect(page.locator('#meal-list .empty-state')).toBeVisible();
  await snap.capture('home empty', '#screen-home');

  await page.locator('#nav-camera').click();
  await screen('camera');
  await expect.poll(() => page.evaluate(() => {
    const ta = document.getElementById('food-text-input');
    return ta.placeholder === ta.getAttribute('data-placeholder'); // the typed placeholder is complete
  })).toBe(true);
  await snap.capture('camera', '#screen-camera');

  // ── analysis (fake AI, text), save, diary with one entry ───────────────
  await page.locator('#food-text-input').fill('סלט ולחם');
  await page.locator('#text-analyze-btn').click();
  await screen('analysis');
  await expect(page.locator('#analysis-result')).toBeVisible();
  await expect(page.locator('#res-name')).not.toHaveValue('');
  await page.locator('#res-time').fill('12:30');
  await snap.capture('analysis result', '#screen-analysis');

  await page.locator('#save-entry-btn').click();
  await screen('home');
  await expect(page.locator('#meal-list .meal-item-row')).toHaveCount(1, SAVE_TO_DIARY);
  await snap.capture('home with entry', '#screen-home');

  // ── edit modal: unchanged name, renamed (two buttons) ──────────────────
  await page.locator('#meal-list .meal-item-row').first().getByRole('button', { name: 'ערוך' }).click();
  await expect(page.locator('#edit-modal')).toHaveClass(/open/);
  await snap.capture('edit modal', '#edit-modal');
  await page.locator('#edit-name').fill('שם אחר');
  await expect(page.getByRole('button', { name: 'חשב מחדש', exact: true })).toBeVisible();
  await snap.capture('edit modal renamed', '#edit-modal');
  await page.locator('#edit-modal-close').click();
  await expect(page.locator('#edit-modal')).not.toHaveClass(/open/);

  // ── dashboard with an entry ────────────────────────────────────────────
  await page.locator('#nav-dashboard').click();
  await screen('dashboard');
  await expect(page.locator('#dash-cal-remaining')).not.toHaveText(/^(0|—)$/); // the entry's calories, counted up
  await snap.capture('dashboard with entry', '#screen-dashboard');

  // ── stats: weekly, monthly, yearly ─────────────────────────────────────
  await page.locator('#nav-stats').click();
  await screen('stats');
  await expect(page.locator('#stats-weekly')).toBeVisible();
  await snap.capture('stats weekly', '#screen-stats');
  await page.locator('.stats-tab', { hasText: 'חודשי' }).click();
  await expect(page.locator('#stats-monthly')).toBeVisible();
  await expect(page.locator('#stats-month-label')).not.toBeEmpty();
  await snap.capture('stats monthly', '#screen-stats');
  await page.locator('.stats-tab', { hasText: 'שנתי' }).click();
  await expect(page.locator('#stats-yearly')).toBeVisible();
  await expect(page.locator('#stats-year-label')).toHaveText('2026');
  await snap.capture('stats yearly', '#screen-stats');

  // ── weight ─────────────────────────────────────────────────────────────
  await page.locator('#nav-weight').click();
  await screen('weight');
  await expect(page.locator('#weight-list .weight-entry')).toHaveCount(1);
  await snap.capture('weight', '#screen-weight');

  // ── settings and its two modals ────────────────────────────────────────
  await page.locator('#nav-settings').click();
  await screen('settings');
  await expect(page.locator('#settings-user')).toContainText(USERNAME);
  await snap.capture('settings', '#screen-settings');

  await page.locator('#screen-settings .settings-item', { hasText: 'שינוי סיסמא' }).click();
  await expect(page.locator('#modal-change-pass')).toHaveClass(/open/);
  await snap.capture('modal change password', '#modal-change-pass');
  await page.locator('#modal-change-pass .modal-close').click();
  await expect(page.locator('#modal-change-pass')).not.toHaveClass(/open/);

  await page.locator('#screen-settings .settings-item', { hasText: 'פרופיל גוף ויעד' }).click();
  await expect(page.locator('#modal-profile')).toHaveClass(/open/);
  await snap.capture('modal profile', '#modal-profile');
  await page.locator('#modal-profile .modal-close').click();
  await expect(page.locator('#modal-profile')).not.toHaveClass(/open/);

  // ── sweep: every container's text nodes, hidden parts included ─────────
  for (const selector of SWEEP) await snap.capture(`sweep ${selector}`, selector, { all: true });

  expectNoGuardEvents(guards, [SIGNED_OUT_ME]);

  const { recorded, problems } = checkOrRecord(snap.data);
  if (recorded) return;
  expect(problems, `Hebrew text differs from the baseline (${problems.length} key(s)). ` +
    'If the change is deliberate, record it: UPDATE_SNAPSHOT=1 npm run test:e2e -- hebrew-baseline\n\n' +
    problems.join('\n')).toEqual([]);
});
