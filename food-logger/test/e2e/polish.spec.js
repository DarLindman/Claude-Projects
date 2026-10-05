'use strict';

// The owner-preview defects of the diary redesign (Task 16): a soft fade where the scroll area meets the walking
// capybara's strip, a whole "ק״ג" in the registration weight list at 320 px, a user name that stays whole in the
// capybara's bubble, no empty band under the sign-in pages, a long meal name that wraps in the edit slip, and the
// numbers of the weight graph. (The ribbon, the yearly labels and the empty-state plus are tested with their screens.)

const { test, expect } = require('@playwright/test');
const { attachGuards, expectNoGuardEvents, SIGNED_OUT_ME, localNow } = require('./helpers');

const PASSWORD = 'polish-pass-1234';
const CSRF = { Origin: 'http://localhost:3100', 'X-FL-Client': '1' };
const post = (page, url, data) => page.request.post(url, { headers: CSRF, data });
const put = (page, url, data) => page.request.put(url, { headers: CSRF, data });
const uniqueName = () => `pol${Date.now()}${Math.floor(Math.random() * 1000)}`;
const PROFILE = { gender: 'male', birthDate: '1990-05-15', height: 175, weight: 70, activity: 'light', goalKg: 0 };

async function register(page, { username = uniqueName(), profile = PROFILE } = {}) {
  const reg = await post(page, '/auth/register', { username, password: PASSWORD });
  expect(reg.status(), await reg.text()).toBe(200);
  if (profile) expect((await put(page, '/api/profile', profile)).status()).toBe(200);
  return username;
}

const dayBack = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const WIDTHS = [390, 320];

// ── 2. a line cut by the end of the scroll area fades; the last line scrolls fully clear ──────────────────────────

for (const width of WIDTHS) {
  test(`at ${width} px the scroll areas above the walker fade at their foot and the last line scrolls fully clear of the fade`, async ({ page }) => {
    const guards = attachGuards(page);
    await page.setViewportSize({ width, height: 844 });
    await register(page, { profile: { ...PROFILE, goalWeight: 68.5 } });
    for (let i = 0; i < 14; i++) expect((await post(page, '/api/weight', { weight_kg: 76 - i * 0.4, logged_at: dayBack(i) })).status()).toBe(200);
    await page.goto('/');
    await expect(page.locator('#screen-dashboard')).toBeVisible();

    const FADE = 18;
    for (const [nav, screen] of [['#nav-weight', '#screen-weight'], ['#nav-settings', '#screen-settings'], ['#nav-stats', '#screen-stats']]) {
      await page.locator(nav).click();
      await expect(page.locator(screen)).toBeVisible();
      if (screen === '#screen-weight') await expect(page.locator('#weight-list .weight-entry')).toHaveCount(14);
      const r = await page.evaluate(({ screen }) => {
        const content = document.querySelector(`${screen} .content`);
        const mask = getComputedStyle(content).maskImage || getComputedStyle(content).webkitMaskImage;
        content.scrollTop = content.scrollHeight;
        const cr = content.getBoundingClientRect();
        // the last visible leaf of the page: the lowest thing a reader has to reach
        let last = content;
        for (;;) {
          const kids = [...last.children].filter((e) => e.getBoundingClientRect().height > 0 && getComputedStyle(e).display !== 'none' && !e.classList.contains('ribbon'));
          if (!kids.length) break;
          last = kids[kids.length - 1];
        }
        return { mask, scrolls: content.scrollHeight > content.clientHeight, clear: cr.bottom - last.getBoundingClientRect().bottom };
      }, { screen });
      expect(r.mask, `${screen}: the foot of the scroll area fades`).toMatch(/linear-gradient/);
      if (screen === '#screen-weight') expect(r.scrolls, `${screen} scrolls at ${width}px`).toBe(true);
      if (r.scrolls) expect(r.clear, `${screen}: the last line rests clear of the ${FADE} px fade`).toBeGreaterThanOrEqual(FADE);
    }
    expectNoGuardEvents(guards, [SIGNED_OUT_ME]);
  });
}

// ── 5a. the registration weight list shows "ק״ג" whole at 320 px ──────────────────────────────────────────────────

for (const width of WIDTHS) {
  test(`at ${width} px the registration height and weight lists show their whole text`, async ({ page }) => {
    await page.setViewportSize({ width, height: 640 });
    await page.goto('/');
    await page.getByRole('button', { name: 'התחל עכשיו' }).click();
    await page.locator('#reg-user').fill(uniqueName());
    await page.locator('#reg-pass').fill(PASSWORD);
    await page.locator('#auth-register').getByRole('button', { name: 'הרשמה' }).click();
    await expect(page.locator('#auth-step2')).toBeVisible();

    const fits = await page.evaluate(() => {
      const ctx = document.createElement('canvas').getContext('2d');
      return ['reg-height', 'reg-weight'].map((id) => {
        const el = document.getElementById(id);
        const cs = getComputedStyle(el);
        ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
        const text = el.selectedOptions[0].textContent;
        const room = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
        return { id, text, width: ctx.measureText(text).width, room };
      });
    });
    for (const f of fits) expect(f.width, `${f.id} "${f.text}" needs ${f.width}px of ${f.room}px`).toBeLessThanOrEqual(f.room);
    expect(fits[1].text).toContain('ק״ג');
  });
}

// ── 5b. a user name stays inside the capybara's bubble ────────────────────────────────────────────────────────────

test('at 320 px the user name of the greeting stays whole in the bubble, and a very long one wraps inside it', async ({ page }) => {
  const guards = attachGuards(page);
  await page.setViewportSize({ width: 320, height: 640 });
  const short = await register(page, { username: 'משתמש_חדש', profile: null });
  // a meal from some days ago, so the capybara greets the user by name (a user with no meal at all gets the first-meal prompt)
  expect((await post(page, '/api/food', { meal_type: 'lunch', food_name: 'ישנה', calories: 100, protein_g: 1, carbs_g: 1, fat_g: 1, fiber_g: 1, logged_at: `${dayBack(5)}T12:00:00` })).status()).toBe(200);
  await page.goto('/');
  await expect(page.locator('#screen-dashboard')).toBeVisible();
  await expect(page.locator('#pet-bubble')).toContainText(short);
  const lines = await page.evaluate((name) => {
    const bubble = document.getElementById('pet-bubble');
    const walker = document.createTreeWalker(bubble, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const at = n.nodeValue.indexOf(name);
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(n, at); range.setEnd(n, at + name.length);
      return new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size;
    }
    return -1;
  }, short);
  expect(lines, `"${short}" is on one line of the bubble`).toBe(1);
  expectNoGuardEvents(guards, [SIGNED_OUT_ME]);

  // a long name without a space wraps inside the bubble and never leaves it
  await page.request.post('/auth/logout', { headers: CSRF });
  const long = `ארוך${'מאוד'.repeat(6)}`;
  await register(page, { username: long, profile: null });
  expect((await post(page, '/api/food', { meal_type: 'lunch', food_name: 'ישנה', calories: 100, protein_g: 1, carbs_g: 1, fat_g: 1, fiber_g: 1, logged_at: `${dayBack(5)}T12:00:00` })).status()).toBe(200);
  await page.goto('/');
  await expect(page.locator('#pet-bubble')).toContainText(long.slice(0, 8));
  const inside = await page.evaluate(() => {
    const b = document.getElementById('pet-bubble');
    const br = b.getBoundingClientRect();
    const pr = document.querySelector('#screen-dashboard .page').getBoundingClientRect();
    return { noOverflow: b.scrollWidth <= b.clientWidth + 1, inPage: br.left >= pr.left && br.right <= pr.right };
  });
  expect(inside).toEqual({ noOverflow: true, inPage: true });
});

// ── 6. no empty band under the sign-in pages ─────────────────────────────────────────────────────────────────────

for (const width of WIDTHS) {
  test(`at ${width} px the sign-in paper runs down to the frame: no band where the dock would be`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/');
    await page.getByRole('button', { name: 'כבר יש לי חשבון' }).click();
    await expect(page.locator('#screen-auth')).toBeVisible();
    await expect(page.locator('#bottom-nav')).toBeHidden();
    const band = await page.evaluate(() => {
      const frame = document.querySelector('.phone-frame').getBoundingClientRect();
      const paper = document.querySelector('#screen-auth .page').getBoundingClientRect();
      return { band: frame.bottom - paper.bottom, top: paper.top - frame.top };
    });
    expect(band.band, 'the strip of leather under the paper').toBeLessThanOrEqual(band.top);
    expect(band.band, 'the paper keeps a margin of leather').toBeGreaterThanOrEqual(4);
  });
}

// ── 7. the edit slip's name wraps instead of being clipped ───────────────────────────────────────────────────────

test('at 320 px a long meal name wraps in the edit slip (a textarea named #edit-name), nothing is clipped, Enter adds no line', async ({ page }) => {
  const guards = attachGuards(page);
  await page.setViewportSize({ width: 320, height: 640 });
  await register(page);
  const name = 'חזה עוף בגריל עם אורז וסלט ירקות גדול ורוטב טחינה';
  const res = await post(page, '/api/food', {
    meal_type: 'lunch', food_name: name, calories: 480, protein_g: 40, carbs_g: 50, fat_g: 12, fiber_g: 5, logged_at: `${localNow().date}T12:30:00`,
  });
  expect(res.status(), await res.text()).toBe(200);
  await page.goto('/');
  await page.locator('#nav-home').click();
  await page.locator('#meal-list .meal-item-row').first().getByRole('button', { name: 'ערוך' }).click();
  await expect(page.locator('#edit-modal')).toHaveClass(/open/);

  const field = page.locator('#edit-name');
  expect(await field.evaluate((el) => el.tagName)).toBe('TEXTAREA');
  await expect(field).toHaveValue(name);
  const m = await field.evaluate((el) => ({ clipped: el.scrollHeight > el.clientHeight + 1, height: el.clientHeight, lineH: parseFloat(getComputedStyle(el).lineHeight) }));
  expect(m.clipped, 'the whole name is visible').toBe(false);
  expect(m.height, 'the name needs more than one line at 320px').toBeGreaterThan(m.lineH * 1.5);

  // it grows while typing and shrinks back; Enter is not a line break
  await field.fill('קצר');
  expect(await field.evaluate((el) => el.clientHeight)).toBeLessThan(m.height);
  await field.press('Enter');
  await expect(field).toHaveValue('קצר');
  await field.fill(name + name);
  expect(await field.evaluate((el) => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
  expectNoGuardEvents(guards, [SIGNED_OUT_ME]);
});

// ── 8. the weight graph carries numbers ──────────────────────────────────────────────────────────────────────────

for (const width of WIDTHS) {
  test(`at ${width} px the weight graph shows its lowest and highest kg and the goal, inside the chart, clear of the line and the points`, async ({ page }) => {
    const guards = attachGuards(page);
    await page.setViewportSize({ width, height: 844 });
    await register(page, { profile: { ...PROFILE, goalWeight: 68.5 } });
    const kgs = [74.2, 75.6, 73.1, 72.4, 71.9, 70.8, 71.3, 70.2];
    for (const [i, kg] of kgs.entries()) expect((await post(page, '/api/weight', { weight_kg: kg, logged_at: dayBack(kgs.length - 1 - i) })).status()).toBe(200);
    await page.goto('/');
    await page.locator('#nav-weight').click();
    await expect(page.locator('#weight-chart svg .wpt')).toHaveCount(kgs.length);

    const g = await page.evaluate(() => {
      const svg = document.querySelector('#weight-chart svg');
      const box = (el) => { const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; };
      const lbl = [...svg.querySelectorAll('text')].map((t) => ({ text: t.textContent, goal: t.classList.contains('goal'), font: getComputedStyle(t).fontFamily, ...box(t) }));
      return {
        svg: box(svg), lbl,
        points: [...svg.querySelectorAll('.wpt')].map(box),
        line: box(svg.querySelector('.wline')),
        goalLine: box(svg.querySelector('.goal-line')),
        html: svg.outerHTML,
      };
    });
    expect(g.html).not.toMatch(/NaN|undefined|Infinity/);
    expect(g.lbl.map((l) => l.text).sort()).toEqual(['68.5', '70.2', '75.6'].sort());
    expect(g.lbl.filter((l) => l.goal).map((l) => l.text)).toEqual(['68.5']);
    for (const l of g.lbl) {
      expect(l.text, 'numbers only').toMatch(/^[0-9.,]+$/);
      expect(l.font.split(',')[0].replace(/["']/g, '').trim(), 'digit font').toBe('Digits');
      expect(l.l >= g.svg.l - 1 && l.r <= g.svg.r + 1 && l.t >= g.svg.t - 1 && l.b <= g.svg.b + 1, `label ${l.text} inside the chart`).toBe(true);
      expect(l.r, `label ${l.text} left of the line`).toBeLessThanOrEqual(g.line.l);
      expect(l.r, `label ${l.text} left of the goal line`).toBeLessThanOrEqual(g.goalLine.l + 1);
      for (const p of g.points) expect(l.r <= p.l || p.r <= l.l || l.b <= p.t || p.b <= l.t, `label ${l.text} clear of a point`).toBe(true);
    }
    // the labels do not touch each other, and the oldest point is still on the left, the newest on the right
    for (let i = 0; i < g.lbl.length; i++) for (let j = i + 1; j < g.lbl.length; j++) {
      const a = g.lbl[i], b = g.lbl[j];
      expect(a.b <= b.t || b.b <= a.t, `labels ${a.text} / ${b.text} apart`).toBe(true);
    }
    expect(g.points[0].l).toBeLessThan(g.points[g.points.length - 1].l);
    expectNoGuardEvents(guards, [SIGNED_OUT_ME]);
  });
}

test('the weight graph labels: one weight and no goal gives one number; no weights give none', async ({ page }) => {
  await register(page, { profile: PROFILE });
  await page.goto('/');
  await page.locator('#nav-weight').click();
  await expect(page.locator('#weight-chart svg')).toBeVisible();
  await expect(page.locator('#weight-chart svg text')).toHaveCount(0);
  expect((await post(page, '/api/weight', { weight_kg: 80, logged_at: dayBack(0) })).status()).toBe(200);
  await page.goto('/');
  await page.locator('#nav-weight').click();
  await expect(page.locator('#weight-chart svg .wpt')).toHaveCount(1);
  await expect(page.locator('#weight-chart svg text')).toHaveText(['80']);
});
