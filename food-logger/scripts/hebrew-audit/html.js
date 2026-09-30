'use strict';

// Hebrew text nodes and attribute values in a piece of HTML (a whole page, or the markup
// inside a JavaScript template). A regular expression over tags is enough here: comments,
// <script> and <style> blocks are skipped, entities are decoded, whitespace is collapsed.

const HEBREW = /[֐-׿]/;
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

const decodeEntities = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') {
    const cp = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(cp) && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
  }
  return NAMED[e.toLowerCase()] ?? m;
});

const TOKEN = /<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>|<(\/?)([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>|([^<]+|<)/g;
const ATTR = /([^\s=/"'<>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

// Lines are counted from `baseLine`; both \n and the private marker \u0001 (see js.js) count.
function extractHtml(src, { baseLine = 1 } = {}) {
  const items = [];
  // Incremental line lookup: the scan only moves forward, so count from the last position.
  let lastIdx = 0, lastLine = baseLine;
  const line = (idx) => {
    for (let i = lastIdx; i < idx; i++) if (src[i] === '\n' || src[i] === '\u0001') lastLine++;
    lastIdx = Math.max(lastIdx, idx);
    return lastLine;
  };
  const clean = (s) => s.replace(/\u0001/g, '');
  const stack = [];
  const labelOf = (el) => el.tag + (el.id ? `#${el.id}` : el.cls ? `.${el.cls}` : '');
  const contextOf = () => {
    const parent = stack[stack.length - 1];
    const anc = [...stack].reverse().find((e) => e.id);
    const label = parent ? labelOf(parent) : '(top level)';
    return anc && anc !== parent ? `${label} in #${anc.id}` : label;
  };

  TOKEN.lastIndex = 0;
  let m;
  while ((m = TOKEN.exec(src))) {
    const [whole, , closing, tag, attrs, text] = m;
    if (tag) {
      const name = tag.toLowerCase();
      if (closing) {
        for (let i = stack.length - 1; i >= 0; i--) if (stack[i].tag === name) { stack.length = i; break; }
        continue;
      }
      const el = { tag: name, id: '', cls: '' };
      const attrsOffset = m.index + whole.length - 1 - attrs.length;
      ATTR.lastIndex = 0;
      let a;
      while ((a = ATTR.exec(attrs))) {
        const aname = a[1].toLowerCase();
        const value = a[2] ?? a[3] ?? a[4] ?? '';
        if (aname === 'id') el.id = value;
        if (aname === 'class') el.cls = value.trim().split(/\s+/)[0] || '';
        const decoded = decodeEntities(value);
        if (HEBREW.test(decoded) && aname !== 'id' && aname !== 'class') {
          const at = line(attrsOffset + a.index);
          items.push({ text: clean(decoded).replace(/\s+/g, ' ').trim(), kind: 'attr', attr: aname, where: `${labelOf(el)}[${aname}]`, line: at, endLine: line(attrsOffset + a.index + a[0].length) });
        }
      }
      if (!VOID.has(name) && !/\/\s*$/.test(attrs)) stack.push(el);
    } else if (text && text !== '<') {
      const decoded = decodeEntities(text);
      if (!HEBREW.test(decoded)) continue;
      const lead = text.length - text.trimStart().length;
      const start = line(m.index + lead);
      const end = line(m.index + text.trimEnd().length);
      items.push({ text: clean(decoded).replace(/[\s ]+/g, ' ').trim(), kind: 'text', where: contextOf(), line: start, endLine: end });
    }
  }
  return items;
}

module.exports = { extractHtml, decodeEntities };
