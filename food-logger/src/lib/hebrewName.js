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
// nikud, geresh, gershayim), ASCII digits, plain ASCII whitespace (space, tab,
// CR, LF; tab/newline are normalised away) and - – — ' " ’ “ ” ( ) , . / + & % : ;
// Anything else is foreign: emoji, Latin, CJK, Arabic, Cyrillic, control characters
// and every non-ASCII space or invisible character (NBSP, BOM, U+2028/2029, U+3000...).
const FOREIGN_CHAR = /[^\u0590-\u05FF0-9 \t\r\n\-\u2013\u2014'"\u2019\u201C\u201D(),.\/+&%:;]/u;
const HEBREW_LETTER = /[א-ת]/;
const CONTROL_CHAR = /[\u0000-\u001F\u007F-\u009F]/;
// Something worth asking the AI about: a letter of any script or an emoji.
const RECOVERABLE = /[\p{L}\p{Extended_Pictographic}]/u;

const MAX_INPUT_CHARS = 500; // anything longer is cut before any processing
const MAX_LOG_CHARS = 80;
const WS = new Set([' ', '\t', '\r', '\n']);
// Stray punctuation at an edge (a closing bracket can only be stray at the
// start, an opening one only at the end; a trailing % is meaningful).
const STRAY = "-\u2013\u2014'\"\u2019\u201C\u201D,.:;/+&";
const STRAY_START = new Set([...STRAY, ')']);
const STRAY_END = new Set([...STRAY, '(']);
const CONNECTORS = ['עם', 'של', 'על', 'את', 'או'];
const QUOTE_EDGES = /^["'\u201C\u201D\u2018\u2019\u05F4]+|["'\u201C\u201D\u2018\u2019\u05F4]+$/g;

const words = (s) => s.split(/[ \t\r\n]+/).filter(Boolean);

function findForeignScript(name) {
  return typeof name === 'string' && FOREIGN_CHAR.test(name);
}

function isValidDishName(name, { maxWords = 6, maxChars = 60, requireHebrewLetter = true } = {}) {
  if (typeof name !== 'string') return false;
  const trimmed = name.trim();
  if (!trimmed || CONTROL_CHAR.test(trimmed)) return false;
  // By default a name of only punctuation, digits and whitespace is not a dish name.
  if (requireHebrewLetter && !HEBREW_LETTER.test(trimmed)) return false;
  return trimmed.length <= maxChars && words(trimmed).length <= maxWords;
}

// Strip stray punctuation and dangling connector words at both ends until
// stable. Index-based, so it is linear in the input length.
function trimEdges(s) {
  let start = 0;
  let end = s.length;
  for (let changed = true; changed;) {
    changed = false;
    while (start < end && (WS.has(s[start]) || STRAY_START.has(s[start]))) { start++; changed = true; }
    while (end > start && (WS.has(s[end - 1]) || STRAY_END.has(s[end - 1]))) { end--; changed = true; }
    for (const c of CONNECTORS) {
      if (end - start >= 2 && s.startsWith(c, start) && (end - start === 2 || WS.has(s[start + 2]))) { start += 2; changed = true; break; }
    }
    for (const c of CONNECTORS) {
      if (end - start >= 2 && s.startsWith(c, end - 2) && (end - start === 2 || WS.has(s[end - 3]))) { end -= 2; changed = true; break; }
    }
  }
  return s.slice(start, end);
}

function cleanDishName(name) {
  if (typeof name !== 'string') return '';
  return trimEdges(words(name.slice(0, MAX_INPUT_CHARS)).filter((w) => !FOREIGN_CHAR.test(w)).join(' '));
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
    const line = text.trim().split(/\r?\n/)[0].trim().replace(QUOTE_EDGES, '');
    return trimEdges(words(line).join(' '));
  } catch {
    return null;
  }
}

// One log line per non-ok outcome: action plus the (cut, escaped) original name.
function logLine(action, name) {
  if (typeof name !== 'string') return `hebrewName ${action}: <${typeof name}>`;
  const shown = JSON.stringify(name.slice(0, MAX_LOG_CHARS)).replace(/[\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16)}`);
  return `hebrewName ${action}: ${shown}${name.length > MAX_LOG_CHARS ? '...' : ''}`;
}

async function ensureHebrewDishName(anthropic, original, options = {}) {
  const { maxWords = 6, maxChars = 60, requireHebrewLetter = true, log = console.warn } = options;
  const limits = { maxWords, maxChars, requireHebrewLetter };
  const finish = (result) => {
    if (result.action !== 'ok') log(logLine(result.action, original));
    return result;
  };

  if (typeof original !== 'string' || !original.trim()) return finish({ name: DEFAULT_DISH_NAME, action: 'fallback' });
  const name = original.slice(0, MAX_INPUT_CHARS);
  const foreign = findForeignScript(name);

  // Unchanged only when nothing was cut and the name is already normalised.
  if (!foreign && name === original && name === words(name).join(' ') && isValidDishName(name, limits)) {
    return { name, action: 'ok' };
  }

  // Ask the AI only when there is foreign script and something recoverable in it.
  if (foreign && RECOVERABLE.test(name)) {
    const repaired = await repairName(anthropic, name);
    if (repaired && !findForeignScript(repaired) && isValidDishName(repaired, limits)) {
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
