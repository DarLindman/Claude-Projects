# Food Logger — Precision (sub-project 3): consistent dates, sane numbers, better portion estimates

**Date:** 2026-10-02
**Status:** Draft — awaiting owner review
**Branch:** `precision` (nothing here touches `main` or the deployed Railway app until merged)
**Scope:** `food-logger/` date handling (database session, routes `streak`, `stats`, `weight`, `food`, frontend date helpers) and the nutrition numbers and portion sizes returned by the AI analysis (`src/lib/analysis.js`, new `src/lib/nutrition.js`, prompts).

Sub-project 3 of the overhaul. Sub-project 1 (foundation and security) and the Hebrew polish are merged and live; English (branch `i18n`) and the premium UI (sub-project 4) stay out of scope.

---

## 1. Context and agreed decisions

The owner chose "precision" to mean all three parts (2026-10-02):

- **Part 1, dates:** days, the streak and the weekly/monthly/yearly numbers must be right at every hour of the day, with no "meal that jumps to another day" around midnight.
- **Part 3, portions (added later the same day):** the AI must estimate how much food is on the plate as accurately as possible, for any food, by a general method and not per-dish hard-coding. Scope **A**: improve the estimation prompt and the server-side checks only; the result screen does not change. Showing grams per item for the user to correct was offered and deferred (it is a screen change with new Hebrew text; a candidate for sub-project 4). Evidence: the same photo of a meat dish got 920 kcal with one prompt version and 622 kcal with another.
- **Part 2, numbers:** the nutrition values the AI returns must be checked by deterministic rules in code (approach **A**, sanity checks). Rejected for now: a double estimate (two calls, averaged) and an external nutrition database.
- **Exactly one real AI run is authorized** (owner, 2026-10-02): a single pass of the existing evaluation tool (`--runs 1`, 30 photos, about 30 calls, roughly 0.4 USD) at the end of Part 2, after everything else passes. It answers three open questions: do the names stay natural after the old recognition hints were removed (never measured), how many items the sanity rules of section 4 would adjust on real replies, and whether the portion method of section 5 gives gram values the owner finds plausible (the report lists the weights per photo next to the calories of the earlier runs; where the owner knows the real weight of a meal, that is the yardstick). No other real AI call is made: every test uses fake replies, and the run is not repeated. Its real-world effect afterwards is read from the numbers-only server log line.
- Hebrew text stays flawless: no user-facing wording is added without the owner's approval; any new text goes through the Hebrew spelling guard (`test/api/hebrew-spelling.test.js`) and the snapshot test.

### Success criteria

Done when **all** hold, each verified by running it:

0. (Parts 2 and 3) the one authorized run shows names still natural (owner judges by report), the number of adjustments the rules make on real replies, and per-photo weights. Target: the owner judges the total weight plausible on at least 90% of the photos, and within +-25% wherever the owner knows the true weight.
1. `npm test` and `npm run test:e2e` pass **at every hour of the day**, including 00:00-03:00 local time (today they fail there). Verified by running the suites on a machine whose database session time zone is not UTC, and by tests that pin the clock inputs near midnight.
2. A meal logged at 23:30 appears in the diary of that same day, edit-and-save never moves a meal to another day, and the streak and the weekly/monthly/yearly totals count it on that day.
3. The result of every date feature depends only on the stored values and on the `today` the browser sends, never on the time zone of the server or of the database server.
4. For any AI reply, the nutrition numbers that reach the user satisfy the rules of section 4 (verified by tests with fake replies that violate each rule), and the analysis never fails because of them.
5. For any AI reply, a weight that contradicts the item's own estimated volume (section 5) is corrected (tests with fake replies); the image prompt asks for the scale reference, the volume and the weight in that order, with no food dictionary added.
6. Each correction is logged as numbers only (no meal text), so the owner can see how often it happens.
7. All existing suites pass, `npm audit --omit=dev` is clean, and the look of the app is unchanged.

---

## 2. Current state (verified by reading the code)

**Dates**
- The browser sends the user's wall-clock time without an offset (`"2026-10-02T01:30:00"`, from `todayStr()` in `public/js/dates.js` and `analysis.js`). The columns are `TIMESTAMPTZ`, so PostgreSQL interprets that string in the **session time zone of the database connection**. On Railway that is UTC, so the wall-clock time is stored as if it were UTC and read back unchanged (the API returns it as an ISO string with `Z`; the frontend slices `slice(0, 10)` and `slice(11, 16)`). The design therefore works only by accident of the server's time zone.
- On a machine whose database time zone is not UTC (the owner's, Israel time) the stored instant shifts by the offset; the date part read back can be the previous day between 00:00 and the offset. `editSave` then re-sends that date, the meal leaves the diary of the day it was logged, and the smoke/handlers e2e specs fail. This is the known pre-existing bug.
- `routes/streak.js` mixes three clocks: `AT TIME ZONE 'UTC'` for the day list, `Asia/Jerusalem` for "today" and `lastLogDate` (which adds 2-3 hours to a wall-clock value that is already local, so after about 21:00 the last log date can be the next day), and `public/js/screens/dashboard.js` has its own Israel conversion.
- `routes/stats.js` and `routes/weight.js` default to `CURRENT_DATE` of the database server; `routes/food.js` falls back to `NOW()` when `logged_at` is missing.

**Numbers**
- `analyzeImage` / `analyzeText` take the `items` of the AI reply and only sum them (`sumItems`): negative or non-numeric values count as 0, but nothing checks that calories match the macros, that macros fit the weight, or that the density is physically possible. Whatever the model returns is what the user sees (and can edit).
- The portion anchors differ between the image prompt (`IMAGE_SYSTEM_PROMPT`: bread 25-30 g, egg 55 g, tablespoon of oil 13 g, butter 14 g...) and the text prompt (`TEXT_SYSTEM_PROMPT`: bread 25 g, oil 13 ml...). They are written twice, by hand.

---

## 3. Part 1 — Dates

### 3.1 Model

Dates stay what the user's clock shows ("wall-clock"): a food diary is about a person's calendar day, not a single instant. Stored data stays valid and **no migration is needed**: values already hold wall-clock time in UTC form.

### 3.2 Changes

1. **Pin the database session to UTC.** `createPool` (`src/db/pool.js`) runs `SET TIME ZONE 'UTC'` on every new connection (`pool.on('connect')`), so `::date`, `TO_CHAR`, `CURRENT_DATE` and string-to-timestamptz casts never depend on the database server's setting. (A startup parameter was rejected because connection poolers can refuse it.) The test helper builds its pool through the same function, so the tests exercise the same session setting.
2. **The browser sends `today`.** A new optional query parameter `today` (`YYYY-MM-DD`, validated by `S.dateStr`) on `GET /api/streak` and `GET /api/stats/weekly`. The server uses it instead of `CURRENT_DATE` / `Asia/Jerusalem`. When it is absent the fallback is the UTC date (documented, used by old clients and tests). `POST /api/weight` already accepts `logged_at`; the frontend now always sends `todayStr()` there instead of `null`, so the server's `CURRENT_DATE` default is no longer reached by the app.
3. **Streak and last log date are computed from the stored wall-clock dates only.** Remove every `AT TIME ZONE` conversion and the `toIsraelDate` helper from `routes/streak.js`; compare against `today` and `today - 1` given by the browser. `public/js/screens/dashboard.js` uses the same local-date helpers (`todayStr`, `addDays`) instead of its own Israel conversion.
4. **One date helper module in the browser.** `public/js/dates.js` already holds `todayStr` / `addDays`; the dashboard, analysis and home screens use only these (no ad-hoc `toTimeString`/`toISOString` date building). A small `nowTimeStr()` joins them for the "current time" default.
5. **`food` POST/PUT keep `logged_at` as is.** The fallback `NOW()` (missing `logged_at`) is documented as UTC and kept: the browser always sends it.
6. **Weekly/monthly/yearly SQL** keeps its shape; with the UTC session its `::date` and `TO_CHAR` give wall-clock days. The default week ends at `today`.

### 3.3 Errors

A malformed `today` is `400 VALIDATION` with the standard error contract (`fields: { today: 'INVALID' }`); no new error codes and no new Hebrew text.

---

## 4. Part 2 — Sanity checks for nutrition numbers

### 4.1 Module

New `src/lib/nutrition.js` with a pure function `reconcileItems(items)` returning `{ items, report }`. Both analyses call it on the parsed `items` before `sumItems`. It never throws and never drops an item; it only makes numbers consistent.

### 4.2 Rules (per item, in this order)

1. A non-finite, missing or negative number becomes 0.
2. **Weight:** `weight_g` above 2000 is capped at 2000 (nobody eats more in one item; a 1.5 litre drink fits); a missing or 0 weight stays 0 (the next rules then skip the weight-based checks).
3. **Macros fit the weight:** `protein_g + carbs_g + fat_g + fiber_g` cannot exceed `weight_g`; when `weight_g > 0` and the sum exceeds it by more than 2%, the four macros are scaled down proportionally to fit. (The AI computes macros from the weight, so the weight is trusted first.)
4. **Calories match the macros:** `expected = 4 * protein + 4 * carbs + 9 * fat` (fibre ignored). When `|calories - expected| > max(40, 20% of expected)`, `calories` becomes `round(expected)`. When the macros are all 0, the calories stay as given (a drink or a supplement can be listed with calories only) but still pass rule 5.
5. **Density:** calories per gram cannot exceed 9 (pure fat is the physical limit); when `weight_g > 0` and `calories > 9 * weight_g`, `calories` becomes `round(9 * weight_g)`.

The numbers in these rules are named constants at the top of the module, covered by tests, and documented in `CLAUDE.md`.

### 4.3 Report and log

`report` is `{ adjusted: <items changed>, calories_delta: <total calories removed or added>, rules: { <rule id>: <count> } }`. `analyze` logs one numbers-only line when `adjusted > 0`, in the same style as the existing usage line (`[analyze] sanity adjusted=N calories_delta=D rules=weight:1,macros:2`). No meal text, name or identifier is ever logged.

### 4.4 Shared portion anchors

The anchors both prompts share (bread, egg, tablespoon of oil, butter, cheese slice, and the like) move into one constant list in `src/lib/prompts.js`; each prompt renders its own wording from it, so a value is written once. The image prompt's ranges (for example bread 25-30 g) and the text prompt's fixed defaults are kept where they are intentionally different; a test asserts that every shared item has one source of truth and that the two prompts contain no contradicting number for the same item. The prompts' behaviour is otherwise unchanged (no food dictionary is added).

---

## 5. Part 3 — Portion estimation from the image

Image analysis only (the text analysis already has explicit quantities and defaults).

### 5.1 Method in the prompt (general, no per-dish rules)

`IMAGE_SYSTEM_PROMPT` replaces the one-line "step 3 — quantities" with a short procedure the model follows in order:
1. **Scale:** find a reference of known size in the photo (a standard dinner plate is about 26 cm, a fork about 19 cm, a hand, a cup, a bottle, a slice of bread, a packaged product) and state it.
2. **Size:** for each item estimate its dimensions in centimetres and from them its **volume in millilitres**, allowing for height (a mound, a bowl's depth).
3. **Weight:** convert volume to grams with a general density for the *kind* of food (dense solids, cooked grains and mashed food, chopped vegetables, leafy greens, liquids, oils, baked goods) written as physical classes, not as dishes; then compute calories from the weight as today.
4. **No visible reference:** assume the portion usual for that kind of dish; restaurant portions are larger than they look (this line already exists and stays). Existing portion anchors stay, now from the shared list of 4.4.

The reply gets two **model-only** fields (never returned, stored or logged, like `visual_description`): a top-level `scale_reference` (short English phrase) and, in each item, `volume_ml` (number). The order the model writes them stays: description, scale, draft name, final name, then the items with volume before weight before calories. Expected extra output is about 100 tokens per analysis (roughly +0.002 USD at Sonnet prices); `max_tokens` already has room.

### 5.2 Server check (rule 6 of `reconcileItems`)

For an item with `volume_ml > 0` and `weight_g > 0`: the density `weight_g / volume_ml` must lie within **0.05 to 1.6 g/ml** (popcorn and foam at the bottom, dense fat, honey and nut butter at the top). Outside it, `weight_g` is moved to the nearest bound and the item's calories and macros are scaled by the same factor, so the numbers stay consistent. The bounds are named constants. The check applies the model's own reasoning to itself; it cannot tell which of the two numbers was wrong, which is why the one real run counts how often it fires before the bounds are trusted.

### 5.3 Evaluation tool

`scripts/eval-naming.js` records, for each reply, the items' `weight_g`, `volume_ml` and calories and the sanity report, and `report.html` shows the grams and total calories per photo next to the calories of the earlier runs (`eval/results-*.json`, calories only). The authorized single run (section 1) is the only real use.

## 6. Out of scope

Grams per item on the result screen (deferred), external nutrition database, double estimates, per-user time zones, English, any visual change, new user-facing text, switching the text analysis away from Haiku, and migrating or rewriting stored data.

## 7. Testing

- **API (`node --test`):** `nutrition.test.js` (including the density rule 6); an analysis-prompt test that the image prompt asks for scale, volume and weight in order and contains no food dictionary; (each rule, order, boundaries, never throws, idempotent on already-consistent items); analyze tests with fake replies that violate each rule and a log-line test (numbers only); `streak.test.js` / `stats.test.js` / `weight.test.js` with `today` near midnight and a database session set to a non-UTC zone to prove independence; a `pool.test.js` case for the session time zone; a prompts test for the shared anchors.
- **Browser (Playwright):** the existing smoke and handlers specs run with the machine's own time zone; one more test fakes the browser clock at 23:30 and at 00:30 and checks diary, edit-and-save and the streak.
- **No AI call** is made by any test. The single authorized real run (section 1) is a manual step at the end, with a short report of the names and of the sanity adjustments; it is not part of the test suites. The evaluation tool needs a small addition to record the numbers of each reply for this.

## 8. Risks

- Pinning the session to UTC changes nothing in production (already UTC) but changes results on machines with another zone — intended, and covered by the tests above.
- Rule 4 can overwrite a calories value the model got right while the macros were wrong. The report line lets the owner see how often corrections happen; the thresholds are constants and easy to relax.
- Rule 6 can scale an item the model got right if its volume was the wrong number; the density bounds are wide on purpose and the single run measures how often it fires.
- A longer reply (scale and volume) lengthens each analysis slightly; the average latency of 8 s and the worst case of 75 s are rechecked from the run's log.
