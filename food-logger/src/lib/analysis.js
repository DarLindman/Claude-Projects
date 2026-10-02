'use strict';

const { isDeepStrictEqual } = require('node:util');
const { MODEL } = require('./anthropic');
const { ensureHebrewDishName, cleanDishName } = require('./hebrewName');
const {
  IMAGE_SYSTEM_PROMPT, IMAGE_USER_MESSAGE, TEXT_SYSTEM_PROMPT, IMAGE_REPLY_TEMPLATE, TEXT_REPLY_TEMPLATE,
} = require('./prompts');
const { replyText, blockTypes, stopReasonOf, extractJson, isPlainObject } = require('./aiReply');

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

// The per-model request rules of the image analysis, in one place. Haiku (an id starting
// with claude-haiku) keeps its request exactly as it always was: temperature 0 and
// max_tokens 1500 (the items plus room for visual_description and draft_name). Every other
// model gets no temperature (null omits the field; newer models reject it with a 400,
// "temperature is deprecated for this model") and max_tokens 6000: Sonnet may write a
// thinking block first and its tokens count against max_tokens, which cut the JSON answer
// off at 1500. It is only a cap; what is billed is what the model writes.
const isHaiku = (model) => model.startsWith('claude-haiku');
const temperatureFor = (model) => (isHaiku(model) ? 0 : null);
const maxTokensFor = (model) => (isHaiku(model) ? 1500 : 6000);

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

// ─── Analyze food image ───────────────────────────────────────────────────────
// `model` is the configured image model (config.imageModel) in production; without it the
// request goes to MODEL. `temperature` defaults to temperatureFor(model); an explicit value
// wins (the evaluation tool): null omits the field, a number from 0 to 1 is sent.
async function analyzeImage(anthropic, { imageBase64, mimeType, model = MODEL, temperature }) {
  if (typeof model !== 'string' || !model.trim()) throw new TypeError('model must be a non-empty string');
  if (temperature === undefined) temperature = temperatureFor(model);
  if (temperature !== null && !(typeof temperature === 'number' && Number.isFinite(temperature) && temperature >= 0 && temperature <= 1)) {
    throw new TypeError('temperature must be null or a finite number from 0 to 1');
  }
  // The reply describes the user's meal (visual_description, draft_name), so it is never
  // logged (see parseReply).
  const parsed = await withParseRetry('analyze', async () => {
    const message = await callModel(anthropic, 'analyze', 'image', {
      model,
      max_tokens: maxTokensFor(model),
      ...(temperature === null ? {} : { temperature }),
      system: IMAGE_SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mimeType, data: imageBase64 }
          },
          { type: 'text', text: IMAGE_USER_MESSAGE }
        ]
      }]
    });
    const { value, fail } = parseReply(message, 'object', 'analyze', isImageAnswer);
    if (!Array.isArray(value.items) || value.items.length === 0) fail('no items');
    return value;
  });
  const items = parsed.items;
  // visual_description and draft_name are only the model's recognition and first attempt:
  // they are never read here, so they are not returned, stored or logged. Item names are
  // cleaned defensively but not returned; dish_name (the checked final name) goes through
  // the guard as is (missing or of any type it becomes the default name).
  items.forEach(item => { item.name = cleanDishName(item.name); });
  const totals = sumItems(items);
  const { name: foodName } = await ensureHebrewDishName(anthropic, parsed.dish_name, {});
  return { foodName, ...totals };
}

// ─── Analyze food text ────────────────────────────────────────────────────────
async function analyzeText(anthropic, text) {
  const items = await withParseRetry('analyze-text', async () => {
    const message = await callModel(anthropic, 'analyze-text', 'text', {
      model: MODEL,
      max_tokens: 1200,
      temperature: 0,
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
  const totals = sumItems(items);
  // The shown name is what the user typed: only non-Hebrew letters are translated, the
  // rest (punctuation, emoji, digits) stays; no word limit, at most the food-name limit
  // of 200 characters, and a text without letters (such as "100") stays as typed.
  const { name: foodName } = await ensureHebrewDishName(anthropic, text.trim(), { mode: 'userText', maxWords: Infinity, maxChars: 200, requireHebrewLetter: false });
  return { foodName, ...totals };
}

module.exports = {
  IMAGE_SYSTEM_PROMPT,
  IMAGE_USER_MESSAGE,
  TEXT_SYSTEM_PROMPT,
  AnalysisParseError,
  analyzeImage,
  analyzeText,
  temperatureFor,
  maxTokensFor,
};
