'use strict';

const { test, expect } = require('@playwright/test');
const { attachGuards, expectNoGuardEvents, SIGNED_OUT_ME, localNow } = require('./helpers');

// Foundation of the diary look (Task 2): the self-hosted handwriting fonts load, nothing is
// fetched from another origin, every number on a visible screen is drawn with the `Digits`
// family (the first entry of the body font stack), and nothing scrolls sideways at 320 px.

const PASSWORD = 'first-password-1';

// Every visible text node that contains a digit, outside the receipt and the phone's own
// chrome, must be drawn by a font-family list that starts with `Digits`.
async function digitOffenders(page) {
  return page.evaluate(() => {
    const offenders = [];
    let seen = 0;
    const visible = (el) => {
      for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
        const cs = getComputedStyle(e);
        if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      }
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!/[0-9]/.test(n.nodeValue)) continue;
      const el = n.parentElement;
      if (!el || ['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT'].includes(el.tagName)) continue;
      if (el.closest('.receipt, [data-native-chrome]')) continue;
      if (!visible(el)) continue;
      seen += 1;
      const family = getComputedStyle(el).fontFamily;
      const first = family.split(',')[0].trim().replace(/^["']|["']$/g, '');
      if (first !== 'Digits') offenders.push(`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}.${el.className && el.className.baseVal === undefined ? el.className : ''} "${n.nodeValue.trim().slice(0, 30)}" -> ${family}`);
    }
    // A number typed in a field (a value, not a text node) is drawn by the field's own font.
    for (const el of document.body.querySelectorAll('input, select, textarea')) {
      if (!visible(el) || el.closest('.receipt')) continue;
      const text = el.tagName === 'SELECT' ? (el.selectedOptions[0] ? el.selectedOptions[0].textContent : '') : el.value;
      if (!/[0-9]/.test(text)) continue;
      seen += 1;
      const family = getComputedStyle(el).fontFamily;
      const first = family.split(',')[0].trim().replace(/^["']|["']$/g, '');
      if (first !== 'Digits') offenders.push(`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''} value "${String(text).trim().slice(0, 30)}" -> ${family}`);
    }
    return { seen, offenders };
  });
}

const noSidewaysScroll = (page) =>
  page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));

async function fontsLoaded(page) {
  return page.evaluate(async () => {
    const result = {};
    for (const [family, sample] of [['Gveret Levin', 'שלום'], ['Suez One', 'יומן'], ['Digits', '0123456789']]) {
      await document.fonts.load(`16px "${family}"`, sample);
      const faces = [...document.fonts].filter((f) => f.family.replace(/["']/g, '') === family);
      result[family] = {
        check: document.fonts.check(`16px "${family}"`, sample),
        loaded: faces.some((f) => f.status === 'loaded'),
      };
    }
    return result;
  });
}

test('fonts, same-origin requests, digit family and 320 px fit', async ({ page, baseURL }) => {
  const guards = attachGuards(page);
  const origin = new URL(baseURL).origin;
  const foreign = [];
  page.on('request', (req) => {
    const url = req.url();
    if (url.startsWith('data:') || url.startsWith('blob:')) return;
    if (new URL(url).origin !== origin) foreign.push(url);
  });

  // ── welcome ───────────────────────────────────────────────────────────
  await page.goto('/');
  await expect(page.locator('#screen-welcome')).toBeVisible();

  const loaded = await fontsLoaded(page);
  for (const family of ['Gveret Levin', 'Suez One', 'Digits']) {
    expect(loaded[family], family).toEqual({ check: true, loaded: true });
  }
  const stack = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
  expect(stack.replace(/["']/g, '')).toMatch(/^Digits, Gveret Levin, Playpen Sans Hebrew, cursive$/);

  const welcome = await digitOffenders(page);
  expect(welcome.offenders, 'welcome digit font').toEqual([]);

  await page.setViewportSize({ width: 320, height: 640 });
  let w = await noSidewaysScroll(page);
  expect(w.scrollWidth, 'welcome at 320px').toBeLessThanOrEqual(w.innerWidth);
  await page.setViewportSize({ width: 390, height: 844 });

  // ── register, then every screen of the dock ───────────────────────────
  await page.getByRole('button', { name: 'התחל עכשיו' }).click();
  await expect(page.locator('#screen-auth')).toBeVisible();
  const authDigits = await digitOffenders(page);
  expect(authDigits.offenders, 'auth digit font').toEqual([]);
  await page.locator('#reg-user').fill(`user${Date.now()}`);
  await page.locator('#reg-pass').fill(PASSWORD);
  await page.locator('#auth-register').getByRole('button', { name: 'הרשמה' }).click();
  await expect(page.locator('#auth-step2')).toBeVisible();
  const step2 = await digitOffenders(page);
  expect(step2.seen, 'the height list has digits').toBeGreaterThan(0);
  expect(step2.offenders, 'profile step digit font').toEqual([]);
  await page.locator('#reg-birthdate').fill('1990-05-15');
  await page.locator('#reg-height').selectOption('175');
  await page.getByRole('button', { name: /בוא נתחיל/ }).click();
  await expect(page.locator('#screen-dashboard')).toBeVisible();
  await expect(page.locator('#bottom-nav')).toBeVisible();

  const loadedAfter = await fontsLoaded(page);
  for (const family of ['Gveret Levin', 'Suez One', 'Digits']) {
    expect(loadedAfter[family], family).toEqual({ check: true, loaded: true });
  }

  let digitsSeenTotal = 0;
  for (const [nav, screen] of [
    ['#nav-dashboard', '#screen-dashboard'],
    ['#nav-home', '#screen-home'],
    ['#nav-camera', '#screen-camera'],
    ['#nav-stats', '#screen-stats'],
    ['#nav-weight', '#screen-weight'],
    ['#nav-settings', '#screen-settings'],
  ]) {
    await page.locator(nav).click();
    await expect(page.locator(screen)).toBeVisible();
    const { seen, offenders } = await digitOffenders(page);
    digitsSeenTotal += seen;
    expect(offenders, `${screen} digit font`).toEqual([]);

    await page.setViewportSize({ width: 320, height: 640 });
    w = await noSidewaysScroll(page);
    expect(w.scrollWidth, `${screen} at 320px`).toBeLessThanOrEqual(w.innerWidth);
    await page.setViewportSize({ width: 390, height: 844 });
  }
  expect(digitsSeenTotal, 'the walker saw digits on the app screens').toBeGreaterThan(0);

  // ── nothing left the origin ───────────────────────────────────────────
  expect(foreign, 'requests to other origins').toEqual([]);
  expectNoGuardEvents(guards, [SIGNED_OUT_ME]);
});

// Every screen again, this time WITH data (meals, weights, a target weight, an analysis result), every
// view of the stats and every modal: each digit, in a text or typed in a field, must be drawn in the digit family.
test('every digit on every screen with data, every stats view and every modal is drawn in the digit font', async ({ page }) => {
  const guards = attachGuards(page);
  const CSRF = { Origin: 'http://localhost:3100', 'X-FL-Client': '1' };
  const send = async (method, url, data) => { const r = await page.request[method](url, { headers: CSRF, data }); expect(r.status(), await r.text()).toBe(200); return r; };
  const dayOffset = (n) => { const d = new Date(); d.setDate(d.getDate() - n); const p = (x) => String(x).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };

  await send('post', '/auth/register', { username: `digits${Date.now()}`, password: PASSWORD });
  await send('put', '/api/profile', { gender: 'female', birthDate: '1990-05-15', height: 168, weight: 64.5, activity: 'moderate', goalKg: -0.5, goalWeight: 60.5 });
  for (const [n, kcal] of [[0, 1341], [1, 1980], [2, 2230], [5, 1500]]) {
    await send('post', '/api/food', { meal_type: 'lunch', food_name: 'סלט ולחם', calories: kcal, protein_g: 31, carbs_g: 120, fat_g: 44, fiber_g: 9, logged_at: `${dayOffset(n)}T12:30:00` });
  }
  for (const [n, kg] of [[0, 64.5], [3, 65.1], [9, 66]]) await send('post', '/api/weight', { weight_kg: kg, logged_at: dayOffset(n) });

  const check = async (label, { hasDigits = true } = {}) => {   // the add-meal page has no number before a photo is analysed
    const { seen, offenders } = await digitOffenders(page);
    if (hasDigits) expect(seen, `${label}: there are digits to look at`).toBeGreaterThan(0);
    expect(offenders, `${label}: digit font`).toEqual([]);
  };
  const go = async (nav, screen) => { await page.locator(nav).click(); await expect(page.locator(screen)).toBeVisible(); };

  await page.goto('/');
  await expect(page.locator('#screen-dashboard')).toBeVisible();
  await expect(page.locator('#dash-last .dash-meal .circ')).toContainText('1,341');
  await check('dashboard');

  await go('#nav-home', '#screen-home');
  await expect(page.locator('#meal-list .meal-item-row')).toHaveCount(1);
  await check('diary');
  await page.locator('#meal-list .meal-item-row').first().getByRole('button', { name: 'ערוך' }).click();
  await expect(page.locator('#edit-modal')).toHaveClass(/open/);
  await expect(page.locator('#edit-cal')).toHaveValue('1341');
  await check('edit modal');
  await page.locator('#edit-modal-close').click();
  await expect(page.locator('#edit-modal')).not.toHaveClass(/open/);

  await go('#nav-camera', '#screen-camera');
  await check('add meal', { hasDigits: false });
  await page.locator('#food-text-input').fill('סלט');
  await page.locator('#text-analyze-btn').click();
  await expect(page.locator('#analysis-result')).toBeVisible();
  await expect(page.locator('#res-cal')).not.toHaveValue('');
  await check('analysis result');

  await go('#nav-stats', '#screen-stats');
  await expect(page.locator('#weekly-chart svg')).toBeVisible();
  await check('stats weekly');
  await page.locator('.stats-tab', { hasText: 'חודשי' }).click();
  await expect(page.locator('#monthly-chart svg')).toBeVisible();
  await check('stats monthly');
  await page.locator('.stats-tab', { hasText: 'שנתי' }).click();
  await expect(page.locator('#yearly-chart svg')).toBeVisible();
  await check('stats yearly');

  await go('#nav-weight', '#screen-weight');
  await expect(page.locator('#weight-list .weight-entry')).toHaveCount(3);
  await expect(page.locator('#weight-chart svg')).toBeVisible();
  await check('weight');

  await go('#nav-settings', '#screen-settings');
  await check('settings');
  await page.locator('#screen-settings').getByRole('button', { name: 'פרופיל גוף ויעד' }).click();
  await expect(page.locator('#modal-profile')).toHaveClass(/open/);
  await expect(page.locator('#mp-goal-weight')).toHaveValue('60.5');
  await check('profile modal');
  await page.locator('#modal-profile .modal-close').click();
  await expect(page.locator('#modal-profile')).not.toHaveClass(/open/);
  await page.locator('#screen-settings').getByRole('button', { name: 'שינוי סיסמה' }).click();
  await expect(page.locator('#modal-change-pass')).toHaveClass(/open/);
  await page.locator('#cp-new').fill('12345678');
  await check('change password modal');

  expectNoGuardEvents(guards, [SIGNED_OUT_ME]);
});

// On a short phone (320x568) the welcome cover, the sign-in screen and the tall profile step must
// scroll inside the frame: the first element is reachable from the top, the last button from the bottom.
test('welcome, auth and profile step 2 scroll on a 320x568 phone', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/');
  await expect(page.locator('#screen-welcome')).toBeVisible();

  const reach = async (screen, top, bottom, label) => {   // `screen` is the element that scrolls
    const r = await page.evaluate(({ screen, top, bottom }) => {
      const s = document.querySelector(screen);
      const sr = () => s.getBoundingClientRect();
      const first = document.querySelector(top);
      const last = document.querySelector(bottom);
      s.scrollTop = 0;
      const topAtTop = first.getBoundingClientRect().top - sr().top;
      s.scrollTop = s.scrollHeight;
      const bottomAtEnd = sr().bottom - last.getBoundingClientRect().bottom;
      return { topAtTop, bottomAtEnd, scrollable: s.scrollHeight > s.clientHeight };
    }, { screen, top, bottom });
    expect(r.topAtTop, `${label}: first element reachable from the top`).toBeGreaterThanOrEqual(0);
    expect(r.bottomAtEnd, `${label}: last button reachable by scrolling`).toBeGreaterThanOrEqual(0);
    return r;
  };

  await reach('#screen-welcome', '.welcome-pet', '#screen-welcome [data-arg="login"]', 'welcome');   // compacted for short phones: whether it still scrolls or not, every part is reachable

  await page.getByRole('button', { name: 'התחל עכשיו' }).click();
  await expect(page.locator('#screen-auth')).toBeVisible();
  await reach('#screen-auth .content', '.auth-wordmark', '#auth-login .penbtn', 'auth');

  await page.locator('#auth-step1 .tab-btn', { hasText: 'הרשמה' }).click();
  await page.locator('#reg-user').fill(`user${Date.now()}`);
  await page.locator('#reg-pass').fill(PASSWORD);
  await page.locator('#auth-register').getByRole('button', { name: 'הרשמה' }).click();
  await expect(page.locator('#auth-step2')).toBeVisible();
  const step2 = await reach('#screen-auth .content', '#auth-step2 > .auth-link', '[data-action="skipRegProfile"]', 'profile step 2');
  expect(step2.scrollable, 'profile step 2 is taller than a 568 px phone').toBe(true);
});
