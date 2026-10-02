'use strict';

// One evaluation step: a photo through the OLD pipeline (V1 prompt + silent stripping),
// the NEW one (the production analyzeImage with the real guard) and, optionally, the NEW
// one on another model. Errors are
// recorded, never thrown, so one bad call does not lose a whole evaluation.

const { analyzeImage } = require('../../src/lib/analysis');
const { reconcileItems } = require('../../src/lib/nutrition');
const { REPAIR_PROMPT_PREFIX } = require('../../src/lib/hebrewName');
const { analyzeImageV1 } = require('./imagePromptV1');

// The guard reports every non-ok outcome as one console.warn line ("hebrewName
// <action>: ..."); analyzeImage does not pass it a log, so the production code path
// stays untouched and the action is read from that line. The runs are sequential, so
// the temporary console.warn swap cannot catch anything else; other warnings pass on.
const GUARD_LINE = /^hebrewName (repaired|cleaned|fallback):/;

function captureGuardLog() {
  const original = console.warn;
  const actions = [];
  console.warn = (...args) => {
    const match = GUARD_LINE.exec(String(args[0]));
    if (match) actions.push(match[1]);
    else original.apply(console, args);
  };
  return { actions, stop: () => { console.warn = original; } };
}

// Wraps the client to count the repair calls and to keep what the model wrote in the
// image reply, parsed once from its first text block: the dish_name before any stripping
// or guard, the raw items and the scale_reference (a retried reply replaces the earlier one).
function instrument(client) {
  const probe = { repairCalls: 0, rawName: undefined, rawItems: undefined, scale: undefined };
  const wrapped = {
    messages: {
      async create(args) {
        const isRepair = typeof args.system === 'string' && args.system.startsWith(REPAIR_PROMPT_PREFIX);
        if (isRepair) probe.repairCalls++;
        const res = await client.messages.create(args);
        if (!isRepair) {
          const reply = parseRawReply(firstText(res));
          Object.assign(probe, { rawName: reply.dishName, rawItems: reply.items, scale: reply.scale });
        }
        return res;
      },
    },
  };
  return { client: wrapped, probe };
}

const firstText = (res) => (Array.isArray(res?.content) ? res.content.find((b) => b && b.type === 'text')?.text : undefined);

// What the raw reply holds, as far as it parses: never throws, absent parts are undefined.
function parseRawReply(text) {
  try {
    const match = String(text).match(/\{[\s\S]*\}/);
    const parsed = match ? JSON.parse(match[0]) : undefined;
    if (!parsed || typeof parsed !== 'object') return {};
    return {
      dishName: typeof parsed.dish_name === 'string' ? parsed.dish_name : undefined,
      items: Array.isArray(parsed.items) ? parsed.items : undefined,
      scale: typeof parsed.scale_reference === 'string' ? parsed.scale_reference : undefined,
    };
  } catch {
    return {};
  }
}

// A number of the raw reply, or null (absent, a string, NaN...).
const numberOrNull = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// What a side records about the portions: the numbers the model wrote per item (null when
// absent) and what the production sanity rules do to them (the report of reconcileItems).
function portionsOf(rawItems) {
  const list = Array.isArray(rawItems) ? rawItems : [];
  return {
    items: list.map((it) => ({ weight_g: numberOrNull(it?.weight_g), volume_ml: numberOrNull(it?.volume_ml), calories: numberOrNull(it?.calories) })),
    sanity: reconcileItems(list).report,
  };
}

const describe = (err) => `${err?.name || 'Error'}: ${String(err?.message ?? err).slice(0, 200)}`;

async function runSide(client, analyze, photo, { guarded }) {
  const { client: wrapped, probe } = instrument(client);
  const log = guarded ? captureGuardLog() : null;
  const args = { imageBase64: photo.bytes.toString('base64'), mimeType: photo.mimeType };
  try {
    const out = await analyze(wrapped, args);
    const side = { name: out.foodName, raw: probe.rawName, calories: out.calories, scale: probe.scale ?? '', ...portionsOf(probe.rawItems) };
    if (guarded) Object.assign(side, { action: log.actions[0] || 'ok', repairCalls: probe.repairCalls });
    return side;
  } catch (err) {
    return { raw: probe.rawName, error: describe(err), repairCalls: probe.repairCalls };
  } finally {
    if (log) log.stop();
  }
}

// One run of one photo: what the user saw before (old) and gets now (new); with
// `extraModel` also the new pipeline (same prompt and guard) on that model (extra).
// With `onlyExtra` (and `extraModel`) only the extra variant runs: { extra } alone.
async function evaluateRun(client, photo, { extraModel, onlyExtra = false } = {}) {
  const result = {};
  if (!(onlyExtra && extraModel)) {
    result.old = await runSide(client, analyzeImageV1, photo, { guarded: false });
    result.new = await runSide(client, analyzeImage, photo, { guarded: true });
  }
  if (extraModel) {
    // temperature: null omits the field: some newer models (the Sonnet-class ones the
    // extra variant is meant for) reject it with a 400 ("temperature is deprecated for
    // this model"), which would fail every call for a reason unrelated to naming. The
    // old and new variants (Haiku) keep temperature 0 exactly as production sends it.
    const onModel = (c, args) => analyzeImage(c, { ...args, model: extraModel, temperature: null });
    result.extra = await runSide(client, onModel, photo, { guarded: true });
  }
  return result;
}

module.exports = { evaluateRun, captureGuardLog };
