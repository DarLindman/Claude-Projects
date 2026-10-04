'use strict';

// Task 14b: the target weight ("יעד משקל") end to end. A handwritten field in the profile modal (#mp-goal-weight), a row in the
// settings page, the server's `goalWeight` profile field, and the weight screen's goal text and dashed goal line. Nothing here
// fakes the profile response: the value goes through the real PUT and GET.

const { test, expect, request: pwRequest } = require('@playwright/test');
const { attachGuards, expectNoGuardEvents, SIGNED_OUT_ME, localNow } = require('./helpers');

const PASSWORD = 'target-pass-1234';
const ORIGIN = 'http://localhost:3100';
const CSRF = { Origin: ORIGIN, 'X-FL-Client': '1' };
const post = (page, url, data) => page.request.post(url, { headers: CSRF, data });
const put = (page, url, data) => page.request.put(url, { headers: CSRF, data });
const uniqueName = () => `tw${Date.now()}${Math.floor(Math.random() * 1000)}`;
const PROFILE = { gender: 'male', birthDate: '1990-05-15', height: 175, weight: 70, activity: 'light', goalKg: -0.5 };

async function register(page, { username = uniqueName(), profile = PROFILE } = {}) {
  const reg = await post(page, '/auth/register', { username, password: PASSWORD });
  expect(reg.status(), await reg.text()).toBe(200);
  if (profile) expect((await put(page, '/api/profile', profile)).status()).toBe(200);
  const w = await post(page, '/api/weight', { weight_kg: 72, logged_at: localNow().date });
  expect(w.status(), await w.text()).toBe(200);
  return username;
}

async function registerElsewhere(username) {
  const ctx = await pwRequest.newContext({ baseURL: ORIGIN, extraHTTPHeaders: CSRF });
  const res = await ctx.post('/auth/register', { data: { username, password: PASSWORD } });
  expect(res.status(), await res.text()).toBe(200);
  await ctx.dispose();
}

async function openSettings(page) {
  await page.goto('/');
  await expect(page.locator('#screen-dashboard')).toBeVisible();
  await page.locator('#nav-settings').click();
  await expect(page.locator('#screen-settings')).toBeVisible();
}
const openProfile = (page) => page.locator('#screen-settings').getByRole('button', { name: 'פרופיל גוף ויעד' }).click();
const saveProfile = (page) => page.getByRole('button', { name: 'שמור פרופיל' }).click();
const goalRow = (page) => page.locator('#screen-settings .row2').filter({ has: page.locator('#settings-goalweight') });
const apiProfile = async (page) => (await page.request.get('/api/profile')).json();

async function weightHead(page) {
  await page.locator('#nav-weight').click();
  await expect(page.locator('#screen-weight')).toBeVisible();
  await expect(page.locator('#weight-chart svg')).toBeVisible();
  return page.locator('#weight-head');
}

test('the profile modal has the target-weight field and the settings page the row, both "not set" without a goal', async ({ page }) => {
  const guards = attachGuards(page);
  await register(page);
  await openSettings(page);
  await expect(goalRow(page)).toHaveText(/^יעד משקל\s*לא הוגדר$/);
  await openProfile(page);
  const field = page.getByLabel('יעד משקל');
  await expect(field).toHaveAttribute('id', 'mp-goal-weight');
  await expect(field).toHaveValue('');
  await expect(page.locator('#modal-profile label[for="mp-goal-weight"]')).toHaveText('יעד משקל (ק״ג)');
  expect(await field.getAttribute('inputmode')).toBe('decimal');
  expect(await field.getAttribute('step')).toBe('0.1');
  // handwritten like the other fields: an ink underline, no box
  const style = await field.evaluate((el) => { const cs = getComputedStyle(el); return { bt: cs.borderTopWidth, bb: cs.borderBottomWidth, bg: cs.backgroundColor }; });
  expect(style).toEqual({ bt: '0px', bb: '2px', bg: 'rgba(0, 0, 0, 0)' });
  // the buttons keep their names
  await expect(page.getByRole('button', { name: 'שמור פרופיל' })).toBeVisible();
  expectNoGuardEvents(guards, [SIGNED_OUT_ME]);
});

test('saving a target weight stores it, shows it in the settings row in the digit font and on the weight screen without a reload', async ({ page }) => {
  const guards = attachGuards(page);
  await register(page);
  await openSettings(page);
  await openProfile(page);
  await page.locator('#mp-goal-weight').fill('68.5');
  await saveProfile(page);
  await expect(page.locator('#modal-profile')).not.toHaveClass(/open/);

  await expect(goalRow(page)).toHaveText(/^יעד משקל\s*68\.5 ק״ג$/);
  const font = await page.locator('#settings-goalweight').evaluate((el) => getComputedStyle(el).fontFamily);
  expect(font.startsWith('Digits'), `digit font, got ${font}`).toBe(true);
  expect(await apiProfile(page)).toMatchObject({ goalWeight: 68.5, height: 175, goalKg: -0.5, activity: 'light', gender: 'male' });

  // the slip opens again with the saved value
  await openProfile(page);
  await expect(page.locator('#mp-goal-weight')).toHaveValue('68.5');
  await page.locator('#modal-profile .modal-close').click();

  // the weight screen, no reload: the goal text and the dashed line
  const head = await weightHead(page);
  await expect(head).toContainText('ק״ג · יעד 68.5');
  await expect(page.locator('#weight-chart svg .goal-line')).toHaveCount(1);
  expect(await page.locator('#weight-chart svg .goal-line').getAttribute('stroke-dasharray')).toBeTruthy();

  // and after a reload the server's value is the one shown
  await page.reload();
  await expect(page.locator('#screen-dashboard')).toBeVisible();
  await page.locator('#nav-weight').click();
  await expect(page.locator('#weight-head')).toContainText('ק״ג · יעד 68.5');
  await expect(page.locator('#weight-chart svg .goal-line')).toHaveCount(1);
  expectNoGuardEvents(guards, [SIGNED_OUT_ME]);
});

test('a whole-number goal shows without decimals; clearing the field unsets it (0): "לא הוגדר", no goal text, no goal line', async ({ page }) => {
  await register(page, { profile: { ...PROFILE, goalWeight: 70 } });
  await openSettings(page);
  await expect(goalRow(page)).toHaveText(/^יעד משקל\s*70 ק״ג$/);
  let head = await weightHead(page);
  await expect(head).toContainText('ק״ג · יעד 70');
  await expect(page.locator('#weight-chart svg .goal-line')).toHaveCount(1);

  await page.locator('#nav-settings').click();
  await openProfile(page);
  await expect(page.locator('#mp-goal-weight')).toHaveValue('70');
  await page.locator('#mp-goal-weight').fill('');
  await saveProfile(page);
  await expect(page.locator('#modal-profile')).not.toHaveClass(/open/);
  await expect(goalRow(page)).toHaveText(/^יעד משקל\s*לא הוגדר$/);
  expect((await apiProfile(page)).goalWeight).toBe(0);

  head = await weightHead(page);
  await expect(head).toContainText('ק״ג');
  await expect(head).not.toContainText('יעד');
  await expect(page.locator('#weight-chart svg .goal-line')).toHaveCount(0);
});

test('an invalid target weight shows the inline error, keeps the slip open and stores nothing', async ({ page }) => {
  const guards = attachGuards(page);
  await register(page, { profile: { ...PROFILE, goalWeight: 66 } });
  await openSettings(page);
  await openProfile(page);
  for (const bad of ['5', '19.9', '401', '-3']) {
    await page.locator('#mp-goal-weight').fill(bad);
    await saveProfile(page);
    await expect(page.locator('#mp-error'), bad).toHaveText('הזן משקל תקין');
    await expect(page.locator('#modal-profile')).toHaveClass(/open/);
  }
  expect((await apiProfile(page)).goalWeight).toBe(66);
  await expect(goalRow(page)).toHaveText(/^יעד משקל\s*66 ק״ג$/);
  // a valid value clears the error and saves
  await page.locator('#mp-goal-weight').fill('65.5');
  await saveProfile(page);
  await expect(page.locator('#modal-profile')).not.toHaveClass(/open/);
  await expect(page.locator('#mp-error')).toBeEmpty();
  expect((await apiProfile(page)).goalWeight).toBe(65.5);
  expectNoGuardEvents(guards, [SIGNED_OUT_ME]);
});

test('an old profile without the field loads: "לא הוגדר" and the weight screen has no goal', async ({ page }) => {
  await register(page);
  expect('goalWeight' in (await apiProfile(page))).toBe(false);
  await openSettings(page);
  await expect(goalRow(page)).toHaveText(/^יעד משקל\s*לא הוגדר$/);
  const head = await weightHead(page);
  await expect(head).not.toContainText('יעד');
});

test('the goal of one user does not reach the next after logout: row, slip, cache and weight screen', async ({ page }) => {
  const guards = attachGuards(page);
  const userB = `${uniqueName()}b`;
  await registerElsewhere(userB);
  await register(page, { profile: { ...PROFILE, goalWeight: 68.5 } });
  await openSettings(page);
  await expect(goalRow(page)).toContainText('68.5');
  await openProfile(page);
  await page.locator('#mp-goal-weight').fill('55');   // typed, never saved
  await page.evaluate(async () => { await (await import('/js/session.js')).doLogout(); });
  await expect(page.locator('#screen-auth')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('fl_profile'))).toBeNull();
  await expect(page.locator('#mp-goal-weight')).toHaveValue('');
  await expect(goalRow(page)).toHaveText(/^יעד משקל\s*לא הוגדר$/);

  await page.locator('#auth-step1 .tab-btn', { hasText: 'כניסה' }).click();
  await page.locator('#login-user').fill(userB);
  await page.locator('#login-pass').fill(PASSWORD);
  await page.locator('#auth-login').getByRole('button', { name: 'כניסה' }).click();
  await expect(page.locator('#screen-dashboard')).toBeVisible();
  await page.locator('#nav-settings').click();
  await expect(goalRow(page)).toHaveText(/^יעד משקל\s*לא הוגדר$/);
  await openProfile(page);
  await expect(page.locator('#mp-goal-weight')).toHaveValue('');
  await page.locator('#modal-profile .modal-close').click();
  const w = await post(page, '/api/weight', { weight_kg: 80, logged_at: localNow().date });
  expect(w.status()).toBe(200);
  const head = await weightHead(page);
  await expect(head).not.toContainText('יעד');
  await expect(page.locator('#weight-chart svg .goal-line')).toHaveCount(0);
  expectNoGuardEvents(guards, [SIGNED_OUT_ME, /status of 400/, /status of 401/, /status of 403/]);
});

for (const [width, height] of [[390, 844], [320, 640]]) {
  test(`layout at ${width} px: the new row's value sits at the left edge and the slip field stays inside the slip`, async ({ page }) => {
    await register(page, { profile: { ...PROFILE, goalWeight: 68.5 } });
    await page.setViewportSize({ width, height });
    await openSettings(page);
    const m = await page.evaluate(() => {
      const row = document.getElementById('settings-goalweight').closest('.row2');
      const r = row.getBoundingClientRect();
      const b = document.getElementById('settings-goalweight').getBoundingClientRect();
      const label = row.querySelector('span').getBoundingClientRect();
      return { leftGap: b.left - r.left, labelGap: label.left - b.right, doc: document.documentElement.scrollWidth, inner: window.innerWidth };
    });
    expect(m.leftGap).toBeLessThanOrEqual(1);
    expect(m.labelGap).toBeGreaterThan(20);
    expect(m.doc).toBeLessThanOrEqual(m.inner);
    await openProfile(page);
    const f = await page.evaluate(() => {
      const i = document.getElementById('mp-goal-weight').getBoundingClientRect();
      const s = document.querySelector('#modal-profile .modal-sheet').getBoundingClientRect();
      return { inside: i.left >= s.left && i.right <= s.right, width: i.width };
    });
    expect(f.inside).toBe(true);
    expect(f.width).toBeGreaterThan(60);
  });
}

// ── review round 1 ───────────────────────────────────────────────────────────────────────────────

test('garbled text in the number field is an invalid value, not "empty": error, slip stays open, the stored goal is kept', async ({ page }) => {
  const guards = attachGuards(page);
  await register(page, { profile: { ...PROFILE, goalWeight: 66 } });
  await openSettings(page);
  await openProfile(page);
  await page.locator('#mp-goal-weight').fill('');
  await page.locator('#mp-goal-weight').focus();
  await page.keyboard.type('68.5.1');
  expect(await page.locator('#mp-goal-weight').evaluate((el) => ({ value: el.value, bad: el.validity.badInput }))).toEqual({ value: '', bad: true });
  await saveProfile(page);
  await expect(page.locator('#mp-error')).toHaveText('הזן משקל תקין');
  await expect(page.locator('#modal-profile')).toHaveClass(/open/);
  expect((await apiProfile(page)).goalWeight).toBe(66);
  await expect(goalRow(page)).toHaveText(/^יעד משקל\s*66 ק״ג$/);
  // really empty still unsets
  await page.locator('#mp-goal-weight').fill('');
  await saveProfile(page);
  await expect(page.locator('#modal-profile')).not.toHaveClass(/open/);
  expect((await apiProfile(page)).goalWeight).toBe(0);
  expectNoGuardEvents(guards, [SIGNED_OUT_ME]);
});

test('adding a weight on the weight screen keeps the stored target weight (the profile write-back sends the whole profile)', async ({ page }) => {
  await register(page, { profile: { ...PROFILE, goalWeight: 68.5 } });
  await openSettings(page);
  await weightHead(page);
  await page.locator('#weight-val').fill('71.3');
  await page.locator('#screen-weight').getByRole('button', { name: 'הוסף שקילה', exact: true }).click();
  await expect(page.locator('#weight-head .wt-big')).toHaveText('71.3');
  await expect.poll(async () => (await apiProfile(page)).weight, 'the profile follows the newest weight').toBe(71.3);
  expect(await apiProfile(page)).toMatchObject({ goalWeight: 68.5, height: 175, goalKg: -0.5 });
  await expect(page.locator('#weight-head')).toContainText('ק״ג · יעד 68.5');
});

test('double submit: a second save while the first is in flight sends nothing; the button is disabled meanwhile and free again after', async ({ page }) => {
  await register(page);
  await openSettings(page);
  await openProfile(page);
  const puts = [];
  await page.route('**/api/profile', async (route) => {
    if (route.request().method() !== 'PUT') return route.continue();
    puts.push(route.request().postData());
    await new Promise((r) => setTimeout(r, 700));
    await route.continue();
  });
  await page.locator('#mp-goal-weight').fill('64');
  const btn = page.locator('#modal-profile [data-action="saveMpProfile"]');
  await btn.click();
  await expect(btn).toBeDisabled();
  await btn.dispatchEvent('click');   // a click that still reaches the handler (a disabled button gets none from a real tap)
  await page.evaluate(async () => { await (await import('/js/screens/settings.js')).saveMpProfile(); });
  await expect(page.locator('#modal-profile')).not.toHaveClass(/open/);
  expect(puts).toHaveLength(1);
  await expect(page.locator('#toast')).toHaveText('הפרופיל נשמר');
  await openProfile(page);
  await expect(btn).toBeEnabled();
  expect((await apiProfile(page)).goalWeight).toBe(64);
});

test('a sign-out during a save frees the button, and the late reply shows nothing to the next person', async ({ page }) => {
  const userB = `${uniqueName()}b`;
  await registerElsewhere(userB);
  await register(page);
  await openSettings(page);
  await openProfile(page);
  await page.route('**/api/profile', async (route) => {
    if (route.request().method() !== 'PUT') return route.continue();
    await new Promise((r) => setTimeout(r, 800));
    await route.continue();
  });
  await page.locator('#mp-goal-weight').fill('64');
  const btn = page.locator('#modal-profile [data-action="saveMpProfile"]');
  await btn.click();
  await expect(btn).toBeDisabled();
  await page.evaluate(async () => { await (await import('/js/session.js')).doLogout(); });
  await expect(page.locator('#screen-auth')).toBeVisible();
  await expect(btn).toBeEnabled();
  await page.waitForTimeout(1200);   // the late reply arrives
  await expect(page.locator('#toast')).not.toHaveClass(/show/);
  await expect(page.locator('#screen-auth')).toBeVisible();
  await expect(goalRow(page)).toHaveText(/^יעד משקל\s*לא הוגדר$/);
});
