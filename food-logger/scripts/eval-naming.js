'use strict';

// Naming evaluation: the same photos through the OLD pipeline (old prompt + silent name
// stripping) and the NEW one (new prompt + the Hebrew-name guard), several runs each,
// written to eval/results.json and eval/report.html. A developer tool: not part of the
// app, not run by the tests against the real API, never run in CI.
//
//   node scripts/eval-naming.js [--dir eval/photos] [--runs 3] [--yes]
//
// Without --yes it only prints the plan and the estimated cost and calls nothing.
// The photos (eval/ is git-ignored) are sent only to the Anthropic API. Optional
// eval/ratings.json: { "<file name>": { "natural": true|false, "note": "" } }.
// Everything is written inside the output directory (eval/) and nowhere else.

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { MODEL, createAnthropic } = require('../src/lib/anthropic');
const { loadPhotos } = require('./eval/photos');
const { evaluateRun } = require('./eval/pipeline');
const { summarize, renderReport } = require('./eval/report');

// ESTIMATE ONLY, not a price list: roughly 2,500 input tokens (photo plus prompt) and
// 500 output tokens per call on claude-haiku-4-5 at about $1 / $5 per million tokens.
// Repair calls are far smaller but are counted at the same rate, so the cost shown is an
// upper bound. Check the Anthropic price page before relying on it.
const ESTIMATED_COST_PER_CALL_USD = 0.005;

const ROOT = path.join(__dirname, '..');
const MAX_RUNS = 20;

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
    } else throw new Error(`Unknown argument ${arg}. Usage: node scripts/eval-naming.js [--dir eval/photos] [--runs 3] [--yes]`);
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
    throw new Error(`eval/ratings.json is not valid (${err.message}); expected { "<file>": { "natural": true|false, "note": "" } }`);
  }
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

  const calls = photos.length * runs * 2;
  const maxCalls = photos.length * runs * 3; // the guard makes at most one repair call per new-pipeline run
  const plan = { photos: photos.length, runs, calls, maxCalls, estimatedCostUsd: Number((maxCalls * ESTIMATED_COST_PER_CALL_USD).toFixed(2)), skipped };
  for (const s of skipped) d.log(`Skipped ${s.file}: ${s.reason}`);
  d.log(`${photos.length} photos x ${runs} runs x 2 prompts = ${calls} API calls (up to ${maxCalls} with repair calls).`);
  d.log(`Estimated cost: up to about $${plan.estimatedCostUsd.toFixed(2)} (estimate at $${ESTIMATED_COST_PER_CALL_USD} per call; see the constant in scripts/eval-naming.js).`);
  d.log(`The photos are sent to the Anthropic API (${MODEL}) and nowhere else. Results go to ${outDir}.`);
  if (!options.yes) {
    d.log('Nothing was sent. Add --yes to run it for real.');
    return { exitCode: 0, plan };
  }

  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) return fail('ANTHROPIC_API_KEY is not set (put it in food-logger/.env or the environment)', d.log);
  const client = d.createClient(apiKey);

  const results = { generatedAt: d.now().toISOString(), model: MODEL, runsPerPhoto: runs, apiCalls: 0, skipped, photos: [] };
  for (const [i, photo] of photos.entries()) {
    const entry = { file: photo.file, thumb: thumbFor(photo.path, outDir), runs: [] };
    for (let n = 1; n <= runs; n++) {
      d.log(`[${i + 1}/${photos.length}] ${photo.file}: run ${n}/${runs}`);
      const result = await evaluateRun(client, photo);
      results.apiCalls += 2 + (result.new.repairCalls || 0);
      entry.runs.push(result);
    }
    results.photos.push(entry);
  }

  await d.mkdir(outDir);
  const resultsPath = path.join(outDir, 'results.json');
  const reportPath = path.join(outDir, 'report.html');
  await d.writeFile(resultsPath, JSON.stringify(results, null, 2));
  await d.writeFile(reportPath, renderReport(results, ratings));
  const summary = summarize(results, ratings);
  d.log(`Done: ${results.apiCalls} API calls. New names: ${summary.new.repaired} repaired, ${summary.new.cleaned} cleaned, ${summary.new.fallback} fallback, ${summary.new.errors} failed runs.`);
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

module.exports = { run, parseArgs, ESTIMATED_COST_PER_CALL_USD };

if (require.main === module) main();
