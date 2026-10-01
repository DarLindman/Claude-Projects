'use strict';

// The pure parts of the Hebrew copy-audit extractor (scripts/extract-hebrew-text.js and
// scripts/hebrew-audit/*): literal extraction, HTML text nodes, deduplication, table
// rendering, plus a check that the real sources are fully accounted for.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { tokenize, bodyOf } = require('../../scripts/hebrew-audit/js');
const { extractHtml, decodeEntities } = require('../../scripts/hebrew-audit/html');
const { collectJs, account } = require('../../scripts/hebrew-audit/collect');
const { dedupe, escapeCell, mergeProposals, renderTable } = require('../../scripts/hebrew-audit/table');
const { build, functionLines } = require('../../scripts/extract-hebrew-text');

const texts = (src) => tokenize(src).literals.map(bodyOf);

test('string literals: escaped quotes, both quote kinds, unicode escapes', () => {
  const src = String.raw`const a = 'צ\'יפס'; const b = "אמר \"שלום\""; const c = 'שלום';`;
  assert.deepEqual(texts(src), ["צ'יפס", 'אמר "שלום"', 'שלום']);
});

test('template literals: ${} placeholders, nested templates, line numbers', () => {
  const src = 'const t = `שלום ${name}, יש ${Math.round(x)} פריטים ${cond ? `כן ${y}` : \'לא\'}`;\nconst u = `שורה\nשנייה`;';
  const tok = tokenize(src);
  const bodies = tok.literals.map(bodyOf);
  assert.ok(bodies.includes('שלום ${name}, יש ${…} פריטים ${…}'));
  assert.ok(bodies.includes('כן ${y}'), 'the nested template is found on its own');
  assert.ok(bodies.includes('לא'));
  const multi = tok.literals.find((l) => l.kind === 'template' && l.startLine === 2);
  assert.equal(multi.endLine, 3);
});

test('comments are skipped, regex literals are not strings, division is not a regex', () => {
  const src = [
    "// 'מילה בהערה'",
    '/* "עוד הערה" */',
    'const re = /[א-ת]+"/; const half = total / 2; const s = "אמיתי";',
  ].join('\n');
  const tok = tokenize(src);
  assert.deepEqual(tok.literals.map(bodyOf), ['אמיתי']);
  assert.equal(tok.comments.length, 2);
  assert.equal(tok.regexes.length, 1);
});

test('collectJs: keys, markup in templates read as text nodes and attributes', () => {
  const src = [
    'const ERRORS = {',
    "  'food_name:REQUIRED': 'שם האוכל חסר',",
    '};',
    'showToast(\'נשמר\');',
    'const tpl = html`<button aria-label="מחק">מחק</button><p>אין ${n} נתונים</p>`;',
  ].join('\n');
  const { items } = collectJs(src);
  const by = Object.fromEntries(items.map((i) => [i.text, i]));
  assert.equal(by['שם האוכל חסר'].where, 'food_name:REQUIRED');
  assert.equal(by['נשמר'].where, 'toast');
  assert.equal(items.filter((i) => i.text === 'מחק').length, 2, 'the attribute and the text node');
  assert.equal(by['אין ${n} נתונים'].line, 5);
});

test('extractHtml: attributes, entities, comments, scripts and styles', () => {
  const html = [
    '<!-- הערה -->',
    '<div id="a">',
    '  <input placeholder="לפחות 3 תווים" title=\'כותרת\'>',
    '  <p>ק&quot;ג&nbsp;&amp; עוד &#1488;</p>',
    '  <script>const x = "עברית בסקריפט";</script>',
    '  <style>.a::after { content: "עברית"; }</style>',
    '</div>',
  ].join('\n');
  const items = extractHtml(html);
  assert.deepEqual(items.map((i) => [i.kind, i.text, i.line]), [
    ['attr', 'לפחות 3 תווים', 3],
    ['attr', 'כותרת', 3],
    ['text', 'ק"ג & עוד א', 4],
  ]);
  assert.equal(items[0].where, 'input[placeholder]');
  assert.equal(items[2].where, 'p in #a');
  assert.equal(decodeEntities('&#x5d0;&lt;'), 'א<');
});

test('dedupe keeps every location, renderTable escapes cells and leaves the review columns empty', () => {
  const rows = dedupe([
    { text: 'שמור', file: 'a.html', line: 3, where: 'button' },
    { text: 'מחק | הכל', file: 'a.html', line: 4, where: '' },
    { text: 'שמור', file: 'b.js', line: 9, where: 'toast' },
  ]);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0].locations.map((l) => `${l.file}:${l.line}`), ['a.html:3', 'b.js:9']);
  const table = renderTable(rows).split('\n');
  assert.equal(table[0], '| # | location | current text | proposed text | reason | owner decision |');
  assert.equal(table[2], '| 1 | a.html:3 (button)<br>b.js:9 (toast) | שמור |  |  |  |');
  assert.match(table[3], /מחק \\\| הכל/);
  assert.equal(escapeCell('a\n<b>'), 'a &lt;b&gt;');
});

test('account: a Hebrew line outside every row, comment and regex is reported', () => {
  const src = "const a = 'שלום';\n// הערה\nconst b = 1; /* ok */\nconst c = `x\n${'בדיקה'}`;";
  const result = collectJs(src);
  const acc = account(src, result);
  assert.equal(acc.hebrewLines, 3);
  assert.equal(acc.comment, 1);
  assert.deepEqual(acc.unaccounted, []);
  // remove the extracted rows on purpose: the same lines are now unaccounted
  const none = account(src, { items: [], comments: [], regexes: [] });
  assert.deepEqual(none.unaccounted, [1, 2, 5]);
});

test('the real sources: every Hebrew line is accounted for and the table is not empty', () => {
  const out = build();
  assert.deepEqual(out.unaccounted.map((s) => [s.file, s.unaccounted]), []);
  assert.ok(out.rows.length > 100);
  assert.match(out.markdown, /## AI prompts \(not user-facing; excluded\)/);
  assert.deepEqual(out.stale, [], 'every proposal in docs/hebrew-copy-proposals.json matches a row');
});

test('mergeProposals fills proposed text and reason by exact text, reports stale ones, leaves the owner column empty', () => {
  const rows = dedupe([
    { text: 'סיסמא', file: 'a.html', line: 1, where: 'label' },
    { text: 'שמור', file: 'a.html', line: 2, where: 'button' },
  ]);
  const { rows: merged, stale } = mergeProposals(rows, {
    'סיסמא': { proposed: 'סיסמה', reason: 'כתיב: תקני' },
    'סיסמא ': { proposed: 'x', reason: 'y' }, // not the exact text: stale
    'נמחק מהקוד': { proposed: 'x', reason: 'y' },
  });
  assert.deepEqual(stale, ['סיסמא ', 'נמחק מהקוד']);
  assert.equal(merged[0].proposed, 'סיסמה');
  assert.equal(merged[1].proposed, undefined);
  const table = renderTable(merged).split('\n');
  assert.equal(table[2], '| 1 | a.html:1 (label) | סיסמא | סיסמה | כתיב: תקני |  |');
  assert.equal(table[3], '| 2 | a.html:2 (button) | שמור |  |  |  |');
  assert.throws(() => mergeProposals(rows, { 'שמור': { proposed: 'שמירה' } }), /reason/);
  assert.throws(() => mergeProposals(rows, []), /object/);
});

test('build merges given proposals and lists a stale one in the accounting section', () => {
  const out = build(undefined, { proposals: {
    'שגיאה במחיקה': { proposed: 'המחיקה נכשלה', reason: 'בהירות: בדיקה' },
    'טקסט שלא קיים באפליקציה': { proposed: 'x', reason: 'y' },
  } });
  assert.deepEqual(out.stale, ['טקסט שלא קיים באפליקציה']);
  assert.match(out.markdown, /\| שגיאה במחיקה \| המחיקה נכשלה \| בהירות: בדיקה \|  \|/);
  assert.match(out.markdown, /Review proposals: 2 in `docs\/hebrew-copy-proposals\.json`, merged into 1 rows \(1 recommended, 0 optional; 0 with an owner decision\)\. Stale proposals .*: 1\n\n- STALE: `טקסט שלא קיים באפליקציה`/);
  const none = build(undefined, { proposals: {} });
  assert.match(none.markdown, /Stale proposals .*: \(none\)/);
});

test('level and owner decision: rendered, validated, and a decision survives a regenerate', () => {
  const rows = dedupe([{ text: 'שמור', file: 'a.html', line: 2, where: 'button' }]);
  const one = (p) => renderTable(mergeProposals(rows, { 'שמור': { proposed: 'שמירה', reason: 'ניסוח: בדיקה', ...p } }).rows).split('\n')[2];
  assert.equal(one({ level: 'optional', decision: 'approved' }), '| 1 | a.html:2 (button) | שמור | שמירה | ניסוח: בדיקה (optional) | approved |');
  assert.equal(one({ decision: 'edited:שמור שינויים' }), '| 1 | a.html:2 (button) | שמור | שמירה | ניסוח: בדיקה | edited:שמור שינויים |');
  assert.equal(one({ decision: '' }), '| 1 | a.html:2 (button) | שמור | שמירה | ניסוח: בדיקה |  |');
  for (const bad of [{ decision: 'yes' }, { decision: 'edited:' }, { level: 'must' }]) assert.throws(() => one(bad), /decision|level/);

  // the decision lives in the proposals file, so every regenerate renders it again
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hebrew-audit-'));
  try {
    const file = path.join(dir, 'proposals.json');
    fs.writeFileSync(file, JSON.stringify({ 'שגיאה במחיקה': { proposed: 'המחיקה נכשלה', reason: 'בהירות: בדיקה', level: 'recommended', decision: 'rejected' } }));
    for (let i = 0; i < 2; i++) {
      const out = build(undefined, { proposalsFile: file });
      assert.match(out.markdown, /\| שגיאה במחיקה \| המחיקה נכשלה \| בהירות: בדיקה \| rejected \|/);
      assert.match(out.markdown, /1 with an owner decision/);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the real proposals file: every entry has a level and an empty or valid decision', () => {
  const real = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'docs', 'hebrew-copy-proposals.json'), 'utf8'));
  for (const [text, p] of Object.entries(real)) {
    assert.ok(['recommended', 'optional'].includes(p.level), `level of "${text}"`);
    assert.equal(typeof p.decision, 'string', `decision of "${text}"`);
  }
});

test('text inside a function the app never calls is marked not shown to users', () => {
  assert.deepEqual(functionLines('a\nexport function f(x) {\n  y;\n}\nz', 'f'), { start: 2, end: 4 });
  assert.equal(functionLines('a', 'f'), null);
  const out = build(undefined, { proposals: {} });
  // the macro line of renderDashLogPreview (dashboard.js also has text the app does show)
  const row = out.rows.find((r) => r.text.startsWith('ח ${…} · פ') && r.locations.some((l) => l.file === 'public/js/screens/dashboard.js'));
  assert.ok(row.locations.every((l) => /not shown to users: renderDashLogPreview is never called/.test(l.where)));
  assert.match(out.markdown, /`hebrewName\.js` `CONNECTORS` rows are connector words/);
});
