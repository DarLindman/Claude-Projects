# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Two things live here:

1. **Standalone Hebrew HTML files** — single-file apps opened directly in a browser (no build step).
2. **`food-logger/`** — a Node.js/Express PWA with a PostgreSQL backend and Claude AI nutritional analysis.

## food-logger

### Running

```bash
cd food-logger
npm run dev          # node --watch server.js (auto-restarts on change)
npm start            # node server.js (production)
```

### Environment variables (`.env` in `food-logger/`, see `.env.example`)

Validated once at startup by `src/config.js`; the process refuses to start (and lists every problem) if anything is invalid.

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string (required) |
| `JWT_SECRET` | Secret for signing session cookies (required, at least 32 characters) |
| `ANTHROPIC_API_KEY` | Claude API key for food analysis (required in production) |
| `ORIGIN` | The exact public URL of the app, e.g. `https://food.example.com` (scheme + host [+ port], no path; one trailing slash is tolerated). Used for the CSRF `Origin` check. Required in production; defaults to `http://localhost:3000` otherwise |
| `PORT` | Server port (defaults to `3000`) |
| `NODE_ENV` | `development` (default), `test` or `production`. Production turns on `Secure` cookies, HSTS and database TLS |
| `TRUST_PROXY` | Number of reverse-proxy hops to trust for the client IP (rate limiting). Default `1` in production, `0` otherwise |
| `DATABASE_CA` | Optional PEM CA certificate. When set, production database TLS is verified against it; when unset, verification is off and a warning is logged |
| `IMAGE_MODEL` | Model for the photo analysis. Default `claude-sonnet-5-5`; must match `^claude-[A-Za-z0-9._-]+$` (a set but blank value is an error: delete the variable to use the default). After changing it, check the server log for `not_found_error`: a mistyped id that fits the pattern makes every photo analysis return 502, and the cause appears only in the log. Back to Haiku without a code change: `IMAGE_MODEL=claude-haiku-4-5-20251001` (on Railway, in the service variables). Text analysis always uses Haiku. See AI below for the cost |
| `TEST_DATABASE_URL` | Database for the integration tests (see Tests). Defaults to `foodlogger_test` on the same server as `DATABASE_URL` |

### Architecture

- **`server.js`** — bootstrap only: loads `.env`, builds the config, pool, Anthropic client and icon, runs migrations, then `app.listen`.
- **`src/`** — the server:
  - `app.js` — `createApp({ config, pool, anthropic, icon, limits })` wires middleware and routers; never calls `listen` (tests import it).
  - `config.js` — env parsing and validation (`loadConfig`).
  - `db/` — `pool.js` (TLS policy), `migrate.js` (runs `db/migrations/*.sql` in order, each in a transaction, under an advisory lock; applied versions are kept in `schema_migrations`) and the migrations (`001_baseline.sql`, `002_token_version.sql`). Tables: `users`, `food_logs`, `weight_logs`, `user_profiles`. Add a schema change as a new numbered migration, never by editing an applied one.
  - `middleware/` — `security.js` (CSP and other headers), `csrf.js`, `auth.js`, `validate.js` (zod), `rateLimit.js`, `errors.js` (error contract).
  - `routes/` — `auth`, `food`, `weight`, `profile`, `stats`, `streak`, `analyze`.
  - `lib/` — `sessions.js` (cookie + JWT), `passwords.js` (bcrypt cost 12), `analysis.js`, `prompts.js` (the analysis prompts and JSON templates), `aiReply.js` (reply text and JSON extraction) and `anthropic.js` (AI), `hebrewName.js` (guard for food names, see "Hebrew copy and AI naming"), `image.js`, `dates.js`, `schemas.js`, `icon.js` (PWA icon generation via `@napi-rs/canvas`).
- **`public/index.html`** — markup only (Hebrew RTL, dark theme); CSS in `public/css/`, JS in `public/js/`, fonts self-hosted in `public/fonts/`.
- **AI** — `POST /api/analyze` (image) calls `config.imageModel` (`IMAGE_MODEL`, default `claude-sonnet-5-5`, chosen because it names meals far better than Haiku) and `POST /api/analyze-text` (free text) calls `MODEL` (`claude-haiku-4-5-20251001`); both return a JSON nutritional estimate. The name-repair call of `hebrewName.js` stays on Haiku. `temperatureFor(model)` and `maxTokensFor(model)` in `analysis.js` are the per-model request rules: an id starting with `claude-haiku` gets `temperature: 0` and `max_tokens: 1500` (the Haiku request is unchanged); every other model gets no temperature (newer models reject it) and `max_tokens: 6000`, because Sonnet may write a thinking block first and its tokens count against the cap. Sonnet costs about 4x more per image analysis than Haiku, and its thinking tokens (billed as output tokens) can push the real cost above that; the caps below bound it. Replies are read by `lib/aiReply.js`: the first text block (plus the text blocks right after it), then the JSON (whole text, an optional code fence stripped, else the first balanced `{…}` / `[…]` span that parses and is an acceptable answer: a non-empty items array, never the prompt's own JSON template, which `analysis.js` builds the prompts from); a reply without a text block or without parseable JSON is `502 AI_UNAVAILABLE`, logged with its block types and `stop_reason`, never its text. Such an unparseable reply is retried once by `withParseRetry` in `analysis.js` (both paths; never an API error, never a reply cut by `max_tokens`), so a retry doubles the cost of that one request while the limiters below still count requests, not calls. A `refusal` is not retried either. The startup log line states both models. Rate limited to 20 requests/hour per **user**, plus a per-**IP** cap of 60 requests/hour shared by both endpoints (registration is open, so per-user alone would let a script mint accounts to multiply billed calls). Knobs: `limits.analyzePerHour`, `limits.analyzePerIpPerHour`.

### Operating the image model

The image analysis defaults to Sonnet (`IMAGE_MODEL=claude-sonnet-5-5`), about 3-5x the cost per photo of Haiku. Set a monthly spend limit in the Anthropic Console. To roll back, set `IMAGE_MODEL=claude-haiku-4-5-20251001` (the Haiku request is unchanged). Every model call of both analyses logs one numbers-only line: `[analyze] image model=<id> in=<input tokens> out=<output tokens> ms=<duration> stop=<stop_reason>` (`[analyze-text] text ...` for text; `in=? out=?` when the reply has no usage, `stop=error` when the call failed). It never holds reply text, names or identifiers; sum `in`/`out` per model to measure the real spend.

### Dates and time (wall-clock model)

- A meal's `logged_at` is the **user's wall-clock time**, not an instant: the browser builds it from its own local date and clock (`todayStr()` and `nowTimeStr()` in `public/js/dates.js`) and the server stores it as sent. `food_logs.logged_at` is a `TIMESTAMPTZ`, so every database session is **pinned to UTC** (`src/db/pool.js`); the stored value and the `YYYY-MM-DDTHH:mm` text read back from it are then the same wall clock, whatever zone the database or the server runs in. The server has no zone of its own and never converts.
- "Today" is the browser's local date. `GET /api/streak` and `GET /api/stats/weekly` take `?today=YYYY-MM-DD` (the frontend always sends it); when it is absent the server falls back to the **UTC** date. The streak and the weekly window count back from that date with plain calendar arithmetic (`addDaysUtc` in `src/lib/dates.js`); the browser does the same with `addDays` / `daysBetween` (via `Date.UTC`, so no zone is involved). There is no Israel (or any other) time-zone conversion anywhere.
- The `day` fields of the stats responses are plain `YYYY-MM-DD` strings (never timestamps), safe to compare with `todayStr()`.
- New browser code must use the helpers in `public/js/dates.js` and must not build date or time strings by hand (`toISOString`, `toTimeString`, `toLocaleString` with a `timeZone`).

### Auth and sessions

- The session is an **HttpOnly, SameSite=Strict cookie `fl_session`** (a JWT, 7 days, `Secure` in production), set by `POST /auth/register` and `POST /auth/login`. The response body holds only the username; JavaScript never sees the token. There is **no `Authorization` header** and no token in `localStorage`.
- The JWT carries `{ id, tv }`. `tv` must equal `users.token_version`, so a revocation is one `UPDATE`: `POST /auth/change-password` and `POST /auth/logout-all` bump `token_version` (every other session dies on its next request); `POST /auth/logout` only clears this device's cookie.
- `GET /auth/me` returns `{ username }` and is how the frontend learns at load time whether it is signed in.
- No cookie: `401 UNAUTHORIZED`. A bad, expired, revoked or orphaned cookie: `401 SESSION_EXPIRED` and the cookie is cleared. A database failure is `500 INTERNAL`, never a 401.
- Login is limited per IP (`/auth/login`, `/auth/register`: 10 per minute) and per username (10 failures per 15 minutes; in memory, so it resets on restart and assumes one instance). Trade-off: anyone who knows a username can lock that account out for up to 15 minutes, which is accepted for a single-user app.
- `POST /auth/change-password` is a bcrypt path behind the session cookie, so it is limited per IP (10 per minute, `limits.changePasswordPerMin`) and per user id (10 wrong current passwords per 15 minutes, `limits.changePasswordFailures`; checked before bcrypt, reset on success; same in-memory caveats).

### CSRF

Every state-changing request (any method except GET, HEAD and OPTIONS) must carry `Origin` equal to the normalised `ORIGIN` (the `Referer` origin is accepted only when `Origin` is absent) **and** the header `X-FL-Client: 1`; otherwise `403 CSRF`, before body parsing or auth. `public/js/api.js` adds the header to every call. When testing with curl or supertest, send both. `loadConfig` is the guard that `ORIGIN` is an exact http(s) origin; `createCsrf` itself only throws when the normalised expected origin is `'null'`.

### Error-code contract

Errors are `{ "error": { "code": "..." } }` (plus `fields: { field: code }` for `VALIDATION`). The server sends **no human-language text**: `public/js/errors.js` maps each code to a Hebrew message (`messageFor(err)`). Adding a new code means adding its Hebrew string there.

### Security headers

A strict CSP on every response (`script-src 'self'`: no inline scripts, no inline event handlers, no eval; `style-src` allows inline `style=` attributes), plus HSTS in production and the other Helmet defaults (see `src/middleware/security.js`). Nothing is loaded from third-party origins: the fonts are served from `public/fonts/`. The frontend never assigns `innerHTML` directly; it builds markup with the escape-by-default `html` tag and `setHtml` in `public/js/dom.js`, and uses `data-action` / `data-change` attributes with delegated listeners (`events.js`) instead of inline handlers.

### Frontend modules (`public/js/`)

Plain ES modules, no build step, entry point `main.js` (registers screens, wires event delegation, boots the session). `api.js` (fetch wrapper, `ApiError`), `errors.js` (code to Hebrew), `session.js` (boot, login state, logout), `router.js` (`navigate`, screen hooks), `state.js`, `dom.js` (`html`, `raw`, `setHtml`, modals), `events.js` (delegation), `dates.js`, `format.js`, `profile.js`, `charts.js`, `effects.js`, `pet.js`, and `screens/` with one module per screen (`welcome`, `auth`, `dashboard`, `home`, `camera`, `analysis`, `stats`, `weight`, `settings`). The only `localStorage` use is the cached `fl_profile` (plus removal of the legacy `fl_token` / `fl_username` keys).

### Tests

```bash
cd food-logger
npm test             # API/integration tests, node:test + supertest (test/api/)
npm run test:e2e     # Playwright browser tests against the real app on port 3100 (test/e2e/)
```

- The tests use a separate PostgreSQL database, `foodlogger_test` by default or `TEST_DATABASE_URL`. `test/helpers/db.js` creates it when missing and **refuses any database whose name does not end in `_test`**, so the tests can never touch the dev database. The tables are truncated between suites.
- Nothing costs money: the Anthropic client is replaced by a fake (`test/helpers/fakeAnthropic.js`), and no test calls an external service.
- `npm test` runs files one at a time (`--test-concurrency=1`) because they share the one test database. Do not run it at the same time as `npm run test:e2e`.
- Playwright needs its Chromium once: `npx playwright install chromium`.
- `test/e2e/midnight.spec.js` runs the diary, an edit-and-save and the streak with a fake browser clock at 23:30 and then 00:30 (`page.clock.install` / `setFixedTime`); the whole e2e suite passes at any hour and in any database time zone (try `PGOPTIONS='-c timezone=America/New_York' npm run test:e2e`).

### Hebrew copy and AI naming

**The guard (`src/lib/hebrewName.js`).** Every AI-produced food name (the image `dish_name` and the shown name of a text analysis) goes through `ensureHebrewDishName(anthropic, name, { mode })`, which never throws on a bad name. It returns `{ name, action }` with `action` one of `ok`, `repaired`, `cleaned`, `fallback`.
- Mode `dish` (image `dish_name`, strict): anything outside Hebrew letters, nikud, digits, plain ASCII whitespace and `- – — ' " ’ “ ” ( ) , . / + & % : ;` is foreign script (Latin, CJK, Arabic, Cyrillic, emoji, control and invisible characters). At most eight words and 70 characters (the prompt asks for about five; a longer name is cut at a word boundary and a dangling connector is trimmed).
- Mode `userText` (text analysis): the text is shown as typed. Only letters of a non-Hebrew script and unsafe invisible characters count as foreign; emoji, punctuation, symbols and digits stay; no word limit, but at most 200 characters (`maxChars`, set by `analyzeText`); the repair is a translation that must keep every other word.
- Order: if the name is foreign, one small repair call to the AI (Hebrew letters only, the everyday Israeli name) -> if that fails or is still foreign, careful cleaning (a foreign character is removed together with the whole word it touches; stray punctuation and dangling connectors are trimmed) -> if nothing valid is left, the neutral default `מנה`. A clean name that is only too long is shortened, never replaced.
- Logging: one `console.warn` line per non-ok outcome, `hebrewName <repaired|cleaned|fallback>: "<name cut to 80 chars>"`. Nothing else about the user's meal is logged.
- **No per-food hard-coding.** A wrong name is fixed by a general rule (the prompt principles or the guard), never by a list of foods. A per-food exception needs the owner's approval and a reason why no general rule covers it, and is recorded in `docs/hebrew-naming-exceptions.md` (the list is empty).

**Prompt principles (`src/lib/prompts.js`, image analysis; `analysis.js` re-exports the prompts).** The model recognises first, then names: the reply starts with `visual_description` (a short neutral English description, a recognition step for the model only), then `draft_name` (a first attempt at the name), then `dish_name` (the final name, written after re-reading the draft against the rules), then `items`. `visual_description` and `draft_name` are never read, returned, stored or logged; a parse failure logs only its kind, the reply length, the block types and `stop_reason`. The name follows general rules (the everyday name an average Israeli would say, only common words in standard spelling, never an invented word or a transliterated foreign dish name, a simple description by main component and preparation when the everyday word is unknown, a correct general name over a specific wrong guess, Hebrew letters only); the examples in the prompt are illustrations of a rule, never a lookup table. The image prompt carries no per-food recognition hints (step 1 of the method is a general sentence about using the whole plate as context); the portion anchors ("עוגני כמויות") are nutrition quantities, not recognition hints, and stay (sub-project 3 may revisit them). Text analysis keeps the user's own words. The frozen old prompt lives in `scripts/eval/imagePromptV1.js` for the evaluation only and a hash test guards it from edits; `src/` must never `require` anything under `scripts/`.

**Naming evaluation (a developer tool, not part of the app).** It runs the same photos through the old pipeline (old prompt + silent name stripping) and the new one (new prompt + guard), several runs each.

```bash
cd food-logger
node scripts/eval-naming.js              # dry run: prints the photo and call counts and an estimated cost, calls nothing
node scripts/eval-naming.js --yes        # really calls the API (ANTHROPIC_API_KEY from .env); options: --dir eval/photos --runs 3
node scripts/eval-naming.js --also-model claude-sonnet-5-5 --yes   # adds a third column: the new pipeline on that model
node scripts/eval-naming.js --also-model claude-sonnet-5-5 --only-extra --yes   # only the extra column, merged into the existing eval/results.json
```

- `--also-model <id>` adds a third variant (the new prompt and guard on another model). It is sent **without the `temperature` parameter** (`analyzeImage(..., { temperature: null })`), because some newer models reject it (`400 temperature is deprecated for this model`); the old/new variants keep their temperature. The "new" variant calls `analyzeImage` without a model, so it runs on Haiku (`MODEL`), not on the production `IMAGE_MODEL`. The guard's repair calls always go to Haiku.
- `--only-extra` (needs `--also-model`) runs only that variant, e.g. after a failed or changed extra run: it reads the existing `eval/results.json` (which must cover the same photo file names and the same `--runs`, otherwise it refuses), keeps the stored old and new results untouched, replaces the extra results and regenerates `eval/report.html`. Its dry run shows only the extra variant's call count and cost.

- Photos go in `food-logger/eval/photos/` (the whole `eval/` directory is git-ignored; the photos are sent only to the Anthropic API). Output: `eval/results.json` and the report `eval/report.html`.
- Optional `eval/ratings.json`: `{ "<file name>": { "natural": true|false, "note": "" } }`; the report then shows the share of natural names.
- The tool goes through `analyzeImage`, so evaluation runs also use the parse retry: a failing photo costs two calls, the dry-run estimate ignores retries, and the retry can hide the intermittent failure rate being measured (the usage lines below show each call).
- **Every real run costs money and needs the owner's approval.** The tests never call the API.

**Hebrew copy workflow (everything the user reads).**
- `node scripts/extract-hebrew-text.js` (from `food-logger/`) collects every Hebrew string into `docs/hebrew-copy-audit.md` and fails if a line with Hebrew is unaccounted for. Run it after changing any user-facing text; the committed table must equal its output (the extractor test checks this part of it).
- Proposals live in `docs/hebrew-copy-proposals.json`, keyed by the exact current text (`{ proposed, reason, level: recommended|optional, decision }`). Workflow: add a proposal -> the owner approves (`decision`) -> change the app text **and delete the entry from the JSON in the same commit** (a leftover entry is stale and fails the extractor test). The file is currently `{}`. A readable summary is in `docs/hebrew-copy-audit-summary.md`.
- `test/api/hebrew-spelling.test.js` fails if a known wrong form returns; add a wrong form that must not come back there.
- `test/e2e/hebrew-baseline.spec.js` compares all visible Hebrew text, per screen, with `test/e2e/__snapshots__/he-text.json`. A copy change updates it deliberately: `UPDATE_SNAPSHOT=1 npm run test:e2e -- hebrew-baseline`, then review the diff line by line before committing.

### Remotion logo (food-logger/remotion/)

Standalone Remotion project that renders the animated salad logo to `public/salad-logo.mp4`.

```bash
cd food-logger/remotion
npm run render    # renders to ../public/salad-logo.mp4
npm run studio    # opens Remotion Studio for preview
```

## Standalone HTML files (`standalone/`)

- **travel-presentation.html** — Slide-based travel presentation (East Asia/Ethiopia). Keyboard/click navigation, CSS transitions.
- **savings-dashboard.html** — Personal savings portfolio dashboard with a newspaper/parchment aesthetic.
- **recycling-game.html** — Drag-and-drop recycling sorting game with scoring.
- **trip.json** — Raw Polarsteps export used as source data when building the travel presentation.

No build step — edit and open directly in a browser. All CSS and JS are inline.

## Style conventions (all files)

- All UI text is in Hebrew; `dir="rtl"` and `lang="he"` on `<html>`. In food-logger, changes to Hebrew text follow the audit workflow (see "Hebrew copy and AI naming")
- CSS variables defined in `:root` for theming
- Error messages shown to the user are in Hebrew (the food-logger server sends error codes; `public/js/errors.js` holds the Hebrew text)
