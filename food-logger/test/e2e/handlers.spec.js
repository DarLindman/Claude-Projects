'use strict';

// Task 12: every inline event handler is gone; behaviour is wired by delegation
// (data-action / data-change on the screen, modal and nav roots).

const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { attachGuards, expectNoGuardEvents, SIGNED_OUT_ME, SAVE_TO_DIARY } = require('./helpers');

const ALLOWED_BASELINE = [SIGNED_OUT_ME];
const PASSWORD = 'handlers-pass-1';

// 1x1 transparent PNG, enough for the client-side image pipeline.
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

// ── static scan ─────────────────────────────────────────────────────────────
const PUBLIC = path.join(__dirname, '..', '..', 'public');
// Inline-handler attribute syntax. The lookbehind skips property assignments such as
// `reader.onload = ...`, which are ordinary (CSP-safe) JavaScript.
const INLINE_HANDLER = /(?<![\w.$])on(click|change|input|submit|keydown|load|error)\s*=(?!=)/g;

function sourceFiles() {
  const files = [path.join(PUBLIC, 'index.html')];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js')) files.push(full);
    }
  };
  walk(path.join(PUBLIC, 'js'));
  return files;
}

test('no inline handler attribute appears in index.html or in any frontend JS string', () => {
  const offenders = [];
  for (const file of sourceFiles()) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (INLINE_HANDLER.test(line)) offenders.push(`${path.relative(PUBLIC, file)}:${i + 1}`);
      INLINE_HANDLER.lastIndex = 0;
    });
  }
  expect(offenders, `inline handlers found:\n  ${offenders.join('\n  ')}`).toEqual([]);
});

// ── runtime helpers ─────────────────────────────────────────────────────────
// Every attribute in the live DOM whose name looks like an event handler.
const inlineHandlerAttrs = (page) => page.evaluate(() => {
  const found = [];
  for (const el of document.querySelectorAll('*')) {
    for (const name of el.getAttributeNames()) {
      if (/^on[a-z]+$/.test(name)) found.push(`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}[${name}]`);
    }
  }
  return found;
});

const expectNoInline = async (page, where) => {
  expect(await inlineHandlerAttrs(page), `inline handlers in the DOM (${where})`).toEqual([]);
};

const savedProfile = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('fl_profile')));

// Clicks well inside the sheet, then well outside it (on the backdrop).
async function expectBackdropRule(page, modalId, sheetClickTarget) {
  const modal = page.locator(`#${modalId}`);
  await expect(modal).toHaveClass(/open/);
  await modal.locator(sheetClickTarget).first().click();
  await expect(modal).toHaveClass(/open/);
  await modal.click({ position: { x: 4, y: 4 } });
  await expect(modal).not.toHaveClass(/open/);
}

test('inline handlers are gone and every delegated action still works', async ({ page }) => {
  const guards = attachGuards(page);
  // events.js warns about a data-action / data-change name nobody handles
  const unhandled = [];
  page.on('console', (msg) => { if (msg.type() === 'warning' && msg.text().startsWith('No handler')) unhandled.push(msg.text()); });
  const username = `hnd${Date.now()}`;

  // ── welcome ────────────────────────────────────────────────────────────
  await page.goto('/');
  await expect(page.locator('#screen-welcome')).toBeVisible();
  await expectNoInline(page, 'welcome');

  // "I already have an account" opens the login tab, "start now" the register tab
  await page.getByRole('button', { name: 'יש לי חשבון' }).click();
  await expect(page.locator('#auth-login')).toBeVisible();
  await expect(page.locator('#auth-register')).toBeHidden();
  await page.locator('#auth-step1 .tab-btn', { hasText: 'הרשמה' }).click();
  await expect(page.locator('#auth-register')).toBeVisible();
  await expect(page.locator('#auth-login')).toBeHidden();
  await expectNoInline(page, 'auth');

  // ── register: step 2, back button, then the profile controls ───────────
  await page.locator('#reg-user').fill(username);
  await page.locator('#reg-pass').fill(PASSWORD);
  await page.locator('#auth-register').getByRole('button', { name: 'הרשמה' }).click();
  await expect(page.locator('#auth-step2')).toBeVisible();
  await page.getByRole('button', { name: /חזור/ }).click();
  await expect(page.locator('#auth-step1')).toBeVisible();
  await expect(page.locator('#auth-step2')).toBeHidden();
  await page.locator('#auth-register').getByRole('button', { name: 'הרשמה' }).click();
  await expect(page.locator('#auth-step2')).toBeVisible();

  await page.locator('#reg-female-btn').click();
  await expect(page.locator('#reg-female-btn')).toHaveClass(/selected/);
  await expect(page.locator('#reg-male-btn')).not.toHaveClass(/selected/);
  await page.locator('#reg-activity-list .activity-opt[data-val="active"]').click();
  await expect(page.locator('#reg-activity-list .activity-opt.selected')).toHaveAttribute('data-val', 'active');
  await page.locator('#reg-goal-select').selectOption('0.5');   // the goal <select> change handler
  await page.locator('#reg-birthdate').fill('1990-05-15');
  await page.locator('#reg-height').selectOption('170');
  await expectNoInline(page, 'register step 2');
  await page.getByRole('button', { name: /בוא נתחיל/ }).click();

  // the goal, gender and activity chosen through the delegated handlers reach the saved profile
  await expect(page.locator('#screen-dashboard')).toBeVisible();
  expect(await savedProfile(page)).toMatchObject({ gender: 'female', activity: 'active', goalKg: 0.5, height: 170 });
  await expectNoInline(page, 'dashboard');

  // ── camera: file picker button and the file input's change handler ─────
  await page.locator('#nav-camera').click();                       // the dock's add button -> camera (the home page has no CTA of its own any more)
  await expect(page.locator('#screen-camera')).toBeVisible();
  // The listener is registered before the click that opens the chooser (Promise.all), and the
  // button is given time to be actionable once the screen transition has settled.
  const shoot = page.locator('.cam-frame');   // the dashed frame is the whole shutter button
  await expect(shoot).toBeEnabled();
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 15_000 }),
    shoot.click(),
  ]);
  await chooser.setFiles({ name: 'meal.png', mimeType: 'image/png', buffer: TINY_PNG });
  await expect(page.locator('#analyze-btn')).toBeEnabled();      // onImageSelected ran
  await expectNoInline(page, 'camera');

  // ── analyse a text (fake analysis) ─────────────────────────────────────
  await page.locator('#food-text-input').fill('סלט ולחם');
  await page.locator('#text-analyze-btn').click();
  await expect(page.locator('#screen-analysis')).toBeVisible();
  await expect(page.locator('#analysis-result')).toBeVisible();

  // meal type buttons on the analysis screen change the selection
  const analysisMeals = page.locator('#screen-analysis .meal-opt');
  await analysisMeals.filter({ hasText: 'ערב' }).click();
  await expect(page.locator('#screen-analysis .meal-opt.selected')).toHaveCount(1);
  await expect(page.locator('#screen-analysis .meal-opt.selected')).toHaveAttribute('data-meal', 'dinner');
  await analysisMeals.filter({ hasText: 'בוקר' }).click();
  await expect(page.locator('#screen-analysis .meal-opt.selected')).toHaveAttribute('data-meal', 'breakfast');
  await analysisMeals.filter({ hasText: 'ערב' }).click();
  await expectNoInline(page, 'analysis');

  // the dock's add button goes back to the camera (the analysis page has no top bar of its own any more)
  await page.locator('#nav-camera').click();
  await expect(page.locator('#screen-camera')).toBeVisible();
  await page.locator('#text-analyze-btn').click();
  await expect(page.locator('#analysis-result')).toBeVisible();
  await page.locator('#screen-analysis .meal-opt', { hasText: 'ערב' }).click();

  // ── save -> diary entry ────────────────────────────────────────────────
  await page.locator('#save-entry-btn').click();
  await expect(page.locator('#screen-home')).toBeVisible(SAVE_TO_DIARY);
  const rows = page.locator('#meal-list .meal-item-row');
  await expect(rows).toHaveCount(1);
  await expectNoInline(page, 'diary with an entry (generated row buttons)');

  // diary day navigation
  const dayLabel = page.locator('#diary-date-label');
  const today = await dayLabel.textContent();
  await page.locator('#screen-home .date-nav button').first().click();
  await expect(dayLabel).not.toHaveText(today);
  await page.locator('#screen-home .date-nav button').last().click();
  await expect(dayLabel).toHaveText(today);
  await expect(rows).toHaveCount(1);

  // ── edit modal: meal type, generated button rows, close rules ─────────
  await rows.first().getByRole('button', { name: 'ערוך' }).click();
  await expect(page.locator('#edit-modal')).toHaveClass(/open/);
  await expectNoInline(page, 'edit modal (unchanged name -> single save button)');

  await page.locator('#edit-modal .meal-opt[data-meal="snack"]').click();
  await expect(page.locator('#edit-modal .meal-opt.selected')).toHaveCount(1);
  await expect(page.locator('#edit-modal .meal-opt.selected')).toHaveAttribute('data-meal', 'snack');
  // the edit modal's selection does not leak to the analysis screen's buttons
  await expect(page.locator('#screen-analysis .meal-opt.selected')).toHaveAttribute('data-meal', 'dinner');

  await page.locator('#edit-name').fill('שם שונה');                // renaming -> recalculate + save-without buttons
  await expect(page.getByRole('button', { name: 'חשב מחדש', exact: true })).toBeVisible();
  await expectNoInline(page, 'edit modal (renamed -> two generated buttons)');

  // clicks inside the sheet keep it open, the backdrop and the close button close it
  await expectBackdropRule(page, 'edit-modal', '.modal-title');
  await rows.first().getByRole('button', { name: 'ערוך' }).click();
  await expect(page.locator('#edit-modal')).toHaveClass(/open/);
  await page.locator('#edit-modal-close').click();
  await expect(page.locator('#edit-modal')).not.toHaveClass(/open/);

  // recalculate (generated handler) then save (generated handler)
  await rows.first().getByRole('button', { name: 'ערוך' }).click();
  await page.locator('#edit-name').fill('סלט ירוק');
  await page.getByRole('button', { name: 'חשב מחדש', exact: true }).click();
  await expect(page.locator('#edit-btn-row').getByRole('button', { name: 'שמור', exact: true })).toBeVisible();
  await expect(page.locator('#edit-cal')).not.toHaveValue('');
  await page.locator('#edit-btn-row').getByRole('button', { name: 'שמור', exact: true }).click();
  await expect(page.locator('#edit-modal')).not.toHaveClass(/open/);
  await expect(rows.first().locator('.mir-name')).not.toBeEmpty();

  // ── stats: tabs, month and year pickers, charts rendered ───────────────
  await page.locator('#nav-stats').click();
  await expect(page.locator('#screen-stats')).toBeVisible();
  await expect(page.locator('#stats-weekly')).toBeVisible();
  await expectNoInline(page, 'stats weekly');
  await page.locator('.stats-tab', { hasText: 'חודשי' }).click();
  await expect(page.locator('#stats-monthly')).toBeVisible();
  const monthLabel = page.locator('#stats-month-label');
  await expect(monthLabel).not.toBeEmpty();
  const thisMonth = await monthLabel.textContent();
  await page.locator('#stats-monthly .date-nav button').first().click();
  await expect(monthLabel).not.toHaveText(thisMonth);
  await expectNoInline(page, 'stats monthly');
  await page.locator('.stats-tab', { hasText: 'שנתי' }).click();
  await expect(page.locator('#stats-yearly')).toBeVisible();
  const thisYear = String(new Date().getFullYear());
  await expect(page.locator('#stats-year-label')).toHaveText(thisYear);
  await page.locator('#stats-yearly .date-nav button').first().click();
  await expect(page.locator('#stats-year-label')).not.toHaveText(thisYear);
  await expectNoInline(page, 'stats yearly');
  await page.locator('.stats-tab', { hasText: 'שבועי' }).click();
  await expect(page.locator('#stats-weekly')).toBeVisible();

  // ── weight: generated list buttons ─────────────────────────────────────
  await page.locator('#nav-weight').click();
  await expect(page.locator('#screen-weight')).toBeVisible();
  const weights = page.locator('#weight-list .weight-entry');
  await expect(weights).toHaveCount(1);
  await page.locator('#weight-val').fill('71.5');
  await page.locator('#screen-weight').getByRole('button', { name: 'הוסף שקילה', exact: true }).click();
  await expect(weights).toHaveCount(2);
  await expectNoInline(page, 'weight list');
  await weights.filter({ hasText: '71.5' }).getByRole('button', { name: 'מחק' }).click();
  await expect(weights).toHaveCount(1);

  // ── diary via the bottom nav ───────────────────────────────────────────
  await page.locator('#nav-home').click();
  await expect(page.locator('#screen-home')).toBeVisible();
  await page.locator('#nav-dashboard').click();
  await expect(page.locator('#screen-dashboard')).toBeVisible();
  await expectNoInline(page, 'dashboard with a log preview');

  // ── settings: profile modal ────────────────────────────────────────────
  await page.locator('#nav-settings').click();
  await expect(page.locator('#screen-settings')).toBeVisible();
  await expectNoInline(page, 'settings');
  await page.locator('#screen-settings .settings-item', { hasText: 'פרופיל גוף ויעד' }).click();
  await expect(page.locator('#modal-profile')).toHaveClass(/open/);
  await expectNoInline(page, 'profile modal');
  await expectBackdropRule(page, 'modal-profile', '.modal-title');
  await page.locator('#screen-settings .settings-item', { hasText: 'פרופיל גוף ויעד' }).click();
  await page.locator('#modal-profile .modal-close').click();
  await expect(page.locator('#modal-profile')).not.toHaveClass(/open/);

  await page.locator('#screen-settings .settings-item', { hasText: 'פרופיל גוף ויעד' }).click();
  await expect(page.locator('#modal-profile')).toHaveClass(/open/);
  const preview = page.locator('#mp-cal-preview');
  await page.locator('#mp-birthdate').fill('1990-05-15');         // change -> updateMpPreview
  await page.locator('#mp-height').selectOption('175');          // change -> updateMpPreview
  await page.locator('#mp-goal-select').selectOption('0');       // change -> setMpGoal
  await expect(preview).not.toHaveText('—');
  const goalZero = await preview.textContent();
  await page.locator('#mp-goal-select').selectOption('-0.5');
  await expect(preview).not.toHaveText(goalZero);                // the goal select updated state
  await page.locator('#mp-male-btn').click();
  await page.locator('#mp-activity-list .activity-opt[data-val="sedentary"]').click();
  await expect(page.locator('#mp-activity-list .activity-opt.selected')).toHaveAttribute('data-val', 'sedentary');
  await page.getByRole('button', { name: 'שמור פרופיל' }).click();
  await expect(page.locator('#modal-profile')).not.toHaveClass(/open/);
  expect(await savedProfile(page)).toMatchObject({ gender: 'male', activity: 'sedentary', goalKg: -0.5, height: 175 });

  // ── settings: change-password modal ────────────────────────────────────
  await page.locator('#screen-settings .settings-item', { hasText: 'שינוי סיסמה' }).click();
  await expect(page.locator('#modal-change-pass')).toHaveClass(/open/);
  await expectNoInline(page, 'change password modal');
  await expectBackdropRule(page, 'modal-change-pass', '.modal-title');
  await page.locator('#screen-settings .settings-item', { hasText: 'שינוי סיסמה' }).click();
  await page.locator('#modal-change-pass .modal-close').click();
  await expect(page.locator('#modal-change-pass')).not.toHaveClass(/open/);

  // ── logout ─────────────────────────────────────────────────────────────
  await page.locator('#screen-settings .settings-item', { hasText: 'יציאה' }).click();
  await expect(page.locator('#screen-auth')).toBeVisible();

  await expectNoInline(page, 'end of journey');
  expect(unhandled, 'markup names an action that no module handles').toEqual([]);
  expectNoGuardEvents(guards, ALLOWED_BASELINE);
});
