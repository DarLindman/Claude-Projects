'use strict';

// One evaluation step: a photo through the OLD pipeline (V1 prompt + silent stripping),
// the NEW one (the production analyzeImage with the real guard) and, optionally, the NEW
// one on another model. Errors are
// recorded, never thrown, so one bad call does not lose a whole evaluation.

const { analyzeImage, isImageAnswer } = require('../../src/lib/analysis');
const { reconcileItems } = require('../../src/lib/nutrition');
const { replyText, extractJson } = require('../../src/lib/aiReply');
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

// A token count of the response `usage`, or null (absent, a string, NaN...).
const tokenOrNull = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);

// Wraps the client to count the repair calls and to keep what the model wrote in the
// image reply: the dish_name before any stripping or guard, the raw items and the
// scale_reference (a retried reply replaces the earlier one). `guarded` is true for the
// production pipeline (the new and the extra side) and false for the frozen old one.
// It also measures the (last) image call: the wall-clock `ms` and the response `usage` and
// stop reason (null when absent); a retry after an unreadable reply replaces the earlier one.
function instrument(client, { guarded }) {
  const probe = { repairCalls: 0, rawName: undefined, rawItems: undefined, scale: undefined, parsed: false, call: undefined };
  const wrapped = {
    messages: {
      async create(args) {
        const isRepair = typeof args.system === 'string' && args.system.startsWith(REPAIR_PROMPT_PREFIX);
        if (isRepair) probe.repairCalls++;
        const started = performance.now();
        let res;
        try {
          res = await client.messages.create(args);
        } catch (err) {
          if (!isRepair) probe.call = { ms: Math.round(performance.now() - started), inputTokens: null, outputTokens: null, stopReason: null };
          throw err;
        }
        if (!isRepair) {
          probe.call = {
            ms: Math.round(performance.now() - started),
            inputTokens: tokenOrNull(res?.usage?.input_tokens),
            outputTokens: tokenOrNull(res?.usage?.output_tokens),
            stopReason: typeof res?.stop_reason === 'string' ? res.stop_reason : null,
          };
          const reply = guarded ? parseProductionReply(res) : parseLegacyReply(res);
          Object.assign(probe, { rawName: reply?.dishName, rawItems: reply?.items, scale: reply?.scale, parsed: reply !== null });
        }
        return res;
      },
    },
  };
  return { client: wrapped, probe };
}

const partsOf = (o) => ({
  dishName: typeof o.dish_name === 'string' ? o.dish_name : undefined,
  items: o.items,
  scale: typeof o.scale_reference === 'string' ? o.scale_reference : undefined,
});

// The new and the extra side: exactly what analyzeImage accepts as the answer (the same
// text blocks, the same JSON search and the same accept rule), so the recording is of the
// object production used. null when production would have found no answer in the reply.
function parseProductionReply(res) {
  const text = replyText(res);
  if (text === null) return null;
  const { value } = extractJson(text, 'object', isImageAnswer);
  return value ? partsOf(value) : null;
}

// The old side: analyzeImageV1 keeps its own legacy parse (the greedy {...} span of the
// first content block, a non-empty items array), so the recording follows that one and not
// production's. The V1 reply has no scale_reference or volume_ml; those stay absent.
function parseLegacyReply(res) {
  try {
    const match = String(res?.content?.[0]?.text).trim().match(/\{[\s\S]*\}/);
    const parsed = match ? JSON.parse(match[0]) : undefined;
    if (!parsed || !Array.isArray(parsed.items) || parsed.items.length === 0) return null;
    return partsOf(parsed);
  } catch {
    return null;
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
  const { client: wrapped, probe } = instrument(client, { guarded });
  const log = guarded ? captureGuardLog() : null;
  const args = { imageBase64: photo.bytes.toString('base64'), mimeType: photo.mimeType };
  try {
    const out = await analyze(wrapped, args);
    // parsed: false when no answer could be read from the raw reply (scale, items and sanity are then absent)
    const side = { name: out.foodName, raw: probe.rawName, calories: out.calories, parsed: probe.parsed };
    if (probe.parsed) Object.assign(side, { scale: probe.scale ?? '', ...portionsOf(probe.rawItems) });
    if (guarded) Object.assign(side, { action: log.actions[0] || 'ok', repairCalls: probe.repairCalls });
    return Object.assign(side, probe.call);
  } catch (err) {
    return { raw: probe.rawName, error: describe(err), repairCalls: probe.repairCalls, ...probe.call };
  } finally {
    if (log) log.stop();
  }
}

// One run of one photo: what the user saw before (old) and gets now (new); with
// `extraModel` also the new pipeline (same prompt and guard) on that model (extra).
// With `onlyExtra` (and `extraModel`) only the extra variant runs: { extra } alone.
// `prompts` ({ system, user }) and `effort` (low|medium|high|off; undefined is the
// production default) apply to the extra variant only: the old and new sides stay as they are.
async function evaluateRun(client, photo, { extraModel, onlyExtra = false, prompts, effort } = {}) {
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
    const onModel = (c, args) => analyzeImage(c, {
      ...args,
      model: extraModel,
      temperature: null,
      ...(effort === undefined ? {} : { effort }),
      ...(prompts === undefined ? {} : { prompts }),
    });
    result.extra = await runSide(client, onModel, photo, { guarded: true });
  }
  return result;
}

module.exports = { evaluateRun, captureGuardLog };
