# Food Logger Overhaul — Foundation & Security Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the food-logger server and frontend into tested modules, replace localStorage bearer tokens with revocable HttpOnly cookie sessions, and add CSRF protection, a strict CSP, schema validation on every route and an automated test suite, with no visible change to the app.

**Architecture:** `server.js` becomes a bootstrap; app code moves to `food-logger/src/` behind `createApp({ config, pool, anthropic, icon, limits })` so tests inject a test pool and a fake Anthropic client. The frontend becomes native ES modules under `public/js/` (no build step). Work is ordered so every task ends with a green suite: server moves first, frontend moves second (both behaviour-preserving, guarded by API and browser tests written against the *current* behaviour), then hardening changes are made with server and client together.

**Tech Stack:** Node 24, Express 4, PostgreSQL 17 (`pg`), `zod`, `helmet`, `cookie-parser`, `bcryptjs`, `jsonwebtoken`, `express-rate-limit`; tests: `node --test`, `supertest`, `@playwright/test`.

**Spec:** `docs/superpowers/specs/2026-09-29-foundation-security-design.md` (read it first; section numbers below refer to it). All paths are relative to `food-logger/` unless they start with `docs/`.

## Global Constraints

- Frontend stays native ES modules, **no build step**; Railway keeps deploying with `node server.js`.
- **No paid services**; Anthropic is mocked in every test. Model id and prompts stay exactly as in `server.js` (moved verbatim).
- Look and behaviour stay **identical**: same screens, same Hebrew strings, same requests. Visual work is sub-project 4; Hebrew/English work is sub-project 2.
- Tests run on local PostgreSQL 17, database `foodlogger_test`; test helpers refuse to run against any database whose name does not end in `_test`.
- Cookie `fl_session`: `HttpOnly`, `SameSite=Strict`, `Path=/`, `Secure` only when `NODE_ENV=production`, 7 days; JWT HS256 with the algorithm pinned on verify; payload `{ id, tv }`.
- CSRF on every non-GET/HEAD request: `Origin` (Referer fallback) must equal `config.origin`, and header `X-FL-Client: 1` is required; otherwise `403 CSRF`. `cors()` is removed.
- Passwords: 8 to 72 bytes UTF-8 when set (`WEAK_PASSWORD`, `PASSWORD_TOO_LONG`); bcrypt cost 12; login rehashes lower-cost hashes; existing short passwords still log in.
- Login limits: 10/min per IP and 10 failed attempts per 15 min per username. Analyze limit: 20/hour keyed by user id.
- Error body: `{ "error": { "code": "<CODE>" } }`, plus `"fields": { "<name>": "<CODE>" }` for validation. No human-language text from the server. Codes: `UNAUTHORIZED`, `SESSION_EXPIRED`, `CSRF`, `VALIDATION`, `INVALID_CREDENTIALS`, `USERNAME_TAKEN`, `WEAK_PASSWORD`, `PASSWORD_TOO_LONG`, `RATE_LIMITED`, `NOT_FOUND`, `IMAGE_INVALID`, `AI_UNAVAILABLE`, `INTERNAL` (this plan adds `WRONG_CURRENT_PASSWORD`).
- Body limits 100 KB, and 8 MB on `POST /api/analyze` only. `weight_kg` 20–500. Calories 0–99,999; macros 0–9,999. Food name ≤ 200, analyze text ≤ 500.
- CSP exactly: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`. Also HSTS in production, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, `Permissions-Policy` allowing only `camera=(self)`.
- No server file over ~250 lines and no frontend module over ~500 lines.
- New runtime deps: `helmet`, `zod`, `cookie-parser`. Dev only: `supertest`, `@playwright/test`. `cors` removed.
- `git commit` after every task, conventional-commit style.

## Deliberate behaviour changes (everything else must be identical)

1. Out-of-range numbers on food routes are rejected with 400 instead of stored as `NULL` (spec 4.5). Missing/`null`/`""` still store `NULL`.
2. Password minimum becomes 8 (client message text updated to say 8). New `WEAK_PASSWORD` / `PASSWORD_TOO_LONG` Hebrew strings are added.
3. `POST /api/food` now trims `food_name` like `PUT` already does; usernames are trimmed server-side (the client already trims).
4. One forced re-login on deploy (Bearer tokens stop working).
5. Wrong current password on change-password no longer logs the user out (the old client logged out on any 401 while holding a token; the new client logs out only on `UNAUTHORIZED`/`SESSION_EXPIRED`).
6. Password change re-issues a fresh cookie for the current device and revokes all others.

## Review Focus

Inputs the spec implies but its listed tests do not cover, most likely first. Each has a test in the named task.

1. A valid-looking session cookie for a user who no longer exists, a garbage cookie, an `alg:none` token and a token signed with another secret must all give `401 SESSION_EXPIRED`, never `500` (Task 11).
2. Wrong-typed or hostile JSON: `password: 12345`, `username: ["x"]`, `null` bodies, and strings containing `\u0000` (PostgreSQL rejects NUL and currently turns it into a 500) must give `400 VALIDATION` on auth and food routes (Task 8).
3. Two simultaneous registrations of the same username (including `Dar` vs `dar`): exactly one succeeds, the other is `409 USERNAME_TAKEN`, never a 500 (Task 9).
4. `PUT /api/profile` with an array body, a string body, or a `__proto__` key: `400 VALIDATION` or silently ignored, never a crash or prototype pollution (Task 8).
5. A brand-new account with no data gets empty arrays / zero streak (not 500) from every read route, and an Anthropic reply that is not JSON gives `502 AI_UNAVAILABLE` with no upstream text in the body (Tasks 4 and 8).

## File Map

Server layout is spec section 3 with these additions: `src/lib/schemas.js` (shared zod primitives), `src/lib/image.js` (magic-byte detection), `src/lib/dates.js` (real-calendar check), `src/lib/analysis.js` (the moved analyze logic and prompts, so route files stay small), and `test/` (helpers, api, e2e). Frontend layout is spec section 5 with these additions: `js/events.js` (delegation), `js/router.js`, `js/profile.js`, `js/effects.js`, `js/pet.js`, `js/charts.js`.

---

### Task 1: Branch and configuration

**Files:**
- Create: `src/config.js`, `test/api/config.test.js`, `.env.example` (update)
- Modify: `package.json` (scripts), `../.gitignore` or `.gitignore` (add `test-results/`, `playwright-report/`)

**Interfaces:**
- Produces: `loadConfig(env = process.env): Config` returning a frozen object `{ databaseUrl, jwtSecret, anthropicApiKey, origin, port, nodeEnv, trustProxy, databaseCa, isProd }`; throws `Error` whose message lists every invalid variable. Rules exactly as spec 3.1; `nodeEnv` defaults to `development` and must be one of `development|test|production`; `port` and `trustProxy` are numbers.

- [ ] **Step 1:** From `main`, create the branch: `git checkout -b overhaul`. Add `"test": "node --test --test-concurrency=1 \"test/api/**/*.test.js\""` and `"test:e2e": "playwright test"` to `package.json` scripts (the e2e script is used from Task 5).
- [ ] **Step 2: Write failing tests** in `test/api/config.test.js` using `node:test`: JWT_SECRET of 31 chars throws and the message names `JWT_SECRET`; missing `DATABASE_URL` throws; `NODE_ENV=production` without `ORIGIN` or without `ANTHROPIC_API_KEY` throws; `NODE_ENV=test` without `ANTHROPIC_API_KEY` is valid; defaults: `port === 3000`, `origin === 'http://localhost:3000'` outside production, `trustProxy === 1` in production and `0` otherwise, explicit `TRUST_PROXY=2` wins; result is frozen; multiple problems are all reported in one error.
- [ ] **Step 3:** Run `npm test`; expected FAIL (module missing).
- [ ] **Step 4:** Implement `loadConfig` in `src/config.js`. Update `.env.example` to list every variable in spec 3.1 (add `ORIGIN`, `TRUST_PROXY`, `DATABASE_CA`, `TEST_DATABASE_URL`) with comments.
- [ ] **Step 5:** Run `npm test`; expected PASS.
- [ ] **Step 6:** Commit `feat: validated config module`.

---

### Task 2: Pool, migrations and test database helper

**Files:**
- Create: `src/db/pool.js`, `src/db/migrate.js`, `src/db/migrations/001_baseline.sql`, `src/db/migrations/002_token_version.sql`, `test/helpers/db.js`, `test/fixtures/legacy-schema.sql`, `test/api/migrate.test.js`

**Interfaces:**
- Consumes: `Config` from Task 1.
- Produces: `createPool(config): Pool` (TLS per spec 3.2: `false` outside production; in production `{ ca }` when `databaseCa` is set, otherwise `{ rejectUnauthorized: false }` and a `console.warn` saying verification is off); `migrate(pool): Promise<string[]>` returning the versions applied in this call; test helpers `createTestPool(): Promise<Pool>` (creates `foodlogger_test` if missing by connecting to the `postgres` database, using `TEST_DATABASE_URL` or `DATABASE_URL` with the database name replaced; throws if the name does not end in `_test`) and `resetDb(pool): Promise<void>` (`TRUNCATE users, food_logs, weight_logs, user_profiles RESTART IDENTITY CASCADE`).

- [ ] **Step 1:** Write `001_baseline.sql` as the exact schema from `initDB()` in `server.js:134-167` (already `IF NOT EXISTS`). Write `002_token_version.sql` as `ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0`. Copy the same baseline SQL into `test/fixtures/legacy-schema.sql` (represents a database created by the old code, without `schema_migrations`).
- [ ] **Step 2: Write failing tests** in `test/api/migrate.test.js`: on a dropped-and-recreated `public` schema `migrate` returns `['001_baseline','002_token_version']` and creates `schema_migrations`; running it again returns `[]`; after loading `legacy-schema.sql` and inserting a user row, `migrate` succeeds, keeps the row, and the resulting column list (`information_schema.columns`) and index list (`pg_indexes`) equal those of the fresh database; `users.token_version` defaults to `0`. A `sslOptions`-style test for `createPool` is not needed; assert TLS only through a small exported pure function `sslConfig(config)` returning `false | { rejectUnauthorized:false } | { ca }` and test its three cases.
- [ ] **Step 3:** Run `npm test`; expected FAIL.
- [ ] **Step 4:** Implement `migrate` (files sorted by name, each applied in its own transaction and recorded in `schema_migrations(version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT NOW())`), `createPool`, `sslConfig` and the helpers.
- [ ] **Step 5:** Run `npm test`; expected PASS.
- [ ] **Step 6:** Commit `feat: migration runner, baseline and token_version migrations`.

---

### Task 3: App skeleton with auth, food, weight and profile routes moved

**Files:**
- Create: `src/app.js`, `src/routes/auth.js`, `src/routes/food.js`, `src/routes/weight.js`, `src/routes/profile.js`, `src/middleware/auth.js`, `test/helpers/app.js`, `test/api/auth.test.js`, `test/api/food.test.js`, `test/api/weight.test.js`, `test/api/profile.test.js`
- Modify: `package.json` (`npm i -D supertest`)

**Interfaces:**
- Consumes: `createTestPool`, `resetDb`, `migrate`.
- Produces: `createApp({ config, pool, anthropic, icon = null, limits = {} }): express.Application` (never calls `listen`); each route module exports `(deps: { pool, anthropic, config, auth }) => express.Router()`; `createAuth({ pool, config }): RequestHandler` setting `req.user = { id, username }`. `test/helpers/app.js` exports `buildTestApp(overrides = {}): Promise<{ app, pool, config, anthropic }>` (test config: `nodeEnv:'test'`, 32+ char secret, `origin:'http://localhost:3000'`) and `signedIn(app, username = 'alice'): Promise<Client>` where `Client` has `get/post/put/delete(path, body?)` returning supertest responses with credentials attached. **In this task credentials are the old Bearer token; Task 11 changes only this helper.**

- [ ] **Step 1: Characterization tests first** (they describe today's behaviour and must pass against moved code). `auth.test.js`: register returns `{ token, username }` with username lowercased; duplicate → 409; login wrong password → 401; login success returns token; change-password with wrong current → 401 and with right current → `{ ok: true }` then login with the new password works. `food.test.js`: POST returns the inserted row (all columns, numbers rounded to 1 decimal); `GET /api/food?date=` returns only that day ascending, without `date` returns newest first; PUT updates and returns the row; PUT/DELETE of another user's entry → 404; DELETE own → `{ ok:true }`. `weight.test.js`: POST → `{ id, logged_at, weight_kg }`, GET ascending, DELETE own ok and other user's 404. `profile.test.js`: PUT keeps only `gender,birthDate,height,weight,activity,goalKg`; GET returns them; GET with no row returns `{}`.
- [ ] **Step 2:** Run `npm test`; expected FAIL (nothing exists yet).
- [ ] **Step 3:** Implement by **moving** the handlers and SQL from `server.js` (auth 190-239, food 416-498, weight 622-653, profile 592-619, auth middleware 172-181) into the files above without changing logic, messages or status codes. `createApp` wires `express.json({ limit: '15mb' })`, `cors`, the routers under the same paths, and `express.static(public)` exactly as today. Leave `server.js` untouched in this task.
- [ ] **Step 4:** Run `npm test`; expected PASS. Run `git diff --color-moved=zebra --no-index server.js src/routes/food.js` style comparisons for each moved handler to confirm the bodies are unchanged.
- [ ] **Step 5:** Commit `refactor: extract auth, food, weight, profile routes into src/`.

---

### Task 4: Analyze, stats, streak, icon moved; `server.js` becomes bootstrap

**Files:**
- Create: `src/routes/analyze.js`, `src/routes/stats.js`, `src/routes/streak.js`, `src/lib/analysis.js`, `src/lib/anthropic.js`, `src/lib/icon.js`, `test/helpers/fakeAnthropic.js`, `test/api/analyze.test.js`, `test/api/stats.test.js`, `test/api/emptyAccount.test.js`
- Modify: `server.js` (reduce to bootstrap), `src/app.js`

**Interfaces:**
- Produces: `createAnthropic(config): Anthropic`; `MODEL = 'claude-haiku-4-5-20251001'`; in `analysis.js`: `IMAGE_SYSTEM_PROMPT`, `TEXT_SYSTEM_PROMPT` (verbatim strings), `analyzeImage(anthropic, { imageBase64, mimeType }): Promise<{ foodName, calories, protein_g, carbs_g, fat_g, fiber_g }>`, `analyzeText(anthropic, text): Promise<same>`, `ensureHebrewFoodName(anthropic, name): Promise<string>`; `buildIcon(publicDir): Buffer | null` (moved as-is including writing `apple-touch-icon.png`); `fakeAnthropic(): { messages: { create(args): Promise<{ content: [{ text }] }> } , calls: [] }` returning an object-JSON for image requests (array-typed `content`), an array-JSON for text requests, and `'סלט'` for the translator system prompt, and recording every call.
- `server.js` becomes: `dotenv` → `loadConfig` → `createPool` → `migrate` → `createAnthropic` → `buildIcon` → `createApp` → `listen`; on failure log and `process.exit(1)`.

- [ ] **Step 1: Characterization tests.** `analyze.test.js`: `POST /api/analyze` with a tiny valid base64 JPEG returns `{ foodName, calories, protein_g, carbs_g, fat_g, fiber_g }` summed from the fake's items and item names stripped to Hebrew characters; the fake received `model: MODEL` and the verbatim `IMAGE_SYSTEM_PROMPT`; `POST /api/analyze-text` with `"salad"` returns the translated name `סלט` (ensureHebrewFoodName path) and with a Hebrew text returns it unchanged; both without auth → 401. `stats.test.js`: seed entries via `POST /api/food`, then weekly (with and without `start`), monthly (with and without `month`) and yearly return the same row shapes as today (`day`/`month`, summed macros, `day_count` on yearly); `GET /api/streak` after logging an entry on Israel-today (compute the date with the same `toLocaleString('sv', { timeZone: 'Asia/Jerusalem' })` expression the route uses, at 12:00:00Z) returns `{ streak: 1, lastLogDate }`. `emptyAccount.test.js` (Review Focus 5): a fresh user gets `[]` from food, weight, weekly, monthly, yearly, `{}` from profile and `{ streak: 0, lastLogDate: null }` from streak, all 200.
- [ ] **Step 2:** Run `npm test`; expected FAIL.
- [ ] **Step 3:** Move the code (server.js 10-108, 241-413, 500-589, 655-680, 682-685) without changing logic or prompt text. Remove the moved code from `server.js`.
- [ ] **Step 4:** Run `npm test`; expected PASS. Verify prompts are byte-identical: `git show main:food-logger/server.js` vs `src/lib/analysis.js` compared with `git diff --color-moved=zebra`. Start the app (`npm run dev` with your local `.env`) and open `http://localhost:3000`: it must behave as before (login still works with existing accounts).
- [ ] **Step 5:** Commit `refactor: extract analyze, stats, streak, icon; server.js is bootstrap only`.

---

### Task 5: Browser test harness and baseline smoke test

**Files:**
- Create: `playwright.config.js`, `test/e2e/server.js`, `test/e2e/helpers.js`, `test/e2e/smoke.spec.js`
- Modify: `package.json` (`npm i -D @playwright/test`; `npx playwright install chromium`)

**Interfaces:**
- Produces: `test/e2e/server.js` boots `createApp` on port 3100 with the test database, `origin:'http://localhost:3100'`, `fakeAnthropic()`, and `limits` raised so registrations are never throttled; `attachGuards(page): { errors: string[], csp: string[] }` collecting `pageerror`, `console.error` messages and `securitypolicyviolation` events (installed with `page.addInitScript`); `expectNoGuardEvents(guards)`.

- [ ] **Step 1:** `playwright.config.js`: `webServer` runs `node test/e2e/server.js`, `baseURL http://localhost:3100`, one worker, Chromium only, mobile viewport (390×844).
- [ ] **Step 2: Write `smoke.spec.js` test `full user journey`** against the *current* frontend: register (welcome → register → profile step skipped or filled) → dashboard → add food by text (fake analysis) → save → see it in the diary (`home` screen) → edit name → delete → open weekly, monthly, yearly stats → add and delete a weight → settings → change password → logout → log in with the new password. Use the existing element ids in `index.html` as selectors. Finish with `expectNoGuardEvents`. If the baseline emits console errors (for example blocked external fonts), record them in an allow-list with a comment `// baseline, removed in Task 13/14` rather than hiding them.
- [ ] **Step 3:** Run `npm run test:e2e`; expected PASS against the untouched frontend.
- [ ] **Step 4:** Commit `test: playwright harness and baseline smoke journey`.

---

### Task 6: Frontend, extract CSS and script into files (moves only)

**Files:**
- Create: `public/css/tokens.css`, `public/css/base.css`, `public/css/components.css`, `public/css/screens.css`, `public/js/app.js`
- Modify: `public/index.html`

**Interfaces:**
- Produces: `index.html` containing only markup, four `<link rel="stylesheet">` tags (in the order needed to preserve the cascade) and `<script type="module" src="/js/app.js"></script>`. The Google Fonts links stay for now (Task 13). `app.js` is the old script verbatim plus, at its end, `Object.assign(window, { ...every function name referenced by an inline onclick/onchange attribute })` as a **temporary bridge** so the inline handlers keep working under module scope (removed in Task 12).

- [ ] **Step 1:** Split `<style>` (index.html lines 19–2166) by section comments: `:root` variables → `tokens.css`; resets/typography/layout → `base.css`; shared components (buttons, modals, receipt rows, badges) → `components.css`; per-screen rules → `screens.css`. Move `<script>` (lines 2836–4732) to `js/app.js`. The bridge list is generated with `grep -o 'on\(click\|change\)="[A-Za-z_]*' public/index.html`.
- [ ] **Step 2:** Run `npm run test:e2e`; expected PASS (same allow-list). Open the app once and compare each screen against `main` by eye for stray unstyled elements (cascade order).
- [ ] **Step 3:** Commit `refactor: move CSS and script out of index.html`.

---

### Task 7: Frontend, split `app.js` into modules (moves only)

**Files:**
- Create under `public/js/`: `main.js`, `state.js`, `dates.js`, `format.js`, `profile.js`, `dom.js`, `api.js`, `session.js`, `errors.js` (empty table for now), `router.js`, `pet.js`, `effects.js`, `charts.js`, `screens/{welcome,auth,dashboard,home,camera,analysis,stats,weight,settings}.js`
- Delete: `public/js/app.js`
- Modify: `public/index.html` (`src="/js/main.js"`)

**Interfaces (function → module, from the current line numbers in `app.js` origin; grep callers before moving each and adjust if a function is used elsewhere):**
- `state.js`: `export const state = { currentScreen, diaryDate, statsMonth, statsYear, currentStatsTab, selectedMeal, capturedImageBase64, capturedMime, userProfile, weightLogs, username, pendingRegUser, pendingRegPass, regGender, regActivity, regGoalKg, mpGender, mpActivity, mpGoalKg }` (initial values as in lines 2842–2863, except `token`/`pendingToken`/`pendingUsername`, which stay in `session.js`/`auth.js` until Task 11). Every former global read/write becomes `state.x`. Screen-private state (`_editEntryId`, `_mealEntries`, `_placeholderIv`, pet wraps, fire/confetti/walk handles) stays module-local.
- `dates.js`: `todayStr, formatDate, formatMonth, addDays, addMonths, formatDateShort`. `format.js`: `MEAL_LABELS, MEAL_BADGE, FOOD_EMOJI_MAP, getFoodEmoji`. `profile.js`: `loadProfile, profileAge, calcRecommendedCal`. `dom.js`: `escapeHtml, openModal, closeModal, showToast`. `api.js`: `apiFetch`, unchanged behaviour. `session.js`: `setLoggedIn, doLogout`.
- `router.js`: `SCREEN_ORDER`, `navigate(screen)`, `registerScreen(name, { enter, leave })`. `navigate` keeps today's behaviour, but the per-screen calls (`loadDashboard`, `loadDiary`, `loadStats`, `stopFireCanvas`, `stopStatsCapyWalk`, `animatePlaceholder`, `_cameraCapyState`, `stopIdleAnimations`) move into hooks registered from `main.js`, so `router.js` imports no screen module.
- `pet.js`: the capybara/pet block (`startIdleAnimations`, `stopIdleAnimations`, `_cameraCapyState`, `cloneCapybara`, `getPetState`, `PET_MESSAGES`, `setPetState`). `effects.js`: `animateCountUp`, `startFireCanvas`, `stopFireCanvas`, `spawnConfetti`. `charts.js`: `renderLineChart`, `renderPlate`, `renderMacroProgressBars`, `renderStatAvgBox`, `renderStatMacros`.
- Screens: `auth.js` (tab switching, `doLogin`, `doRegister`, `setReg*`, `saveRegProfile`, `skipRegProfile`, `finishLogin`), `dashboard.js` (`renderDashLogPreview`, `animateDashStagger`, `loadDashboard`), `home.js` (diary: `changeDay`, `loadDiary`, `renderMealList`, `getDiaryPetState`, `renderDailySummary`, `deleteEntry`, edit modal functions), `camera.js` (`onImageSelected`, `analyzeText`, `analyzeFood`, `animatePlaceholder`, `autoResizeTextarea`), `analysis.js` (`selectMeal`, `saveEntry`), `stats.js` (stats tabs, weekly/monthly/yearly loaders, capy walk), `weight.js`, `settings.js` (`doChangePassword`, profile modal, `populateProfileSelects`, `updateSettingsProfileSub`), `welcome.js` (`goToAuth` if it is only used there, otherwise `auth.js`).
- `main.js`: imports everything, registers screens, keeps the temporary `window` bridge (all handler names), runs the old init block (the last lines of the old script: `populateProfileSelects()`, `loadProfile()`, the token check, and the four `addEventListener` calls) unchanged.

- [ ] **Step 1:** Move functions in this order, running `npm run test:e2e` after each group and committing when green: (a) `state/dates/format/profile/dom/api` helpers, (b) `router/session/pet/effects/charts`, (c) screens one at a time, smallest first (`weight`, `analysis`, `camera`, `settings`, `stats`, `dashboard`, `home`, `auth`).
- [ ] **Step 2:** Confirm no module exceeds ~500 lines (`wc -l public/js/**/*.js`) and there are no circular imports: `npx madge --circular public/js` (run via `npx`, not installed).
- [ ] **Step 3:** Run `npm run test:e2e`; expected PASS. Commit `refactor: split frontend script into ES modules`.

---

### Task 8: Error contract, validation, body limits, image checks

**Files:**
- Create: `src/middleware/errors.js`, `src/middleware/validate.js`, `src/lib/schemas.js`, `src/lib/dates.js`, `src/lib/image.js`, `test/api/validation.test.js`, `test/api/errors.test.js`, `test/api/image.test.js`, `test/api/dates.test.js`
- Modify: every file in `src/routes/`, `src/middleware/auth.js`, `src/app.js`, `public/js/api.js`, `public/js/errors.js`, `public/js/session.js`, all `catch` sites that show `e.message`
- Modify: `package.json` (`npm i zod`)

**Interfaces:**
- Produces: `class AppError extends Error { constructor(status, code, fields?) }`; `asyncHandler(fn): RequestHandler`; `errorHandler: ErrorRequestHandler` (an `AppError` → its status and body; body-parser `entity.too.large` and `entity.parse.failed` → `400 VALIDATION`; anything else → `500 INTERNAL`, logged with `req.id`, body never contains the original message); a request-id middleware setting `req.id = crypto.randomUUID()` and header `X-Request-Id`. `validate({ body?, params?, query? }): RequestHandler` parses with zod and sets `req.valid = { body, params, query }`; failure throws `AppError(400,'VALIDATION', fields)` where each field code is `REQUIRED` (missing/undefined), `TOO_LONG` (over max), otherwise `INVALID`. `isRealDate(str): boolean` and `isRealMonth`; `detectImageType(buf): 'image/jpeg'|'image/png'|'image/gif'|'image/webp'|null` (magic bytes: `FF D8 FF`; `89 50 4E 47 0D 0A 1A 0A`; `GIF87a`/`GIF89a`; `RIFF....WEBP`). `schemas.js` exports `id`, `dateStr`, `monthStr`, `yearStr` (2000–2100), `mealType`, `loggedAt` (`YYYY-MM-DDTHH:mm[:ss[.fff]]` with optional `Z` or `±HH:MM`, real calendar, hour < 24, minute < 60), `nullableNumber(max)` (missing/`null`/`""` → `null`, else 0..max rounded to 1 decimal, out of range → `INVALID`), `foodName` (trimmed, 1..200), `noNul` (rejects `\u0000` in every string).
- Client: `errors.js` exports `messageFor(err: ApiError): string` using a table keyed by `code` or `"field:FIELDCODE"` that holds the **existing Hebrew strings** (e.g. `food_name:REQUIRED` → `שם האוכל חסר`, `food_name:TOO_LONG` → `שם האוכל ארוך מדי (מקסימום 200 תווים)`, `meal_type:INVALID` → `סוג ארוחה לא תקין`, `weight_kg:INVALID` → `משקל לא תקין`, `text:TOO_LONG` → `תיאור ארוך מדי (מקסימום 500 תווים)`, `INVALID_CREDENTIALS` → `שם משתמש או סיסמא שגויים`, `WRONG_CURRENT_PASSWORD` → `סיסמא נוכחית שגויה`, `USERNAME_TAKEN` → `שם המשתמש כבר קיים`, `NOT_FOUND` → `לא נמצא`, `AI_UNAVAILABLE` → `לא ניתן לנתח את תגובת ה-AI`, `INTERNAL` → `שגיאת שרת`, `RATE_LIMITED`, `CSRF`, `VALIDATION` fallback, `IMAGE_INVALID`) plus new strings for `WEAK_PASSWORD` and `PASSWORD_TOO_LONG`. `apiFetch` throws `ApiError { status, code, fields }`; an exported `setUnauthorizedHandler(fn)` is called for `UNAUTHORIZED`/`SESSION_EXPIRED` only; every `e.message` display becomes `messageFor(e)`.

- [ ] **Step 1: Write failing tests.** `dates.test.js`: `2026-02-31`, `2026-13-01`, `2026-1-1` rejected; `2024-02-29` accepted. `image.test.js`: one real minimal file per type detected; a PNG declared as `image/jpeg` is detected as png; random bytes → `null`. `errors.test.js`: unknown thrown error → `500 { error: { code: 'INTERNAL' } }` with no message text and an `X-Request-Id` header; malformed JSON body → `400 VALIDATION`; body over 100 KB on `/api/food` → 400; body of 2 MB (valid image) accepted on `/api/analyze`. `validation.test.js` is table-driven (route, payload, expected fields) covering: food POST/PUT with bad `logged_at`, `2026-02-31T10:00`, unknown/missing `meal_type`, negative and over-range numbers, numeric strings, `food_name` of 201 chars or `"a\u0000b"`; GET food/stats with bad `date`/`start`/`month`/`year`; `:id` of `abc`, `0`, `-1`; weight `19.9`, `500.1`, `"x"`; analyze-text of 501 chars and of `12345`; `POST /auth/login` and `/auth/register` with `password: 12345`, `username: ["x"]`, `null` body, `"a\u0000b"` (Review Focus 2); `PUT /api/profile` with body `[]`, `"str"` and `{"__proto__":{"x":1}}` (Review Focus 4, verify `({}).x === undefined` afterwards); analyze with base64 of bytes that are not an image → `400 IMAGE_INVALID`; fake Anthropic returning non-JSON text → `502 AI_UNAVAILABLE` with body free of the fake's text (Review Focus 5). Every case asserts the status is 400 (or 502) and never 500.
- [ ] **Step 2:** Run `npm test`; expected FAIL.
- [ ] **Step 3:** Implement. Wrap every handler in `asyncHandler`; replace inline `res.status(...).json({ error: 'Hebrew text' })` with thrown `AppError`s (`NOT_FOUND` 404, `USERNAME_TAKEN` 409 for pg error `23505`, `INVALID_CREDENTIALS` 401, `WRONG_CURRENT_PASSWORD` 401, `AI_UNAVAILABLE` 502). Apply the body limits (`app.use('/api/analyze', express.json({ limit: '8mb' }))` before the global `express.json({ limit: '100kb' })`, which skips already-parsed bodies). `analyze` decodes the base64, checks `detectImageType`, and sends the *detected* type to Anthropic. Keep existing SQL and business logic. Profile: allow-listed keys with per-key checks (derive enums such as `activity` and ranges from the `<select>` options in `populateProfileSelects` and the profile markup; be permissive on ranges, strict on types).
- [ ] **Step 4:** Update `messageFor` usage and the unauthorized handler on the client. Update the existing characterization tests only where the error body shape changed.
- [ ] **Step 5:** Run `npm test` and `npm run test:e2e`; expected PASS.
- [ ] **Step 6:** Commit `feat: error contract, zod validation, body limits, image magic-byte check`.

---

### Task 9: Passwords

**Files:**
- Create: `src/lib/passwords.js`, `test/api/passwords.test.js`
- Modify: `src/routes/auth.js`, `public/js/screens/auth.js` (client minimum 8), `public/js/errors.js`

**Interfaces:**
- Produces: `COST = 12`; `validateNewPassword(pw: string): void` (throws `AppError(400,'WEAK_PASSWORD')` if fewer than 8 characters, `AppError(400,'PASSWORD_TOO_LONG')` if `Buffer.byteLength(pw,'utf8') > 72`); `hashPassword(pw, cost = COST): Promise<string>`; `verifyPassword(pw, hash): Promise<boolean>`; `needsRehash(hash): boolean` (`bcrypt.getRounds(hash) < COST`); `DUMMY_HASH` computed at `COST` for timing parity.

- [ ] **Step 1: Write failing tests:** 7-character password rejected on register and on change-password (`WEAK_PASSWORD`); 8 accepted; 72 ASCII bytes accepted; 73 bytes rejected (`PASSWORD_TOO_LONG`); 25 Hebrew letters (50 bytes) accepted while 37 Hebrew letters (74 bytes) rejected, proving bytes not characters are counted; a new hash starts with `$2a$12$` or `$2b$12$`; a user inserted directly with a cost-10 hash logs in with a 5-character password (existing accounts keep working) and afterwards has a cost-12 hash in the database; login for an unknown user still calls `verifyPassword` (spy or timing-free assertion via a counter on the exported function); **two simultaneous `POST /auth/register` with `Dar`/`dar` (`Promise.all`) → exactly one 200 and one `409 USERNAME_TAKEN`, no 500** (Review Focus 3).
- [ ] **Step 2:** Run `npm test`; expected FAIL.
- [ ] **Step 3:** Implement; register, login (rehash after success) and change-password use the module. Client: `doRegister` checks `p.length < 8` and its message becomes `שם משתמש חייב להכיל 3–50 תווים, סיסמא לפחות 8`; the change-password modal text that mentions the minimum, if any, is updated to 8.
- [ ] **Step 4:** Run `npm test` and `npm run test:e2e` (the smoke test's passwords must be 8+ characters); expected PASS.
- [ ] **Step 5:** Commit `feat: password policy, bcrypt cost 12 with transparent rehash`.

---

### Task 10: Rate limiting and trust proxy

**Files:**
- Create: `src/middleware/rateLimit.js`, `test/api/rateLimit.test.js`
- Modify: `src/app.js`, `src/routes/auth.js`, `src/routes/analyze.js`, `test/helpers/app.js`

**Interfaces:**
- Produces: `createUsernameLimiter({ max = 10, windowMs = 900000, now = Date.now }): { check(username): void, recordFailure(username): void, reset(username): void }` (`check` throws `AppError(429,'RATE_LIMITED')` once `max` failures are recorded within the window; keys are lowercased); `createIpLimiter({ windowMs = 60000, max = 10 }): RequestHandler`; `createAnalyzeLimiter({ windowMs = 3600000, max = 20 }): RequestHandler` keyed by `String(req.user.id)` and mounted after `auth`. All limiter rejections use `AppError(429,'RATE_LIMITED')`. `createApp` reads `limits` (`{ loginPerMin, analyzePerHour, usernameFailures, usernameWindowMs }`) and calls `app.set('trust proxy', config.trustProxy)`. Login: `check` before bcrypt, `recordFailure` on any failed login (unknown user included), `reset` on success.

- [ ] **Step 1: Write failing tests** (use small limits via `buildTestApp({ limits })`): 3 failed logins for `alice` with `usernameFailures: 3` then a *correct* password still gets 429 (lockout) and a different username is unaffected; the lockout ends after `usernameWindowMs` using an injected `now`; success resets the counter; per-IP: with `TRUST_PROXY=1` two different `X-Forwarded-For` values have separate budgets, and with `TRUST_PROXY=0` the header is ignored (same budget); analyze: with `analyzePerHour: 2`, user A's third call is 429 while user B's first call still succeeds.
- [ ] **Step 2:** Run `npm test`; expected FAIL.
- [ ] **Step 3:** Implement and wire (replacing the inline `express-rate-limit` calls from the old file).
- [ ] **Step 4:** Add `RATE_LIMITED` to the client `errors.js` table with an existing-tone Hebrew message if not already present.
- [ ] **Step 5:** Run `npm test`; expected PASS. Commit `feat: per-username and per-user rate limits, trust proxy`.

---

### Task 11: Cookie sessions, revocation and CSRF (server and client together)

**Files:**
- Create: `src/lib/sessions.js`, `src/middleware/csrf.js`, `test/api/session.test.js`, `test/api/csrf.test.js`, `test/e2e/hardening.spec.js`
- Modify: `src/middleware/auth.js`, `src/routes/auth.js`, `src/app.js`, `test/helpers/app.js` (`signedIn`), `public/js/api.js`, `public/js/session.js`, `public/js/screens/auth.js`, `public/js/screens/settings.js`, `public/js/main.js`
- Modify: `package.json` (`npm i cookie-parser`, `npm uninstall cors`)

**Interfaces:**
- Produces: `COOKIE_NAME = 'fl_session'`; `signSession({ id, tv }, secret): string` (HS256, 7d); `verifySession(token, secret): { id, tv }` (algorithms pinned to `['HS256']`, throws on anything else); `cookieOptions(config): CookieOptions`; `createCsrf(config): RequestHandler`. `createAuth` reads the cookie, loads `SELECT id, username, token_version FROM users WHERE id=$1`, and rejects when the user is missing or `token_version !== tv`: no cookie → `401 UNAUTHORIZED`; any invalid, expired, revoked or orphaned session → `401 SESSION_EXPIRED` and the cookie is cleared. Endpoints: `POST /auth/register` and `/auth/login` set the cookie and return `{ username }`; `GET /auth/me` → `{ username }`; `POST /auth/logout` clears the cookie (200 even when not signed in); `POST /auth/logout-all` (auth required) increments `token_version` and clears the cookie; `POST /auth/change-password` increments `token_version` and sets a fresh cookie for the current device. The `Authorization: Bearer` header is no longer read. `signedIn()` now performs the login, keeps the cookie, and sends `Cookie`, `Origin: config.origin` and `X-FL-Client: 1` on every call.
- Client: `apiFetch` sends `X-FL-Client: 1` and no `Authorization`; `session.js` exposes `bootSession(): Promise<void>` (calls `GET /auth/me`; success → `setLoggedIn(username)`, otherwise `navigate('welcome')`), `setLoggedIn(username)` (no token or username in storage; `fl_profile` stays in `localStorage`), `doLogout()` (calls `POST /auth/logout`, then clears `fl_profile` and state). Registration: `saveRegProfile`/`skipRegProfile` no longer hold a pending token: registering sets the cookie and the following `PUT /api/profile` and `POST /api/weight` just work; `finishLogin` calls `setLoggedIn(username)`. The old `fl_token`/`fl_username` keys are removed from storage on boot.

- [ ] **Step 1: Write failing tests.** `session.test.js`: login `Set-Cookie` contains `fl_session=`, `HttpOnly`, `SameSite=Strict`, `Path=/`, `Max-Age=604800` and no `Secure` in the test env (and does contain `Secure` with a production-config app); the body has no `token`; cookie authenticates `GET /api/food`; `Authorization: Bearer <old style jwt>` alone → 401 `UNAUTHORIZED`; `GET /auth/me` returns the username; change-password: the *old* cookie now gives `SESSION_EXPIRED` while the cookie from the change-password response works; `logout-all`: a second cookie obtained earlier stops working; plain `logout` clears only the cookie and a copy of the cookie kept before still works (documenting per-device logout); **forged/orphaned sessions (Review Focus 1):** cookie for a user deleted from the database, `fl_session=garbage`, an `alg:none` token, a token signed with a different secret, and an expired token each give `401 SESSION_EXPIRED`, never 500. `csrf.test.js`: POST without `X-FL-Client` → `403 CSRF`; wrong `Origin` → 403; missing `Origin` and missing `Referer` → 403; `Referer` with the right origin and no `Origin` → allowed; GET requests are not checked; the check also applies to `/auth/login`.
- [ ] **Step 2:** Run `npm test`; expected FAIL.
- [ ] **Step 3:** Implement server side, remove `cors` from `app.js`, update `signedIn` and the existing tests that read `res.body.token`.
- [ ] **Step 4:** Implement client side as described; delete the `token`, `pendingToken` and `pendingUsername` variables and every `Authorization` header.
- [ ] **Step 5:** Extend the smoke journey and add `hardening.spec.js`: after login `document.cookie` does not contain `fl_session` (HttpOnly), `localStorage` and `sessionStorage` values contain no JWT-shaped string (`/eyJ[\w-]+\.[\w-]+\./`), a reload keeps the user signed in, and after `logout-all` executed from a second browser context the first context's next API call returns to the auth screen.
- [ ] **Step 6:** Run `npm test` and `npm run test:e2e`; expected PASS. Commit `feat: HttpOnly cookie sessions with revocation and CSRF protection`.

---

### Task 12: Replace inline event handlers with delegation

**Files:**
- Create: `public/js/events.js`, `test/e2e/handlers.spec.js`
- Modify: `public/index.html`, every `public/js/screens/*.js` that renders HTML strings with `onclick`, `public/js/main.js`

**Interfaces:**
- Produces: `bindActions(rootEl: Element, actions: Record<string, (el: Element, event: Event) => void>): void` installing one delegated `click` listener and one delegated `change` listener on `rootEl`; markup convention: `data-action="name"` (click) and `data-change="name"` (change), argument in `data-arg` (single string; handlers convert numbers themselves) or `data-id`. Each screen module exports `actions`; `main.js` binds each `#screen-*` container, the three modals (`modal-change-pass`, `modal-profile`, `edit-modal`) and the bottom nav.
- Modal backdrop rule: `onclick="closeModal(x)"` on an overlay becomes `data-action="closeModalBackdrop"` whose handler acts only when `event.target === el`; the `onclick="event.stopPropagation()"` attributes on `.modal-sheet` are deleted. Elements that used `this` (`selectMeal(this)`, `selectEditMeal(this)`, `setRegGoal(+this.value)`, `setMpGoal(+this.value)`, `onImageSelected(event)`, `updateMpPreview()`) receive the element and event through the handler signature.

- [ ] **Step 1: Write failing test** `handlers.spec.js`: the DOM contains no attribute matching `on[a-z]+=` (`page.evaluate` over `document.querySelectorAll('*')` after visiting every screen, opening each modal and rendering a diary entry, stats charts and the weight list, which cover the 7 handlers generated inside JS template strings); clicking inside a modal sheet does not close it, clicking the backdrop does; meal-type buttons on the analysis and edit screens change selection; the goal `<select>` in registration and in the profile modal update state.
- [ ] **Step 2:** Run `npm run test:e2e`; expected FAIL (handlers still inline).
- [ ] **Step 3:** Convert all 74 `onclick` and 5 `onchange` attributes (find with `grep -n 'onclick=\|onchange=' -r public`), including those inside template strings in `renderMealList`, `renderDashLogPreview`, the edit-modal button rows and the weight list. Remove the `window` bridge from `main.js`.
- [ ] **Step 4:** Run `npm run test:e2e`; expected PASS (smoke journey plus the new spec).
- [ ] **Step 5:** Commit `refactor: event delegation instead of inline handlers`.

---

### Task 13: CSP, security headers and self-hosted fonts

**Files:**
- Create: `src/middleware/security.js`, `public/fonts/*.woff2`, `public/css/fonts.css`, `test/api/security.test.js`
- Modify: `public/index.html` (remove the three Google Fonts `<link>`s and the two `preconnect`s; add `fonts.css`), `src/app.js`, `test/e2e/hardening.spec.js`, `test/e2e/helpers.js`
- Modify: `package.json` (`npm i helmet`)

**Interfaces:**
- Produces: `securityMiddleware(config): RequestHandler[]` applying `helmet` with `contentSecurityPolicy: { useDefaults: false, directives }` exactly as in Global Constraints (no `upgrade-insecure-requests`), HSTS only when `config.isProd`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, and `Permissions-Policy: camera=(self), microphone=(), geolocation=()`. Mounted first, before static files and routes.
- Fonts: Fraunces (weights and italics used today: 300, 600, italic 300/400), DM Sans (300–600) and IBM Plex Mono (400, 600) as latin-subset `woff2` (SIL OFL) obtained from the `@fontsource` packages in a scratch directory (not added to `package.json`), copied into `public/fonts/`, declared in `fonts.css` with `font-display: swap` and the same family names the CSS already uses. Hebrew keeps its current fallback.

- [ ] **Step 1: Write failing tests.** `security.test.js`: `GET /` returns a `Content-Security-Policy` header whose parsed directives equal the required set exactly; `Referrer-Policy`, `X-Content-Type-Options`, `Permissions-Policy` present; `Strict-Transport-Security` absent in test env and present with a production config; `X-Powered-By` absent; `GET /fonts/<file>.woff2` is 200 with a font content type. `hardening.spec.js`: the journey completes with `guards.csp` and `guards.errors` empty and the allow-list from Task 5 emptied; no request leaves `localhost:3100` (`page.on('request')`).
- [ ] **Step 2:** Run tests; expected FAIL.
- [ ] **Step 3:** Implement. If any CSP violation appears, fix the source (never loosen `script-src`); `style-src 'unsafe-inline'` stays for the 97 `style=` attributes.
- [ ] **Step 4:** Run `npm test` and `npm run test:e2e`; expected PASS with zero violations and no console errors. Check the fonts visibly render (screenshot compare of the dashboard against `main` for the Latin headings).
- [ ] **Step 5:** Commit `feat: strict CSP and security headers, self-hosted fonts`.

---

### Task 14: XSS-safe rendering

**Files:**
- Modify: `public/js/dom.js`, every module containing `innerHTML` (28 sites in `home.js`, `dashboard.js`, `stats.js`, `charts.js`, `weight.js`, `settings.js`)
- Create: `test/e2e/xss.spec.js`, `test/api/xss.test.js`

**Interfaces:**
- Produces in `dom.js`: `html` tagged template (every interpolated value is HTML-escaped unless wrapped by `raw()`); `raw(str): { __raw: string }`; `setHtml(el, htmlResult)`; `escapeHtml` stays exported. Arrays interpolated in `html` are joined after escaping each item; results of nested `html` calls are trusted fragments.

- [ ] **Step 1: Write failing tests.** `xss.test.js`: payloads `<img src=x onerror=window.__x=1>`, `"><script>window.__x=1</script>` and `'</textarea><svg onload=window.__x=1>` are accepted by the API in food name, notes and username (register with the payload as username) and returned verbatim (escaping is a rendering concern, the API stores text). `xss.spec.js`: create a food entry, a weight, and an account whose username is a payload via the API, then open diary, dashboard preview, stats, weight list and settings (which shows `מחובר כ: <username>`) and assert `window.__x` is undefined, the payload text is visible as text, and no CSP violation was reported.
- [ ] **Step 2:** Run `npm run test:e2e`; expected FAIL if any site interpolates unescaped data (`renderMealList`, `renderDailySummary`, weight list, settings user label, edit-modal prefill).
- [ ] **Step 3:** Audit each of the 28 `innerHTML` sites: static text → `textContent`; templates → `html` with `raw()` only for fragments built by another `html` call or numeric/SVG output that contains no user data; option lists built in a loop from numbers may stay as static strings via `html`.
- [ ] **Step 4:** Run `npm run test:e2e`; expected PASS. Confirm `grep -n "innerHTML" -r public/js` shows only `setHtml` in `dom.js`.
- [ ] **Step 5:** Commit `feat: escape-by-default html helper, remove raw innerHTML`.

---

### Task 15: Dependencies, docs and final verification

**Files:**
- Modify: `package.json`, `package-lock.json`, `../CLAUDE.md`, `.env.example`

- [ ] **Step 1:** Run `npm audit`. Apply `npm audit fix` (no `--force`). Re-run `npm test` and `npm run test:e2e`. Any remaining high/critical finding that needs a breaking upgrade: stop, write the package, versions and breaking changes in a note to the owner, and wait before applying it.
- [ ] **Step 2:** Update `../CLAUDE.md`: new `src/` layout, cookie auth (no `Authorization` header), CSRF header requirement, error-code contract, `npm test` and `npm run test:e2e`, required env vars including `ORIGIN`, `TRUST_PROXY`, `DATABASE_CA`, `TEST_DATABASE_URL`, and the frontend module layout. Leave the "all UI text is Hebrew" rule unchanged (it changes in sub-project 2).
- [ ] **Step 3: Verify against the success criteria, running each and recording output:** (1) `npm test` all green; (2) `npm run test:e2e` all green; (3) `npm audit --omit=dev` shows no high or critical; (4) start the app against a **fresh** empty database and against the existing `foodlogger` schema and confirm both start and log in; (5) `wc -l server.js public/index.html` show a bootstrap and markup only, and no module exceeds its size limit; (6) `grep -rn "localStorage" public/js` shows only `fl_profile` use.
- [ ] **Step 4:** Ask the owner to click through every screen against `main` for visual parity, and to complete the three owner items in spec section 9 before merging (Railway `ORIGIN`, strong `JWT_SECRET`, proxy hops, optional `DATABASE_CA`).
- [ ] **Step 5:** Commit `docs: update CLAUDE.md for the new architecture`.
