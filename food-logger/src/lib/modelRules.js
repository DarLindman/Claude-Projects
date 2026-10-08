'use strict';

// The per-model-family request rules of every Messages API call the app makes (image analysis,
// text analysis, the name-repair call). Pure functions of the model id, in one place, so a new
// model family is one edit here. src/lib/analysis.js re-exports the image-side ones.
//
// Families:
//   - Haiku 1-4 (an id starting with claude-haiku that is not Haiku 5 or later, e.g.
//     claude-haiku-4-5-20251001): the request the app always sent: temperature 0 and the small
//     max_tokens caps below, no extra fields. Unchanged byte for byte.
//   - Haiku 5 and later (claude-haiku-5-5, ...): a non-default temperature is a 400, so none is
//     sent (and never top_p / top_k, an assistant prefill or thinking.budget_tokens). Adaptive
//     thinking is on by default and its tokens count against max_tokens, so the caps leave room
//     for it, and `output_config: { effort }` keeps it short. `thinking: { type: 'between_tools' }`
//     is NOT accepted by Haiku (Sonnet 5.5 only) and is never sent. A refusal has no
//     server-side fallback: the code never sends `fallbacks` and treats a refusal as an unusable reply.
//   - Sonnet 5 (claude-sonnet-5*): no temperature, thinking between_tools plus effort (below).
//   - Every other id (Opus, Fable, unknown): no temperature, max_tokens 6000, no extra fields.

const isHaiku5Plus = (model) => typeof model === 'string' && /^claude-haiku-(?:[5-9]|\d{2,})/.test(model);
const isLegacyHaiku = (model) => typeof model === 'string' && model.startsWith('claude-haiku') && !isHaiku5Plus(model);
const isSonnet5 = (model) => typeof model === 'string' && model.startsWith('claude-sonnet-5');

// max_tokens. Legacy Haiku: 1500 for the image analysis (the items plus room for
// visual_description, scale_reference and draft_name), 1200 for the text analysis, 40 / 400 for
// the name repair (a dish name / a user text). Haiku 5 and later: room for adaptive thinking
// at low effort (4000; name repair 2000, whatever the text). Other models: 6000 (name repair
// 2000 too: main only ever repaired names on Haiku 4.5, so there is no older behaviour to keep) (Sonnet can spend many thinking tokens, which count against
// the cap that once cut a JSON answer off at 1500; it is only a cap, what is billed is what the
// model writes).
const HAIKU_IMAGE_MAX_TOKENS = 1500;
const HAIKU_TEXT_MAX_TOKENS = 1200;
const HAIKU_REPAIR_MAX_TOKENS = 40;
const HAIKU_REPAIR_TEXT_MAX_TOKENS = 400;
const HAIKU5_MAX_TOKENS = 4000;
const HAIKU5_REPAIR_MAX_TOKENS = 2000;
const DEFAULT_MAX_TOKENS = 6000;

// The effort of the text route (text analysis and name repair): fixed, cheap structured JSON.
// IMAGE_EFFORT never affects it.
const TEXT_EFFORT = 'low';

const temperatureFor = (model) => (isLegacyHaiku(model) ? 0 : null);
const maxTokensFor = (model) => {
  if (isLegacyHaiku(model)) return HAIKU_IMAGE_MAX_TOKENS;
  return isHaiku5Plus(model) ? HAIKU5_MAX_TOKENS : DEFAULT_MAX_TOKENS;
};
const textMaxTokensFor = (model) => {
  if (isLegacyHaiku(model)) return HAIKU_TEXT_MAX_TOKENS;
  return isHaiku5Plus(model) ? HAIKU5_MAX_TOKENS : DEFAULT_MAX_TOKENS;
};
const repairMaxTokensFor = (model, userText) => {
  if (isLegacyHaiku(model)) return userText ? HAIKU_REPAIR_TEXT_MAX_TOKENS : HAIKU_REPAIR_MAX_TOKENS;
  return HAIKU5_REPAIR_MAX_TOKENS;
};

// Extra request fields. Sonnet 5.5 spends many hidden thinking tokens before answering (about
// 8-17 s per photo); `thinking: { type: 'between_tools' }` with `output_config: { effort }`
// (low, medium or high; GA, no beta header) cuts that. Haiku 5 and later get only
// `output_config: { effort }` (thinking stays at its adaptive default). Haiku 1-4, Opus and
// Fable reject these fields with a 400, so every other model gets {}. `effort` undefined
// means the default (low); null or 'off' sends nothing (the rollback, IMAGE_EFFORT=off).
// Never combined with `thinking: disabled` or `budget_tokens` (rejected by these models).
const EFFORTS = ['low', 'medium', 'high'];
function requestOptionsFor(model, effort) {
  const sonnet = isSonnet5(model);
  if (!sonnet && !isHaiku5Plus(model)) return {};
  if (effort === null || effort === 'off') return {};
  const level = effort === undefined ? 'low' : effort;
  if (!EFFORTS.includes(level)) throw new TypeError(`effort must be one of ${EFFORTS.join('|')}, off or null`);
  return sonnet
    ? { thinking: { type: 'between_tools' }, output_config: { effort: level } }
    : { output_config: { effort: level } };
}

// The same for the text route: the effort is the fixed TEXT_EFFORT, whatever IMAGE_EFFORT says.
const textRequestOptionsFor = (model) => requestOptionsFor(model, TEXT_EFFORT);

module.exports = {
  EFFORTS,
  TEXT_EFFORT,
  HAIKU5_MAX_TOKENS,
  HAIKU5_REPAIR_MAX_TOKENS,
  isHaiku5Plus,
  isLegacyHaiku,
  temperatureFor,
  maxTokensFor,
  textMaxTokensFor,
  repairMaxTokensFor,
  requestOptionsFor,
  textRequestOptionsFor,
};
