'use strict';

// Task 11: the analysis in progress (the capybara with a magnifier, the bubble "מחשב כמה יש בצלחת…" and a progress bar)
// and the analysis result (the photo as a polaroid, the handwritten dish name, the circled calories, the printed receipt
// with the stamp "נרשם", the meal-type chips, the time and "שמור ביומן"). Only the fake AI is ever called; the replies of
// the tests that need a particular reply are stubbed with page.route.

const { test, expect } = require('@playwright/test');
const { attachGuards, expectNoGuardEvents, SIGNED_OUT_ME, SAVE_TO_DIARY } = require('./helpers');
const { realJpeg } = require('../helpers/jpeg');

const PASSWORD = 'receipt-pass-1234';
const CSRF = { Origin: 'http://localhost:3100', 'X-FL-Client': '1' };
const uniqueName = () => `receipt${Date.now()}${Math.floor(Math.random() * 1000)}`;
const TEXT_API = /\/api\/analyze-text$/;
const IMAGE_API = /\/api\/analyze$/;

async function signIn(page) {
  const reg = await page.request.post('/auth/register', { headers: CSRF, data: { username: uniqueName(), password: PASSWORD } });
  expect(reg.status(), await reg.text()).toBe(200);
  const prof = await page.request.put('/api/profile', { headers: CSRF, data: { gender: 'male', birthDate: '1990-05-15', height: 175, weight: 70, activity: 'light', goalKg: 0 } });
  expect(prof.status()).toBe(200);
}

async function openAdd(page) {
  await page.goto('/');
  await expect(page.locator('#screen-dashboard')).toBeVisible();
  await page.locator('#nav-camera').click();
  await expect(page.locator('#screen-camera')).toBeVisible();
}

async function analyzeText(page, text = 'סלט ולחם') {
  await page.locator('#food-text-input').fill(text);
  await page.locator('#text-analyze-btn').click();
  await expect(page.locator('#screen-analysis')).toBeVisible();
}

async function choosePhoto(page) {
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 15_000 }),
    page.locator('.cam-frame').click(),
  ]);
  await chooser.setFiles({ name: 'meal.jpg', mimeType: 'image/jpeg', buffer: realJpeg(120, 90, 150) });
  await expect(page.locator('#preview-img')).toBeVisible();
}

// A reply for the stubbed text analysis (the shape of analyzeText in src/lib/analysis.js).
const reply = (over = {}) => ({
  foodName: 'שניצל עם כוסמת', calories: 722, protein_g: 38, carbs_g: 68, fat_g: 33, fiber_g: 4,
  items: [{ name: 'שניצל', calories: 380 }, { name: 'כוסמת', calories: 272 }, { name: 'סלט ירקות', calories: 70 }],
  ...over,
});
const stub = (page, body, status = 200) => page.route(TEXT_API, (route) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) }));

const box = async (loc) => {
  const b = await loc.boundingBox();
  expect(b, 'element has a box').not.toBeNull();
  return b;
};
const intersects = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

// Pauses every animation of the receipt block at `ms` (null = finish them) and returns after the style is applied.
const seek = (page, ms) => page.evaluate((t) => {
  document.getAnimations().forEach((a) => {
    if (!(a.effect && a.effect.target && a.effect.target.closest('#analysis-result'))) return;
    if (t === null) a.finish(); else { a.pause(); a.currentTime = t; }
  });
}, ms);
const opacityOf = (loc) => loc.evaluate((el) => Number(getComputedStyle(el).opacity));

test.describe('analysis in progress', () => {
  let guards;
  test.beforeEach(async ({ page }) => { guards = attachGuards(page); await signIn(page); });

  for (const vp of [{ width: 390, height: 844 }, { width: 320, height: 640 }]) {
    test(`waiting (${vp.width}px): capybara with a magnifier, the bubble, a progress bar; nothing overlaps`, async ({ page }) => {
      await page.setViewportSize(vp);
      let release;
      const gate = new Promise((r) => { release = r; });
      await page.route(TEXT_API, async (route) => { await gate; await route.continue(); });
      await page.route(IMAGE_API, async (route) => { await gate; await route.continue(); });
      await openAdd(page);

      // a text analysis: no photo
      await analyzeText(page);
      const wait = page.locator('#analysis-loading');
      await expect(wait).toBeVisible();
      await expect(page.locator('#analysis-result')).toBeHidden();
      const bubble = wait.locator('.wait-bubble');
      await expect(bubble).toHaveText('מחשב כמה יש בצלחת…');
      await expect(wait.locator('.wait-pet svg.pet-inked')).toBeVisible();
      await expect(wait.locator('.wait-pet .pet--thinking')).toHaveCount(1);
      await expect(wait.locator('.wait-magnifier')).toBeVisible();
      const bar = wait.locator('.wait-bar');
      await expect(bar).toBeVisible();
      expect((await box(bar)).width).toBeGreaterThan(100);
      expect(await page.locator('#screen-analysis').innerText()).not.toMatch(/קבלה|מוכנה/);

      const page_ = await box(page.locator('#screen-analysis .page'));
      const noOverlap = async (label) => {
        const b = await box(bubble);
        for (const [what, sel] of [['capybara', '.wait-pet svg.pet-inked'], ['magnifier', '.wait-magnifier'], ['polaroid', '.polaroid:visible']]) {
          const loc = wait.locator(sel);
          if (!(await loc.count())) continue;
          expect(intersects(b, await box(loc)), `${label}: the bubble overlaps the ${what}`).toBe(false);
        }
        expect(b.x).toBeGreaterThanOrEqual(page_.x);
        expect(b.x + b.width).toBeLessThanOrEqual(page_.x + page_.width);
      };
      await noOverlap('text');

      // the same page while a photo is analysed: the photo is a polaroid above them
      await page.locator('#nav-camera').click();
      await choosePhoto(page);
      await page.locator('#analyze-btn').click();
      await expect(wait).toBeVisible();
      await expect(wait.locator('.polaroid')).toBeVisible();
      expect(await wait.locator('.polaroid #analysis-img').getAttribute('src')).toMatch(/^data:image\/jpeg/);
      await noOverlap('photo');
      const pol = await box(wait.locator('.polaroid'));
      expect(intersects(pol, await box(wait.locator('.wait-pet svg.pet-inked')))).toBe(false);
      expect(intersects(pol, await box(wait.locator('.wait-magnifier')))).toBe(false);

      release();
      await expect(page.locator('#analysis-result')).toBeVisible();
      await expect(wait).toBeHidden();
      expectNoGuardEvents(guards, [SIGNED_OUT_ME]);
    });
  }

  test('a failed analysis shows the error and no result; a late reply of an abandoned analysis is ignored', async ({ page }) => {
    await openAdd(page);
    await stub(page, { error: { code: 'AI_UNAVAILABLE' } }, 502);
    await analyzeText(page);
    await expect(page.locator('#analysis-error')).not.toHaveText('');
    await expect(page.locator('#analysis-result')).toBeHidden();
    await expect(page.locator('#analysis-loading')).toBeHidden();
    await page.unroute(TEXT_API);

    // analysis A is slow; the user leaves, starts B, and A's reply must not replace B's result
    let first = true;
    let releaseA;
    const gateA = new Promise((r) => { releaseA = r; });
    await page.route(TEXT_API, async (route) => {
      if (first) {
        first = false;
        await gateA;
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(reply({ foodName: 'ישן ומיושן' })) });
      } else {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(reply({ foodName: 'חדש וטרי' })) });
      }
    });
    await page.locator('#nav-camera').click();
    await analyzeText(page, 'א');
    await expect(page.locator('#analysis-loading')).toBeVisible();
    await page.locator('#nav-camera').click();
    await expect(page.locator('#screen-camera')).toBeVisible();
    await analyzeText(page, 'ב');
    await expect(page.locator('#analysis-result')).toBeVisible();
    await expect(page.locator('#res-name')).toHaveValue('חדש וטרי');
    releaseA();
    await page.waitForTimeout(400);
    await expect(page.locator('#res-name')).toHaveValue('חדש וטרי');
    await expect(page.locator('#analysis-result')).toBeVisible();
    expectNoGuardEvents(guards, [SIGNED_OUT_ME, /status of 502/]);
  });
});

test.describe('analysis result and the receipt', () => {
  let guards;
  test.beforeEach(async ({ page }) => { guards = attachGuards(page); await signIn(page); });

  test('text analysis: the fake items with their calories and the total, no title, no grams, no item controls', async ({ page }) => {
    await openAdd(page);
    await analyzeText(page);
    const result = page.locator('#analysis-result');
    await expect(result).toBeVisible();

    // no photo for a text analysis
    await expect(result.locator('.polaroid:visible')).toHaveCount(0);
    await expect(page.locator('#screen-analysis')).toContainText('הארוחה שזיהיתי');

    // the handwritten name and the circled calories are inputs
    const name = page.locator('#res-name');
    await expect(name).not.toHaveValue('');
    expect(await name.evaluate((el) => el.tagName)).toMatch(/^(TEXTAREA|INPUT)$/);
    const cal = page.locator('#res-cal');
    expect(await cal.getAttribute('type')).toBe('number');
    expect(Number(await cal.inputValue())).toBe(145);
    await expect(result.locator('.circ #res-cal')).toHaveCount(1);
    expect(await cal.evaluate((el) => getComputedStyle(el).fontFamily)).toContain('Digits');

    // the receipt, in a lift wrapper that holds the tape
    const lift = result.locator('.receipt-lift');
    await expect(lift).toHaveCount(1);
    await expect(lift.locator('> .tape')).toHaveCount(1);
    const slip = lift.locator('> .receipt-slip');
    await expect(slip).toHaveCount(1);
    expect(await lift.evaluate((el) => getComputedStyle(el).filter)).toContain('drop-shadow');
    expect(await slip.evaluate((el) => getComputedStyle(el).fontFamily)).toContain('Cousine');
    const rows = slip.locator('.l');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText('סלט');
    await expect(rows.nth(0).locator('b')).toHaveText('80');
    await expect(rows.nth(1)).toContainText('לחם');
    await expect(rows.nth(1).locator('b')).toHaveText('65');
    await expect(slip.locator('.tt b')).toHaveText('145');
    await expect(slip.locator('.mac')).toContainText('חלבון');

    // no title and no word "קבלה" anywhere; no grams of a component; nothing to edit per item
    expect(await slip.locator('h1, h2, h3, h4, .receipt-title').count()).toBe(0);
    expect(await page.locator('#screen-analysis').innerText()).not.toContain('קבלה');
    for (let i = 0; i < 2; i++) expect(await rows.nth(i).innerText()).not.toContain('גרם');
    expect(await slip.locator('input, button, textarea, select, [data-action]').count()).toBe(0);

    expectNoGuardEvents(guards, [SIGNED_OUT_ME]);
  });

  test('the receipt prints from the top, then the stamp lands at the end', async ({ page }) => {
    await openAdd(page);
    await analyzeText(page);
    const lift = page.locator('#analysis-result .receipt-lift');
    const slip = lift.locator('.receipt-slip');
    const stamp = lift.locator('.stamp');
    await expect(stamp).toHaveText('נרשם');

    // right after the result appears the stamp has not landed (opacity 0 is "visible" to Playwright, so the style is read)
    expect(await opacityOf(stamp)).toBeLessThan(0.1);
    const timing = await page.evaluate(() => {
      const slipAnim = document.getAnimations().find((a) => a.effect.target.matches('#analysis-result .receipt-slip'));
      const stampAnim = document.getAnimations().find((a) => a.effect.target.matches('#analysis-result .stamp'));
      return slipAnim && stampAnim ? {
        slipDuration: slipAnim.effect.getTiming().duration,
        stampDelay: stampAnim.effect.getTiming().delay,
      } : null;
    });
    expect(timing, 'both the slide and the stamp are animated').not.toBeNull();
    expect(timing.slipDuration).toBeGreaterThanOrEqual(1000);
    expect(timing.stampDelay).toBeGreaterThanOrEqual(timing.slipDuration);   // the stamp comes after the print-out

    // half way: the paper has come out from the TOP (clip from the bottom), the stamp is still hidden
    await seek(page, 600);
    const clip = await slip.evaluate((el) => getComputedStyle(el).clipPath);
    const m = /inset\(([^)]*)\)/.exec(clip);
    expect(m, `clip-path while printing: ${clip}`).not.toBeNull();
    const [top, , bottom] = m[1].trim().split(/\s+/);
    expect(parseFloat(top)).toBe(0);
    expect(parseFloat(bottom)).toBeGreaterThan(5);
    expect(await opacityOf(stamp)).toBeLessThan(0.1);

    // done: the whole receipt and the stamp
    await seek(page, null);
    await expect.poll(() => opacityOf(stamp)).toBeGreaterThan(0.8);
    await expect(stamp).toBeVisible();
    const done = await slip.evaluate((el) => getComputedStyle(el).clipPath);
    expect(done === 'none' || /^inset\(0(px|%)?( 0(px|%)?)*\)$/.test(done), `clip-path after printing: ${done}`).toBe(true);
    // the stamp sits on the receipt
    const sb = await box(stamp);
    const lb = await box(lift);
    expect(intersects(sb, lb)).toBe(true);
    expectNoGuardEvents(guards, [SIGNED_OUT_ME]);
  });

  test('reduced motion: the receipt is fully visible at once, the stamp too, nothing animates', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openAdd(page);
    await analyzeText(page);
    const lift = page.locator('#analysis-result .receipt-lift');
    await expect(lift).toBeVisible();
    const slip = lift.locator('.receipt-slip');
    const stamp = lift.locator('.stamp');
    await expect(stamp).toBeVisible();
    expect(await opacityOf(stamp)).toBeGreaterThan(0.8);
    expect(await slip.evaluate((el) => getComputedStyle(el).clipPath)).toBe('none');
    const running = await page.evaluate(() => document.getAnimations()
      .filter((a) => a.effect && a.effect.target && a.effect.target.closest('#analysis-result') && a.playState === 'running').length);
    expect(running).toBe(0);
    for (const row of await slip.locator('.l').all()) expect(await opacityOf(row)).toBe(1);
    expectNoGuardEvents(guards, [SIGNED_OUT_ME]);
  });

  test('a reply of 8 items that sum to more than 4 kcal under the total gets one "ועוד" row with the remainder', async ({ page }) => {
    await openAdd(page);
    const items = Array.from({ length: 8 }, (_, i) => ({ name: `פריט ${i + 1}`, calories: 40 }));   // 320
    await stub(page, reply({ foodName: 'צלחת גדולה', calories: 500, items }));
    await analyzeText(page);
    const slip = page.locator('#analysis-result .receipt-slip');
    const rows = slip.locator('.l');
    await expect(rows).toHaveCount(9);
    await expect(rows.nth(8)).toContainText('ועוד');
    await expect(rows.nth(8).locator('b')).toHaveText('180');
    await expect(slip.locator('.tt b')).toHaveText('500');
    expect(await slip.innerText()).not.toContain('גרם');

    // 8 items that add up (rounding drift of at most 4), and fewer than 8 items: no such row
    await page.locator('#nav-camera').click();
    await page.unroute(TEXT_API);
    await stub(page, reply({ calories: 322, items }));
    await analyzeText(page, 'ב');
    await expect(slip.locator('.tt b')).toHaveText('322');
    await expect(slip.locator('.l')).toHaveCount(8);
    await expect(slip).not.toContainText('ועוד');

    await page.locator('#nav-camera').click();
    await page.unroute(TEXT_API);
    await stub(page, reply({ calories: 500, items: items.slice(0, 7) }));
    await analyzeText(page, 'ג');
    await expect(slip.locator('.tt b')).toHaveText('500');
    await expect(slip.locator('.l')).toHaveCount(7);
    await expect(slip).not.toContainText('ועוד');
    expectNoGuardEvents(guards, [SIGNED_OUT_ME]);
  });

  test('odd replies never break the layout: no items, 12 items, an empty name, a very long name, markup in names', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await openAdd(page);
    const longName = 'מנה עם שם ארוך מאוד מאוד של ארוחה שלמה '.repeat(6).trim();
    const cases = [
      reply({ items: [] }),
      reply({ foodName: longName, items: Array.from({ length: 12 }, (_, i) => ({ name: `פריט ארוך מאוד עם הרבה מאוד מילים ${i}`, calories: 10 })) }),
      reply({ items: [{ name: '', calories: 100 }, { name: '<img src=x onerror=alert(1)>', calories: 5 }, { name: 'Pasta alla carbonara con funghi e salsiccia', calories: 7 }] }),
    ];
    for (const body of cases) {
      await page.locator('#nav-camera').click();
      await page.unroute(TEXT_API).catch(() => {});
      await stub(page, body);
      await analyzeText(page);
      await expect(page.locator('#analysis-result')).toBeVisible();
      await seek(page, null);
      const pageBox = await box(page.locator('#screen-analysis .page'));
      const lift = await box(page.locator('#analysis-result .receipt-lift'));
      expect(lift.x).toBeGreaterThanOrEqual(pageBox.x);
      expect(lift.x + lift.width).toBeLessThanOrEqual(pageBox.x + pageBox.width);
      const slipRows = page.locator('#analysis-result .receipt-slip .l');
      expect(await slipRows.count()).toBeLessThanOrEqual(9);
      for (const row of await slipRows.all()) {
        const r = await box(row);
        expect(r.x + r.width).toBeLessThanOrEqual(lift.x + lift.width + 1);
      }
      const noHScroll = await page.locator('#screen-analysis .content').evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
      expect(noHScroll).toBe(true);
      const nameBox = await box(page.locator('#res-name'));
      expect(nameBox.x + nameBox.width).toBeLessThanOrEqual(pageBox.x + pageBox.width);
      expect(nameBox.x).toBeGreaterThanOrEqual(pageBox.x);
    }
    expect(await page.locator('#analysis-result img[src="x"]').count()).toBe(0);
    expectNoGuardEvents(guards, [SIGNED_OUT_ME]);
  });

  test('photo analysis: the photo becomes the polaroid of the result, with the circled calories beside it', async ({ page }) => {
    await openAdd(page);
    await choosePhoto(page);
    await page.locator('#analyze-btn').click();
    await expect(page.locator('#analysis-result')).toBeVisible();
    const pol = page.locator('#analysis-result .polaroid');
    await expect(pol).toBeVisible();
    await expect(pol.locator('#analysis-img')).toBeVisible();
    expect(await pol.locator('#analysis-img').getAttribute('src')).toMatch(/^data:image\/jpeg/);
    await expect(pol.locator('.cp')).toHaveText(/^\d{2}:\d{2}$/);
    const circ = await box(page.locator('#analysis-result .circ'));
    expect(intersects(await box(pol), circ), 'the circled calories never sit on the photo').toBe(false);
    await expect(page.locator('#analysis-result .receipt-slip .l')).toHaveCount(2);   // the fake image reply: עוף, אורז
    await expect(page.locator('#analysis-result .receipt-slip .tt b')).toHaveText('450');

    // the next analysis is a text one: the polaroid is gone
    await page.locator('#nav-camera').click();
    await analyzeText(page);
    await expect(page.locator('#analysis-result')).toBeVisible();
    await expect(page.locator('#analysis-result .polaroid:visible')).toHaveCount(0);
    expectNoGuardEvents(guards, [SIGNED_OUT_ME]);
  });

  test('save: the edited name, calories and macros, the chosen meal and time reach the diary; "ערוך" focuses the totals', async ({ page }) => {
    await openAdd(page);
    await analyzeText(page);
    await expect(page.locator('#analysis-result')).toBeVisible();
    await seek(page, null);

    await expect(page.locator('#screen-analysis .meal-opt')).toHaveCount(4);
    await expect(page.locator('#screen-analysis .meal-opt.selected')).toHaveCount(1);
    await page.locator('#screen-analysis .meal-opt', { hasText: 'ערב' }).click();
    await expect(page.locator('#screen-analysis .meal-opt.selected')).toHaveAttribute('data-meal', 'dinner');

    await page.getByRole('button', { name: 'ערוך' }).click();
    await expect(page.locator('#res-cal')).toBeFocused();

    await page.locator('#res-name').fill('ארוחה ערוכה');
    await page.locator('#res-cal').fill('333');
    await page.locator('#res-pro').fill('21');
    await page.locator('#res-carb').fill('22');
    await page.locator('#res-fat').fill('23');
    await page.locator('#res-fiber').fill('4');
    await page.locator('#res-time').fill('13:05');
    const save = page.getByRole('button', { name: 'שמור ביומן' });
    await expect(save).toHaveAttribute('id', 'save-entry-btn');
    await save.click();
    await expect(page.locator('#screen-home')).toBeVisible(SAVE_TO_DIARY);
    const row = page.locator('#meal-list .meal-item-row');
    await expect(row).toHaveCount(1);
    await expect(row.locator('.mir-name')).toHaveText('ארוחה ערוכה');
    await expect(page.locator('#sum-cal')).toHaveText('333');
    const list = await (await page.request.get('/api/food')).json();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ food_name: 'ארוחה ערוכה', meal_type: 'dinner' });
    expect(Number(list[0].calories)).toBe(333);
    expect(Number(list[0].protein_g)).toBe(21);
    expect(String(list[0].logged_at)).toContain('T13:05');
    expectNoGuardEvents(guards, [SIGNED_OUT_ME]);
  });

  test('saving twice is impossible: the button stays disabled until the diary opens', async ({ page }) => {
    await openAdd(page);
    await analyzeText(page);
    await expect(page.locator('#analysis-result')).toBeVisible();
    await page.locator('#save-entry-btn').click();
    await expect(page.locator('#save-entry-btn')).toBeDisabled();
    await expect(page.locator('#screen-home')).toBeVisible(SAVE_TO_DIARY);
    await expect(page.locator('#meal-list .meal-item-row')).toHaveCount(1);
    expectNoGuardEvents(guards, [SIGNED_OUT_ME]);
  });
});
