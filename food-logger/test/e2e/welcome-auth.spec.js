'use strict';

const { test, expect } = require('@playwright/test');
const { attachGuards, expectNoGuardEvents, SIGNED_OUT_ME } = require('./helpers');

// Task 7 of the diary redesign: the welcome cover (foil title, the original capybara with her salad
// bowl, three feature lines) and the sign-in pages (handwritten fields, red ink buttons, the walking
// capybara at the bottom of the page).

const PASSWORD = 'first-password-1';

const FEATURES = [
  'צלם את הצלחת. ה-AI מזהה ומחשב',
  'קלוריות ומאקרו, הכול במקום אחד',
  'גרפים: שבועי, חודשי ושנתי',
];

test('welcome cover: foil title, three feature lines, the capybara in her salad bowl', async ({ page }) => {
  const guards = attachGuards(page);
  await page.goto('/');
  const welcome = page.locator('#screen-welcome');
  await expect(welcome).toBeVisible();

  // the foil title, in Suez One
  const foil = welcome.locator('.foil');
  await expect(foil).toHaveText('יומן.');
  expect(await foil.evaluate((el) => getComputedStyle(el).fontFamily)).toContain('Suez One');
  await expect(welcome.getByText('יומן האוכל האישי שלך', { exact: true })).toBeVisible();

  // three feature lines, each with a gold line icon
  for (const text of FEATURES) {
    const line = welcome.locator('.feat', { hasText: text });
    await expect(line, text).toHaveCount(1);
    await expect(line.locator('svg')).toHaveCount(1);
  }
  await expect(welcome.locator('.feat')).toHaveCount(3);

  // the REAL capybara in the drawn style, happy, with the salad bowl; the old logo is gone
  const pet = welcome.locator('svg.pet-inked');
  await expect(pet).toHaveCount(1);
  await expect(pet.locator('xpath=..')).toHaveClass(/pet--happy/);
  expect(await pet.locator('.pet-bowl circle').count(), 'salad in the bowl').toBeGreaterThan(8);
  await expect(welcome.locator('svg.capy-logo')).toHaveCount(0);   // the old logo is gone from every screen
  await expect(welcome.locator('.walker')).toHaveCount(0);

  // the two buttons keep their actions
  const start = welcome.getByRole('button', { name: 'התחל עכשיו' });
  await expect(start).toHaveAttribute('data-action', 'goToAuth');
  await expect(start).toHaveAttribute('data-arg', 'register');
  const have = welcome.getByRole('button', { name: 'כבר יש לי חשבון' });
  await expect(have).toHaveAttribute('data-action', 'goToAuth');
  await expect(have).toHaveAttribute('data-arg', 'login');

  expectNoGuardEvents(guards, [SIGNED_OUT_ME]);
});

test('auth pages: handwritten fields, tabs, chips, walking capybara, stopped on leave', async ({ page }) => {
  const guards = attachGuards(page);
  const username = `user${Date.now()}`;
  await page.goto('/');
  await page.getByRole('button', { name: 'כבר יש לי חשבון' }).click();

  const auth = page.locator('#screen-auth');
  await expect(auth).toBeVisible();
  await expect(auth.locator('.page')).toHaveCount(1);

  // the walking capybara lives in the page lane while the screen is shown
  await expect(auth.locator('.page > .walker')).toHaveCount(1);
  await expect(auth.locator('.page > .walker svg.pet-inked')).toHaveCount(1);

  // a handwritten field: only an underline, no box
  const field = await page.locator('#login-user').evaluate((el) => {
    const cs = getComputedStyle(el);
    return { top: cs.borderTopWidth, bottom: cs.borderBottomWidth, radius: cs.borderTopLeftRadius };
  });
  expect(field).toEqual({ top: '0px', bottom: '2px', radius: '0px' });
  // the red ink button
  const penBg = await auth.locator('#auth-login').getByRole('button', { name: 'כניסה' })
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(penBg).toBe('rgb(179, 49, 29)');

  // tab switching still works
  await expect(page.locator('#auth-login')).toBeVisible();
  await expect(page.locator('#auth-register')).toBeHidden();
  await page.locator('#auth-step1 .tab-btn', { hasText: 'הרשמה' }).click();
  await expect(page.locator('#auth-register')).toBeVisible();
  await expect(page.locator('#auth-login')).toBeHidden();
  await expect(page.locator('#auth-step1 .tab-btn.active')).toHaveText('הרשמה');
  await page.locator('#auth-step1 .tab-btn', { hasText: 'כניסה' }).click();
  await expect(page.locator('#auth-login')).toBeVisible();
  await expect(page.locator('#auth-step1 .tab-btn.active')).toHaveText('כניסה');
  await page.locator('#auth-step1 .tab-btn', { hasText: 'הרשמה' }).click();

  // registration step 1 -> the profile step: chips for the gender, handwritten rows for the activity
  await page.locator('#reg-user').fill(username);
  await page.locator('#reg-pass').fill(PASSWORD);
  await page.locator('#auth-register').getByRole('button', { name: 'הרשמה' }).click();
  await expect(page.locator('#auth-step2')).toBeVisible();
  await expect(page.locator('#reg-female-btn')).toHaveClass(/chip/);
  const chipBorder = await page.locator('#reg-male-btn').evaluate((el) => getComputedStyle(el).borderTopColor);
  expect(chipBorder, 'the selected chip is red ink').toBe('rgb(179, 49, 29)');
  await page.locator('#reg-female-btn').click();
  await expect(page.locator('#reg-female-btn')).toHaveClass(/selected/);
  // the walker does not walk over the tall profile step
  await expect(auth.locator('.walker')).toBeHidden();
  await page.locator('#reg-birthdate').fill('1990-05-15');
  await page.locator('#reg-height').selectOption('175');
  await page.getByRole('button', { name: /בוא נתחיל/ }).click();

  // leaving the screen stops the walker (its lane is removed)
  await expect(page.locator('#screen-dashboard')).toBeVisible();
  await expect(auth.locator('.walker')).toHaveCount(0);
  await expect(page.locator('.walker')).toHaveCount(0);

  expectNoGuardEvents(guards, [SIGNED_OUT_ME]);
});

test('the walker comes back when the auth screen is shown again (logout)', async ({ page }) => {
  const guards = attachGuards(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'התחל עכשיו' }).click();
  await page.locator('#reg-user').fill(`user${Date.now()}`);
  await page.locator('#reg-pass').fill(PASSWORD);
  await page.locator('#auth-register').getByRole('button', { name: 'הרשמה' }).click();
  await page.getByRole('button', { name: 'דלג לעת עתה' }).click();
  await expect(page.locator('#screen-dashboard')).toBeVisible();
  await expect(page.locator('.walker')).toHaveCount(0);

  await page.locator('#nav-settings').click();
  await page.locator('#screen-settings .settings-item', { hasText: 'יציאה' }).click();
  await expect(page.locator('#screen-auth')).toBeVisible();
  await expect(page.locator('#screen-auth .page > .walker')).toHaveCount(1);
  expectNoGuardEvents(guards, [SIGNED_OUT_ME]);
});

test('registration step 2 is reachable on a 320x568 phone (the page scrolls)', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/');
  await page.getByRole('button', { name: 'התחל עכשיו' }).click();
  await page.locator('#reg-user').fill(`user${Date.now()}`);
  await page.locator('#reg-pass').fill(PASSWORD);
  await page.locator('#auth-register').getByRole('button', { name: 'הרשמה' }).click();
  await expect(page.locator('#auth-step2')).toBeVisible();

  const r = await page.evaluate(() => {
    const scroller = document.querySelector('#screen-auth .content');
    const pageEl = document.querySelector('#screen-auth .page');
    const skip = document.querySelector('[data-action="skipRegProfile"]');
    const height = document.querySelector('#reg-height');
    scroller.scrollTop = 0;
    const heightVisible = height.getBoundingClientRect().top >= pageEl.getBoundingClientRect().top;
    scroller.scrollTop = scroller.scrollHeight;
    const skipVisible = skip.getBoundingClientRect().bottom <= pageEl.getBoundingClientRect().bottom + 1;
    return {
      scrollable: scroller.scrollHeight > scroller.clientHeight,
      heightVisible, skipVisible,
      sideways: document.documentElement.scrollWidth <= innerWidth,
    };
  });
  expect(r).toEqual({ scrollable: true, heightVisible: true, skipVisible: true, sideways: true });
});
