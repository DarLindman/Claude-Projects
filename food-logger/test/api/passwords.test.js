'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const passwords = require('../../src/lib/passwords');
const { buildTestApp, signedIn, csrfHeaders, PASSWORD } = require('../helpers/app');

let ctx;
before(async () => { ctx = await buildTestApp(); });
after(async () => { await ctx.pool.end(); });

const register = (username, password) => request(ctx.app).post('/auth/register').set(csrfHeaders(ctx.config)).send({ username, password });
const hashOf = async (username) => (await ctx.pool.query('SELECT password_hash FROM users WHERE username = $1', [username])).rows[0].password_hash;
const HE = 'א'; // 2 bytes in UTF-8

test('module: COST is 12 and validateNewPassword throws the contract codes', () => {
  assert.equal(passwords.COST, 12);
  assert.throws(() => passwords.validateNewPassword('a'.repeat(7)), { status: 400, code: 'WEAK_PASSWORD' });
  assert.throws(() => passwords.validateNewPassword('a'.repeat(73)), { status: 400, code: 'PASSWORD_TOO_LONG' });
  assert.doesNotThrow(() => passwords.validateNewPassword('a'.repeat(8)));
  assert.doesNotThrow(() => passwords.validateNewPassword('a'.repeat(72)));
});

test('register: 7 characters is WEAK_PASSWORD, 8 is accepted', async () => {
  const weak = await register('weak1', 'a'.repeat(7));
  assert.equal(weak.status, 400);
  assert.deepEqual(weak.body, { error: { code: 'WEAK_PASSWORD' } });
  const ok = await register('weak1', 'a'.repeat(8));
  assert.equal(ok.status, 200);
});

test('change-password: 7 characters is WEAK_PASSWORD, 8 is accepted', async () => {
  const c = await signedIn(ctx.app, 'changer1');
  const weak = await c.post('/auth/change-password', { currentPassword: PASSWORD, newPassword: 'a'.repeat(7) });
  assert.equal(weak.status, 400);
  assert.deepEqual(weak.body, { error: { code: 'WEAK_PASSWORD' } });
  const ok = await c.post('/auth/change-password', { currentPassword: PASSWORD, newPassword: 'a'.repeat(8) });
  assert.equal(ok.status, 200);
});

test('register and change-password: the 72-byte limit counts bytes, not characters', async () => {
  const cases = [
    ['72 ASCII bytes', 'a'.repeat(72), 200],
    ['73 ASCII bytes', 'a'.repeat(73), 400],
    ['25 Hebrew letters (50 bytes)', HE.repeat(25), 200],
    ['36 Hebrew letters (72 bytes)', HE.repeat(36), 200],
    ['37 Hebrew letters (74 bytes)', HE.repeat(37), 400],
  ];
  const c = await signedIn(ctx.app, 'bytes1');
  let n = 0;
  for (const [name, pw, status] of cases) {
    const reg = await register(`bytes-reg-${n++}`, pw);
    assert.equal(reg.status, status, `register ${name}: ${JSON.stringify(reg.body)}`);
    if (status === 400) assert.deepEqual(reg.body, { error: { code: 'PASSWORD_TOO_LONG' } }, name);
    const cp = await c.post('/auth/change-password', { currentPassword: PASSWORD, newPassword: pw });
    assert.equal(cp.status, status, `change-password ${name}: ${JSON.stringify(cp.body)}`);
    if (status === 400) assert.deepEqual(cp.body, { error: { code: 'PASSWORD_TOO_LONG' } }, name);
    if (status === 200) {
      // switch back so the next case starts from the known current password
      const back = await c.post('/auth/change-password', { currentPassword: pw, newPassword: PASSWORD });
      assert.equal(back.status, 200, name);
    }
  }
});

test('a password over the 1024-character work bound stays a VALIDATION TOO_LONG', async () => {
  const res = await register('huge1', 'a'.repeat(1025));
  assert.equal(res.status, 400);
  assert.deepEqual(res.body, { error: { code: 'VALIDATION' }, fields: { password: 'TOO_LONG' } });
});

test('new hashes (register and change-password) are bcrypt cost 12', async () => {
  const c = await signedIn(ctx.app, 'hashes1');
  assert.match(await hashOf('hashes1'), /^\$2[ab]\$12\$/);
  assert.equal((await c.post('/auth/change-password', { currentPassword: PASSWORD, newPassword: 'another-pw-2' })).status, 200);
  assert.match(await hashOf('hashes1'), /^\$2[ab]\$12\$/);
  assert.match(await passwords.hashPassword('whatever-1'), /^\$2[ab]\$12\$/);
});

test('hashPassword, verifyPassword and needsRehash', async () => {
  const low = await passwords.hashPassword('secret-word', 4);
  assert.match(low, /^\$2[ab]\$04\$/);
  assert.equal(await passwords.verifyPassword('secret-word', low), true);
  assert.equal(await passwords.verifyPassword('other-word', low), false);
  assert.equal(passwords.needsRehash(low), true);
  assert.equal(passwords.needsRehash(bcrypt.hashSync('x', 10)), true);
  assert.equal(passwords.needsRehash(passwords.DUMMY_HASH), false);
  assert.match(passwords.DUMMY_HASH, /^\$2[ab]\$12\$/);
});

test('an existing cost-10 account with a short password can still log in and is rehashed to cost 12', async () => {
  const old = bcrypt.hashSync('short', 10);
  await ctx.pool.query('INSERT INTO users (username, password_hash) VALUES ($1, $2)', ['legacy1', old]);
  const bad = await request(ctx.app).post('/auth/login').set(csrfHeaders(ctx.config)).send({ username: 'legacy1', password: 'wrong' });
  assert.equal(bad.status, 401);
  assert.equal(await hashOf('legacy1'), old, 'a failed login must not rehash');
  const res = await request(ctx.app).post('/auth/login').set(csrfHeaders(ctx.config)).send({ username: 'legacy1', password: 'short' });
  assert.equal(res.status, 200);
  assert.equal(res.body.username, 'legacy1');
  const upgraded = await hashOf('legacy1');
  assert.match(upgraded, /^\$2[ab]\$12\$/);
  const again = await request(ctx.app).post('/auth/login').set(csrfHeaders(ctx.config)).send({ username: 'legacy1', password: 'short' });
  assert.equal(again.status, 200, 'the rehashed account still logs in');
  assert.equal(await hashOf('legacy1'), upgraded, 'no rehash when already cost 12');
});

test('the login rehash is compare-and-swap: a password change that lands during the login is not overwritten', async () => {
  const oldHash = bcrypt.hashSync('old-password-1', 10);
  await ctx.pool.query('INSERT INTO users (username, password_hash) VALUES ($1, $2)', ['casuser', oldHash]);
  const changedHash = await passwords.hashPassword('changed-password-2');
  // Deterministic race: right after the login's bcrypt verify of the old hash finishes (the
  // window before the rehash UPDATE), a concurrent change-password commits a new hash.
  const original = passwords.verifyPassword;
  let injected = 0;
  passwords.verifyPassword = async (pw, hash) => {
    const ok = await original(pw, hash);
    if (hash === oldHash) {
      injected += 1;
      await ctx.pool.query('UPDATE users SET password_hash = $1, token_version = token_version + 1 WHERE username = $2', [changedHash, 'casuser']);
    }
    return ok;
  };
  try {
    const res = await request(ctx.app).post('/auth/login').set(csrfHeaders(ctx.config)).send({ username: 'casuser', password: 'old-password-1' });
    assert.equal(res.status, 200, 'the login itself verified against the hash it read');
  } finally {
    passwords.verifyPassword = original;
  }
  assert.equal(injected, 1, 'the concurrent change ran inside the window');
  assert.equal(await hashOf('casuser'), changedHash, 'the rehash of the old password must not overwrite the new hash');
  const oldPw = await request(ctx.app).post('/auth/login').set(csrfHeaders(ctx.config)).send({ username: 'casuser', password: 'old-password-1' });
  assert.equal(oldPw.status, 401, 'the old password no longer works');
  const newPw = await request(ctx.app).post('/auth/login').set(csrfHeaders(ctx.config)).send({ username: 'casuser', password: 'changed-password-2' });
  assert.equal(newPw.status, 200, 'the new password still works');
});

test('login for an unknown user still runs verifyPassword against the dummy hash', async () => {
  const calls = [];
  const original = passwords.verifyPassword;
  passwords.verifyPassword = (pw, hash) => { calls.push(hash); return original(pw, hash); };
  try {
    const res = await request(ctx.app).post('/auth/login').set(csrfHeaders(ctx.config)).send({ username: 'nobody-at-all', password: 'whatever-1' });
    assert.equal(res.status, 401);
    assert.deepEqual(res.body, { error: { code: 'INVALID_CREDENTIALS' } });
  } finally {
    passwords.verifyPassword = original;
  }
  assert.deepEqual(calls, [passwords.DUMMY_HASH]);
});

test('simultaneous registrations of Dar and dar: exactly one 200 and one 409 USERNAME_TAKEN, never a 500', async () => {
  for (let i = 0; i < 3; i++) {
    const [a, b] = await Promise.all([register(`Dar${i}`, PASSWORD), register(`dar${i}`, PASSWORD)]);
    assert.deepEqual([a.status, b.status].sort(), [200, 409], JSON.stringify([a.body, b.body]));
    const loser = a.status === 409 ? a : b;
    assert.deepEqual(loser.body, { error: { code: 'USERNAME_TAKEN' } });
    const { rows } = await ctx.pool.query('SELECT username FROM users WHERE username = $1', [`dar${i}`]);
    assert.equal(rows.length, 1);
  }
});
