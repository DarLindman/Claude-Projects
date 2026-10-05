'use strict';

// Task 10: the add-meal page and the meal thumbnails made by the browser.
// Before a photo: one large dashed frame is the button ("לחץ לצילום" / "או בחר תמונה מהגלריה"), the meal-type chips and the
// text line. After a photo: the frame becomes a taped polaroid, "צלם שוב" and the red ink button "נתח את הצלחת".
// Saving a photo meal sends a small JPEG thumbnail (PUT /api/food/:id/photo) in the background; if that fails the meal is
// still saved, the diary shows the drawn plate and the user sees no error.

const { createCanvas } = require('@napi-rs/canvas');
const { test, expect } = require('@playwright/test');
const { attachGuards, expectNoGuardEvents, SIGNED_OUT_ME, SAVE_TO_DIARY } = require('./helpers');
const { realJpeg } = require('../helpers/jpeg');

const PASSWORD = 'addmeal-pass-1234';
const CSRF = { Origin: 'http://localhost:3100', 'X-FL-Client': '1' };
const uniqueName = () => `addmeal${Date.now()}${Math.floor(Math.random() * 1000)}`;
const PHOTO_URL = /\/api\/food\/\d+\/photo$/;

// A photo-like picture (gradient, blobs and a little noise) of about 3 MB, the size of a phone photo.
function bigPhoto(w = 3000, h = 2250, quality = 92) {
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#cc9988'); g.addColorStop(1, '#77aa55');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  let s = 7;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 400; i++) {
    ctx.fillStyle = `rgba(${rnd() * 255 | 0},${rnd() * 255 | 0},${rnd() * 255 | 0},.6)`;
    ctx.beginPath(); ctx.arc(rnd() * w, rnd() * h, 20 + rnd() * 200, 0, 7); ctx.fill();
  }
  const img = ctx.getImageData(0, 0, w, h);
  for (let i = 0; i < img.data.length; i += 4) { const n = (rnd() - 0.5) * 40; img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n; }
  ctx.putImageData(img, 0, 0);
  return canvas.toBuffer('image/jpeg', quality);
}

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

const photoFile = (buffer = realJpeg(60, 40, 120)) => ({ name: 'meal.jpg', mimeType: 'image/jpeg', buffer });

// Chooses a photo through the real file chooser (the frame is the button), then waits for the polaroid.
async function choosePhoto(page, file = photoFile()) {
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 15_000 }),
    page.locator('.cam-frame').click(),
  ]);
  await chooser.setFiles(file);
  await expect(page.locator('#preview-img')).toBeVisible();
}

// The thumbnail the server now holds for the newest meal (Chromium does not expose a Blob request body to Playwright, so
// the bytes are read back through the API): a JPEG of at most 120 KB.
async function expectStoredThumbnail(page) {
  const list = await (await page.request.get('/api/food')).json();
  const id = list.at(-1).id;
  expect(list.at(-1).has_photo).toBe(true);
  const res = await page.request.get(`/api/food/${id}/photo`);
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toBe('image/jpeg');
  const bytes = await res.body();
  expect(bytes.subarray(0, 3).toString('hex')).toBe('ffd8ff');
  expect(bytes.length).toBeLessThan(120 * 1024);
}

async function analyzeAndSave(page) {
  await page.locator('#analyze-btn').click();
  await expect(page.locator('#screen-analysis')).toBeVisible();
  await expect(page.locator('#analysis-result')).toBeVisible();
  await page.locator('#save-entry-btn').click();
}

test.describe('add meal', () => {
  let guards;
  test.beforeEach(async ({ page }) => { guards = attachGuards(page); await signIn(page); });

  test('before a photo: one large dashed frame is the button, with both texts, chips and the text line', async ({ page }) => {
    await openAdd(page);
    const frame = page.locator('.cam-frame');
    await expect(frame).toBeVisible();
    await expect(frame).toHaveAttribute('data-action', 'pickImage');
    await expect(frame).toContainText('לחץ לצילום');
    await expect(frame).toContainText('או בחר תמונה מהגלריה');
    expect(await frame.evaluate((el) => getComputedStyle(el).borderTopStyle)).toBe('dashed');
    const fb = await frame.boundingBox();
    expect(fb.width).toBeGreaterThan(280);
    expect(fb.height).toBeGreaterThan(200);

    // the old round shutter is gone; the polaroid and the analyse button wait for a photo
    await expect(page.locator('.cam-btn-shoot')).toHaveCount(0);
    await expect(page.locator('#preview-img')).toBeHidden();
    await expect(page.locator('#analyze-btn')).toBeHidden();
    await expect(page.locator('#cam-preview .cam-retake')).toBeHidden();

    // the chips, the text line and its button stay (hook contract)
    await expect(page.locator('#screen-camera .chip')).toHaveCount(4);
    await expect(page.locator('#food-text-input')).toBeVisible();
    await expect(page.locator('#text-analyze-btn')).toBeVisible();

    // the whole frame opens the chooser
    const [chooser] = await Promise.all([page.waitForEvent('filechooser', { timeout: 15_000 }), frame.click({ position: { x: 8, y: 8 } })]);
    expect(chooser.isMultiple()).toBe(false);
    expectNoGuardEvents(guards, [SIGNED_OUT_ME]);
  });

  test('after a photo: polaroid, "צלם שוב" and the red button; the frame and the shutter are gone', async ({ page }) => {
    await openAdd(page);
    await choosePhoto(page);
    await expect(page.locator('#cam-preview .polaroid #preview-img')).toBeVisible();
    expect(await page.locator('#preview-img').getAttribute('src')).toMatch(/^data:image\/jpeg/);
    await expect(page.locator('.cam-frame')).toBeHidden();
    await expect(page.locator('.cam-btn-shoot')).toHaveCount(0);

    const again = page.getByRole('button', { name: 'צלם שוב' });
    await expect(again).toBeVisible();
    await expect(again).toHaveAttribute('data-action', 'pickImage');
    const analyze = page.getByRole('button', { name: 'נתח את הצלחת' });
    await expect(analyze).toBeVisible();
    await expect(analyze).toBeEnabled();
    await expect(analyze).toHaveAttribute('id', 'analyze-btn');
    await expect(analyze).toHaveAttribute('data-action', 'analyzeFood');

    // "צלם שוב" opens the chooser again and replaces the photo
    const before = await page.locator('#preview-img').getAttribute('src');
    const [chooser] = await Promise.all([page.waitForEvent('filechooser', { timeout: 15_000 }), again.click()]);
    await chooser.setFiles(photoFile(realJpeg(80, 80, 200)));
    await expect.poll(() => page.locator('#preview-img').getAttribute('src')).not.toBe(before);
    expectNoGuardEvents(guards, [SIGNED_OUT_ME]);
  });

  test('the meal chips choose the type: the polaroid caption follows, the analysis page and the saved meal agree', async ({ page }) => {
    await openAdd(page);
    const chip = (name) => page.locator('#screen-camera .chip', { hasText: name });
    await expect(page.locator('#screen-camera .chip.on')).toHaveCount(1);
    await expect(chip('צהריים')).toHaveClass(/\bon\b/);
    await chip('ערב').click();
    await expect(page.locator('#screen-camera .chip.on')).toHaveText('ערב');
    await choosePhoto(page);
    await expect(page.locator('#cam-preview .polaroid .cp')).toHaveText('ערב');
    await chip('בוקר').click();
    await expect(page.locator('#cam-preview .polaroid .cp')).toHaveText('בוקר');
    await analyzeAndSave(page);
    await expect(page.locator('#screen-analysis .meal-opt.selected')).toHaveAttribute('data-meal', 'breakfast');
    await expect(page.locator('#meal-list .meal-item-row')).toHaveCount(1, SAVE_TO_DIARY);
    const list = await (await page.request.get('/api/food')).json();
    expect(list.at(-1).meal_type).toBe('breakfast');
    expectNoGuardEvents(guards, [SIGNED_OUT_ME]);
  });

  test('saving a photo meal uploads a small JPEG thumbnail, and the diary then shows it', async ({ page }) => {
    await openAdd(page);
    await choosePhoto(page);
    const put = page.waitForRequest((r) => r.method() === 'PUT' && PHOTO_URL.test(r.url()));
    await analyzeAndSave(page);
    const req = await put;
    expect(req.headers()['content-type']).toBe('image/jpeg');
    expect(req.headers()['x-fl-client']).toBe('1');
    expect((await req.response()).status()).toBe(200);
    await expectStoredThumbnail(page);

    await expect(page.locator('#screen-home')).toBeVisible(SAVE_TO_DIARY);
    const row = page.locator('#meal-list .meal-item-row');
    await expect(row).toHaveCount(1);
    await expect(row.locator('img[data-photo]')).toBeVisible();
    await expect.poll(() => row.locator('img[data-photo]').evaluate((i) => i.complete && i.naturalWidth > 0)).toBe(true);
    await expect(row.locator('.plate-ph')).toHaveCount(0);

    // the camera page starts empty again
    await page.locator('#nav-camera').click();
    await expect(page.locator('.cam-frame')).toBeVisible();
    await expect(page.locator('#preview-img')).toBeHidden();
    expectNoGuardEvents(guards, [SIGNED_OUT_ME]);
  });

  test('a failing thumbnail upload never blocks the meal: saved, plate in the diary, no error shown', async ({ page }) => {
    await page.route(PHOTO_URL, (route) => route.request().method() === 'PUT'
      ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":{"code":"INTERNAL"}}' })
      : route.continue());
    await openAdd(page);
    await choosePhoto(page);
    const put = page.waitForRequest((r) => r.method() === 'PUT' && PHOTO_URL.test(r.url()));
    await analyzeAndSave(page);
    await put;

    // no error toast at any point until the diary opens
    const toastTexts = [];
    const watcher = setInterval(() => page.locator('#toast.show').textContent({ timeout: 200 }).then((t) => toastTexts.push(t)).catch(() => {}), 150);
    await expect(page.locator('#screen-home')).toBeVisible(SAVE_TO_DIARY);
    clearInterval(watcher);
    for (const t of toastTexts) expect(t).not.toMatch(/שגיאה|נכשל/);

    const row = page.locator('#meal-list .meal-item-row');
    await expect(row).toHaveCount(1);
    await expect(row.locator('.plate-ph')).toBeVisible();
    await expect(row.locator('img[data-photo]')).toHaveCount(0);
    const list = await (await page.request.get('/api/food')).json();
    expect(list).toHaveLength(1);
    expect(list[0].has_photo).toBe(false);
    // the only console noise allowed is the browser's line for the stubbed 500
    expectNoGuardEvents(guards, [SIGNED_OUT_ME, /status of 500/]);
  });

  test('a 3 MB photo gives a thumbnail under 120 KB', async ({ page }) => {
    const big = bigPhoto();
    expect(big.length).toBeGreaterThan(2.5 * 1024 * 1024);
    await openAdd(page);
    await choosePhoto(page, photoFile(big));
    const put = page.waitForRequest((r) => r.method() === 'PUT' && PHOTO_URL.test(r.url()));
    await analyzeAndSave(page);
    expect((await (await put).response()).status()).toBe(200);
    await expectStoredThumbnail(page);   // the server accepted it: at most 120 KB, a JPEG, at most 640 px
    await expect(page.locator('#screen-home')).toBeVisible(SAVE_TO_DIARY);
    expectNoGuardEvents(guards, [SIGNED_OUT_ME]);
  });

  test('a text analysis sends no thumbnail, even after a photo was analysed first', async ({ page }) => {
    const puts = [];
    page.on('request', (r) => { if (r.method() === 'PUT' && PHOTO_URL.test(r.url())) puts.push(r.url()); });
    await openAdd(page);
    await choosePhoto(page);
    // the photo is really analysed first (this is what puts it in the app's state), then the user goes back and types
    await page.locator('#analyze-btn').click();
    await expect(page.locator('#analysis-result')).toBeVisible();
    await page.locator('#nav-camera').click();
    await expect(page.locator('#screen-camera')).toBeVisible();
    await expect(page.locator('#preview-img')).toBeVisible();   // the photo is still there
    await page.locator('#food-text-input').fill('סלט ולחם');
    await page.locator('#text-analyze-btn').click();
    await expect(page.locator('#analysis-result')).toBeVisible();
    await page.locator('#save-entry-btn').click();
    await expect(page.locator('#screen-home')).toBeVisible(SAVE_TO_DIARY);
    await expect(page.locator('#meal-list .meal-item-row .plate-ph')).toBeVisible();
    expect(puts).toEqual([]);
    expectNoGuardEvents(guards, [SIGNED_OUT_ME]);
  });

  test('a second click on "שמור ביומן" during the celebration does not save the meal twice', async ({ page }) => {
    await openAdd(page);
    await page.locator('#food-text-input').fill('סלט ולחם');
    await page.locator('#text-analyze-btn').click();
    await expect(page.locator('#analysis-result')).toBeVisible();
    await page.locator('#save-entry-btn').click();
    await expect(page.locator('#save-entry-btn')).toBeDisabled();
    await page.locator('#save-entry-btn').click({ force: true });
    await expect(page.locator('#screen-home')).toBeVisible(SAVE_TO_DIARY);
    await expect(page.locator('#meal-list .meal-item-row')).toHaveCount(1);
    expect(await (await page.request.get('/api/food')).json()).toHaveLength(1);
    // the next analysis can be saved again
    await page.locator('#nav-camera').click();
    await page.locator('#food-text-input').fill('לחם');
    await page.locator('#text-analyze-btn').click();
    await expect(page.locator('#analysis-result')).toBeVisible();
    await expect(page.locator('#save-entry-btn')).toBeEnabled();
    expectNoGuardEvents(guards, [SIGNED_OUT_ME]);
  });

  test('the diary does not open after the user left the analysis page during the celebration', async ({ page }) => {
    await openAdd(page);
    await page.locator('#food-text-input').fill('סלט ולחם');
    await page.locator('#text-analyze-btn').click();
    await expect(page.locator('#analysis-result')).toBeVisible();
    await page.locator('#save-entry-btn').click();
    await page.locator('#nav-stats').click();
    await expect(page.locator('#screen-stats')).toBeVisible();
    await page.waitForTimeout(4500);
    await expect(page.locator('#screen-stats')).toBeVisible();
    await expect(page.locator('#screen-home')).toBeHidden();
    expectNoGuardEvents(guards, [SIGNED_OUT_ME]);
  });

  test('signing out clears the photo and the text for the next person', async ({ page }) => {
    await openAdd(page);
    await choosePhoto(page);
    await page.locator('#food-text-input').fill('סלט ולחם');
    await page.evaluate(async () => { await (await import('/js/session.js')).doLogout(); });
    await expect(page.locator('#screen-auth')).toBeVisible();
    const state = await page.evaluate(async () => {
      const { state } = await import('/js/state.js');
      return { b64: state.capturedImageBase64, blob: state.photoBlob, src: document.getElementById('preview-img').getAttribute('src'), has: document.getElementById('screen-camera').classList.contains('has-photo'), text: document.getElementById('food-text-input').value };
    });
    expect(state).toEqual({ b64: null, blob: null, src: null, has: false, text: '' });
    expectNoGuardEvents(guards, [SIGNED_OUT_ME]);
  });

  test('a file that is not an image leaves the empty frame, silently', async ({ page }) => {
    await openAdd(page);
    const [c1] = await Promise.all([page.waitForEvent('filechooser'), page.locator('.cam-frame').click()]);
    await c1.setFiles({ name: 'x.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('this is not an image') });
    await expect(page.locator('.cam-frame')).toBeVisible();
    await expect(page.locator('#preview-img')).toBeHidden();
    await expect(page.locator('#analyze-btn')).toBeHidden();
    expectNoGuardEvents(guards, [SIGNED_OUT_ME]);
  });

  test('two picks racing: the latest one wins even when the older one finishes decoding last', async ({ page }) => {
    await openAdd(page);
    // Both change events are dispatched back to back inside the page, so the two reads and decodes really overlap: the
    // first file is a large photo (slow to read and decode), the second a tiny one (done long before it).
    const big = bigPhoto(4000, 3000, 90).toString('base64');
    const small = realJpeg(60, 40, 33).toString('base64');
    await page.evaluate(({ big, small }) => {
      const file = (b64, name) => {
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return new File([bytes], name, { type: 'image/jpeg' });
      };
      const input = document.getElementById('file-input');
      for (const f of [file(big, 'first-big.jpg'), file(small, 'second-small.jpg')]) {
        const dt = new DataTransfer();
        dt.items.add(f);
        input.files = dt.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }, { big, small });
    await expect(page.locator('#preview-img')).toBeVisible();
    // the big photo is scaled to 1024 px; the small one stays 60 x 40. Wait well past the time both decodes need.
    await page.waitForTimeout(3000);
    const dims = await page.locator('#preview-img').evaluate((i) => [i.naturalWidth, i.naturalHeight]);
    expect(dims).toEqual([60, 40]);
    await expect(page.locator('#analyze-btn')).toBeEnabled();
    expectNoGuardEvents(guards, [SIGNED_OUT_ME]);
  });

  test('with a photo, only "נתח את הצלחת" is a filled red button; the text button is an outline', async ({ page }) => {
    await openAdd(page);
    await choosePhoto(page);
    const bg = (sel) => page.locator(sel).evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(await bg('#analyze-btn')).toBe('rgb(179, 49, 29)');
    expect(await bg('#text-analyze-btn')).toBe('rgba(0, 0, 0, 0)');
  });

  test('photos.js: makeThumbnail bounds size and side, uploadThumbnail never throws', async ({ page }) => {
    await openAdd(page);
    // the module in the page, with real browser canvas and fetch
    const result = await page.evaluate(async (bigB64) => {
      const { makeThumbnail, photoSrc, blobFromBase64 } = await import('/js/photos.js');
      const toBlob = async (b64) => blobFromBase64(b64);
      const info = async (blob) => {
        if (!blob) return null;
        const img = new Image();
        img.src = URL.createObjectURL(blob);
        await img.decode();
        return { type: blob.type, size: blob.size, w: img.naturalWidth, h: img.naturalHeight };
      };
      const big = await makeThumbnail(await toBlob(bigB64));
      const small = await makeThumbnail(await toBlob(bigB64), { maxSide: 200, quality: 0.5 });
      const garbage = await makeThumbnail(new Blob(['not an image'], { type: 'image/jpeg' }));
      const tiny = await makeThumbnail(new Blob([new Uint8Array(0)], { type: 'image/jpeg' }));
      return { big: await info(big), small: await info(small), garbage, tiny, src: photoSrc(42), srcV: photoSrc(42, 7) };
    }, bigPhoto().toString('base64'));
    expect(result.big.type).toBe('image/jpeg');
    expect(Math.max(result.big.w, result.big.h)).toBe(480);
    expect(result.big.size).toBeLessThanOrEqual(110 * 1024);
    expect(Math.max(result.small.w, result.small.h)).toBe(200);
    expect(result.garbage).toBeNull();
    expect(result.tiny).toBeNull();
    expect(result.src).toBe('/api/food/42/photo');
    expect(result.srcV).toBe('/api/food/42/photo?v=7');

    // every failure shape resolves false: rejected, 4xx, 5xx, network error
    const outcomes = [];
    for (const mode of ['500', '400', '404', 'abort']) {
      await page.route('**/api/food/9/photo', (route) => mode === 'abort'
        ? route.abort('failed')
        : route.fulfill({ status: +mode, contentType: 'application/json', body: '{"error":{"code":"X"}}' }));
      outcomes.push(await page.evaluate(async () => {
        const { uploadThumbnail } = await import('/js/photos.js');
        return uploadThumbnail(9, new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' }));
      }));
      await page.unroute('**/api/food/9/photo');
    }
    expect(outcomes).toEqual([false, false, false, false]);
    // a 200 {ok:true} resolves true
    await page.route('**/api/food/9/photo', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }));
    expect(await page.evaluate(async () => (await import('/js/photos.js')).uploadThumbnail(9, new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' })))).toBe(true);
    // Allowed: the console lines of the stubbed error statuses, and Chrome's own CSP report when it is asked to decode
    // bytes that are not an image (the "garbage" blob above; the page only ever decodes a photo it has already drawn).
    expectNoGuardEvents(guards, [SIGNED_OUT_ME, /status of (500|400|404)/, /ERR_FAILED/, /Connecting to 'blob:/, /connect-src blocked blob/]);
  });

  test('320 px phone: the page does not scroll sideways, both states', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await openAdd(page);
    const overflow = () => page.evaluate(() => {
      const c = document.querySelector('#screen-camera .content');
      const b = document.querySelector('#screen-camera .page').getBoundingClientRect();
      const wide = [...c.querySelectorAll('*')].filter((e) => { const r = e.getBoundingClientRect(); return r.width && (r.right > b.right + 1 || r.left < b.left - 1); }).map((e) => e.className || e.tagName);
      return { scroll: c.scrollWidth - c.clientWidth, wide };
    });
    expect(await overflow()).toEqual({ scroll: 0, wide: [] });
    await choosePhoto(page);
    expect(await overflow()).toEqual({ scroll: 0, wide: [] });
    expectNoGuardEvents(guards, [SIGNED_OUT_ME]);
  });
});
