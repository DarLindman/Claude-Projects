'use strict';

// Task 14: the API stores user text verbatim (escaping is a rendering concern), and the
// frontend has exactly one innerHTML sink, dom.js setHtml.

const fs = require('node:fs');
const path = require('node:path');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { buildTestApp, signedIn, csrfHeaders, PASSWORD } = require('../helpers/app');

const PAYLOADS = [
  '<img src=x onerror=window.__x=1>',
  '"><script>window.__x=1</script>',
  "'</textarea><svg onload=window.__x=1>",
];

let ctx;
before(async () => { ctx = await buildTestApp(); });
after(async () => { await ctx.pool.end(); });

test('food name and notes are stored and returned verbatim', async () => {
  const c = await signedIn(ctx.app, 'xssfood');
  for (const payload of PAYLOADS) {
    const res = await c.post('/api/food', {
      meal_type: 'lunch', food_name: payload, calories: 1, protein_g: 1, carbs_g: 1, fat_g: 1, fiber_g: 1, notes: payload,
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.food_name, payload);
    assert.equal(res.body.notes, payload);
  }
  const list = await c.get('/api/food');
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.map((r) => r.food_name).sort(), [...PAYLOADS].sort());
  assert.deepEqual(list.body.map((r) => r.notes).sort(), [...PAYLOADS].sort());
});

test('an edited food name is stored verbatim too', async () => {
  const c = await signedIn(ctx.app, 'xssedit');
  const { body: row } = await c.post('/api/food', { meal_type: 'lunch', food_name: 'plain', calories: 1 });
  const res = await c.put(`/api/food/${row.id}`, { meal_type: 'lunch', food_name: PAYLOADS[0], calories: 1, notes: PAYLOADS[1] });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.food_name, PAYLOADS[0]);
  assert.equal(res.body.notes, PAYLOADS[1]);
});

test('a payload can be the username; it is returned verbatim by register, login and /auth/me', async () => {
  for (const [i, payload] of PAYLOADS.entries()) {
    // usernames are lowercased by the server; none of the payloads contain capitals
    assert.equal(payload, payload.toLowerCase());
    assert.ok(payload.length >= 3 && payload.length <= 50);
    const reg = await request(ctx.app).post('/auth/register').set(csrfHeaders(ctx.config)).send({ username: payload, password: PASSWORD });
    assert.equal(reg.status, 200, `register #${i}: ${JSON.stringify(reg.body)}`);
    assert.deepEqual(reg.body, { username: payload });

    const login = await request(ctx.app).post('/auth/login').set(csrfHeaders(ctx.config)).send({ username: payload, password: PASSWORD });
    assert.equal(login.status, 200);
    assert.deepEqual(login.body, { username: payload });

    const cookie = login.headers['set-cookie'].find((h) => h.startsWith('fl_session=')).split(';')[0];
    const me = await request(ctx.app).get('/auth/me').set('Cookie', cookie);
    assert.equal(me.status, 200);
    assert.equal(me.body.username, payload);
  }
});

// ── static guard: no raw innerHTML outside the setHtml sink ─────────────────
const JS_DIR = path.join(__dirname, '..', '..', 'public', 'js');

function jsFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return jsFiles(full);
    return e.name.endsWith('.js') ? [full] : [];
  });
}

test('innerHTML appears only inside setHtml in dom.js (comments aside)', () => {
  const offenders = [];
  for (const file of jsFiles(JS_DIR)) {
    fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      if (!/innerHTML/.test(line)) return;
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return; // a comment line
      offenders.push(`${path.relative(JS_DIR, file)}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.equal(offenders.length, 1, `expected exactly the setHtml assignment, found:\n  ${offenders.join('\n  ')}`);
  assert.match(offenders[0], /^dom\.js:\d+: el\.innerHTML = /);
  const dom = fs.readFileSync(path.join(JS_DIR, 'dom.js'), 'utf8');
  assert.match(dom, /export function setHtml\(/);
});

test('no other HTML-parsing sink is used in the frontend', () => {
  const sinks = /insertAdjacentHTML|outerHTML|document\.write|\.srcdoc|createContextualFragment|DOMParser|\beval\(|new Function\(/;
  const offenders = [];
  for (const file of jsFiles(JS_DIR)) {
    fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      if (sinks.test(line) && !/^\s*(\/\/|\*|\/\*)/.test(line)) offenders.push(`${path.relative(JS_DIR, file)}:${i + 1}`);
    });
  }
  assert.deepEqual(offenders, []);
});
