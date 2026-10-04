'use strict';

// Task 14: the settings screen as a diary page (handwritten rows, red "התנתקות", the walking capybara) and the three
// modals (profile, change password, edit meal) as taped paper slips on a dimmed page. Users and meals are seeded through
// the API the way the real client sends them.

const { test, expect, request: pwRequest } = require('@playwright/test');
const { attachGuards, expectNoGuardEvents, SIGNED_OUT_ME, localNow } = require('./helpers');

const PASSWORD = 'settings-pass-1234';
const ORIGIN = 'http://localhost:3100';
const CSRF = { Origin: ORIGIN, 'X-FL-Client': '1' };
const post = (page, url, data) => page.request.post(url, { headers: CSRF, data });
const put = (page, url, data) => page.request.put(url, { headers: CSRF, data });
const uniqueName = () => `set${Date.now()}${Math.floor(Math.random() * 1000)}`;

const PROFILE = { gender: 'male', birthDate: '1990-05-15', height: 175, weight: 70, activity: 'light', goalKg: -0.5 };

async function register(page, { username = uniqueName(), profile = PROFILE } = {}) {
  const reg = await post(page, '/auth/register', { username, password: PASSWORD });
  expect(reg.status(), await reg.text()).toBe(200);
  if (profile) {
    const prof = await put(page, '/api/profile', profile);
    expect(prof.status(), await prof.text()).toBe(200);
  }
  return username;
}

// A second account made in a context of its own, so the page's cookie is untouched.
async function registerElsewhere(username) {
  const ctx = await pwRequest.newContext({ baseURL: ORIGIN, extraHTTPHeaders: CSRF });
  const res = await ctx.post('/auth/register', { data: { username, password: PASSWORD } });
  expect(res.status(), await res.text()).toBe(200);
  await ctx.dispose();
}

async function meal(page, { name = 'סלט ולחם', calories = 300, time = '12:30' } = {}) {
  const res = await post(page, '/api/food', {
    meal_type: 'lunch', food_name: name, calories, protein_g: 10, carbs_g: 20, fat_g: 5, fiber_g: 2,
    logged_at: `${localNow().date}T${time}:00`,
  });
  expect(res.status(), await res.text()).toBe(200);
  return res.json();
}

async function openSettings(page) {
  await page.goto('/');
  await expect(page.locator('#screen-dashboard')).toBeVisible();
  await page.locator('#nav-settings').click();
  await expect(page.locator('#screen-settings')).toBeVisible();
}

// Every visible text node with a digit under `rootSelector` (and every visible form control whose value has a digit) must be
// drawn by a font-family list that starts with `Digits`. `seen` makes the test non-vacuous.
async function digitOffenders(page, rootSelector) {
  return page.evaluate((rootSelector) => {
    const root = document.querySelector(rootSelector);
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
    const check = (el, text) => {
      seen += 1;
      const family = getComputedStyle(el).fontFamily;
      const first = family.split(',')[0].trim().replace(/^["']|["']$/g, '');
      if (first !== 'Digits') offenders.push(`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''} "${String(text).trim().slice(0, 30)}" -> ${family}`);
    };
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!/[0-9]/.test(n.nodeValue)) continue;
      const el = n.parentElement;
      if (!el || ['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'OPTION'].includes(el.tagName)) continue;
      if (el.closest('.receipt, [data-native-chrome]') || !visible(el)) continue;
      check(el, n.nodeValue);
    }
    for (const el of root.querySelectorAll('input, select')) {
      if (!visible(el)) continue;
      const text = el.tagName === 'SELECT' ? el.selectedOptions[0]?.textContent || '' : el.value;
      if (/[0-9]/.test(text)) check(el, text);
    }
    return { seen, offenders };
  }, rootSelector);
}

const overflowX = (page) => page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));

// The slip of an open modal, in the viewport.
async function slipInfo(page, modalId) {
  // the slip drops in with a spring: measure it where it rests
  await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect.getComputedTiming().iterations !== Infinity).map((a) => a.finished.catch(() => {}))));
  return page.evaluate((modalId) => {
    const overlay = document.getElementById(modalId);
    const sheet = overlay.querySelector('.modal-sheet');
    const body = overlay.querySelector('.slip-body');
    const tape = overlay.querySelector('.tape');
    const ocs = getComputedStyle(overlay);
    const scs = getComputedStyle(sheet);
    const sr = sheet.getBoundingClientRect();
    const or = overlay.getBoundingClientRect();
    const tr = tape ? tape.getBoundingClientRect() : null;
    const rgb = (scs.backgroundColor.match(/[\d.]+/g) || []).map(Number);
    const bg = (ocs.backgroundColor.match(/[\d.]+/g) || []).map(Number);
    return {
      overlayFixed: ocs.position === 'fixed',
      overlayCoversViewport: or.left <= 0 && or.top <= 0 && or.right >= window.innerWidth && or.bottom >= window.innerHeight,
      dimAlpha: bg.length === 4 ? bg[3] : 1,
      dimLuma: (bg[0] + bg[1] + bg[2]) / 3,
      sheetLuma: (rgb[0] + rgb[1] + rgb[2]) / 3,
      sheet: { left: sr.left, top: sr.top, right: sr.right, bottom: sr.bottom, width: sr.width, height: sr.height },
      tapeOnTopEdge: !!tr && tr.top < sr.top + 8 && tr.bottom > sr.top - 4 && tr.left >= sr.left && tr.right <= sr.right,
      scrolls: body.scrollHeight > body.clientHeight + 1,
      viewport: { w: window.innerWidth, h: window.innerHeight },
    };
  }, modalId);
}

function expectSlipLooksRight(info, label) {
  expect(info.overlayFixed, `${label}: the overlay is fixed`).toBe(true);
  expect(info.overlayCoversViewport, `${label}: the overlay covers the viewport`).toBe(true);
  expect(info.dimAlpha, `${label}: the page behind is dimmed`).toBeGreaterThanOrEqual(0.4);
  expect(info.dimLuma, `${label}: the dimming is dark`).toBeLessThan(80);
  expect(info.sheetLuma, `${label}: the slip is paper-light`).toBeGreaterThan(215);
  expect(info.tapeOnTopEdge, `${label}: washi tape on the top edge`).toBe(true);
  const s = info.sheet;
  expect(s.left, `${label}: slip inside the viewport (left)`).toBeGreaterThanOrEqual(8);
  expect(s.top, `${label}: slip inside the viewport (top)`).toBeGreaterThanOrEqual(8);
  expect(s.right, `${label}: slip inside the viewport (right)`).toBeLessThanOrEqual(info.viewport.w - 8);
  expect(s.bottom, `${label}: slip inside the viewport (bottom)`).toBeLessThanOrEqual(info.viewport.h - 8);
}

const openProfile = (page) => page.locator('#screen-settings').getByRole('button', { name: 'פרופיל גוף ויעד' }).click();
const openChangePass = (page) => page.locator('#screen-settings').getByRole('button', { name: 'שינוי סיסמה' }).click();

test('the settings page: handwritten rows with the profile as it is today, the target-weight row, digits in the digit font', async ({ page }) => {
  const guards = attachGuards(page);
  const username = await register(page);
  await openSettings(page);

  await expect(page.locator('#settings-user')).toHaveText(`מחובר בתור ${username}`);
  const rows = page.locator('#screen-settings .row2');
  const texts = (await rows.allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
  expect(texts.some((t) => /^גובה\s*175 ס״מ$/.test(t)), `height row in ${JSON.stringify(texts)}`).toBe(true);
  expect(texts.some((t) => /^יעד שינוי שבועי\s*.?-½.? ק״ג$/.test(t)), `weekly goal row in ${JSON.stringify(texts)}`).toBe(true);
  expect(texts.some((t) => /^יעד קלוריות\s*[\d,]{4,6} קק״ל$/.test(t)), `calorie goal row in ${JSON.stringify(texts)}`).toBe(true);
  // the profile has no target weight: its row says so
  expect(texts.some((t) => /^יעד משקל\s*לא הוגדר$/.test(t)), `target weight row in ${JSON.stringify(texts)}`).toBe(true);
  // the old card layout is gone
  await expect(page.locator('#screen-settings .card, #screen-settings .topbar')).toHaveCount(0);

  // the logout row is red ink, a real button
  const logout = page.locator('#screen-settings').getByRole('button', { name: 'התנתקות', exact: true });
  await expect(logout).toBeVisible();
  expect(await logout.evaluate((el) => getComputedStyle(el).color)).toBe('rgb(179, 49, 29)');
  await expect(page.locator('#screen-settings').getByText('יציאה', { exact: true })).toHaveCount(0);

  const { seen, offenders } = await digitOffenders(page, '#screen-settings');
  expect(seen, 'the settings rows hold digits (height, calories, weekly goal)').toBeGreaterThanOrEqual(2);
  expect(offenders, 'digit font on the settings page').toEqual([]);
  expectNoGuardEvents(guards, [SIGNED_OUT_ME]);
});

test('a user with no profile sees "not set" rows, not blanks or NaN', async ({ page }) => {
  await register(page, { profile: null });
  await openSettings(page);
  const rows = (await page.locator('#screen-settings .row2').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
  for (const label of ['גובה', 'יעד שינוי שבועי', 'יעד קלוריות']) {
    expect(rows.find((t) => t.startsWith(label)), `${label} in ${JSON.stringify(rows)}`).toMatch(/לא הוגדר$/);
  }
  await expect(page.locator('#screen-settings')).not.toContainText('NaN');
});

test('the capybara walks on the settings page and is stopped when the page is left', async ({ page }) => {
  await register(page);
  await openSettings(page);
  const walker = page.locator('#screen-settings .page > .walker');
  await expect(walker).toHaveCount(1);
  await expect(walker.locator('svg')).toBeVisible();
  // she walks beside the text, never over it: the lane starts below the scrolling content
  const geometry = await page.evaluate(() => {
    const w = document.querySelector('#screen-settings .walker').getBoundingClientRect();
    const c = document.querySelector('#screen-settings .content').getBoundingClientRect();
    return { walkerTop: w.top, contentBottom: c.bottom };
  });
  expect(geometry.walkerTop, 'the walker is below the content area').toBeGreaterThanOrEqual(geometry.contentBottom - 1);

  for (let i = 0; i < 3; i += 1) {   // enter and leave several times: always exactly one lane, none after leaving
    await page.locator('#nav-dashboard').click();
    await expect(page.locator('#screen-dashboard')).toBeVisible();
    await expect(page.locator('.walker')).toHaveCount(0);
    await page.locator('#nav-settings').click();
    await expect(walker).toHaveCount(1);
  }
  await page.locator('#nav-weight').click();
  await expect(page.locator('#screen-settings .walker')).toHaveCount(0);
  await expect(page.locator('#screen-weight .page > .walker')).toHaveCount(1);
});

test('logout from the settings page signs out, closes everything and leaves no walker on the settings page', async ({ page }) => {
  const guards = attachGuards(page);
  await register(page);
  await openSettings(page);
  await page.locator('#screen-settings').getByRole('button', { name: 'התנתקות', exact: true }).click();
  await expect(page.locator('#screen-auth')).toBeVisible();
  await expect(page.locator('#bottom-nav')).toBeHidden();
  await expect(page.locator('#screen-settings .walker')).toHaveCount(0);
  expect((await page.context().cookies()).filter((c) => c.name === 'fl_session')).toEqual([]);
  expectNoGuardEvents(guards, [SIGNED_OUT_ME]);
});

for (const [width, height] of [[390, 844], [320, 640]]) {
  test(`the settings page and the three modals fit a ${width}x${height} phone, as taped slips on a dimmed page`, async ({ page }) => {
    const guards = attachGuards(page);
    await register(page);
    await meal(page);
    await page.setViewportSize({ width, height });
    await openSettings(page);
    let o = await overflowX(page);
    expect(o.scrollWidth, 'settings: no sideways scroll').toBeLessThanOrEqual(o.innerWidth);

    // ── profile modal ──
    await openProfile(page);
    await expect(page.locator('#modal-profile')).toHaveClass(/open/);
    const profile = await slipInfo(page, 'modal-profile');
    expectSlipLooksRight(profile, 'profile');
    o = await overflowX(page);
    expect(o.scrollWidth, 'profile modal: no sideways scroll').toBeLessThanOrEqual(o.innerWidth);
    const profDigits = await digitOffenders(page, '#modal-profile');
    expect(profDigits.seen, 'the profile modal holds digits (calorie preview, height)').toBeGreaterThanOrEqual(2);
    expect(profDigits.offenders, 'digit font in the profile modal').toEqual([]);
    if (height === 640) {
      // tall content on a short phone: the slip scrolls inside the viewport and the last button is reachable
      expect(profile.scrolls, 'the tall profile slip scrolls').toBe(true);
      const reach = await page.evaluate(() => {
        const body = document.querySelector('#modal-profile .slip-body');
        const btn = [...document.querySelectorAll('#modal-profile .penbtn')].find((b) => b.textContent.trim() === 'שמור פרופיל');
        body.scrollTop = body.scrollHeight;
        const br = btn.getBoundingClientRect();
        const sr = document.querySelector('#modal-profile .modal-sheet').getBoundingClientRect();
        return { btnBottom: br.bottom, sheetBottom: sr.bottom, btnTop: br.top, sheetTop: sr.top };
      });
      expect(reach.btnBottom, 'the save button is inside the slip after scrolling').toBeLessThanOrEqual(reach.sheetBottom + 0.5);
      expect(reach.btnTop).toBeGreaterThanOrEqual(reach.sheetTop);
    }
    await page.locator('#modal-profile .modal-close').click();
    await expect(page.locator('#modal-profile')).not.toHaveClass(/open/);

    // ── change-password modal ──
    await openChangePass(page);
    await expect(page.locator('#modal-change-pass')).toHaveClass(/open/);
    expectSlipLooksRight(await slipInfo(page, 'modal-change-pass'), 'change password');
    o = await overflowX(page);
    expect(o.scrollWidth, 'change-password modal: no sideways scroll').toBeLessThanOrEqual(o.innerWidth);
    await page.locator('#modal-change-pass .modal-close').click();
    await expect(page.locator('#modal-change-pass')).not.toHaveClass(/open/);

    // ── edit modal ──
    await page.locator('#nav-home').click();
    await page.locator('#meal-list .meal-item-row').first().getByRole('button', { name: 'ערוך' }).click();
    await expect(page.locator('#edit-modal')).toHaveClass(/open/);
    expectSlipLooksRight(await slipInfo(page, 'edit-modal'), 'edit meal');
    o = await overflowX(page);
    expect(o.scrollWidth, 'edit modal: no sideways scroll').toBeLessThanOrEqual(o.innerWidth);
    const editDigits = await digitOffenders(page, '#edit-modal');
    expect(editDigits.seen, 'the edit modal holds digits (calories, macros, time)').toBeGreaterThanOrEqual(4);
    expect(editDigits.offenders, 'digit font in the edit modal').toEqual([]);
    await page.locator('#edit-modal-close').click();
    await expect(page.locator('#edit-modal')).not.toHaveClass(/open/);
    expectNoGuardEvents(guards, [SIGNED_OUT_ME]);
  });
}

test('the modals close with the cross, the backdrop and Escape, and give the focus back', async ({ page }) => {
  await register(page);
  await openSettings(page);

  for (const [open, id, label] of [[openProfile, 'modal-profile', 'openProfileModal'], [openChangePass, 'modal-change-pass', 'openChangePassModal']]) {
    const modal = page.locator(`#${id}`);
    await open(page);
    await expect(modal).toHaveClass(/open/);
    // a click inside the slip keeps it open, a click on the dimmed page closes it
    await modal.locator('.modal-title').click();
    await expect(modal).toHaveClass(/open/);
    await modal.click({ position: { x: 4, y: 4 } });
    await expect(modal).not.toHaveClass(/open/);

    await open(page);
    await expect(modal).toHaveClass(/open/);
    await page.keyboard.press('Escape');
    await expect(modal).not.toHaveClass(/open/);
    // the button that opened it has the focus again
    expect(await page.evaluate(() => document.activeElement.getAttribute('data-action')), `${id}: the opening row has the focus again`).toBe(label);

    await open(page);
    await modal.locator('.modal-close').click();
    await expect(modal).not.toHaveClass(/open/);
  }
  // focus moves into the slip when it opens (not into a field, so no keyboard pops up on a phone)
  await openChangePass(page);
  expect(await page.evaluate(() => document.activeElement.closest('#modal-change-pass') !== null)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.locator('#modal-change-pass')).not.toHaveClass(/open/);
});

test('change password: a wrong current password shows the error in #cp-error, inside the slip, in red', async ({ page }) => {
  const guards = attachGuards(page);
  await register(page);
  await openSettings(page);
  await openChangePass(page);
  await page.locator('#cp-current').fill('definitely-wrong-1');
  await page.locator('#cp-new').fill('another-new-pass-1');
  await page.locator('#modal-change-pass').getByRole('button', { name: 'שמור', exact: true }).click();
  const error = page.locator('#cp-error');
  await expect(error).toHaveText('סיסמה נוכחית שגויה');
  await expect(page.locator('#modal-change-pass')).toHaveClass(/open/);
  const info = await page.evaluate(() => {
    const e = document.getElementById('cp-error').getBoundingClientRect();
    const s = document.querySelector('#modal-change-pass .modal-sheet').getBoundingClientRect();
    return { color: getComputedStyle(document.getElementById('cp-error')).color, inside: e.left >= s.left && e.right <= s.right && e.top >= s.top && e.bottom <= s.bottom };
  });
  expect(info.color).toBe('rgb(179, 49, 29)');
  expect(info.inside, 'the error is inside the slip').toBe(true);
  // the fields are handwritten (an ink underline, no box)
  const field = await page.locator('#cp-current').evaluate((el) => { const cs = getComputedStyle(el); return { bt: cs.borderTopWidth, bb: cs.borderBottomWidth, bg: cs.backgroundColor }; });
  expect(field).toEqual({ bt: '0px', bb: '2px', bg: 'rgba(0, 0, 0, 0)' });
  expectNoGuardEvents(guards, [SIGNED_OUT_ME, /status of 400/, /status of 401/, /status of 403/]);
});

test('the profile modal saves and the settings rows follow', async ({ page }) => {
  await register(page);
  await openSettings(page);
  await openProfile(page);
  await page.locator('#mp-height').selectOption('182');
  await page.locator('#mp-goal-select').selectOption('0.25');
  await page.getByRole('button', { name: 'שמור פרופיל' }).click();
  await expect(page.locator('#modal-profile')).not.toHaveClass(/open/);
  const rows = page.locator('#screen-settings .row2');
  await expect(rows.filter({ hasText: 'גובה' })).toContainText('182 ס״מ');
  await expect(rows.filter({ hasText: 'יעד שינוי שבועי' })).toContainText('¼');
  // the three controls of the slip still work: gender chips and activity rows toggle
  await openProfile(page);
  // a range of digits keeps its order inside the Hebrew line ("1–3", not "3–1")
  const order = await page.evaluate(() => {
    const out = {};
    for (const bdi of document.querySelectorAll('#mp-activity-list bdi')) {
      const t = bdi.firstChild;
      const at = (i) => { const r = document.createRange(); r.setStart(t, i); r.setEnd(t, i + 1); return r.getBoundingClientRect().left; };
      out[t.nodeValue] = at(0) < at(2);
    }
    return out;
  });
  expect(order).toEqual({ '1–3': true, '3–5': true, '6–7': true });
  await page.locator('#mp-female-btn').click();
  await expect(page.locator('#mp-female-btn')).toHaveClass(/selected/);
  await page.locator('#mp-activity-list .activity-opt[data-val="active"]').click();
  await expect(page.locator('#mp-activity-list .activity-opt.selected')).toHaveAttribute('data-val', 'active');
  const selectedColour = await page.locator('#mp-female-btn').evaluate((el) => getComputedStyle(el).color);
  expect(selectedColour, 'the selected chip is red ink').toBe('rgb(179, 49, 29)');
});

test('the edit modal keeps its buttons by name and works: edit, recalculate, save; no per-item weight field', async ({ page }) => {
  const guards = attachGuards(page);
  await register(page);
  await meal(page, { name: 'ארוחה ראשונה', calories: 300 });
  await page.goto('/');
  await expect(page.locator('#screen-dashboard')).toBeVisible();
  await page.locator('#nav-home').click();
  const row = page.locator('#meal-list .meal-item-row').first();
  await row.getByRole('button', { name: 'ערוך' }).click();
  const modal = page.locator('#edit-modal');
  await expect(modal).toHaveClass(/open/);
  await expect(page.locator('#edit-name')).toHaveValue('ארוחה ראשונה');

  // unchanged name: one red ink button named exactly "שמור"
  const save = page.locator('#edit-btn-row').getByRole('button', { name: 'שמור', exact: true });
  await expect(save).toBeVisible();
  await expect(modal.getByRole('button', { name: 'חשב מחדש', exact: true })).toHaveCount(0);
  expect(await save.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(179, 49, 29)');

  // the name is handwritten too: an ink underline, no box (also while it has the focus)
  await page.locator('#edit-name').focus();
  expect(await page.locator('#edit-name').evaluate((el) => { const cs = getComputedStyle(el); return [cs.borderTopWidth, cs.borderLeftWidth, cs.borderBottomWidth, cs.backgroundColor]; }))
    .toEqual(['0px', '0px', '2px', 'rgba(0, 0, 0, 0)']);

  // the fields of the slip: exactly the meal totals and the time, nothing per component
  const ids = await modal.locator('input').evaluateAll((els) => els.map((e) => e.id).sort());
  expect(ids).toEqual(['edit-cal', 'edit-carb', 'edit-fat', 'edit-fiber', 'edit-name', 'edit-pro', 'edit-time']);
  await expect(modal).not.toContainText('גרם');
  await expect(modal.locator('.receipt, .receipt-row')).toHaveCount(0);

  // renamed: "חשב מחדש" and "שמור מבלי לחשב מחדש" appear
  await page.locator('#edit-name').fill('סלט ירוק');
  const recalc = modal.getByRole('button', { name: 'חשב מחדש', exact: true });
  const saveAs = modal.getByRole('button', { name: 'שמור מבלי לחשב מחדש', exact: true });
  await expect(recalc).toBeVisible();
  await expect(saveAs).toBeVisible();
  await expect(modal.getByRole('button', { name: 'שמור', exact: true })).toHaveCount(0);
  expect(await recalc.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(179, 49, 29)');
  const boxes = await Promise.all([recalc.boundingBox(), saveAs.boundingBox(), modal.locator('.modal-sheet').boundingBox()]);
  for (const b of boxes.slice(0, 2)) {
    expect(b.x).toBeGreaterThanOrEqual(boxes[2].x);
    expect(b.x + b.width).toBeLessThanOrEqual(boxes[2].x + boxes[2].width);
  }

  await recalc.click();
  await expect(page.locator('#edit-btn-row').getByRole('button', { name: 'שמור', exact: true })).toBeVisible();
  await expect(page.locator('#edit-cal')).not.toHaveValue('300');
  await page.locator('#edit-btn-row').getByRole('button', { name: 'שמור', exact: true }).click();
  await expect(modal).not.toHaveClass(/open/);
  await expect(row.locator('.mir-name')).not.toHaveText('ארוחה ראשונה');

  // "שמור מבלי לחשב מחדש" keeps the typed numbers
  await row.getByRole('button', { name: 'ערוך' }).click();
  await page.locator('#edit-name').fill('שם אחר לגמרי');
  await page.locator('#edit-cal').fill('123');
  await modal.getByRole('button', { name: 'שמור מבלי לחשב מחדש', exact: true }).click();
  await expect(modal).not.toHaveClass(/open/);
  await expect(row.locator('.mir-name')).toHaveText('שם אחר לגמרי');
  await expect(row).toContainText('123');
  expectNoGuardEvents(guards, [SIGNED_OUT_ME]);
});

test('a modal opened by one user does not leak into the next user after logout', async ({ page }) => {
  const guards = attachGuards(page);
  const userA = uniqueName();
  const userB = `other${Date.now()}`;   // never a superstring of userA (two uniqueName() calls in one millisecond can collide)
  await registerElsewhere(userB);
  await register(page, { username: userA });
  await meal(page, { name: 'ארוחה סודית של א', calories: 777 });
  await page.goto('/');
  await expect(page.locator('#screen-dashboard')).toBeVisible();

  // A: change-password modal with typed passwords and an error, edit modal with the meal open
  await page.locator('#nav-settings').click();
  await openChangePass(page);
  await page.locator('#cp-current').fill('typed-by-a-1');
  await page.locator('#cp-new').fill('typed-by-a-2');
  await page.locator('#modal-change-pass').getByRole('button', { name: 'שמור', exact: true }).click();
  await expect(page.locator('#cp-error')).not.toBeEmpty();
  await page.locator('#modal-change-pass .modal-close').click();
  await openProfile(page);
  await expect(page.locator('#mp-height')).toHaveValue('175');

  // sign out while the profile slip is open (what a lost session does), edit slip too
  await page.evaluate(async () => { await (await import('/js/session.js')).doLogout(); });
  await expect(page.locator('#screen-auth')).toBeVisible();
  await expect(page.locator('.modal-overlay.open')).toHaveCount(0);
  await expect(page.locator('#cp-current')).toHaveValue('');
  await expect(page.locator('#cp-new')).toHaveValue('');
  await expect(page.locator('#cp-error')).toBeEmpty();
  await expect(page.locator('#mp-height')).toHaveValue('');
  await expect(page.locator('#mp-birthdate')).toHaveValue('');

  // B signs in: nothing of A anywhere in the settings rows or the slips
  await page.locator('#auth-step1 .tab-btn', { hasText: 'כניסה' }).click();
  await page.locator('#login-user').fill(userB);
  await page.locator('#login-pass').fill(PASSWORD);
  await page.locator('#auth-login').getByRole('button', { name: 'כניסה' }).click();
  await expect(page.locator('#screen-dashboard')).toBeVisible();
  await page.locator('#nav-settings').click();
  await expect(page.locator('#settings-user')).toHaveText(`מחובר בתור ${userB}`);
  await expect(page.locator('#screen-settings')).not.toContainText(userA);
  const rows = (await page.locator('#screen-settings .row2').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
  expect(rows.find((t) => t.startsWith('גובה')), `B has no height: ${JSON.stringify(rows)}`).toMatch(/לא הוגדר$/);
  await openChangePass(page);
  await expect(page.locator('#cp-current')).toHaveValue('');
  await expect(page.locator('#cp-error')).toBeEmpty();
  await page.locator('#modal-change-pass .modal-close').click();
  await openProfile(page);
  await expect(page.locator('#mp-height')).toHaveValue('');
  await page.locator('#modal-profile .modal-close').click();
  await expect(page.locator('#edit-modal')).not.toHaveClass(/open/);
  await expect(page.locator('#edit-name')).toHaveValue('');
  expect(await page.evaluate(() => document.body.innerText.includes('ארוחה סודית של א'))).toBe(false);
  expectNoGuardEvents(guards, [SIGNED_OUT_ME, /status of 400/, /status of 401/, /status of 403/]);
});

test('an edit slip left open by one user is closed and emptied by the logout', async ({ page }) => {
  await register(page);
  await meal(page, { name: 'ארוחה פרטית', calories: 555 });
  await page.goto('/');
  await expect(page.locator('#screen-dashboard')).toBeVisible();
  await page.locator('#nav-home').click();
  await page.locator('#meal-list .meal-item-row').first().getByRole('button', { name: 'ערוך' }).click();
  await expect(page.locator('#edit-modal')).toHaveClass(/open/);
  await expect(page.locator('#edit-name')).toHaveValue('ארוחה פרטית');
  await page.evaluate(async () => { await (await import('/js/session.js')).doLogout(); });
  await expect(page.locator('#screen-auth')).toBeVisible();
  await expect(page.locator('#edit-modal')).not.toHaveClass(/open/);
  for (const id of ['edit-name', 'edit-cal', 'edit-pro', 'edit-carb', 'edit-fat', 'edit-fiber', 'edit-time']) {
    await expect(page.locator(`#${id}`), id).toHaveValue('');
  }
});

test('a 50-character username stays inside the page at 320 px, on the 30 px grid', async ({ page }) => {
  const long = `${'a'.repeat(30)}${'b'.repeat(20)}`;
  await register(page, { username: long });
  await page.setViewportSize({ width: 320, height: 640 });
  await openSettings(page);
  await expect(page.locator('#settings-user')).toContainText(long);
  const m = await page.evaluate(() => {
    const row = document.getElementById('settings-user').getBoundingClientRect();
    const content = document.querySelector('#screen-settings .content');
    const c = content.getBoundingClientRect();
    const margin = document.querySelector('#screen-settings .margin').getBoundingClientRect();
    return {
      rowLeft: row.left, rowRight: row.right, contentLeft: c.left, marginLeft: margin.left, rowHeight: row.height,
      contentOverflow: content.scrollWidth - content.clientWidth,
      doc: document.documentElement.scrollWidth, inner: window.innerWidth,
    };
  });
  expect(m.rowLeft).toBeGreaterThanOrEqual(m.contentLeft);
  expect(m.rowRight, 'the text stays left of the red margin line').toBeLessThanOrEqual(m.marginLeft);
  expect(m.contentOverflow, 'no sideways scroll inside the page').toBeLessThanOrEqual(0);
  expect(m.doc).toBeLessThanOrEqual(m.inner);
  expect(Math.round(m.rowHeight) % 30, 'the row stays on the 30 px grid').toBe(0);
  expect(m.rowHeight, 'a long name wraps onto more rules').toBeGreaterThan(30);
});

// ── review round 1 ───────────────────────────────────────────────────────────────────────────────

for (const [width, height] of [[390, 844], [320, 640]]) {
  test(`the values of the profile rows sit at the left edge of their row (${width} px)`, async ({ page }) => {
    await register(page);
    await page.setViewportSize({ width, height });
    await openSettings(page);
    const gaps = await page.evaluate(() => [...document.querySelectorAll('#screen-settings .row2:has(> b)')].map((row) => {
      const r = row.getBoundingClientRect();
      const b = row.querySelector('b').getBoundingClientRect();
      const label = row.querySelector('span').getBoundingClientRect();
      return { id: row.querySelector('b').id, leftGap: b.left - r.left, rightOfLabelGap: label.left - b.right };
    }));
    expect(gaps.map((g) => g.id)).toEqual(['settings-username', 'settings-height', 'settings-goalweight', 'settings-goalkg', 'settings-profile-sub']);
    for (const g of gaps) {
      expect(g.leftGap, `${g.id}: the value starts at the row left edge`).toBeLessThanOrEqual(1);
    }
    // the short values leave a clear gap before their labels (they are not glued to them)
    for (const g of gaps.slice(1)) expect(g.rightOfLabelGap, `${g.id}: free space between label and value`).toBeGreaterThan(20);
  });
}

test('a long username drops below its label, at the left edge', async ({ page }) => {
  await register(page, { username: 'q'.repeat(50) });
  await page.setViewportSize({ width: 320, height: 640 });
  await openSettings(page);
  const m = await page.evaluate(() => {
    const row = document.getElementById('settings-user').getBoundingClientRect();
    const label = document.querySelector('#settings-user > span').getBoundingClientRect();
    const b = document.getElementById('settings-username').getBoundingClientRect();
    return { belowLabel: b.top >= label.bottom - 1, leftGap: b.left - row.left };
  });
  expect(m.belowLabel).toBe(true);
  expect(m.leftGap).toBeLessThanOrEqual(1);
});

test('the change-password slip reopens empty after typing and an error', async ({ page }) => {
  await register(page);
  await openSettings(page);
  await openChangePass(page);
  await page.locator('#cp-current').fill('wrong-current-1');
  await page.locator('#cp-new').fill('some-new-pass-1');
  await page.locator('#modal-change-pass').getByRole('button', { name: 'שמור', exact: true }).click();
  await expect(page.locator('#cp-error')).not.toBeEmpty();
  await page.locator('#modal-change-pass .modal-close').click();
  await expect(page.locator('#modal-change-pass')).not.toHaveClass(/open/);
  await openChangePass(page);
  await expect(page.locator('#cp-current')).toHaveValue('');
  await expect(page.locator('#cp-new')).toHaveValue('');
  await expect(page.locator('#cp-error')).toBeEmpty();
});

test('a recalculation in flight at the sign-out lands nowhere: the edit slip stays closed and empty', async ({ page }) => {
  await register(page);
  await meal(page, { name: 'ארוחה בדרך', calories: 321 });
  await page.goto('/');
  await expect(page.locator('#screen-dashboard')).toBeVisible();
  let release;
  const held = new Promise((r) => { release = r; });
  await page.route('**/api/analyze-text', async (route) => {
    await held;
    await route.fulfill({ json: { foodName: 'שם מהשרת', calories: 999, protein_g: 11, carbs_g: 22, fat_g: 33, fiber_g: 4, items: [] } });
  });
  await page.locator('#nav-home').click();
  await page.locator('#meal-list .meal-item-row').first().getByRole('button', { name: 'ערוך' }).click();
  await page.locator('#edit-name').fill('שם חדש לחישוב');
  await page.locator('#edit-modal').getByRole('button', { name: 'חשב מחדש', exact: true }).click();
  await expect(page.locator('#edit-btn-row').getByRole('button', { name: /מחשב/ })).toBeVisible();
  await page.evaluate(async () => { await (await import('/js/session.js')).doLogout(); });
  await expect(page.locator('#screen-auth')).toBeVisible();
  release();
  await page.evaluate(() => new Promise((r) => setTimeout(r, 400)));   // let the late reply arrive
  await expect(page.locator('#edit-modal')).not.toHaveClass(/open/);
  for (const id of ['edit-name', 'edit-cal', 'edit-pro', 'edit-carb', 'edit-fat', 'edit-fiber', 'edit-time']) {
    await expect(page.locator(`#${id}`), id).toHaveValue('');
  }
  await expect(page.locator('#edit-btn-row')).toBeEmpty();
});

test('Escape that ends an IME composition does not close the slip', async ({ page }) => {
  await register(page);
  await openSettings(page);
  await openChangePass(page);
  await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true })));
  await expect(page.locator('#modal-change-pass')).toHaveClass(/open/);
  await page.keyboard.press('Escape');
  await expect(page.locator('#modal-change-pass')).not.toHaveClass(/open/);
});

test('change password: one request at a time, and a reply that arrives after the sign-out is dropped', async ({ page }) => {
  await register(page);
  await openSettings(page);
  await openChangePass(page);
  let calls = 0;
  let release;
  const held = new Promise((r) => { release = r; });
  await page.route('**/auth/change-password', async (route) => {
    calls += 1;
    await held;
    await route.fulfill({ json: { ok: true } });
  });
  await page.locator('#cp-current').fill(PASSWORD);
  await page.locator('#cp-new').fill('brand-new-pass-1');
  const save = page.locator('#modal-change-pass').getByRole('button', { name: 'שמור', exact: true });
  await save.click();
  await expect(save).toBeDisabled();
  await page.evaluate(async () => { await (await import('/js/screens/settings.js')).doChangePassword(); });   // a second submit while the first is in flight sends nothing
  await page.evaluate(() => new Promise((r) => setTimeout(r, 200)));
  expect(calls).toBe(1);
  await page.evaluate(async () => { await (await import('/js/session.js')).doLogout(); });
  await expect(page.locator('#screen-auth')).toBeVisible();
  release();
  await page.evaluate(() => new Promise((r) => setTimeout(r, 400)));
  // read at once (an auto-retrying assertion would wait out the toast's 2.5 s and pass)
  expect(await page.evaluate(() => document.getElementById('toast').classList.contains('show')), 'no success toast for the next person').toBe(false);
  await expect(page.locator('#cp-error')).toBeEmpty();
  await expect(page.locator('#modal-change-pass [data-action="doChangePassword"]')).toBeEnabled();    // usable again for the next person
});

test('change password: a failure that arrives after the sign-out writes no error text', async ({ page }) => {
  await register(page);
  await openSettings(page);
  await openChangePass(page);
  let release;
  const held = new Promise((r) => { release = r; });
  await page.route('**/auth/change-password', async (route) => {
    await held;
    await route.fulfill({ status: 400, json: { error: { code: 'VALIDATION', fields: { newPassword: 'TOO_SHORT' } } } });
  });
  await page.locator('#cp-current').fill(PASSWORD);
  await page.locator('#cp-new').fill('x');
  await page.locator('#modal-change-pass').getByRole('button', { name: 'שמור', exact: true }).click();
  await page.evaluate(async () => { await (await import('/js/session.js')).doLogout(); });
  release();
  await page.evaluate(() => new Promise((r) => setTimeout(r, 400)));
  await expect(page.locator('#cp-error')).toBeEmpty();
});

test('after an edit is saved the focus is on that meal edit button, not on the page body', async ({ page }) => {
  await register(page);
  await meal(page, { name: 'ארוחה לשמירה', calories: 250 });
  await page.goto('/');
  await expect(page.locator('#screen-dashboard')).toBeVisible();
  await page.locator('#nav-home').click();
  const row = page.locator('#meal-list .meal-item-row').first();
  await row.getByRole('button', { name: 'ערוך' }).click();
  await page.locator('#edit-cal').fill('260');
  await page.locator('#edit-btn-row').getByRole('button', { name: 'שמור', exact: true }).click();
  await expect(page.locator('#edit-modal')).not.toHaveClass(/open/);
  await expect(row).toContainText('260');
  await expect.poll(() => page.evaluate(() => {
    const a = document.activeElement;
    return !!a && a.getAttribute('data-action') === 'openEditModal' && !!a.closest('.meal-item-row');
  })).toBe(true);
});

test('a sign-out gives the focus to nothing: closing the slips does not focus the hidden settings row', async ({ page }) => {
  await register(page);
  await openSettings(page);
  await openChangePass(page);
  const focused = await page.evaluate(async () => {
    const calls = [];
    const original = HTMLElement.prototype.focus;
    HTMLElement.prototype.focus = function (...args) { calls.push(!!this.closest('#screen-settings')); return original.apply(this, args); };
    try { await (await import('/js/session.js')).doLogout(); } finally { HTMLElement.prototype.focus = original; }
    return calls;
  });
  expect(focused.includes(true), 'no focus() call on an element of the settings screen').toBe(false);
});

test('the profile slip shows the recommended calories with the thousands separator, like the settings row', async ({ page }) => {
  await register(page);
  await openSettings(page);
  const row = await page.locator('#settings-profile-sub').innerText();
  await openProfile(page);
  const preview = await page.locator('#mp-cal-preview').innerText();
  expect(row).toMatch(/^\d,\d{3} קק״ל$/);
  expect(preview).toBe(row);
});

test('the weekly-goal row shows the goal of a profile that has one even without a height', async ({ page }) => {
  await register(page, { profile: { gender: 'male', birthDate: '1990-05-15', height: 0, weight: 70, activity: 'light', goalKg: 0.25 } });
  await openSettings(page);
  await expect(page.locator('#settings-goalkg')).toContainText('¼');
});
