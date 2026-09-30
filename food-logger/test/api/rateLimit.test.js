'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { buildTestApp, signedIn, csrfHeaders, PASSWORD } = require('../helpers/app');
const { createUsernameLimiter } = require('../../src/middleware/rateLimit');

const login = (app, username, password = PASSWORD) => request(app).post('/auth/login').set(csrfHeaders()).send({ username, password });
const register = (app, username) => request(app).post('/auth/register').set(csrfHeaders()).send({ username, password: PASSWORD });

async function withApp(options, fn) {
  const ctx = await buildTestApp(options);
  try {
    await fn(ctx);
  } finally {
    await ctx.pool.end();
  }
}

// ─── createUsernameLimiter (unit) ─────────────────────────────────────────────
function clock(start = 1_000_000) {
  const c = { t: start, now: () => c.t };
  return c;
}

test('username limiter: check throws RATE_LIMITED only after max failures within the window', () => {
  const c = clock();
  const l = createUsernameLimiter({ max: 3, windowMs: 1000, now: c.now });
  l.check('a');
  l.recordFailure('a');
  l.recordFailure('a');
  l.check('a');
  l.recordFailure('a');
  assert.throws(() => l.check('a'), (e) => e.status === 429 && e.code === 'RATE_LIMITED');
  c.t += 1000;
  l.check('a');
});

test('username limiter: keys are trimmed and lowercased', () => {
  const l = createUsernameLimiter({ max: 2, windowMs: 1000, now: clock().now });
  l.recordFailure('Alice');
  l.recordFailure('  aLiCe ');
  assert.throws(() => l.check('ALICE'), (e) => e.code === 'RATE_LIMITED');
  assert.doesNotThrow(() => l.check('bob'));
});

test('username limiter: reset clears the counter', () => {
  const l = createUsernameLimiter({ max: 1, windowMs: 1000, now: clock().now });
  l.recordFailure('a');
  assert.throws(() => l.check('a'));
  l.reset(' A');
  assert.doesNotThrow(() => l.check('a'));
});

test('username limiter: expired entries are pruned so the map cannot grow without bound', () => {
  const c = clock();
  const l = createUsernameLimiter({ max: 5, windowMs: 1000, now: c.now });
  for (let i = 0; i < 100; i++) l.recordFailure(`user${i}`);
  assert.equal(l.size(), 100);
  c.t += 1001;
  l.recordFailure('fresh');
  assert.equal(l.size(), 1);
});

test('username limiter: failures older than the window do not count towards the limit', () => {
  const c = clock();
  const l = createUsernameLimiter({ max: 2, windowMs: 1000, now: c.now });
  l.recordFailure('a');
  c.t += 600;
  l.recordFailure('a');
  c.t += 600; // first failure is now 1200 ms old, second 600 ms
  assert.doesNotThrow(() => l.check('a'));
  l.recordFailure('a');
  assert.throws(() => l.check('a'));
});

// ─── Per-username login lockout ──────────────────────────────────────────────
test('login lockout: after usernameFailures failures even the correct password gets 429; other usernames are unaffected', async () => {
  await withApp({ limits: { usernameFailures: 3 } }, async ({ app }) => {
    await register(app, 'alice');
    await register(app, 'bob');
    for (let i = 0; i < 3; i++) assert.equal((await login(app, 'alice', 'wrong-password-1')).status, 401);
    const locked = await login(app, 'alice');
    assert.equal(locked.status, 429);
    assert.deepEqual(locked.body, { error: { code: 'RATE_LIMITED' } });
    assert.equal((await login(app, 'ALICE')).status, 429, 'case-insensitive');
    assert.equal((await login(app, 'bob')).status, 200);
  });
});

test('login lockout: unknown usernames count too', async () => {
  await withApp({ limits: { usernameFailures: 2 } }, async ({ app }) => {
    assert.equal((await login(app, 'ghost')).status, 401);
    assert.equal((await login(app, 'ghost')).status, 401);
    assert.equal((await login(app, 'ghost')).status, 429);
  });
});

test('login lockout ends after usernameWindowMs', async () => {
  const state = { t: 5_000_000 };
  await withApp({ limits: { usernameFailures: 2, usernameWindowMs: 60_000, now: () => state.t } }, async ({ app }) => {
    await register(app, 'alice');
    await login(app, 'alice', 'wrong-password-1');
    await login(app, 'alice', 'wrong-password-1');
    assert.equal((await login(app, 'alice')).status, 429);
    state.t += 59_999;
    assert.equal((await login(app, 'alice')).status, 429);
    state.t += 1;
    assert.equal((await login(app, 'alice')).status, 200);
  });
});

test('a successful login resets the failure counter', async () => {
  await withApp({ limits: { usernameFailures: 3 } }, async ({ app }) => {
    await register(app, 'alice');
    for (let round = 0; round < 3; round++) {
      await login(app, 'alice', 'wrong-password-1');
      await login(app, 'alice', 'wrong-password-1');
      assert.equal((await login(app, 'alice')).status, 200, `round ${round}`);
    }
  });
});

test('a locked-out login is rejected before any bcrypt work', async () => {
  await withApp({ limits: { usernameFailures: 2 } }, async ({ app }) => {
    const timed = async () => {
      const started = process.hrtime.bigint();
      const res = await login(app, 'alice', 'wrong-password-1');
      return { status: res.status, ms: Number(process.hrtime.bigint() - started) / 1e6 };
    };
    const first = await timed();
    await timed();
    const locked = await timed();
    assert.equal(first.status, 401);
    assert.equal(locked.status, 429);
    assert.ok(locked.ms < first.ms / 2, `locked ${locked.ms} ms vs bcrypt-backed ${first.ms} ms`);
  });
});

// ─── Per-IP limiter and trust proxy ──────────────────────────────────────────
test('login limiter: with loginPerMin=1 the second login attempt gets 429', async () => {
  await withApp({ limits: { loginPerMin: 1 } }, async ({ app }) => {
    assert.equal((await login(app, 'nobody')).status, 401);
    assert.equal((await login(app, 'nobody')).status, 429);
  });
});

const xff = (app, ip, username) =>
  request(app).post('/auth/login').set(csrfHeaders()).set('X-Forwarded-For', ip).send({ username, password: PASSWORD });

test('per-IP limiter with TRUST_PROXY=1: different X-Forwarded-For values have separate budgets', async () => {
  await withApp({ env: { TRUST_PROXY: '1' }, limits: { loginPerMin: 1 } }, async ({ app }) => {
    assert.equal((await xff(app, '203.0.113.1', 'u1')).status, 401);
    assert.equal((await xff(app, '203.0.113.1', 'u2')).status, 429);
    assert.equal((await xff(app, '203.0.113.2', 'u3')).status, 401);
  });
});

test('per-IP limiter with TRUST_PROXY=0: X-Forwarded-For is ignored, one shared budget', async () => {
  await withApp({ env: { TRUST_PROXY: '0' }, limits: { loginPerMin: 1 } }, async ({ app }) => {
    assert.equal((await xff(app, '203.0.113.1', 'u1')).status, 401);
    const second = await xff(app, '203.0.113.2', 'u2');
    assert.equal(second.status, 429);
    assert.deepEqual(second.body, { error: { code: 'RATE_LIMITED' } });
  });
});

test('the per-IP limiter also covers register', async () => {
  await withApp({ limits: { loginPerMin: 1 } }, async ({ app }) => {
    assert.equal((await register(app, 'first')).status, 200);
    assert.equal((await register(app, 'second')).status, 429);
  });
});

// ─── Analyze limiter is keyed by user ────────────────────────────────────────
test('analyze limiter is per user: A is limited on the third call, B is unaffected', async () => {
  await withApp({ limits: { analyzePerHour: 2 } }, async ({ app }) => {
    const a = await signedIn(app, 'usera');
    const b = await signedIn(app, 'userb');
    assert.equal((await a.post('/api/analyze-text', { text: 'סלט' })).status, 200);
    assert.equal((await a.post('/api/analyze-text', { text: 'סלט' })).status, 200);
    const third = await a.post('/api/analyze-text', { text: 'סלט' });
    assert.equal(third.status, 429);
    assert.deepEqual(third.body, { error: { code: 'RATE_LIMITED' } });
    assert.equal((await b.post('/api/analyze-text', { text: 'סלט' })).status, 200);
  });
});

// ─── Auth and the limiter run before the body parsers (R13) ──────────────────
test('unauthenticated /api/analyze with a 200 KB body gets 401 without reaching the parser or the AI', async () => {
  await withApp({}, async ({ app, anthropic }) => {
    const big = JSON.stringify({ imageBase64: 'A'.repeat(200 * 1024) });
    const res = await request(app).post('/api/analyze').set(csrfHeaders()).set('Content-Type', 'application/json').send(big);
    assert.equal(res.status, 401);
    assert.deepEqual(res.body, { error: { code: 'UNAUTHORIZED' } });
    assert.equal(anthropic.calls.length, 0);
  });
});

test('unauthenticated /api/analyze with malformed JSON gets 401 (proves the parser has not run)', async () => {
  await withApp({}, async ({ app }) => {
    const res = await request(app).post('/api/analyze').set(csrfHeaders()).set('Content-Type', 'application/json').send('{ not json');
    assert.equal(res.status, 401);
  });
});

test('over-limit /api/analyze gets 429 even when the body is malformed JSON (limiter runs before the parser)', async () => {
  await withApp({ limits: { analyzePerHour: 1 } }, async ({ app }) => {
    const c = await signedIn(app, 'usera');
    assert.equal((await c.post('/api/analyze-text', { text: 'סלט' })).status, 200);
    const res = await c.req('post', '/api/analyze').set('Content-Type', 'application/json').send('{ not json');
    assert.equal(res.status, 429);
  });
});

test('unauthenticated /api/analyze-text with malformed JSON gets 401, not a parse error', async () => {
  await withApp({}, async ({ app }) => {
    const res = await request(app).post('/api/analyze-text').set(csrfHeaders()).set('Content-Type', 'application/json').send('{ not json');
    assert.equal(res.status, 401);
  });
});

test('body limits are unchanged: /api/analyze accepts >100 KB up to 8 MB, /api/analyze-text stays at 100 KB', async () => {
  await withApp({ limits: { analyzePerHour: 1000 } }, async ({ app }) => {
    const c = await signedIn(app, 'usera');
    const big = await c.post('/api/analyze', { imageBase64: 'A'.repeat(200 * 1024) });
    assert.equal(big.status, 400);
    assert.equal(big.body.error.code, 'IMAGE_INVALID', 'reached the handler, not rejected by a 100 KB parser');
    const tooBig = await c.post('/api/analyze', { imageBase64: 'A'.repeat(9 * 1024 * 1024) });
    assert.equal(tooBig.status, 400);
    assert.equal(tooBig.body.error.code, 'VALIDATION');
    const text = await c.post('/api/analyze-text', { text: 'x'.repeat(200 * 1024) });
    assert.equal(text.status, 400);
    assert.equal(text.body.error.code, 'VALIDATION');
  });
});

// ─── Per-IP analyze budget (Anthropic bill amplification) ────────────────────
const JPEG_BASE64 = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]).toString('base64');

test('analyze per-IP limiter: several different users on one IP share one budget across both endpoints', async () => {
  await withApp({ limits: { analyzePerHour: 1000, analyzePerIpPerHour: 3 } }, async ({ app, anthropic }) => {
    const users = [];
    for (const name of ['ipuser1', 'ipuser2', 'ipuser3', 'ipuser4']) users.push(await signedIn(app, name));
    assert.equal((await users[0].post('/api/analyze-text', { text: 'סלט' })).status, 200);
    assert.equal((await users[1].post('/api/analyze', { imageBase64: JPEG_BASE64 })).status, 200);
    assert.equal((await users[2].post('/api/analyze-text', { text: 'סלט' })).status, 200);
    anthropic.calls.length = 0;
    const fourth = await users[3].post('/api/analyze-text', { text: 'סלט' });
    assert.equal(fourth.status, 429);
    assert.deepEqual(fourth.body, { error: { code: 'RATE_LIMITED' } });
    assert.equal(anthropic.calls.length, 0, 'no AI call once the IP budget is spent');
  });
});

test('analyze per-IP limiter with TRUST_PROXY=1: different client IPs have separate budgets', async () => {
  await withApp({ env: { TRUST_PROXY: '1' }, limits: { analyzePerHour: 1000, analyzePerIpPerHour: 1 } }, async ({ app }) => {
    const a = await signedIn(app, 'xffa');
    const b = await signedIn(app, 'xffb');
    const call = (c, ip) => c.req('post', '/api/analyze-text').set('X-Forwarded-For', ip).send({ text: 'סלט' });
    assert.equal((await call(a, '203.0.113.1')).status, 200);
    assert.equal((await call(b, '203.0.113.1')).status, 429);
    assert.equal((await call(b, '203.0.113.2')).status, 200);
  });
});

// ─── change-password: per-IP limit and per-user failure lockout ──────────────
const changePw = (c, currentPassword, newPassword = 'brand-new-pw') => c.post('/auth/change-password', { currentPassword, newPassword });

test('change-password lockout: after changePasswordFailures wrong passwords even the correct one is 429 until the window passes', async () => {
  const state = { t: 9_000_000 };
  await withApp({ limits: { changePasswordFailures: 3, usernameWindowMs: 60_000, now: () => state.t } }, async ({ app }) => {
    const c = await signedIn(app, 'cpuser');
    const other = await signedIn(app, 'cpother');
    for (let i = 0; i < 3; i++) assert.equal((await changePw(c, 'wrong-password-1')).status, 401);
    const locked = await changePw(c, PASSWORD);
    assert.equal(locked.status, 429);
    assert.deepEqual(locked.body, { error: { code: 'RATE_LIMITED' } });
    assert.equal((await changePw(other, PASSWORD)).status, 200, 'a different user is unaffected');
    state.t += 59_999;
    assert.equal((await changePw(c, PASSWORD)).status, 429);
    state.t += 1;
    assert.equal((await changePw(c, PASSWORD)).status, 200);
  });
});

test('change-password lockout: a locked-out attempt is rejected before any bcrypt work', async () => {
  await withApp({ limits: { changePasswordFailures: 2 } }, async ({ app }) => {
    const c = await signedIn(app, 'cptimed');
    const timed = async () => {
      const started = process.hrtime.bigint();
      const res = await changePw(c, 'wrong-password-1');
      return { status: res.status, ms: Number(process.hrtime.bigint() - started) / 1e6 };
    };
    const first = await timed();
    await timed();
    const locked = await timed();
    assert.equal(first.status, 401);
    assert.equal(locked.status, 429);
    assert.ok(locked.ms < first.ms / 2, `locked ${locked.ms} ms vs bcrypt-backed ${first.ms} ms`);
  });
});

test('change-password: a success resets the failure counter', async () => {
  await withApp({ limits: { changePasswordFailures: 3 } }, async ({ app }) => {
    const c = await signedIn(app, 'cpreset');
    let current = PASSWORD;
    for (let round = 0; round < 3; round++) {
      await changePw(c, 'wrong-password-1');
      await changePw(c, 'wrong-password-1');
      const next = `brand-new-pw-${round}`;
      assert.equal((await changePw(c, current, next)).status, 200, `round ${round}`);
      current = next;
    }
  });
});

test('change-password per-IP limiter: with changePasswordPerMin=2 the third request gets 429', async () => {
  await withApp({ limits: { changePasswordPerMin: 2 } }, async ({ app }) => {
    const c = await signedIn(app, 'cpip');
    assert.equal((await changePw(c, 'wrong-password-1')).status, 401);
    assert.equal((await changePw(c, 'wrong-password-1')).status, 401);
    const third = await changePw(c, PASSWORD);
    assert.equal(third.status, 429);
    assert.deepEqual(third.body, { error: { code: 'RATE_LIMITED' } });
  });
});

test('change-password: a CSRF-rejected request counts towards neither limiter', async () => {
  await withApp({ limits: { changePasswordPerMin: 1, changePasswordFailures: 1 } }, async ({ app }) => {
    const c = await signedIn(app, 'cpcsrf');
    const noCsrf = () => request(app).post('/auth/change-password').set('Cookie', c.cookie).send({ currentPassword: 'wrong-password-1', newPassword: 'brand-new-pw' });
    for (let i = 0; i < 3; i++) assert.equal((await noCsrf()).status, 403);
    assert.equal((await changePw(c, PASSWORD)).status, 200);
  });
});
