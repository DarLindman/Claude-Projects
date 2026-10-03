# Food Logger — UI redesign (sub-project 4): the personal diary

**Date:** 2026-10-03
**Status:** Draft — awaiting owner review
**Branch:** `ui-redesign` (nothing here touches `main` or the deployed Railway app until merged)
**Scope:** the whole visual layer of `food-logger/public/` (HTML, CSS, fonts, frontend modules' markup and motion) plus two small additive server features the approved design needs (per-item calories in the analysis reply, and meal thumbnails).
**Design reference (approved by the owner, 2026-10-03):** `docs/superpowers/design/2026-10-03-journal-ui-reference.html`. It is a self-contained HTML page with all 11 screens, the capybara and the animations; open it in a browser. It is the visual source of truth; this document says how it becomes the app. (The meal photos in it are replaced by neutral placeholders.)

---

## 1. Context and agreed decisions

The owner was not happy with the current look ("another site made by Claude") and described the original vision: **a warm personal diary, where the analysis of a meal appears as a printed receipt**, with the quality of an Apple product. In a long visual session (several rounds of mock-ups, 2026-10-03) the owner decided:

- **Concept:** a dark leather diary cover around cream ruled pages. Handwriting for text, a thermal-printer receipt for the analysis, polaroid photos taped to the page with washi tape, red-pen circles around calories, a hand-written tally for the streak, red ink buttons, index tabs.
- **Capybara:** the **original** one (the SVG in `index.html`, `<template id="capy-tpl">`) with a very light "drawn" treatment (thin soft outline, soft shading, fur ticks), **no light patch on the head**, a smile that stays inside the snout, and a **"loaf" pose with larger paws** instead of four circles. The original salad bowl is back on the welcome screen. On the login, stats, weight and settings screens the capybara **walks along the page** and turns exactly when her body touches a wall (the page edge on one side, the red margin line on the other).
- **Fonts (all self-hosted, no third-party requests):** Gveret Levin for text, Suez One for the wordmark and stamps, Cousine for the receipt (a real Hebrew monospace), and **Playpen Sans Hebrew for every digit** outside the receipt (Gveret Levin's digits are hard to read; the digit font is applied by `unicode-range`, so it works everywhere automatically).
- **Details the owner asked for:** the meal caption only beside the photo (never over it) and no time above the name (the time is under the photo); streak as hand-drawn tally marks; day paging in the diary; per-component calories on the receipt but **no grams and no editing of component weights**; no word "receipt" on the receipt; the red ribbon never covers the days; "יעד 2,000" label outside the bars; a six-button bottom navigation (home, diary, add, stats, weight, settings) where **home and diary are two different buttons**; the add-meal screen shows an obvious "tap to take a photo" area and, after the photo, an explicit "analyze the plate" button instead of a mysterious round red button; the welcome screen keeps the app's original (shortened) feature text.
- **Out of scope by the owner's decision:** accessibility work (do not add effort, but do not remove what exists such as the reduced-motion rules), English, offline mode and a service worker, any change to the AI prompts or models, and showing grams to the user anywhere.

### Success criteria

Done when **all** hold, each verified by running it:

1. Every screen of the reference exists in the app, built on the real data and actions (not static): welcome, login/registration (and the profile step), home, diary, add meal (before and after the photo), analysis in progress, analysis result, stats (weekly, monthly, yearly), weight, settings. The owner reviews screenshots of each (Playwright, mobile viewport) against the reference and approves them.
2. **No third-party requests** from the app (strict CSP unchanged: `font-src 'self'`); the digit font applies to every digit outside the receipt and the phone's own status bar: a Playwright test walks all screens and fails on any digit run not rendered in the digit font.
3. The walking capybara never overlaps a wall: a test measures her visible body at many animation times and asserts it stays between the two walls and touches them (within 6 px).
4. Motion (print-out of the receipt, stamp, polaroid drop, capybara breathing/walking, page transitions) is smooth on a mid-range phone and **disabled under `prefers-reduced-motion`**.
5. The diary shows meal thumbnails (section 5) with a neutral illustrated placeholder for meals without a photo; deleting a meal deletes its thumbnail; one user can never read another user's thumbnail (tests).
6. The analysis reply carries per-item names and calories (section 4), without weights; the receipt shows exactly those.
7. All existing suites pass at every hour (API and Playwright) after being updated for the new markup; the Hebrew spelling guard passes; the Hebrew copy audit is regenerated; the Hebrew baseline snapshot is re-recorded with a per-key old → new list showing only intended copy and data changes; `npm audit --omit=dev` is clean.
8. Weight of the app: fonts at most 300 KB in total (subsets), the page without photos at most 1 MB.

---

## 2. Current state (verified by reading the code)

- Dark espresso theme with orange accent: tokens in `public/css/tokens.css`, 5 CSS files, `public/index.html` (markup of every screen, 55 KB), one JS module per screen under `public/js/screens/` with `data-action` delegation (`events.js`), no build step.
- Fonts in `public/fonts/` are Latin-only (Fraunces, DM Sans, IBM Plex Mono); Hebrew falls back to the device font, so digits and Hebrew look unrelated.
- The capybara lives in `<template id="capy-tpl">` with the state classes `pet--happy|ecstatic|sad|sleeping|surprised|thinking` (CSS in `base.css`, logic in `js/pet.js`: `cloneCapybara`, `getPetState`, `PET_MESSAGES`, a walking stage on the stats screen).
- `POST /api/analyze` and `/api/analyze-text` return only `foodName` and totals; the items the model produced are summed and discarded. Meal photos are not stored (`food_logs` has no photo).
- The bottom navigation already has six buttons (dashboard, diary, add, stats, weight, settings).

---

## 3. Design system

Tokens replace `tokens.css` (names kept where the code already uses them, new ones added):

| Token | Value |
|---|---|
| leather | `#22140c` (cover, with a fine noise texture and a dashed gold stitch line) |
| page | `#f5ecd9` (cream; darker toward the spine on the right; 3-step page-edge shadow below) |
| ink | `#2b1f16`; graphite `#6f5d4c`; red pen `#b3311d`; gold foil `#d2a95a` |
| rule lines | every 30 px, `rgba(112,138,170,.30)`; red margin line 46 px from the right |
| lift (shadow) | `0 1px 1px rgba(40,22,8,.28), 0 6px 12px rgba(40,22,8,.20), 0 20px 34px rgba(40,22,8,.26)` (light from top-left) |
| motion | spring `cubic-bezier(.34,1.56,.64,1)`, out `cubic-bezier(.22,1,.36,1)`; 150/250/400 ms |

Components (each described and shown in the reference): leather cover and stitched frame, ruled page, polaroid with washi tape, red-pen circle, handwritten field (underline), stamp chip, red ink button, index tabs (stats, at the bottom of the page), receipt (serrated bottom edge, dotted leaders, grain, taped on), speech bubble, bottom dock (six buttons, active one highlighted, the add button an orange pill), ribbon bookmark (below the weekday row), tally marks.

**Fonts** (OFL licences are copied to `public/fonts/` as the existing ones are): subsets in woff2, Hebrew + Latin + digits, `font-display: swap`:

- `Gveret Levin` — all handwritten text.
- `Suez One` — wordmark "יומן.", cover foil, stamps.
- `Cousine` — the receipt only (Hebrew and numbers both).
- `Playpen Sans Hebrew` — declared a second time as the family `Digits` with `unicode-range: U+0030-0039, U+002C, U+002E, U+003A, U+002F` so digits, thousands separators, decimal points, colons and slashes use it wherever the page font stack lists `Digits` first; Latin letters (a username) fall back to it as well.

**Textures:** paper grain and leather noise are small tiled SVG `feTurbulence` data-URIs (no image files); the capybara's slight hand-drawn wobble is one SVG filter applied to her only (never to large areas).

---

## 4. Server additions

### 4.1 Per-item calories in the analysis reply

`analyzeImage` and `analyzeText` additionally return `items: [{ name, calories }]` (names through the existing `cleanDishName`, at most 8 items; the client adds one `ועוד` row with the remainder calories (total minus the sum of the items) when the items do not add up to the total; calories are the sanity-checked values; **never weights**). The reply keeps all existing fields (`foodName`, `calories`, `protein_g`, `carbs_g`, `fat_g`, `fiber_g`), so older clients keep working. The items are shown on the receipt at analysis time only; they are not stored. Tests: the shape, the 8-item cap, no weight field, names cleaned, a reply with unusable names falls back to a neutral item label chosen with the owner's copy review.

### 4.2 Meal thumbnails

Because the diary and the home screen show the meal as a polaroid, a **small thumbnail is stored with each meal that came from a photo**:

- The client already downscales the photo for analysis; at save time it also makes a thumbnail (JPEG, longest side 480 px, quality about 0.7, typically 25-45 KB) and sends it with `PUT /api/food/:id/photo` (raw `image/jpeg` body, at most 120 KB) right after `POST /api/food`.
- Migration `003_food_photos.sql`: table `food_photos (food_log_id INTEGER PRIMARY KEY REFERENCES food_logs(id) ON DELETE CASCADE, bytes BYTEA NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW())`. Deleting a meal deletes its thumbnail; deleting an account already cascades through `food_logs`.
- `GET /api/food/:id/photo` returns the image to its owner only (`404` otherwise, same as any other id of another user), with `Cache-Control: private, max-age=31536000, immutable` (the thumbnail of a meal never changes) and `Content-Type: image/jpeg`.
- Validation: the body must be a real JPEG (magic bytes; reuse `src/lib/image.js`), at most 120 KB and 640 px on a side (the server never trusts the client); the route is behind the same auth, CSRF and a per-user rate limit.
- Meals without a photo (text analysis, old entries) show a neutral drawn placeholder (a plate), never a broken image.
- Privacy note for the owner: thumbnails are stored in the same PostgreSQL database (Railway); the full-size photo is still never stored.

---

## 5. Screens (reference → app)

Every screen keeps its existing module and `data-action` hooks; the markup and CSS change, the behaviour stays unless listed.

| Screen | Module | What changes |
|---|---|---|
| Welcome | `screens/welcome.js`, `index.html` | Cover with foil title, the original capybara in her salad bowl, the three shortened feature lines with gold line icons, "התחל עכשיו", "כבר יש לי חשבון" |
| Login / registration / profile step | `screens/auth.js` | Handwritten underlined fields, red ink button, the walking capybara |
| Home | `screens/dashboard.js` | Capybara by state with the bubble (existing `PET_MESSAGES`), big handwritten calories eaten with the progress bar, the **tally** for the streak (section 6), last meal as a polaroid with the circled calories |
| Diary | `screens/home.js` | Week strip with arrows (previous/next week; tapping a day opens it; the existing `changeDay` and date logic stay), ribbon under it, meals as polaroid + name and circled calories **beside** the photo (the time only under the photo), "ערוך" and "מחק" (existing actions) |
| Add meal | `screens/camera.js` | Before the photo: one large dashed frame that is the button ("לחץ לצילום", "או בחר תמונה מהגלריה"), meal-type chips, a text line; after: the photo as a polaroid and the red button "נתח את הצלחת"; "צלם שוב" |
| Analysis in progress | `screens/camera.js` / `analysis.js` | The capybara with a magnifier and a bubble ("מחשב כמה יש בצלחת…"), progress bar; no "receipt is ready" text |
| Analysis result | `screens/analysis.js` | Photo, handwritten dish name, large circled calories, the **receipt** (items with calories, total, macros in grams as today; no title; printed from the top with the stamp "נרשם"), buttons "שמור ביומן" and "ערוך" (existing edit of the meal totals; no per-item edit) |
| Stats | `screens/stats.js`, `charts.js` | Index tabs at the bottom edge (weekly / monthly / yearly); hand-drawn bar chart with the goal line and the label above it with an arrow; macro bars; the walking capybara above the tabs |
| Weight | `screens/weight.js`, `charts.js` | Graph on squared paper, entries list, "הוסף שקילה", the walking capybara |
| Settings | `screens/settings.js` | Handwritten list rows, red "התנתקות", the walking capybara |
| Bottom dock | `index.html`, `router.js` | Six buttons: בית, יומן, + (orange), נתונים, משקל, הגדרות; the active one highlighted |

**New or changed Hebrew copy** (the owner approved it by approving the reference; each string goes through the spelling guard and the copy audit): "לחץ לצילום", "או בחר תמונה מהגלריה", "נתח את הצלחת", "צלם שוב", "מחשב כמה יש בצלחת…", "הארוחה שזיהיתי", "נרשם", "ברצף כבר N ימים", "מתוך N", "ועוד" and the welcome feature lines in the shortened form shown in the reference. Existing strings that stay are not touched.

---

## 6. The capybara and motion

- **Drawing:** the original SVG stays the source; at runtime the clone gets: a thin soft outline (`#6b4426`, 1.15, 70 % opacity) on the tan shapes only, a tiny displacement + blur filter, soft body/head shading, faint cheeks, fur ticks, a ground shadow, the corrected smile path, and the loaf legs (two big paws with toes) instead of the four ellipses. The welcome screen adds the salad bowl (original colours). The code for this is one function (`decorateCapybara(svg, opts)`) next to `cloneCapybara` in `js/pet.js`.
- **States:** unchanged names (`ecstatic`, `happy`, `neutral`, `sad`, `sleeping`, `surprised`, `thinking`) and unchanged selection logic (`getPetState`).
- **Walking:** a lane inside the page (`left` wall = page edge, `right` wall = the red margin line); the lane's travel distance is computed from the visible bounding box of her body (not the SVG box), the direction flips with `scaleX(-1)` at the wall with no pause, with the existing walk bob. Only on login, stats, weight and settings.
- **Tally:** `js/tally.js` draws the streak as SVG strokes (four strokes crossed by a fifth, then the remainder), with small deterministic per-stroke jitter (seeded by the stroke index, not random per render), drawn twice with a faint offset to look like pen pressure.
- **Receipt print-out:** the receipt slides out of the printer slot top-down with `clip-path` (about 1.4 s), the stamp lands with a spring at the end; polaroids drop in with a slight rotation. All motion off under reduced motion.

---

## 7. Testing

- **API (`node --test`):** analysis `items` shape and cap (image and text, fakes only); `food_photos` migration (applies on a fresh and on a migrated database); `PUT/GET /api/food/:id/photo`: owner only, 404 for others, size/type/dimension rejection, cascade delete with the meal, rate limit, CSRF; isolation test extended.
- **Playwright:** every screen opens with real data; the digit-font test (all digits outside the receipt in the digit font, no non-self requests); the walking-bounds test; day paging in the diary; delete; add-meal flow before/after the photo; the receipt shows the items from the fake analysis and no grams; reduced-motion test; the midnight test and the existing suites updated.
- **Hebrew:** spelling guard, copy audit regenerated, baseline snapshot re-recorded with a per-key list.
- **No real AI calls** in any test.

---

## 8. Rollout and risks

- One branch, built screen by screen behind no flag (the old UI is replaced), merged by one PR; Railway deploys on merge. Because the owner sees only screenshots until then, the plan includes a **preview step**: run the branch locally against the test database and send the owner screenshots of every screen before the PR.
- Risk: heavy SVG filters on old phones → filters only on the capybara and the textures are static data-URIs; measured with a throttled-CPU Playwright run.
- Risk: the Hebrew handwriting fonts' metrics differ from the fallbacks → `font-display: swap` plus a metric-matched fallback stack; layouts use fixed 30 px rows and tested widths.
- Risk: storing thumbnails grows the database → at most 120 KB each, typically 25-45 KB; revisit with a per-user cap if open registration is abused.
- Risk: item names on the receipt come from the model and are not yet quality-measured like the dish name → `cleanDishName` plus a neutral fallback; the first deploy's names are checked by the owner.
- Not in this sub-project: accessibility, English, offline, AI changes.
