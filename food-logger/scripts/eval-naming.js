'use strict';

// Naming evaluation: the same photos through the OLD pipeline (old prompt + silent name
// stripping) and the NEW one (new prompt + the Hebrew-name guard), several runs each,
// written to eval/results.json and eval/report.html. A developer tool: not part of the
// app, not run by the tests against the real API, never run in CI.
//
//   node scripts/eval-naming.js [--dir eval/photos] [--runs 3] [--also-model <model-id> [--only-extra]
//     [--prompt <name>] [--effort <low|medium|high|off>]] [--yes]
//
// Without --yes it only prints the plan and the estimated cost and calls nothing.
// The photos (eval/ is git-ignored) are sent only to the Anthropic API. Optional
// eval/ratings.json: { "<file name>": { "natural": true|false, "note": "", "extra": true|false } }
// (`natural` rates the new variant, the optional `extra` the one on --also-model).
// --also-model adds a third variant: the NEW pipeline (same prompt and guard) on that model.
// It is sent WITHOUT the temperature parameter, because some newer models reject it.
// --only-extra (needs --also-model) runs only that third variant on the photos and merges
// it into the existing eval/results.json (same photo file names and number of runs), keeping
// the stored old and new results untouched (the replaced extra's name and calories stay as
// previousExtra); it regenerates eval/report.html.
// --prompt <name> and --effort <low|medium|high|off> apply to that third variant only (so they
// need --also-model): --prompt sends the image prompt of scripts/eval/prompts/<name>.js (it
// exports IMAGE_SYSTEM_PROMPT and IMAGE_USER_MESSAGE; an unknown name is an error) instead of
// the runtime one, and --effort sets the effort of the Sonnet 5 low-latency request fields
// (default low, off sends none). Both are recorded in variants.extra and shown in the report.
// Every recorded side also holds the latency (ms), the token usage and the stop reason of its
// model call; the summary and the report show the extra variant's averages.
// Everything is written inside the output directory (eval/) and nowhere else.

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { MODEL, createAnthropic } = require('../src/lib/anthropic');
const { requestOptionsFor } = require('../src/lib/analysis');
const { loadPhotos } = require('./eval/photos');
const { evaluateRun } = require('./eval/pipeline');
const { summarize, renderReport } = require('./eval/report');

// ESTIMATE ONLY, not a price list: roughly 2,500 input tokens (photo plus prompt) and
// 500 output tokens per call on claude-haiku-4-5 at about $1 / $5 per million tokens.
// Repair calls are far smaller but are counted at the same rate, so the cost shown is an
// upper bound. Check the Anthropic price page before relying on it.
const ESTIMATED_COST_PER_CALL_USD = 0.005;

// ESTIMATE ONLY, for the --also-model variant: a Sonnet-class image call costs several
// times a Haiku call (about 3x the per-token price for the same roughly 2,500 input and
// 500 output tokens, about $0.012 to $0.015), so 0.02 is a deliberately conservative
// round figure. The guard's repair calls always go to the production model (Haiku), so
// they are counted at ESTIMATED_COST_PER_CALL_USD. Check the Anthropic price page.
const COST_PER_CALL_EXTRA_USD = 0.02;

const ROOT = path.join(__dirname, '..');
const MAX_RUNS = 20;
const USAGE = 'node scripts/eval-naming.js [--dir eval/photos] [--runs 3] [--also-model <model-id> [--only-extra] [--prompt <name>] [--effort <low|medium|high|off>]] [--yes]';
const MODEL_ID = /^claude-[A-Za-z0-9._-]+$/;
const EFFORTS = ['low', 'medium', 'high', 'off'];
const PROMPT_NAME = /^[A-Za-z0-9_-]+$/;
const PROMPTS_DIR = path.join(__dirname, 'eval', 'prompts');

function parseArgs(argv) {
  const opts = { dir: 'eval/photos', runs: 3, yes: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--yes') opts.yes = true;
    else if (arg === '--dir') {
      if (i + 1 >= argv.length) throw new Error('--dir needs a directory');
      opts.dir = argv[++i];
    } else if (arg === '--runs') {
      const value = argv[++i];
      if (!/^\d+$/.test(value ?? '') || Number(value) < 1 || Number(value) > MAX_RUNS) throw new Error(`--runs needs a whole number from 1 to ${MAX_RUNS}`);
      opts.runs = Number(value);
    } else if (arg === '--also-model') {
      if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) throw new Error('--also-model needs a model id (for example claude-sonnet-5-5)');
      opts.alsoModel = argv[++i];
    } else if (arg === '--prompt') {
      if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) throw new Error('--prompt needs the name of a file in scripts/eval/prompts/ (without .js)');
      opts.prompt = argv[++i];
    } else if (arg === '--effort') {
      const value = argv[++i];
      if (!EFFORTS.includes(value)) throw new Error(`--effort needs one of ${EFFORTS.join(', ')}`);
      opts.effort = value;
    } else if (arg === '--only-extra') opts.onlyExtra = true;
    else throw new Error(`Unknown argument ${arg}. Usage: ${USAGE}`);
  }
  return opts;
}

const defaultDeps = () => ({
  createClient: (apiKey) => createAnthropic({ anthropicApiKey: apiKey }),
  readFile: (p) => fs.promises.readFile(p),
  writeFile: (p, data) => fs.promises.writeFile(p, data),
  mkdir: (p) => fs.promises.mkdir(p, { recursive: true }),
  listFiles: (dir) => fs.promises.readdir(dir),
  now: () => new Date(),
  log: (line) => console.log(line),
});

// A prompt variant of scripts/eval/prompts/<name>.js as { system, user }. The name must be a
// plain file name that exists in that directory (no path, no extension); the file must export
// the two prompt strings.
async function loadPromptVariant(name, { listFiles }) {
  const available = (await listFiles(PROMPTS_DIR)).filter((f) => f.endsWith('.js')).map((f) => f.slice(0, -3)).sort();
  if (typeof name !== 'string' || !PROMPT_NAME.test(name) || !available.includes(name)) {
    throw new Error(`--prompt ${JSON.stringify(String(name).slice(0, 60))} is not a prompt variant; the files in scripts/eval/prompts/ are: ${available.join(', ') || 'none'} (give the name without .js)`);
  }
  const variant = require(path.join(PROMPTS_DIR, `${name}.js`));
  for (const key of ['IMAGE_SYSTEM_PROMPT', 'IMAGE_USER_MESSAGE']) {
    if (typeof variant?.[key] !== 'string' || !variant[key].trim()) throw new Error(`scripts/eval/prompts/${name}.js must export ${key} as a non-empty string`);
  }
  return { system: variant.IMAGE_SYSTEM_PROMPT, user: variant.IMAGE_USER_MESSAGE };
}

const fail = (error, log) => { log(`ERROR: ${error}`); return { exitCode: 1, error }; };

async function readRatings(file, { readFile }) {
  let text;
  try {
    text = await readFile(file);
  } catch (err) {
    if (err?.code === 'ENOENT') return {};
    throw new Error(`Cannot read ${file}: ${err?.message}`);
  }
  try {
    const ratings = JSON.parse(String(text));
    if (!ratings || typeof ratings !== 'object' || Array.isArray(ratings)) throw new Error('not an object');
    return ratings;
  } catch (err) {
    throw new Error(`eval/ratings.json is not valid (${err.message}); expected { "<file>": { "natural": true|false, "note": "", "extra": true|false } }`);
  }
}

// --only-extra: the stored results must exist and cover exactly the photos and the number
// of runs that this call would evaluate, otherwise merging would mix incomparable data.
async function readStoredResults(file, photos, runs, { readFile }) {
  let text;
  try {
    text = await readFile(file);
  } catch (err) {
    if (err?.code === 'ENOENT') throw new Error(`--only-extra needs the existing ${file} (run the full evaluation first); it does not exist`);
    throw new Error(`Cannot read ${file}: ${err?.message}`);
  }
  let stored;
  try {
    stored = JSON.parse(String(text));
  } catch (err) {
    throw new Error(`${file} is not valid JSON (${err.message}); --only-extra refused`);
  }
  const storedPhotos = Array.isArray(stored?.photos) ? stored.photos : null;
  if (!storedPhotos || storedPhotos.some((p) => !p || typeof p.file !== 'string' || !Array.isArray(p.runs))) throw new Error(`${file} does not look like evaluation results; --only-extra refused`);
  if (stored.runsPerPhoto !== runs || storedPhotos.some((p) => p.runs.length !== runs)) throw new Error(`${file} holds ${stored.runsPerPhoto} runs per photo but --runs is ${runs}; they must be equal, --only-extra refused`);
  const want = photos.map((p) => p.file).sort();
  const have = storedPhotos.map((p) => p.file).sort();
  if (want.length !== have.length || want.some((f, i) => f !== have[i])) throw new Error(`${file} covers other photos than the photos folder (results: ${have.join(', ') || 'none'}; folder: ${want.join(', ') || 'none'}); --only-extra refused`);
  return stored;
}

// The photo as the report refers to it: a path relative to the report, or a file URL.
function thumbFor(photoPath, outDir) {
  const rel = path.relative(outDir, photoPath);
  if (path.isAbsolute(rel)) return pathToFileURL(photoPath).href;
  return rel.split(path.sep).map(encodeURIComponent).join('/');
}

async function run(options = {}, deps = {}) {
  const d = { ...defaultDeps(), ...deps };
  const env = options.env ?? process.env;
  const runs = options.runs ?? 3;
  if (!Number.isInteger(runs) || runs < 1 || runs > MAX_RUNS) return fail(`runs must be a whole number from 1 to ${MAX_RUNS}`, d.log);
  const alsoModel = options.alsoModel;
  if (alsoModel !== undefined && !MODEL_ID.test(String(alsoModel))) return fail(`--also-model needs an Anthropic model id starting with "claude-" (for example claude-sonnet-5-5), got ${JSON.stringify(String(alsoModel).slice(0, 60))}`, d.log);
  const onlyExtra = options.onlyExtra === true;
  if (onlyExtra && alsoModel === undefined) return fail('--only-extra needs --also-model <model-id> (the extra variant to run); nothing was sent', d.log);
  const effort = options.effort;
  if (effort !== undefined && !EFFORTS.includes(effort)) return fail(`--effort needs one of ${EFFORTS.join(', ')}, got ${JSON.stringify(String(effort).slice(0, 20))}; nothing was sent`, d.log);
  if ((options.prompt !== undefined || effort !== undefined) && alsoModel === undefined) return fail('--prompt and --effort apply to the extra variant: they need --also-model <model-id>; nothing was sent', d.log);
  let prompts;
  if (options.prompt !== undefined) {
    try {
      prompts = await loadPromptVariant(options.prompt, d);
    } catch (err) {
      return fail(`${err.message}; nothing was sent`, d.log);
    }
  }
  const dir = path.resolve(ROOT, options.dir ?? 'eval/photos');
  const outDir = path.resolve(ROOT, options.outDir ?? 'eval');

  const loaded = await loadPhotos(dir, d);
  if (loaded.error) return fail(loaded.error, d.log);
  const { photos, skipped } = loaded;
  let ratings;
  try {
    ratings = await readRatings(path.join(outDir, 'ratings.json'), d);
  } catch (err) {
    return fail(err.message, d.log);
  }

  let stored;
  if (onlyExtra) {
    try {
      stored = await readStoredResults(path.join(outDir, 'results.json'), photos, runs, d);
    } catch (err) {
      return fail(err.message, d.log);
    }
  }

  const calls = photos.length * runs * 2;
  const maxCalls = photos.length * runs * 3; // the guard makes at most one repair call per new-pipeline run
  const plan = { photos: photos.length, runs, calls, maxCalls, estimatedCostUsd: Number((maxCalls * ESTIMATED_COST_PER_CALL_USD).toFixed(2)), skipped };
  for (const s of skipped) d.log(`Skipped ${s.file}: ${s.reason}`);
  if (!onlyExtra) {
    d.log(`${photos.length} photos x ${runs} runs x 2 prompts = ${calls} API calls (up to ${maxCalls} with repair calls).`);
    d.log(`Estimated cost: up to about $${plan.estimatedCostUsd.toFixed(2)} (estimate at $${ESTIMATED_COST_PER_CALL_USD} per call; see the constant in scripts/eval-naming.js).`);
  }
  if (alsoModel) {
    // each extra run: one call on the extra model plus up to one repair call (on MODEL)
    const extraCalls = photos.length * runs;
    const extraMax = extraCalls * 2;
    const extraCost = Number((extraCalls * (COST_PER_CALL_EXTRA_USD + ESTIMATED_COST_PER_CALL_USD)).toFixed(2));
    plan.extra = { model: alsoModel, calls: extraCalls, maxCalls: extraMax, estimatedCostUsd: extraCost };
    if (onlyExtra) {
      // only the extra variant is sent, so the plan is just that part
      Object.assign(plan, { onlyExtra: true, calls: extraCalls, maxCalls: extraMax, estimatedCostUsd: extraCost, totalMaxCalls: extraMax, totalEstimatedCostUsd: extraCost });
      d.log(`Only the extra variant, the new pipeline on ${alsoModel}: ${photos.length} photos x ${runs} runs x 1 = ${extraCalls} API calls (up to ${extraMax} with repair calls). The stored old and new results are kept as they are.`);
      d.log(`Estimated cost: up to about $${extraCost.toFixed(2)} (estimate at $${COST_PER_CALL_EXTRA_USD} per call on ${alsoModel}, repair calls at $${ESTIMATED_COST_PER_CALL_USD}; see COST_PER_CALL_EXTRA_USD in scripts/eval-naming.js).`);
    } else {
      plan.totalMaxCalls = maxCalls + extraMax;
      plan.totalEstimatedCostUsd = Number((plan.estimatedCostUsd + extraCost).toFixed(2));
      d.log(`Extra variant, the new pipeline on ${alsoModel}: ${photos.length} photos x ${runs} runs x 1 = ${extraCalls} API calls (up to ${extraMax} with repair calls).`);
      d.log(`Estimated extra cost: up to about $${extraCost.toFixed(2)} (estimate at $${COST_PER_CALL_EXTRA_USD} per call on ${alsoModel}, repair calls at $${ESTIMATED_COST_PER_CALL_USD}; see COST_PER_CALL_EXTRA_USD in scripts/eval-naming.js).`);
      d.log(`Total: up to ${plan.totalMaxCalls} API calls, up to about $${plan.totalEstimatedCostUsd.toFixed(2)} (estimate).`);
    }
  }
  // what the extra variant is recorded with: the prompt variant, and the effort the model
  // really gets (off for a model that takes no effort fields, whatever was asked)
  const extraSettings = alsoModel ? {
    prompt: options.prompt ?? 'production',
    effort: Object.keys(requestOptionsFor(alsoModel, effort)).length ? (effort ?? 'low') : 'off',
  } : undefined;
  if (extraSettings) d.log(`Extra variant prompt: ${extraSettings.prompt}${options.prompt ? '' : ' (the runtime prompt)'}; effort: ${extraSettings.effort}.`);
  d.log(`The photos are sent to the Anthropic API (${onlyExtra ? alsoModel : `${MODEL}${alsoModel ? ` and ${alsoModel}` : ''}`}) and nowhere else. Results go to ${outDir}.`);
  if (!options.yes) {
    d.log('Nothing was sent. Add --yes to run it for real.');
    return { exitCode: 0, plan };
  }

  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) return fail('ANTHROPIC_API_KEY is not set (put it in food-logger/.env or the environment)', d.log);
  const client = d.createClient(apiKey);

  const extraVariant = alsoModel ? { label: alsoModel, model: alsoModel, ...extraSettings } : undefined;
  let results;
  if (onlyExtra) {
    // every stored old and new record is kept as it is; only the extra records are new
    results = { ...stored, variants: { ...stored.variants, extra: extraVariant }, extraGeneratedAt: d.now().toISOString(), photos: [] };
    const byFile = new Map(photos.map((p) => [p.file, p]));
    for (const [i, storedPhoto] of stored.photos.entries()) {
      const photo = byFile.get(storedPhoto.file);
      const entry = { ...storedPhoto, runs: [] };
      for (let n = 1; n <= runs; n++) {
        d.log(`[${i + 1}/${photos.length}] ${photo.file}: run ${n}/${runs} (extra only)`);
        const { extra } = await evaluateRun(client, photo, { extraModel: alsoModel, onlyExtra: true, prompts, effort });
        results.apiCalls = (Number(results.apiCalls) || 0) + 1 + (extra.repairCalls || 0);
        // the extra record being replaced survives as previousExtra (name and calories only);
        // when it was an error record none is made, so a previousExtra inherited from an even
        // earlier run (through the spread below) may stay
        const before = storedPhoto.runs[n - 1]?.extra;
        const previousExtra = before && !before.error ? { name: before.name, calories: before.calories } : undefined;
        entry.runs.push({ ...storedPhoto.runs[n - 1], extra, ...(previousExtra ? { previousExtra } : {}) });
      }
      results.photos.push(entry);
    }
  } else {
    const variants = {
      old: { label: 'old pipeline (V1 prompt, silent stripping)', model: MODEL },
      new: { label: 'new pipeline (new prompt + guard)', model: MODEL },
    };
    if (alsoModel) variants.extra = extraVariant;
    results = { generatedAt: d.now().toISOString(), model: MODEL, variants, runsPerPhoto: runs, apiCalls: 0, skipped, photos: [] };
    for (const [i, photo] of photos.entries()) {
      const entry = { file: photo.file, thumb: thumbFor(photo.path, outDir), runs: [] };
      for (let n = 1; n <= runs; n++) {
        d.log(`[${i + 1}/${photos.length}] ${photo.file}: run ${n}/${runs}`);
        const result = await evaluateRun(client, photo, { extraModel: alsoModel, prompts, effort });
        results.apiCalls += 2 + (result.new.repairCalls || 0) + (result.extra ? 1 + (result.extra.repairCalls || 0) : 0);
        entry.runs.push(result);
      }
      results.photos.push(entry);
    }
  }

  await d.mkdir(outDir);
  const resultsPath = path.join(outDir, 'results.json');
  const reportPath = path.join(outDir, 'report.html');
  await d.writeFile(resultsPath, JSON.stringify(results, null, 2));
  await d.writeFile(reportPath, renderReport(results, ratings));
  const summary = summarize(results, ratings);
  d.log(`Done: ${results.apiCalls} API calls${onlyExtra ? ' in total (the earlier ones included)' : ''}. New names: ${summary.new.repaired} repaired, ${summary.new.cleaned} cleaned, ${summary.new.fallback} fallback, ${summary.new.errors} failed runs.`);
  if (summary.extra) d.log(`Extra (${alsoModel}): ${summary.extra.repaired} repaired, ${summary.extra.cleaned} cleaned, ${summary.extra.fallback} fallback, ${summary.extra.errors} failed runs.`);
  if (summary.extraStats) d.log(`Latency on ${alsoModel}: average ${(summary.extraStats.avgMs / 1000).toFixed(1)} s, maximum ${(summary.extraStats.maxMs / 1000).toFixed(1)} s; average tokens in ${summary.extraStats.avgInputTokens ?? '?'}, out ${summary.extraStats.avgOutputTokens ?? '?'}.`);
  if (summary.naturalExtra) d.log(`Natural names on ${alsoModel}: ${summary.naturalExtra.percent}% (${summary.naturalExtra.natural} of ${summary.naturalExtra.rated} rated photos).`);
  if (summary.natural) d.log(`Natural names: ${summary.natural.percent}% (${summary.natural.natural} of ${summary.natural.rated} rated photos).`);
  d.log(`Wrote ${resultsPath} and ${reportPath}`);
  return { exitCode: 0, plan, results, summary, resultsPath, reportPath };
}

async function main() {
  require('dotenv').config({ path: path.join(ROOT, '.env') });
  let result;
  try {
    result = await run(parseArgs(process.argv.slice(2)));
  } catch (err) {
    console.log(`ERROR: ${err.message}`);
    result = { exitCode: 1 };
  }
  process.exitCode = result.exitCode;
}

module.exports = { run, parseArgs, ESTIMATED_COST_PER_CALL_USD, COST_PER_CALL_EXTRA_USD };

if (require.main === module) main();
