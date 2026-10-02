'use strict';

// The extra-model variant of the naming evaluation (--also-model): fakes only, never the
// real API and never .env.
const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fakeAnthropic } = require('../helpers/fakeAnthropic');
const { summarize, renderReport } = require('../../scripts/eval/report');
const { run, parseArgs, ESTIMATED_COST_PER_CALL_USD, COST_PER_CALL_EXTRA_USD } = require('../../scripts/eval-naming');
const { analyzeImage } = require('../../src/lib/analysis');
const { MODEL } = require('../../src/lib/anthropic');
const { REPAIR_PROMPT_PREFIX } = require('../../src/lib/hebrewName');
const { IMAGE_REPLY_TEMPLATE } = require('../../src/lib/prompts');

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
const KEY = { ANTHROPIC_API_KEY: 'sk-test-not-real' };
const EXTRA = 'claude-sonnet-5-5';
const isRepairCall = (c) => typeof c.system === 'string' && c.system.startsWith(REPAIR_PROMPT_PREFIX);
const ARGS = { imageBase64: JPEG.toString('base64'), mimeType: 'image/jpeg' };

function workspace(names = ['a.jpg', 'b.jpg']) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-extra-'));
  const photos = path.join(root, 'photos');
  fs.mkdirSync(photos);
  for (const n of names) fs.writeFileSync(path.join(photos, n), JPEG);
  return { root, photos, out: path.join(root, 'out') };
}

async function runWith(ws, options = {}, fake = fakeAnthropic()) {
  const lines = [];
  const result = await run({ dir: ws.photos, outDir: ws.out, env: KEY, runs: 2, ...options }, { createClient: () => fake, log: (l) => lines.push(l) });
  return { result, fake, lines };
}

// ─── analyzeImage model ───────────────────────────────────────────────────────
test('analyzeImage sends the given model and defaults to MODEL', async () => {
  const fake = fakeAnthropic();
  await analyzeImage(fake, { ...ARGS, model: EXTRA });
  await analyzeImage(fake, ARGS);
  const imageCalls = fake.calls.filter((c) => !isRepairCall(c));
  assert.equal(imageCalls[0].model, EXTRA);
  assert.equal(imageCalls[1].model, MODEL);
});

test('analyzeImage rejects a model that is not a non-empty string', async () => {
  for (const model of ['', '   ', null, 42, {}]) {
    const fake = fakeAnthropic();
    await assert.rejects(analyzeImage(fake, { ...ARGS, model }), /model/);
    assert.equal(fake.calls.length, 0);
  }
});

// ─── parseArgs ────────────────────────────────────────────────────────────────
test('parseArgs reads --also-model and needs a value', () => {
  assert.deepEqual(parseArgs(['--also-model', EXTRA]), { dir: 'eval/photos', runs: 3, yes: false, alsoModel: EXTRA });
  assert.throws(() => parseArgs(['--also-model']), /--also-model/);
  assert.throws(() => parseArgs(['--also-model', '--yes']), /--also-model/);
});

// ─── dry run ──────────────────────────────────────────────────────────────────
test('dry run with --also-model makes zero client calls and reports the extra count and cost', async () => {
  const ws = workspace();
  let created = 0;
  const lines = [];
  const result = await run({ dir: ws.photos, outDir: ws.out, env: KEY, runs: 2, alsoModel: EXTRA }, { createClient: () => { created++; return fakeAnthropic(); }, log: (l) => lines.push(l) });
  assert.equal(created, 0);
  assert.equal(result.exitCode, 0);
  assert.equal(result.plan.calls, 8);
  assert.equal(result.plan.maxCalls, 12, 'the base plan is unchanged');
  assert.equal(result.plan.extra.model, EXTRA);
  assert.equal(result.plan.extra.calls, 4, '2 photos x 2 runs x 1');
  assert.equal(result.plan.extra.maxCalls, 8, 'plus up to one repair call per run');
  assert.equal(result.plan.extra.estimatedCostUsd, Number((4 * (COST_PER_CALL_EXTRA_USD + ESTIMATED_COST_PER_CALL_USD)).toFixed(2)));
  assert.ok(COST_PER_CALL_EXTRA_USD > ESTIMATED_COST_PER_CALL_USD, 'a Sonnet-class call is estimated above a Haiku call');
  assert.equal(result.plan.totalMaxCalls, 20);
  assert.equal(result.plan.totalEstimatedCostUsd, Number((result.plan.estimatedCostUsd + result.plan.extra.estimatedCostUsd).toFixed(2)));
  const text = lines.join('\n');
  assert.ok(text.includes(EXTRA) && text.includes('Total') && text.includes('estimate'));
  assert.ok(text.includes('x 1 = 4 API calls'));
  assert.ok(!fs.existsSync(ws.out), 'nothing is written');
});

test('without --also-model the plan has no extra part', async () => {
  const { result, lines } = await runWith(workspace());
  assert.equal(result.plan.extra, undefined);
  assert.ok(!lines.join('\n').includes('Extra variant'));
});

test('a model id that does not start with claude- is refused with exit code 1 and no calls', async () => {
  for (const bad of ['gpt-4', '', 'sonnet', 'claude-', 'claude-x y', 'claude-‮']) {
    const ws = workspace();
    let created = 0;
    const result = await run({ dir: ws.photos, outDir: ws.out, env: KEY, runs: 1, yes: true, alsoModel: bad }, { createClient: () => { created++; return fakeAnthropic(); }, log() {} });
    assert.equal(result.exitCode, 1, bad);
    assert.match(result.error, /claude-/);
    assert.equal(created, 0);
    assert.ok(!fs.existsSync(ws.out));
  }
});

// ─── --yes with the fake ──────────────────────────────────────────────────────
test('with --yes and --also-model every run holds three variants and the extra call uses the extra model', async () => {
  const ws = workspace();
  const { result, fake } = await runWith(ws, { yes: true, alsoModel: EXTRA });
  assert.equal(result.exitCode, 0);
  const imageCalls = fake.calls.filter((c) => !isRepairCall(c));
  assert.equal(imageCalls.length, 12, '2 photos x 2 runs x 3 variants');
  assert.equal(imageCalls.filter((c) => c.model === EXTRA).length, 4);
  assert.equal(imageCalls.filter((c) => c.model === MODEL).length, 8);
  const saved = JSON.parse(fs.readFileSync(path.join(ws.out, 'results.json'), 'utf8'));
  assert.deepEqual(Object.keys(saved.variants), ['old', 'new', 'extra']);
  assert.equal(saved.variants.extra.model, EXTRA);
  assert.equal(saved.variants.extra.label, EXTRA);
  for (const photo of saved.photos) {
    for (const r of photo.runs) {
      assert.equal(r.extra.name, 'עוף עם אורז');
      assert.equal(r.extra.action, 'ok');
      assert.ok(r.old && r.new);
    }
  }
  assert.equal(result.results.apiCalls, 12);
  const html = fs.readFileSync(path.join(ws.out, 'report.html'), 'utf8');
  assert.ok(html.includes(EXTRA));
  assert.equal((html.match(/<th>עכשיו על /g) || []).length, 3, 'summary table and two photo tables each get the extra column');
  assert.deepEqual(fs.readdirSync(ws.out).sort(), ['report.html', 'results.json']);
});

test('without --also-model the results have no extra and two variants', async () => {
  const ws = workspace();
  const { result } = await runWith(ws, { yes: true });
  assert.deepEqual(Object.keys(result.results.variants), ['old', 'new']);
  assert.equal(result.results.photos[0].runs[0].extra, undefined);
  assert.ok(!fs.readFileSync(path.join(ws.out, 'report.html'), 'utf8').includes('עכשיו על'));
});

test('the extra variant records the guard action and its repair calls', async () => {
  const ws = workspace(['a.jpg']);
  const fake = fakeAnthropic();
  fake.imageReply = JSON.stringify({ dish_name: 'עוף 鸡', items: [{ name: 'עוף', calories: 100 }] });
  fake.repairReply = 'עוף מטוגן';
  const warned = [];
  const original = console.warn;
  console.warn = (...a) => warned.push(a.join(' '));
  let result;
  try {
    ({ result } = await runWith(ws, { yes: true, runs: 1, alsoModel: EXTRA }, fake));
  } finally {
    console.warn = original;
  }
  assert.deepEqual(warned, [], 'quiet');
  const r = result.results.photos[0].runs[0];
  assert.equal(r.extra.action, 'repaired');
  assert.equal(r.extra.repairCalls, 1);
  assert.equal(r.extra.name, 'עוף מטוגן');
  assert.equal(result.results.apiCalls, 5, 'old, new + repair, extra + repair');
});

test('a failing extra variant is recorded and does not abort the run', async () => {
  const ws = workspace();
  const fake = fakeAnthropic();
  const create = fake.messages.create;
  fake.messages.create = async (args) => {
    if (args.model === EXTRA) throw new Error('extra model down');
    return create(args);
  };
  const { result } = await runWith(ws, { yes: true, runs: 1, alsoModel: EXTRA }, fake);
  assert.equal(result.exitCode, 0);
  assert.equal(result.results.photos.length, 2);
  for (const photo of result.results.photos) {
    const r = photo.runs[0];
    assert.match(r.extra.error, /extra model down/);
    assert.equal(r.new.name, 'עוף עם אורז');
  }
  assert.equal(result.summary.extra.errors, 2);
});

// ─── summary and report ───────────────────────────────────────────────────────
const rec = (name, action = 'ok', raw = name) => ({ name, raw, action, repairCalls: action === 'repaired' ? 1 : 0 });
const THREE = {
  runsPerPhoto: 2,
  variants: { old: { label: 'old', model: MODEL }, new: { label: 'new', model: MODEL }, extra: { label: EXTRA, model: EXTRA } },
  photos: [
    { file: 'a.jpg', runs: [
      { old: { name: 'עוף', raw: 'עוף' }, new: rec('עוף'), extra: rec('עוף 鸡') },
      { old: { name: 'עוף', raw: 'עוף' }, new: rec('עוף', 'cleaned'), extra: rec('עוף מטוגן', 'repaired') },
    ] },
    { file: 'b.jpg', runs: [
      { old: { name: 'מנה', raw: 'x' }, new: rec('מנה', 'fallback'), extra: rec('אחת שתיים שלוש ארבע חמש שש שבע שמונה תשע') },
      { old: { error: 'boom' }, new: { error: 'boom' }, extra: { error: 'boom' } },
    ] },
  ],
};

test('summarize counts every variant separately', () => {
  const s = summarize(THREE);
  assert.equal(s.new.cleaned, 1);
  assert.equal(s.new.fallback, 1);
  assert.equal(s.new.repaired, 0);
  assert.equal(s.extra.foreign, 1);
  assert.equal(s.extra.repaired, 1);
  assert.equal(s.extra.long, 1);
  assert.equal(s.extra.cleaned, 0);
  assert.equal(s.extra.errors, 1);
  assert.equal(s.naturalExtra, null);
});

test('summarize has no extra part for two-variant results', () => {
  const two = { ...THREE, variants: undefined, photos: THREE.photos.map((p) => ({ ...p, runs: p.runs.map(({ extra, ...rest }) => rest) })) };
  const s = summarize(two);
  assert.equal(s.extra, null);
  assert.equal(s.naturalExtra, null);
});

test('natural percentages are computed per variant from ratings, old files keep working', () => {
  const ratings = {
    'a.jpg': { natural: false, extra: true },
    'b.jpg': { natural: true, extra: true, note: 'x' },
  };
  const s = summarize(THREE, ratings);
  assert.deepEqual(s.natural, { rated: 2, natural: 1, percent: 50 });
  assert.deepEqual(s.naturalExtra, { rated: 2, natural: 2, percent: 100 });
  const oldStyle = summarize(THREE, { 'a.jpg': { natural: true }, 'b.jpg': { natural: true, note: '' } });
  assert.equal(oldStyle.natural.percent, 100);
  assert.equal(oldStyle.naturalExtra, null, 'no extra ratings, no extra percentage');
  assert.equal(summarize(THREE, { 'a.jpg': { extra: 'yes' } }).naturalExtra, null);
});

test('renderReport shows three columns, a summary column and both verdicts', () => {
  const html = renderReport(THREE, { 'a.jpg': { natural: false, extra: true, note: 'הערה' }, 'b.jpg': { natural: true, extra: true } });
  assert.equal((html.match(/<th>עכשיו על /g) || []).length, 3);
  assert.ok(html.includes(EXTRA) && html.includes('עוף מטוגן') && html.includes('הערה'));
  assert.ok(html.includes('50%') && html.includes('100%'));
  assert.match(html, /<tr><td>repaired<\/td><td>0<\/td><td>0<\/td><td>1<\/td>/);
  assert.match(html, /verdict yes">[^<]*טבעי/);
});

test('renderReport HTML-escapes the extra column, its model label and its verdict', () => {
  const evil = '<img src=x onerror=alert(1)>';
  const hostile = {
    runsPerPhoto: 1,
    variants: { extra: { label: 'claude-"><script>alert(9)</script>', model: 'claude-x' } },
    photos: [{
      file: 'a.jpg',
      runs: [{ old: { name: 'עוף', raw: 'עוף' }, new: rec('עוף'), extra: { name: evil, raw: '<svg onload=alert(4)>', action: 'cleaned', repairCalls: 0 } }],
    }],
  };
  const html = renderReport(hostile, { 'a.jpg': { natural: true, extra: false, note: '<u onclick=alert(5)>' } });
  for (const raw of ['<img src=x', '<svg onload', '<script>alert(9)', '<u onclick']) assert.ok(!html.includes(raw), `no raw ${raw}`);
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(html.includes('&lt;script&gt;alert(9)'));
});

test('--also-model output stays quiet: only the injected log is used', async () => {
  const ws = workspace(['a.jpg']);
  const out = mock.method(console, 'log', () => {});
  const err = mock.method(console, 'error', () => {});
  try {
    await runWith(ws, { yes: true, runs: 1, alsoModel: EXTRA });
    assert.equal(out.mock.callCount(), 0);
    assert.equal(err.mock.callCount(), 0);
  } finally {
    out.mock.restore();
    err.mock.restore();
  }
});

// ─── weights, volumes and the sanity report of every recorded side ────────────
test('every recorded side keeps the scale, the items with weight, volume and calories, and a sanity report', async () => {
  const ws = workspace(['a.jpg']);
  const { result } = await runWith(ws, { yes: true, runs: 1, alsoModel: EXTRA });
  const r = result.results.photos[0].runs[0];
  for (const side of ['old', 'new', 'extra']) {
    assert.equal(r[side].scale, 'dinner plate about 26 cm', side);
    assert.deepEqual(r[side].items, [
      { weight_g: 150, volume_ml: 170, calories: 250 },
      { weight_g: 150, volume_ml: 190, calories: 200 },
    ], side);
    assert.deepEqual(r[side].sanity, { adjusted: 0, calories_delta: 0, rules: {} }, side);
  }
  const saved = JSON.parse(fs.readFileSync(path.join(ws.out, 'results.json'), 'utf8'));
  assert.deepEqual(saved.photos[0].runs[0].extra.items, r.extra.items, 'it is in results.json too');
});

test('an inconsistent item of the extra reply shows up in sanity.rules; the recorded items are the raw numbers', async () => {
  const ws = workspace(['a.jpg']);
  const fake = fakeAnthropic();
  fake.imageReply = JSON.stringify({
    scale_reference: 'a fork',
    dish_name: 'עוף',
    items: [{ name: 'עוף', volume_ml: 500, weight_g: 3000, calories: 900, protein_g: 40, carbs_g: 0, fat_g: 20, fiber_g: 0 }],
  });
  const { result } = await runWith(ws, { yes: true, runs: 1, alsoModel: EXTRA }, fake);
  const extra = result.results.photos[0].runs[0].extra;
  assert.equal(extra.items[0].weight_g, 3000, 'the raw weight, not the capped one');
  assert.equal(extra.sanity.adjusted, 1);
  assert.equal(extra.sanity.rules.weight, 1);
});

test('absent fields are recorded as null and an empty scale', async () => {
  const ws = workspace(['a.jpg']);
  const fake = fakeAnthropic();
  fake.imageReply = JSON.stringify({ dish_name: 'עוף', items: [{ name: 'עוף', calories: 100 }, { name: 'x', weight_g: '60', volume_ml: 'lots' }] });
  const { result } = await runWith(ws, { yes: true, runs: 1, alsoModel: EXTRA }, fake);
  for (const side of ['old', 'new', 'extra']) {
    const rec = result.results.photos[0].runs[0][side];
    assert.equal(rec.scale, '');
    assert.deepEqual(rec.items, [{ weight_g: null, volume_ml: null, calories: 100 }, { weight_g: null, volume_ml: null, calories: null }]);
    assert.equal(typeof rec.sanity, 'object');
  }
});

test('the reply is read from the first text block, whatever blocks come before it', async () => {
  const ws = workspace(['a.jpg']);
  const fake = fakeAnthropic();
  fake.imageContent = [
    { type: 'thinking', thinking: '{"dish_name":"לא זה","items":[]}' },
    { type: 'text', text: JSON.stringify({ scale_reference: 'a hand', dish_name: 'עוף', items: [{ name: 'עוף', volume_ml: 100, weight_g: 90, calories: 150, protein_g: 20, carbs_g: 0, fat_g: 7, fiber_g: 0 }] }) },
  ];
  const { result } = await runWith(ws, { yes: true, runs: 1, alsoModel: EXTRA }, fake);
  const extra = result.results.photos[0].runs[0].extra;
  assert.equal(extra.scale, 'a hand');
  assert.deepEqual(extra.items, [{ weight_g: 90, volume_ml: 100, calories: 150 }]);
});

// ─── the report shows the weights ─────────────────────────────────────────────
const sideWith = (over = {}) => ({
  name: 'עוף עם אורז', raw: 'עוף עם אורז', action: 'ok', repairCalls: 0, calories: 450,
  scale: 'dinner plate about 26 cm',
  items: [{ weight_g: 150, volume_ml: 170, calories: 250 }, { weight_g: 175, volume_ml: null, calories: 200 }],
  sanity: { adjusted: 1, calories_delta: -20, rules: { density: 1 } },
  ...over,
});
const withExtra = (extra, run = {}) => ({
  runsPerPhoto: 1,
  variants: { extra: { label: EXTRA, model: EXTRA } },
  photos: [{ file: 'a.jpg', runs: [{ old: { name: 'עוף', raw: 'עוף', calories: 380 }, new: { ...rec('עוף'), calories: 420 }, extra, ...run }] }],
});

test('renderReport shows the extra column totals, per-item grams, scale, sanity rules and the earlier calories', () => {
  const html = renderReport(withExtra(sideWith(), { previousExtra: { name: 'עוף', calories: 390 } }), {});
  assert.ok(html.includes('325'), 'total grams 150 + 175');
  assert.ok(html.includes('450'), 'total calories');
  assert.ok(html.includes('150') && html.includes('175') && html.includes('170'), 'per-item grams and the volume');
  assert.ok(html.includes('dinner plate about 26 cm'));
  assert.ok(html.includes('density'), 'the rule that fired');
  for (const earlier of ['380', '420', '390']) assert.ok(html.includes(earlier), `earlier calories ${earlier}`);
});

test('renderReport escapes a scale, sanity rule names and earlier values that carry markup', () => {
  const extra = sideWith({ scale: '<script>alert(1)</script>', sanity: { adjusted: 1, calories_delta: 0, rules: { '<b>x</b>': 1 } } });
  const html = renderReport(withExtra(extra, { previousExtra: { name: '<i>n</i>', calories: '<u>9</u>' } }), {});
  assert.ok(!html.includes('<script>alert(1)'), 'no raw script');
  assert.ok(!html.includes('<b>x</b>') && !html.includes('<u>9</u>') && !html.includes('<i>n</i>'));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
});

test('renderReport copes with stored results that lack the new fields and with partial or odd ones', () => {
  const odd = [
    undefined,
    { name: 'עוף', raw: 'עוף', calories: 100 },
    { name: 'עוף', calories: 100, items: [], sanity: { adjusted: 0, calories_delta: 0, rules: {} }, scale: '' },
    { name: 'עוף', calories: 100, items: [null, { weight_g: null }, 7], sanity: null, scale: null },
    { name: 'עוף', items: 'x', sanity: { rules: 5 } },
    { error: 'boom', items: [{ weight_g: 1 }] },
  ];
  for (const extra of odd) {
    assert.doesNotThrow(() => renderReport(withExtra(extra), {}), JSON.stringify(extra));
  }
  assert.doesNotThrow(() => renderReport(withExtra(sideWith(), { old: undefined, new: undefined, previousExtra: {} }), {}));
  assert.doesNotThrow(() => renderReport(THREE, {}));
});

// ─── the recording matches what production parsed ─────────────────────────────
const REAL_ANSWER = {
  visual_description: 'a plate',
  scale_reference: 'a fork, 19 cm',
  draft_name: 'עוף',
  dish_name: 'עוף בגריל',
  items: [{ name: 'עוף', volume_ml: 300, weight_g: 280, calories: 460, protein_g: 40, carbs_g: 0, fat_g: 31, fiber_g: 0 }],
};
const REAL_ITEMS = [{ weight_g: 280, volume_ml: 300, calories: 460 }];

test('a reply with prose, a stray {x} and the JSON: new and extra record the real answer (old, with its legacy parse, fails)', async () => {
  const ws = workspace(['a.jpg']);
  const fake = fakeAnthropic();
  fake.imageReply = `Here {x} is my answer: ${JSON.stringify(REAL_ANSWER)}`;
  const { result } = await runWith(ws, { yes: true, runs: 1, alsoModel: EXTRA }, fake);
  const r = result.results.photos[0].runs[0];
  for (const side of ['new', 'extra']) {
    assert.equal(r[side].parsed, true, side);
    assert.equal(r[side].raw, 'עוף בגריל', side);
    assert.equal(r[side].scale, 'a fork, 19 cm', side);
    assert.deepEqual(r[side].items, REAL_ITEMS, side);
  }
  assert.match(r.old.error, /invalid JSON/, 'the frozen V1 parse cannot read it, as before');
});

test('an echoed template before the real answer is skipped: the recording is of the real answer', async () => {
  const ws = workspace(['a.jpg']);
  const fake = fakeAnthropic();
  fake.imageReply = `${JSON.stringify(IMAGE_REPLY_TEMPLATE)}\n${JSON.stringify(REAL_ANSWER)}`;
  const { result } = await runWith(ws, { yes: true, runs: 1, alsoModel: EXTRA }, fake);
  const r = result.results.photos[0].runs[0];
  for (const side of ['new', 'extra']) {
    assert.equal(r[side].name, 'עוף בגריל', side);
    assert.equal(r[side].raw, 'עוף בגריל', side);
    assert.equal(r[side].scale, 'a fork, 19 cm', side);
    assert.deepEqual(r[side].items, REAL_ITEMS, side);
    assert.equal(r[side].parsed, true, side);
  }
});

test('the text blocks of the reply are read like production: joined consecutive blocks', async () => {
  const ws = workspace(['a.jpg']);
  const fake = fakeAnthropic();
  const json = JSON.stringify(REAL_ANSWER);
  fake.imageContent = [{ type: 'text', text: json.slice(0, 40) }, { type: 'text', text: json.slice(40) }];
  const { result } = await runWith(ws, { yes: true, runs: 1, alsoModel: EXTRA }, fake);
  assert.deepEqual(result.results.photos[0].runs[0].extra.items, REAL_ITEMS);
});

test('the report marks a reply that could not be read, and shows a partial gram total with a note', () => {
  const unread = renderReport(withExtra({ name: 'עוף', raw: 'עוף', action: 'ok', calories: 100, parsed: false }), {});
  assert.ok(unread.includes('לא נקראה'), 'a visible marker');
  const flagless = renderReport(withExtra(sideWith({ parsed: undefined })), {});
  assert.ok(!flagless.includes('לא נקראה'), 'old results without the flag are not marked');
  const partial = renderReport(withExtra(sideWith({ items: [{ weight_g: 150, volume_ml: 170, calories: 250 }, { weight_g: null, volume_ml: null, calories: 200 }] })), {});
  assert.ok(partial.includes('150+? g') && partial.includes('חסר משקל'), 'a lower-bound total, flagged');
  assert.ok(!partial.includes('150 g</span> &middot;'), 'not shown as a clean total');
});

test('the report shows the earlier calories also when the new extra is an error record', () => {
  const html = renderReport(withExtra({ error: 'boom-extra' }, { previousExtra: { name: 'עוף', calories: 391 } }), {});
  assert.ok(html.includes('boom-extra') && html.includes('391') && html.includes('380'));
});

// ─── latency and tokens of the extra variant ──────────────────────────────────
const timed = (ms, inputTokens, outputTokens, over = {}) => ({ ...sideWith(), ms, inputTokens, outputTokens, stopReason: 'end_turn', ...over });
const withRuns = (extras, variantExtra = { label: EXTRA, model: EXTRA }) => ({
  runsPerPhoto: extras.length,
  variants: { extra: variantExtra },
  photos: [{ file: 'a.jpg', runs: extras.map((extra) => ({ old: rec('עוף'), new: rec('עוף'), extra })) }],
});

test('summarize gives the average and maximum latency and the average tokens of the extra variant', () => {
  const s = summarize(withRuns([timed(2000, 2000, 500), timed(4000, 3000, 700), timed(9000, 1000, 300)]), {});
  assert.deepEqual(s.extraStats, { calls: 3, avgMs: 5000, maxMs: 9000, avgInputTokens: 2000, avgOutputTokens: 500 });
});

test('the latency statistics skip missing numbers independently and are absent when nothing was measured', () => {
  const s = summarize(withRuns([timed(1000, null, null), timed(3000, 2000, 600), { name: 'עוף', calories: 1 }, { error: 'boom' }]), {});
  assert.equal(s.extraStats.calls, 2);
  assert.equal(s.extraStats.avgMs, 2000);
  assert.equal(s.extraStats.maxMs, 3000);
  assert.equal(s.extraStats.avgInputTokens, 2000, 'only the call that has tokens counts');
  assert.equal(summarize(withRuns([sideWith()]), {}).extraStats, null, 'results from before the latency fields');
  assert.equal(summarize(THREE, {}).extraStats, null);
  assert.equal(summarize({ runsPerPhoto: 1, photos: [{ file: 'a.jpg', runs: [{ old: rec('עוף'), new: rec('עוף') }] }] }, {}).extraStats, null, 'no extra variant');
  const noTokens = summarize(withRuns([timed(1500, null, null)]), {}).extraStats;
  assert.equal(noTokens.avgMs, 1500);
  assert.equal(noTokens.avgInputTokens, null);
  assert.equal(noTokens.avgOutputTokens, null);
});

test('renderReport shows the average and maximum latency and the average tokens, and a latency per extra record', () => {
  const html = renderReport(withRuns([timed(2000, 2000, 500), timed(4000, 3000, 700)]), {});
  assert.ok(html.includes('זמן תגובה'), 'a latency line');
  assert.ok(html.includes('3.0 s') && html.includes('4.0 s'), 'average 3.0 s, maximum 4.0 s');
  assert.ok(html.includes('2500') && html.includes('600'), 'average input and output tokens');
  assert.ok(html.includes('2.0 s') && html.includes('end_turn'), 'the per-record line');
});

test('renderReport shows the prompt and the effort in the extra column label, HTML-escaped', () => {
  const html = renderReport(withRuns([timed(1000, 1, 1)], { label: EXTRA, model: EXTRA, prompt: 'prePortion', effort: 'medium' }), {});
  assert.ok(html.includes('prePortion') && html.includes('medium'));
  assert.equal((html.match(/<th>עכשיו על /g) || []).length, 2, 'summary table and the photo table');
  const evil = renderReport(withRuns([timed(1000, 1, 1, { stopReason: '<b>x</b>' })], { label: EXTRA, model: EXTRA, prompt: '<script>alert(1)</script>', effort: '"><img src=x onerror=alert(2)>' }), {});
  for (const raw of ['<script>alert(1)', '<img src=x', '<b>x</b>']) assert.ok(!evil.includes(raw), `no raw ${raw}`);
  assert.ok(evil.includes('&lt;script&gt;alert(1)'));
});

test('results from before the latency, prompt and effort fields render without any of those lines', () => {
  const html = renderReport(withExtra(sideWith()), {});
  assert.ok(!html.includes('זמן תגובה'));
  assert.ok(!html.includes('undefined') && !html.includes('NaN') && !html.includes('null'));
  const odd = [timed('x', 'y', {}), timed(-5, 1, 1), timed(NaN, Infinity, 1), timed(null, null, null)];
  for (const extra of odd) assert.doesNotThrow(() => renderReport(withRuns([extra]), {}), JSON.stringify(extra));
});
