'use strict';

// Turns one source file into audit items: { text, where, line, endLine } (plus `kind`).
// Code comments are never items; they and regex literals are reported as excluded ranges
// so the accounting can show that no Hebrew line was silently skipped.

const { tokenize, bodyOf, HEBREW } = require('./js');
const { extractHtml } = require('./html');

const MARKUP = /<\/?[a-zA-Z][^>]*>/;

// A readable name for where a literal sits: the property key, a toast call, a
// `.textContent =` target, the variable it initialises, or the table it belongs to.
function keyFor(src, lit) {
  const lineStart = src.lastIndexOf('\n', lit.start - 1) + 1;
  const before = src.slice(lineStart, lit.start);
  let m = /(?:^|[,{(\s])(['"]?)([\w$.:-]+)\1\s*:\s*(?:[\w$]+\s*=>\s*)?$/.exec(before);
  if (m) return m[2];
  if (/showToast\(/.test(before)) return 'toast';
  m = /getElementById\(\s*['"]([\w-]+)['"]\s*\)\.(textContent|placeholder|value)\s*=/.exec(before);
  if (m) return `#${m[1]}.${m[2]}`;
  m = /([\w$]+)\.(textContent|placeholder|value)\s*=/.exec(before);
  if (m) return `${m[1]}.${m[2]}`;
  m = /\b(?:const|let|var)\s+([\w$]+)\s*=/.exec(before);
  if (m) return m[1];
  if (/^\s*\[\[/.test(before)) {
    const decl = [...src.slice(0, lit.start).matchAll(/\b(?:const|let|var)\s+([\w$]+)\s*=\s*\[/g)].pop();
    if (decl) return `${decl[1]} (keyword)`;
  }
  return '';
}

function collectJs(src) {
  const tok = tokenize(src);
  const items = [];
  for (const lit of tok.literals) {
    const body = bodyOf(lit);
    if (!HEBREW.test(body)) continue;
    if (MARKUP.test(body)) {
      for (const it of extractHtml(body, { baseLine: lit.startLine })) {
        items.push({ ...it, text: it.text, where: `${it.where}, in ${keyFor(src, lit) || 'a template'}` });
      }
    } else {
      items.push({
        text: body.replace(/\u0001/g, '').replace(/\s+/g, ' ').trim(),
        kind: lit.kind,
        where: keyFor(src, lit),
        line: lit.startLine,
        endLine: lit.endLine,
      });
    }
  }
  const comments = tok.comments.filter((c) => HEBREW.test(c.text));
  const regexes = tok.regexes.filter((r) => HEBREW.test(r.text));
  return { items, comments, regexes };
}

function collectHtml(src) {
  return { items: extractHtml(src), comments: htmlComments(src), regexes: [] };
}

// Hebrew inside <!-- --> comments (never items).
function htmlComments(src) {
  const out = [];
  for (const m of src.matchAll(/<!--[\s\S]*?-->/g)) {
    if (!HEBREW.test(m[0])) continue;
    const startLine = src.slice(0, m.index).split('\n').length;
    out.push({ startLine, endLine: startLine + (m[0].match(/\n/g) || []).length, text: m[0] });
  }
  return out;
}

function collect(type, src) {
  return type === 'html' ? collectHtml(src) : collectJs(src);
}

// Per-file accounting. `excluded` is a list of line ranges (AI prompts in a prompt file).
function account(src, result, excluded = []) {
  const lines = src.split('\n');
  const hebrewLines = [];
  lines.forEach((l, i) => { if (HEBREW.test(l)) hebrewLines.push(i + 1); });
  const inRanges = (n, ranges) => ranges.some((r) => n >= r.startLine && n <= r.endLine);
  const itemRanges = result.items.map((it) => ({ startLine: it.line, endLine: it.endLine }));
  let covered = 0, comment = 0, regex = 0, prompt = 0;
  const unaccounted = [];
  for (const n of hebrewLines) {
    if (inRanges(n, itemRanges)) covered++;
    else if (inRanges(n, excluded)) prompt++;
    else if (inRanges(n, result.comments)) comment++;
    else if (inRanges(n, result.regexes)) regex++;
    else unaccounted.push(n);
  }
  return { hebrewLines: hebrewLines.length, covered, comment, regex, prompt, unaccounted };
}

module.exports = { collect, collectJs, collectHtml, account, keyFor };
