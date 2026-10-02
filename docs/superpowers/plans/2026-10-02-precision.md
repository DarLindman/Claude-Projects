# Precision (sub-project 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make dates and streaks right at every hour regardless of server time zone, make the AI's nutrition numbers pass deterministic sanity rules, and make the image prompt estimate portions by a general scale, volume and weight method.

**Architecture:** The database session is pinned to UTC and the browser sends `today`, so dates are "wall-clock as typed" and never depend on a server zone. A pure module `src/lib/nutrition.js` reconciles each AI item before totals. The image prompt asks for scale reference, volume and weight; the same module checks weight against volume. One authorised real evaluation run closes the work.

**Tech Stack:** Node 24, Express 4, pg, zod, `node --test` + supertest, Playwright, the existing `scripts/eval-naming.js`.

**Spec:** `docs/superpowers/specs/2026-10-02-precision-design.md` (approved by the owner; read it first).

## Global Constraints

- Work in `food-logger/` on branch `precision`; run commands from `food-logger/`. Tests use the `foodlogger_test` database; `npm test` and `npm run test:e2e` never run at the same time.
- **No real AI call anywhere except Task 8** (the owner authorised exactly one run, about 30 calls, `--runs 1`, never repeated). Every test uses `test/helpers/fakeAnthropic.js`.
- **No new user-facing text**: no Hebrew string is added or changed in `public/`. Grams are never shown to users. The look of the app is unchanged.
- No new npm dependencies. No build step for the frontend. Frontend modules are plain ES modules.
- Server responses keep the error contract (`{ error: { code, fields? } }`); no human-language text from the server.
- `volume_ml` and `scale_reference` are model-only: never returned by the API, stored, or logged by production code. Logs hold numbers only, never meal text, names or identifiers.
- Every task keeps `npm test` green; the date work is also verified under other zones (see Task 1 and 2): `PGOPTIONS='-c timezone=America/New_York' npm test` and `TZ=America/Los_Angeles npm test` (Bash syntax; in PowerShell set `$env:PGOPTIONS` / `$env:TZ` first and remove them afterwards).
- Existing frozen things stay: `scripts/eval/imagePromptV1.js` (hash-tested), Haiku for text analysis, `claude-haiku-4-5-20251001` rollback via `IMAGE_MODEL`.
- Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

Inputs and conditions the spec implies but would not otherwise be tested, most likely first; each has a test in the task named in brackets.

1. A meal logged at 23:30 or 00:30 on a year boundary (31 Dec / 1 Jan) belongs to its own day and its own year in the diary and in yearly stats. [Task 2]
2. A streak that crosses Feb 28 → Feb 29 → Mar 1 (leap year) and month ends counts every day once. [Task 2]
3. An AI item with missing, string, negative, `NaN`-like or non-numeric fields (`"150 g"`, `null`, `-5`) never crashes the sanity module and never becomes `NaN` in the totals. [Task 4]
4. A drink listed with calories only (all macros 0) or an item with weight 0 is not zeroed or "corrected" by the macro and density rules. [Task 4]
5. An old client that sends no `today`, and an image reply without `scale_reference` / `volume_ml` (the Haiku rollback, or a model that omits them), still work. A meal dated after `today` does not break the streak. [Tasks 2 and 6]

---

## File Structure

- `src/db/pool.js` (modify): `pinUtcSession(pool)`, used by `createPool`.
- `test/helpers/db.js` (modify): `createTestPool` pins the session too.
- `src/lib/dates.js` (modify): `utcToday()`, `addDaysUtc(dateStr, n)`.
- `src/routes/streak.js`, `src/routes/stats.js` (modify): wall-clock dates, `today` query.
- `public/js/dates.js`, `screens/{dashboard,stats,weight,analysis}.js` (modify): one local-date helper set.
- `src/lib/nutrition.js` (create): `reconcileItems`, constants.
- `src/lib/analysis.js` (modify): call `reconcileItems`, log the sanity line, accept the new image fields.
- `src/lib/prompts.js` (modify): `PORTION_ANCHORS`, `PORTION_METHOD`, new image templates and messages.
- `scripts/eval/pipeline.js`, `scripts/eval/report.js`, `scripts/eval-naming.js` (modify): record and show weights.
- `CLAUDE.md` (modify): document dates, sanity rules and the portion method.
- Tests: `test/api/{pool,stats,food,nutrition,analysis-sanity,analysis-prompt}.test.js`, `test/e2e/midnight.spec.js`.

---

### Task 1: Pin the database session to UTC

**Files:**
- Modify: `src/db/pool.js`, `test/helpers/db.js`
- Test: `test/api/pool.test.js`

**Interfaces:**
- Produces: `pinUtcSession(pool: pg.Pool): pg.Pool` exported from `src/db/pool.js`; it registers `pool.on('connect', client => client.query("SET TIME ZONE 'UTC'"))` (a failed `SET` is logged with `console.error`, never thrown) and returns the pool. `createPool(config)` and `createTestPool()` both return a pinned pool.

- [ ] **Step 1: Write the failing tests** in `test/api/pool.test.js` (these need the test database; use `createTestPool` from `../helpers/db`):
  - `'a pinned pool reports UTC even when the server and PGOPTIONS say otherwise'`: build a raw `new Pool({ connectionString: <test url>, options: '-c timezone=Asia/Jerusalem' })` (get the URL the way `createTestPool` does; export a `resolveTestUrl` helper from `test/helpers/db.js` if needed), wrap it with `pinUtcSession`, and assert `SHOW TIME ZONE` returns `{ TimeZone: 'UTC' }`.
  - `'every connection of the pool is pinned'`: run 5 concurrent `SELECT current_setting('TimeZone') AS tz` on a pinned pool with `max: 5` and assert all are `UTC`.
  - `'a timestamp without offset is read back as the same wall-clock date'`: with a pinned pool created with `options: '-c timezone=America/New_York'`, assert `SELECT '2026-03-01T23:30:00'::timestamptz::date::text AS d` gives `2026-03-01` and `SELECT ('2026-03-01T23:30:00'::timestamptz AT TIME ZONE 'UTC')::text` gives `2026-03-01 23:30:00`.
- [ ] **Step 2: Run** `node --test test/api/pool.test.js` — expect the new tests to FAIL (`pinUtcSession` is not defined).
- [ ] **Step 3: Implement** `pinUtcSession` in `src/db/pool.js`, call it from `createPool`, call it in `createTestPool` before returning, export it. Keep the existing TLS code untouched.
- [ ] **Step 4: Run** `node --test test/api/pool.test.js` — expect PASS. Then run `npm test`; expect PASS. Run it again with `PGOPTIONS='-c timezone=America/New_York'`; expect PASS (existing stats tests may still fail on `localDay`; if so they are fixed in Task 2, note which and continue).
- [ ] **Step 5: Commit** `feat: pin every database session to UTC`.

---

### Task 2: Wall-clock dates in the routes (`today`, streak, weekly)

**Files:**
- Modify: `src/lib/dates.js`, `src/routes/streak.js`, `src/routes/stats.js`
- Test: `test/api/dates.test.js`, `test/api/stats.test.js`, `test/api/food.test.js`, `test/api/validation.test.js`

**Interfaces:**
- Produces in `src/lib/dates.js`: `utcToday(): string` (`YYYY-MM-DD` of the UTC clock) and `addDaysUtc(dateStr: string, n: number): string` (pure calendar arithmetic on a valid `YYYY-MM-DD`, leap years included, no `Date` local-time use).
- Produces API: optional query `today` (`S.optionalQuery(S.dateStr)`; malformed → `400 VALIDATION`, `fields: { today: 'INVALID' }`) on `GET /api/streak` and `GET /api/stats/weekly`. Absent → `utcToday()`.
- `GET /api/streak` → `{ streak: number, lastLogDate: string | null }` where days are `logged_at::date::text` (no `AT TIME ZONE`), only days `<= today` count, `lastLogDate` is the latest such day, and the streak runs backwards from it only when it is `today` or `today - 1`, else `0`.
- `GET /api/stats/weekly`: window is `[start, start + 6]` when `start` is given, else `[today - 6, today]`; both ends computed with `addDaysUtc` and passed as dates. `day` in the weekly and monthly rows is `logged_at::date::text` (a `YYYY-MM-DD` string; today it is a `Date` serialised in the Node process time zone, which shifts a day on a machine west or east of UTC). Row keys are unchanged.

- [ ] **Step 1: Write failing tests.**
  - `dates.test.js`: `addDaysUtc('2024-02-28', 1) === '2024-02-29'`, `addDaysUtc('2024-02-29', 1) === '2024-03-01'`, `addDaysUtc('2023-02-28', 1) === '2023-03-01'`, `addDaysUtc('2026-01-01', -1) === '2025-12-31'`, `addDaysUtc('2026-03-31', 1) === '2026-04-01'`; `utcToday()` matches `/^\d{4}-\d{2}-\d{2}$/`.
  - `stats.test.js`: rewrite `localDay(...)` comparisons to plain string equality on `res.body[i].day`; delete `toIsraelDate`, use fixed dates and the `today` param: streak tests `'streak counts consecutive days ending today'` (logs at `D-1T23:30:00` and `DT00:30:00`, `?today=D` → `{ streak: 2, lastLogDate: D }`), `'streak is 1 the day after'` (`?today=D+1` with the last log on `D` → `{ streak: 1, lastLogDate: D }`), `'streak is 0 two days later'` (`?today=D+2`), `'streak crosses 28 Feb, 29 Feb and 1 Mar 2024'` (logs on 02-28, 02-29, 03-01 at 23:30, `?today=2024-03-01` → 3), `'a meal dated after today is ignored'` (extra log on `today+1` → same streak, `lastLogDate = today`), `'no today parameter still works'` (log with `new Date().toISOString()`, no param → `streak 1`), `'bad today is 400 VALIDATION'`.
  - weekly: `'weekly with today covers today-6..today'` (logs at `T23:30:00` on `today` and `T00:30:00` on `today-6` are in; `today-7` and `today+1` are out); yearly: logs at `2025-12-31T23:30:00` and `2026-01-01T00:30:00` fall into `2025` and `2026` respectively (`/api/stats/yearly?year=...`, rows' `month` `2025-12` / `2026-01`).
  - `food.test.js`: a meal at `2026-03-01T23:30:00` and one at `2026-03-02T00:30:00` appear in `GET /api/food?date=2026-03-01` and `?date=2026-03-02` respectively, and their `logged_at` still reads `...T23:30:00.000Z` / `...T00:30:00.000Z`.
  - `validation.test.js`: add `weekly today=2026-02-31` and `streak today=garbage` rows to the existing table style, expecting `400 VALIDATION { today: 'INVALID' }`.
- [ ] **Step 2: Run** `node --test test/api/dates.test.js test/api/stats.test.js test/api/food.test.js test/api/validation.test.js` — expect FAIL.
- [ ] **Step 3: Implement** `utcToday` / `addDaysUtc`, rewrite `streak.js` (remove `toIsraelDate` and every `AT TIME ZONE`; query days with `logged_at::date::text`) and the weekly/monthly queries in `stats.js` as specified above; validate `today` with the existing `validate({ query })` middleware and `S.optionalQuery(S.dateStr)`.
- [ ] **Step 4: Run** the same files, then `npm test`, then `PGOPTIONS='-c timezone=America/New_York' npm test`, then `TZ=America/Los_Angeles npm test` — expect PASS in all three.
- [ ] **Step 5: Commit** `fix: dates and streak use wall-clock days; the browser sends today`.

---

### Task 3: Browser date helpers, midnight e2e test and docs

**Files:**
- Modify: `public/js/dates.js`, `public/js/screens/dashboard.js`, `public/js/screens/stats.js`, `public/js/screens/weight.js`, `public/js/screens/analysis.js`, `CLAUDE.md`
- Create: `test/e2e/midnight.spec.js`

**Interfaces:**
- Consumes: `today` query on `/api/streak` and `/api/stats/weekly` (Task 2).
- Produces in `public/js/dates.js`: `nowTimeStr(): string` (`HH:mm` of the local clock) and `daysBetween(fromStr: string, toStr: string): number` (whole days from `fromStr` to `toStr`, via `Date.UTC`, so no zone is involved). `todayStr` and `addDays` stay as they are.

- [ ] **Step 1: Write the failing e2e test** `test/e2e/midnight.spec.js` (use `attachGuards`, `SAVE_TO_DIARY` from `./helpers`; follow `smoke.spec.js` for register → text analysis → save): install the Playwright clock at local `2026-06-15 23:30` (`page.clock.install({ time: new Date(2026, 5, 15, 23, 30) })` before `goto`), register, add one meal by text, and assert: the diary label says "היום", one meal row, the dashboard streak number is `1`; open the edit modal, change only the name, save, assert the row is still in today's diary (the known bug). Then set the clock to local `2026-06-16 00:30` (`page.clock.setFixedTime`), reload, assert the diary is empty and the dashboard streak is still `1` (yesterday counts), and that the previous day (`changeDay -1`) holds the meal.
- [ ] **Step 2: Run** `npx playwright test test/e2e/midnight.spec.js` — expect FAIL (dashboard still uses its own Israel conversion).
- [ ] **Step 3: Implement.** In `dates.js` add the two helpers. In `dashboard.js` fetch `/api/streak?today=${todayStr()}`, remove `toIsraelDate`, use `todayStr()`, `addDays(todayStr(), -1)` and `daysBetween(lastLogDate, today)`. In `stats.js` fetch `/api/stats/weekly?today=${todayStr()}` and build the 7 chart days with `addDays(todayStr(), -i)`. In `weight.js` send `logged_at: date || todayStr()`. In `analysis.js` use `nowTimeStr()` as the time default. No other date or time string building (`toTimeString`, `toISOString`, `toLocaleString` with `timeZone`) remains in `public/js` (grep to confirm).
- [ ] **Step 4: Run** the new spec, then `npm run test:e2e` (all specs), then `PGOPTIONS='-c timezone=America/New_York' npm run test:e2e` — expect PASS; the smoke and handlers specs must pass at any hour.
- [ ] **Step 5: Document** in `CLAUDE.md` (Architecture / Tests area): the wall-clock model, the UTC session pin, the `today` parameter and its UTC fallback, and that `day` fields of the stats are `YYYY-MM-DD` strings. Update the stale "Israel timezone" mentions. Mark the carry-over bug fixed in the status memory later (controller's job, not here).
- [ ] **Step 6: Commit** `fix: browser date helpers and a midnight e2e test`.

---

### Task 4: The sanity module `nutrition.js`

**Files:**
- Create: `src/lib/nutrition.js`
- Test: `test/api/nutrition.test.js`

**Interfaces:**
- Produces: `reconcileItems(items: object[]): { items: object[], report: { adjusted: number, calories_delta: number, rules: Record<string, number> } }`; never throws, never drops or reorders items, never mutates its input (returns copies that keep unknown keys such as `name` and `volume_ml`). Exported constants `LIMITS = { MAX_ITEM_WEIGHT_G: 2000, MACRO_WEIGHT_TOLERANCE: 0.02, CALORIE_TOLERANCE_ABS: 40, CALORIE_TOLERANCE_REL: 0.2, MAX_KCAL_PER_G: 9, MIN_DENSITY: 0.05, MAX_DENSITY: 1.6 }` and the rule ids `invalid`, `weight`, `density`, `macro_weight`, `calories_macros`, `kcal_density`. `report.rules[id]` counts the items on which the rule changed something; `adjusted` counts items changed by at least one rule; `calories_delta` is `sum(calories after) - sum(calories before)` (before = `Number(x) || 0` of the raw values).
- Execution order per item (the spec's rule 6 runs right after rule 2, so a corrected weight feeds the nutrition rules): `invalid` → `weight` → `density` → `macro_weight` → `calories_macros` → `kcal_density`.
  1. `invalid`: each of `weight_g, calories, protein_g, carbs_g, fat_g, fiber_g` that is not a finite non-negative number after `Number(v)` (so `"150"` is accepted, `"150 g"`, `null`, `undefined`, `-5` are not) becomes `0`. Counted only when a present-but-bad value was replaced (a missing field is silently `0`).
  2. `weight`: `weight_g > 2000` → `2000`.
  3. `density` (spec 5.2): when `volume_ml` is a finite number `> 0` and `weight_g > 0`, density `= weight_g / volume_ml`; outside `[0.05, 1.6]` → `weight_g = volume_ml * nearest bound`, and `calories, protein_g, carbs_g, fat_g, fiber_g` are multiplied by `newWeight / oldWeight`.
  4. `macro_weight`: when `weight_g > 0` and `protein+carbs+fat+fiber > weight_g * 1.02`, the four macros are multiplied by `weight_g / sum`.
  5. `calories_macros`: skipped when `protein+carbs+fat == 0`; `expected = 4*protein + 4*carbs + 9*fat`; when `abs(calories - expected) > max(40, 0.2 * expected)`, `calories = Math.round(expected)`.
  6. `kcal_density`: when `weight_g > 0` and `calories > 9 * weight_g`, `calories = Math.round(9 * weight_g)`.
  Scaled macros are rounded to 1 decimal, calories to an integer; untouched values keep their given numeric value.

- [ ] **Step 1: Write failing tests** (`node:test`, no database, no fake AI). One test per rule with the boundary on both sides: weight 2000 stays, 2001 → 2000; density exactly 0.05 and 1.6 stay, 0.049 and 1.61 are moved (check the scaled calories); macro sum at 1.02× stays, above scales; calories deviation exactly `max(40, 20%)` stays, above is replaced; `10 * weight` calories → `9 * weight`. Plus: `'garbage fields never produce NaN'` for `{}`, `{ weight_g: '150 g', calories: null, protein_g: -5, fat_g: NaN, carbs_g: Infinity }`, `'input is not mutated'` (deep-equal a frozen clone), `'consistent items are returned equal and report adjusted 0'`, `'order and length are kept'`, `'a drink with calories only keeps its calories'` (`{ weight_g: 330, calories: 140 }`), `'an item with weight 0 is not weight-checked'`, `'report counts'` (two items hitting different rules give the expected `rules` map and `calories_delta`), `'reconcileItems([]) and non-array input return empty items'`.
- [ ] **Step 2: Run** `node --test test/api/nutrition.test.js` — expect FAIL (module missing).
- [ ] **Step 3: Implement** `src/lib/nutrition.js` as a pure module with the constants at the top.
- [ ] **Step 4: Run** the file — expect PASS; run `npm test` — expect PASS.
- [ ] **Step 5: Commit** `feat: nutrition sanity rules (reconcileItems)`.

---

### Task 5: Use the sanity module in both analyses, log it, document it

**Files:**
- Modify: `src/lib/analysis.js`, `CLAUDE.md`, and any existing test whose fake numbers the rules now change
- Test: `test/api/analysis-sanity.test.js`

**Interfaces:**
- Consumes: `reconcileItems` (Task 4).
- Produces: in `analysis.js`, after the item names are cleaned and before `sumItems`, `const { items: checked, report } = reconcileItems(items)` in `analyzeImage` and `analyzeText`; totals come from `checked`. When `report.adjusted > 0` one `console.info` line: `[<tag>] sanity adjusted=<n> calories_delta=<d> rules=<id>:<count>,<id>:<count>` (rule ids sorted, `tag` is `analyze` or `analyze-text`; numbers and rule ids only). The route responses keep exactly their current shape.

- [ ] **Step 1: Write failing tests** `analysis-sanity.test.js` (use `buildTestApp`/`signedIn`, `fakeAnthropic`, `fake.imageReply` / `fake.textReply` with JSON strings; stub `console.info` as `analysis-retry.test.js` does): an image reply whose item has `calories: 900, weight_g: 100, protein_g: 10, carbs_g: 10, fat_g: 5` returns calories `round(4*10+4*10+9*5) = 125` in `POST /api/analyze`; the same for `POST /api/analyze-text`; a consistent reply produces no `sanity` log line; an adjusted reply logs exactly one line matching `^\[analyze\] sanity adjusted=1 calories_delta=-775 rules=calories_macros:1$` and the line contains none of the item's name or the dish name; the response body keys are unchanged (`foodName, calories, protein_g, carbs_g, fat_g, fiber_g`).
- [ ] **Step 2: Run** `node --test test/api/analysis-sanity.test.js` — expect FAIL.
- [ ] **Step 3: Implement** the wiring in `analysis.js`; the existing usage-line filter in `test/helpers/fakeAnthropic.js` only matches `image|text model=` lines, so the new line stays visible to tests that stub `console.info`.
- [ ] **Step 4: Run** `npm test`. Where an existing test's fake numbers are now corrected by the rules (inconsistent fixture values), fix the fixture so it is consistent, not the rule; do not weaken an assertion. Expect PASS.
- [ ] **Step 5: Document** the six rules, their constants and the log line in `CLAUDE.md` (AI section).
- [ ] **Step 6: Commit** `feat: apply nutrition sanity rules to every analysis`.

---

### Task 6: Shared portion anchors

**Files:**
- Modify: `src/lib/prompts.js`
- Test: `test/api/analysis-prompt.test.js` (extend)

**Interfaces:**
- Produces: `PORTION_ANCHORS` exported from `prompts.js`: a frozen object with `breadSliceG: [25, 30]`, `eggG: 55`, `oilTablespoonG: 13`, `butterTablespoonG: 14`, `cheeseSliceG: [20, 25]`. `IMAGE_SYSTEM_PROMPT` renders its anchor lines for these from the object (ranges as `25-30`), and `TEXT_SYSTEM_PROMPT` renders its bread default (`PORTION_ANCHORS.breadSliceG[0]` grams) and its tablespoon of oil from it. The text prompt's oil line becomes `כף שמן = 13 גרם` (was `13 מ"ל`, which contradicted the image prompt's 13 grams). Anchors that exist in only one prompt (chicken, patty, rice, potato, cottage cheese and the like) stay where they are.

- [ ] **Step 1: Write failing tests:** `'every shared anchor appears in the prompts with its single value'` (for each of the five keys, build the expected number text from `PORTION_ANCHORS` and assert the image prompt contains it, and the text prompt contains the bread low end and the oil value); `'the two prompts do not contradict each other'` (the oil tablespoon is described in grams in both and the numbers equal; the text prompt's bread default lies inside the image range); `'PORTION_ANCHORS is frozen'`.
- [ ] **Step 2: Run** `node --test test/api/analysis-prompt.test.js` — expect FAIL.
- [ ] **Step 3: Implement** the constant and render both prompts from it; the rest of both prompts is unchanged.
- [ ] **Step 4: Run** `npm test` — expect PASS (the frozen V1 hash tests are untouched).
- [ ] **Step 5: Commit** `refactor: one source for the portion anchors both prompts share`.

---

### Task 7: The portion method in the image prompt

**Files:**
- Modify: `src/lib/prompts.js`, `src/lib/analysis.js` (the image answer predicate only if needed), `test/helpers/fakeAnthropic.js`, `CLAUDE.md`
- Test: `test/api/analysis-prompt.test.js` (extend)

**Interfaces:**
- Produces in `prompts.js`: `PORTION_METHOD` (string, exported) which replaces the one-line "שלב 3 — כמויות" in `IMAGE_SYSTEM_PROMPT`; `IMAGE_REPLY_TEMPLATE` becomes `{ visual_description, scale_reference, draft_name, dish_name, items }` where each image item has an extra `volume_ml: 0` placed **before** `weight_g` (a separate `IMAGE_TEMPLATE_ITEM`; `TEXT_REPLY_TEMPLATE` and the text item stay as they are); `IMAGE_USER_MESSAGE` lists the fields in that order and says volume first, then weight, then calories from the weight only.
- `PORTION_METHOD` content (Hebrew, general, no dish names): (1) find a reference of known size in the photo and write it in `scale_reference` as a short English phrase (a standard dinner plate is about 26 cm, a fork about 19 cm, a hand, a cup, a bottle, a slice of bread, a packaged product); (2) per item estimate dimensions in cm including height, and its volume in ml as `volume_ml`; (3) weight from volume by a general density for the physical kind of food (dense solids, cooked grains and mashed food, chopped vegetables, leafy greens, liquids, oils, baked goods); (4) with no visible reference assume the usual portion for the kind of dish, restaurants larger (the existing line stays, with the existing anchors from Task 6).
- The answer predicate `isImageAnswer` and the parser keep accepting a reply **without** `scale_reference` or `volume_ml` (Haiku rollback). Fake: `IMAGE_ITEMS` in `fakeAnthropic.js` gain a plausible `volume_ml` (170 for the chicken, 190 for the rice) and the default image reply gets `scale_reference: 'dinner plate about 26 cm'`; totals stay as they are.

- [ ] **Step 1: Write failing tests:** `'the image prompt contains the portion method'` (asserts `PORTION_METHOD` is part of `IMAGE_SYSTEM_PROMPT`, mentions `scale_reference`, `volume_ml` and `26`); `'the user message lists the reply fields in order'` (indexes of `visual_description` < `scale_reference` < `draft_name` < `dish_name` < `items` in `IMAGE_USER_MESSAGE`, and inside the items template `volume_ml` precedes `weight_g`); `'the method names no dish'` (none of `שניצל`, `פלאפל`, `המבורגר`, `פיצה` appears in `PORTION_METHOD`); `'a reply without scale_reference and volume_ml is accepted'` (fake image reply built without them returns 200 with the normal totals); `'model-only fields are never returned'` (body keys unchanged; the reply's `scale_reference` text appears in no `console.info/warn/error` output); `'an item whose weight contradicts its volume is corrected'` (fake reply: `volume_ml: 100`, `weight_g: 500`, macros consistent with 500 g → totals equal the values scaled to 160 g, and the log line has `rules=density:1`); `'an echoed template is still rejected'` (existing test updated for the new template).
- [ ] **Step 2: Run** `node --test test/api/analysis-prompt.test.js test/api/analysis-sanity.test.js` — expect FAIL.
- [ ] **Step 3: Implement** the prompt text, templates and message in `prompts.js`; adjust the fake and any assertion that pinned the old template/message text; leave `analysis.js` logic alone unless a test forces a change.
- [ ] **Step 4: Run** `npm test` — expect PASS. Check that Haiku's `maxTokensFor` is still 1500 and a typical reply of the new shape stays far below it (state the rough token count of the largest fake reply in the commit message body).
- [ ] **Step 5: Document** the method and the two model-only fields in `CLAUDE.md` (AI section).
- [ ] **Step 6: Commit** `feat: portion estimation by scale, volume and density in the image prompt`.

---

### Task 8: Evaluation tool records weights, then the one authorised run

**Files:**
- Modify: `scripts/eval/pipeline.js`, `scripts/eval/report.js`, `scripts/eval-naming.js`
- Test: `test/api/eval-naming-extra.test.js`, `test/api/eval-only-extra.test.js` (extend), a report test in the existing eval test files

**Interfaces:**
- Consumes: `reconcileItems` (Task 4), the new reply fields (Task 7).
- Produces: each recorded side (`old`, `new`, `extra`) gains `scale` (string, from the raw reply), `items: [{ weight_g, volume_ml, calories }]` (numbers from the raw reply, `null` when absent) and `sanity` (the `report` of `reconcileItems` run on the raw items); the pipeline's `instrument` parses the raw reply text once (first text block) and keeps `rawItems` and `scale` beside `rawName`. In the `--only-extra` branch of `run`, the replaced extra record is kept as `previousExtra` (`{ name, calories }` only) next to the new `extra`. `report.html` shows, in the extra column of each photo, the total grams, the total calories, the per-item grams, the `scale` text, the `sanity` rules that fired and, when present, the earlier calories (`previousExtra`, and the calories of the stored `old`/`new` sides) — all HTML-escaped like every other cell. No change to the production code under `src/`.

- [ ] **Step 1: Write failing tests** with the fake client (no real call): a recorded `extra` side has `items` with the fake's weights and volumes and a `sanity` object; an inconsistent fake item shows up in `sanity.rules`; the `--only-extra` run keeps the previous extra's calories as `previousExtra`; `renderReport` output contains the grams and escapes a `scale` containing `<script>`.
- [ ] **Step 2: Run** the eval test files — expect FAIL.
- [ ] **Step 3: Implement** the pipeline, runner and report changes above.
- [ ] **Step 4: Run** `npm test` — expect PASS. Commit `feat: evaluation records and shows weights`.
- [ ] **Step 5: The one authorised real run (controller, not a subagent; only after Tasks 1-8 pass and the owner is told it starts).** Back up the stored results first: copy `eval/results.json` to `eval/results-before-portions.json` and `eval/report.html` to `eval/report-before-portions.html`. Run once, from `food-logger/`: `node scripts/eval-naming.js --also-model claude-sonnet-5-5 --only-extra --runs 1 --yes`. It must make about 30 calls (the tool prints the plan and cost estimate first; if the estimate exceeds 1 USD stop and ask). Never run it a second time. A failed call that returns an error stays an error record; do not retry by hand.
- [ ] **Step 6: Report to the owner in plain Hebrew:** the 30 photos' names (natural or not, using the existing naming flags), total grams and calories next to the earlier calories, how many items the rules adjusted and by which rule (from `sanity`), the density check count, the real token and latency figures from the log lines, and an honest verdict against the spec's criterion 0 (owner judges at least 90% plausible; the owner may add `ratings.json`). The report path is `eval/report.html`; it is git-ignored and local only.
- [ ] **Step 7: Commit** nothing from `eval/` (git-ignored). If the run shows a rule or bound is wrong, **stop and ask the owner before changing anything** (no second run is authorised).

---

---

## Addendum 2026-10-03 — after the single real run (owner decisions)

The one authorised run showed the portion method of Task 7 raises calories by about 19% (25 of 30 photos higher; an egg-salad sandwich at 1,282 kcal and a steak at 1,551 kcal looked implausible to the owner), triples the output (about 640 to 1,970 tokens) and doubles the time (about 8 s to 17 s). The model chose "standard dinner plate, 26 cm" in 26 of 30 photos: it assumed the scale instead of measuring it. The owner decided (2026-10-03): (1) the portion method of Task 7 is NOT merged as it is; (2) speed matters: even 8 s is a lot; (3) up to **3 further real runs** on the 30 photos are authorised (about 0.2-0.4 USD each) for a speed experiment and then a prompt that grounds the scale in what is visible (cutlery, plate, cup) instead of assuming it. The docs (platform.claude.com, the `effort` and `thinking` pages) say Sonnet 5.5 rejects `thinking: disabled`, accepts `thinking: {"type": "between_tools"}` with `output_config: {"effort": "low"}` (GA, no beta header, no other fields with `between_tools`), and that Haiku 4.5, Opus and Fable must NOT receive these fields (400). Part 3 of the spec is superseded by this addendum where they differ; the density rule of `nutrition.js` stays and is inert when `volume_ml` is absent.

Tasks 9-10 are production and tool work for subagents; Tasks 11-13 are controller steps.

### Task 9: Low-latency request options for Sonnet 5 image analysis

**Files:**
- Modify: `src/lib/analysis.js`, `src/config.js`, `src/routes/analyze.js` and `src/app.js` (pass the configured effort the way `imageModel` is passed), `server.js` (the startup log line lists it), `.env.example`, `CLAUDE.md` ("Operating the image model")
- Test: `test/api/analyze-model.test.js` (extend), `test/api/config.test.js` (extend)

**Interfaces:**
- Produces in `analysis.js`: `requestOptionsFor(model: string, effort?: string | null): { thinking?: object, output_config?: object }` (exported). For a model id starting with `claude-sonnet-5`: `effort` undefined or `'low'` gives `{ thinking: { type: 'between_tools' }, output_config: { effort: 'low' } }`, `'medium'` and `'high'` give the same with that effort, `null` or `'off'` gives `{}`. Every other model gives `{}` (Haiku, Opus and Fable reject these fields). `analyzeImage(anthropic, { imageBase64, mimeType, model, temperature, effort, prompts })`: the request spreads `requestOptionsFor(model, effort)`; `effort` undefined means the default (low); `prompts` is an optional evaluation-only override `{ system: string, user: string }` replacing `IMAGE_SYSTEM_PROMPT` and `IMAGE_USER_MESSAGE` (production never passes it).
- Produces in `config.js`: `config.imageEffort` from env `IMAGE_EFFORT` (one of `low`, `medium`, `high`, `off`; default `low`; anything else is a startup error listed with the other config problems, like the existing `IMAGE_MODEL` check); the analyze route passes it as `effort` (`'off'` maps to `null`). The startup log line shows `imageEffort=<value>`.

- [ ] **Step 1: Write failing tests:** with the fake client, a `claude-sonnet-5-5` image request body contains `thinking: { type: 'between_tools' }` and `output_config: { effort: 'low' }` and still no `temperature`; `effort: 'medium'` sends medium; `effort: null` sends neither; a Haiku model request and a `claude-opus-5-5` request contain neither field; the route sends the configured effort (`IMAGE_EFFORT=high` via `buildTestApp({ env })` reaches the request; `off` sends none); config rejects `IMAGE_EFFORT=extreme` with a message naming the variable; the `prompts` override replaces the system and user texts in the request; the text analysis request is unchanged (no new fields).
- [ ] **Step 2: Run** `node --test test/api/analyze-model.test.js test/api/config.test.js` — expect FAIL.
- [ ] **Step 3: Implement** as specified; keep `maxTokensFor` and `temperatureFor` as they are; the usage log line format must not change (tests pin its regex).
- [ ] **Step 4: Run** `npm test` — expect PASS.
- [ ] **Step 5: Document** `IMAGE_EFFORT` (what it does, the values, rollback `IMAGE_EFFORT=off`) and the rule that Haiku, Opus and Fable never get these fields, in `CLAUDE.md` and `.env.example`.
- [ ] **Step 6: Commit** `feat: low-latency request options for Sonnet 5 image analysis (IMAGE_EFFORT)`.

### Task 10: Evaluation variants (prompt, effort) and per-call latency

**Files:**
- Modify: `scripts/eval-naming.js`, `scripts/eval/pipeline.js`, `scripts/eval/report.js`, `scripts/eval/summary.js`
- Create: `scripts/eval/prompts/prePortion.js`
- Test: `test/api/eval-naming-extra.test.js`, `test/api/eval-only-extra.test.js`, `test/api/analysis-prompt.test.js` (hash test of the frozen copy)

**Interfaces:**
- Consumes: `analyzeImage(..., { effort, prompts })` (Task 9).
- `scripts/eval/prompts/prePortion.js` exports `{ IMAGE_SYSTEM_PROMPT, IMAGE_USER_MESSAGE }`: the runtime image prompt exactly as it was at commit `b67661f` (before the portion method of Task 7), as rendered strings; a hash test (sha256 of both strings, computed once from `git show b67661f:food-logger/src/lib/prompts.js`) freezes it like the V1 prompt. Further variants are added later as files in the same directory with the same two exports.
- CLI: `--prompt <name>` (a file name in `scripts/eval/prompts/` without `.js`; an unknown name is an error) and `--effort <low|medium|high|off>` apply to the extra variant (the `--also-model` run); the recorded `variants.extra` gets `prompt` and `effort` fields and the report's extra column label shows them.
- Each recorded side gains `ms`, `inputTokens`, `outputTokens` and `stopReason` of the (last) model call, measured in the instrumented client wrapper from wall-clock time and the response `usage` (`null` when absent); the summary and the report show the average and maximum latency and the average tokens of the extra variant; old results without these fields still render.

- [ ] **Step 1: Write failing tests** (fake client, no real API): `--prompt prePortion` sends the frozen texts; an unknown prompt name fails with a clear message; `--effort off` sends no effort fields and `--effort medium` sends medium on the extra variant; the recorded side has `ms` and token counts from a fake `usage`; the report shows average latency and escapes the prompt label; the hash test of the frozen file; results without the new fields render.
- [ ] **Step 2: Run** the eval test files — expect FAIL.
- [ ] **Step 3: Implement** as specified (no change under `src/` beyond what Task 9 added).
- [ ] **Step 4: Run** `npm test` — expect PASS.
- [ ] **Step 5: Commit** `feat: evaluation can compare prompts and effort and shows latency`.

### Tasks 11-13 (controller)

- Task 11: real run 1 (authorised): `--also-model claude-sonnet-5-5 --only-extra --runs 1 --prompt prePortion` (effort default low): latency, tokens, calories against the earlier columns, names. Report to the owner.
- Task 12: draft a scale-grounded prompt `scripts/eval/prompts/portionV2.js` (opus implementer; general rules only, no food dictionary: compare the plate and the cutlery visible in the photo, known sizes of common cutlery and containers, do not default to a 26 cm plate, avoid inflating portions), a review, then real run 2 (authorised); an optional run 3 for one tweak.
- Task 13: apply the winning prompt as the runtime prompt (restore the pre-portion text or install V2; remove the unused model-only fields and the Task 7 tests accordingly; docs and audit doc), final whole-branch review, owner report with "Rulings I made", PR.

## Self-review notes

- Spec coverage: section 3 → Tasks 1-3 (pin, `today`, streak, stats, browser helpers, tests, docs); section 4 → Tasks 4-6; section 5 → Tasks 7-8; success criterion 1 → verification under three zones in Tasks 1-3 plus the fixed-clock e2e; criteria 4-6 → Tasks 4, 5, 7; criterion 0 → Task 8.
- Spec clarification made here: the spec's rule 6 (density) executes after the weight cap and before the nutrition rules (Task 4); `lastLogDate` ignores days after `today` (Task 2).
- Type names are used consistently: `reconcileItems`, `LIMITS`, `PORTION_ANCHORS`, `PORTION_METHOD`, `pinUtcSession`, `addDaysUtc`, `utcToday`, `nowTimeStr`, `daysBetween`.
