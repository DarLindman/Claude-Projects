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

// ── CSP ─────────────────────────────────────────────────────────────────────

const APP_ORIGIN = 'http://localhost:3100';

test('the full journey runs under the CSP: no violations, no console errors, no request leaves the app origin', async ({ page }) => {
  const guards = attachGuards(page);
  const external = [];
  page.on('request', (req) => {
    const url = req.url();
    if (url.startsWith('data:') || url.startsWith('blob:')) return;
    if (new URL(url).origin !== APP_ORIGIN) external.push(url);
  });

  const username = `csp${Date.now()}`;
  await registerViaUi(page, username);

  // add food by text, save, delete
  await page.locator('#nav-camera').click();
  await page.locator('#food-text-input').fill('סלט ולחם');
  await page.locator('#text-analyze-btn').click();
  await expect(page.locator('#analysis-result')).toBeVisible();
  await page.locator('#save-entry-btn').click();
  const rows = page.locator('#meal-list .meal-item-row');
  await expect(rows).toHaveCount(1);
  await rows.first().getByRole('button', { name: 'מחק' }).click();
  await expect(rows).toHaveCount(0);

  // stats tabs, weight, settings, logout, login again
  await page.locator('#nav-stats').click();
  await page.locator('.stats-tab', { hasText: 'חודשי' }).click();
  await page.locator('.stats-tab', { hasText: 'שנתי' }).click();
  await expect(page.locator('#stats-yearly')).toBeVisible();
  await page.locator('#nav-weight').click();
  await expect(page.locator('#screen-weight')).toBeVisible();
  await page.locator('#nav-settings').click();
  await expect(page.locator('#settings-user')).toContainText(username);
  await page.locator('#screen-settings .settings-item', { hasText: 'יציאה' }).click();
  await expect(page.locator('#screen-auth')).toBeVisible();
  await page.locator('#auth-step1 .tab-btn', { hasText: 'כניסה' }).click();
  await page.locator('#login-user').fill(username);
  await page.locator('#login-pass').fill(PASSWORD);
  await page.locator('#auth-login').getByRole('button', { name: 'כניסה' }).click();
  await expect(page.locator('#screen-dashboard')).toBeVisible();

  expect(guards.csp, `CSP violations: ${guards.csp.join('; ')}`).toEqual([]);
  // Only the expected 401 of GET /auth/me on signed-out page loads may reach the console.
  expect(guards.errors.filter((m) => !SIGNED_OUT_ME.test(m))).toEqual([]);
  expect(external, `requests that left ${APP_ORIGIN}`).toEqual([]);
});

test('the self-hosted fonts are the ones in use (no Google Fonts)', async ({ page }) => {
  const fontRequests = [];
  page.on('request', (req) => { if (req.resourceType() === 'font') fontRequests.push(req.url()); });
  await page.goto('/');
  await expect(page.locator('#screen-welcome')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  const faces = await page.evaluate(() => [...document.fonts].filter((f) => f.status === 'loaded').map((f) => `${f.family}|${f.style}|${f.weight}`));
  expect(faces.length).toBeGreaterThan(0);
  expect(fontRequests.length).toBeGreaterThan(0);
  for (const url of fontRequests) expect(url.startsWith(`${APP_ORIGIN}/fonts/`), url).toBe(true);
});

test('the CSP is enforced by the browser: injected inline script and inline handlers do not run', async ({ page }) => {
  const guards = attachGuards(page);
  await page.goto('/');
  await expect(page.locator('#screen-welcome')).toBeVisible();

  await page.evaluate(() => {
    const s = document.createElement('script');
    s.textContent = 'window.__pwned = 1';
    document.body.appendChild(s);
    const img = document.createElement('img');
    img.setAttribute('src', 'x');
    img.setAttribute('onerror', 'window.__pwnedHandler = 1');
    document.body.appendChild(img);
  });
  // give the violation events and the failed image load a moment
  await page.waitForFunction(() => document.querySelector('img[onerror]')?.complete === true);
  await expect.poll(() => guards.csp.length).toBeGreaterThanOrEqual(2);

  expect(await page.evaluate(() => [typeof window.__pwned, typeof window.__pwnedHandler])).toEqual(['undefined', 'undefined']);
  expect(guards.csp.some((m) => /script-src-elem/.test(m)), guards.csp.join('; ')).toBe(true);
  expect(guards.csp.some((m) => /script-src-attr/.test(m)), guards.csp.join('; ')).toBe(true);
});

// ── A session that dies between /auth/me and the calls right after it ────────

test('a session lost while setLoggedIn loads the profile stops the boot: no dashboard, no bottom nav', async ({ page }) => {
  const username = `lost${Date.now()}`;
  const reg = await page.context().request.post('/auth/register', {
    headers: { Origin: APP_ORIGIN, 'X-FL-Client': '1' },
    data: { username, password: PASSWORD },
  });
  expect(reg.status()).toBe(200);

  // Record, from the very first moment, whether the dashboard was ever shown or the nav ever displayed.
  await page.addInitScript(() => {
    window.__shown = { dashboard: false, nav: false };
    new MutationObserver(() => {
      const dash = document.getElementById('screen-dashboard');
      const nav = document.getElementById('bottom-nav');
      if (dash && dash.classList.contains('active')) window.__shown.dashboard = true;
      if (nav && nav.style.display === 'flex') window.__shown.nav = true;
    }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style'] });
  });

  // /auth/me succeeds (real server); the calls that follow report the session as gone.
  // The logout call is held back so the boot code cannot lose the race by luck.
  const loaded = [];
  let releaseLogout;
  const logoutHeld = new Promise((resolve) => { releaseLogout = resolve; });
  await page.route('**/api/profile', (route) => {
    loaded.push('profile');
    return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: { code: 'SESSION_EXPIRED' } }) });
  });
  await page.route('**/api/weight', (route) => {
    loaded.push('weight');
    return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: { code: 'SESSION_EXPIRED' } }) });
  });
  await page.route('**/auth/logout', async (route) => { await logoutHeld; await route.continue(); });

  await page.goto('/');
  await expect.poll(() => loaded.includes('profile')).toBe(true);
  // Let the pending boot code run to the end while the logout is still in flight.
  await page.waitForTimeout(500);
  releaseLogout();

  await expect(page.locator('#screen-auth')).toBeVisible();
  await expect(page.locator('#bottom-nav')).toBeHidden();
  expect(await page.evaluate(() => window.__shown), 'the dashboard or the nav flashed up after the session was lost').toEqual({ dashboard: false, nav: false });
});
