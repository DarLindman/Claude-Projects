'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { buildTestApp } = require('../helpers/app');

let ctx;
let prod;
before(async () => {
  ctx = await buildTestApp();
  prod = await buildTestApp({
    env: { NODE_ENV: 'production', ORIGIN: 'https://food.example.com', ANTHROPIC_API_KEY: 'sk-test-key' },
  });
});
after(async () => {
  await ctx.pool.end();
  await prod.pool.end();
});

const FONT = '/fonts/Fraunces-latin-opsz-normal.woff2';

const EXPECTED_CSP = {
  'default-src': ["'self'"],
  'script-src': ["'self'"],
  'style-src': ["'self'", "'unsafe-inline'"],
  'img-src': ["'self'", 'data:', 'blob:'],
  'media-src': ["'self'", 'blob:'],
  'font-src': ["'self'"],
  'connect-src': ["'self'"],
  'object-src': ["'none'"],
  'base-uri': ["'none'"],
  'form-action': ["'self'"],
  'frame-ancestors': ["'none'"],
};

function parseCsp(header) {
  const map = {};
  for (const part of header.split(';')) {
    const [name, ...values] = part.trim().split(/\s+/);
    if (name) map[name] = values;
  }
  return map;
}

// The same headers on every kind of response. `csp` is overridden only for Express's own
// unmatched-path 404 (finalhandler), which replaces the policy with the stricter default-src 'none'.
function assertSecurityHeaders(res, label, csp = EXPECTED_CSP) {
  assert.deepEqual(parseCsp(res.headers['content-security-policy'] || ''), csp, `${label}: CSP`);
  assert.equal(res.headers['referrer-policy'], 'no-referrer', `${label}: Referrer-Policy`);
  assert.equal(res.headers['x-content-type-options'], 'nosniff', `${label}: nosniff`);
  assert.equal(res.headers['permissions-policy'], 'camera=(self), microphone=(), geolocation=()', `${label}: Permissions-Policy`);
  assert.equal(res.headers['x-powered-by'], undefined, `${label}: X-Powered-By`);
}

test('GET / serves exactly the required CSP directives and no others', async () => {
  const res = await request(ctx.app).get('/');
  assert.equal(res.status, 200);
  assertSecurityHeaders(res, 'GET /');
  assert.ok(!('upgrade-insecure-requests' in parseCsp(res.headers['content-security-policy'])));
});

test('HSTS is absent outside production and present in production', async () => {
  const dev = await request(ctx.app).get('/');
  assert.equal(dev.headers['strict-transport-security'], undefined);
  const res = await request(prod.app).get('/');
  assert.equal(res.status, 200);
  assert.equal(res.headers['strict-transport-security'], 'max-age=31536000; includeSubDomains');
  assert.ok(!/preload/i.test(res.headers['strict-transport-security']), 'HSTS must not opt into preload');
  assertSecurityHeaders(res, 'production GET /');
});

test('the headers are also on a static 404, an API 404 and an API error', async () => {
  const missing = await request(ctx.app).get('/no-such-file.txt');
  assert.equal(missing.status, 404);
  assertSecurityHeaders(missing, 'static 404', { 'default-src': ["'none'"] });
  const api404 = await request(ctx.app).get('/api/nope');
  assert.equal(api404.status, 404);
  assertSecurityHeaders(api404, 'API 404');
  const unauth = await request(ctx.app).get('/api/food');
  assert.equal(unauth.status, 401);
  assertSecurityHeaders(unauth, 'API 401');
  const csrf = await request(ctx.app).post('/auth/login').send({});
  assert.equal(csrf.status, 403);
  assertSecurityHeaders(csrf, 'CSRF 403');
});

test('the self-hosted fonts are served as fonts with the security headers', async () => {
  const res = await request(ctx.app).get(FONT);
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /^(font\/woff2|application\/font-woff2)/);
  assertSecurityHeaders(res, 'font');
  for (const file of ['Fraunces-latin-opsz-italic', 'DMSans-latin-opsz-normal', 'IBMPlexMono-latin-400-normal', 'IBMPlexMono-latin-600-normal']) {
    assert.equal((await request(ctx.app).get(`/fonts/${file}.woff2`)).status, 200, file);
  }
});

test('index.html loads no third-party font origin', async () => {
  const html = (await request(ctx.app).get('/')).text;
  assert.doesNotMatch(html, /googleapis|gstatic|preconnect/);
  assert.match(html, /href="\/css\/fonts\.css"/);
});
