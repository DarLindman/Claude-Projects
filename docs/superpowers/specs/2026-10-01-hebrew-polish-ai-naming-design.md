# Food Logger — Hebrew Polish and Natural AI Food Names

**Date:** 2026-10-01
**Status:** Draft — awaiting owner review
**Branch:** `hebrew-polish` (nothing here touches `main` or the deployed Railway app until merged)
**Scope:** `food-logger/` Hebrew interface text, and the AI food-name pipeline (`src/lib/analysis.js`): prompts, output guard, evaluation tooling.

This replaces the planned "sub-project 2 (bilingual UI)" for now. The English spec and plan stay saved on branch `i18n` and can be resumed later; the overhaul's sub-projects 3 (precision) and 4 (premium UI) are unchanged.

---

## 1. Context and agreed decisions

The owner decided (2026-10-01) to drop English for now and make the **Hebrew experience flawless**:

- The text of the app must contain **no Hebrew mistakes**: spelling, wording, consistency.
- When a user sends a photo, the AI must not return odd names (for example "קאטלט" instead of "שניצל"), and foreign-script characters (Chinese letters were seen in the past) must never reach the user.
- The fix must come from **general rules and better prompting**, **not** a hard-coded dictionary of foods. A small, documented list of exceptions is allowed **only if there is no other way**.
- **Approach agreed:** improve the prompt in a **single** AI call (no second AI call in the normal path), with an output guard that repairs a bad name only when needed. A second review call is added later only if measurement shows the single-call prompt is not enough.
- The owner will provide 15-30 photos of real meals (including schnitzel) for evaluation; photos stay on the owner's computer only.
- No Hebrew wording is changed without the owner's explicit approval of a correction table.

### Success criteria

Done when **all** hold, each verified by running it:

1. **No foreign-script characters** (anything outside Hebrew letters, digits and basic punctuation) ever reach the user in a dish name, for any AI reply, including replies built to contain Chinese, Latin, Arabic or mixed text; verified by tests with a fake AI and by the evaluation over the owner's photos across repeated runs (zero occurrences).
2. A bad name is **repaired** (one small extra AI call, only when needed) or cleaned safely; the user never sees a truncated or dangling word, and never an empty name.
3. Each repair or cleaning event is logged on the server so the owner can see how often it happens.
4. On the owner's photo set, the new prompt's names are judged **natural by the owner in at least 90%** of the photos, compared side by side with the old prompt's names; every remaining wrong name is handled by improving a general rule, not by adding a per-food entry.
5. The Hebrew copy audit table is approved by the owner and applied; a Hebrew text baseline test and a known-wrong-spellings test pass.
6. All existing suites still pass (`npm test`, `npm run test:e2e`), `npm audit --omit=dev` is clean, and the look of the app is unchanged.

---

## 2. Current state (verified by reading the code and history)

- `src/lib/analysis.js`: `analyzeImage` makes one call (`temperature: 0.1`) with a long Hebrew system prompt and asks for JSON `{"dish_name", "items":[...]}`. The client shows only `dish_name` (as `foodName`); item names are cleaned but not returned.
- The only defence against foreign characters is `cleanHebrew`, which **silently deletes** every character outside Hebrew letters, whitespace, digits and a few punctuation marks. A stray Chinese character in the middle of a name leaves a broken name (for example "חזה עוף עם"); an all-foreign name becomes "מנה".
- For text analysis the shown name is the user's own text, passed through `ensureHebrewFoodName` (a translation call) only when it contains Latin, CJK or Arabic characters.
- The git history shows repeated attempts (commits such as "hebrew fix hopefully final", "fix yet again", "apply cleanHebrew to dish_name to strip foreign characters"), all by deletion rather than prevention.
- The Hebrew UI text is spread over `public/index.html` (about 159 lines), `public/js/**` (errors table, meal labels, pet messages, dates, charts, screens) and the server's prompts. The UI uses "סיסמא" throughout; the standard spelling is "סיסמה".

---

## 3. Design

### 3.1 Prompt: recognise first, then name (single call)

The image prompt is restructured, still one call:

1. The reply JSON gains a first field `visual_description`: a short neutral English description of what is seen (for example "breaded fried chicken cutlet with fries"). It exists only to separate *recognition* from *naming*; the server ignores it and never stores or returns it.
2. `dish_name` is then derived from it under explicit **naming rules** (principles, not foods): the name an average Israeli would say on a menu, in a supermarket or to a friend; the everyday word beats a transliteration, an old-fashioned word or a rare word; a loanword is allowed only when it is the standard Hebrew word (for example "פסטה", "פיצה", "המבורגר"); short and precise (main component plus preparation when it matters, a few words); **Hebrew letters only**.
3. A few short examples illustrate the principles inside the prompt; they are explanation, not a lookup table, and nothing in code depends on them.
4. Existing behaviour that stays: weight-first method for nutrition values, hidden-ingredient reasoning, portion anchors, JSON shape for `items`. Temperature is lowered to `0` for stable naming.
5. The previous prompt is kept verbatim as a frozen copy for side-by-side evaluation only (`scripts/eval/` , never used at runtime).

### 3.2 Output guard: repair, do not delete

New module `src/lib/hebrewName.js`:

- `findForeignScript(name): boolean` — true if the name contains any character outside Hebrew letters (including final forms), digits, whitespace and basic punctuation `-'"(),./`.
- `ensureHebrewDishName(anthropic, name, { context }): Promise<{ name, action }>` with `action` one of `ok`, `repaired`, `cleaned`, `fallback`:
  1. If the name is clean and valid, return it unchanged (`ok`).
  2. If it contains foreign characters, make **one** small repair call ("rewrite this food name in Hebrew letters only, using the everyday Israeli name, output only the name", `max_tokens` small, `temperature: 0`); accept the result only if it passes validation (`repaired`).
  3. If the repair fails or is invalid, **clean carefully**: remove the foreign characters together with any word they touch, collapse spaces, trim (`cleaned`); if nothing valid remains, return the neutral default `מנה` (`fallback`).
- Validation: not empty, at most 6 words and 60 characters, no control characters.
- Every non-`ok` outcome writes a server log line with the action and the original name (no user identifiers).
- `analyzeImage` uses it for `dish_name`; `analyzeText` uses it for the shown name in place of the current `ensureHebrewFoodName` (same trigger, same repair call, same guarantees). Item names are still cleaned with the same function but are not returned.

### 3.3 Evaluation tooling (no hard-coded foods)

- `scripts/eval-naming.js` (developer tool, not part of the test suite, not run in CI): reads photos from `eval/photos/` (git-ignored, never committed), runs each photo **N times (default 3)** through the old and the new prompt using the real API and `.env`, and writes `eval/report.html` (git-ignored) with photo, old name, new names, and automatic flags (foreign characters, repair or fallback used, word count).
- It prints the number of API calls and an estimated cost and refuses to run without `--yes`; the owner approves every real run.
- The owner marks unnatural names in `eval/ratings.json`; rated photos become a **fixed regression set** for later prompt changes. Rules are improved, never per-food entries, unless documented as a last resort in `docs/hebrew-naming-exceptions.md` (created empty).
- Automatic metric: zero flagged foreign-character occurrences across all runs. Human metric: the owner's 90% "natural" target.

### 3.4 Hebrew copy audit

- `scripts/extract-hebrew-text.js` collects every user-visible Hebrew string (markup text, placeholders, titles, aria labels, JS template strings, the error table, meal labels, pet messages, date names, toasts) into `docs/hebrew-copy-audit.md` as a table: location, current text, proposed text, reason (spelling, wording, consistency of gender and punctuation, quotation marks and abbreviations, tone).
- The owner approves, edits or rejects each row; **only approved rows are applied**.
- **Guards:** `test/e2e/hebrew-baseline.spec.js` visits every screen and modal with a pinned clock and deterministic data and compares all visible text (and placeholder, title, aria-label values) with `test/e2e/__snapshots__/he-text.json`; after the audit the snapshot is updated deliberately. `test/api/hebrew-spelling.test.js` scans `public/index.html`, `public/js/**` and `src/` messages for a short list of known wrong forms (for example "סיסמא") so they cannot return.

---

## 4. Testing and verification

- **Unit tests (`node --test`):** `findForeignScript` on table-driven inputs (Hebrew with nikud, digits, punctuation, Chinese, Latin, Arabic, mixed, empty); `ensureHebrewDishName` with a fake AI for each path: clean, repaired, repair returns garbage then cleaned, repair throws then cleaned, all-foreign then fallback, foreign character at the start, middle and end, a name of only punctuation, an over-long name; a repaired name is never returned unvalidated; log lines emitted per action.
- **Route tests:** analyze image and text with a fake AI that returns foreign characters in `dish_name` produce a valid Hebrew name; the `visual_description` field never appears in the response; existing analyze tests stay green (updated only where the prompt changed).
- **Prompt tests:** the new prompt contains the naming rules and the JSON contract; the frozen old prompt for evaluation matches the original byte-for-byte (hash).
- **Browser tests:** the Hebrew baseline and the existing journeys (smoke, hardening, handlers, XSS) pass unchanged except for the deliberately updated copy.
- **Evaluation:** run on the owner's photos with the owner's approval; report attached for review.

---

## 5. Rollout and rollback

- Branch `hebrew-polish`, merged through a pull request after the owner's review. Server-side behaviour change only (no schema change, no new dependency).
- Rollback is a plain revert of the merge.
- `CLAUDE.md` gains a short "Hebrew copy and AI naming" note (how to run the evaluation, the spelling guard, the rule against per-food hard-coding).

---

## 6. Non-goals

English or any other language (saved on branch `i18n`); per-food dictionaries; changes to nutrition accuracy or time zones (sub-project 3); switching to structured tool output; a second AI review call in the normal path (only if the evaluation shows it is needed); visual changes (sub-project 4).

---

## 7. Risks and owner items

1. **Evaluation needs the owner's photos** (15-30, including schnitzel and other typical meals) and the owner's judgement of the names; without them the 90% target cannot be measured.
2. **Model variance:** even a good prompt can occasionally produce a strange name; the guard covers foreign characters but not taste, so taste is measured by the evaluation and improved by rules.
3. **Copy decisions are the owner's:** every proposed wording change waits for approval; a few may be judgement calls between two correct forms.
4. **API cost:** each evaluation run costs a few cents and needs the owner's "yes".
