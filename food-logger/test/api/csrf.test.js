'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { buildTestApp, signedIn, PASSWORD } = require('../helpers/app');

let ctx;
let c;
before(async () => {
  ctx = await buildTestApp();
  c = await signedIn(ctx.app, 'csrfuser');
});
after(async () => { await ctx.pool.end(); });

const CSRF = { error: { code: 'CSRF' } };
const ORIGIN = 'http://localhost:3000';
const food = { meal_type: 'lunch', food_name: 'Salad' };
const countFood = async () => Number((await ctx.pool.query('SELECT count(*) FROM food_logs')).rows[0].count);

// A POST /api/food with the signed-in cookie and exactly the given extra headers.
const postFood = (headers) => request(ctx.app).post('/api/food').set('Cookie', c.cookie).set(headers).send(food);

function assertCsrf(res, label) {
  assert.equal(res.status, 403, `${label}: ${JSON.stringify(res.body)}`);
  assert.deepEqual(res.body, CSRF, label);
}

test('the signed-in client (Origin + X-FL-Client: 1) passes', async () => {
  const res = await c.post('/api/food', food);
  assert.equal(res.status, 200);
});

test('POST without X-FL-Client is 403 CSRF and nothing is written', async () => {
  const before = await countFood();
  assertCsrf(await postFood({ Origin: ORIGIN }), 'no X-FL-Client');
  assert.equal(await countFood(), before);
});

test('X-FL-Client values other than "1" are 403 CSRF', async () => {
  for (const v of ['0', 'true', '11', ' 1x', '']) {
    assertCsrf(await postFood({ Origin: ORIGIN, 'X-FL-Client': v }), `X-FL-Client: ${JSON.stringify(v)}`);
  }
});

test('a wrong Origin is 403 CSRF', async () => {
  for (const origin of [
    'http://evil.example',
    'null',
    'http://localhost:3000.evil.com',
    'http://localhost:30001',
    'http://localhost',
    'https://localhost:3000',
    'HTTP://LOCALHOST:3000',
    'http://localhost:3000/',
    'http://sub.localhost:3000',
  ]) {
    assertCsrf(await postFood({ Origin: origin, 'X-FL-Client': '1' }), `Origin ${origin}`);
  }
});

test('a wrong Origin is refused even when the Referer is right (Origin wins)', async () => {
  assertCsrf(await postFood({ Origin: 'http://evil.example', Referer: `${ORIGIN}/`, 'X-FL-Client': '1' }), 'origin wins');
  assertCsrf(await postFood({ Origin: 'null', Referer: `${ORIGIN}/`, 'X-FL-Client': '1' }), 'Origin null');
});

test('missing Origin and missing Referer is 403 CSRF', async () => {
  assertCsrf(await postFood({ 'X-FL-Client': '1' }), 'neither header');
});

test('no Origin but a Referer on the right origin is allowed', async () => {
  const res = await postFood({ Referer: `${ORIGIN}/some/page?x=1`, 'X-FL-Client': '1' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
});

test('no Origin and a Referer on another origin (or malformed) is 403 CSRF', async () => {
  for (const referer of ['http://evil.example/', 'http://localhost:3000.evil.com/', 'https://localhost:3000/', 'not a url', 'http://evil.example/?http://localhost:3000/']) {
    assertCsrf(await postFood({ Referer: referer, 'X-FL-Client': '1' }), `Referer ${referer}`);
  }
});

test('PUT and DELETE are checked too', async () => {
  const { body: row } = await c.post('/api/food', food);
  assertCsrf(await request(ctx.app).put(`/api/food/${row.id}`).set('Cookie', c.cookie).set({ Origin: ORIGIN }).send(food), 'PUT');
  assertCsrf(await request(ctx.app).delete(`/api/food/${row.id}`).set('Cookie', c.cookie).set({ 'X-FL-Client': '1' }), 'DELETE');
  assert.equal((await c.delete(`/api/food/${row.id}`)).status, 200);
});

test('GET requests are not checked', async () => {
  const res = await request(ctx.app).get('/api/food').set('Cookie', c.cookie).set('Origin', 'http://evil.example');
  assert.equal(res.status, 200);
  const me = await request(ctx.app).get('/auth/me').set('Cookie', c.cookie);
  assert.equal(me.status, 200);
});

test('the check applies to /auth/login, /auth/register and /auth/logout', async () => {
  assertCsrf(await request(ctx.app).post('/auth/login').set({ Origin: ORIGIN }).send({ username: 'csrfuser', password: PASSWORD }), 'login without X-FL-Client');
  assertCsrf(await request(ctx.app).post('/auth/login').set({ Origin: 'http://evil.example', 'X-FL-Client': '1' })
    .send({ username: 'csrfuser', password: PASSWORD }), 'login wrong origin');
  const reg = await request(ctx.app).post('/auth/register').set({ 'X-FL-Client': '1' }).send({ username: 'nocsrf', password: PASSWORD });
  assertCsrf(reg, 'register');
  assert.equal(reg.headers['set-cookie'], undefined, 'no cookie issued');
  assert.equal((await ctx.pool.query("SELECT 1 FROM users WHERE username = 'nocsrf'")).rowCount, 0);
  const out = await request(ctx.app).post('/auth/logout').set('Cookie', c.cookie).set({ Origin: 'http://evil.example', 'X-FL-Client': '1' });
  assertCsrf(out, 'logout');
  assert.equal(out.headers['set-cookie'], undefined, 'cookie not cleared by a cross-site logout');
});

test('CSRF runs before auth: no cookie and no CSRF headers is 403, not 401', async () => {
  assertCsrf(await request(ctx.app).post('/api/food').send(food), 'anonymous');
});

test('CSRF runs before the body parser: malformed JSON without headers is 403', async () => {
  assertCsrf(await request(ctx.app).post('/auth/login').set('Content-Type', 'application/json').send('{ nope'), 'malformed');
});

test('CSRF-rejected logins count neither against the username lockout nor the per-IP budget', async () => {
  // loginPerMin 2: register spends one, so only the final login may use the other.
  const limited = await buildTestApp({ limits: { usernameFailures: 1, loginPerMin: 2 } });
  try {
    await request(limited.app).post('/auth/register').set({ Origin: ORIGIN, 'X-FL-Client': '1' }).send({ username: 'locky', password: PASSWORD })
      .then((r) => assert.equal(r.status, 200));
    for (let i = 0; i < 3; i++) {
      assertCsrf(await request(limited.app).post('/auth/login').set({ Origin: 'http://evil.example', 'X-FL-Client': '1' })
        .send({ username: 'locky', password: 'wrong-password' }), `attempt ${i}`);
    }
    const ok = await request(limited.app).post('/auth/login').set({ Origin: ORIGIN, 'X-FL-Client': '1' }).send({ username: 'locky', password: PASSWORD });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
  } finally {
    await limited.pool.end();
  }
});
