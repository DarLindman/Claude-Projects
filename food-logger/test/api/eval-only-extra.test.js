'use strict';

// The temperature switch of analyzeImage and the --only-extra mode of the naming
// evaluation: fakes only, never the real API and never .env.
const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fakeAnthropic } = require('../helpers/fakeAnthropic');
const { run, parseArgs } = require('../../scripts/eval-naming');
const { analyzeImage } = require('../../src/lib/analysis');
const { MODEL } = require('../../src/lib/anthropic');
const { REPAIR_PROMPT_PREFIX } = require('../../src/lib/hebrewName');

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
const KEY = { ANTHROPIC_API_KEY: 'sk-test-not-real' };
const EXTRA = 'claude-sonnet-5-5';
const ARGS = { imageBase64: JPEG.toString('base64'), mimeType: 'image/jpeg' };
const isRepairCall = (c) => typeof c.system === 'string' && c.system.startsWith(REPAIR_PROMPT_PREFIX);

function workspace(names = ['a.jpg', 'b.jpg']) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-only-extra-'));
  const photos = path.join(root, 'photos');
  fs.mkdirSync(photos);
  for (const n of names) fs.writeFileSync(path.join(photos, n), JPEG);
  return { root, photos, out: path.join(root, 'out') };
}

async function runWith(ws, options = {}, fake = fakeAnthropic()) {
  const lines = [];
  let created = 0;
  const result = await run(
    { dir: ws.photos, outDir: ws.out, env: KEY, runs: 2, ...options },
    { createClient: () => { created++; return fake; }, log: (l) => lines.push(l) },
  );
  return { result, fake, lines, created: () => created };
}

// A full evaluation (old, new and extra) written to ws.out, the starting point of --only-extra.
async function fullRun(ws, options = {}) {
  const { result } = await runWith(ws, { yes: true, alsoModel: 'claude-first-extra', ...options });
  assert.equal(result.exitCode, 0);
  return fs.readFileSync(path.join(ws.out, 'results.json'), 'utf8');
}

// ─── analyzeImage temperature ─────────────────────────────────────────────────
test('analyzeImage sends temperature 0 by default, with the production field order unchanged', async () => {
  const fake = fakeAnthropic();
  await analyzeImage(fake, ARGS);
  const call = fake.calls.find((c) => !isRepairCall(c));
  assert.equal(call.temperature, 0);
  assert.deepEqual(Object.keys(call), ['model', 'max_tokens', 'temperature', 'system', 'messages']);
  assert.equal(call.model, MODEL);
});

test('analyzeImage with temperature null leaves the temperature field out of the request', async () => {
  const fake = fakeAnthropic();
  await analyzeImage(fake, { ...ARGS, model: EXTRA, temperature: null });
  const call = fake.calls.find((c) => !isRepairCall(c));
  assert.equal('temperature' in call, false);
  assert.deepEqual(Object.keys(call), ['model', 'max_tokens', 'system', 'messages']);
  assert.equal(call.model, EXTRA);
});

test('analyzeImage sends the given temperature number', async () => {
  for (const t of [0, 0.3, 1]) {
    const fake = fakeAnthropic();
    await analyzeImage(fake, { ...ARGS, temperature: t });
    assert.equal(fake.calls.find((c) => !isRepairCall(c)).temperature, t);
  }
});

test('analyzeImage rejects a temperature that is not null or a finite number from 0 to 1, before any call', async () => {
  for (const temperature of [-0.1, 1.5, NaN, Infinity, '0', {}, true]) {
    const fake = fakeAnthropic();
    await assert.rejects(analyzeImage(fake, { ...ARGS, temperature }), /temperature/);
    assert.equal(fake.calls.length, 0);
  }
});

test('the guard repair call still sends Haiku at temperature 0', async () => {
  const fake = fakeAnthropic();
  fake.imageReply = JSON.stringify({ dish_name: 'עוף 鸡', items: [{ name: 'עוף', calories: 100 }] });
  const warn = mock.method(console, 'warn', () => {});
  try {
    await analyzeImage(fake, { ...ARGS, model: EXTRA, temperature: null });
  } finally {
    warn.mock.restore();
  }
  const repair = fake.calls.filter(isRepairCall);
  assert.equal(repair.length, 1);
  assert.equal(repair[0].model, MODEL);
  assert.equal(repair[0].temperature, 0);
});

// ─── the pipeline: extra without temperature, old and new unchanged ───────────
test('the extra variant request has no temperature; old and new requests keep their temperatures', async () => {
  const ws = workspace(['a.jpg']);
  const { result, fake } = await runWith(ws, { yes: true, runs: 1, alsoModel: EXTRA });
  assert.equal(result.exitCode, 0);
  const imageCalls = fake.calls.filter((c) => !isRepairCall(c));
  assert.equal(imageCalls.length, 3);
  const onExtra = imageCalls.filter((c) => c.model === EXTRA);
  const onHaiku = imageCalls.filter((c) => c.model === MODEL);
  assert.equal(onExtra.length, 1);
  assert.equal(onHaiku.length, 2);
  assert.equal('temperature' in onExtra[0], false);
  // the frozen old variant keeps its own 0.1, the new one the production 0
  assert.deepEqual(onHaiku.map((c) => c.temperature).sort(), [0, 0.1]);
});

// ─── parseArgs ────────────────────────────────────────────────────────────────
test('parseArgs reads --only-extra', () => {
  assert.deepEqual(parseArgs(['--also-model', EXTRA, '--only-extra']), { dir: 'eval/photos', runs: 3, yes: false, alsoModel: EXTRA, onlyExtra: true });
  assert.equal(parseArgs([]).onlyExtra, undefined);
});

// ─── --only-extra refusals ────────────────────────────────────────────────────
test('--only-extra without --also-model is refused with exit code 1, no client and no files', async () => {
  const ws = workspace();
  const { result, created, lines } = await runWith(ws, { onlyExtra: true, yes: true });
  assert.equal(result.exitCode, 1);
  assert.match(result.error, /--only-extra needs --also-model/);
  assert.equal(created(), 0);
  assert.ok(lines.join('\n').includes('--also-model'));
  assert.ok(!fs.existsSync(ws.out));
});

test('--only-extra without an existing results.json is refused, even in the dry run', async () => {
  for (const yes of [false, true]) {
    const ws = workspace();
    const { result, created } = await runWith(ws, { onlyExtra: true, alsoModel: EXTRA, yes });
    assert.equal(result.exitCode, 1);
    assert.match(result.error, /results\.json/);
    assert.equal(created(), 0);
    assert.ok(!fs.existsSync(ws.out));
  }
});

test('--only-extra refuses a results.json that is not JSON or not evaluation results', async () => {
  for (const content of ['not json', '{}', '{"photos":[{"file":1}]}']) {
    const ws = workspace();
    fs.mkdirSync(ws.out);
    fs.writeFileSync(path.join(ws.out, 'results.json'), content);
    const { result, created } = await runWith(ws, { onlyExtra: true, alsoModel: EXTRA, yes: true });
    assert.equal(result.exitCode, 1, content);
    assert.match(result.error, /results\.json/);
    assert.equal(created(), 0);
    assert.equal(fs.readFileSync(path.join(ws.out, 'results.json'), 'utf8'), content, 'untouched');
  }
});

test('--only-extra refuses results that cover other photos or another number of runs', async () => {
  const ws = workspace();
  const before = await fullRun(ws);
  // another photo in the folder
  fs.writeFileSync(path.join(ws.photos, 'c.jpg'), JPEG);
  let r = await runWith(ws, { onlyExtra: true, alsoModel: EXTRA, yes: true });
  assert.equal(r.result.exitCode, 1);
  assert.match(r.result.error, /other photos/);
  assert.equal(r.created(), 0);
  fs.rmSync(path.join(ws.photos, 'c.jpg'));
  // a renamed photo
  fs.renameSync(path.join(ws.photos, 'b.jpg'), path.join(ws.photos, 'z.jpg'));
  r = await runWith(ws, { onlyExtra: true, alsoModel: EXTRA, yes: true });
  assert.equal(r.result.exitCode, 1);
  assert.match(r.result.error, /other photos/);
  fs.renameSync(path.join(ws.photos, 'z.jpg'), path.join(ws.photos, 'b.jpg'));
  // another number of runs
  r = await runWith(ws, { onlyExtra: true, alsoModel: EXTRA, yes: true, runs: 3 });
  assert.equal(r.result.exitCode, 1);
  assert.match(r.result.error, /runs/);
  assert.equal(r.created(), 0);
  assert.equal(fs.readFileSync(path.join(ws.out, 'results.json'), 'utf8'), before, 'results.json untouched');
});

// ─── --only-extra dry run ─────────────────────────────────────────────────────
test('the --only-extra dry run makes zero client calls and shows only the extra count and cost', async () => {
  const ws = workspace();
  const before = await fullRun(ws);
  const { result, created, lines } = await runWith(ws, { onlyExtra: true, alsoModel: EXTRA });
  assert.equal(created(), 0);
  assert.equal(result.exitCode, 0);
  assert.equal(result.plan.calls, 4, '2 photos x 2 runs x 1');
  assert.equal(result.plan.maxCalls, 8);
  assert.equal(result.plan.onlyExtra, true);
  assert.equal(result.plan.totalMaxCalls, 8);
  assert.equal(result.plan.estimatedCostUsd, result.plan.extra.estimatedCostUsd);
  const text = lines.join('\n');
  assert.ok(text.includes('x 1 = 4 API calls'));
  assert.ok(!text.includes('x 2 prompts'), 'no old/new call count');
  assert.ok(!text.includes('Total:'));
  assert.ok(text.includes('Nothing was sent'));
  assert.equal(fs.readFileSync(path.join(ws.out, 'results.json'), 'utf8'), before, 'nothing written');
});

test('--only-extra with --yes still needs the API key', async () => {
  const ws = workspace();
  await fullRun(ws);
  const { result, created } = await runWith(ws, { onlyExtra: true, alsoModel: EXTRA, yes: true, env: {} });
  assert.equal(result.exitCode, 1);
  assert.match(result.error, /ANTHROPIC_API_KEY/);
  assert.equal(created(), 0);
});

// ─── --only-extra with --yes and the fake ─────────────────────────────────────
test('--only-extra with --yes merges the extra results and leaves old and new byte-identical', async () => {
  const ws = workspace();
  const before = JSON.parse(await fullRun(ws));
  assert.equal(before.variants.extra.model, 'claude-first-extra');
  fs.writeFileSync(path.join(ws.out, 'ratings.json'), JSON.stringify({ 'a.jpg': { natural: true, extra: true, note: 'הערה' } }));

  const { result, fake } = await runWith(ws, { onlyExtra: true, alsoModel: EXTRA, yes: true });
  assert.equal(result.exitCode, 0);

  // only the extra model was called (plus repair calls on MODEL), without temperature
  const imageCalls = fake.calls.filter((c) => !isRepairCall(c));
  assert.equal(imageCalls.length, 4, '2 photos x 2 runs x 1');
  for (const c of imageCalls) {
    assert.equal(c.model, EXTRA);
    assert.equal('temperature' in c, false);
  }
  assert.equal(result.results.apiCalls, before.apiCalls + 4);

  const after = JSON.parse(fs.readFileSync(path.join(ws.out, 'results.json'), 'utf8'));
  assert.deepEqual(after.variants.old, before.variants.old);
  assert.deepEqual(after.variants.new, before.variants.new);
  assert.deepEqual(after.variants.extra, { label: EXTRA, model: EXTRA }, 'the extra metadata is replaced');
  assert.equal(after.generatedAt, before.generatedAt);
  assert.equal(after.photos.length, before.photos.length);
  before.photos.forEach((photo, i) => {
    assert.equal(after.photos[i].file, photo.file);
    assert.equal(after.photos[i].thumb, photo.thumb);
    photo.runs.forEach((r, n) => {
      const a = after.photos[i].runs[n];
      assert.equal(JSON.stringify(a.old), JSON.stringify(r.old), 'old byte-identical');
      assert.equal(JSON.stringify(a.new), JSON.stringify(r.new), 'new byte-identical');
      assert.equal(a.extra.name, 'עוף עם אורז');
      assert.equal(a.extra.action, 'ok');
    });
  });

  const html = fs.readFileSync(path.join(ws.out, 'report.html'), 'utf8');
  assert.equal((html.match(/<th>עכשיו על /g) || []).length, 3, 'summary table and two photo tables keep the extra column');
  assert.ok(html.includes(EXTRA) && !html.includes('claude-first-extra'));
  assert.ok(html.includes('100%') && html.includes('הערה'), 'the ratings are merged');
  assert.deepEqual(fs.readdirSync(ws.out).sort(), ['ratings.json', 'report.html', 'results.json'], 'nothing else is written');
});

test('--only-extra adds the extra variant to results that had none', async () => {
  const ws = workspace(['a.jpg']);
  const { result: first } = await runWith(ws, { yes: true, runs: 1 });
  assert.equal(first.exitCode, 0);
  const before = JSON.parse(fs.readFileSync(path.join(ws.out, 'results.json'), 'utf8'));
  assert.equal(before.variants.extra, undefined);
  const { result } = await runWith(ws, { onlyExtra: true, alsoModel: EXTRA, yes: true, runs: 1 });
  assert.equal(result.exitCode, 0);
  const after = JSON.parse(fs.readFileSync(path.join(ws.out, 'results.json'), 'utf8'));
  assert.deepEqual(Object.keys(after.variants), ['old', 'new', 'extra']);
  assert.equal(JSON.stringify(after.photos[0].runs[0].old), JSON.stringify(before.photos[0].runs[0].old));
  assert.equal(JSON.stringify(after.photos[0].runs[0].new), JSON.stringify(before.photos[0].runs[0].new));
  assert.equal(after.photos[0].runs[0].extra.name, 'עוף עם אורז');
});

test('--only-extra records a failing extra call and keeps going', async () => {
  const ws = workspace(['a.jpg']);
  await fullRun(ws, { runs: 1 });
  const fake = fakeAnthropic();
  fake.messages.create = async () => { throw new Error('400 temperature is deprecated for this model'); };
  const { result } = await runWith(ws, { onlyExtra: true, alsoModel: EXTRA, yes: true, runs: 1 }, fake);
  assert.equal(result.exitCode, 0);
  assert.match(result.results.photos[0].runs[0].extra.error, /temperature is deprecated/);
  assert.equal(result.results.photos[0].runs[0].new.name, 'עוף עם אורז', 'the stored new result survives');
});

test('--only-extra output stays quiet: only the injected log is used', async () => {
  const ws = workspace(['a.jpg']);
  await fullRun(ws, { runs: 1 });
  const out = mock.method(console, 'log', () => {});
  const err = mock.method(console, 'error', () => {});
  const warn = mock.method(console, 'warn', () => {});
  try {
    await runWith(ws, { onlyExtra: true, alsoModel: EXTRA, yes: true, runs: 1 });
    await runWith(ws, { onlyExtra: true, alsoModel: EXTRA, runs: 1 });
    assert.equal(out.mock.callCount(), 0);
    assert.equal(err.mock.callCount(), 0);
    assert.equal(warn.mock.callCount(), 0);
  } finally {
    out.mock.restore();
    err.mock.restore();
    warn.mock.restore();
  }
});

// ─── the replaced extra record survives as previousExtra ──────────────────────
test('--only-extra keeps the replaced extra as previousExtra (name and calories only) next to the new extra', async () => {
  const ws = workspace(['a.jpg']);
  const before = JSON.parse(await fullRun(ws, { runs: 1 }));
  const first = before.photos[0].runs[0].extra;
  assert.equal(first.calories, 450);
  assert.equal('previousExtra' in before.photos[0].runs[0], false);

  const fake = fakeAnthropic();
  fake.imageReply = JSON.stringify({ scale_reference: 'a fork', dish_name: 'עוף', items: [{ name: 'עוף', volume_ml: 300, weight_g: 280, calories: 500, protein_g: 40, carbs_g: 0, fat_g: 31, fiber_g: 0 }] });
  const { result } = await runWith(ws, { onlyExtra: true, alsoModel: EXTRA, yes: true, runs: 1 }, fake);
  assert.equal(result.exitCode, 0);
  const after = JSON.parse(fs.readFileSync(path.join(ws.out, 'results.json'), 'utf8'));
  const r = after.photos[0].runs[0];
  assert.deepEqual(r.previousExtra, { name: first.name, calories: 450 });
  assert.deepEqual(Object.keys(r.previousExtra), ['name', 'calories']);
  assert.equal(r.extra.name, 'עוף');
  assert.equal(r.extra.calories, 500);
  assert.equal(r.extra.items[0].weight_g, 280);
  assert.equal(r.extra.scale, 'a fork');
  assert.equal(JSON.stringify(r.old), JSON.stringify(before.photos[0].runs[0].old), 'old untouched');
  assert.equal(JSON.stringify(r.new), JSON.stringify(before.photos[0].runs[0].new), 'new untouched');
  const html = fs.readFileSync(path.join(ws.out, 'report.html'), 'utf8');
  assert.ok(html.includes('450') && html.includes('500') && html.includes('280'), 'the report shows the earlier and the new numbers');
});

test('--only-extra: a stored extra that failed, or none at all, leaves no previousExtra', async () => {
  const ws = workspace(['a.jpg']);
  await fullRun(ws, { runs: 1 });
  const file = path.join(ws.out, 'results.json');
  const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
  stored.photos[0].runs[0].extra = { error: 'boom' };
  fs.writeFileSync(file, JSON.stringify(stored));
  await runWith(ws, { onlyExtra: true, alsoModel: EXTRA, yes: true, runs: 1 });
  assert.equal('previousExtra' in JSON.parse(fs.readFileSync(file, 'utf8')).photos[0].runs[0], false);

  const ws2 = workspace(['a.jpg']);
  await runWith(ws2, { yes: true, runs: 1 });
  await runWith(ws2, { onlyExtra: true, alsoModel: EXTRA, yes: true, runs: 1 });
  assert.equal('previousExtra' in JSON.parse(fs.readFileSync(path.join(ws2.out, 'results.json'), 'utf8')).photos[0].runs[0], false);
});
