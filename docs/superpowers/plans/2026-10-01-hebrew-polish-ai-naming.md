# Hebrew Polish and Natural AI Food Names Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make AI dish names natural everyday Hebrew with zero foreign-script characters (general rules, no per-food dictionary), and make the app's own Hebrew text free of mistakes through an owner-approved audit.

**Architecture:** One new pure-ish module (`src/lib/hebrewName.js`) guards every name that reaches the user: detect foreign script, repair with one small AI call only when needed, otherwise clean carefully. The image prompt is restructured (recognise first, then name by general rules) in the same single call. A developer evaluation script compares old and new prompts on the owner's photos. The Hebrew copy audit is a generated table the owner approves before anything is changed, protected afterwards by a text-baseline test and a known-wrong-spellings test.

**Tech Stack:** Node 24, Express 4, `@anthropic-ai/sdk`, `node --test`, supertest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-01-hebrew-polish-ai-naming-design.md` (read it first). Paths are relative to `food-logger/` unless they start with `docs/`.

## Global Constraints

- **No per-food hard-coding.** Naming quality comes from general rules in the prompt. A list of exceptions is allowed only as a documented last resort in `docs/hebrew-naming-exceptions.md` (created empty, empty at merge unless the owner approves an entry).
- Single AI call in the normal path (no second review call). The only extra call is the **repair call**, made only when a name contains foreign script.
- Foreign script means any character outside: Hebrew letters (U+0590-U+05FF including final forms, geresh/gershayim and nikud), ASCII digits, whitespace, and this punctuation set: `- – — ' " ’ “ ” ( ) , . / + & % : ;`. Emoji and every other script (Latin, CJK, Arabic, Cyrillic) are foreign.
- Validation of an AI `dish_name`: not empty, at most **6 words and 60 characters**, no control characters. The text-analysis path validates the user's own text differently: not empty, at most **200 characters** (the food-name limit), no control characters, **no word limit** (a long Hebrew description typed by the user must stay unchanged).
- A failure of the repair call never fails the analysis: fall back to careful cleaning, then to the default `מנה`.
- Every non-`ok` outcome (`repaired`, `cleaned`, `fallback`) logs one server line with the action and the original name, no user identifiers.
- The old image prompt stays available verbatim **only** for evaluation (`scripts/eval/`), never at runtime; the runtime image prompt changes; `temperature` for naming becomes `0`; the JSON contract for `items` and the nutrition method (weight first, hidden ingredients, portion anchors) stay.
- `visual_description` (new reply field) is never stored, logged with user data, or returned by the API.
- Evaluation photos live in `eval/photos/` (git-ignored, never committed or pushed). Every real evaluation run needs the owner's explicit approval and prints an estimated cost first.
- No Hebrew wording in the app changes without the owner's approval of the audit table rows; look and behaviour otherwise unchanged; English is out of scope.
- Server files <= ~250 lines. Commit after every task; messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

Inputs the spec implies but its listed tests do not cover. Each has a test in the named task.

1. Legitimate names with punctuation or digits must NOT trigger a repair call: `2 ביצים`, `קפה - נס`, `שווארמה 50%`, `עוף + אורז`, `קק״ל`-style gershayim, typographic quotes/dashes (Task 1).
2. Emoji or decoration in a name (`🍗 שניצל`) must be treated as foreign and removed or repaired; a name of only punctuation, digits or whitespace becomes `מנה` (Task 1).
3. A dangling connector left after removing foreign text (`חזה עוף עם 米飯` must become `חזה עוף`, not `חזה עוף עם`) (Task 1).
4. The AI returns a malformed reply: `dish_name` missing, `null`, a number, an array or an object; `visual_description` missing or very long; `items` missing: no crash, a valid Hebrew name or `מנה`, never a 500 caused by the name (Task 3).
5. The repair call itself fails (rejects, times out, returns English or an empty string): the analysis still succeeds with a cleaned name and the nutrition values (Task 2).

---

### Task 1: The Hebrew-name guard module

**Files:**
- Create: `src/lib/hebrewName.js`, `test/api/hebrewName.test.js`
- Modify: `test/helpers/fakeAnthropic.js`

**Interfaces:**
- Produces in `hebrewName.js`: `REPAIR_SYSTEM_PROMPT` (English instruction starting with the fixed prefix `You are a Hebrew food-name editor.`: rewrite the given food name using Hebrew letters only and the everyday name an average Israeli would say; output only the name), `findForeignScript(name: string): boolean`, `isValidDishName(name: string, { maxWords = 6, maxChars = 60 } = {}): boolean`, `cleanDishName(name: string): string` (removes each foreign character together with the whole word it touches, collapses whitespace, trims, strips leading/trailing punctuation and dangling connector words `עם`, `של`, `על`, `את`, `או`), `ensureHebrewDishName(anthropic, name, options?): Promise<{ name: string, action: 'ok'|'repaired'|'cleaned'|'fallback' }>` with `options = { maxWords, maxChars, log = console.warn }`, and `DEFAULT_DISH_NAME = 'מנה'`.
- Behaviour of `ensureHebrewDishName`: non-string or empty input → `fallback`; a name with no foreign script that passes validation → `ok`, unchanged, **no AI call**; foreign script present → one repair call (`model: MODEL`, `temperature: 0`, small `max_tokens`, `REPAIR_SYSTEM_PROMPT`), its first line trimmed and quotes stripped, accepted only if it has no foreign script and passes validation → `repaired`; otherwise `cleanDishName(name)` and if that passes validation → `cleaned`; otherwise `fallback`. The repair call failing for any reason is treated like an invalid reply. One log line per non-`ok` outcome.
- `fakeAnthropic()` recognises a repair call by the prompt prefix and answers with a configurable reply (`fake.repairReply`, default a fixed clean Hebrew name), recording the call; its existing translator behaviour stays until Task 2 replaces it.

- [ ] **Step 1: Write failing tests** (`hebrewName.test.js`): `findForeignScript` table: Hebrew with nikud, with digits and each allowed punctuation mark, `2 ביצים`, `קפה - נס`, `שווארמה 50%`, `עוף + אורז`, gershayim `קק״ל` → false (Review Focus 1); Chinese, Latin, Arabic, Cyrillic, emoji, mixed Hebrew+Latin → true. `cleanDishName`: `חזה עוף עם 米飯` → `חזה עוף` (Review Focus 3), foreign char at start, middle and end, `🍗 שניצל` → `שניצל`, only-foreign → empty string. `ensureHebrewDishName` with the fake: clean name → `ok` and **zero calls**; foreign name + valid repair → `repaired` with exactly one call using `REPAIR_SYSTEM_PROMPT`; repair returns English, empty, or a 10-word sentence → `cleaned`; repair rejects → `cleaned`; all-foreign + failing repair → `fallback` (`מנה`); input `'!!! 123'`, `''`, `null`, `42` → `fallback` (Review Focus 2); a name of 7 words with `maxWords: 6` fails validation, with `maxWords: Infinity, maxChars: 200` passes; a repaired name is validated before being returned; each non-`ok` outcome calls `log` once, `ok` never.
- [ ] **Step 2:** Run `npm test`; expected FAIL (module missing).
- [ ] **Step 3:** Implement the module as specified (Unicode-aware character class for the allowed set; word removal by splitting on whitespace).
- [ ] **Step 4:** Run `npm test`; expected PASS. Commit `feat: Hebrew dish-name guard with repair and careful cleaning`.

---

### Task 2: Use the guard in both analysis paths

**Files:**
- Modify: `src/lib/analysis.js`, `test/helpers/fakeAnthropic.js`, `test/api/analyze.test.js`
- Create: `test/api/analyze-guard.test.js`

**Interfaces:**
- Consumes: `ensureHebrewDishName`, `DEFAULT_DISH_NAME` (Task 1).
- Produces: `analyzeImage` returns `foodName` from `ensureHebrewDishName(anthropic, parsed.dish_name, {})`; `analyzeText` returns the user's text passed through `ensureHebrewDishName(anthropic, text.trim(), { maxWords: Infinity, maxChars: 200 })` (same trigger as the old `ensureHebrewFoodName`, same guarantees plus the new ones); item names are still cleaned with `cleanDishName` but not returned; `ensureHebrewFoodName` is removed from the exports (and its use sites) because the guard replaces it.

- [ ] **Step 1: Write failing tests** (`analyze-guard.test.js`, through the real routes with `signedIn`): image reply with `dish_name` `חזה עוף 米飯` and a configured repair reply → response `foodName` is the repaired name, repair call made once, nutrition totals unchanged; repair throws → `foodName` `חזה עוף`, response 200 with totals (Review Focus 5); reply with a clean Hebrew name → no repair call; text path: `salad` (Latin) → repaired/translated name via the fake; a **12-word Hebrew description** typed by the user comes back unchanged (no validation cut) and without any AI repair call; 201-character text is rejected by the existing validation, not by the guard. Update the two existing assertions in `analyze.test.js` that depended on the old silent stripping and the old translator (`עוף עם אורז plate`, `translates a non-Hebrew name via ensureHebrewFoodName`) to the new guard behaviour, with a comment saying why.
- [ ] **Step 2:** Run `npm test`; expected FAIL.
- [ ] **Step 3:** Implement: replace `cleanHebrew` usage for `dish_name` and the translator call in `analyzeText`; update the fake so a repair call is answered by `fake.repairReply` and the old `You are a translator` branch is removed.
- [ ] **Step 4:** Run `npm test` and `npm run test:e2e` (the smoke journey uses the fake analysis); expected PASS. Commit `feat: use the Hebrew-name guard for image and text analysis`.

---

### Task 3: Recognise-then-name prompt

**Files:**
- Modify: `src/lib/analysis.js`, `test/api/analyze.test.js`
- Create: `scripts/eval/imagePromptV1.js`, `test/api/analysis-prompt.test.js`

**Interfaces:**
- Produces: a new `IMAGE_SYSTEM_PROMPT` and user message in `analysis.js`: the reply JSON is `{"visual_description":"<short neutral English description>","dish_name":"<Hebrew>","items":[...same as today...]}` and the model is told to fill `visual_description` first; the prompt holds the naming rules from spec 3.1 as principles (the name an average Israeli would say on a menu, in a supermarket or to a friend; the everyday word beats a transliteration, an old-fashioned or a rare word; a loanword only when it is the standard Hebrew word; short and precise, main component plus preparation when it matters, at most a few words; Hebrew letters only), with a few short illustrative examples that are **explanation, not a lookup table** (code must not reference them); `temperature: 0`. `parseImageReply` ignores `visual_description` entirely (it is not returned, stored or logged). `scripts/eval/imagePromptV1.js` exports `IMAGE_SYSTEM_PROMPT_V1` and `imageUserMessageV1`, byte-identical copies of the prompt and user text as they are today (commit `929c25d`).
- The nutrition method text of the prompt (weight first, hidden ingredients, portion anchors) is kept as it is today.

- [ ] **Step 1: Write failing tests** (`analysis-prompt.test.js`): the runtime prompt mentions `visual_description` and `dish_name` and contains the naming principles (assert on stable key phrases you choose in the prompt and list in the test); a frozen SHA-256 of `IMAGE_SYSTEM_PROMPT_V1` equals the hash of the old prompt from `git show 929c25d:food-logger/src/lib/analysis.js` (record the hash in the test); `analyzeImage` call arguments have `temperature: 0`; the route response never contains a `visual_description` key even when the reply has one; malformed replies (Review Focus 4): `dish_name` missing, `null`, `42`, `['x']`, `{}` each give 200 with `foodName` `מנה`; `visual_description` of 50 KB is ignored without error; an `items`-less reply is the existing 502 `AI_UNAVAILABLE`.
- [ ] **Step 2:** Run `npm test`; expected FAIL.
- [ ] **Step 3:** Write the new prompt (Hebrew instructions with the English `visual_description` field) and the frozen V1 copy; adapt the fake to return `visual_description` in image replies.
- [ ] **Step 4:** Run `npm test` and `npm run test:e2e`; expected PASS. Commit `feat: image prompt recognises first, then names by general rules`.

---

### Task 4: Evaluation tooling

**Files:**
- Create: `scripts/eval-naming.js`, `scripts/eval/report.js`, `docs/hebrew-naming-exceptions.md`, `test/api/eval-naming.test.js`
- Modify: `.gitignore` (add `eval/`)

**Interfaces:**
- Produces: `node scripts/eval-naming.js [--dir eval/photos] [--runs 3] [--yes]`: loads photos (jpg, png, webp, gif) from the directory, prints `photos x runs x 2 prompts` call count and an estimated cost (a constant per call documented in the file), **refuses to call the API without `--yes`**, refuses without `ANTHROPIC_API_KEY`, then runs each photo through the V1 prompt and the current prompt and the guard, and writes `eval/report.html` (photo thumbnail, old names, new names, flags `foreign`, `repaired`, `fallback`, word count, summary counts) and `eval/results.json`; an optional `eval/ratings.json` (`{ "<filename>": { "natural": true|false, "note": "" } }`) is merged into the report and summarised as the natural percentage. `scripts/eval/report.js` exports the pure functions the script uses: `summarize(results): object`, `renderReport(results, ratings): string` (HTML-escaped), `flagsFor(name, action): string[]`.
- `docs/hebrew-naming-exceptions.md` is created with a header explaining the rule (empty list; an entry requires the owner's approval and a reason).

- [ ] **Step 1: Write failing tests** (`eval-naming.test.js`, using the fake client and temporary photo files, never the real API): `summarize` and `flagsFor` on table-driven results; `renderReport` escapes hostile names (`<img onerror>`); the script's `run` function (exported from the script for testing) with no `--yes` makes **zero** calls and returns the planned count; with `--yes` and the fake it writes `results.json` and the report; the natural percentage is computed from ratings; missing directory or no photos gives a clear error.
- [ ] **Step 2:** Run `npm test`; expected FAIL.
- [ ] **Step 3:** Implement; make sure `eval/` is git-ignored (verify with `git check-ignore eval/photos/x.jpg`).
- [ ] **Step 4:** Run `npm test`; expected PASS. Commit `feat: naming evaluation tool (old vs new prompt on the owner's photos)`.

---

### Task 5: Owner gate, evaluation run and rule tuning

This task needs the owner; the controller stops and asks, and continues only with the owner's answers.

- [ ] **Step 1:** Ask the owner to put 15-30 real-meal photos (including schnitzel) into `food-logger/eval/photos/` and to approve a run; state the printed call count and cost estimate.
- [ ] **Step 2:** Run `node scripts/eval-naming.js --yes`; open `eval/report.html` for the owner; the owner records unnatural names in `eval/ratings.json` (the controller may write it from the owner's replies).
- [ ] **Step 3 (repeat until the natural rate is >= 90% and there are zero foreign-character flags across all runs):** improve the **general** naming rules in the prompt (never add a per-food entry; record any unavoidable exception in `docs/hebrew-naming-exceptions.md` with the owner's approval), update the prompt test phrases, re-run the evaluation with the owner's approval, commit each iteration `tune: naming rules (<what changed>)`.
- [ ] **Step 4:** Report the final numbers (natural %, foreign flags, repairs per 100 names) to the owner.

---

### Task 6: Hebrew text baseline and copy-audit table

**Files:**
- Create: `test/e2e/hebrew-baseline.spec.js`, `test/e2e/__snapshots__/he-text.json`, `scripts/extract-hebrew-text.js`, `docs/hebrew-copy-audit.md`

**Interfaces:**
- Produces: a Playwright test `hebrew baseline` that visits every screen (`welcome`, `auth` login and register tabs, `dashboard`, `home`, `camera`, `analysis`, `stats` weekly/monthly/yearly, `weight`, `settings`) and opens every modal (`modal-change-pass`, `modal-profile`, `edit-modal`), with the clock pinned (`page.clock.install` to a fixed instant) and deterministic data (fixed username, the fake analysis for one diary entry, one weight), collecting every container's `innerText` plus `placeholder`, `title`, `aria-label` and `alt` values into one JSON compared with the snapshot (captured when `UPDATE_SNAPSHOT=1`, compared strictly otherwise, readable per-key diff). `scripts/extract-hebrew-text.js` writes `docs/hebrew-copy-audit.md`: a table with columns `#`, `location` (file and key or selector), `current text`, `proposed text`, `reason`, `owner decision` (empty), covering `public/index.html` (text nodes and the attributes above), `public/js/**` string literals and template strings containing Hebrew, the client error table, meal labels, pet messages, date names, and user-facing server messages; the proposed/reason columns are left for the reviewer.

- [ ] **Step 1:** Write the baseline test; record the snapshot on the untouched UI (`UPDATE_SNAPSHOT=1 npm run test:e2e -- hebrew-baseline`), then run the whole e2e suite twice to prove stability (not between 00:00 and 03:00 local: a known pre-existing date bug makes the smoke journey fail then).
- [ ] **Step 2:** Write and run the extraction script; check that every Hebrew line found by a plain grep is accounted for (report the count of Hebrew-containing lines per file vs. rows).
- [ ] **Step 3:** A reviewer who reads Hebrew natively fills `proposed text` and `reason` only where a change is warranted (spelling, wording, consistency of gender, punctuation and quotation marks, abbreviations, tone), leaving untouched rows blank; the controller reviews the proposals for plausibility.
- [ ] **Step 4:** Commit `test: Hebrew text baseline; docs: copy audit table (draft)`.

---

### Task 7: Owner gate and applying approved copy changes

The controller stops after Task 6 and sends the owner the table (a readable summary of the proposed changes grouped by reason); this task starts only with the owner's decisions.

**Files:**
- Modify: the files named in the approved rows, `docs/hebrew-copy-audit.md`, `test/e2e/__snapshots__/he-text.json`
- Create: `test/api/hebrew-spelling.test.js`

- [ ] **Step 1: Write the failing spelling test** (`hebrew-spelling.test.js`): scans `public/index.html`, `public/js/**` and `src/` messages for a list of known wrong forms drawn from the approved rows (for example `סיסמא` when approved as `סיסמה`), failing with file and line; the list is an array constant with a comment per entry.
- [ ] **Step 2:** Run `npm test`; expected FAIL on the forms still present.
- [ ] **Step 3:** Apply **only the approved rows** (record each decision in the table's `owner decision` column); update `he-text.json` deliberately for the changed strings and list every changed key in the commit message or the report; run `npm test` and `npm run test:e2e` (3 times); expected PASS.
- [ ] **Step 4:** Commit `fix: approved Hebrew copy corrections`.

---

### Task 8: Docs and final verification

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1:** Add to `CLAUDE.md` a "Hebrew copy and AI naming" section: the guard (`src/lib/hebrewName.js`: what counts as foreign script, repair then clean then `מנה`, logs), the prompt principles and the rule against per-food hard-coding (exceptions file), how to run the evaluation (`node scripts/eval-naming.js`, photos in `eval/photos/` git-ignored, `--yes`, cost note), the Hebrew baseline and spelling tests and how to update them deliberately.
- [ ] **Step 2:** Run `npm test`, `npm run test:e2e` (3 times), `npm audit --omit=dev`; confirm `git status` shows no `eval/` files tracked; confirm the `src/lib/analysis.js` runtime prompt does not import from `scripts/`.
- [ ] **Step 3:** Commit `docs: Hebrew copy and AI naming notes`. Owner items before merge: read the evaluation report numbers, approve the merge through a pull request (merging to `main` deploys to Railway).
