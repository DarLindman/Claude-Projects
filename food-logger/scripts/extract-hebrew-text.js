'use strict';

// Hebrew copy audit: collects every Hebrew string the app can show and writes
// ../docs/hebrew-copy-audit.md as a table for the owner to review.
//
//   node scripts/extract-hebrew-text.js          (from food-logger/)
//
// Sources: public/index.html (text nodes and attribute values), public/manifest.json,
// public/js/** and src/** (string and template literals; markup inside a template is read
// like HTML). Code comments and regular expressions are skipped. The AI prompts in
// src/lib/prompts.js are not UI text and are only listed, in their own section.
// Accounting: for each file the lines that contain Hebrew (a plain text match, like
// `grep`) are compared with what ended up in the table; the run fails if any is unaccounted.
//
// Proposals live in ../docs/hebrew-copy-proposals.json, keyed by the exact current text:
// { proposed, reason, level: recommended|optional, decision: ''|approved|rejected|edited:<text> }.
// Applying a proposal: change the app text AND remove its entry from the JSON in the same
// commit (a leftover entry is stale and fails test/api/extract-hebrew-text.test.js). Some
// keys are extractor placeholders (`${…} ק"ג`, `${…}${diff} קל'`): apply those by hand at
// the listed locations, never by search and replace. Tests that hard-code an old text (search
// test/ for it) and the Hebrew baseline snapshot are updated in the same commit, and a wrong
// form that must not return goes into test/api/hebrew-spelling.test.js.

const fs = require('node:fs');
const path = require('node:path');
const { collect, account } = require('./hebrew-audit/collect');
const { tokenize, bodyOf, HEBREW } = require('./hebrew-audit/js');
const { dedupe, mergeProposals, renderTable, renderSummary } = require('./hebrew-audit/table');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, '..', 'docs', 'hebrew-copy-audit.md');
// The reviewer's proposals, keyed by the exact current text (see mergeProposals).
const PROPOSALS = path.join(ROOT, '..', 'docs', 'hebrew-copy-proposals.json');
const PROMPT_FILES = new Set(['src/lib/prompts.js']);

function loadProposals(file) {
  if (!fs.existsSync(file)) return {};
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function walk(dir, ext, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, ext, acc);
    else if (e.name.endsWith(ext)) acc.push(full);
  }
  return acc;
}

function sources(root = ROOT) {
  const rel = (p) => path.relative(root, p).split(path.sep).join('/');
  return [
    { file: 'public/index.html', type: 'html' },
    { file: 'public/manifest.json', type: 'js' },
    ...walk(path.join(root, 'public', 'js'), '.js').map((p) => ({ file: rel(p), type: 'js' })),
    ...walk(path.join(root, 'src'), '.js').map((p) => ({ file: rel(p), type: 'js' })),
  ];
}

// Builds the whole document. Pure apart from reading the source files and the proposals
// file; `opts.proposals` (an object) replaces the file, for tests.
function build(root = ROOT, opts = {}) {
  const proposals = opts.proposals !== undefined ? opts.proposals : loadProposals(opts.proposalsFile || PROPOSALS);
  const items = [];
  const stats = [];
  const prompts = [];
  for (const { file, type } of sources(root)) {
    // Normalise line endings so counts, lines and excerpts are the same on LF and CRLF
    // (core.autocrlf) checkouts.
    const src = fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
    if (PROMPT_FILES.has(file)) {
      const mine = tokenize(src).literals.map((l) => ({ l, body: bodyOf(l) })).filter((x) => HEBREW.test(x.body))
        .map(({ l, body }) => ({ file, line: l.startLine, endLine: l.endLine, chars: body.length, start: body.replace(/\s+/g, ' ').slice(0, 60) }));
      prompts.push(...mine);
      const ranges = mine.map((p) => ({ startLine: p.line, endLine: p.endLine }));
      stats.push({ file, ...account(src, { items: [], comments: collect('js', src).comments, regexes: [] }, ranges), occurrences: 0 });
      continue;
    }
    const result = collect(type, src);
    if (!result.items.length && !result.comments.length && !result.regexes.length && !HEBREW.test(src)) continue;
    for (const it of result.items) items.push({ ...it, file });
    stats.push({ file, ...account(src, result), occurrences: result.items.length });
  }
  const { rows, stale } = mergeProposals(dedupe(items), proposals);
  const withProposal = rows.filter((r) => r.proposed !== undefined);
  const review = {
    proposals: Object.keys(proposals).length, merged: withProposal.length, stale,
    optional: withProposal.filter((r) => r.level === 'optional').length,
    decided: withProposal.filter((r) => r.decision).length,
  };
  const unaccounted = stats.filter((s) => s.unaccounted.length);
  const summary = renderSummary(stats.filter((s) => s.hebrewLines > 0));
  const promptList = prompts.map((p) => `- \`${p.file}:${p.line}${p.endLine > p.line ? `-${p.endLine}` : ''}\` (${p.chars} characters): ${p.start.replace(/[<>|]/g, ' ')}...`).join('\n');
  return { rows, stats, unaccounted, stale, summary, promptList, markdown: render(rows, summary, promptList, stats, items.length, review) };
}

function renderReview({ proposals, merged, stale, optional, decided }) {
  const list = stale.map((t) => `- STALE: \`${t.replace(/`/g, "'")}\``).join('\n');
  return `Review proposals: ${proposals} in \`docs/hebrew-copy-proposals.json\`, merged into ${merged} rows (${merged - optional} recommended, ${optional} optional; ${decided} with an owner decision). Stale proposals (their current text no longer exists in the sources; update or remove them): ${stale.length ? `${stale.length}\n\n${list}` : '(none)'}`;
}

function render(rows, summary, promptList, stats, occurrences, review) {
  const notes = stats.filter((s) => s.hebrewLines > 0 && s.occurrences < s.hebrewLines && s.prompt === 0)
    .map((s) => {
      const why = [];
      if (s.comment) why.push(`${s.comment} comment-only line(s)`);
      if (s.regex) why.push(`${s.regex} regex-only line(s)`);
      if (!why.length) why.push('a string or markup spans several lines');
      return `- \`${s.file}\`: ${s.occurrences} occurrences for ${s.hebrewLines} lines (${why.join(', ')})`;
    }).join('\n');
  return `# Hebrew copy audit

Generated by \`food-logger/scripts/extract-hebrew-text.js\`. Do not edit the first three columns by hand: run the script again.

**How to use.** \`proposed text\` and \`reason\` are for the reviewer who reads Hebrew natively (spelling, wording, gender consistency, punctuation and quotation marks, abbreviations, tone); a blank row means nothing should change. They are filled from \`docs/hebrew-copy-proposals.json\` (keyed by the exact current text), so edit that file, not this table; a reason ending in *(optional)* is a nice-to-have. \`owner decision\` is for the owner: approve, edit or reject. It is rendered from the entry's \`decision\` field (\`approved\`, \`rejected\` or \`edited:<text>\`), so record it there and it survives a regenerate. Only approved rows are applied. A readable summary is in \`docs/hebrew-copy-audit-summary.md\`.

**Applying a proposal.** Change the app text and remove its entry from the JSON in the same commit; a leftover entry is reported as stale and fails the extractor test. Keys with placeholders (\`\${…} ק"ג\`, \`\${…}\${diff} קל'\`) are how the extractor shows code, not searchable text: apply them by hand at the listed locations. Tests that hard-code an old text (search \`test/\` for it) and the Hebrew baseline snapshot (\`UPDATE_SNAPSHOT=1 npm run test:e2e -- hebrew-baseline\`, then review the diff) are updated in the same commit; a wrong form that must not come back goes into \`test/api/hebrew-spelling.test.js\`.

**What the table holds.** ${rows.length} rows for ${occurrences} occurrences: identical text is one row with every location listed. A location is \`file:line (key or element)\`. \`\${name}\` marks a value inserted by the code (\`\${…}\` for a computed one). Attribute values are shown as \`tag[attribute]\`. Some rows are not shown to users as text: \`errors.js\` keys are matched by code, the single-letter \`DAY_LETTERS\` rows are the weekday letters of the diary's week strip (data, not copy), and the \`hebrewName.js\` \`CONNECTORS\` rows are connector words (עם, של, …) that the dish-name logic matches, not text; changing any of these changes behaviour, so leave them to a code review.
${renderTable(rows)}

## AI prompts (not user-facing; excluded)

The model prompts are instructions, not UI text, so they are not in the table. They are reviewed separately when the naming rules change.

${promptList}

## Accounting

Lines that contain Hebrew (a plain text match, like \`grep\`) per file, against what the table covers. Every such line is either inside a row, a code comment, a regular expression, or an AI prompt; none is left over. A file can have fewer occurrences than lines when a string or markup spans several lines, when a comment holds the Hebrew, or when one line carries several strings.

${summary}

Files with fewer occurrences than lines:

${notes || '(none)'}

${renderReview(review)}

Not scanned: \`scripts/eval/**\` (developer tooling for the naming evaluation, never shown to users), \`test/**\`, and CSS (no Hebrew in any stylesheet).
`;
}

function main() {
  const out = build();
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, out.markdown);
  console.log(out.summary);
  console.log(`\n${out.rows.length} rows written to ${path.relative(process.cwd(), OUT)}`);
  console.log(`${out.rows.filter((r) => r.proposed !== undefined).length} rows have a proposal`);
  for (const t of out.stale) console.warn(`STALE proposal (its current text is no longer in the sources): ${JSON.stringify(t)}`);
  if (out.unaccounted.length) {
    for (const s of out.unaccounted) console.error(`UNACCOUNTED in ${s.file}: lines ${s.unaccounted.join(', ')}`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { build, sources };
