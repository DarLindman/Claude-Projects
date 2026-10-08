'use strict';

// The text evaluation tool (scripts/eval-text.js, scripts/eval/text*.js): never part of the
// app and never calls the real API here; the client is always the fake.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { fakeAnthropic } = require('../helpers/fakeAnthropic');
const { run, parseArgs, DEFAULT_MODELS, ESTIMATED_COST_PER_CALL_USD } = require('../../scripts/eval-text');
const { TEXT_INPUTS } = require('../../scripts/eval/textInputs');
const { renderReport } = require('../../scripts/eval/textReport');
const { REPAIR_PROMPT_PREFIX } = require('../../src/lib/hebrewName');

const KEY = { ANTHROPIC_API_KEY: 'sk-ant-not-a-real-key' };
const isRepairCall = (c) => typeof c.system === 'string' && c.system.startsWith(REPAIR_PROMPT_PREFIX);
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'eval-text-'));

function runWith(options = {}, fake = fakeAnthropic()) {
  const lines = [];
  const out = tmpDir();
  const promise = run({ outDir: out, env: KEY, ...options }, { createClient: () => fake, log: (l) => lines.push(l) });
  return { promise, lines, out, fake };
}

test('the built-in inputs: about 20 distinct Hebrew texts, within the app limit, one with emoji', () => {
  assert.ok(TEXT_INPUTS.length >= 20 && TEXT_INPUTS.length <= 30);
  assert.equal(new Set(TEXT_INPUTS).size, TEXT_INPUTS.length);
  for (const t of TEXT_INPUTS) assert.ok(t.length > 0 && t.length <= 500 && /[א-ת]/.test(t), t);
  assert.ok(TEXT_INPUTS.some((t) => /\p{Extended_Pictographic}/u.test(t)));
});

test('parseArgs: defaults, --models, --runs, --yes, and bad input', () => {
  assert.deepEqual(parseArgs([]), { models: DEFAULT_MODELS, runs: 1, yes: false });
  assert.deepEqual(DEFAULT_MODELS, ['claude-haiku-4-5-20251001', 'claude-haiku-5-5']);
  assert.deepEqual(parseArgs(['--models', 'claude-a, claude-b', '--runs', '3', '--yes']), { models: ['claude-a', 'claude-b'], runs: 3, yes: true });
  for (const bad of [['--runs', '0'], ['--runs', 'x'], ['--runs', '11'], ['--runs'], ['--models'], ['--models', 'gpt-4'], ['--models', 'claude-a,claude-a'], ['--models', 'claude-a,'], ['--nope']]) {
    assert.throws(() => parseArgs(bad), Error, bad.join(' '));
  }
});

test('a dry run prints the call count and an estimated cost, never builds a client, never calls the API, writes nothing', async () => {
  const lines = [];
  const out = path.join(tmpDir(), 'out');
  let clients = 0;
  const result = await run({ outDir: out, env: {}, runs: 2 }, {
    createClient: () => { clients += 1; throw new Error('a dry run must not build a client'); },
    writeFile: () => { throw new Error('a dry run must not write'); },
    mkdir: () => { throw new Error('a dry run must not write'); },
    log: (l) => lines.push(l),
  });
  assert.equal(result.exitCode, 0);
  assert.equal(clients, 0);
  assert.equal(result.plan.calls, TEXT_INPUTS.length * 2 * 2);
  assert.ok(result.plan.maxCalls >= result.plan.calls);
  assert.equal(result.plan.estimatedCostUsd, Number((result.plan.maxCalls * ESTIMATED_COST_PER_CALL_USD).toFixed(2)));
  const text = lines.join('\n');
  assert.match(text, new RegExp(`= ${result.plan.calls} API calls`));
  assert.match(text, /Estimated cost: up to about \$/);
  assert.match(text, /Nothing was sent/);
  assert.equal(fs.existsSync(out), false);
});

test('the command line without --yes is a dry run that needs no key', () => {
  const out = execFileSync(process.execPath, [path.join(__dirname, '..', '..', 'scripts', 'eval-text.js'), '--runs', '1'], {
    encoding: 'utf8', env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot },
  });
  assert.match(out, /API calls/);
  assert.match(out, /Estimated cost/);
  assert.match(out, /Nothing was sent/);
});

test('--yes without a key is an error and sends nothing', async () => {
  const lines = [];
  let clients = 0;
  const result = await run({ yes: true, env: {}, outDir: tmpDir() }, { createClient: () => { clients += 1; }, log: (l) => lines.push(l) });
  assert.equal(result.exitCode, 1);
  assert.equal(clients, 0);
  assert.match(lines.join('\n'), /ANTHROPIC_API_KEY is not set/);
});

test('an invalid model or run count is an error before anything is sent', async () => {
  let clients = 0;
  const deps = { createClient: () => { clients += 1; }, log: () => {} };
  assert.equal((await run({ models: ['gpt-4'], yes: true, env: KEY }, deps)).exitCode, 1);
  assert.equal((await run({ runs: 0, yes: true, env: KEY }, deps)).exitCode, 1);
  assert.equal(clients, 0);
});

test('a real run (fake client) goes through the production pipeline on each model and writes results and report', async () => {
  const fake = fakeAnthropic();
  fake.usage = { input_tokens: 1000, output_tokens: 200 };
  fake.repairReply = 'פסטה בשר';
  const { promise, lines, out } = runWith({ yes: true, models: ['claude-haiku-4-5-20251001', 'claude-haiku-5-5'], runs: 1, inputs: ['סלט ולחם', 'pasta בשר'] }, fake);
  const result = await promise;
  assert.equal(result.exitCode, 0);
  // 2 inputs x 2 models, plus one repair call per model for the Latin text
  assert.equal(result.results.apiCalls, 6);
  const main = fake.calls.filter((c) => !isRepairCall(c));
  assert.equal(main.length, 4);
  assert.deepEqual(main.map((c) => c.model), ['claude-haiku-4-5-20251001', 'claude-haiku-5-5', 'claude-haiku-4-5-20251001', 'claude-haiku-5-5']);
  // the request rules of the family were applied by the production code
  assert.equal(main[0].temperature, 0);
  assert.equal('temperature' in main[1], false);
  assert.deepEqual(main[1].output_config, { effort: 'low' });

  const [first, second] = result.results.inputs;
  const rec = first.results['claude-haiku-5-5'][0];
  assert.equal(rec.foodName, 'סלט ולחם');
  assert.equal(rec.calories, 145);
  assert.equal(rec.nameAction, 'ok');
  assert.equal(rec.inputTokens, 1000);
  assert.equal(rec.outputTokens, 200);
  assert.ok(Number.isFinite(rec.ms));
  assert.deepEqual(rec.items.map((i) => i.name), ['סלט', 'לחם']);
  const repaired = second.results['claude-haiku-4-5-20251001'][0];
  assert.equal(repaired.nameAction, 'repaired');
  assert.equal(repaired.repairCalls, 1);
  assert.equal(repaired.inputTokens, 1000); // the fake's repair reply carries no usage

  const json = JSON.parse(fs.readFileSync(path.join(out, 'text-results.json'), 'utf8'));
  assert.equal(json.inputs.length, 2);
  assert.deepEqual(json.models, ['claude-haiku-4-5-20251001', 'claude-haiku-5-5']);
  const html = fs.readFileSync(path.join(out, 'text-report.html'), 'utf8');
  assert.match(html, /<html lang="he" dir="rtl">/);
  assert.ok(html.includes('סלט ולחם'));
  assert.deepEqual(fs.readdirSync(out).sort(), ['text-report.html', 'text-results.json']);
  assert.ok(!JSON.stringify(json).includes(KEY.ANTHROPIC_API_KEY));
  assert.ok(!lines.join('\n').includes(KEY.ANTHROPIC_API_KEY));
  assert.ok(!html.includes(KEY.ANTHROPIC_API_KEY));
});

test('a failing model call is recorded as an error for that run and the run goes on', async () => {
  const fake = fakeAnthropic();
  const original = fake.messages.create;
  fake.messages.create = async (args) => {
    if (args.model === 'claude-haiku-5-5') throw new Error(`400 invalid_request_error ${KEY.ANTHROPIC_API_KEY}`);
    return original(args);
  };
  const { promise } = runWith({ yes: true, runs: 1, inputs: ['סלט ולחם'] }, fake);
  const result = await promise;
  assert.equal(result.exitCode, 0);
  const rec = result.results.inputs[0].results['claude-haiku-5-5'][0];
  assert.match(rec.error, /invalid_request_error/);
  assert.ok(!rec.error.includes(KEY.ANTHROPIC_API_KEY));
  assert.equal(result.results.inputs[0].results['claude-haiku-4-5-20251001'][0].calories, 145);
  assert.equal(result.summary['claude-haiku-5-5'].errors, 1);
});

test('the report escapes everything that comes from an AI or an error', () => {
  const html = renderReport({
    generatedAt: '2026-10-08T00:00:00Z', models: ['claude-a'], runsPerInput: 1, apiCalls: 1,
    inputs: [
      { text: '<script>alert(1)</script>', results: { 'claude-a': [{ foodName: '<img src=x onerror=alert(2)>', calories: 1, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0, items: [{ name: '<b>x</b>', calories: 1 }], nameAction: 'ok', ms: 5, inputTokens: 1, outputTokens: 1, calls: 1 }] } },
      { text: 'ok', results: { 'claude-a': [{ error: '<svg onload=alert(3)>' }] } },
    ],
  });
  assert.ok(!/<script>alert|<img src=x|<b>x<\/b>|<svg onload/.test(html));
  assert.ok(html.includes('&lt;script&gt;'));
});
