'use strict';

// The browser's local clock decides what "today" is. Around local midnight (and in any time
// zone) the diary, an edit-and-save and the streak must all agree on the same day. The
// Playwright fake clock puts the browser at 23:30 on one day and then at 00:30 on the next.

const { test, expect } = require('@playwright/test');
const { attachGuards, expectNoGuardEvents, SIGNED_OUT_ME, SAVE_TO_DIARY } = require('./helpers');

const PASSWORD = 'first-password-1';

test('diary, edit-and-save and streak around local midnight', async ({ page }) => {
  const guards = attachGuards(page);
  const username = `user${Date.now()}`;
  const streakNum = page.locator('#dash-streak-num');   // "יום אחד" for a streak of 1 (formatDayCount)
  const rows = page.locator('#meal-list .meal-item-row');

  // 2026-06-15 23:30 local: late evening, when local and UTC dates can differ
  await page.clock.install({ time: new Date(2026, 5, 15, 23, 30) });
  await page.goto('/');

  // register
  await page.getByRole('button', { name: 'התחל עכשיו' }).click();
  await page.locator('#reg-user').fill(username);
  await page.locator('#reg-pass').fill(PASSWORD);
  await page.locator('#auth-register').getByRole('button', { name: 'הרשמה' }).click();
  await expect(page.locator('#auth-step2')).toBeVisible();
  await page.locator('#reg-birthdate').fill('1990-05-15');
  await page.locator('#reg-height').selectOption('175');
  await page.getByRole('button', { name: /בוא נתחיל/ }).click();
  await expect(page.locator('#screen-dashboard')).toBeVisible();

  // one meal by text
  await page.locator('#nav-camera').click();
  await page.locator('#food-text-input').fill('סלט ולחם');
  await page.locator('#text-analyze-btn').click();
  await expect(page.locator('#analysis-result')).toBeVisible();
  await page.locator('#save-entry-btn').click();
  await expect(page.locator('#screen-home')).toBeVisible(SAVE_TO_DIARY);
  await expect(page.locator('#diary-date-label')).toContainText('היום');
  await expect(rows).toHaveCount(1);

  // the dashboard streak counts today
  await page.locator('#nav-dashboard').click();
  await expect(page.locator('#screen-dashboard')).toBeVisible();
  await expect(streakNum).toHaveText('יום אחד');

  // edit only the name: the meal must stay on today's diary page
  await page.locator('#nav-home').click();
  await expect(rows).toHaveCount(1);
  await rows.first().getByRole('button', { name: 'ערוך' }).click();
  await expect(page.locator('#edit-modal')).toHaveClass(/open/);
  await page.locator('#edit-name').fill('שם ערוך');
  await page.getByRole('button', { name: 'שמור מבלי לחשב מחדש' }).click();
  await expect(page.locator('#edit-modal')).not.toHaveClass(/open/);
  await expect(page.locator('#diary-date-label')).toContainText('היום');
  await expect(rows).toHaveCount(1);
  await expect(rows.first().locator('.mir-name')).toHaveText('שם ערוך');

  // 2026-06-16 00:30 local: the meal now belongs to yesterday
  await page.clock.setFixedTime(new Date(2026, 5, 16, 0, 30));
  await page.reload();
  await expect(page.locator('#screen-dashboard')).toBeVisible();
  await expect(streakNum).toHaveText('יום אחד'); // yesterday still counts
  await page.locator('#nav-home').click();
  await expect(page.locator('#diary-date-label')).toContainText('היום');
  await expect(page.locator('#meal-list .empty-state')).toBeVisible();
  await expect(rows).toHaveCount(0);

  await page.locator('#screen-home button[data-action="changeDay"][data-arg="-1"]').click();
  await expect(page.locator('#diary-date-label')).not.toContainText('היום');
  await expect(rows).toHaveCount(1);
  await expect(rows.first().locator('.mir-name')).toHaveText('שם ערוך');

  // the weekly chart has one data point, on yesterday (not on today), and counts one logged day
  await page.locator('#nav-stats').click();
  await expect(page.locator('#screen-stats')).toBeVisible();
  const dataDots = page.locator('#weekly-chart circle[r="3.5"], #weekly-chart circle[r="4.5"]');
  await expect(dataDots).toHaveCount(1);
  await expect(page.locator('#weekly-chart circle[r="3.5"]')).toHaveCount(1); // 3.5 = not today
  await expect(page.locator('#weekly-chart circle[r="4.5"]')).toHaveCount(0);

  expectNoGuardEvents(guards, [SIGNED_OUT_ME]);
});
