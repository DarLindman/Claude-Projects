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
| `TEST_DATABASE_URL` | Database for the integration tests (see Tests). Defaults to `foodlogger_test` on the same server as `DATABASE_URL` |

### Architecture

- **`server.js`** — bootstrap only: loads `.env`, builds the config, pool, Anthropic client and icon, runs migrations, then `app.listen`.
- **`src/`** — the server:
  - `app.js` — `createApp({ config, pool, anthropic, icon, limits })` wires middleware and routers; never calls `listen` (tests import it).
  - `config.js` — env parsing and validation (`loadConfig`).
  - `db/` — `pool.js` (TLS policy), `migrate.js` (runs `db/migrations/*.sql` in order, each in a transaction, under an advisory lock; applied versions are kept in `schema_migrations`) and the migrations (`001_baseline.sql`, `002_token_version.sql`). Tables: `users`, `food_logs`, `weight_logs`, `user_profiles`. Add a schema change as a new numbered migration, never by editing an applied one.
  - `middleware/` — `security.js` (CSP and other headers), `csrf.js`, `auth.js`, `validate.js` (zod), `rateLimit.js`, `errors.js` (error contract).
  - `routes/` — `auth`, `food`, `weight`, `profile`, `stats`, `streak`, `analyze`.
  - `lib/` — `sessions.js` (cookie + JWT), `passwords.js` (bcrypt cost 12), `analysis.js` and `anthropic.js` (AI), `image.js`, `dates.js`, `schemas.js`, `icon.js` (PWA icon generation via `@napi-rs/canvas`).
- **`public/index.html`** — markup only (Hebrew RTL, dark theme); CSS in `public/css/`, JS in `public/js/`, fonts self-hosted in `public/fonts/`.
- **AI** — `POST /api/analyze` (image) and `POST /api/analyze-text` (free text) call `claude-haiku-4-5-20251001` and return a JSON nutritional estimate. Rate limited to 20 requests/hour per **user**, plus a per-**IP** cap of 60 requests/hour shared by both endpoints (registration is open, so per-user alone would let a script mint accounts to multiply billed calls). Knobs: `limits.analyzePerHour`, `limits.analyzePerIpPerHour`.

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

- All UI text is in Hebrew; `dir="rtl"` and `lang="he"` on `<html>`
- CSS variables defined in `:root` for theming
- Error messages shown to the user are in Hebrew (the food-logger server sends error codes; `public/js/errors.js` holds the Hebrew text)
