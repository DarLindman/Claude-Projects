'use strict';

// The naming evaluation tool (scripts/eval-naming.js, scripts/eval/*): never part of
// the app and never calls the real API here; the client is always the fake.
const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fakeAnthropic } = require('../helpers/fakeAnthropic');
const { flagsFor, summarize, renderReport } = require('../../scripts/eval/report');
const { run, parseArgs, ESTIMATED_COST_PER_CALL_USD } = require('../../scripts/eval-naming');
const { analyzeImageV1, cleanHebrewV1 } = require('../../scripts/eval/imagePromptV1');
const { analyzeImage } = require('../../src/lib/analysis');
const { REPAIR_PROMPT_PREFIX, DISH_MAX_WORDS } = require('../../src/lib/hebrewName');

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const isRepairCall = (c) => typeof c.system === 'string' && c.system.startsWith(REPAIR_PROMPT_PREFIX);
const KEY = { ANTHROPIC_API_KEY: 'sk-test-not-real' };

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'eval-naming-'));
}

// A temp workspace: <root>/photos with the given files, <root>/out for the outputs.
function workspace(files = { 'a.jpg': JPEG, 'b.png': PNG }) {
  const root = tmpDir();
  const photos = path.join(root, 'photos');
  fs.mkdirSync(photos);
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(photos, name), content);
  return { root, photos, out: path.join(root, 'out') };
}

// A quiet runner: a fake client, a recorded log, the fake key in the injected env.
function runWith(ws, options = {}, fake = fakeAnthropic()) {
  const lines = [];
  const promise = run(
    { dir: ws.photos, outDir: ws.out, env: KEY, runs: 2, ...options },
    { createClient: () => fake, log: (l) => lines.push(l) },
  );
  return promise.then((result) => ({ result, fake, lines }));
}

// ─── flagsFor ─────────────────────────────────────────────────────────────────
const FLAG_CASES = [
  ['clean Hebrew, ok', 'עוף עם אורז', 'ok', []],
  ['no action given', 'עוף עם אורז', undefined, []],
  ['foreign Latin', 'עוף chicken', undefined, ['foreign']],
  ['foreign CJK', 'עוף 鸡', 'ok', ['foreign']],
  ['repaired', 'עוף מטוגן', 'repaired', ['repaired']],
  ['cleaned', 'עוף', 'cleaned', ['cleaned']],
  ['fallback default', 'מנה', 'fallback', ['fallback']],
  ['six words is not long', 'אחת שתיים שלוש ארבע חמש שש', 'ok', []],
  ['eight words (the guard limit) is not long', 'אחת שתיים שלוש ארבע חמש שש שבע שמונה', 'ok', []],
  ['nine words is long', 'אחת שתיים שלוש ארבע חמש שש שבע שמונה תשע', 'ok', ['long']],
  ['empty string', '', undefined, ['empty']],
  ['whitespace only', '   ', undefined, ['empty']],
  ['not a string', null, undefined, ['empty']],
  ['foreign and long', 'אחת שתיים שלוש ארבע חמש שש שבע שמונה 鸡', undefined, ['foreign', 'long']],
];
for (const [label, name, action, expected] of FLAG_CASES) {
  test(`flagsFor: ${label}`, () => {
    assert.deepEqual(flagsFor(name, action), expected);
  });
}

test('the long flag uses the guard dish limit and the legend names it', () => {
  const words = (n) => Array.from({ length: n }, () => 'מילה').join(' ');
  assert.deepEqual(flagsFor(words(DISH_MAX_WORDS), 'ok'), []);
  assert.deepEqual(flagsFor(words(DISH_MAX_WORDS + 1), 'ok'), ['long']);
  const html = renderReport({ runsPerPhoto: 1, photos: [{ file: 'a.jpg', runs: [{ old: { name: 'עוף', raw: 'עוף' }, new: { name: 'עוף', raw: 'עוף', action: 'ok' } }] }] }, {});
  assert.ok(html.includes(`יותר מ-${DISH_MAX_WORDS} מילים`));
});

// ─── summarize ────────────────────────────────────────────────────────────────
const runRecord = (oldName, newName, action, extra = {}) => ({
  old: { name: oldName, raw: extra.oldRaw ?? oldName },
  new: { name: newName, raw: extra.newRaw ?? newName, action, repairCalls: action === 'repaired' ? 1 : 0 },
});
const SAMPLE = {
  runsPerPhoto: 2,
  photos: [
    { file: 'a.jpg', runs: [runRecord('עוף', 'עוף', 'ok'), runRecord('עוף', 'עוף מטוגן', 'repaired', { newRaw: 'עוף 鸡', oldRaw: 'עוף 鸡' })] },
    { file: 'b.png', runs: [runRecord('מנה', 'מנה', 'fallback'), { old: { error: 'boom' }, new: { error: 'boom' } }] },
  ],
};

test('summarize counts flags per side across all runs', () => {
  const s = summarize(SAMPLE);
  assert.equal(s.photos, 2);
  assert.equal(s.runsPerPhoto, 2);
  assert.equal(s.totalRuns, 4);
  assert.equal(s.natural, null);
  assert.equal(s.new.repaired, 1);
  assert.equal(s.new.fallback, 1);
  assert.equal(s.new.cleaned, 0);
  assert.equal(s.new.foreign, 0);
  assert.equal(s.new.errors, 1);
  assert.equal(s.old.stripped, 1, 'the old pipeline silently stripped one name');
  assert.equal(s.old.errors, 1);
});

test('summarize computes the natural percentage from ratings of known photos only', () => {
  const ratings = {
    'a.jpg': { natural: true, note: '' },
    'b.png': { natural: false, note: 'too literal' },
    'gone.jpg': { natural: true },
  };
  assert.deepEqual(summarize(SAMPLE, ratings).natural, { rated: 2, natural: 1, percent: 50 });
  assert.deepEqual(summarize(SAMPLE, { 'a.jpg': { natural: true }, 'b.png': { natural: true } }).natural, { rated: 2, natural: 2, percent: 100 });
  const third = { ...SAMPLE, photos: [...SAMPLE.photos, { file: 'c.jpg', runs: [] }] };
  const two = { 'a.jpg': { natural: true }, 'b.png': { natural: true }, 'c.jpg': { natural: false } };
  assert.equal(summarize(third, two).natural.percent, 66.7);
});

test('summarize ignores ratings without a boolean verdict', () => {
  assert.equal(summarize(SAMPLE, { 'a.jpg': { note: 'no verdict' }, 'b.png': { natural: 'yes' } }).natural, null);
  assert.equal(summarize(SAMPLE, {}).natural, null);
});

// ─── renderReport ─────────────────────────────────────────────────────────────
test('renderReport shows old and new names, flags, summary and a legend', () => {
  const html = renderReport(SAMPLE, { 'a.jpg': { natural: true, note: 'טוב' } });
  assert.match(html, /^<!doctype html>/i);
  assert.match(html, /<html[^>]*dir="rtl"/);
  assert.match(html, /lang="he"/);
  for (const text of ['a.jpg', 'b.png', 'עוף מטוגן', 'repaired', 'fallback', 'טוב', '100%']) {
    assert.ok(html.includes(text), `report should contain ${text}`);
  }
  assert.match(html, /<table/);
  assert.ok(html.includes('boom'), 'a failed run shows its error');
});

test('renderReport HTML-escapes names, file names, notes and thumbnail sources', () => {
  const evil = '<img src=x onerror=alert(1)>';
  const hostile = {
    runsPerPhoto: 1,
    photos: [{
      file: `"><script>alert(2)</script>${evil}.jpg`,
      thumb: '" onerror="alert(3)',
      runs: [{
        old: { name: evil, raw: `${evil}&<b>` },
        new: { name: `${evil}`, raw: '<svg onload=alert(4)>', action: 'cleaned', repairCalls: 0 },
      }],
    }],
  };
  const html = renderReport(hostile, { [hostile.photos[0].file]: { natural: false, note: '<u onclick=alert(5)>' } });
  assert.ok(!html.includes('<img src=x'), 'no raw injected element');
  assert.ok(!html.includes('<script>alert(2)'), 'no raw script');
  assert.ok(!html.includes('<svg onload'), 'no raw svg');
  assert.ok(!html.includes('<u onclick'), 'no raw note markup');
  assert.ok(!html.includes('" onerror='), 'no attribute escaped out of the thumbnail');
  assert.ok(html.includes('src="&quot; onerror=&quot;alert(3)"'), 'the thumbnail source stays inside its attribute');
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
});

// ─── parseArgs ────────────────────────────────────────────────────────────────
test('parseArgs reads --dir, --runs and --yes and rejects anything else', () => {
  assert.deepEqual(parseArgs([]), { dir: 'eval/photos', runs: 3, yes: false });
  assert.deepEqual(parseArgs(['--dir', 'x', '--runs', '5', '--yes']), { dir: 'x', runs: 5, yes: true });
  assert.throws(() => parseArgs(['--bogus']), /--bogus/);
  assert.throws(() => parseArgs(['--runs', 'abc']), /--runs/);
  assert.throws(() => parseArgs(['--runs', '0']), /--runs/);
  assert.throws(() => parseArgs(['--dir']), /--dir/);
});

// ─── run ──────────────────────────────────────────────────────────────────────
test('without --yes run makes zero client calls, writes nothing and reports the plan', async () => {
  const ws = workspace();
  const { result, fake, lines } = await runWith(ws);
  assert.equal(fake.calls.length, 0);
  assert.equal(result.exitCode, 0);
  assert.equal(result.plan.photos, 2);
  assert.equal(result.plan.runs, 2);
  assert.equal(result.plan.calls, 8, '2 photos x 2 runs x 2 prompts');
  assert.equal(result.plan.maxCalls, 12, 'plus up to one repair call per new-pipeline run');
  assert.equal(result.plan.estimatedCostUsd, Number((12 * ESTIMATED_COST_PER_CALL_USD).toFixed(2)));
  assert.ok(ESTIMATED_COST_PER_CALL_USD > 0);
  assert.ok(lines.join('\n').includes('--yes'), 'tells how to proceed');
  assert.ok(lines.join('\n').includes('estimate'), 'the cost is labelled an estimate');
  assert.ok(!fs.existsSync(ws.out), 'nothing is written without --yes');
});

test('the client is not even created without --yes', async () => {
  const ws = workspace();
  let created = 0;
  const result = await run({ dir: ws.photos, outDir: ws.out, env: KEY, runs: 1 }, { createClient: () => { created++; return fakeAnthropic(); }, log() {} });
  assert.equal(created, 0);
  assert.equal(result.exitCode, 0);
});

test('without an API key run fails with exit code 1 and calls nothing', async () => {
  const ws = workspace();
  let created = 0;
  const lines = [];
  const result = await run(
    { dir: ws.photos, outDir: ws.out, env: {}, runs: 1, yes: true },
    { createClient: () => { created++; return fakeAnthropic(); }, log: (l) => lines.push(l) },
  );
  assert.equal(result.exitCode, 1);
  assert.equal(created, 0);
  assert.match(result.error, /ANTHROPIC_API_KEY/);
  assert.ok(!fs.existsSync(ws.out));
});

test('the API key is never printed', async () => {
  const ws = workspace();
  const { result, lines } = await runWith(ws, { yes: true });
  assert.equal(result.exitCode, 0);
  assert.ok(!lines.join('\n').includes(KEY.ANTHROPIC_API_KEY));
  assert.ok(!fs.readFileSync(path.join(ws.out, 'results.json'), 'utf8').includes(KEY.ANTHROPIC_API_KEY));
});

test('a missing directory is a clear error', async () => {
  const ws = workspace();
  const { result, fake } = await runWith(ws, { dir: path.join(ws.root, 'nope'), yes: true });
  assert.equal(result.exitCode, 1);
  assert.match(result.error, /not found|does not exist/i);
  assert.equal(fake.calls.length, 0);
});

test('a directory without photos is a clear error', async () => {
  const ws = workspace({ 'notes.txt': 'hello' });
  const { result, fake } = await runWith(ws, { yes: true });
  assert.equal(result.exitCode, 1);
  assert.match(result.error, /no photos/i);
  assert.equal(fake.calls.length, 0);
});

test('non-image files are skipped with a note; the type comes from the content, not the extension', async () => {
  const ws = workspace({ 'a.jpg': JPEG, 'notes.txt': 'hello', 'fake.jpg': 'this is not an image', 'real.png': JPEG });
  const { result, fake, lines } = await runWith(ws, { runs: 1 });
  assert.equal(fake.calls.length, 0);
  assert.equal(result.plan.photos, 2, 'a.jpg and real.png');
  const skipped = Object.fromEntries(result.plan.skipped.map((s) => [s.file, s.reason]));
  assert.ok(skipped['notes.txt'] && skipped['fake.jpg']);
  assert.ok(!('real.png' in skipped), 'a jpeg saved as .png is still a photo');
  assert.ok(lines.join('\n').includes('fake.jpg'));
});

test('with --yes and the fake client run writes results.json and report.html, and calls the API as planned', async () => {
  const ws = workspace();
  const { result, fake } = await runWith(ws, { yes: true });
  assert.equal(result.exitCode, 0);
  assert.equal(fake.calls.filter((c) => !isRepairCall(c)).length, 8, 'old and new, 2 photos x 2 runs');
  const saved = JSON.parse(fs.readFileSync(path.join(ws.out, 'results.json'), 'utf8'));
  assert.equal(saved.photos.length, 2);
  assert.equal(saved.runsPerPhoto, 2);
  const first = saved.photos[0];
  assert.equal(first.file, 'a.jpg');
  assert.equal(first.runs.length, 2);
  assert.equal(first.runs[0].old.name, 'עוף עם אורז');
  assert.equal(first.runs[0].new.name, 'עוף עם אורז');
  assert.equal(first.runs[0].new.action, 'ok');
  assert.equal(result.resultsPath, path.join(ws.out, 'results.json'));
  const html = fs.readFileSync(path.join(ws.out, 'report.html'), 'utf8');
  assert.ok(html.includes('a.jpg') && html.includes('b.png') && html.includes('עוף עם אורז'));
  assert.deepEqual(fs.readdirSync(ws.out).sort(), ['report.html', 'results.json']);
});

test('the old and new pipelines use their own prompts and temperatures', async () => {
  const ws = workspace({ 'a.jpg': JPEG });
  const { fake } = await runWith(ws, { yes: true, runs: 1 });
  const [oldCall, newCall] = fake.calls;
  assert.equal(oldCall.temperature, 0.1);
  assert.equal(oldCall.max_tokens, 1200);
  assert.equal(newCall.temperature, 0);
  assert.notEqual(oldCall.system, newCall.system);
});

test('the new pipeline guard action (repair, clean, fallback) is recorded per run, quietly', async () => {
  const ws = workspace({ 'a.jpg': JPEG });
  const fake = fakeAnthropic();
  fake.imageReply = JSON.stringify({ dish_name: 'עוף 鸡 עם אורז', items: [{ name: 'עוף', calories: 100 }] });
  fake.repairReply = 'עוף מטוגן';
  const warned = [];
  const original = console.warn;
  console.warn = (...a) => warned.push(a.join(' '));
  let result;
  try {
    ({ result } = await runWith(ws, { yes: true, runs: 1 }, fake));
  } finally {
    console.warn = original;
  }
  assert.equal(console.warn, original);
  assert.deepEqual(warned, [], 'the guard log lines are captured, not printed');
  const r = result.results.photos[0].runs[0];
  assert.equal(r.old.raw, 'עוף 鸡 עם אורז');
  assert.equal(r.old.name, 'עוף עם אורז');
  assert.equal(r.new.raw, 'עוף 鸡 עם אורז');
  assert.equal(r.new.name, 'עוף מטוגן');
  assert.equal(r.new.action, 'repaired');
  assert.equal(r.new.repairCalls, 1);

  fake.repairReply = new Error('repair down');
  const second = await runWith(workspace({ 'a.jpg': JPEG }), { yes: true, runs: 1 }, fake);
  const c = second.result.results.photos[0].runs[0].new;
  assert.equal(c.action, 'cleaned');
  assert.equal(c.name, 'עוף עם אורז');
  fake.imageReply = JSON.stringify({ dish_name: 'chicken', items: [{ name: 'עוף', calories: 100 }] });
  const third = await runWith(workspace({ 'a.jpg': JPEG }), { yes: true, runs: 1 }, fake);
  assert.equal(third.result.results.photos[0].runs[0].new.action, 'fallback');
});

test('a failing call is recorded as an error and the run goes on', async () => {
  const ws = workspace();
  const fake = fakeAnthropic();
  fake.imageReply = 'not json at all';
  const quiet = mock.method(console, 'error', () => {}); // analyzeImage logs the parse failure
  let result;
  try {
    ({ result } = await runWith(ws, { yes: true, runs: 1 }, fake));
  } finally {
    quiet.mock.restore();
  }
  assert.equal(result.exitCode, 0);
  const r = result.results.photos[0].runs[0];
  assert.ok(r.old.error && r.new.error);
  assert.equal(result.results.photos.length, 2);
});

test('ratings.json is merged into the report and the natural percentage is correct', async () => {
  const ws = workspace();
  fs.mkdirSync(ws.out);
  fs.writeFileSync(path.join(ws.out, 'ratings.json'), JSON.stringify({
    'a.jpg': { natural: true, note: 'שם טבעי מאוד' },
    'b.png': { natural: false, note: '' },
    'c.png': { natural: true },
  }));
  const { result, lines } = await runWith(ws, { yes: true });
  assert.deepEqual(result.summary.natural, { rated: 2, natural: 1, percent: 50 });
  const html = fs.readFileSync(path.join(ws.out, 'report.html'), 'utf8');
  assert.ok(html.includes('שם טבעי מאוד') && html.includes('50%'));
  assert.ok(lines.join('\n').includes('50%'));
  assert.ok(fs.existsSync(path.join(ws.out, 'ratings.json')), 'ratings are left as they are');
});

test('an unreadable ratings.json is a clear error before any API call', async () => {
  const ws = workspace();
  fs.mkdirSync(ws.out);
  fs.writeFileSync(path.join(ws.out, 'ratings.json'), '{oops');
  const { result, fake } = await runWith(ws, { yes: true });
  assert.equal(result.exitCode, 1);
  assert.match(result.error, /ratings\.json/);
  assert.equal(fake.calls.length, 0);
});

test('invalid --runs is rejected', async () => {
  const ws = workspace();
  const { result } = await runWith(ws, { runs: 0 });
  assert.equal(result.exitCode, 1);
  assert.match(result.error, /runs/);
});

// ─── the old pipeline, reproduced ─────────────────────────────────────────────
test('cleanHebrewV1 is the old silent stripping', () => {
  assert.equal(cleanHebrewV1('עוף 鸡 עם chicken אורז'), 'עוף עם אורז');
  assert.equal(cleanHebrewV1(undefined), '');
  assert.equal(cleanHebrewV1('  סלט (גדול), 2 מנות  '), 'סלט (גדול), 2 מנות');
});

test('a stray Chinese character: V1 silently strips it, the new pipeline repairs it', async () => {
  const reply = JSON.stringify({ dish_name: 'עוף 鸡 עם אורז', items: [{ name: 'עוף', calories: 100, protein_g: 1, carbs_g: 2, fat_g: 3, fiber_g: 4 }] });
  const args = { imageBase64: JPEG.toString('base64'), mimeType: 'image/jpeg' };

  const oldFake = fakeAnthropic();
  oldFake.imageReply = reply;
  const old = await analyzeImageV1(oldFake, args);
  assert.equal(old.foodName, 'עוף עם אורז', 'the character is silently dropped');
  assert.deepEqual(old, { foodName: 'עוף עם אורז', calories: 100, protein_g: 1, carbs_g: 2, fat_g: 3, fiber_g: 4 });
  assert.equal(oldFake.calls.length, 1, 'no repair call in the old pipeline');
  assert.equal(oldFake.calls[0].temperature, 0.1);
  assert.equal(oldFake.calls[0].max_tokens, 1200);

  const newFake = fakeAnthropic();
  newFake.imageReply = reply;
  newFake.repairReply = 'עוף מטוגן עם אורז';
  const quiet = mock.method(console, 'warn', () => {}); // the guard logs every repair
  let fresh;
  try {
    fresh = await analyzeImage(newFake, args);
  } finally {
    quiet.mock.restore();
  }
  assert.equal(fresh.foodName, 'עוף מטוגן עם אורז', 'the new pipeline asks for a proper Hebrew name');
  assert.equal(newFake.calls.filter(isRepairCall).length, 1);
});

test('analyzeImageV1 defaults the name and rejects a reply without items', async () => {
  const fake = fakeAnthropic();
  fake.imageReply = JSON.stringify({ dish_name: 'chicken', items: [{ name: 'x', calories: 5 }] });
  assert.equal((await analyzeImageV1(fake, { imageBase64: 'AA==', mimeType: 'image/jpeg' })).foodName, 'מנה');
  fake.imageReply = JSON.stringify({ dish_name: 'סלט', items: [] });
  await assert.rejects(analyzeImageV1(fake, { imageBase64: 'AA==', mimeType: 'image/jpeg' }));
  fake.imageReply = 'no json';
  await assert.rejects(analyzeImageV1(fake, { imageBase64: 'AA==', mimeType: 'image/jpeg' }));
});
