# UI Redesign (sub-project 4: the personal diary) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the visual layer of the food-logger PWA with the approved "personal diary" design (leather cover, ruled pages, polaroids, printed receipt, the original capybara in a light drawn style, self-hosted Hebrew fonts), plus the two additive server features it needs (per-item calories in the analysis reply, meal thumbnails).

**Architecture:** Plain ES modules and CSS, no build step. The design lives in a rewritten CSS layer (tokens, base, components, screens) and re-marked-up screens in `public/index.html`; behaviour modules keep their `data-action` hooks and element ids (the "hook contract" below). New small modules: `tally.js`, `receipt.js`, `photos.js` and a capybara decorator in `pet.js`. Server: migration `003`, photo routes, `items` in the analysis reply.

**Tech Stack:** Node 24, Express 4, pg, zod, `node --test` + supertest, Playwright, `@napi-rs/canvas` (icons), vanilla JS/CSS/SVG.

**Spec:** `docs/superpowers/specs/2026-10-03-ui-redesign-design.md` (approved by the owner 2026-10-03). **Visual source of truth:** `docs/superpowers/design/2026-10-03-journal-ui-reference.html` (open it in a browser; it holds every CSS value, SVG and animation used below; port from it, do not reinvent). Executors read both.

## Global Constraints

- Work in `food-logger/` on branch `ui-redesign` (use a worktree). Tests use `foodlogger_test`; never run `npm test` and `npm run test:e2e` at the same time; one agent at a time on the test database.
- **No build step, no new runtime dependencies.** Frontend stays plain ES modules; no inline scripts or event-handler attributes (strict CSP: `script-src 'self'`; `style-src` allows inline `style=` attributes); nothing loaded from third-party origins (`font-src 'self'`); use the escape-by-default `html` tag and `setHtml` from `js/dom.js` for every markup string that contains data.
- **No real AI calls anywhere.** Tests use the fake Anthropic client. Nothing here changes prompts, models or `src/lib/analysis.js` logic except returning `items` (Task 3).
- **Hebrew copy:** only the strings listed in spec section 5 are new; everything else keeps its current wording. Every new string passes `test/api/hebrew-spelling.test.js`; the copy audit (`docs/hebrew-copy-audit.md`) and the baseline snapshot (`test/e2e/__snapshots__/he-text.json`, `UPDATE_SNAPSHOT=1`) are regenerated at the end with a per-key old → new list (Task 15).
- **Numbers:** every digit outside the receipt and the phone's own status bar is rendered with the family `Digits` (spec section 3); the receipt uses `Cousine` for Hebrew and numbers.
- **Never** show grams of a component to the user and never offer editing of component weights (macros in grams stay as today).
- Motion must honour `prefers-reduced-motion` (existing rule in `base.css` stays; new animations are added to it).
- Accessibility work is out of scope (do not remove what exists; do not add effort).
- Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

**Plan note (resolves a wording in spec section 5):** the diary arrows keep the existing one-day `changeDay` action (so `#screen-home .date-nav button` stays valid) and the week strip always shows the Sunday-Saturday week of the displayed day; together with tapping any day in the strip this lets the user reach every day, which is what the owner asked for.

### Hook contract (ids, selectors and button names the tests rely on; keep them working)

Screen ids `#screen-welcome|auth|dashboard|home|camera|analysis|stats|weight|settings`; nav ids `#bottom-nav`, `#nav-dashboard` (home), `#nav-home` (**the diary**), `#nav-camera` (add), `#nav-stats`, `#nav-weight`, `#nav-settings`; auth `#auth-login`, `#auth-register`, `#auth-step2`, `#login-user`, `#login-pass`, `#reg-user`, `#reg-pass`, `#reg-height`, `#reg-birthdate`, `#reg-female-btn`; modals `#modal-profile` (`.modal-close`, `#mp-goal-select`), `#modal-change-pass` (`.modal-close`, `#cp-current`, `#cp-new`, `#cp-error`), `#edit-modal` (`#edit-name`, `#edit-modal-close`, `#edit-btn-row`, `.meal-opt.selected`); camera `#food-text-input`, `#text-analyze-btn`, `#preview-img`, `#cam-preview`, `#analyze-btn`, `#file-input`; analysis `#analysis-result`, `#res-name`, `#res-cal`, `#res-pro|carb|fat|fiber`, `#res-time`, `#save-entry-btn`, `#screen-analysis .meal-opt.selected`; diary `#meal-list`, `.meal-item-row`, `.mir-name`, `.empty-state`, `#sum-cal`, `#diary-date-label`, `#screen-home .date-nav button` (two buttons, previous/next day via `changeDay`); stats `#stats-weekly|monthly|yearly`, `#stats-month-label`, `#stats-year-label`, `.stats-tab`; weight `#weight-val`, `#weight-list .weight-entry`; settings `#settings-user`; dashboard `#pet-name-label`, `#pet-status-text`. Buttons found by Hebrew accessible name: ערוך, מחק, שמור (exact), חשב מחדש (exact), שמור מבלי לחשב מחדש, התחל עכשיו, בוא נתחיל, הרשמה, כניסה. Tasks that change an id or a name update the tests in the same commit and say so.

## Review Focus

Conditions the spec implies but no task would otherwise test; each has a test in the task named in brackets.

1. The thumbnail upload fails or is rejected (offline, too big, not a JPEG): the meal is still saved, the diary shows the placeholder, the user sees no error. [Task 10]
2. A meal with a very long Hebrew name, an analysis with 0, 1, 12 items or an item with an empty/foreign name, and a day with 0 and with 20 meals: nothing overflows the polaroid column or the receipt, no broken layout. [Tasks 9, 11]
3. One user asking for another user's thumbnail by id, or for an id that does not exist, gets the same 404 and nothing leaks. [Task 4]
4. A 320 px wide phone and a slow font load: the layout stays inside the page, the walking capybara's lane shrinks with the page, the fallback fonts keep the rows on the 30 px grid. [Tasks 2, 5]
5. Digits mixed into Hebrew lines (a date such as "שבת, 3 באוקטובר", "1,341 קק״ל מתוך 2,000", "175 ס״מ") keep their order in RTL and use the digit font; a goal of 10,000 or a weight of 100.5 do not break the line. [Tasks 2, 15]

---

## File Structure

- `public/fonts/*.woff2` + `OFL-*.txt` (create, Task 1); `public/css/fonts.css`, `tokens.css`, `base.css`, `components.css`, `screens.css` (rewrite, Tasks 1-2 and per screen).
- `public/index.html` (re-marked-up screen by screen); `public/manifest.json` and `src/lib/icon.js` (Task 15).
- `public/js/pet.js` (decorator, walker), `tally.js`, `receipt.js`, `photos.js` (create); `public/js/screens/*.js`, `charts.js`, `router.js`, `main.js` (modify).
- `src/lib/analysis.js`, `src/routes/analyze.js` (items, Task 3); `src/db/migrations/003_food_photos.sql`, `src/routes/food.js` or new `src/routes/foodPhotos.js`, `src/lib/schemas.js`, `src/app.js` (Task 4).
- Tests: `test/api/{frontend-fonts,analysis-items,food-photos,tally,receipt}.test.js`, `test/e2e/{fonts,walker,diary,add-meal,receipt-flow}.spec.js`, existing specs updated.

---

### Task 1: Self-hosted fonts

**Files:**
- Create: `public/fonts/{GveretLevin,SuezOne,Cousine-400,Cousine-700,PlaypenSansHebrew}-*.woff2` (Hebrew and Latin subsets as needed), `public/fonts/OFL-*.txt` for each
- Modify: `public/css/fonts.css` (new families; the old Latin-only families stay until Task 15)
- Test: `test/api/frontend-fonts.test.js`

**Interfaces:**
- Produces CSS families: `'Gveret Levin'` (Hebrew + Latin + digits, weight 400), `'Suez One'` (400), `'Cousine'` (400, 700), `'Digits'` (the Playpen Sans Hebrew file, weight 500 and 600, with `unicode-range: U+0030-0039, U+002C, U+002E, U+003A, U+002F`), `'Playpen Sans Hebrew'` (400, 500, 600; Hebrew + Latin; the fallback for Latin letters). All `font-display: swap`. A font stack of the form `'Digits', 'Gveret Levin', 'Playpen Sans Hebrew', cursive` renders digits in `Digits` and everything else in the next families.

- [ ] **Step 1: Write the failing test** `frontend-fonts.test.js` (node:test, reads files, no DB): every `url(...)` in `public/css/*.css` points to an existing file under `public/`; no `http://`, `https://` or `//` URL appears in `public/css/*.css` or `public/index.html`; the declared families above all exist in `fonts.css`; the sum of the sizes of all `.woff2` files under `public/fonts/` that `fonts.css` references is at most 300 KB (old files excluded until Task 15 removes them: count only files referenced by the new families); each new family's file has a licence text next to it.
- [ ] **Step 2: Run** `node --test test/api/frontend-fonts.test.js` — expect FAIL.
- [ ] **Step 3: Obtain the files** with the existing method (`@fontsource/*` packages fetched with `npm pack` into a scratch directory, never added to `package.json`): `@fontsource/gveret-levin`, `@fontsource/suez-one`, `@fontsource/cousine`, `@fontsource/playpen-sans-hebrew`; take the `hebrew` and `latin` woff2 subsets (weights above), copy them and the licence texts into `public/fonts/`, and write the `@font-face` rules (with the `unicode-range` split for `Digits`). Record the package versions in a comment at the top of `fonts.css`.
- [ ] **Step 4: Run** the test — expect PASS; run `npm test` — expect PASS (`security.test.js` already asserts the CSP).
- [ ] **Step 5: Commit** `feat: self-hosted Hebrew handwriting fonts and the digit family`.

---

### Task 2: Design tokens, leather frame, page, dock

**Files:**
- Modify: `public/css/tokens.css`, `base.css`, `components.css`, `public/index.html` (shell and `#bottom-nav` only), `public/js/main.js` and `router.js` only if the shell needs it
- Test: `test/e2e/fonts.spec.js` (new), existing e2e specs

**Interfaces:**
- Produces the tokens of spec section 3 as CSS custom properties (`--leather`, `--page`, `--ink`, `--graphite`, `--red`, `--gold`, `--rule`, `--lift`, `--ease-spring`, `--ease-out`, `--dur-*`) and the shared classes ported from the reference with the same names: `.phone-frame` (the leather cover with the dashed stitch, centred, max 430 px wide on desktop), `.page` (cream ruled page with spine shadow and page-edge steps), `.rules`, `.margin`, `.content`, `.hand` (the handwriting stack), `.dg` is **not** used in the app (the digit family comes from the stack), `.polaroid`, `.tape`, `.circ`, `.stamp`, `.penbtn`, `.chip`, `.field`, `.bubble`, `.ribbon`, `.dock`. The body font stack becomes `'Digits', 'Gveret Levin', 'Playpen Sans Hebrew', cursive`; the receipt class sets `font-family: 'Cousine', monospace`.
- The bottom dock keeps the six buttons and ids of the hook contract; labels in handwriting; the add button is an orange pill; the active one highlighted by the router as today.

- [ ] **Step 1: Write the failing e2e test** `fonts.spec.js`: on the welcome screen and after registering, (a) `document.fonts` reports `Gveret Levin`, `Suez One` and `Digits` as loaded (use `document.fonts.check`), (b) no request leaves the origin (collect `page.on('request')`), (c) a walker over every text node on the visible screen that contains digits (outside `.receipt` and an element with `data-native-chrome`) asserts the computed `font-family` list starts with `Digits`, (d) at a 320 px viewport no horizontal scroll appears (`document.documentElement.scrollWidth <= innerWidth`).
- [ ] **Step 2: Run** `npx playwright test test/e2e/fonts.spec.js` — expect FAIL.
- [ ] **Step 3: Implement** tokens, base, the shell and the dock, porting values from the reference; remove the animated embers/mesh background, the orange theme and the old dock styling (keep `prefers-reduced-motion` rules).
- [ ] **Step 4: Run** the new spec, then `npm run test:e2e` and `npm test` — expect PASS (the Hebrew baseline spec may fail on visible-copy differences: if so, do not re-record yet; list the failing keys in the report, Task 15 re-records).
- [ ] **Step 5: Commit** `feat: diary design tokens, leather frame, page and dock`.

---

### Task 3: Per-item calories in the analysis reply

**Files:**
- Modify: `src/lib/analysis.js`, `src/routes/analyze.js` (only if the reply is shaped there), `test/helpers/fakeAnthropic.js` (only to add items variety), `CLAUDE.md`
- Test: `test/api/analysis-items.test.js`

**Interfaces:**
- Produces: `POST /api/analyze` and `POST /api/analyze-text` replies gain `items: Array<{ name: string, calories: number }>` (at most 8 entries in model order; names through `cleanDishName`, trimmed to 40 characters; an empty or unusable name becomes `פריט`; calories are the values after `reconcileItems`, rounded to integers, never negative; no weight field; the original fields stay unchanged). `analyzeImage` and `analyzeText` return `{ foodName, ...totals, items }`.

- [ ] **Step 1: Write failing tests** (fake client): the image reply of the fake has two items → `items` has two entries with those names and calories; no key `weight_g`/`volume_ml` anywhere in the JSON of the response; 12 model items → 8 entries; an item with name `chicken עוף` keeps only Hebrew letters (existing cleaning); an item with name `""`/`"???"` becomes `פריט`; items whose calories were corrected by the sanity rules show the corrected value; the old fields (`foodName`, totals) are unchanged; same for `analyze-text`.
- [ ] **Step 2: Run** `node --test test/api/analysis-items.test.js` — expect FAIL.
- [ ] **Step 3: Implement** in `analysis.js` (build the list after `reconcileItems`, from the checked items); update the `CLAUDE.md` API note.
- [ ] **Step 4: Run** `npm test` — expect PASS (existing tests that deep-equal the whole response must be updated to include `items`; say which).
- [ ] **Step 5: Commit** `feat: analysis replies carry per-item names and calories`.

---

### Task 4: Meal thumbnails (migration, routes)

**Files:**
- Create: `src/db/migrations/003_food_photos.sql`, `src/routes/foodPhotos.js` (or extend `food.js`), `test/api/food-photos.test.js`
- Modify: `src/app.js` (mount, limits), `src/routes/food.js` (`has_photo` in list rows), `src/lib/schemas.js` if needed, `CLAUDE.md`

**Interfaces:**
- Migration: `CREATE TABLE food_photos (food_log_id INTEGER PRIMARY KEY REFERENCES food_logs(id) ON DELETE CASCADE, bytes BYTEA NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`.
- `PUT /api/food/:id/photo`: auth + CSRF as every state-changing route; raw body `image/jpeg`, limit 120 KB (`express.raw({ type: 'image/jpeg', limit: '130kb' })`, then an explicit check `bytes.length <= 122880`); the bytes must start with the JPEG magic `FF D8 FF` and the pixel size read from the JPEG header must be at most 640 px on each side (reuse `src/lib/image.js`; if it cannot read dimensions, add a small header parser there with its own tests); the meal must belong to the user (`404 NOT_FOUND` otherwise, identical for missing and foreign ids); replaces an existing thumbnail (upsert); returns `{ ok: true }`. Invalid type/magic/dimensions → `400 VALIDATION` with `fields: { photo: 'INVALID' }`; too large → the existing body-too-large mapping of `errors.js` (add it if absent: `413 PAYLOAD_TOO_LARGE`, no body text). Rate limit: `limits.photoPerHour` (default 200 per user).
- `GET /api/food/:id/photo`: auth; owner only (404 otherwise); `Content-Type: image/jpeg`, `Cache-Control: private, max-age=31536000, immutable`.
- `GET /api/food` rows gain `has_photo: boolean` (`EXISTS` on `food_photos`); nothing else in the row changes.

- [ ] **Step 1: Write failing tests:** PUT then GET returns the same bytes and headers; a second PUT replaces; GET for a meal without a photo is 404; another user's meal id → 404 on PUT and GET (same body as a nonexistent id); a PNG body, a 3-byte body, a JPEG header claiming 2000×2000, a 130 KB body → rejected as specified; CSRF headers required; deleting the meal removes the photo (`SELECT count(*) FROM food_photos`); `has_photo` true/false in the list; the rate limit triggers with `limits.photoPerHour: 2`; the migration applies on a database already at version 002 (migrate test pattern) and `resetDb` in `test/helpers/db.js` truncates the new table (add it to the list).
- [ ] **Step 2: Run** `node --test test/api/food-photos.test.js` — expect FAIL.
- [ ] **Step 3: Implement** the migration, routes, limiter, `has_photo`; use a small valid JPEG fixture (a few hundred bytes) built in the test helper.
- [ ] **Step 4: Run** `npm test` — expect PASS; also with `PGOPTIONS='-c timezone=America/New_York' npm test`.
- [ ] **Step 5: Commit** `feat: meal thumbnails (migration, photo routes, has_photo)`.

---

### Task 5: The capybara (decorator, states, walker)

**Files:**
- Modify: `public/js/pet.js`, `public/css/base.css` (state and walker CSS), `public/index.html` (`#capy-tpl` stays as is)
- Test: `test/e2e/walker.spec.js`

**Interfaces:**
- Produces in `pet.js`: `decorateCapybara(svg: SVGSVGElement, opts?: { bowl?: boolean }): SVGSVGElement` — applies, to the clone only: the thin soft outline on the tan shapes (CSS class `pet-inked`, values of spec section 6), the displacement + blur filter (one shared `<filter id="capyink">` in a hidden SVG in `index.html`), soft body/head shading ellipses, faint cheeks, fur ticks, the ground shadow, the corrected smile path (`M 41 59.5 Q 55 66 69 59.5`), the "loaf" legs of the reference (option B1: two large paws with toes replacing the four leg ellipses), and with `bowl: true` the salad bowl in the original colours (extends the viewBox as in the reference). `cloneCapybara(size, opts)` calls it. States and their CSS stay as they are (`pet--happy|ecstatic|sad|sleeping|surprised|thinking`); `getPetState` and `PET_MESSAGES` are untouched.
- `mountWalkingCapybara(pageEl: HTMLElement, { state: string, size: number, bottom: number }): { stop(): void }` — appends the lane `.walker` (absolutely positioned inside the page: `left: 2px`, width up to the red margin line minus 4 px) with the capybara; sets the CSS variable `--span` from the capybara's visible bounding box (`svg.getBBox()` scaled to pixels, not the SVG box) and a negative left margin so the visible body touches the walls; direction flips with `scaleX(-1)` at the wall without a pause; the lane is recomputed on `resize`; `stop()` removes the lane. The animation uses the keyframes of the reference (`walkx`, `flipx`, `capy-walk-bob`) and is disabled by `prefers-reduced-motion` (the capybara then stands still at the left wall). Existing idle animation hooks (`startIdleAnimations`, `stopAllIdleAnimations`) keep working.

- [ ] **Step 1: Write the failing e2e test** `walker.spec.js`: register, open login/stats/weight/settings (the walking screens) and, for each, step the CSS animations to 200 ms steps over one 15 s cycle (`document.getAnimations().forEach(a => a.currentTime = t)`) while measuring the capybara's visible body (bbox × scale) against the page: it never goes beyond the left page edge or the red margin line, and it comes within 6 px of both; with `page.emulateMedia({ reducedMotion: 'reduce' })` the walker has no running animation; at a 320 px viewport the lane still fits.
- [ ] **Step 2: Run** `npx playwright test test/e2e/walker.spec.js` — expect FAIL.
- [ ] **Step 3: Implement** `decorateCapybara`, `mountWalkingCapybara` and the CSS, porting the exact shapes from the reference's script (the `legs`/`soften` functions and the walker code).
- [ ] **Step 4: Run** the spec, `npm run test:e2e`, `npm test` — expect PASS.
- [ ] **Step 5: Commit** `feat: the original capybara in a drawn style and the walking lane`.

---

### Task 6: Tally and receipt renderers

**Files:**
- Create: `public/js/tally.js`, `public/js/receipt.js`, `test/api/tally.test.js`, `test/api/receipt.test.js`

**Interfaces:**
- `tallySvg(count: number, opts?: { width?: number }): string` — an SVG string (no DOM): `0`/negative/NaN → `''`; strokes are drawn in groups of five (four vertical strokes and a diagonal through them) and the remainder; at most 25 strokes are drawn (for larger counts five full groups are drawn and the caller shows the number); each stroke is a slightly curved path with per-stroke jitter derived deterministically from its index (same input → byte-identical output) and is drawn twice (the second faint and offset) with `stroke-linecap: round`; the string contains no event handlers or external references.
- `receiptHtml(r: { items: Array<{ name: string, calories: number }>, calories: number, protein_g: number, carbs_g: number, fat_g: number }): string` — the receipt markup of the reference (no title; item rows with dotted leaders and the item's calories; separator; total with the large number; one macro row in grams; barcode strip), built with the `html` tag so every name is escaped; the server returns at most 8 items, so only when 8 items arrive (nothing can have been dropped with fewer) and the total minus the sum of the shown items' calories is more than 4 kcal (rounding drift of 8 items) the receipt adds one row `ועוד` with that remainder (no count); an empty `items` array renders only the total; no weights anywhere.
- Both modules import nothing that touches the DOM at load time (testable with `node:test`); if `js/dom.js`'s `html` helper cannot be imported in Node, export a DOM-free `escapeHtml` from a new `js/escape.js` used by both `dom.js` and the receipt.

- [ ] **Step 1: Write failing tests:** tally: counts 1, 4, 5, 7, 25, 40 → the expected number of stroke paths (diagonals counted), determinism, `0` → `''`; receipt: a name `<img src=x onerror=alert(1)>` is escaped; 8 items summing more than 4 kcal below the total → a `ועוד` row with the remainder, and no row for fewer than 8 items or for rounding drift; 0 items; numbers rendered as given (`1,142` formatting through `format.js` helpers if they exist); the string has no `weight`/`גרם` next to an item.
- [ ] **Step 2: Run** the two test files — expect FAIL.
- [ ] **Step 3: Implement** both modules, porting the markup and CSS classes from the reference (the CSS goes to `components.css`).
- [ ] **Step 4: Run** `npm test` — expect PASS.
- [ ] **Step 5: Commit** `feat: handwritten tally and receipt renderers`.

---

### Task 7: Welcome and authentication screens

**Files:** Modify `public/index.html` (`#screen-welcome`, `#screen-auth` including the profile step), `public/js/screens/welcome.js`, `auth.js`, `public/css/screens.css`; tests `test/e2e/*` that use these screens.

- Welcome: leather cover, foil "יומן." in `Suez One`, subtitle `יומן האוכל האישי שלך`, the original capybara with the salad bowl (`cloneCapybara(…, { bowl: true })`, happy), the three shortened feature lines with gold line icons (texts of the reference: `צלם את הצלחת. ה-AI מזהה ומחשב`, `קלוריות ומאקרו, הכול במקום אחד`, `גרפים: שבועי, חודשי ושנתי`), the buttons `התחל עכשיו` (`goToAuth` register) and `כבר יש לי חשבון` (`goToAuth` login). Login/registration: handwritten underlined fields, the red ink button (`כניסה`, `הרשמה`), the profile step (`בוא נתחיל`, `#reg-height`, `#reg-birthdate`, `#reg-female-btn`) as handwritten rows and chips, and `mountWalkingCapybara` at the bottom of the auth page. All ids and actions of the hook contract unchanged.

- [ ] **Step 1: Update/extend tests first** (they must fail on the new copy): `smoke.spec.js` and `hebrew-baseline.spec.js` expectations that mention changed welcome text; a new assertion that the welcome screen shows the three feature lines and a capybara `svg.pet-inked`.
- [ ] **Step 2: Run** `npx playwright test test/e2e/smoke.spec.js` — expect FAIL on the new assertions.
- [ ] **Step 3: Implement** markup, CSS and the capybara mounting.
- [ ] **Step 4: Run** `npm run test:e2e` and `npm test` — expect PASS (the Hebrew baseline is re-recorded in Task 15; list failing keys in the report).
- [ ] **Step 5: Commit** `feat: diary welcome cover and login screens`.

---

### Task 8: Home (dashboard)

**Files:** Modify `index.html` (`#screen-dashboard`), `public/js/screens/dashboard.js`, CSS; tests.

- Capybara by `getPetState` (existing logic) with the bubble (`#pet-status-text` inside it, texts from `PET_MESSAGES`), `#pet-name-label` kept; the date title (smaller, to the right of the ribbon); the large handwritten calories eaten (the `eat` block of the reference: number in the digit family, `קק״ל מתוך N`) with the red progress bar; the streak as `tallySvg(streak)` under the text `ברצף כבר N ימים` (singular via `formatDayCount`), the last meal as a polaroid (thumbnail if `has_photo`, else the placeholder plate) with the circled calories, and the last weight line if it exists. Existing data calls stay (`/api/food?date=`, `/api/streak?today=`, profile goal).

- [ ] **Step 1: Write the failing e2e test** (in `smoke.spec.js` or a new `dashboard.spec.js`): after saving one meal, the home screen shows the eaten calories in the large element, the streak area contains `svg` strokes matching the streak (`1`), and `#pet-name-label` is the username.
- [ ] **Step 2-4:** run → implement → `npm run test:e2e`, `npm test` pass.
- [ ] **Step 5: Commit** `feat: diary home screen with tally and capybara`.

---

### Task 9: Diary (day list, week strip, edit, delete)

**Files:** Modify `index.html` (`#screen-home`), `public/js/screens/home.js`, `public/js/dates.js` (week helper), CSS; tests `test/e2e/diary.spec.js` (new).

**Interfaces:**
- `dates.js`: `weekOf(dateStr: string): string[]` — the seven `YYYY-MM-DD` strings of the Sunday–Saturday week containing `dateStr` (pure calendar arithmetic with `addDays`, no time zone).
- The week strip shows the days of `weekOf(state.diaryDate)` with the displayed day circled in red pen; tapping a day sets `state.diaryDate` and reloads; the arrows keep the `changeDay` action (one day) inside `.date-nav` so `#screen-home .date-nav button` stays valid; the ribbon sits below the strip; the date label `#diary-date-label` keeps its text format.
- Each meal row (`.meal-item-row`): thumbnail polaroid (`/api/food/:id/photo` when `has_photo`, else the placeholder plate), the name (`.mir-name`) and the circled calories **beside** the photo (never over it), the time under the photo (never above the name), and the buttons `ערוך` and `מחק` (existing actions `openEditModal`, `deleteEntry`). Names longer than two lines are clamped with an ellipsis. An empty day shows `.empty-state`.

- [ ] **Step 1: Write failing tests:** a node test for `weekOf` (boundaries: a Sunday, a Saturday, year change, leap day) in `test/api/dates.test.js`'s style for the browser module (import by file URL); `diary.spec.js`: three meals appear oldest first; arrows move one day and the strip's circled day follows; tapping another day loads it; delete removes the row; edit still opens the modal; a meal name of 120 Hebrew characters stays inside its column (`getBoundingClientRect` within the page); a day with 20 meals scrolls inside the page and the dock stays visible; the time text sits below the photo (its `y` is greater than the photo's).
- [ ] **Step 2: Run** them — expect FAIL.
- [ ] **Step 3: Implement** markup, CSS and module changes.
- [ ] **Step 4: Run** `npm run test:e2e`, `npm test` — expect PASS.
- [ ] **Step 5: Commit** `feat: diary day page with week strip, thumbnails, edit and delete`.

---

### Task 10: Add meal (camera) and thumbnail capture

**Files:** Create `public/js/photos.js`; modify `index.html` (`#screen-camera`), `public/js/screens/camera.js`, `analysis.js` (the save flow), CSS; tests `test/e2e/add-meal.spec.js`.

**Interfaces:**
- `photos.js`: `makeThumbnail(blob: Blob, opts?: { maxSide?: number, quality?: number }): Promise<Blob | null>` (canvas, JPEG, defaults 480 and 0.7, `null` on any failure and when the result exceeds 110 KB after one retry at quality 0.5); `uploadThumbnail(foodId: number, blob: Blob): Promise<boolean>` (`PUT` with the CSRF headers of `api.js`, never throws, resolves `false` on any failure); `photoSrc(id: number): string` returns `/api/food/${id}/photo`.
- Camera screen: before a photo, one large dashed frame is the button (`data-action="pickImage"`, the whole frame; text `לחץ לצילום` and `או בחר תמונה מהגלריה`, camera line icon), the meal-type chips, the text field (`#food-text-input`) and `#text-analyze-btn`; after a photo, the frame becomes a polaroid with `#preview-img`, a small link `צלם שוב`, and the red ink button `נתח את הצלחת` (`#analyze-btn`, `data-action="analyzeFood"`); the old round red shutter button is removed. The save flow: after `POST /api/food` succeeds, if a photo exists, make the thumbnail and `uploadThumbnail` in the background; the meal is saved and the user navigates on regardless of the upload result.

- [ ] **Step 1: Write failing tests:** `add-meal.spec.js`: the empty frame is clickable and shows both texts; after setting a file on `#file-input` (a small generated JPEG) the polaroid, `צלם שוב` and `נתח את הצלחת` appear and the old shutter is gone; saving uploads a thumbnail (assert the `PUT` request and later an `<img>` in the diary); with the `PUT` route stubbed to fail (`page.route` → 500) the meal is still saved, the diary shows the placeholder and no error toast; with a 3 MB input image the thumbnail is under 120 KB.
- [ ] **Step 2: Run** `npx playwright test test/e2e/add-meal.spec.js` — expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm run test:e2e`, `npm test` — expect PASS.
- [ ] **Step 5: Commit** `feat: add-meal screen and meal thumbnails from the client`.

---

### Task 11: Analysis in progress and the receipt

**Files:** Modify `index.html` (`#screen-analysis`), `public/js/screens/analysis.js`, `camera.js` (the waiting state), CSS; tests `test/e2e/receipt-flow.spec.js`.

- Waiting: the capybara with a magnifier and the bubble `מחשב כמה יש בצלחת…`, a progress bar; no "receipt is ready" text; the bubble and the capybara never overlap.
- Result: the photo polaroid (or none for text analysis), the handwritten dish name (`#res-name` stays an editable input styled as handwriting), the large circled calories (`#res-cal` stays the numeric input), the receipt built by `receiptHtml` from the reply (`items`, totals) inside `#analysis-result`, printed from the top with the slide animation and the `נרשם` stamp at the end, the meal-type chips (`.meal-opt`), `#res-time`, and the buttons `שמור ביומן` (`#save-entry-btn`, existing `saveEntry`) and the existing edit of the meal totals; no per-item edit controls and no grams of components. The macro fields `#res-pro|carb|fat|fiber` keep working as inputs (styled as handwritten rows).

- [ ] **Step 1: Write failing tests:** `receipt-flow.spec.js`: text analysis (fake) → the receipt shows the fake's items with their calories and the total, contains no title text and no `גרם` next to item rows, the stamp appears after the print animation (assert the stamp becomes visible), save still works and the diary then shows the meal; with `reducedMotion: 'reduce'` the receipt is fully visible immediately; a reply whose 8 items sum to more than 4 kcal less than the total shows a `ועוד` row with the remainder calories.
- [ ] **Step 2: Run** — expect FAIL. **Step 3: Implement.**
- [ ] **Step 4: Run** `npm run test:e2e`, `npm test` — expect PASS.
- [ ] **Step 5: Commit** `feat: analysis waiting screen and the printed receipt`.

---

### Task 12: Stats

**Files:** Modify `index.html` (`#screen-stats`), `public/js/screens/stats.js`, `charts.js`, CSS; tests.

- Index tabs at the bottom edge (`.stats-tab` keeps `data-action="switchStats"`; the active tab raised), the headline average in the digit family with `קק״ל ליום, בממוצע`, the hand-drawn bar chart (ink-outlined bars, red for days over the goal, the dashed goal line with the label `יעד N` **above the plot with an arrow**, never over a bar), the day letters, the three macro bars, the monthly and yearly views restyled the same way (ids `#stats-weekly|monthly|yearly`, `#stats-month-label`, `#stats-year-label` unchanged), and `mountWalkingCapybara` above the tabs.

- [ ] **Step 1: Write failing tests:** the goal label's bounding box does not intersect any bar rect's box (computed in the page) in the weekly view with a bar above the goal; the tabs are below the chart (`y` greater than the chart's bottom); all three views open; the walker is present.
- [ ] **Step 2-4:** run → implement → full suites pass. **Step 5: Commit** `feat: diary stats screen with index tabs and hand-drawn charts`.

---

### Task 13: Weight

**Files:** Modify `index.html` (`#screen-weight`), `public/js/screens/weight.js`, `charts.js`, CSS; tests.

- The big weight in the digit family, `ק״ג · יעד N`, the line graph on squared paper (points as circles, the last one red, the goal line dashed), the entries list (`#weight-list .weight-entry` with date and value), the input row (`#weight-val`, button `הוסף שקילה`, `data-action="addWeightLog"`), the walking capybara. A single entry, an entry of 100.5 kg and an empty list render correctly.

- [ ] **Step 1: Write failing tests:** adding a weight shows it first in the list in the digit family; the graph renders with 0, 1 and 30 points without NaN attributes in the SVG; a value of 100.5 and a goal of 10,000 kcal elsewhere do not overflow their rows (bounding boxes inside the page).
- [ ] **Step 2-4:** run → implement → pass. **Step 5: Commit** `feat: diary weight screen`.

---

### Task 14: Settings and the modals

**Files:** Modify `index.html` (`#screen-settings`, `#modal-profile`, `#modal-change-pass`, `#edit-modal`), `public/js/screens/settings.js`, `home.js` (edit modal), CSS; tests.

- Settings: handwritten rows (`#settings-user`, height, goal weight, calorie goal, `שינוי סיסמה`, red `התנתקות` with its existing actions), the walking capybara. The three modals become taped paper slips on a dimmed page with handwritten fields and red ink buttons; every id and button name of the hook contract (`שמור` exact, `חשב מחדש` exact, `שמור מבלי לחשב מחדש`, `#cp-error`) is kept; no per-item weight field exists anywhere.

- [ ] **Step 1: Write failing tests:** every text on the settings screen containing digits uses the digit family (extend the Task 2 walker over `#screen-settings`); the modals open and close; change-password error text appears in `#cp-error`; the edit modal's buttons keep their accessible names.
- [ ] **Step 2-4:** run → implement → pass. **Step 5: Commit** `feat: diary settings screen and paper modals`.

---

### Task 15: Polish, installability, cleanup, Hebrew regeneration

**Files:** Modify `public/manifest.json`, `src/lib/icon.js` (+ its test), `public/css/*`, remove the old Latin-only fonts and their licences and the dead CSS of the old theme, `test/e2e/__snapshots__/he-text.json`, `docs/hebrew-copy-audit.md`, `CLAUDE.md`.

- Manifest `theme_color` and `background_color` become the leather colour; `buildIcon` also produces 192 px and 512 px PNG icons (plus a maskable 512) from the capybara icon and the manifest lists them; the page-weight and font-size limits of the spec are asserted (`frontend-fonts.test.js`: after removal, all referenced fonts ≤ 300 KB; add a test that no CSS rule references a removed font family).
- Regenerate the copy audit (`node scripts/extract-hebrew-text.js`), run the spelling guard, and re-record the baseline snapshot (`UPDATE_SNAPSHOT=1 npm run test:e2e -- hebrew-baseline`) with a per-key old → new list in the report: every change must be a new/changed string of spec section 5 or a data value; any other copy change is a defect to report instead of recording.
- Update `CLAUDE.md` (frontend modules, fonts, `items`, photos, the walking capybara, the digit font rule).

- [ ] **Step 1: Write failing tests:** the manifest lists 192 and 512 PNG icons that exist (fetch them from the test app and check the PNG signature and sizes); `frontend-fonts.test.js` updated as above; the full-screen digit test of `fonts.spec.js` extended to every screen.
- [ ] **Step 2: Run** — expect FAIL. **Step 3: Implement** the items above.
- [ ] **Step 4: Run** `npm test`, `npm run test:e2e` (also with `PGOPTIONS='-c timezone=America/New_York'`), `npm audit --omit=dev` — expect all clean.
- [ ] **Step 5: Commit** `chore: installable icons, cleanup of the old theme, regenerated Hebrew audit`.

---

### Task 16: Preview for the owner (controller)

- Run the app locally against the test database with seed data (a script `scripts/seed-preview.js` is allowed, git-ignored data), take Playwright screenshots of every screen at 390×844 and at 320×640, and send them to the owner with a list of what differs from the reference. Fix what the owner flags (small follow-up tasks), then the final whole-branch review and the pull request.
