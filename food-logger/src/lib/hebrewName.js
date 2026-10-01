'use strict';

// Guard for every food name that reaches the user: detect foreign script,
// repair it with one small AI call only when needed, otherwise clean carefully
// (removing a foreign character together with the whole word it touches) and,
// as a last resort, use a neutral default. Never throws on a bad name.
//
// Two modes. 'dish' (default) is for AI dish names and is strict: the allowed set
// below, at most eight words and 70 characters. 'userText' is for text the user typed: it is shown as
// typed, only letters of a non-Hebrew script and unsafe invisible characters count
// as foreign (emoji, punctuation, symbols and digits are kept), the repair is a
// translation that must keep every other word, and there is no word limit.

const { MODEL } = require('./anthropic');

const DEFAULT_DISH_NAME = 'מנה';
const REPAIR_PROMPT_PREFIX = 'You are a Hebrew food-name editor.';
const REPAIR_SYSTEM_PROMPT = `${REPAIR_PROMPT_PREFIX} You receive a food or dish name that contains characters that are not Hebrew letters. ` +
  'Rewrite it using Hebrew letters only, as the everyday name an average Israeli would say for this food. ' +
  'Do not transliterate letter by letter when Israelis use a different common name. ' +
  'Keep it short (about five words). Output only the name: no quotes, no explanation, no other language.';
const REPAIR_TEXT_SYSTEM_PROMPT = `${REPAIR_PROMPT_PREFIX} You receive a short text in which a person describes what they ate. ` +
  'Some words in it are not in Hebrew. Translate every non-Hebrew word into Hebrew, using the everyday name an average Israeli would say. ' +
  'Keep all other words, numbers and punctuation exactly as they are. Do not shorten, summarise or reorder the text. ' +
  'Output only the text: no quotes, no explanation.';

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

// userText mode. Foreign = a letter outside the Hebrew block, or a character that
// cannot be shown safely: controls, soft hyphen, zero-width, bidi and BOM, line and
// paragraph separators, lone surrogates. (A zero-width joiner between two emoji is
// part of the emoji and is kept.) Non-ASCII spaces are whitespace and are normalised.
const FOREIGN_LETTER = /(?![֐-׿])\p{L}/u;
const UNSAFE_SRC = '[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F-\\u009F\\u00AD\\u180E\\u200B-\\u200F\\u2028\\u2029\\u202A-\\u202E\\u2060-\\u206F\\uFEFF\\uD800-\\uDFFF]';
const UNSAFE_OR_JOINER = new RegExp(`((?<=\\p{Extended_Pictographic}\\uFE0F?)\\u200D(?=\\p{Extended_Pictographic}))|${UNSAFE_SRC}`, 'gu');
const SPACES = /[ \t\r\n   -   　]+/g;
const stripUnsafe = (s) => s.replace(UNSAFE_OR_JOINER, (m, joiner) => (joiner ? m : ''));
const hasForeignText = (s) => FOREIGN_LETTER.test(s) || stripUnsafe(s) !== s;
const normalizeSpaces = (s) => s.replace(SPACES, ' ').trim();
const keyOf = (w) => w.replace(/[^\p{L}\p{N}]/gu, '');

const MAX_INPUT_CHARS = 500; // anything longer is cut before any processing
const MAX_LOG_CHARS = 80;
const WS = new Set([' ', '\t', '\r', '\n']);
// Stray punctuation at an edge (a closing bracket can only be stray at the
// start, an opening one only at the end; a trailing % is meaningful).
const STRAY = "-\u2013\u2014'\"\u2019\u201C\u201D,.:;/+&";
const STRAY_START = new Set([...STRAY, ')']);
const STRAY_END = new Set([...STRAY, '(']);
const CONNECTORS = ['עם', 'של', 'על', 'את', 'או'];
const HAS_QUOTE_EDGE = /^["'“”‘’״]|["'“”‘’״]$/;
const QUOTE_EDGES = /^["'\u201C\u201D\u2018\u2019\u05F4]+|["'\u201C\u201D\u2018\u2019\u05F4]+$/g;

const words = (s) => s.split(/[ \t\r\n]+/).filter(Boolean);

function findForeignScript(name) {
  return typeof name === 'string' && FOREIGN_CHAR.test(name);
}

// Strict dish-mode limits. The prompt asks for about five words; the guard leaves
// room above that so a valid name is never cut in the middle of a phrase.
const DISH_MAX_WORDS = 8;
const DISH_MAX_CHARS = 70;

function isValidDishName(name, { maxWords = DISH_MAX_WORDS, maxChars = DISH_MAX_CHARS, requireHebrewLetter = true } = {}) {
  if (typeof name !== 'string') return false;
  const trimmed = name.trim();
  if (!trimmed || CONTROL_CHAR.test(trimmed)) return false;
  // By default a name of only punctuation, digits and whitespace is not a dish name.
  if (requireHebrewLetter && !HEBREW_LETTER.test(trimmed)) return false;
  return trimmed.length <= maxChars && words(trimmed).length <= maxWords;
}

// Strip stray punctuation and dangling connector words at both ends until
// stable. Index-based, so it is linear in the input length.
function trimEdges(s, punctuation = true) {
  let start = 0;
  let end = s.length;
  for (let changed = true; changed;) {
    changed = false;
    while (start < end && (WS.has(s[start]) || (punctuation && STRAY_START.has(s[start])))) { start++; changed = true; }
    while (end > start && (WS.has(s[end - 1]) || (punctuation && STRAY_END.has(s[end - 1])))) { end--; changed = true; }
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
function shortenName(clean, { maxWords, maxChars, punctuation = true }) {
  let out = '';
  for (const w of words(clean).slice(0, maxWords)) {
    const next = out ? `${out} ${w}` : w;
    if (next.length > maxChars) {
      if (!out) out = w.slice(0, maxChars);
      break;
    }
    out = next;
  }
  return trimEdges(out, punctuation);
}

// userText: drop unsafe characters and only the words that contain foreign letters;
// emoji, punctuation and every other word stay. Only dangling connectors are trimmed.
function cleanUserText(name) {
  const visible = stripUnsafe(normalizeSpaces(name.slice(0, MAX_INPUT_CHARS)));
  return trimEdges(words(visible).filter((w) => !FOREIGN_LETTER.test(w)).join(' '), false);
}

// A translation must keep every word that was not foreign; a summary is refused.
function keepsTheOtherWords(original, repaired) {
  const have = new Set(words(repaired).map(keyOf));
  return words(original).filter((w) => !FOREIGN_LETTER.test(w)).map(keyOf).every((k) => !k || have.has(k));
}

// One small repair call. Any failure or malformed reply is "no repair" (null).
async function repairName(anthropic, name, userText) {
  try {
    const res = await anthropic.messages.create({
      model: MODEL,
      max_tokens: userText ? 400 : 40,
      temperature: 0,
      system: userText ? REPAIR_TEXT_SYSTEM_PROMPT : REPAIR_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: name }],
    });
    const text = res?.content?.[0]?.text;
    if (typeof text !== 'string') return null;
    const line = text.trim().split(/\r?\n/)[0].trim();
    if (userText) return normalizeSpaces(HAS_QUOTE_EDGE.test(name) ? line : line.replace(QUOTE_EDGES, ''));
    return trimEdges(words(line.replace(QUOTE_EDGES, '')).join(' '));
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
  const { maxWords = DISH_MAX_WORDS, maxChars = DISH_MAX_CHARS, requireHebrewLetter = true, mode = 'dish', log = console.warn } = options;
  const userText = mode === 'userText';
  const limits = { maxWords, maxChars, requireHebrewLetter, punctuation: !userText };
  const finish = (result) => {
    if (result.action !== 'ok') log(logLine(result.action, original));
    return result;
  };

  if (typeof original !== 'string' || !original.trim()) return finish({ name: DEFAULT_DISH_NAME, action: 'fallback' });
  const name = original.slice(0, MAX_INPUT_CHARS);
  const foreign = userText ? hasForeignText(name) : findForeignScript(name);
  // Whitespace runs are normalised silently in userText; in dish mode they make it "cleaned".
  const tidy = userText ? normalizeSpaces(name) : words(name).join(' ');

  // Unchanged only when nothing was cut and the name is already normalised.
  if (!foreign && name === original && (userText || name === tidy) && isValidDishName(tidy, limits)) {
    return { name: tidy, action: 'ok' };
  }

  // Ask the AI only when there is foreign script and something recoverable in it.
  if (userText ? FOREIGN_LETTER.test(name) : foreign && RECOVERABLE.test(name)) {
    const source = userText ? stripUnsafe(tidy) : name;
    const repaired = await repairName(anthropic, source, userText);
    const accepted = userText
      ? repaired && !hasForeignText(repaired) && keepsTheOtherWords(source, repaired)
      : repaired && !findForeignScript(repaired);
    if (accepted && isValidDishName(repaired, limits)) return finish({ name: repaired, action: 'repaired' });
  }

  // Too long but otherwise clean Hebrew is shortened, never replaced by the default.
  const cleaned = userText ? cleanUserText(name) : cleanDishName(name);
  const candidate = isValidDishName(cleaned, limits) ? cleaned : shortenName(cleaned, limits);
  if (isValidDishName(candidate, limits)) return finish({ name: candidate, action: 'cleaned' });
  return finish({ name: DEFAULT_DISH_NAME, action: 'fallback' });
}

module.exports = {
  REPAIR_SYSTEM_PROMPT,
  REPAIR_TEXT_SYSTEM_PROMPT,
  REPAIR_PROMPT_PREFIX,
  DEFAULT_DISH_NAME,
  DISH_MAX_WORDS,
  findForeignScript,
  isValidDishName,
  cleanDishName,
  ensureHebrewDishName,
};
