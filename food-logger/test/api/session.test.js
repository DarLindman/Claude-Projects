'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { buildTestApp, signedIn, csrfHeaders, sessionCookie, PASSWORD } = require('../helpers/app');

let ctx;
before(async () => { ctx = await buildTestApp(); });
after(async () => { await ctx.pool.end(); });

const UNAUTHORIZED = { error: { code: 'UNAUTHORIZED' } };
const SESSION_EXPIRED = { error: { code: 'SESSION_EXPIRED' } };

const setCookieLine = (res) => (res.headers['set-cookie'] || []).find((c) => c.startsWith('fl_session='));
const getFood = (cookie) => {
  const req = request(ctx.app).get('/api/food');
  return cookie ? req.set('Cookie', cookie) : req;
};
const post = (path, cookie) => {
  const req = request(ctx.app).post(path).set(csrfHeaders(ctx.config));
  return cookie ? req.set('Cookie', cookie) : req;
};
const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
const userId = async (username) => (await ctx.pool.query('SELECT id FROM users WHERE username = $1', [username])).rows[0].id;

// A rejected session gives 401 SESSION_EXPIRED and clears the cookie (never a 500).
function assertExpiredAndCleared(res, label) {
  assert.equal(res.status, 401, `${label}: ${JSON.stringify(res.body)}`);
  assert.deepEqual(res.body, SESSION_EXPIRED, label);
  const line = setCookieLine(res);
  assert.ok(line, `${label}: cookie is cleared`);
  assert.match(line, /^fl_session=;/, label);
  assert.match(line, /Expires=Thu, 01 Jan 1970/, label);
}

// ─── Cookie issued at login and register ─────────────────────────────────────
test('login sets an HttpOnly, SameSite=Strict, Path=/ cookie for 7 days, not Secure in test, and no token in the body', async () => {
  await signedIn(ctx.app, 'cookie1');
  const res = await post('/auth/login').send({ username: 'cookie1', password: PASSWORD });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { username: 'cookie1' });
  const line = setCookieLine(res);
  assert.ok(line, 'Set-Cookie fl_session present');
  const attrs = line.split(';').map((s) => s.trim());
  assert.match(attrs[0], /^fl_session=[\w-]+\.[\w-]+\.[\w-]+$/);
  assert.ok(attrs.includes('HttpOnly'), line);
  assert.ok(attrs.includes('SameSite=Strict'), line);
  assert.ok(attrs.includes('Path=/'), line);
  assert.ok(attrs.includes('Max-Age=604800'), line);
  assert.ok(!attrs.includes('Secure'), line);
});

test('register sets the same cookie and returns only the username', async () => {
  const res = await post('/auth/register').send({ username: 'Cookie2', password: PASSWORD });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { username: 'cookie2' });
  const line = setCookieLine(res);
  assert.ok(line);
  assert.match(line, /HttpOnly/);
  assert.match(line, /SameSite=Strict/);
  assert.match(line, /Max-Age=604800/);
});

test('with a production config the cookie is also Secure', async () => {
  const prod = await buildTestApp({ env: { NODE_ENV: 'production', ORIGIN: 'https://food.example', ANTHROPIC_API_KEY: 'test-key' } });
  try {
    assert.equal(prod.config.isProd, true);
    const res = await request(prod.app).post('/auth/register').set(csrfHeaders(prod.config))
      .send({ username: 'produser', password: PASSWORD });
    assert.equal(res.status, 200);
    const attrs = setCookieLine(res).split(';').map((s) => s.trim());
    assert.ok(attrs.includes('Secure'), attrs.join('; '));
    assert.ok(attrs.includes('HttpOnly'));
    assert.ok(attrs.includes('SameSite=Strict'));
  } finally {
    await prod.pool.end();
  }
});

test('the session payload is { id, tv } signed with HS256', async () => {
  const c = await signedIn(ctx.app, 'payload1');
  const token = c.cookie.slice('fl_session='.length);
  const decoded = jwt.decode(token, { complete: true });
  assert.equal(decoded.header.alg, 'HS256');
  assert.deepEqual(Object.keys(decoded.payload).sort(), ['exp', 'iat', 'id', 'tv']);
  assert.equal(decoded.payload.tv, 0);
  assert.equal(decoded.payload.exp - decoded.payload.iat, 7 * 24 * 3600);
});

// ─── Cookie authenticates; Bearer does not ───────────────────────────────────
test('the cookie authenticates GET /api/food', async () => {
  const c = await signedIn(ctx.app, 'reader1');
  const res = await getFood(c.cookie);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, []);
});

test('an Authorization: Bearer header alone is not read: 401 UNAUTHORIZED', async () => {
  const c = await signedIn(ctx.app, 'bearer1');
  const id = await userId('bearer1');
  const oldStyle = jwt.sign({ id, username: 'bearer1' }, ctx.config.jwtSecret, { expiresIn: '7d' });
  for (const token of [oldStyle, c.cookie.slice('fl_session='.length)]) {
    const res = await request(ctx.app).get('/api/food').set('Authorization', `Bearer ${token}`);
    assert.equal(res.status, 401);
    assert.deepEqual(res.body, UNAUTHORIZED);
  }
});

test('an old-style { id, username } token put into the cookie is SESSION_EXPIRED (no tv)', async () => {
  await signedIn(ctx.app, 'bearer2');
  const id = await userId('bearer2');
  const oldStyle = jwt.sign({ id, username: 'bearer2' }, ctx.config.jwtSecret, { expiresIn: '7d' });
  assertExpiredAndCleared(await getFood(`fl_session=${oldStyle}`), 'old-style token');
});

test('no cookie: 401 UNAUTHORIZED and no Set-Cookie', async () => {
  const res = await getFood();
  assert.equal(res.status, 401);
  assert.deepEqual(res.body, UNAUTHORIZED);
  assert.equal(setCookieLine(res), undefined);
});

test('GET /auth/me returns the username; without a cookie it is 401 UNAUTHORIZED', async () => {
  const c = await signedIn(ctx.app, 'Me-User');
  const me = await c.get('/auth/me');
  assert.equal(me.status, 200);
  assert.deepEqual(me.body, { username: 'me-user' });
  const anon = await request(ctx.app).get('/auth/me');
  assert.equal(anon.status, 401);
  assert.deepEqual(anon.body, UNAUTHORIZED);
});

// ─── Revocation ──────────────────────────────────────────────────────────────
test('change-password revokes the old cookie and issues a fresh one for this device', async () => {
  const c = await signedIn(ctx.app, 'changer');
  const oldCookie = c.cookie;
  const res = await post('/auth/change-password', oldCookie).send({ currentPassword: PASSWORD, newPassword: 'brand-new-pw' });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true });
  const fresh = sessionCookie(res);
  assert.ok(fresh && fresh !== 'fl_session=', 'a fresh cookie is set');
  assert.notEqual(fresh, oldCookie);
  assert.match(setCookieLine(res), /HttpOnly/);
  assertExpiredAndCleared(await getFood(oldCookie), 'old cookie after change-password');
  assert.equal((await getFood(fresh)).status, 200, 'the cookie from the response works');
});

test('change-password with a wrong current password keeps the session (no revocation)', async () => {
  const c = await signedIn(ctx.app, 'changer2');
  const res = await post('/auth/change-password', c.cookie).send({ currentPassword: 'nope-nope', newPassword: 'brand-new-pw' });
  assert.equal(res.status, 401);
  assert.deepEqual(res.body, { error: { code: 'WRONG_CURRENT_PASSWORD' } });
  assert.equal(setCookieLine(res), undefined);
  assert.equal((await getFood(c.cookie)).status, 200);
});

test('logout-all revokes every cookie, including one from another login', async () => {
  const c = await signedIn(ctx.app, 'everywhere');
  const login = await post('/auth/login').send({ username: 'everywhere', password: PASSWORD });
  const second = sessionCookie(login);
  assert.equal((await getFood(second)).status, 200, 'second device works before logout-all');
  const res = await post('/auth/logout-all', c.cookie);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true });
  assert.match(setCookieLine(res), /^fl_session=;/, 'this device cookie is cleared');
  assertExpiredAndCleared(await getFood(second), 'second device after logout-all');
  assertExpiredAndCleared(await getFood(c.cookie), 'this device after logout-all');
  const again = await post('/auth/login').send({ username: 'everywhere', password: PASSWORD });
  assert.equal((await getFood(sessionCookie(again))).status, 200, 'a new login works');
});

test('logout-all without a session is 401 UNAUTHORIZED', async () => {
  const res = await post('/auth/logout-all');
  assert.equal(res.status, 401);
  assert.deepEqual(res.body, UNAUTHORIZED);
});

test('logout clears only this device cookie: a saved copy still works (per-device logout)', async () => {
  const c = await signedIn(ctx.app, 'onedevice');
  const saved = c.cookie;
  const res = await post('/auth/logout', saved);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true });
  const line = setCookieLine(res);
  assert.match(line, /^fl_session=;/);
  assert.match(line, /Expires=Thu, 01 Jan 1970/);
  assert.match(line, /Path=\//);
  assert.equal((await getFood(saved)).status, 200, 'logout does not revoke other copies');
});

test('logout without a session is still 200 and clears the cookie', async () => {
  const res = await post('/auth/logout');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true });
  assert.match(setCookieLine(res), /^fl_session=;/);
});

// ─── Forged and orphaned sessions (Review Focus 1) ───────────────────────────
test('a cookie for a user deleted from the database is SESSION_EXPIRED, not 500', async () => {
  const c = await signedIn(ctx.app, 'ghost');
  await ctx.pool.query('DELETE FROM users WHERE username = $1', ['ghost']);
  assertExpiredAndCleared(await getFood(c.cookie), 'deleted user');
  assertExpiredAndCleared(await request(ctx.app).get('/auth/me').set('Cookie', c.cookie), 'deleted user /auth/me');
});

test('hostile cookies are SESSION_EXPIRED, never 500', async () => {
  await signedIn(ctx.app, 'target');
  const id = await userId('target');
  const secret = ctx.config.jwtSecret;
  const now = Math.floor(Date.now() / 1000);
  const cases = [
    ['garbage', 'garbage'],
    ['alg:none', `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url({ id, tv: 0, iat: now, exp: now + 3600 })}.`],
    ['alg:none with a signature', `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url({ id, tv: 0 })}.abc`],
    ['other secret', jwt.sign({ id, tv: 0 }, 'a-completely-different-secret-0123456789', { expiresIn: '7d' })],
    ['expired', jwt.sign({ id, tv: 0, iat: now - 8 * 86400, exp: now - 86400 }, secret)],
    ['HS512 with the right secret (algorithm pinned)', jwt.sign({ id, tv: 0 }, secret, { algorithm: 'HS512', expiresIn: '7d' })],
    ['tv as a string', jwt.sign({ id, tv: '0' }, secret, { expiresIn: '7d' })],
    ['id as a string', jwt.sign({ id: String(id), tv: 0 }, secret, { expiresIn: '7d' })],
    ['id out of integer range', jwt.sign({ id: 2 ** 40, tv: 0 }, secret, { expiresIn: '7d' })],
    ['tv out of integer range', jwt.sign({ id, tv: 2 ** 40 }, secret, { expiresIn: '7d' })],
    ['no exp claim', jwt.sign({ id, tv: 0 }, secret)],
    ['JSON cookie (cookie-parser j: prefix)', encodeURIComponent('j:{"id":1,"tv":0}')],
    ['a very long value', 'x'.repeat(3000)],
  ];
  for (const [label, value] of cases) {
    assertExpiredAndCleared(await getFood(`fl_session=${value}`), label);
  }
});

test('an empty fl_session cookie counts as no session: 401 UNAUTHORIZED', async () => {
  const res = await getFood('fl_session=');
  assert.equal(res.status, 401);
  assert.deepEqual(res.body, UNAUTHORIZED);
});

// ─── A database failure is a 500, never a 401 ────────────────────────────────
test('when the database fails the auth middleware answers 500 INTERNAL, not 401 (no logout, cookie kept)', async () => {
  const { createAuth } = require('../../src/middleware/auth');
  const { errorHandler, requestId } = require('../../src/middleware/errors');
  const express = require('express');
  const cookieParser = require('cookie-parser');

  const failingPool = { query: async () => { throw new Error('connection terminated unexpectedly'); } };
  const app = express();
  app.use(requestId);
  app.use(cookieParser());
  app.get('/probe', createAuth({ pool: failingPool, config: ctx.config }), (req, res) => res.json({ user: req.user }));
  app.use(errorHandler);

  const c = await signedIn(ctx.app, 'dbdown');
  const res = await request(app).get('/probe').set('Cookie', c.cookie);
  assert.equal(res.status, 500);
  assert.deepEqual(res.body, { error: { code: 'INTERNAL' } });
  assert.equal(setCookieLine(res), undefined, 'a transient database error must not clear the session cookie');
});
