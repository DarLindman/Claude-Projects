# Food Logger Overhaul — Sub-project 1: Foundation & Security

**Date:** 2026-09-29
**Status:** Approved by owner — implementation plan next
**Branch:** `overhaul` (nothing here touches `main` or the deployed Railway app until merged)
**Scope:** `food-logger/` server and frontend structure, authentication, input validation, HTTP hardening, automated tests.

---

## 1. Context

This is the first of four sub-projects that together make up the food-logger overhaul:

1. **Foundation & security** (this spec)
2. Bilingual i18n layer (Hebrew/English, RTL/LTR, locale-aware formatting)
3. Precision (nutrition pipeline, time-zone correctness)
4. Premium UI (typography incl. Hebrew fonts, motion, accessibility, PWA)

Each sub-project gets its own spec, plan and verification. This one builds the base the other three stand on: a codebase that is split into testable units, has a test suite, and is secure enough that later work does not have to revisit it.

### Agreed decisions (from brainstorming, 2026-09-29)

- The app has **one user** (the owner). A one-time forced logout and a forward-only migration are acceptable.
- **No paid services.** Only free/open-source tools. Anthropic calls are mocked in tests so testing costs nothing.
- Frontend stays **native ES modules with no build step**, so Railway keeps deploying with `node server.js`.
- Look and behaviour of the app stay **identical** in this sub-project. Visual changes belong to sub-project 4.
- Tests run on the **local PostgreSQL 17** already installed on the dev machine (separate `foodlogger_test` database), not on a WASM substitute.

### Success criteria

The sub-project is done when **all** of these hold, each verified by running it:

1. Every existing user-visible flow works exactly as before (register, login, log food by photo and by text, edit/delete entries, diary, stats, weight, profile, settings, logout).
2. No auth token is readable from JavaScript (`document.cookie`, `localStorage`, `sessionStorage`).
3. A password change or "log out everywhere" invalidates all previously issued sessions.
4. A strict CSP is served and the app runs with **zero CSP violations** in the browser console.
5. Every API route rejects malformed input with a `400` and a stable error code, never a `500`.
6. The automated suite (API, security, and browser smoke tests) passes, and `npm audit --omit=dev` reports no high or critical findings.
7. `server.js` and `public/index.html` no longer contain application logic beyond bootstrap/markup.

---

## 2. Current state (verified by reading the code)

**Server (`server.js`, 685 lines, one file):** Express app with inline `initDB()`, routes for auth, food CRUD, weight, profile, stats, streak, and two AI endpoints; PWA icon generation via `@napi-rs/canvas`; no tests.

**Frontend (`public/index.html`, 4,836 lines, one file):** ~2,150 lines of CSS, ~1,900 lines of JS, 9 screens (`welcome`, `auth`, `dashboard`, `home`, `camera`, `analysis`, `stats`, `weight`, `settings`), 88 top-level functions, one `apiFetch()` wrapper.

Findings this spec addresses:

| # | Finding | Location |
|---|---|---|
| S1 | 7-day JWT stored in `localStorage` (`fl_token`); any XSS steals it | client |
| S2 | Password change does not revoke existing tokens | `server.js:224` |
| S3 | No CSP / security headers; 74 inline `onclick` + 5 `onchange` handlers make a strict CSP impossible | client |
| S4 | 28 `innerHTML` sites; an `escapeHtml` helper exists but use is manual | client |
| S5 | Input validation is partial: dates, `meal_type` (POST), `weight_kg` range are unchecked, so bad input gives 500 | `server.js:416,622` |
| S6 | Rate limits are per IP with no `trust proxy` (behind Railway all users likely share one IP); the analyze limit is documented as per-user but is per-IP | `server.js:126-127` |
| S7 | bcrypt silently truncates passwords at 72 bytes; min length is 6; cost factor is 10 | `server.js:190` |
| S8 | `JWT_SECRET` is not validated at startup; JWT algorithm is not pinned | `server.js:172-187` |
| S9 | DB TLS uses `rejectUnauthorized:false` | `server.js:118` |
| S10 | Image MIME type is trusted from the client; JSON body limit is 15 MB for every route | `server.js:124,264` |
| S11 | Google Fonts loaded from external origins (blocks a `default-src 'self'` policy) | `index.html:16-18` |
| S12 | `cors()` is enabled although the frontend is served from the same origin | `server.js:123` |
| S13 | 4 known vulnerabilities in dependencies (`npm audit`: 1 low, 1 moderate, 2 high) | `package.json` |

**Out of scope here** (noted so they are not lost): time-zone/day-boundary inconsistencies (sub-project 3), `user-scalable=no` and service worker (sub-project 4), all Hebrew/English work (sub-project 2), Hebrew font choice (sub-project 4).

---

## 3. Server architecture

`server.js` becomes a thin entry point. Application code moves to `src/`:

```
food-logger/
  server.js                 # loads config, builds app, listens
  src/
    app.js                  # createApp({ config, pool, anthropic }) -> express app (no listen)
    config.js               # reads + validates env, exports frozen config
    db/
      pool.js               # pg Pool (TLS options from config)
      migrate.js            # runs numbered migrations
      migrations/
        001_baseline.sql
        002_token_version.sql
    middleware/
      auth.js               # cookie session -> req.user
      csrf.js               # Origin + custom-header check for mutating requests
      security.js           # helmet/CSP, trust proxy
      validate.js           # zod schema wrapper -> 400 with error code
      errors.js             # central error handler
      rateLimit.js          # login (IP + username), analyze (per user)
    routes/
      auth.js  food.js  weight.js  profile.js  stats.js  streak.js  analyze.js
    lib/
      icon.js               # PWA icon generation (moved as-is)
      anthropic.js          # Anthropic client factory + prompt constants (moved as-is)
      passwords.js          # hash/verify, length rules
      sessions.js           # sign/verify session tokens, cookie options
```

Principles:

- **`createApp()` takes its dependencies** (`pool`, `anthropic`, `config`). Tests build the app with a test pool and a fake Anthropic client and never call `listen`. This is what makes the suite free and deterministic.
- **Route handlers keep their current SQL and business logic.** This sub-project moves and hardens; it does not change what queries return. The Anthropic prompts are moved verbatim.
- One file, one responsibility; no file over roughly 250 lines.

### 3.1 Configuration (`config.js`)

Validated at startup; the process exits with a clear message if invalid.

| Variable | Rule |
|---|---|
| `DATABASE_URL` | required |
| `JWT_SECRET` | required, at least 32 characters |
| `ANTHROPIC_API_KEY` | required in production; optional when `NODE_ENV=test` |
| `ORIGIN` | required in production (used by the CSRF Origin check); defaults to `http://localhost:3000` otherwise |
| `PORT` | default `3000` |
| `NODE_ENV` | `development` \| `test` \| `production` |
| `TRUST_PROXY` | number of proxy hops; default `1` in production, `0` otherwise |
| `DATABASE_CA` | optional PEM; when set, DB TLS verifies against it |

`.env.example` is updated to match.

### 3.2 Database and migrations

`initDB()` is replaced by a small migration runner (no new dependency):

- Migrations are numbered `.sql` files, applied in order inside a transaction, recorded in `schema_migrations(version, applied_at)`.
- **`001_baseline.sql`** is the current schema written with `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`, so it is a no-op on the existing database and creates everything on a fresh one.
- **`002_token_version.sql`**: `ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0`. Additive with a default, so the **currently deployed code keeps working against the migrated database** (safe rollback).
- Forward-only. No destructive migration in this sub-project.

DB TLS: keep `rejectUnauthorized:false` **only when** `DATABASE_CA` is unset, and log a startup warning saying so. When `DATABASE_CA` is set, verify against it. (The Railway CA cannot be fetched from here; obtaining it is a manual step listed in section 9.)

### 3.3 Error contract

Errors return `{ "error": { "code": "<STABLE_CODE>" } }` plus, for validation errors, `"fields": { "<name>": "<code>" }`. No human-language text from the server.

- The client keeps a single `errors` table mapping codes to the existing Hebrew strings, so **users see the same messages as today**. This table is the hook sub-project 2 extends with English.
- Unexpected errors return `500 INTERNAL` and are logged server-side with a request id; internals never reach the client.
- Codes cover at least: `UNAUTHORIZED`, `SESSION_EXPIRED`, `CSRF`, `VALIDATION`, `INVALID_CREDENTIALS`, `USERNAME_TAKEN`, `WEAK_PASSWORD`, `PASSWORD_TOO_LONG`, `RATE_LIMITED`, `NOT_FOUND`, `IMAGE_INVALID`, `AI_UNAVAILABLE`, `INTERNAL`.

---

## 4. Security design

### 4.1 Sessions (fixes S1, S2, S8)

- **Cookie `fl_session`**: `HttpOnly`, `SameSite=Strict`, `Path=/`, `Secure` when `NODE_ENV=production`, lifetime 7 days (same as today). The JWT is signed with HS256, the algorithm is **pinned** on verify, and the payload is `{ id, tv }` where `tv` is the user's `token_version`.
- `SameSite=Strict` is sufficient because the HTML is static and all authenticated traffic is same-site `fetch`.
- **Verification** loads the user's current `token_version` (one indexed primary-key query per request) and rejects the session if it differs. That is how revocation works.
- **Revocation:** `token_version` is incremented on password change and on a new endpoint `POST /auth/logout-all`. Plain `POST /auth/logout` only clears the cookie for the current device, so signing out on the phone does not sign out the laptop.
- **New endpoint `GET /auth/me`** returns `{ username }` so the client no longer stores the username or token. `fl_profile` (non-secret profile cache) stays in `localStorage`.
- The `Authorization: Bearer` header is no longer accepted. Existing tokens in users' browsers stop working: a **one-time logout**, accepted.
- **Registration flow:** the current client holds a "pending token" between registration and the profile step (`index.html:3099`). With cookies, registration sets the cookie and later calls just work; that client logic is simplified accordingly.

### 4.2 CSRF

Cookie auth needs CSRF protection. Three layers on every non-`GET`/`HEAD` request:

1. `SameSite=Strict` cookie.
2. `Origin` header (or `Referer` fallback) must equal `config.ORIGIN`, else `403 CSRF`.
3. A required custom header `X-FL-Client: 1` set by the client's `apiFetch`, which a cross-site form cannot send.

`cors()` is **removed** (S12): the frontend is same-origin, so CORS is unnecessary and removing it shrinks the attack surface. (If a cross-origin client is ever needed, that is a new decision.)

### 4.3 Passwords (fixes S7)

- Registration and password change: **8 to 72 bytes (UTF-8)**. Too short: `WEAK_PASSWORD`; over 72 bytes: `PASSWORD_TOO_LONG` (rejected, never silently truncated).
- New hashes use **bcrypt cost 12**. On successful login, a hash with cost below 12 is transparently re-hashed, so existing accounts upgrade themselves. **Existing shorter passwords still work for login**; the new minimum applies only when setting a password.
- Login attempts are limited **per IP** (10/min, as today) **and per username** (10 failed attempts per 15 minutes, in memory, then `429 RATE_LIMITED`). Known trade-off: a per-username limit lets someone lock a specific account out for up to 15 minutes; acceptable for a single-user app and far better than unlimited guessing. State is in memory, so it resets on restart and assumes one server instance.
- The existing timing-parity dummy hash is kept.

### 4.4 HTTP hardening (fixes S3, S11)

`helmet` with these settings:

```
default-src 'self'
script-src  'self'
style-src   'self' 'unsafe-inline'
img-src     'self' data: blob:
media-src   'self' blob:
font-src    'self'
connect-src 'self'
object-src  'none'
base-uri    'none'
form-action 'self'
frame-ancestors 'none'
```

plus HSTS in production, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, and `Permissions-Policy` allowing only `camera=(self)`.

**Why `style-src 'unsafe-inline'` is kept:** the markup has 97 `style=` attributes. Inline CSS cannot execute script, so this is a small, deliberate exception; removing those attributes is UI cleanup for sub-project 4. **`script-src` is strict**: no inline scripts, no `eval`, no inline event handlers.

**Consequences for the frontend (required work):**

- The 74 `onclick` and 5 `onchange` attributes are replaced by **event delegation**: elements carry `data-action="name"` (and `data-*` arguments), and one delegated listener per screen dispatches to module functions.
- The single inline `<script>` and `<style>` move to files.
- **Fonts are self-hosted:** the three current families (Fraunces, DM Sans, IBM Plex Mono; all SIL Open Font License, free) are served from `public/fonts/` as woff2. This removes external requests. **It does not add Hebrew glyphs**; those families have none, and the Hebrew font choice is part of sub-project 4. Hebrew text keeps rendering with its current fallback until then.

`trust proxy` is set from `TRUST_PROXY` (default 1 hop in production). **Assumption to confirm:** Railway places exactly one proxy in front of the app. A wrong value lets clients spoof their IP via `X-Forwarded-For`, so this is verified in section 9.

### 4.5 Input validation (fixes S5, S10)

Every route validates `body`, `params` and `query` with **zod** (free) through `validate.js`; failures return `400 VALIDATION` with per-field codes.

- **IDs:** positive integers.
- **Dates:** `YYYY-MM-DD` checked against a real calendar (rejects `2026-02-31`); month `YYYY-MM`; year 4 digits in a sane range.
- **`logged_at` on food:** `YYYY-MM-DD"T"HH:mm[:ss]` with optional offset, matching what the client sends today. Semantics (time zones) are unchanged; that is sub-project 3.
- **`meal_type`:** enum `breakfast|lunch|dinner|snack`, required on POST and PUT (the client always sends it).
- **Numbers:** the current `toNum` rules (0–99,999 kcal, 0–9,999 g) become schema constraints; out-of-range values are rejected rather than silently stored as `NULL`. Missing, `null` or empty-string values are still accepted and stored as `NULL`, as today. **This is a deliberate behaviour change** for out-of-range input only.
- **`weight_kg`:** 20–500 (decimals allowed, one place). **Text lengths:** as today (food name ≤ 200, analyze text ≤ 500).
- **Profile:** the existing allow-list of keys stays, with per-key type/range checks.
- **Body limits:** 100 KB default; ~8 MB only on `POST /api/analyze`.
- **Image upload:** the server decodes the base64 and checks the **magic bytes** (JPEG/PNG/GIF/WebP) instead of trusting the client's MIME type; a mismatch returns `400 IMAGE_INVALID`. Sent to Anthropic with the detected type.

### 4.6 Rate limiting (fixes S6)

- Login: per IP and per username (section 4.3).
- **Analyze endpoints: keyed by authenticated user id** (20/hour), matching the documented behaviour. `CLAUDE.md` already describes it that way.

### 4.7 XSS (fixes S4)

- A small `html` tagged-template helper escapes every interpolated value by default; trusted pre-built fragments must be marked explicitly. The 28 `innerHTML` sites are each audited and converted; those that only set static text move to `textContent`.
- The strict CSP is the second layer: even if a mistake slips through, injected script cannot run.
- Verified by tests that feed XSS payloads through food names, notes and usernames and assert they render inert.

### 4.8 Dependencies (fixes S13)

Run `npm audit`, fix what is fixable with minimal version bumps, re-run the suite. Anything that needs a breaking major upgrade is listed in the plan with its risk before being applied. New runtime dependencies: `helmet`, `zod`, `cookie-parser`. Dev-only: `supertest`, `@playwright/test`. `cors` is removed.

---

## 5. Frontend architecture

`public/index.html` keeps only markup and two tags: a stylesheet link and `<script type="module" src="/js/main.js">`.

```
public/
  index.html                # markup only
  css/
    tokens.css  base.css  components.css  screens.css   # split of the current <style>
  fonts/                    # self-hosted woff2 + fonts.css
  js/
    main.js                 # bootstrap, router, global event delegation
    api.js                  # apiFetch: same-origin, X-FL-Client header, error-code handling
    session.js              # /auth/me, login state, logout, 401 handling
    errors.js               # error code -> Hebrew message table
    dom.js                  # html`` helper, escape, safe render utilities
    dates.js  format.js     # date/number helpers currently scattered in the script
    state.js                # shared state currently held in globals
    screens/
      welcome.js  auth.js  dashboard.js  home.js  camera.js
      analysis.js  stats.js  weight.js  settings.js
```

- The exact function-to-module assignment is done in the implementation plan by reading the code; the rule is one module per screen plus shared helpers, none over about 500 lines.
- **Behaviour parity is the acceptance test:** the same screens, the same Hebrew texts, the same requests. The split is performed as moves first (verified working), then handler conversion, then `innerHTML` conversion, so any regression is attributable to one step.
- The service worker and `user-scalable` fix are **not** done here.

---

## 6. Testing and verification

All tests are free and run locally.

**API and security tests** (`node --test` + `supertest`, against `foodlogger_test` on the local PostgreSQL; `createApp` with a fake Anthropic client that returns fixed JSON):

- Auth: register/login/logout; cookie flags (`HttpOnly`, `SameSite=Strict`); wrong password; timing-parity path exercised; session cookie required; `Bearer` header rejected.
- Revocation: password change and `logout-all` invalidate a previously valid cookie.
- CSRF: missing custom header → 403; wrong `Origin` → 403.
- Authorization isolation: user B cannot read, edit or delete user A's food or weight entries (404, not 200).
- Validation: table-driven bad inputs for every route (bad dates, `2026-02-31`, unknown `meal_type`, negative/oversized numbers, oversized body, wrong types, bad image bytes) all return `400` with the right code and never `500`.
- Password rules: 7 chars rejected; 73-byte rejected; multi-byte characters counted in bytes; cost-12 rehash on login of an old cost-10 hash.
- Rate limits: per-username lockout; analyze limit is per user (two users do not share a budget).
- Config: startup fails on short `JWT_SECRET` and missing required variables.
- Migrations: fresh database and an "existing database" fixture both end at the same schema; running twice is a no-op.
- XSS payloads in food name, notes and username come back escaped/inert.
- Regression tests for the current behaviour of each route's success path (so the move to `src/` is provably behaviour-preserving).

**Browser smoke tests** (Playwright, free): register → onboarding → log food by text (mocked analysis) → see it in diary → edit → delete → stats screens load → weight add/delete → settings → change password → logout → login. Asserts **no CSP violations and no console errors**, and that `document.cookie` and `localStorage` contain no token.

**Before claiming done:** full suite green, app started against a fresh and an existing-schema database, manual pass of every screen, `npm audit --omit=dev` shows no high/critical.

---

## 7. Rollout and rollback

- All work on `overhaul`; `main` and Railway are untouched until you decide to merge.
- Migrations are additive, so if a merged deploy has to be reverted, the old code still runs against the migrated database.
- After merge: set `ORIGIN` (exact public URL) and a strong `JWT_SECRET` (≥ 32 chars) on Railway, confirm proxy hops, and expect **one forced re-login**.
- `CLAUDE.md` is updated for the new structure, the cookie-auth model and the `npm test` command. (The "all UI text is Hebrew" rule changes in sub-project 2, not here.)

---

## 8. Non-goals

Bilingual UI or server text; nutrition-accuracy changes; time-zone fixes; visual/UX changes; service worker/offline; Hebrew font selection; changing Anthropic prompts or the model; a hosted CI service; any paid tool.

---

## 9. Open items needing the owner (not blockers for writing the plan)

1. **Railway CA certificate** (optional): download it from the Railway dashboard and set `DATABASE_CA` to turn on verified DB TLS. Until then a startup warning is logged.
2. **Railway proxy hops:** confirm one proxy in front of the app (assumed) before merge, since `TRUST_PROXY` depends on it.
3. **Public URL for `ORIGIN`:** needed on Railway for the CSRF Origin check.
