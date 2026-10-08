'use strict';

// Text analysis evaluation: the same free-text meal descriptions through the REAL text
// analysis pipeline (analyzeText: request rules of the model family, retry, the sanity rules
// and the Hebrew-name guard, exactly as in production) on two or more models, written to
// eval/text-results.json and eval/text-report.html. A developer tool: not part of the app
// (src/ must never require it), not run by the tests against the real API, never run in CI.
//
//   node scripts/eval-text.js [--models claude-haiku-4-5-20251001,claude-haiku-5-5] [--runs 1] [--yes]
//
// Without --yes it only prints the plan (the number of calls and an estimated cost), builds
// no client and calls nothing. With --yes it needs ANTHROPIC_API_KEY (from food-logger/.env
// or the environment; never printed). Every real run costs money and needs the owner's
// approval. The built-in inputs are in scripts/eval/textInputs.js. Everything is written
// inside the output directory (eval/, git-ignored) and nowhere else.

const fs = require('node:fs');
const path = require('node:path');
const { MODEL, createAnthropic } = require('../src/lib/anthropic');
const { analyzeText } = require('../src/lib/analysis');
const { REPAIR_PROMPT_PREFIX } = require('../src/lib/hebrewName');
const { TEXT_INPUTS } = require('./eval/textInputs');
const { renderReport, summarize } = require('./eval/textReport');

const DEFAULT_MODELS = [MODEL, 'claude-haiku-5-5'];

// ESTIMATE ONLY, not a price list: one text call is roughly 1,800 input tokens (system prompt,
// reply template, the text) and 300-600 output tokens (more on a model that thinks) at about
// $1 / $5 per million tokens, so about $0.004 to $0.006; 0.006 is a deliberately conservative
// round figure per call, repair calls included. Check the Anthropic price page.
const ESTIMATED_COST_PER_CALL_USD = 0.006;

const ROOT = path.join(__dirname, '..');
const MAX_RUNS = 10;
const MAX_MODELS = 4;
const MODEL_ID = /^claude-[A-Za-z0-9._-]+$/;
const LATIN = /[A-Za-z]/;
const USAGE = 'node scripts/eval-text.js [--models <id>,<id>] [--runs 1] [--yes]';

function parseModels(value) {
  const models = String(value ?? '').split(',').map((m) => m.trim());
  if (models.length < 1 || models.length > MAX_MODELS || models.some((m) => !MODEL_ID.test(m)) || new Set(models).size !== models.length) {
    throw new Error(`--models needs 1 to ${MAX_MODELS} different model ids starting with "claude-", separated by commas (for example ${DEFAULT_MODELS.join(',')})`);
  }
  return models;
}

function parseArgs(argv) {
  const opts = { models: DEFAULT_MODELS, runs: 1, yes: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--yes') opts.yes = true;
    else if (arg === '--models') {
      if (i + 1 >= argv.length) throw new Error('--models needs a comma-separated list of model ids');
      opts.models = parseModels(argv[++i]);
    } else if (arg === '--runs') {
      const value = argv[++i];
      if (!/^\d+$/.test(value ?? '') || Number(value) < 1 || Number(value) > MAX_RUNS) throw new Error(`--runs needs a whole number from 1 to ${MAX_RUNS}`);
      opts.runs = Number(value);
    } else throw new Error(`Unknown argument ${arg}. Usage: ${USAGE}`);
  }
  return opts;
}

const defaultDeps = () => ({
  createClient: (apiKey) => createAnthropic({ anthropicApiKey: apiKey }),
  writeFile: (p, data) => fs.promises.writeFile(p, data),
  mkdir: (p) => fs.promises.mkdir(p, { recursive: true }),
  now: () => new Date(),
  log: (line) => console.log(line),
});

const fail = (error, log) => { log(`ERROR: ${error}`); return { exitCode: 1, error }; };
const safeMessage = (err) => String(err?.message ?? err).replace(/sk-ant-[A-Za-z0-9_-]+/g, '<key>').slice(0, 200);

// Wraps the client to record every model call of one analyzeText run (main calls, the parse
// retry and the name-repair call) without changing it: milliseconds are those of the whole
// run, tokens the sum of the calls' usage.
function recordingClient(client) {
  const rec = { calls: 0, repairCalls: 0, inputTokens: 0, outputTokens: 0, stopReason: undefined, usageSeen: false };
  const wrapped = {
    messages: {
      async create(request, ...rest) {
        const repair = typeof request?.system === 'string' && request.system.startsWith(REPAIR_PROMPT_PREFIX);
        rec.calls += 1;
        if (repair) rec.repairCalls += 1;
        const message = await client.messages.create(request, ...rest);
        const usage = message?.usage;
        if (usage && Number.isFinite(usage.input_tokens)) { rec.inputTokens += usage.input_tokens; rec.usageSeen = true; }
        if (usage && Number.isFinite(usage.output_tokens)) rec.outputTokens += usage.output_tokens;
        if (!repair) rec.stopReason = message?.stop_reason;
        return message;
      },
    },
  };
  return { wrapped, rec };
}

// One input on one model through the production pipeline. The guard reports its outcome
// only as a console.warn line ("hebrewName repaired: ..."), so that one line is read (and
// kept off the screen) while the call runs; no outcome line means the name was fine.
async function evaluateOne(client, text, model) {
  const { wrapped, rec } = recordingClient(client);
  const warn = console.warn;
  let nameAction = 'ok';
  console.warn = (...args) => {
    const m = typeof args[0] === 'string' ? /^hebrewName (repaired|cleaned|fallback):/.exec(args[0]) : null;
    if (m) nameAction = m[1];
    else warn.apply(console, args);
  };
  const start = Date.now();
  try {
    const out = await analyzeText(wrapped, text, { model });
    return {
      foodName: out.foodName, calories: out.calories, protein_g: out.protein_g, carbs_g: out.carbs_g, fat_g: out.fat_g, fiber_g: out.fiber_g,
      items: out.items, nameAction, ms: Date.now() - start, inputTokens: rec.usageSeen ? rec.inputTokens : null, outputTokens: rec.usageSeen ? rec.outputTokens : null,
      calls: rec.calls, repairCalls: rec.repairCalls, stopReason: rec.stopReason ?? null,
    };
  } catch (err) {
    return { error: safeMessage(err), ms: Date.now() - start, inputTokens: rec.usageSeen ? rec.inputTokens : null, outputTokens: rec.usageSeen ? rec.outputTokens : null, calls: rec.calls, repairCalls: rec.repairCalls, stopReason: rec.stopReason ?? null };
  } finally {
    console.warn = warn;
  }
}

async function run(options = {}, deps = {}) {
  const d = { ...defaultDeps(), ...deps };
  const env = options.env ?? process.env;
  const runs = options.runs ?? 1;
  if (!Number.isInteger(runs) || runs < 1 || runs > MAX_RUNS) return fail(`runs must be a whole number from 1 to ${MAX_RUNS}`, d.log);
  let models;
  try {
    models = parseModels((options.models ?? DEFAULT_MODELS).join(','));
  } catch (err) {
    return fail(`${err.message}; nothing was sent`, d.log);
  }
  const inputs = options.inputs ?? TEXT_INPUTS;
  const outDir = path.resolve(ROOT, options.outDir ?? 'eval');

  const calls = inputs.length * runs * models.length;
  // the guard makes at most one repair call per run, and only for a text with Latin letters
  const repairable = inputs.filter((t) => LATIN.test(t)).length;
  const maxCalls = calls + repairable * runs * models.length;
  const plan = { inputs: inputs.length, runs, models, calls, maxCalls, estimatedCostUsd: Number((maxCalls * ESTIMATED_COST_PER_CALL_USD).toFixed(2)) };
  d.log(`${inputs.length} texts x ${runs} runs x ${models.length} models (${models.join(', ')}) = ${calls} API calls (up to ${maxCalls} with name-repair calls; a parse retry would add more).`);
  d.log(`Estimated cost: up to about $${plan.estimatedCostUsd.toFixed(2)} (estimate at $${ESTIMATED_COST_PER_CALL_USD} per call; see the constant in scripts/eval-text.js).`);
  d.log(`The texts are sent to the Anthropic API (${models.join(', ')}) and nowhere else. Results go to ${outDir}.`);
  if (!options.yes) {
    d.log('Nothing was sent. Add --yes to run it for real (every real run costs money and needs the owner\'s approval).');
    return { exitCode: 0, plan };
  }

  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) return fail('ANTHROPIC_API_KEY is not set (put it in food-logger/.env or the environment)', d.log);
  const client = d.createClient(apiKey);

  const results = { generatedAt: d.now().toISOString(), models, runsPerInput: runs, apiCalls: 0, inputs: [] };
  for (const [i, text] of inputs.entries()) {
    const entry = { text, results: Object.fromEntries(models.map((m) => [m, []])) };
    for (let n = 1; n <= runs; n++) {
      for (const model of models) {
        d.log(`[${i + 1}/${inputs.length}] run ${n}/${runs} on ${model}`);
        const rec = await evaluateOne(client, text, model);
        results.apiCalls += rec.calls || 0;
        entry.results[model].push(rec);
      }
    }
    results.inputs.push(entry);
  }

  await d.mkdir(outDir);
  const resultsPath = path.join(outDir, 'text-results.json');
  const reportPath = path.join(outDir, 'text-report.html');
  await d.writeFile(resultsPath, JSON.stringify(results, null, 2));
  await d.writeFile(reportPath, renderReport(results));
  const summary = summarize(results);
  d.log(`Done: ${results.apiCalls} API calls.`);
  for (const m of models) {
    const s = summary[m];
    d.log(`${m}: ${s.errors} failed of ${s.runs} runs; names ${s.repaired} repaired, ${s.cleaned} cleaned, ${s.fallback} fallback; average ${s.avgMs ?? '?'} ms, tokens in ${s.avgInputTokens ?? '?'} / out ${s.avgOutputTokens ?? '?'}, calories ${s.avgCalories ?? '?'}.`);
  }
  d.log(`Wrote ${resultsPath} and ${reportPath}`);
  return { exitCode: 0, plan, results, summary, resultsPath, reportPath };
}

async function main() {
  let result;
  try {
    const options = parseArgs(process.argv.slice(2));
    // The key is loaded only for a real run (a dry run reads no secret).
    if (options.yes) require('dotenv').config({ path: path.join(ROOT, '.env') });
    result = await run(options);
  } catch (err) {
    console.log(`ERROR: ${err.message}`);
    result = { exitCode: 1 };
  }
  process.exitCode = result.exitCode;
}

module.exports = { run, parseArgs, evaluateOne, ESTIMATED_COST_PER_CALL_USD, DEFAULT_MODELS };

if (require.main === module) main();
