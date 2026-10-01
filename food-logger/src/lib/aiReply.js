'use strict';

// Reading a Messages API reply: the text of its text blocks and a JSON object or array in
// that text. Nothing here logs: the callers decide what is safe to log (never the text).

const isTextBlock = (block) => block !== null && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string';

// The reply text: the first text block (type 'text' with a string `text`) joined with the
// text blocks that directly follow it, or null when the reply has no text block (only
// thinking or tool_use blocks, an empty or missing content array).
function replyText(message) {
  const content = Array.isArray(message?.content) ? message.content : [];
  const start = content.findIndex(isTextBlock);
  if (start < 0) return null;
  let text = '';
  for (let i = start; i < content.length && isTextBlock(content[i]); i++) text += content[i].text;
  return text;
}

// The block types of a reply, safe to log: API enum values (text, thinking, tool_use, ...)
// as they are, anything else as "unknown", at most 10 of them.
function blockTypes(message) {
  const content = Array.isArray(message?.content) ? message.content : null;
  if (!content) return 'missing';
  if (content.length === 0) return 'none';
  const types = content.slice(0, 10).map((b) => (typeof b?.type === 'string' && /^[a-z_]{1,32}$/.test(b.type) ? b.type : 'unknown'));
  return types.join(',') + (content.length > 10 ? `,+${content.length - 10}` : '');
}

// stop_reason is an API enum (end_turn, max_tokens, ...); anything else is not logged as is.
function stopReasonOf(message) {
  const r = message?.stop_reason;
  return typeof r === 'string' && /^[a-z_]{1,32}$/.test(r) ? r : 'unknown';
}

// A whole reply wrapped in a markdown code fence (```json ... ``` or ``` ... ```).
const FENCE = /^```[A-Za-z]*[ \t]*\r?\n([\s\S]*?)\r?\n?```$/;

const PAIRS = { object: ['{', '}'], array: ['[', ']'] };
const isKind = (value, kind) => (kind === 'array'
  ? Array.isArray(value)
  : value !== null && typeof value === 'object' && !Array.isArray(value));

// The end index (exclusive) of the balanced span that opens at text[start], skipping
// JSON strings (with their escapes), or -1 when the text ends first (a truncated reply).
function balancedEnd(text, start, open, close) {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
    } else if (ch === open) {
      depth++;
    } else if (ch === close) {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

const tryParse = (s) => {
  try {
    return { ok: true, value: JSON.parse(s) };
  } catch {
    return { ok: false };
  }
};

// The JSON object (kind 'object') or array (kind 'array') in a reply text:
//   1. the whole trimmed text, after stripping a code fence around all of it;
//   2. else the first balanced top-level {...} / [...] span (string- and escape-aware)
//      that parses as that kind; a span that does not parse is skipped as a whole (it is
//      prose such as "{roughly}"), and an unbalanced span ends the search (truncated).
// The search never restarts inside a span: in a truncated reply an inner piece (one item,
// or an array inside a string) must not pass for the whole answer.
// Returns { value } or { error } with error 'no JSON <kind> found' (no candidate span at
// all) or 'JSON parse error' (candidates, none valid). The error never quotes the text.
// `accept` (optional) narrows what counts as the answer: a candidate of the right kind
// that fails it is skipped like one that does not parse.
function extractJson(text, kind, accept = () => true) {
  const [open, close] = PAIRS[kind];
  let body = text.trim();
  const fenced = FENCE.exec(body);
  if (fenced) body = fenced[1].trim();
  const whole = tryParse(body);
  if (whole.ok && isKind(whole.value, kind) && accept(whole.value)) return { value: whole.value };

  let candidates = 0;
  let from = 0;
  for (;;) {
    const start = body.indexOf(open, from);
    if (start < 0) break;
    candidates++;
    const end = balancedEnd(body, start, open, close);
    if (end < 0) break;
    const span = tryParse(body.slice(start, end));
    if (span.ok && isKind(span.value, kind) && accept(span.value)) return { value: span.value };
    from = end;
  }
  return { error: candidates ? 'JSON parse error' : `no JSON ${kind} found` };
}

module.exports = { replyText, blockTypes, stopReasonOf, extractJson, isPlainObject: (v) => isKind(v, 'object') };
