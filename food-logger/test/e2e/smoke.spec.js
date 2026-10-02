'use strict';

const { test, expect } = require('@playwright/test');
const { attachGuards, expectNoGuardEvents, SIGNED_OUT_ME, SAVE_TO_DIARY } = require('./helpers');

// Known baseline console noise, listed explicitly so it is visible.
// baseline, removed in Task 13/14
const ALLOWED_BASELINE = [SIGNED_OUT_ME];

const PASSWORD = 'first-password-1';
const NEW_PASSWORD = 'second-password-2';

test('full user journey', async ({ page }) => {
  const guards = attachGuards(page);
  const username = `user${Date.now()}`;

  // ── welcome -> register ────────────────────────────────────────────────
  await page.goto('/');
  await expect(page.locator('#screen-welcome')).toBeVisible();
  await page.getByRole('button', { name: 'התחל עכשיו' }).click();
  await expect(page.locator('#screen-auth')).toBeVisible();
  await page.locator('#reg-user').fill(username);
  await page.locator('#reg-pass').fill(PASSWORD);
  await page.locator('#auth-register').getByRole('button', { name: 'הרשמה' }).click();

  // profile step: fill birth date and height, then finish
  await expect(page.locator('#auth-step2')).toBeVisible();
  await page.locator('#reg-birthdate').fill('1990-05-15');
  await page.locator('#reg-height').selectOption('175');
  await page.getByRole('button', { name: /בוא נתחיל/ }).click();

  // ── dashboard ──────────────────────────────────────────────────────────
  await expect(page.locator('#screen-dashboard')).toBeVisible();
  await expect(page.locator('#bottom-nav')).toBeVisible();
  await expect(page.locator('#pet-name-label')).toHaveText(username);

  // ── add food by text (fake analysis) ───────────────────────────────────
  await page.locator('#nav-camera').click();
  await expect(page.locator('#screen-camera')).toBeVisible();
  await page.locator('#food-text-input').fill('סלט ולחם');
  await page.locator('#text-analyze-btn').click();
  await expect(page.locator('#screen-analysis')).toBeVisible();
  await expect(page.locator('#analysis-result')).toBeVisible();
  await expect(page.locator('#res-name')).not.toHaveValue('');
  await expect(page.locator('#res-cal')).not.toHaveValue('');
  const analysedCal = Number(await page.locator('#res-cal').inputValue());
  expect(analysedCal).toBeGreaterThan(0);

  // ── save -> diary ──────────────────────────────────────────────────────
  await page.locator('#save-entry-btn').click();
  await expect(page.locator('#screen-home')).toBeVisible(SAVE_TO_DIARY);
  const rows = page.locator('#meal-list .meal-item-row');
  await expect(rows).toHaveCount(1);
  await expect(page.locator('#sum-cal')).toHaveText(String(Math.round(analysedCal)));

  // ── edit the name ──────────────────────────────────────────────────────
  await rows.first().getByRole('button', { name: 'ערוך' }).click();
  await expect(page.locator('#edit-modal')).toHaveClass(/open/);
  await page.locator('#edit-name').fill('שם ערוך');
  await page.getByRole('button', { name: 'שמור מבלי לחשב מחדש' }).click();
  await expect(page.locator('#edit-modal')).not.toHaveClass(/open/);
  await expect(rows.first().locator('.mir-name')).toHaveText('שם ערוך');

  // ── delete the entry ───────────────────────────────────────────────────
  await rows.first().getByRole('button', { name: 'מחק' }).click();
  await expect(rows).toHaveCount(0);
  await expect(page.locator('#meal-list .empty-state')).toBeVisible();
  await expect(page.locator('#sum-cal')).toHaveText('0');

  // ── stats: weekly, monthly, yearly ─────────────────────────────────────
  await page.locator('#nav-stats').click();
  await expect(page.locator('#screen-stats')).toBeVisible();
  await expect(page.locator('#stats-weekly')).toBeVisible();
  await page.locator('.stats-tab', { hasText: 'חודשי' }).click();
  await expect(page.locator('#stats-monthly')).toBeVisible();
  await expect(page.locator('#stats-weekly')).toBeHidden();
  await expect(page.locator('#stats-month-label')).not.toBeEmpty();
  await page.locator('.stats-tab', { hasText: 'שנתי' }).click();
  await expect(page.locator('#stats-yearly')).toBeVisible();
  await expect(page.locator('#stats-year-label')).toHaveText(String(new Date().getFullYear()));

  // ── weight: add and delete ─────────────────────────────────────────────
  await page.locator('#nav-weight').click();
  await expect(page.locator('#screen-weight')).toBeVisible();
  // the registration profile step logs its default weight (70.0)
  const weights = page.locator('#weight-list .weight-entry');
  await expect(weights).toHaveCount(1);
  await expect(weights.first().locator('.weight-val-big')).toContainText('70.0');
  await page.locator('#weight-val').fill('70.5');
  await page.locator('#screen-weight').getByRole('button', { name: 'הוסף', exact: true }).click();
  await expect(weights).toHaveCount(2);
  const added = weights.filter({ hasText: '70.5' });
  await expect(added).toHaveCount(1);
  await added.getByRole('button', { name: 'מחק' }).click();
  await expect(weights).toHaveCount(1);
  await expect(weights.filter({ hasText: '70.5' })).toHaveCount(0);

  // ── settings -> change password ────────────────────────────────────────
  await page.locator('#nav-settings').click();
  await expect(page.locator('#screen-settings')).toBeVisible();
  await expect(page.locator('#settings-user')).toContainText(username);
  await page.getByText('שינוי סיסמה', { exact: true }).first().click();
  await expect(page.locator('#modal-change-pass')).toHaveClass(/open/);
  await page.locator('#cp-current').fill(PASSWORD);
  await page.locator('#cp-new').fill(NEW_PASSWORD);
  await page.locator('#modal-change-pass').getByRole('button', { name: 'שמור', exact: true }).click();
  await expect(page.locator('#modal-change-pass')).not.toHaveClass(/open/);
  await expect(page.locator('#cp-error')).toBeEmpty();

  // ── logout ─────────────────────────────────────────────────────────────
  await page.locator('#screen-settings .settings-item', { hasText: 'יציאה' }).click();
  await expect(page.locator('#screen-auth')).toBeVisible();
  await expect(page.locator('#bottom-nav')).toBeHidden();
  // the session is a cookie now: nothing in storage, and the server no longer knows us
  expect(await page.evaluate(() => [localStorage.getItem('fl_token'), localStorage.getItem('fl_username')])).toEqual([null, null]);
  expect((await page.context().cookies()).filter((c) => c.name === 'fl_session')).toEqual([]);
  expect(await page.evaluate(() => fetch('/auth/me').then((r) => r.status))).toBe(401);

  // ── log in with the new password ───────────────────────────────────────
  await page.locator('#auth-step1 .tab-btn', { hasText: 'כניסה' }).click();
  await page.locator('#login-user').fill(username);
  await page.locator('#login-pass').fill(NEW_PASSWORD);
  await page.locator('#auth-login').getByRole('button', { name: 'כניסה' }).click();
  await expect(page.locator('#screen-dashboard')).toBeVisible();
  await expect(page.locator('#pet-name-label')).toHaveText(username);

  expectNoGuardEvents(guards, ALLOWED_BASELINE);
});
