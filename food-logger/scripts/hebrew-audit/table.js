'use strict';

// Pure helpers for the audit document: deduplication and markdown rendering.

// Items are { text, where, line, file }, already in file-then-line order. Identical text
// becomes one row that lists every location, so a wording decision is made once.
function dedupe(items) {
  const rows = new Map();
  for (const it of items) {
    if (!rows.has(it.text)) rows.set(it.text, { text: it.text, locations: [] });
    rows.get(it.text).locations.push({ file: it.file, line: it.line, where: it.where || '' });
  }
  return [...rows.values()];
}

// One table cell: no line breaks, no pipes, no HTML that a viewer would interpret.
function escapeCell(s) {
  return String(s).replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const locationText = (l) => `${l.file}:${l.line}${l.where ? ` (${l.where})` : ''}`;

const HEADER = ['#', 'location', 'current text', 'proposed text', 'reason', 'owner decision'];

function renderTable(rows) {
  const lines = [
    `| ${HEADER.join(' | ')} |`,
    `|${HEADER.map(() => '---').join('|')}|`,
  ];
  rows.forEach((row, i) => {
    const loc = row.locations.map((l) => escapeCell(locationText(l))).join('<br>');
    lines.push(`| ${i + 1} | ${loc} | ${escapeCell(row.text)} |  |  |  |`);
  });
  return lines.join('\n');
}

// Accounting summary: one row per file plus a total.
function renderSummary(stats) {
  const cols = ['file', 'lines with Hebrew', 'rows (occurrences)', 'lines inside rows', 'comment-only lines', 'regex-only lines', 'AI-prompt lines', 'unaccounted'];
  const out = [`| ${cols.join(' | ')} |`, `|${cols.map(() => '---').join('|')}|`];
  const total = { hebrewLines: 0, occurrences: 0, covered: 0, comment: 0, regex: 0, prompt: 0, unaccounted: 0 };
  for (const s of stats) {
    out.push(`| ${s.file} | ${s.hebrewLines} | ${s.occurrences} | ${s.covered} | ${s.comment} | ${s.regex} | ${s.prompt} | ${s.unaccounted.length} |`);
    for (const k of ['hebrewLines', 'occurrences', 'covered', 'comment', 'regex', 'prompt']) total[k] += s[k];
    total.unaccounted += s.unaccounted.length;
  }
  out.push(`| **total** | ${total.hebrewLines} | ${total.occurrences} | ${total.covered} | ${total.comment} | ${total.regex} | ${total.prompt} | ${total.unaccounted} |`);
  return out.join('\n');
}

module.exports = { dedupe, escapeCell, renderTable, renderSummary, locationText };
