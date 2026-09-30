'use strict';

// Guard for every food name that reaches the user: detect foreign script,
// repair it with one small AI call only when needed, otherwise clean carefully
// (removing a foreign character together with the whole word it touches) and,
// as a last resort, use a neutral default. Never throws on a bad name.

const { MODEL } = require('./anthropic');

const DEFAULT_DISH_NAME = 'מנה';
const REPAIR_PROMPT_PREFIX = 'You are a Hebrew food-name editor.';
const REPAIR_SYSTEM_PROMPT = `${REPAIR_PROMPT_PREFIX} You receive a food or dish name that contains characters that are not Hebrew letters. ` +
  'Rewrite it using Hebrew letters only, as the everyday name an average Israeli would say for this food. ' +
  'Do not transliterate letter by letter when Israelis use a different common name. ' +
  'Keep it short (at most six words). Output only the name: no quotes, no explanation, no other language.';

// The one definition of the allowed set: Hebrew block (letters, final forms,
// nikud, geresh, gershayim), ASCII digits, whitespace and - – — ' " ’ “ ” ( ) , . / + & % : ;
// Anything else (emoji, Latin, CJK, Arabic, Cyrillic, control characters) is foreign.
const FOREIGN_CHAR = /[^֐-׿0-9\s\-–—'"’“”(),.\/+&%:;]/u;
const HEBREW_LETTER = /[א-ת]/;
const CONTROL_CHAR = /[\u0000-\u001F\u007F-\u009F]/;

// Stray punctuation at an edge (a closing bracket can only be stray at the
// start, an opening one only at the end; a trailing % is meaningful).
const STRAY_START = /^[\s\-–—'"’“”,.\/+&:;)]+/;
const STRAY_END = /[\s\-–—'"’“”,.\/+&:;(]+$/;
const CONNECTOR_START = /^(?:עם|של|על|את|או)(?=\s|$)/;
const CONNECTOR_END = /(?:^|\s)(?:עם|של|על|את|או)$/;
const QUOTE_EDGES = /^["'“”‘’״]+|["'“”‘’״]+$/g;

const words = (s) => s.split(/\s+/).filter(Boolean);

function findForeignScript(name) {
  return typeof name === 'string' && FOREIGN_CHAR.test(name);
}

function isValidDishName(name, { maxWords = 6, maxChars = 60 } = {}) {
  if (typeof name !== 'string') return false;
  const trimmed = name.trim();
  if (!trimmed || CONTROL_CHAR.test(trimmed)) return false;
  // A name of only punctuation, digits and whitespace is not a dish name.
  if (!HEBREW_LETTER.test(trimmed)) return false;
  return trimmed.length <= maxChars && words(trimmed).length <= maxWords;
}

// Strip stray punctuation and dangling connector words at both ends until stable.
function trimEdges(s) {
  let prev;
  do {
    prev = s;
    s = s.replace(STRAY_START, '').replace(STRAY_END, '')
      .replace(CONNECTOR_START, '').replace(CONNECTOR_END, '');
  } while (s !== prev);
  return s;
}

function cleanDishName(name) {
  if (typeof name !== 'string') return '';
  return trimEdges(words(name).filter((w) => !FOREIGN_CHAR.test(w)).join(' '));
}

// Keep the first maxWords words and at most maxChars characters, cut at a
// word boundary, then drop a connector left dangling by the cut.
function shortenName(clean, { maxWords, maxChars }) {
  let out = '';
  for (const w of words(clean).slice(0, maxWords)) {
    const next = out ? `${out} ${w}` : w;
    if (next.length > maxChars) {
      if (!out) out = w.slice(0, maxChars);
      break;
    }
    out = next;
  }
  return trimEdges(out);
}

// One small repair call. Any failure or malformed reply is "no repair" (null).
async function repairName(anthropic, name) {
  try {
    const res = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 40,
      temperature: 0,
      system: REPAIR_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: name }],
    });
    const text = res?.content?.[0]?.text;
    if (typeof text !== 'string') return null;
    return text.trim().split(/\r?\n/)[0].trim().replace(QUOTE_EDGES, '').trim();
  } catch {
    return null;
  }
}

async function ensureHebrewDishName(anthropic, name, options = {}) {
  const { maxWords = 6, maxChars = 60, log = console.warn } = options;
  const limits = { maxWords, maxChars };
  const finish = (result) => {
    if (result.action !== 'ok') log(`hebrewName ${result.action}: ${JSON.stringify(name)}`);
    return result;
  };

  // Nothing to recover from an empty name or one with no letters at all (punctuation, digits, emoji only).
  if (typeof name !== 'string' || !/\p{L}/u.test(name)) return finish({ name: DEFAULT_DISH_NAME, action: 'fallback' });
  const foreign = findForeignScript(name);
  if (!foreign && isValidDishName(name, limits)) return { name, action: 'ok' };

  if (foreign) {
    const repaired = await repairName(anthropic, name);
    if (repaired !== null && !findForeignScript(repaired) && isValidDishName(repaired, limits)) {
      return finish({ name: repaired, action: 'repaired' });
    }
  }

  // Too long but otherwise clean Hebrew is shortened, never replaced by the default.
  const cleaned = cleanDishName(name);
  const candidate = isValidDishName(cleaned, limits) ? cleaned : shortenName(cleaned, limits);
  if (isValidDishName(candidate, limits)) return finish({ name: candidate, action: 'cleaned' });
  return finish({ name: DEFAULT_DISH_NAME, action: 'fallback' });
}

module.exports = {
  REPAIR_SYSTEM_PROMPT,
  REPAIR_PROMPT_PREFIX,
  DEFAULT_DISH_NAME,
  findForeignScript,
  isValidDishName,
  cleanDishName,
  ensureHebrewDishName,
};
