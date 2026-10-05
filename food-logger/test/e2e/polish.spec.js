'use strict';

// The owner-preview defects of the diary redesign (Task 16): a whole "ק״ג" in the registration weight list at 320 px, a user name
// that stays whole in the capybara's bubble, no empty band under the sign-in pages, a long meal name that wraps in the edit slip
// and the numbers of the weight graph. (The ribbon, the yearly labels and the empty-state plus are tested with their screens.)

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

// ── nothing the handwriting draws is clipped in the multi-line name and text fields ──────────────────────────────

// The tallest letter of the handwriting font (ל rises above the line box) must fit in the room the field gives the first
// line: its top padding plus the half-leading plus the font's ascent. Measured with the real font, in the real field.
async function tallestLetterFits(page, selector, sizeOf) {
  return page.evaluate(async ({ selector, sizeOf }) => {
    await document.fonts.load('20px "Gveret Levin"', 'לדוגמה');
    const el = document.querySelector(selector);
    const cs = getComputedStyle(el);
    const size = sizeOf === 'placeholder' ? parseFloat(getComputedStyle(el, '::placeholder').fontSize) : parseFloat(cs.fontSize);
    const ctx = document.createElement('canvas').getContext('2d');
    ctx.font = `${size}px "Gveret Levin"`;
    const m = ctx.measureText('לחךדוגמהל');
    const lineHeight = parseFloat(cs.lineHeight);
    const room = parseFloat(cs.paddingTop) + (lineHeight - (m.fontBoundingBoxAscent + m.fontBoundingBoxDescent)) / 2 + m.fontBoundingBoxAscent;
    return { size, ink: m.actualBoundingBoxAscent, room, padTop: parseFloat(cs.paddingTop), padLeft: parseFloat(cs.paddingLeft), padRight: parseFloat(cs.paddingRight), overflow: cs.overflowY, lineHeight };
  }, { selector, sizeOf });
}

for (const width of WIDTHS) {
  test(`at ${width} px the tall letters are whole in the add-meal text field, the analysis name and the edit-slip name`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await register(page);
    expect((await post(page, '/api/food', { meal_type: 'lunch', food_name: 'חזה עוף בגריל עם אורז וסלט', calories: 480, protein_g: 40, carbs_g: 50, fat_g: 12, fiber_g: 5, logged_at: `${localNow().date}T12:30:00` })).status()).toBe(200);
    await page.goto('/');
    await page.locator('#nav-camera').click();
    await expect(page.locator('#screen-camera')).toBeVisible();

    const field = await tallestLetterFits(page, '#food-text-input', 'text');
    const placeholder = await tallestLetterFits(page, '#food-text-input', 'placeholder');
    expect(field.ink, `typed text: the ל (${field.ink}px) fits the ${field.room}px above the baseline`).toBeLessThanOrEqual(field.room);
    expect(placeholder.ink, `placeholder: the ל (${placeholder.ink}px) fits the ${placeholder.room}px`).toBeLessThanOrEqual(placeholder.room);
    expect(field.padLeft, 'room at the side for the first letter').toBeGreaterThanOrEqual(4);
    expect(field.padRight).toBeGreaterThanOrEqual(4);

    await page.locator('#food-text-input').fill('סלט');
    await page.locator('#text-analyze-btn').click();
    await expect(page.locator('#analysis-result')).toBeVisible();
    const name = await tallestLetterFits(page, '#res-name', 'text');
    expect(name.ink, 'analysis name').toBeLessThanOrEqual(name.room);

    await page.locator('#nav-home').click();
    await page.locator('#meal-list .meal-item-row').first().getByRole('button', { name: 'ערוך' }).click();
    await expect(page.locator('#edit-modal')).toHaveClass(/open/);
    const edit = await tallestLetterFits(page, '#edit-name', 'text');
    expect(edit.ink, 'edit-slip name').toBeLessThanOrEqual(edit.room);
  });
}

// ── the slip titles are captions, clearly not part of what is typed ────────────────────────────────────────────────

test('the three slips have a small graphite caption with a pen rule, well apart from the dish name below it', async ({ page }) => {
  await register(page);
  expect((await post(page, '/api/food', { meal_type: 'lunch', food_name: 'חזה עוף בגריל', calories: 480, protein_g: 40, carbs_g: 50, fat_g: 12, fiber_g: 5, logged_at: `${localNow().date}T12:30:00` })).status()).toBe(200);
  await page.goto('/');
  await page.locator('#nav-home').click();
  await page.locator('#meal-list .meal-item-row').first().getByRole('button', { name: 'ערוך' }).click();
  await expect(page.locator('#edit-modal')).toHaveClass(/open/);
  // the slip drops in with a tilt: measure it where it rests
  await page.evaluate(() => Promise.all(document.getAnimations().filter((x) => x.effect.getComputedTiming().iterations !== Infinity).map((x) => x.finished.catch(() => {}))));
  const edit = await page.evaluate(() => {
    const title = document.getElementById('edit-title');
    const name = document.getElementById('edit-name');
    const cs = getComputedStyle(title);
    return {
      size: parseFloat(cs.fontSize), color: cs.color, rule: getComputedStyle(title, '::after').borderBottomWidth, ruleColor: getComputedStyle(title, '::after').borderBottomColor,
      nameSize: parseFloat(getComputedStyle(name).fontSize), gap: name.getBoundingClientRect().top - title.getBoundingClientRect().bottom,
    };
  });
  expect(edit.size, 'a small caption').toBeLessThanOrEqual(18);
  expect(edit.nameSize, 'the name is much bigger than its caption').toBeGreaterThanOrEqual(edit.size * 1.5);
  expect(edit.color).toBe('rgb(111, 93, 76)');
  expect(parseFloat(edit.rule)).toBeGreaterThan(0);
  expect(edit.ruleColor).toBe('rgb(179, 49, 29)');
  expect(edit.gap, 'clear space between the caption and the name').toBeGreaterThanOrEqual(10);
  await page.locator('#edit-modal-close').click();

  // the other two slips share the caption style
  await page.locator('#nav-settings').click();
  for (const [button, slip, title] of [['פרופיל גוף ויעד', '#modal-profile', '#mp-title'], ['שינוי סיסמה', '#modal-change-pass', '#cp-title']]) {
    await page.locator('#screen-settings').getByRole('button', { name: button }).click();
    await expect(page.locator(slip)).toHaveClass(/open/);
    const t = await page.locator(title).evaluate((el) => ({ size: parseFloat(getComputedStyle(el).fontSize), color: getComputedStyle(el).color, rule: getComputedStyle(el, '::after').borderBottomWidth }));
    expect(t.size).toBe(edit.size);
    expect(t.color).toBe(edit.color);
    expect(parseFloat(t.rule)).toBeGreaterThan(0);
    await page.locator(`${slip} .modal-close`).click();
    await expect(page.locator(slip)).not.toHaveClass(/open/);
  }
});

// ── the credit: two lines on every phone, the first never wraps, readable on the leather ─────────────────────────

for (const width of [320, 360, 390]) {
  test(`at ${width} px the credit is exactly two lines on the welcome cover and on the settings page`, async ({ page }) => {
    await page.setViewportSize({ width, height: 640 });
    await page.goto('/');
    await expect(page.locator('#screen-welcome')).toBeVisible();
    await page.evaluate(() => document.fonts.ready);

    const measure = (screenSel, boundsSel) => page.evaluate(({ screenSel, boundsSel }) => {
      const credit = document.querySelector(`${screenSel} .credit`);
      const [first, second] = credit.children;
      const range = document.createRange();
      range.selectNodeContents(first);
      const rects = [...range.getClientRects()];
      const bounds = document.querySelector(boundsSel).getBoundingClientRect();
      const margin = document.querySelector(`${screenSel} .margin`);
      const limit = margin ? margin.getBoundingClientRect().left : bounds.right;
      const fr = first.getBoundingClientRect();
      return {
        children: credit.children.length, text: first.textContent.trim(), lineRects: rects.length, lineH: rects[0].height, lineHeight: parseFloat(getComputedStyle(first).lineHeight),
        left: rects[0].left, right: rects[0].right, boundsLeft: bounds.left, limit, secondTop: second.getBoundingClientRect().top, firstBottom: fr.bottom,
        wsp: getComputedStyle(first).whiteSpace,
      };
    }, { screenSel, boundsSel });
    const check = (m, where) => {
      expect(m.children, `${where}: two lines`).toBe(2);
      expect(m.text).toBe('Your Personal Food Logger - By Dar Lindman');
      expect(m.lineRects, `${where}: the first line is one line`).toBe(1);
      expect(m.lineH, `${where}: one line tall`).toBeLessThanOrEqual(m.lineHeight * 1.5);
      expect(m.wsp).toBe('nowrap');
      expect(m.left, `${where}: inside the left edge`).toBeGreaterThanOrEqual(m.boundsLeft);
      expect(m.right, `${where}: left of the right limit`).toBeLessThanOrEqual(m.limit + 0.5);
      expect(m.secondTop, `${where}: the link is under the first line`).toBeGreaterThanOrEqual(m.firstBottom - 1);
    };
    check(await measure('#screen-welcome', '.phone-frame'), `welcome at ${width}`);

    // on the leather the credit and its link are clearly readable (contrast against the cover colour)
    const contrast = await page.evaluate(() => {
      const lum = (rgb) => { const [r, g, b] = rgb.match(/[\d.]+/g).slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
      const ratio = (fg, bg) => { const a = lum(fg), b = lum(bg); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); };
      const bg = getComputedStyle(document.querySelector('.phone-frame')).backgroundColor;
      return { text: ratio(getComputedStyle(document.querySelector('.welcome-footer')).color, bg), link: ratio(getComputedStyle(document.querySelector('.welcome-footer a')).color, bg) };
    });
    expect(contrast.text, 'credit text contrast').toBeGreaterThanOrEqual(7);
    expect(contrast.link, 'credit link contrast').toBeGreaterThanOrEqual(7);

    await register(page, { profile: null });
    await page.goto('/');
    await expect(page.locator('#screen-dashboard')).toBeVisible();
    await page.locator('#nav-settings').click();
    await expect(page.locator('#screen-settings')).toBeVisible();
    check(await measure('#screen-settings', '#screen-settings .page'), `settings at ${width}`);
  });
}

// ── the pen rule runs under the whole slip title, also when it wraps ───────────────────────────────────────────────

for (const width of WIDTHS) {
  test(`at ${width} px the pen rule under each slip title spans the whole title text`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await register(page);
    expect((await post(page, '/api/food', { meal_type: 'lunch', food_name: 'חזה עוף', calories: 480, protein_g: 40, carbs_g: 50, fat_g: 12, fiber_g: 5, logged_at: `${localNow().date}T12:30:00` })).status()).toBe(200);
    await page.goto('/');
    const covers = (titleSel) => page.evaluate((titleSel) => {
      const title = document.querySelector(titleSel);
      const range = document.createRange();
      range.selectNodeContents(title);
      const text = range.getBoundingClientRect();
      const tb = title.getBoundingClientRect();
      const cs = getComputedStyle(title, '::after');
      // the rule is absolutely placed: its box is the title's padding box between its left and right offsets
      const left = tb.left + parseFloat(cs.left || 0), width = parseFloat(cs.width);
      const overlap = Math.max(0, Math.min(left + width, text.right) - Math.max(left, text.left));
      return { coverage: overlap / text.width, textW: text.width, ruleW: width, bottomGap: tb.bottom - text.bottom, ruleH: parseFloat(cs.borderBottomWidth) };
    }, titleSel);

    await page.locator('#nav-home').click();
    await page.locator('#meal-list .meal-item-row').first().getByRole('button', { name: 'ערוך' }).click();
    await expect(page.locator('#edit-modal')).toHaveClass(/open/);
    await page.evaluate(() => Promise.all(document.getAnimations().filter((x) => x.effect.getComputedTiming().iterations !== Infinity).map((x) => x.finished.catch(() => {}))));
    const results = { 'עריכת מנה': await covers('#edit-title') };
    await page.locator('#edit-modal-close').click();
    await page.locator('#nav-settings').click();
    for (const [button, slip, title, name] of [['פרופיל גוף ויעד', '#modal-profile', '#mp-title', 'פרופיל גוף ויעד'], ['שינוי סיסמה', '#modal-change-pass', '#cp-title', 'שינוי סיסמה']]) {
      await page.locator('#screen-settings').getByRole('button', { name: button }).click();
      await expect(page.locator(slip)).toHaveClass(/open/);
      await page.evaluate(() => Promise.all(document.getAnimations().filter((x) => x.effect.getComputedTiming().iterations !== Infinity).map((x) => x.finished.catch(() => {}))));
      results[name] = await covers(title);
      await page.locator(`${slip} .modal-close`).click();
      await expect(page.locator(slip)).not.toHaveClass(/open/);
    }
    for (const [name, r] of Object.entries(results)) {
      expect(r.coverage, `${name}: the rule (${r.ruleW}px) covers the text (${r.textW}px)`).toBeGreaterThanOrEqual(0.95);
      expect(r.ruleW, `${name}: the rule is at least as wide as the text`).toBeGreaterThanOrEqual(r.textW * 0.95);
      expect(r.ruleH).toBeGreaterThan(0);
    }
  });
}
