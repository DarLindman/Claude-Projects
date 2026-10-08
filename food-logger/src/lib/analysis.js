'use strict';

const { isDeepStrictEqual } = require('node:util');
const { MODEL } = require('./anthropic');
const { ensureHebrewDishName, cleanDishName } = require('./hebrewName');
const {
  IMAGE_SYSTEM_PROMPT, IMAGE_USER_MESSAGE, TEXT_SYSTEM_PROMPT, IMAGE_REPLY_TEMPLATE, TEXT_REPLY_TEMPLATE,
} = require('./prompts');
const { replyText, blockTypes, stopReasonOf, extractJson, isPlainObject } = require('./aiReply');
const { reconcileItems } = require('./nutrition');
const {
  temperatureFor, maxTokensFor, textMaxTokensFor, requestOptionsFor, textRequestOptionsFor,
} = require('./modelRules');

// Thrown when the model's reply cannot be turned into nutrition items. Like any other AI
// failure, the routes map it to 502 AI_UNAVAILABLE (the details only go to the log).
// `kind` (what was wrong, e.g. 'JSON parse error') and `stopReason` are API-enum-like
// values, safe to log; neither ever holds reply text.
class AnalysisParseError extends Error {
  constructor(message, { kind, stopReason } = {}) {
    super(message);
    this.kind = kind;
    this.stopReason = stopReason;
  }
}

// The per-model request rules (temperature, max_tokens, effort fields) live in modelRules.js;
// temperatureFor, maxTokensFor and requestOptionsFor are the image side and stay exported here.

// The JSON of a reply, or an AnalysisParseError. The reply describes the user's meal, so it
// is never logged or put in the error: a failure logs (under `tag`) only its kind, the
// reply length, the block types and stop_reason (so a reply cut by max_tokens or one
// without a text block is recognisable), and the error message carries the same details
// for the route's request-id log line. A JSON.parse message can quote the input, so it is
// not passed on either. Returns the value and a `fail(kind)` for the caller's own checks.
function parseReply(message, kind, tag, accept) {
  const fail = (what, length) => {
    const details = `${what} (reply of ${length} characters in blocks ${blockTypes(message)}, stop_reason ${stopReasonOf(message)})`;
    console.error(`[${tag}] ${details}`);
    throw new AnalysisParseError(details, { kind: what, stopReason: stopReasonOf(message) });
  };
  const text = replyText(message);
  if (text === null) fail('no text block', 0);
  const { value, error } = extractJson(text, kind, accept);
  if (error) fail(error, text.length);
  return { value, fail: (what) => fail(what, text.length) };
}

// One model call with a numbers-only usage line (the owner reads it to measure the real
// cost): the model id, input and output tokens ("?" when the reply has no usage), the
// duration in ms and the stop_reason (the allowlisted enum rule of aiReply, "error" when the
// call rejected). Never any reply text, name or identifier.
const safeModelId = (m) => (/^[A-Za-z0-9._-]{1,64}$/.test(m) ? m : 'unknown');
const tokens = (n) => (Number.isFinite(n) ? String(n) : '?');
async function callModel(anthropic, tag, label, request) {
  const start = Date.now();
  const line = (message, stop) => console.info(
    `[${tag}] ${label} model=${safeModelId(request.model)} in=${tokens(message?.usage?.input_tokens)} out=${tokens(message?.usage?.output_tokens)} ms=${Date.now() - start} stop=${stop}`);
  let message;
  try {
    message = await anthropic.messages.create(request);
  } catch (err) {
    line(null, 'error');
    throw err;
  }
  line(message, stopReasonOf(message));
  return message;
}

// Runs one AI call plus the parsing of its reply (`attempt`) and, when the reply cannot be
// turned into an answer (an AnalysisParseError: unparseable JSON, no JSON, no text block, no
// acceptable candidate, no items), runs it once more: such a failure is intermittent (about
// 1 in 30 image replies) and a second call usually succeeds. Never retried: an API error
// (the SDK already retries transport errors), a reply cut by max_tokens and a refusal (both
// would only repeat). At most one retry, so two calls per request; a second failure propagates as is.
// The limiters count requests, not calls, so a retry doubles the cost of that one request.
// The log line carries only the failure kind, never reply text.
async function withParseRetry(tag, attempt) {
  try {
    return await attempt();
  } catch (err) {
    if (!(err instanceof AnalysisParseError) || err.stopReason === 'max_tokens' || err.stopReason === 'refusal') throw err;
    console.warn(`[${tag}] unparseable reply, retrying once (${err.kind})`);
    return attempt();
  }
}

// What counts as the answer among the JSON candidates of a reply (aiReply.extractJson);
// anything else is skipped, so prose such as {"a":1}, a leading [] or an echoed template
// before the real answer does not hide it, and a reply that is only those is a 502.
// The image answer: a non-empty items array of objects, and neither the template's name nor its items.
const isImageAnswer = (o) => Array.isArray(o.items) && o.items.length > 0 && o.items.every(isPlainObject)
  && o.dish_name !== IMAGE_REPLY_TEMPLATE.dish_name
  && !isDeepStrictEqual(o.items, IMAGE_REPLY_TEMPLATE.items);
// The text answer: a non-empty array of objects (so a "[1]" in prose or in an earlier field
// is skipped) that is not the template.
const isTextAnswer = (a) => a.length > 0 && a.every(isPlainObject) && !isDeepStrictEqual(a, TEXT_REPLY_TEMPLATE);

const sumItems =(items) => items.reduce((acc, item) => ({
  calories: acc.calories + (Number(item.calories) || 0),
  protein_g: acc.protein_g + (Number(item.protein_g) || 0),
  carbs_g: acc.carbs_g + (Number(item.carbs_g) || 0),
  fat_g: acc.fat_g + (Number(item.fat_g) || 0),
  fiber_g: acc.fiber_g + (Number(item.fiber_g) || 0),
}), { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 });

// Makes the numbers of the items consistent (nutrition.js) and logs, when anything changed,
// one numbers-only line (adjusted items, the calories change and the rule ids with their
// counts, sorted): never any meal text, name or identifier. Returns the checked items.
function checkItems(tag, items) {
  const { items: checked, report } = reconcileItems(items);
  if (report.adjusted > 0) {
    const rules = Object.keys(report.rules).sort().map((id) => `${id}:${report.rules[id]}`).join(',');
    console.info(`[${tag}] sanity adjusted=${report.adjusted} calories_delta=${report.calories_delta} rules=${rules}`);
  }
  return checked;
}

// The items of the reply for the receipt in the UI: name and calories only, never a weight or
// volume (grams of components are never shown to users). Built from the checked items (calories
// after the sanity rules), in model order, at most MAX_REPLY_ITEMS. The name goes through
// cleanDishName (Hebrew only), is cut to MAX_ITEM_NAME_CHARS, and one without a Hebrew letter
// becomes the neutral label. Calories are rounded integers, never negative. The names are
// returned, never logged.
const MAX_REPLY_ITEMS = 8;
const MAX_ITEM_NAME_CHARS = 40;
const DEFAULT_ITEM_NAME = 'פריט';
function replyItems(checked) {
  return checked.slice(0, MAX_REPLY_ITEMS).map((item) => {
    const name = cleanDishName(item.name).slice(0, MAX_ITEM_NAME_CHARS).trim();
    const calories = Math.round(Number(item.calories));
    return {
      name: /[א-ת]/.test(name) ? name : DEFAULT_ITEM_NAME,
      calories: Number.isFinite(calories) && calories > 0 ? calories : 0,
    };
  });
}

// ─── Analyze food image ───────────────────────────────────────────────────────
// `model` is the configured image model (config.imageModel) in production; without it the
// request goes to MODEL. `temperature` defaults to temperatureFor(model); an explicit value
// wins (the evaluation tool): null omits the field, a number from 0 to 1 is sent.
// `effort` (config.imageEffort in production) goes through requestOptionsFor(model, effort):
// undefined is the default (low), null omits the Sonnet 5 / Haiku 5 effort fields.
// `repairModel` (config.textModel in production, default MODEL) is the model of the name-repair call.
// `prompts` ({ system, user }) replaces IMAGE_SYSTEM_PROMPT and IMAGE_USER_MESSAGE; it is for
// the evaluation tool only and production never passes it.
async function analyzeImage(anthropic, { imageBase64, mimeType, model = MODEL, temperature, effort, prompts, repairModel = MODEL }) {
  if (typeof model !== 'string' || !model.trim()) throw new TypeError('model must be a non-empty string');
  if (temperature === undefined) temperature = temperatureFor(model);
  if (temperature !== null && !(typeof temperature === 'number' && Number.isFinite(temperature) && temperature >= 0 && temperature <= 1)) {
    throw new TypeError('temperature must be null or a finite number from 0 to 1');
  }
  const systemPrompt = prompts?.system ?? IMAGE_SYSTEM_PROMPT;
  const userMessage = prompts?.user ?? IMAGE_USER_MESSAGE;
  const options = requestOptionsFor(model, effort);
  // The reply describes the user's meal (visual_description, scale_reference, draft_name),
  // so it is never logged (see parseReply).
  const parsed = await withParseRetry('analyze', async () => {
    const message = await callModel(anthropic, 'analyze', 'image', {
      model,
      max_tokens: maxTokensFor(model),
      ...(temperature === null ? {} : { temperature }),
      ...options,
      system: systemPrompt,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mimeType, data: imageBase64 }
          },
          { type: 'text', text: userMessage }
        ]
      }]
    });
    const { value, fail } = parseReply(message, 'object', 'analyze', isImageAnswer);
    if (!Array.isArray(value.items) || value.items.length === 0) fail('no items');
    return value;
  });
  const items = parsed.items;
  // visual_description, scale_reference and draft_name are only the model's recognition,
  // scale and first attempt: they are never read here, so they are not returned, stored or
  // logged. Item names are cleaned here, and replyItems returns name and calories of the
  // checked items (nothing else of them); dish_name (the checked final name) goes through
  // the guard as is (missing or of any type it becomes the default name).
  items.forEach(item => { item.name = cleanDishName(item.name); });
  const checked = checkItems('analyze', items);
  const totals = sumItems(checked);
  const { name: foodName } = await ensureHebrewDishName(anthropic, parsed.dish_name, { model: repairModel });
  return { foodName, ...totals, items: replyItems(checked) };
}

// ─── Analyze food text ────────────────────────────────────────────────────────
// `model` is the configured text model (config.textModel in production, TEXT_MODEL); without
// it the request goes to MODEL. The name-repair call uses the same model. Request rules:
// modelRules.js (Haiku 4.5: temperature 0, max_tokens 1200; Haiku 5: no temperature, effort low).
async function analyzeText(anthropic, text, { model = MODEL } = {}) {
  if (typeof model !== 'string' || !model.trim()) throw new TypeError('model must be a non-empty string');
  const temperature = temperatureFor(model);
  const items = await withParseRetry('analyze-text', async () => {
    const message = await callModel(anthropic, 'analyze-text', 'text', {
      model,
      max_tokens: textMaxTokensFor(model),
      ...(temperature === null ? {} : { temperature }),
      ...textRequestOptionsFor(model),
      system: TEXT_SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: `זהה כל מאכל בטקסט וחשב ערכים תזונתיים מדויקים.\nהחזר JSON array בלבד, ללא markdown, ללא הסבר:\n${JSON.stringify(TEXT_REPLY_TEMPLATE)}\nכל הערכים מספרים. weight_g חובה — קבע אותו קודם כל.\n\nהטקסט: ${text.trim()}`
      }]
    });
    const { value, fail } = parseReply(message, 'array', 'analyze-text', isTextAnswer);
    if (value.length === 0) fail('no items');
    return value;
  });
  const checked = checkItems('analyze-text', items);
  const totals = sumItems(checked);
  // The shown name is what the user typed: only non-Hebrew letters are translated, the
  // rest (punctuation, emoji, digits) stays; no word limit, at most the food-name limit
  // of 200 characters, and a text without letters (such as "100") stays as typed.
  const { name: foodName } = await ensureHebrewDishName(anthropic, text.trim(), { mode: 'userText', maxWords: Infinity, maxChars: 200, requireHebrewLetter: false, model });
  return { foodName, ...totals, items: replyItems(checked) };
}

module.exports = {
  IMAGE_SYSTEM_PROMPT,
  IMAGE_USER_MESSAGE,
  TEXT_SYSTEM_PROMPT,
  AnalysisParseError,
  analyzeImage,
  analyzeText,
  isImageAnswer,
  temperatureFor,
  maxTokensFor,
  textMaxTokensFor,
  requestOptionsFor,
  textRequestOptionsFor,
};
