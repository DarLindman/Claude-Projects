const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig, deployWarnings } = require('../../src/config');

const base = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  JWT_SECRET: 'x'.repeat(32),
  ANTHROPIC_API_KEY: 'sk-ant-test',
};

test('valid development env loads with defaults', () => {
  const c = loadConfig({ ...base });
  assert.equal(c.port, 3000);
  assert.equal(c.origin, 'http://localhost:3000');
  assert.equal(c.nodeEnv, 'development');
  assert.equal(c.trustProxy, 0);
  assert.equal(c.isProd, false);
  assert.equal(c.databaseUrl, base.DATABASE_URL);
  assert.equal(c.jwtSecret, base.JWT_SECRET);
  assert.equal(c.anthropicApiKey, 'sk-ant-test');
  assert.equal(c.databaseCa, undefined);
  assert.equal(c.imageModel, 'claude-sonnet-5-5');
});

test('JWT_SECRET of 31 chars throws and names JWT_SECRET', () => {
  assert.throws(
    () => loadConfig({ ...base, JWT_SECRET: 'x'.repeat(31) }),
    (e) => e instanceof Error && e.message.includes('JWT_SECRET')
  );
});

test('missing JWT_SECRET throws', () => {
  const env = { ...base };
  delete env.JWT_SECRET;
  assert.throws(() => loadConfig(env), /JWT_SECRET/);
});

test('missing DATABASE_URL throws', () => {
  const env = { ...base };
  delete env.DATABASE_URL;
  assert.throws(() => loadConfig(env), /DATABASE_URL/);
});

test('production without ORIGIN throws', () => {
  assert.throws(() => loadConfig({ ...base, NODE_ENV: 'production' }), /ORIGIN/);
});

test('production without ANTHROPIC_API_KEY throws', () => {
  const env = { ...base, NODE_ENV: 'production', ORIGIN: 'https://app.example.com' };
  delete env.ANTHROPIC_API_KEY;
  assert.throws(() => loadConfig(env), /ANTHROPIC_API_KEY/);
});

test('NODE_ENV=test without ANTHROPIC_API_KEY is valid', () => {
  const env = { ...base, NODE_ENV: 'test' };
  delete env.ANTHROPIC_API_KEY;
  const c = loadConfig(env);
  assert.equal(c.nodeEnv, 'test');
  assert.equal(c.anthropicApiKey, undefined);
});

test('development without ANTHROPIC_API_KEY is valid', () => {
  const env = { ...base };
  delete env.ANTHROPIC_API_KEY;
  assert.doesNotThrow(() => loadConfig(env));
});

test('production defaults: trustProxy 1, isProd true, origin from env', () => {
  const c = loadConfig({ ...base, NODE_ENV: 'production', ORIGIN: 'https://app.example.com' });
  assert.equal(c.trustProxy, 1);
  assert.equal(c.isProd, true);
  assert.equal(c.origin, 'https://app.example.com');
});

test('explicit TRUST_PROXY wins and is a number', () => {
  const c = loadConfig({ ...base, TRUST_PROXY: '2' });
  assert.equal(c.trustProxy, 2);
  const p = loadConfig({ ...base, NODE_ENV: 'production', ORIGIN: 'https://a.example', TRUST_PROXY: '0' });
  assert.equal(p.trustProxy, 0);
});

test('PORT is parsed as a number', () => {
  assert.equal(loadConfig({ ...base, PORT: '8080' }).port, 8080);
});

test('invalid PORT, TRUST_PROXY and NODE_ENV are rejected', () => {
  assert.throws(() => loadConfig({ ...base, PORT: 'abc' }), /PORT/);
  assert.throws(() => loadConfig({ ...base, TRUST_PROXY: '-1' }), /TRUST_PROXY/);
  assert.throws(() => loadConfig({ ...base, TRUST_PROXY: 'x' }), /TRUST_PROXY/);
  assert.throws(() => loadConfig({ ...base, NODE_ENV: 'staging' }), /NODE_ENV/);
});

test('DATABASE_CA is passed through when set', () => {
  const pem = '-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----';
  assert.equal(loadConfig({ ...base, DATABASE_CA: pem }).databaseCa, pem);
});

test('result is frozen', () => {
  const c = loadConfig({ ...base });
  assert.ok(Object.isFrozen(c));
});

test('multiple problems are all reported in one error', () => {
  assert.throws(
    () => loadConfig({ NODE_ENV: 'production', JWT_SECRET: 'short' }),
    (e) =>
      ['DATABASE_URL', 'JWT_SECRET', 'ORIGIN', 'ANTHROPIC_API_KEY'].every((n) =>
        e.message.includes(n)
      )
  );
});

// ─── ORIGIN validation ───────────────────────────────────────────────────────
test('ORIGIN must be a bare http(s) origin: anything else is rejected and names ORIGIN', () => {
  for (const bad of ['localhost:3000', 'http://localhost:3000/path', 'ftp://example.com', 'not a url', 'https://food.example.com/x/', 'http://localhost:3000?x=1', 'http://localhost:3000//', 'javascript:alert(1)']) {
    assert.throws(
      () => loadConfig({ ...base, ORIGIN: bad }),
      (e) => e instanceof Error && e.message.includes('ORIGIN'),
      `ORIGIN ${JSON.stringify(bad)} must be rejected`
    );
  }
});

test('a bad ORIGIN is rejected in production too, and reported together with other problems', () => {
  assert.throws(() => loadConfig({ ...base, NODE_ENV: 'production', ORIGIN: 'food.example.com' }), /ORIGIN/);
  assert.throws(
    () => loadConfig({ ...base, JWT_SECRET: 'short', ORIGIN: 'localhost:3000' }),
    (e) => e.message.includes('JWT_SECRET') && e.message.includes('ORIGIN')
  );
});

test('a valid ORIGIN is accepted and stored without a trailing slash', () => {
  assert.equal(loadConfig({ ...base, ORIGIN: 'http://localhost:3000' }).origin, 'http://localhost:3000');
  assert.equal(loadConfig({ ...base, ORIGIN: 'https://food.example.com/' }).origin, 'https://food.example.com');
  assert.equal(loadConfig({ ...base, ORIGIN: 'https://food.example.com' }).origin, 'https://food.example.com');
  const p = loadConfig({ ...base, NODE_ENV: 'production', ORIGIN: 'https://food.example.com/' });
  assert.equal(p.origin, 'https://food.example.com');
});

test('JWT_SECRET is trimmed: the trimmed value is used and the length check applies to it', () => {
  const secret = 'y'.repeat(32);
  assert.equal(loadConfig({ ...base, JWT_SECRET: `  ${secret}\n` }).jwtSecret, secret);
  assert.throws(() => loadConfig({ ...base, JWT_SECRET: `${'y'.repeat(31)}   ` }), /JWT_SECRET/);
});

test('.env.example placeholder JWT_SECRET is rejected, so it cannot be deployed unchanged', () => {
  const text = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', '..', '.env.example'), 'utf8');
  const line = text.split(/\r?\n/).find((l) => l.startsWith('JWT_SECRET='));
  assert.ok(line, 'JWT_SECRET line present');
  assert.throws(() => loadConfig({ ...base, JWT_SECRET: line.slice('JWT_SECRET='.length) }), /JWT_SECRET/);
});

// ─── IMAGE_MODEL ─────────────────────────────────────────────────────────────
test('IMAGE_MODEL defaults to claude-sonnet-5-5, in development and production', () => {
  assert.equal(loadConfig({ ...base }).imageModel, 'claude-sonnet-5-5');
  assert.equal(loadConfig({ ...base, NODE_ENV: 'production', ORIGIN: 'https://a.example' }).imageModel, 'claude-sonnet-5-5');
});

test('IMAGE_MODEL overrides the default and is trimmed', () => {
  assert.equal(loadConfig({ ...base, IMAGE_MODEL: 'claude-haiku-4-5-20251001' }).imageModel, 'claude-haiku-4-5-20251001');
  assert.equal(loadConfig({ ...base, IMAGE_MODEL: '  claude-haiku-4-5-20251001\n' }).imageModel, 'claude-haiku-4-5-20251001');
  assert.equal(loadConfig({ ...base, IMAGE_MODEL: 'claude-sonnet-4.5_x' }).imageModel, 'claude-sonnet-4.5_x');
});

test('an invalid IMAGE_MODEL is a startup error naming IMAGE_MODEL, reported with other problems', () => {
  for (const bad of ['gpt-4', '', '   ', '\n', 'CLAUDE-SONNET-5-5', 'claude-', 'claude', 'claude-sonnet 5', 'claude-sonnet/5', 'xclaude-sonnet', 'claude-sonnet-5-5;rm']) {
    assert.throws(
      () => loadConfig({ ...base, IMAGE_MODEL: bad }),
      (e) => e instanceof Error && e.message.includes('IMAGE_MODEL'),
      `IMAGE_MODEL ${JSON.stringify(bad)} must be rejected`
    );
  }
  assert.throws(
    () => loadConfig({ ...base, JWT_SECRET: 'short', IMAGE_MODEL: 'gpt-4' }),
    (e) => e.message.includes('JWT_SECRET') && e.message.includes('IMAGE_MODEL')
  );
});

// ─── IMAGE_EFFORT ────────────────────────────────────────────────────────────
test('IMAGE_EFFORT defaults to low and accepts low, medium, high and off (trimmed)', () => {
  assert.equal(loadConfig({ ...base }).imageEffort, 'low');
  for (const v of ['low', 'medium', 'high', 'off']) assert.equal(loadConfig({ ...base, IMAGE_EFFORT: v }).imageEffort, v);
  assert.equal(loadConfig({ ...base, IMAGE_EFFORT: '  high' + String.fromCharCode(10) }).imageEffort, 'high');
});

test('an invalid IMAGE_EFFORT is a startup error naming IMAGE_EFFORT, reported with other problems', () => {
  for (const bad of ['extreme', 'LOW', '', '  ', 'none']) {
    assert.throws(
      () => loadConfig({ ...base, IMAGE_EFFORT: bad }),
      (e) => e instanceof Error && e.message.includes('IMAGE_EFFORT'),
      `IMAGE_EFFORT ${JSON.stringify(bad)} must be rejected`
    );
  }
  assert.throws(
    () => loadConfig({ ...base, JWT_SECRET: 'short', IMAGE_EFFORT: 'extreme' }),
    (e) => e.message.includes('JWT_SECRET') && e.message.includes('IMAGE_EFFORT')
  );
});

test('the .env.example IMAGE_MODEL line, if uncommented, is a valid id', () => {
  const text = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', '..', '.env.example'), 'utf8');
  const lines = text.split(/\r?\n/).filter((l) => /^#?\s*IMAGE_MODEL=/.test(l));
  assert.ok(lines.length >= 1, 'IMAGE_MODEL is documented');
  for (const l of lines) {
    const value = l.replace(/^#?\s*IMAGE_MODEL=/, '');
    assert.match(loadConfig({ ...base, IMAGE_MODEL: value }).imageModel, /^claude-/);
  }
});

test('deployWarnings: a Railway deploy without NODE_ENV=production warns, production and non-Railway do not', () => {
  const dev = loadConfig({ ...base });
  const prod = loadConfig({ ...base, NODE_ENV: 'production', ORIGIN: 'https://app.example.com' });
  assert.equal(deployWarnings(dev, { RAILWAY_ENVIRONMENT: 'production' }).length, 1);
  assert.match(deployWarnings(dev, { RAILWAY_ENVIRONMENT: 'production' })[0], /NODE_ENV=production/);
  assert.equal(deployWarnings(dev, { RAILWAY_PUBLIC_DOMAIN: 'x.up.railway.app' }).length, 1);
  assert.deepEqual(deployWarnings(dev, {}), []);
  assert.deepEqual(deployWarnings(dev, { RAILWAY_ENVIRONMENT: '' }), []);
  assert.deepEqual(deployWarnings(prod, { RAILWAY_ENVIRONMENT: 'production', RAILWAY_PUBLIC_DOMAIN: 'x' }), []);
});
