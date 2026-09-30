'use strict';

const { test, expect } = require('@playwright/test');
const { attachGuards, expectNoGuardEvents, SIGNED_OUT_ME } = require('./helpers');

const PASSWORD = 'hardening-pass-1';
const JWT_SHAPED = /eyJ[\w-]+\.[\w-]+\./;

// Known baseline console noise, listed explicitly so it is visible.
const ALLOWED_BASELINE = [SIGNED_OUT_ME];

async function registerViaUi(page, username) {
  await page.goto('/');
  await expect(page.locator('#screen-welcome')).toBeVisible();
  await page.getByRole('button', { name: 'התחל עכשיו' }).click();
  await page.locator('#reg-user').fill(username);
  await page.locator('#reg-pass').fill(PASSWORD);
  await page.locator('#auth-register').getByRole('button', { name: 'הרשמה' }).click();
  await expect(page.locator('#auth-step2')).toBeVisible();
  await page.getByRole('button', { name: 'דלג לעת עתה' }).click();
  await expect(page.locator('#screen-dashboard')).toBeVisible();
}

async function loginViaUi(page, username) {
  await page.goto('/');
  await expect(page.locator('#screen-welcome')).toBeVisible();
  await page.getByRole('button', { name: 'התחל עכשיו' }).click();
  await page.locator('#auth-step1 .tab-btn', { hasText: 'כניסה' }).click();
  await page.locator('#login-user').fill(username);
  await page.locator('#login-pass').fill(PASSWORD);
  await page.locator('#auth-login').getByRole('button', { name: 'כניסה' }).click();
  await expect(page.locator('#screen-dashboard')).toBeVisible();
}

// Every value in localStorage and sessionStorage.
const storageValues = (page) => page.evaluate(() => {
  const all = [];
  for (const store of [localStorage, sessionStorage]) {
    for (let i = 0; i < store.length; i++) all.push(`${store.key(i)}=${store.getItem(store.key(i))}`);
  }
  return all;
});

async function expectNoTokenReadable(page) {
  expect(await page.evaluate(() => document.cookie)).not.toContain('fl_session');
  for (const v of await storageValues(page)) expect(v).not.toMatch(JWT_SHAPED);
}

test('the session is an HttpOnly cookie, never readable from JavaScript, and survives a reload', async ({ page }) => {
  const guards = attachGuards(page);
  const username = `hard${Date.now()}`;
  await registerViaUi(page, username);

  const cookies = (await page.context().cookies()).filter((c) => c.name === 'fl_session');
  expect(cookies).toHaveLength(1);
  expect(cookies[0].httpOnly).toBe(true);
  expect(cookies[0].sameSite).toBe('Strict');
  expect(cookies[0].path).toBe('/');
  await expectNoTokenReadable(page);

  // Legacy keys from the Bearer-token client are removed on boot.
  await page.evaluate(() => {
    localStorage.setItem('fl_token', 'eyJhbGciOiJIUzI1NiJ9.eyJpZCI6MX0.legacy');
    localStorage.setItem('fl_username', 'legacy');
  });
  await page.reload();
  await expect(page.locator('#screen-dashboard')).toBeVisible();
  await expect(page.locator('#bottom-nav')).toBeVisible();
  await expect(page.locator('#pet-name-label')).toHaveText(username);
  expect(await page.evaluate(() => [localStorage.getItem('fl_token'), localStorage.getItem('fl_username')])).toEqual([null, null]);
  await expectNoTokenReadable(page);

  expectNoGuardEvents(guards, ALLOWED_BASELINE);
});

test('logout-all from a second browser signs the first one out on its next API call', async ({ page, browser }) => {
  const username = `multi${Date.now()}`;
  await registerViaUi(page, username);

  const other = await browser.newContext();
  try {
    const second = await other.newPage();
    await loginViaUi(second, username);
    const status = await second.evaluate(() =>
      fetch('/auth/logout-all', { method: 'POST', headers: { 'X-FL-Client': '1' } }).then((r) => r.status));
    expect(status).toBe(200);
  } finally {
    await other.close();
  }

  // The first browser still shows the dashboard until it talks to the server.
  await expect(page.locator('#screen-dashboard')).toBeVisible();
  await page.locator('#nav-home').click();
  await expect(page.locator('#screen-auth')).toBeVisible();
  await expect(page.locator('#bottom-nav')).toBeHidden();
  expect((await page.context().cookies()).filter((c) => c.name === 'fl_session')).toEqual([]);
});

test('a wrong current password on change-password does not sign the user out', async ({ page }) => {
  const username = `wrongcp${Date.now()}`;
  await registerViaUi(page, username);
  await page.locator('#nav-settings').click();
  await page.getByText('שינוי סיסמא', { exact: true }).first().click();
  await expect(page.locator('#modal-change-pass')).toHaveClass(/open/);
  await page.locator('#cp-current').fill('not-the-password');
  await page.locator('#cp-new').fill('another-password-3');
  await page.locator('#modal-change-pass').getByRole('button', { name: 'שמור', exact: true }).click();
  await expect(page.locator('#cp-error')).toHaveText('סיסמא נוכחית שגויה');
  await expect(page.locator('#screen-settings')).toBeVisible();
  await expect(page.locator('#bottom-nav')).toBeVisible();
  expect(await page.evaluate(() => fetch('/auth/me').then((r) => r.json()))).toEqual({ username });
});
