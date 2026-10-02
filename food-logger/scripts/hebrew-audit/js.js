'use strict';

// A small JavaScript tokenizer that finds string literals, template literals (with nested
// `${}` expressions, which may hold further literals), comments and regular-expression
// literals. It understands just enough of the language for that: quotes and escapes,
// `//` and `/* */` comments, and the regex-versus-division choice (by the previous token).
// No dependencies; it is an audit tool, not a parser.

const HEBREW = /[֐-׿]/;
const REGEX_AFTER_WORD = new Set(['return', 'typeof', 'case', 'in', 'of', 'delete', 'void', 'throw', 'else', 'do']);
const REGEX_AFTER_PUNCT = new Set('(,=:[!&|?{};+-*%<>~^'.split(''));

function tokenize(src) {
  const nl = [];
  for (let i = 0; i < src.length; i++) if (src[i] === '\n') nl.push(i);
  const lineOf = (idx) => {
    let lo = 0, hi = nl.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (nl[mid] < idx) lo = mid + 1; else hi = mid; }
    return lo + 1;
  };
  const out = { literals: [], comments: [], regexes: [] };

  function scanTemplate(start) {
    const parts = [];
    const exprs = [];
    let cur = '';
    let i = start + 1;
    while (i < src.length) {
      const c = src[i];
      if (c === '\\') { cur += src.slice(i, i + 2); i += 2; continue; }
      if (c === '`') { i++; break; }
      if (c === '$' && src[i + 1] === '{') {
        parts.push(cur); cur = '';
        const close = scanCode(i + 2, true);
        exprs.push(src.slice(i + 2, close));
        i = close + 1;
        continue;
      }
      cur += c; i++;
    }
    parts.push(cur);
    out.literals.push({ kind: 'template', start, end: i, startLine: lineOf(start), endLine: lineOf(i - 1), parts, exprs });
    return i;
  }

  function scanRegex(start) {
    let i = start + 1, inClass = false;
    while (i < src.length && src[i] !== '\n') {
      const c = src[i];
      if (c === '\\') { i += 2; continue; }
      if (c === '[') inClass = true;
      else if (c === ']') inClass = false;
      else if (c === '/' && !inClass) { i++; break; }
      i++;
    }
    while (/[a-z]/i.test(src[i] || '')) i++;
    out.regexes.push({ startLine: lineOf(start), endLine: lineOf(i - 1), text: src.slice(start, i) });
    return i;
  }

  // Scans code from `i`. With endOnBrace it returns the index of the `}` that closes the
  // enclosing `${`; otherwise it runs to the end of the source.
  function scanCode(i, endOnBrace) {
    let depth = 0;
    let prev = '';
    while (i < src.length) {
      const c = src[i];
      if (/\s/.test(c)) { i++; continue; }
      if (c === '/' && src[i + 1] === '/') {
        const e = src.indexOf('\n', i);
        const end = e === -1 ? src.length : e;
        out.comments.push({ startLine: lineOf(i), endLine: lineOf(i), text: src.slice(i, end) });
        i = end; continue;
      }
      if (c === '/' && src[i + 1] === '*') {
        const e = src.indexOf('*/', i + 2);
        const end = e === -1 ? src.length : e + 2;
        out.comments.push({ startLine: lineOf(i), endLine: lineOf(end - 1), text: src.slice(i, end) });
        i = end; continue;
      }
      if (c === '"' || c === "'") {
        let j = i + 1;
        while (j < src.length && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
        out.literals.push({ kind: 'string', start: i, end: j + 1, startLine: lineOf(i), endLine: lineOf(j), raw: src.slice(i + 1, j) });
        i = j + 1; prev = 'str'; continue;
      }
      if (c === '`') { i = scanTemplate(i); prev = 'str'; continue; }
      if (c === '{') { depth++; prev = c; i++; continue; }
      if (c === '}') {
        if (endOnBrace && depth === 0) return i;
        depth--; prev = c; i++; continue;
      }
      if (c === '/') {
        const isRegex = prev === '' || REGEX_AFTER_PUNCT.has(prev) || REGEX_AFTER_WORD.has(prev);
        if (isRegex) { i = scanRegex(i); prev = 'regex'; continue; }
        prev = c; i++; continue;
      }
      if (/[\w$֐-׿]/.test(c)) {
        let j = i;
        while (j < src.length && /[\w$֐-׿]/.test(src[j])) j++;
        prev = src.slice(i, j); i = j; continue;
      }
      prev = c; i++;
    }
    return i;
  }

  scanCode(0, false);
  out.literals.sort((a, b) => a.start - b.start);
  return out;
}

// The text of a literal as the reader of the audit should see it. A template keeps its
// fixed parts; each `${expr}` becomes `${expr}` when the expression is a plain name or
// member access, and `${…}` otherwise. A private marker \u0001 is added per newline inside
// an expression, so line numbers computed from the body still match the source.
function bodyOf(lit) {
  if (lit.kind === 'string') return decodeEscapes(lit.raw);
  let out = lit.parts[0];
  lit.exprs.forEach((expr, i) => {
    const simple = /^[\w$.?]+$/.test(expr.trim());
    out += (simple ? `\${${expr.trim()}}` : '${…}') + '\u0001'.repeat((expr.match(/\n/g) || []).length) + lit.parts[i + 1];
  });
  return decodeEscapes(out);
}

// Quotes, unicode and hex escapes become the characters they stand for. \n and \t stay
// visible as written (a newline inside a table cell would break the table).
function decodeEscapes(s) {
  return s.replace(/\\(u\{([0-9a-fA-F]+)\}|u([0-9a-fA-F]{4})|x([0-9a-fA-F]{2})|([\s\S]))/g, (m, _all, cp, u4, x2, ch) => {
    if (cp) return String.fromCodePoint(parseInt(cp, 16));
    if (u4) return String.fromCharCode(parseInt(u4, 16));
    if (x2) return String.fromCharCode(parseInt(x2, 16));
    if (ch === 'n' || ch === 't' || ch === 'r') return `\\${ch}`;
    return ch;
  });
}

module.exports = { tokenize, bodyOf, decodeEscapes, HEBREW };
