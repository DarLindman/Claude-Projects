'use strict';

// Task 12: the stats screen as a diary page. Index tabs at the bottom edge of the page (the active one raised), the
// headline average in handwriting, the hand-drawn bar chart (ink-outlined bars, red over the goal, the dashed goal line
// with its label ABOVE the plot and an arrow, never over a bar), the day letters, three macro bars, the monthly and
// yearly views in the same style, and the capybara walking above the tabs (mounted on enter, stopped on leave).
// Meals are seeded through the API the way the real client sends them (wall-clock `logged_at` from the local date).

const { test, expect } = require('@playwright/test');
const { attachGuards, expectNoGuardEvents, SIGNED_OUT_ME, localNow } = require('./helpers');

const PASSWORD = 'stats-pass-1234';
const CSRF = { Origin: 'http://localhost:3100', 'X-FL-Client': '1' };

const post = (page, url, data) => page.request.post(url, { headers: CSRF, data });
const put = (page, url, data) => page.request.put(url, { headers: CSRF, data });

const uniqueName = () => `st${Date.now()}${Math.floor(Math.random() * 1000)}`;

// A calendar day `back` days before the local today, built with local getters only (like the app).
function dayBack(back) {
  const [y, m, day] = localNow().date.split('-').map(Number);
  const d = new Date(y, m - 1, day - back);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

async function register(page, username, { profile = true } = {}) {
  const reg = await post(page, '/auth/register', { username, password: PASSWORD });
  expect(reg.status(), await reg.text()).toBe(200);
  if (profile) {
    const prof = await put(page, '/api/profile', { gender: 'male', birthDate: '1990-05-15', height: 175, weight: 70, activity: 'light', goalKg: 0 });
    expect(prof.status()).toBe(200);
  }
}

async function meal(page, { calories, day, name = 'ארוחה', protein = 30, carbs = 120, fat = 25, time = '12:30' }) {
  const res = await post(page, '/api/food', {
    meal_type: 'lunch', food_name: name, calories, protein_g: protein, carbs_g: carbs, fat_g: fat, fiber_g: 4,
    logged_at: `${day}T${time}:00`,
  });
  expect(res.status(), await res.text()).toBe(200);
}

async function openStats(page, tab) {
  await page.goto('/');
  await expect(page.locator('#screen-dashboard')).toBeVisible();
  await page.locator('#nav-stats').click();
  await expect(page.locator('#screen-stats')).toBeVisible();
  if (tab) await showTab(page, tab);
  else await expect(page.locator('#weekly-chart svg')).toBeVisible();
}

const TABS = { weekly: ['שבועי', '#weekly-chart'], monthly: ['חודשי', '#monthly-chart'], yearly: ['שנתי', '#yearly-chart'] };

async function showTab(page, tab) {
  const [text, chart] = TABS[tab];
  await page.locator('.stats-tab', { hasText: text }).click();
  await expect(page.locator(`#stats-${tab}`)).toBeVisible();
  await expect(page.locator(`${chart} svg`)).toBeVisible();
  // the chart is drawn after the fetch: wait until it holds the baseline
  await expect(page.locator(`${chart} svg .base-line`)).toHaveCount(1);
}

// Geometry of the chart in `sel` (client pixels): the goal label, the arrow strokes, every bar, the day labels.
function chartGeometry(page, sel) {
  return page.evaluate((sel) => {
    const box = (el) => { const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; };
    const svg = document.querySelector(`${sel} svg`);
    const goal = svg.querySelector('.goal-label');
    const line = svg.querySelector('.goal-line');
    return {
      svg: box(svg),
      goalLabel: goal ? { ...box(goal), text: goal.textContent } : null,
      goalLineY: line ? line.getBoundingClientRect().top : null,
      arrows: [...svg.querySelectorAll('.goal-arrow')].map(box),
      bars: [...svg.querySelectorAll('.bar')].map((b) => ({ ...box(b), over: b.classList.contains('over'), fill: getComputedStyle(b).fill })),
      ticks: svg.querySelectorAll('.tick').length,
      days: [...svg.querySelectorAll('.chart-day')].map((t) => ({ ...box(t), text: t.textContent, today: t.classList.contains('today') })),
      markup: svg.outerHTML,
    };
  }, sel);
}

const intersects = (a, b) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
const noBrokenText = async (page) => {
  const text = await page.locator('#screen-stats').innerText();
  expect(text).not.toMatch(/NaN|undefined|null|Infinity|\[object/);
};

// Weekly data: a very large day, a small one, mid days; at least one day over the goal and one under it.
async function seedWeek(page, { allOver = false } = {}) {
  const plan = allOver
    ? [[0, 9000], [1, 9500], [2, 8800], [3, 9100], [4, 9900], [5, 8700], [6, 9300]]
    : [[0, 4600], [1, 1200], [2, 2000], [3, 900], [4, 3000]];
  for (const [back, calories] of plan) await meal(page, { calories, day: dayBack(back) });
  return plan.length;
}

test('weekly: the goal label and its arrow stay above every bar; days over the goal are red; the tabs sit below the chart', async ({ page }) => {
  const guards = attachGuards(page);
  await register(page, uniqueName());
  const seeded = await seedWeek(page);
  await openStats(page);
  await expect(page.locator('#weekly-chart .bar')).toHaveCount(seeded);

  const g = await chartGeometry(page, '#weekly-chart');
  // non-vacuous: the goal label exists with a number, there are bars on both sides of the goal line
  expect(g.goalLabel, 'goal label').not.toBeNull();
  expect(g.goalLabel.text).toMatch(/^יעד \d{1,3}(,\d{3})*$/);
  expect(g.bars.length).toBe(seeded);
  expect(g.bars.some((b) => b.over), 'a bar over the goal').toBe(true);
  expect(g.bars.some((b) => !b.over), 'a bar under the goal').toBe(true);
  expect(g.goalLineY).not.toBeNull();

  // the label's box touches no bar; neither do the arrow strokes
  for (const bar of g.bars) {
    expect(intersects(g.goalLabel, bar), 'goal label vs a bar').toBe(false);
    for (const arrow of g.arrows) expect(intersects(arrow, bar), 'arrow vs a bar').toBe(false);
  }
  expect(g.arrows.length).toBe(2);
  // the label is above the plot: its bottom is above the top of the tallest bar, and above the goal line
  const tallest = Math.min(...g.bars.map((b) => b.t));
  expect(g.goalLabel.b).toBeLessThan(tallest);
  expect(g.goalLabel.b).toBeLessThan(g.goalLineY);
  // an arrow sits between the label and the goal line
  expect(Math.max(...g.arrows.map((a) => a.b))).toBeLessThanOrEqual(g.goalLineY + 1);

  // red exactly for the bars that rise above the goal line; the others are the mustard of the reference
  for (const bar of g.bars) {
    expect(bar.over).toBe(bar.t < g.goalLineY - 0.5);
    expect(bar.fill).toBe(bar.over ? 'rgb(201, 83, 47)' : 'rgb(217, 168, 80)');
  }
  // the days without data are pencil dashes, 7 columns in all
  expect(g.ticks + g.bars.length).toBe(7);
  // seven day letters, today's red and at the left end (time runs right to left)
  expect(g.days).toHaveLength(7);
  for (const d of g.days) expect(d.text).toMatch(/^[א-ת]׳$/);
  const todayLabels = g.days.filter((d) => d.today);
  expect(todayLabels).toHaveLength(1);
  expect(todayLabels[0].l).toBe(Math.min(...g.days.map((d) => d.l)));
  const letter = await page.evaluate(() => ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'][new Date().getDay()] + '׳');
  expect(todayLabels[0].text).toBe(letter);
  // inside the svg
  for (const bar of g.bars) { expect(bar.l).toBeGreaterThanOrEqual(g.svg.l - 1); expect(bar.r).toBeLessThanOrEqual(g.svg.r + 1); }

  // the tabs are below the chart (and below the macro bars' start), in the page's bottom edge
  const tabs = await page.locator('.stats-tab').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().top));
  expect(tabs).toHaveLength(3);
  for (const top of tabs) expect(top).toBeGreaterThan(g.svg.b);
  const page_ = await page.locator('#screen-stats .page').boundingBox();
  const lastTab = await page.locator('.stats-tab').first().boundingBox();
  expect(Math.abs((lastTab.y + lastTab.height) - (page_.y + page_.height))).toBeLessThan(2);

  await noBrokenText(page);
  expect(g.markup).not.toMatch(/NaN|Infinity|undefined/);
  expectNoGuardEvents(guards, [SIGNED_OUT_ME]);
});

test('weekly: the headline average is in the digit font, three macro bars, the average of the seeded days', async ({ page }) => {
  const guards = attachGuards(page);
  await register(page, uniqueName());
  await meal(page, { calories: 1000, day: dayBack(0), protein: 40, carbs: 100, fat: 20 });
  await meal(page, { calories: 2000, day: dayBack(1), protein: 60, carbs: 200, fat: 40 });
  await openStats(page);

  await expect(page.locator('#weekly-avg-box .avg-val')).toHaveText('1,500');
  await expect(page.locator('#weekly-avg-box .avg-label')).toHaveText('קק״ל ליום, בממוצע');
  const fonts = await page.evaluate(() => {
    const first = (sel) => getComputedStyle(document.querySelector(sel)).fontFamily.split(',')[0].trim().replace(/^["']|["']$/g, '');
    return { avg: first('#weekly-avg-box .avg-val'), goal: first('#weekly-chart .goal-label'), day: first('#weekly-chart .chart-day'), macro: first('#weekly-macro .ink b') };
  });
  expect(fonts).toEqual({ avg: 'Digits', goal: 'Digits', day: 'Digits', macro: 'Digits' });

  // protein, carbs, fat (average of the two days: 50, 150, 30), widths follow the values
  await expect(page.locator('#weekly-macro .ink')).toHaveCount(3);
  await expect(page.locator('#weekly-macro .ink span')).toHaveText(['חלבון', 'פחמימות', 'שומן']);
  await expect(page.locator('#weekly-macro .ink b')).toHaveText(['50 גרם', '150 גרם', '30 גרם']);
  const widths = await page.locator('#weekly-macro .ink').evaluateAll((rows) => rows.map((r) => r.querySelector('.fill').getBoundingClientRect().width / r.querySelector('.track').getBoundingClientRect().width));
  expect(widths[0]).toBeCloseTo(1, 1);          // 50 of 50
  expect(widths[1]).toBeCloseTo(0.6, 1);        // 150 of 250
  expect(widths[2]).toBeCloseTo(30 / 65, 1);
  await expect(page.locator('#weekly-macro .stat-note')).toHaveText('ממוצע יומי על בסיס 2 ימים');
  // the distance from the recommended calories is under the headline, signed, and the number keeps its sign on the left
  await expect(page.locator('#weekly-avg-box .stat-diff')).toHaveText(/^‎?[+-]?\d{1,3}(,\d{3})* קק״ל מהמומלץ$/);
  expectNoGuardEvents(guards, [SIGNED_OUT_ME]);
});

test('a huge day and a day-all-over-the-goal week: no bar leaves the plot, the label and arrow still clear every bar', async ({ page }) => {
  const guards = attachGuards(page);
  await register(page, uniqueName());
  await meal(page, { calories: 99999, day: dayBack(0) });     // the largest value the server accepts
  await meal(page, { calories: 300, day: dayBack(1) });
  await openStats(page);
  let g = await chartGeometry(page, '#weekly-chart');
  expect(g.bars).toHaveLength(2);
  // in svg units, from the attributes (client boxes would move with the screen's enter animation between two reads)
  const inPlot = await page.evaluate(() => {
    const svg = document.querySelector('#weekly-chart svg');
    const f = svg.querySelector('.chart-frame');
    const top = +f.getAttribute('y') + 2;                 // the frame starts 2 units above the plot
    const bottom = +f.getAttribute('y') + +f.getAttribute('height');
    return [...svg.querySelectorAll('.bar')].map((b) => ({ top: +b.getAttribute('y') - top, bottom: bottom - (+b.getAttribute('y') + +b.getAttribute('height')) }));
  });
  expect(inPlot).toHaveLength(2);
  for (const b of inPlot) { expect(b.top).toBeGreaterThanOrEqual(-0.1); expect(b.bottom).toBeGreaterThanOrEqual(-0.1); }
  expect(Math.min(...inPlot.map((b) => b.top))).toBeLessThan(0.6);   // the huge day reaches the top of the plot and stops there
  expect(g.goalLabel).not.toBeNull();
  for (const bar of g.bars) expect(intersects(g.goalLabel, bar)).toBe(false);
  // the tiny day is still visible (at least a few pixels tall)
  const small = g.bars.reduce((a, b) => ((a.b - a.t) < (b.b - b.t) ? a : b));
  expect(small.b - small.t).toBeGreaterThan(2);
  await expect(page.locator('#weekly-avg-box .avg-val')).toHaveText('50,150');
  await noBrokenText(page);

  // every day over the goal: all bars red, the arrow stops above the lowest bar, nothing crosses
  const other = uniqueName();
  await page.context().clearCookies();
  await register(page, other);
  await seedWeek(page, { allOver: true });
  await openStats(page);
  await expect(page.locator('#weekly-chart .bar')).toHaveCount(7);
  g = await chartGeometry(page, '#weekly-chart');
  expect(g.bars.every((b) => b.over)).toBe(true);
  for (const bar of g.bars) {
    expect(intersects(g.goalLabel, bar)).toBe(false);
    for (const arrow of g.arrows) expect(intersects(arrow, bar)).toBe(false);
  }
  expectNoGuardEvents(guards, [SIGNED_OUT_ME]);
});

test('all three views open, share the tab strip (the active tab raised) and keep their hook ids', async ({ page }) => {
  const guards = attachGuards(page);
  await register(page, uniqueName());
  await meal(page, { calories: 1800, day: dayBack(0) });
  await openStats(page);

  const tabHeights = () => page.locator('.stats-tab').evaluateAll((els) => els.map((e) => ({ h: e.getBoundingClientRect().height, active: e.classList.contains('active'), text: e.textContent })));
  let tabs = await tabHeights();
  expect(tabs.map((t) => t.text)).toEqual(['שבועי', 'חודשי', 'שנתי']);
  expect(tabs.filter((t) => t.active)).toHaveLength(1);
  expect(tabs[0].active).toBe(true);
  expect(tabs[0].h).toBeGreaterThan(tabs[1].h);   // raised

  await showTab(page, 'monthly');
  await expect(page.locator('#stats-weekly')).toBeHidden();
  await expect(page.locator('#stats-month-label')).not.toBeEmpty();
  await expect(page.locator('#monthly-avg-box .avg-val')).toHaveText('1,800');
  await expect(page.locator('#monthly-chart .bar')).toHaveCount(1);
  tabs = await tabHeights();
  expect(tabs.filter((t) => t.active).map((t) => t.text)).toEqual(['חודשי']);
  expect(tabs[1].h).toBeGreaterThan(tabs[0].h);
  let g = await chartGeometry(page, '#monthly-chart');
  const monthTabTop = await page.locator('.stats-tab').first().evaluate((e) => e.getBoundingClientRect().top);
  expect(monthTabTop).toBeGreaterThan(g.svg.b);
  // 1, 5, 10, ... day labels that never overlap
  expect(g.days.length).toBeGreaterThanOrEqual(6);
  expect(g.days[0].text).toBe('1');
  for (let i = 0; i < g.days.length; i++) for (let j = i + 1; j < g.days.length; j++) expect(intersects(g.days[i], g.days[j]), `labels ${g.days[i].text}/${g.days[j].text}`).toBe(false);
  expect(g.goalLabel).not.toBeNull();
  for (const bar of g.bars) expect(intersects(g.goalLabel, bar)).toBe(false);
  // the month picker still works
  const label = await page.locator('#stats-month-label').textContent();
  await page.locator('#stats-monthly .date-nav button').first().click();
  await expect(page.locator('#stats-month-label')).not.toHaveText(label);
  await expect(page.locator('#monthly-chart .bar')).toHaveCount(0);
  await expect(page.locator('#monthly-avg-box .stat-empty')).toHaveText('אין נתונים');
  await noBrokenText(page);

  await showTab(page, 'yearly');
  await expect(page.locator('#stats-year-label')).toHaveText(String(await page.evaluate(() => new Date().getFullYear())));
  await expect(page.locator('#yearly-avg-box .avg-val')).toHaveText('1,800');
  await expect(page.locator('#yearly-chart .bar')).toHaveCount(1);
  g = await chartGeometry(page, '#yearly-chart');
  expect(g.days).toHaveLength(12);
  for (let i = 0; i < g.days.length; i++) for (let j = i + 1; j < g.days.length; j++) expect(intersects(g.days[i], g.days[j]), `month labels ${i}/${j}`).toBe(false);
  expect(g.days.filter((d) => d.today)).toHaveLength(1);
  expect(g.goalLabel).not.toBeNull();
  for (const bar of g.bars) expect(intersects(g.goalLabel, bar)).toBe(false);
  await expect(page.locator('#yearly-macro .ink')).toHaveCount(3);
  const yearTabTop = await page.locator('.stats-tab').first().evaluate((e) => e.getBoundingClientRect().top);
  expect(yearTabTop).toBeGreaterThan(g.svg.b);
  await page.locator('#stats-yearly .date-nav button').first().click();
  await expect(page.locator('#yearly-chart .bar')).toHaveCount(0);
  await noBrokenText(page);

  await showTab(page, 'weekly');
  await expect(page.locator('#weekly-chart .bar')).toHaveCount(1);
  expectNoGuardEvents(guards, [SIGNED_OUT_ME]);
});

test('the walking capybara is mounted on entering the screen, never stacked, and gone (animations too) after leaving', async ({ page }) => {
  const guards = attachGuards(page);
  await register(page, uniqueName());
  await openStats(page);

  const walkerState = () => page.evaluate(() => ({
    lanes: document.querySelectorAll('.walker').length,
    inStats: document.querySelectorAll('#screen-stats .page > .walker').length,
    walkAnims: document.getAnimations().filter((a) => a.animationName === 'walkx' || a.animationName === 'flipx').length,
    svgVisible: !!document.querySelector('#screen-stats .walker svg') && document.querySelector('#screen-stats .walker svg').getBoundingClientRect().width > 0,
  }));
  let w = await walkerState();
  expect(w.inStats).toBe(1);
  expect(w.lanes).toBe(1);
  expect(w.walkAnims).toBe(2);       // the lane's travel and its flip are running
  expect(w.svgVisible).toBe(true);

  // she walks above the tabs: her feet are above the tabs' top edge
  const placement = await page.evaluate(() => {
    const lane = document.querySelector('#screen-stats .walker').getBoundingClientRect();
    const tabTop = Math.min(...[...document.querySelectorAll('.stats-tab')].map((t) => t.getBoundingClientRect().top));
    const content = document.querySelector('#screen-stats .content').getBoundingClientRect();
    return { laneBottom: lane.bottom, laneTop: lane.top, tabTop, contentBottom: content.bottom };
  });
  expect(placement.laneBottom).toBeLessThanOrEqual(placement.tabTop);
  expect(placement.laneTop).toBeGreaterThanOrEqual(placement.contentBottom - 1);    // she never walks over the scrolling text

  // entering again (switching tabs reloads, navigating to the screen again) never stacks a second lane
  await showTab(page, 'monthly');
  await page.locator('#nav-stats').click();
  await page.locator('#nav-stats').click();
  expect((await walkerState()).lanes).toBe(1);

  // leaving removes it, and no walking animation keeps running
  for (const nav of ['#nav-dashboard', '#nav-home', '#nav-weight', '#nav-settings']) {
    await page.locator('#nav-stats').click();
    expect((await walkerState()).lanes, 'on stats').toBe(1);
    await page.locator(nav).click();
    await expect(page.locator('#screen-stats')).toBeHidden();
    w = await walkerState();
    expect(w.inStats, `after ${nav}`).toBe(0);
    // the animations belong to the lanes that remain (the weight and settings screens have their own walker): none of them is the stats lane's
    expect(w.walkAnims, `animations after ${nav}`).toBe(2 * w.lanes);
    expect(w.lanes, `lanes after ${nav}`).toBe(nav === '#nav-weight' || nav === '#nav-settings' ? 1 : 0);
  }
  // and back again
  await page.locator('#nav-stats').click();
  expect((await walkerState()).lanes).toBe(1);

  // reduced motion: she stands still
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect((await walkerState()).walkAnims).toBe(0);
  expectNoGuardEvents(guards, [SIGNED_OUT_ME]);
});

test('empty data: every view renders (no NaN), the goal label stays, nothing is drawn as a bar', async ({ page }) => {
  const guards = attachGuards(page);
  await register(page, uniqueName());
  await openStats(page);

  // weekly: seven dashes, no bars, no macros, the empty line instead of the headline
  await expect(page.locator('#weekly-avg-box .stat-empty')).toHaveText('אין נתונים');
  await expect(page.locator('#weekly-avg-box .avg-val')).toHaveCount(0);
  await expect(page.locator('#weekly-macro .ink')).toHaveCount(0);
  let g = await chartGeometry(page, '#weekly-chart');
  expect(g.bars).toHaveLength(0);
  expect(g.ticks).toBe(7);
  expect(g.days).toHaveLength(7);
  expect(g.goalLabel).not.toBeNull();
  expect(g.markup).not.toMatch(/NaN|Infinity|undefined/);
  await noBrokenText(page);

  const todayDay = Number(localNow().date.slice(8, 10));
  const todayMonth = Number(localNow().date.slice(5, 7));
  await showTab(page, 'monthly');
  g = await chartGeometry(page, '#monthly-chart');
  expect(g.bars).toHaveLength(0);
  expect(g.ticks).toBe(todayDay);               // a dash for every day up to today, none for the future
  expect(g.markup).not.toMatch(/NaN|Infinity|undefined/);
  await noBrokenText(page);

  await showTab(page, 'yearly');
  g = await chartGeometry(page, '#yearly-chart');
  expect(g.bars).toHaveLength(0);
  expect(g.ticks).toBe(todayMonth);
  expect(g.days).toHaveLength(12);
  expect(g.markup).not.toMatch(/NaN|Infinity|undefined/);
  await noBrokenText(page);
  expectNoGuardEvents(guards, [SIGNED_OUT_ME]);
});

test('a single day and no profile: one bar, no goal, no red, the headline is that day', async ({ page }) => {
  const guards = attachGuards(page);
  await register(page, uniqueName(), { profile: false });
  await meal(page, { calories: 2750, day: dayBack(0) });
  await openStats(page);

  await expect(page.locator('#weekly-avg-box .avg-val')).toHaveText('2,750');
  await expect(page.locator('#weekly-avg-box .stat-diff')).toHaveCount(0);     // no goal, no distance from it
  await expect(page.locator('#weekly-macro .stat-note')).toHaveText('ממוצע יומי על בסיס יום אחד');
  let g = await chartGeometry(page, '#weekly-chart');
  expect(g.bars).toHaveLength(1);
  expect(g.bars[0].over).toBe(false);
  expect(g.goalLabel).toBeNull();
  expect(g.goalLineY).toBeNull();
  expect(g.arrows).toHaveLength(0);
  expect(g.bars[0].b - g.bars[0].t).toBeGreaterThan(40);   // the only bar fills the plot
  expect(g.markup).not.toMatch(/NaN|Infinity|undefined/);
  await noBrokenText(page);

  await showTab(page, 'monthly');
  g = await chartGeometry(page, '#monthly-chart');
  expect(g.bars).toHaveLength(1);
  expect(g.goalLabel).toBeNull();
  await showTab(page, 'yearly');
  g = await chartGeometry(page, '#yearly-chart');
  expect(g.bars).toHaveLength(1);
  expect(g.goalLabel).toBeNull();
  await noBrokenText(page);
  expectNoGuardEvents(guards, [SIGNED_OUT_ME]);
});

test('at 320 px nothing overflows: the page, the chart, the headline and the tabs stay inside, in every view', async ({ page }) => {
  const guards = attachGuards(page);
  await page.setViewportSize({ width: 320, height: 640 });
  await register(page, uniqueName());
  await seedWeek(page);
  await meal(page, { calories: 99999, day: dayBack(0) });
  await openStats(page);

  for (const tab of ['weekly', 'monthly', 'yearly']) {
    await showTab(page, tab);
    const m = await page.evaluate((tab) => {
      const doc = document.documentElement;
      const pageEl = document.querySelector('#screen-stats .page');
      const content = pageEl.querySelector('.content');
      const margin = pageEl.querySelector('.margin').getBoundingClientRect();
      const pr = pageEl.getBoundingClientRect();
      const inside = (el) => { const r = el.getBoundingClientRect(); return r.left >= pr.left - 1 && r.right <= margin.left + 2 && r.width > 0; };
      const view = document.getElementById(`stats-${tab}`);
      const tabs = [...document.querySelectorAll('.stats-tab')].map((t) => t.getBoundingClientRect());
      const head = view.querySelector('.stat-head');
      return {
        docOverflow: doc.scrollWidth - doc.clientWidth,
        contentOverflow: content.scrollWidth - content.clientWidth,
        chartInside: inside(view.querySelector('.chart-wrap svg')),
        macrosInside: [...view.querySelectorAll('.ink')].every(inside),
        headInside: head ? [...head.children].every((c) => { const r = c.getBoundingClientRect(); return r.right <= margin.left + 2 && r.left >= pr.left - 1; }) : false,
        tabsInside: tabs.every((r) => r.left >= pr.left - 1 && r.right <= pr.right + 1 && r.bottom <= pr.bottom + 1),
        macroRows: view.querySelectorAll('.ink').length,
      };
    }, tab);
    expect(m.docOverflow, `${tab} document overflow`).toBeLessThanOrEqual(0);
    expect(m.contentOverflow, `${tab} content overflow`).toBeLessThanOrEqual(0);
    expect(m.chartInside, `${tab} chart`).toBe(true);
    expect(m.macroRows).toBe(3);
    expect(m.macrosInside, `${tab} macro rows`).toBe(true);
    expect(m.headInside, `${tab} headline`).toBe(true);
    expect(m.tabsInside, `${tab} tabs`).toBe(true);
    const g = await chartGeometry(page, `#${tab}-chart`);
    expect(g.goalLabel).not.toBeNull();
    expect(g.bars.length).toBeGreaterThan(0);
    for (const bar of g.bars) expect(intersects(g.goalLabel, bar)).toBe(false);
    for (let i = 0; i < g.days.length; i++) for (let j = i + 1; j < g.days.length; j++) expect(intersects(g.days[i], g.days[j]), `${tab} labels ${i}/${j}`).toBe(false);
    // the last lines scroll clear of the tabs: scroll to the end, the last element is above the walker and the tabs
    await page.locator('#screen-stats .content').evaluate((c) => { c.scrollTop = c.scrollHeight; });
    const gap = await page.evaluate((tab) => {
      const view = document.getElementById(`stats-${tab}`);
      const last = [...view.querySelectorAll('.stat-note, .ink')].pop();
      const tabTop = Math.min(...[...document.querySelectorAll('.stats-tab')].map((t) => t.getBoundingClientRect().top));
      return tabTop - last.getBoundingClientRect().bottom;
    }, tab);
    expect(gap, `${tab} last line vs tabs`).toBeGreaterThanOrEqual(0);
  }
  await expect(page.locator('#screen-stats .walker')).toHaveCount(1);
  expectNoGuardEvents(guards, [SIGNED_OUT_ME]);
});

// ── The chart renderer on its own (no data, no server): arrow paths and the goal boundary ────────────────────
// The goal arrow is a curve, so a bounding box is too coarse: it is sampled point by point along its length
// (getPointAtLength) against every bar rect, in svg units.
async function renderChart(page, { vals, futureFrom = vals.length, recommended = 2000, labelSize = 16 }) {
  await page.goto('/');
  return page.evaluate(async ({ vals, futureFrom, recommended, labelSize }) => {
    const { renderBarChart } = await import('/js/charts.js');
    const { setHtml } = await import('/js/dom.js');
    document.getElementById('t-chart')?.remove();
    const host = document.createElement('div');
    host.id = 't-chart';
    host.style.cssText = 'position:fixed;left:0;top:0;width:300px;z-index:99';
    document.body.appendChild(host);
    const rows = vals.map((v, i) => ({ v, i }));
    setHtml(host, renderBarChart(rows, { getValue: (r) => r.v, getLabel: (r) => String(r.i), isFuture: (r) => r.i >= futureFrom, recommended, labelSize }));
    const svg = host.querySelector('svg');
    const bars = [...svg.querySelectorAll('.bar')].map((b) => ({
      x: +b.getAttribute('x'), y: +b.getAttribute('y'), w: +b.getAttribute('width'), h: +b.getAttribute('height'),
      over: b.classList.contains('over'), fill: getComputedStyle(b).fill,
    }));
    let samples = 0;
    const hits = [];
    for (const path of svg.querySelectorAll('.goal-arrow')) {
      const len = path.getTotalLength();
      for (let d = 0; d <= len; d += 0.25) {
        const p = path.getPointAtLength(d);
        samples += 1;
        for (const [bi, b] of bars.entries()) {
          if (p.x > b.x - 0.5 && p.x < b.x + b.w + 0.5 && p.y > b.y - 0.5 && p.y < b.y + b.h + 0.5) hits.push({ bar: bi, x: Math.round(p.x), y: Math.round(p.y) });
        }
      }
    }
    return { bars, samples, hits, arrows: svg.querySelectorAll('.goal-arrow').length };
  }, { vals, futureFrom, recommended, labelSize });
}

const fill = (n, v) => Array.from({ length: n }, () => v);
const ARROW_CASES = {
  'yearly: February over the goal, January under, the rest of the year ahead': { vals: [1000, 3000, ...fill(10, 0)], futureFrom: 2 },
  'yearly: every month over except the first': { vals: [1200, ...fill(11, 3200)] },
  'monthly: day 3 today, days 2 and 3 over, day 1 under': { vals: [500, 2800, 3100, ...fill(28, 0)], futureFrom: 3 },
  'monthly: day 3 today, days 2 and 3 over, day 1 empty': { vals: [0, 2800, 3100, ...fill(28, 0)], futureFrom: 3 },
  'monthly: only day 1 under the goal': { vals: [1500, ...fill(30, 2500)] },
  'monthly: only the last day under the goal': { vals: [...fill(30, 2500), 1500] },
  'weekly: mixed': { vals: [4600, 1200, 2000, 900, 3000, 0, 0] },
  'weekly: every day over': { vals: [9000, 9500, 8800, 9100, 9900, 8700, 9300] },
};
for (const [name, c] of Object.entries(ARROW_CASES)) {
  test(`the goal arrow never touches a bar along its whole path: ${name}`, async ({ page }) => {
    const r = await renderChart(page, c);
    expect(r.arrows).toBe(2);
    expect(r.samples).toBeGreaterThan(100);
    expect(r.bars.length).toBeGreaterThan(0);
    expect(r.bars.some((b) => b.over), 'a bar over the goal in this case').toBe(true);
    expect(r.hits).toEqual([]);
  });
}

test('a day exactly at the goal is not over it: no red class, the plain fill; one more is red', async ({ page }) => {
  const r = await renderChart(page, { vals: [2000, 2001, 1999], recommended: 2000 });
  expect(r.bars).toHaveLength(3);
  // columns run right to left: the first value is the rightmost bar
  const byValue = Object.fromEntries([2000, 2001, 1999].map((v, i) => [v, r.bars[i]]));
  expect(byValue[2000].over).toBe(false);
  expect(byValue[2000].fill).toBe('rgb(217, 168, 80)');
  expect(byValue[1999].over).toBe(false);
  expect(byValue[2001].over).toBe(true);
  expect(byValue[2001].fill).toBe('rgb(201, 83, 47)');
});
