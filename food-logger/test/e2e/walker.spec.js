'use strict';

const { test, expect } = require('@playwright/test');
const { attachGuards, expectNoGuardEvents, SIGNED_OUT_ME } = require('./helpers');

// The capybara (Task 5): `decorateCapybara` (drawn style, loaf legs, optional salad bowl) and the
// walking lane (`mountWalkingCapybara`). The walking screens are redone in later tasks, so these tests
// mount a walker themselves on a `.page` element they create inside the phone frame, through a
// dynamic import of the same module the app uses.

const CYCLE_MS = 15_000;
const STEP_MS = 200;
const MARGIN_RIGHT = 46;     // the red margin line sits this far from the page's right edge
const REACH = 6;             // the body must come within this many px of each wall

async function openApp(page) {
  const guards = attachGuards(page);
  await page.goto('/');
  await expect(page.locator('#screen-welcome')).toBeVisible();
  return guards;
}

// Builds a `.page` (optionally a fixed width), mounts a walker and exposes the handle on window.
async function mountOnTestPage(page, { width = null, size = 104, state = 'neutral', bottom = 4 } = {}) {
  await page.evaluate(async ({ width, size, state, bottom }) => {
    const { mountWalkingCapybara } = await import('/js/pet.js');
    const p = document.createElement('div');
    p.className = 'page';
    p.id = 't-page';
    p.style.zIndex = '50';
    if (width) { p.style.right = 'auto'; p.style.width = `${width}px`; }
    const margin = document.createElement('div');
    margin.className = 'margin';
    p.appendChild(margin);
    document.getElementById('phone-frame').appendChild(p);
    window.__walker = mountWalkingCapybara(p, { state, size, bottom });
  }, { width, size, state, bottom });
}

// Freezes every animation at time `t` (the bob at 0, so only the travel and the flip are measured)
// and returns the visible body's horizontal extent relative to the page.
async function measureAt(page, t) {
  return page.evaluate((t) => {
    for (const a of document.getAnimations()) {
      a.pause();
      a.currentTime = a.animationName === 'capy-walk-bob' ? 0 : t;
    }
    const pageEl = document.getElementById('t-page');
    const svg = pageEl.querySelector('.walker svg');
    const pr = pageEl.getBoundingClientRect();
    const bb = svg.getBBox();
    const m = svg.getScreenCTM();
    const xs = [[bb.x, bb.y], [bb.x + bb.width, bb.y], [bb.x, bb.y + bb.height], [bb.x + bb.width, bb.y + bb.height]]
      .map(([x, y]) => m.a * x + m.c * y + m.e);
    return {
      left: Math.min(...xs) - pr.left,
      right: Math.max(...xs) - pr.left,
      pageWidth: pr.width,
    };
  }, t);
}

async function sweepCycle(page) {
  const samples = [];
  const times = [];
  for (let t = 0; t <= CYCLE_MS; t += STEP_MS) times.push(t);
  times.push(CYCLE_MS / 2);
  for (const t of times) samples.push({ t, ...(await measureAt(page, t)) });
  return samples;
}

function expectWithinWalls(samples, label) {
  const pageWidth = samples[0].pageWidth;
  const wall = pageWidth - MARGIN_RIGHT;
  const minLeft = Math.min(...samples.map((s) => s.left));
  const maxRight = Math.max(...samples.map((s) => s.right));
  expect(minLeft, `${label}: never left of the page edge`).toBeGreaterThanOrEqual(-0.5);
  expect(maxRight, `${label}: never right of the margin line`).toBeLessThanOrEqual(wall + 0.5);
  expect(minLeft, `${label}: reaches the left wall`).toBeLessThanOrEqual(REACH);
  expect(maxRight, `${label}: reaches the margin line`).toBeGreaterThanOrEqual(wall - REACH);
}

test('the walker stays between the page edge and the margin line, and reaches both', async ({ page }) => {
  const guards = await openApp(page);

  // A page of the reference's width (322 px), then the natural page of a 320 px phone.
  await mountOnTestPage(page, { width: 322 });
  expectWithinWalls(await sweepCycle(page), '322 px page');
  await page.evaluate(() => window.__walker.stop());
  await expect(page.locator('#t-page .walker')).toHaveCount(0);
  await page.evaluate(() => document.getElementById('t-page').remove());

  await page.setViewportSize({ width: 320, height: 640 });
  await mountOnTestPage(page);
  const narrow = await sweepCycle(page);
  expect(narrow[0].pageWidth).toBeLessThan(322);
  expectWithinWalls(narrow, '320 px viewport');

  // The lane is recomputed on resize: back to a wide phone, the walker still touches both walls.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(150);
  expectWithinWalls(await sweepCycle(page), 'after resize to 390 px');

  await page.evaluate(() => window.__walker.stop());
  await expect(page.locator('#t-page .walker')).toHaveCount(0);
  expect(await page.evaluate(() => document.getAnimations().filter((a) => a.animationName === 'walkx').length)).toBe(0);
  expectNoGuardEvents(guards, [SIGNED_OUT_ME]);
});

test('the walker flips with scaleX(-1) at the wall without a pause', async ({ page }) => {
  await openApp(page);
  await mountOnTestPage(page, { width: 322 });
  const scaleAt = (t) => page.evaluate((t) => {
    for (const a of document.getAnimations()) { a.pause(); a.currentTime = t; }
    const flip = document.querySelector('#t-page .walk-flip');
    return new DOMMatrixReadOnly(getComputedStyle(flip).transform).a;
  }, t);
  expect(await scaleAt(1000)).toBe(1);
  expect(await scaleAt(CYCLE_MS / 2 + 1)).toBe(-1);
  expect(await scaleAt(CYCLE_MS - 1)).toBe(-1);
  expect(await scaleAt(1)).toBe(1);
});

test('reduced motion: the walker has no running animation and stands at the left wall', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openApp(page);
  await mountOnTestPage(page, { width: 322 });
  const running = await page.evaluate(() =>
    document.querySelector('#t-page .walker').getAnimations({ subtree: true }).map((a) => a.animationName));
  expect(running).toEqual([]);
  const m = await measureAt(page, 7_000);
  expect(m.left).toBeGreaterThanOrEqual(-0.5);
  expect(m.left).toBeLessThanOrEqual(REACH);
  const scale = await page.evaluate(() =>
    new DOMMatrixReadOnly(getComputedStyle(document.querySelector('#t-page .walk-flip')).transform).a);
  expect(scale).toBe(1);
});

test('decorateCapybara: loaf legs, drawn style, corrected smile, bowl only on request, states still work', async ({ page }) => {
  const guards = await openApp(page);

  // The shared filters and gradients live once in index.html.
  for (const id of ['capyink', 'softsh', 'g-body', 'g-head']) {
    await expect(page.locator(`#${id}`)).toHaveCount(1);
  }

  const info = await page.evaluate(async () => {
    const { cloneCapybara, decorateCapybara, setPetState } = await import('/js/pet.js');
    const q = (svg, sel) => svg.querySelectorAll(sel).length;
    const plain = cloneCapybara(80);
    const withBowl = cloneCapybara(80, { bowl: true });
    document.body.append(plain, withBowl);
    const svg = plain.querySelector('svg');
    const bowlSvg = withBowl.querySelector('svg');
    const out = {
      oldLegs: ['28,90', '45,92', '65,92', '82,90'].map((c) => {
        const [x, y] = c.split(',');
        return q(svg, `ellipse[cx="${x}"][cy="${y}"]`);
      }),
      inked: svg.classList.contains('pet-inked'),
      grin: svg.querySelector('.pet-mouth-grin').getAttribute('d'),
      loafPaws: q(svg, 'ellipse[fill="#C4956A"][rx="10.5"][ry="6"]'),
      pawToes: q(svg, 'path[stroke="#7a5230"][stroke-width=".9"]'),
      bodyShade: q(svg, 'ellipse[fill="url(#g-body)"]'),
      headShade: q(svg, 'rect[fill="url(#g-head)"]'),
      cheeks: q(svg, 'ellipse[fill="#E8703A"][opacity=".16"]'),
      shadow: q(svg, 'ellipse[filter="url(#softsh)"]'),
      fur: q(svg, 'path[stroke="#7a5230"][stroke-width="1.1"]'),
      bowlPlain: q(svg, 'path[fill="#fffaf0"]'),
      bowlOn: q(bowlSvg, 'path[fill="#fffaf0"]'),
      viewBoxPlain: svg.getAttribute('viewBox'),
      viewBoxBowl: bowlSvg.getAttribute('viewBox'),
      sameFn: decorateCapybara.length >= 1,
      tplIntact: q(document.getElementById('capy-tpl').content, 'ellipse[cx="28"][cy="90"]'),
    };
    // States still toggle: sleeping shows the zzz, happy shows the grin.
    setPetState(plain, 'sleeping');
    out.zzzSleeping = getComputedStyle(plain.querySelector('.pet-zzz')).display;
    out.grinSleeping = getComputedStyle(plain.querySelector('.pet-mouth-grin')).display;
    setPetState(plain, 'happy');
    out.zzzHappy = getComputedStyle(plain.querySelector('.pet-zzz')).display;
    out.grinHappy = getComputedStyle(plain.querySelector('.pet-mouth-grin')).display;
    // The outline CSS reaches the tan shapes of the clone.
    const body = svg.querySelector('ellipse[fill="#C4956A"]');
    const cs = getComputedStyle(body);
    out.stroke = cs.stroke;
    out.strokeWidth = cs.strokeWidth;
    out.strokeOpacity = cs.strokeOpacity;
    // The nostrils and eyes are not outlined.
    out.nostrilStroke = getComputedStyle(svg.querySelector('ellipse[fill="#8B5E35"]')).stroke;
    plain.remove(); withBowl.remove();
    return out;
  });

  expect(info.oldLegs, 'the four old leg ellipses are gone').toEqual([0, 0, 0, 0]);
  expect(info.tplIntact, 'the template is not modified').toBe(1);
  expect(info.inked).toBe(true);
  expect(info.grin).toBe('M 41 59.5 Q 55 66 69 59.5');
  expect(info.loafPaws, 'two loaf paws').toBe(2);
  expect(info.pawToes, 'toes on both paws').toBe(2);
  expect(info.bodyShade).toBe(1);
  expect(info.headShade).toBe(1);
  expect(info.cheeks).toBe(2);
  expect(info.shadow).toBe(1);
  expect(info.fur).toBe(1);
  expect(info.bowlPlain, 'no bowl by default').toBe(0);
  expect(info.bowlOn, 'the bowl on request').toBe(1);
  expect(info.viewBoxPlain).toBe('0 0 110 100');
  expect(info.viewBoxBowl).toBe('0 -4 110 120');
  expect(info.zzzSleeping).not.toBe('none');
  expect(info.grinSleeping).toBe('none');
  expect(info.zzzHappy).toBe('none');
  expect(info.grinHappy).not.toBe('none');
  expect(info.stroke).toBe('rgb(107, 68, 38)');
  expect(parseFloat(info.strokeWidth)).toBeCloseTo(1.15, 2);
  expect(parseFloat(info.strokeOpacity)).toBeCloseTo(0.7, 2);
  expect(info.nostrilStroke).toBe('none');
  expectNoGuardEvents(guards, [SIGNED_OUT_ME]);
});

test('a walker mounted on a hidden page is measured when the page becomes visible', async ({ page }) => {
  const guards = await openApp(page);
  await page.evaluate(async () => {
    const { mountWalkingCapybara } = await import('/js/pet.js');
    const host = document.createElement('div');          // like a display:none .screen around a .page
    host.id = 't-host';
    host.style.cssText = 'position:absolute;inset:0;z-index:50;display:none';
    const p = document.createElement('div');
    p.className = 'page';
    p.id = 't-page';
    const margin = document.createElement('div');
    margin.className = 'margin';
    p.appendChild(margin);
    host.appendChild(p);
    document.getElementById('phone-frame').appendChild(host);
    window.__walker = mountWalkingCapybara(p, { state: 'neutral', size: 104, bottom: 4 });
  });
  // Shown later: the ResizeObserver re-runs the measurement.
  await page.evaluate(() => { document.getElementById('t-host').style.display = 'block'; });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  expectWithinWalls(await sweepCycle(page), 'hidden, then shown');

  // Hidden again and resized while hidden, shown again: still right.
  await page.evaluate(() => { document.getElementById('t-host').style.display = 'none'; });
  await page.setViewportSize({ width: 320, height: 640 });
  await page.evaluate(() => { document.getElementById('t-host').style.display = 'block'; });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  expectWithinWalls(await sweepCycle(page), 'hidden, resized, shown');

  await page.evaluate(() => window.__walker.stop());
  await expect(page.locator('#t-page .walker')).toHaveCount(0);
  expectNoGuardEvents(guards, [SIGNED_OUT_ME]);
});

test('mounting the same page twice returns the one walker; stop() leaves nothing behind', async ({ page }) => {
  await openApp(page);
  await mountOnTestPage(page, { width: 322 });
  const result = await page.evaluate(async () => {
    const { mountWalkingCapybara } = await import('/js/pet.js');
    const p = document.getElementById('t-page');
    const again = mountWalkingCapybara(p, { state: 'happy', size: 80, bottom: 2 });
    return { same: again === window.__walker, lanes: p.querySelectorAll('.walker').length };
  });
  expect(result).toEqual({ same: true, lanes: 1 });
  await page.evaluate(() => window.__walker.stop());
  await expect(page.locator('#t-page .walker')).toHaveCount(0);
  await page.evaluate(() => window.__walker.stop());     // stop twice is harmless
  // After stop the page can host a fresh walker (no stale registration).
  const lanes = await page.evaluate(async () => {
    const { mountWalkingCapybara } = await import('/js/pet.js');
    const p = document.getElementById('t-page');
    const w = mountWalkingCapybara(p, { state: 'neutral', size: 104, bottom: 4 });
    const n = p.querySelectorAll('.walker').length;
    w.stop();
    return [n, p.querySelectorAll('.walker').length];
  });
  expect(lanes).toEqual([1, 0]);
});
