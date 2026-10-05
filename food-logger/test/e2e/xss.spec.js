'use strict';

// Task 14: user-controlled text (food names, notes, usernames) must render as inert text
// on every screen. The strict CSP is the second layer: any script or handler that did get
// injected would also show up as a CSP violation through attachGuards.

const { test, expect } = require('@playwright/test');
const { attachGuards, expectNoGuardEvents, SAVE_TO_DIARY, localNow } = require('./helpers');

const PASSWORD = 'xss-pass-1234';
const CSRF = { Origin: 'http://localhost:3100', 'X-FL-Client': '1' };

const PAYLOADS = [
  '<img src=x onerror=window.__x=1>',
  '"><script>window.__x=1</script>',
  "'</textarea><svg onload=window.__x=1>",
];

const post = (page, url, data) => page.request.post(url, { headers: CSRF, data });

// Nothing was executed and nothing dangerous was created in the DOM.
async function expectInert(page, where) {
  const state = await page.evaluate(() => ({
    x: window.__x,
    imgs: document.querySelectorAll('img[src="x"]').length,
    svgOnload: document.querySelectorAll('svg[onload]').length,
    handlerAttrs: document.querySelectorAll('[onerror],[onload],[onclick]').length,
    injectedScripts: [...document.querySelectorAll('script')].filter((s) => /__x/.test(s.textContent)).length,
    textareaBreakout: document.querySelectorAll('textarea + svg').length,
  }));
  expect(state, `not inert on ${where}`).toEqual({
    x: undefined, imgs: 0, svgOnload: 0, handlerAttrs: 0, injectedScripts: 0, textareaBreakout: 0,
  });
}

for (const [i, payload] of PAYLOADS.entries()) {
  test(`payload #${i + 1} renders as text in the diary, edit modal, stats, weight list and settings`, async ({ page }) => {
    const guards = attachGuards(page);
    const other = PAYLOADS[(i + 1) % PAYLOADS.length];

    // The account name, the food name and the notes are all hostile.
    const reg = await post(page, '/auth/register', { username: payload, password: PASSWORD });
    expect(reg.status(), await reg.text()).toBe(200);
    // Seed like the real app: the date comes from the browser's (local) clock, never from the
    // server's UTC fallback. Fixed times on the local day so they never cross midnight.
    const { date } = localNow();
    const food = await post(page, '/api/food', {
      meal_type: 'lunch', food_name: payload, calories: 300, protein_g: 10, carbs_g: 20, fat_g: 5, fiber_g: 2, notes: other,
      logged_at: `${date}T09:00:00`,
    });
    expect(food.status(), await food.text()).toBe(200);
    const second = await post(page, '/api/food', {
      meal_type: 'dinner', food_name: other, calories: 100, protein_g: 1, carbs_g: 2, fat_g: 3, fiber_g: 4, notes: payload,
      logged_at: `${date}T13:00:00`,
    });
    expect(second.status()).toBe(200);
    expect((await post(page, '/api/weight', { weight_kg: 71.5, logged_at: date })).status()).toBe(200);

    // ── dashboard: the username is shown (pet name + pet message) ────────
    await page.goto('/');
    await expect(page.locator('#screen-dashboard')).toBeVisible();
    await expect(page.locator('#pet-name-label')).toHaveText(payload);
    // the last meal of the day (the dinner) is shown as a polaroid with its name
    await expect(page.locator('#dash-last .dash-meal-name')).toHaveText(other);
    await expectInert(page, 'dashboard');

    // ── diary ────────────────────────────────────────────────────────────
    await page.locator('#nav-home').click();
    await expect(page.locator('#screen-home')).toBeVisible();
    const names = page.locator('#meal-list .mir-name');
    await expect(names).toHaveCount(2);
    // entries of one day are listed oldest first: the payload entry, then the other one
    await expect(names).toHaveText([payload, other]);
    // getByText finds the literal payload as text
    await expect(page.locator('#meal-list').getByText(payload, { exact: true })).toBeVisible();
    await expect(page.locator('#meal-list img')).toHaveCount(0);
    await expectInert(page, 'diary');

    // ── edit modal: prefilled through .value, and the button row is rebuilt ──
    await page.locator('#meal-list .meal-item-row').first().getByRole('button', { name: 'ערוך' }).click();
    await expect(page.locator('#edit-modal')).toHaveClass(/open/);
    await expect(page.locator('#edit-name')).toHaveValue(payload);
    await page.locator('#edit-name').fill(payload + payload);
    await expect(page.getByRole('button', { name: 'חשב מחדש', exact: true })).toBeVisible();
    await expectInert(page, 'edit modal');
    await page.locator('#edit-modal-close').click();

    // ── stats (all three tabs) ───────────────────────────────────────────
    await page.locator('#nav-stats').click();
    await expect(page.locator('#screen-stats')).toBeVisible();
    await expect(page.locator('#weekly-chart svg')).toBeVisible();
    await expectInert(page, 'weekly stats');
    await page.locator('.stats-tab', { hasText: 'חודשי' }).click();
    await expect(page.locator('#monthly-chart svg')).toBeVisible();
    await expectInert(page, 'monthly stats');
    await page.locator('.stats-tab', { hasText: 'שנתי' }).click();
    await expect(page.locator('#yearly-chart svg')).toBeVisible();
    await expectInert(page, 'yearly stats');

    // ── weight list ──────────────────────────────────────────────────────
    await page.locator('#nav-weight').click();
    await expect(page.locator('#screen-weight')).toBeVisible();
    await expect(page.locator('#weight-list .weight-entry')).toHaveCount(1);
    await expect(page.locator('#weight-list .weight-val-big')).toContainText('71.5');
    await expect(page.locator('#weight-chart svg')).toBeVisible();
    await expectInert(page, 'weight');

    // ── settings: "מחובר בתור <username>" ──────────────────────────────
    await page.locator('#nav-settings').click();
    await expect(page.locator('#screen-settings')).toBeVisible();
    await expect(page.locator('#settings-user')).toHaveText(`מחובר בתור ${payload}`);
    await expect(page.locator('#settings-user').getByText(payload)).toBeVisible();
    await expectInert(page, 'settings');

    // A reload starts from the stored data and must be just as inert.
    await page.reload();
    await expect(page.locator('#screen-dashboard')).toBeVisible();
    await expectInert(page, 'dashboard after reload');

    expectNoGuardEvents(guards);
  });
}

test('a hostile name typed into the analysis result is saved and rendered as text', async ({ page }) => {
  const guards = attachGuards(page);
  const username = `xssui${Date.now()}`;
  const payload = PAYLOADS[0];
  const reg = await post(page, '/auth/register', { username, password: PASSWORD });
  expect(reg.status()).toBe(200);
  await page.goto('/');
  await expect(page.locator('#screen-dashboard')).toBeVisible();

  await page.locator('#nav-camera').click();
  await page.locator('#food-text-input').fill('סלט');
  await page.locator('#text-analyze-btn').click();
  await expect(page.locator('#analysis-result')).toBeVisible();
  await page.locator('#res-name').fill(payload);
  await page.locator('#save-entry-btn').click();

  await expect(page.locator('#screen-home')).toBeVisible(SAVE_TO_DIARY);
  await expect(page.locator('#meal-list .mir-name')).toHaveText(payload);
  await expectInert(page, 'diary after UI save');
  expectNoGuardEvents(guards);
});

test('the stats chart renderers escape hostile data', async ({ page }) => {
  const guards = attachGuards(page);
  const reg = await post(page, '/auth/register', { username: `xssmod${Date.now()}`, password: PASSWORD });
  expect(reg.status()).toBe(200);
  await page.goto('/');
  await expect(page.locator('#screen-dashboard')).toBeVisible();
  const payload = PAYLOADS[0];

  await page.evaluate(async ({ payload }) => {
    const charts = await import('/js/charts.js');
    const host = document.createElement('div');
    host.id = 'xss-host';
    host.innerHTML = '<div id="avg-box"></div><div id="macro-box"></div><div id="line-box"></div>';
    document.body.appendChild(host);

    charts.renderStatAvgBox('avg-box', [{ calories: 100 }], 2000, payload);
    charts.renderStatMacros('macro-box', [{ protein_g: 1, carbs_g: 1, fat_g: 1, fiber_g: 1 }], payload);
    document.getElementById('line-box').innerHTML = ''; // not user-facing markup; the chart is rendered below
    const svg = charts.renderBarChart([{ v: 1, l: payload }, { v: 2, l: payload }], {
      getValue: (r) => r.v, getLabel: (r) => r.l, isToday: () => false, recommended: 0,
    });
    // renderBarChart returns a trusted fragment; render it the same way the screens do
    const { setHtml } = await import('/js/dom.js');
    setHtml(document.getElementById('line-box'), svg);
  }, { payload });

  await expect(page.locator('#avg-box .avg-label')).toHaveText(payload);
  await expect(page.locator('#macro-box')).toContainText(payload);
  await expect(page.locator('#line-box text').first()).toHaveText(payload);
  await expectInert(page, 'renderers');
  expectNoGuardEvents(guards);
});
