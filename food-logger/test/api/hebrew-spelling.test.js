'use strict';

// Hebrew spelling guard: known wrong forms that the owner-approved copy audit
// (docs/hebrew-copy-audit.md, applied on 2026-10-01) removed from the app must not come back.
// Scans the user-facing sources: public/index.html, public/manifest.json, public/js/** and
// src/** (the server's messages). Skipped: the AI prompts (src/lib/analysis.js, the
// dish-name logic in src/lib/hebrewName.js, src/lib/imagePrompt* if it exists) and tests.
// A failure names the file, the line and the reason.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const HEB = 'א-ת'; // a Hebrew letter, for "not inside a longer word"

const SKIP = [/^src\/lib\/analysis\.js$/, /^src\/lib\/hebrewName\.js$/, /^src\/lib\/imagePrompt/];

// Each entry: the wrong form, which files it applies to (default: every scanned file) and why.
const WRONG_FORMS = [
  // spelling: the standard form is סיסמה (Academy of the Hebrew Language)
  { re: /סיסמא/, why: 'write "סיסמה", not "סיסמא"' },
  // spelling: "הכול" when the word stands alone (full spelling)
  { re: /הכל במקום אחד/, why: 'write "הכול במקום אחד"' },
  // consistency: the calorie unit is "קק״ל" (or the word "קלוריות"); "קל'" is not a standard abbreviation
  { re: new RegExp(`(?<![${HEB}])קל'(?![${HEB}])`), why: 'write "קק״ל" or "קלוריות", not "קל\'"' },
  // consistency: Hebrew gershayim (״) in ק״ג, not a straight quote (raw, HTML entity or JS escape)
  { re: /ק(?:"|&quot;|\\")ג/, why: 'write "ק״ג" with gershayim (U+05F4), not a straight quote' },
  // consistency: Hebrew gershayim (״) in ס״מ, not a straight quote
  { re: /ס(?:"|&quot;|\\")מ/, why: 'write "ס״מ" with gershayim (U+05F4), not a straight quote' },
  // consistency: the field is "שם המנה" everywhere (the edit modal already says so)
  { re: /שם האוכל/, why: 'write "שם המנה", not "שם האוכל"' },
  // consistency: a diary item is a "מנה" ("המנה עודכנה")
  { re: /הרשומה נמחקה/, why: 'write "המנה נמחקה"' },
  // owner decision: a meal saved without a name is "מנה ללא שם"
  { re: /אוכל לא ידוע/, why: 'write "מנה ללא שם"' },
  // wording: no colon after the prefix כ־ ("מחובר בתור ...")
  { re: /מחובר כ:/, why: 'write "מחובר בתור", not "מחובר כ:"' },
  // the old stats footnote "ממוצע יומי ב-N ימים" (it printed "ב-0 ימים" and "1 ימים")
  { re: /ב-\$\{[^}]*\} ימים/, why: 'the stats footnote is "ממוצע יומי על בסיס …", hidden for 0 days' },
  // month abbreviations need a geresh (ינו׳, פבר׳ …) or the full name (יוני, יולי): a bare quoted token is the old form
  { re: /(['"`])(?:ינו|פבר|אפר|יונ|יול|אוג|ספט|אוק|נוב|דצמ)\1/, files: /^public\/js\//, why: 'a month abbreviation needs a geresh (U+05F3) or the full name' },
];

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, acc);
    else if (e.name.endsWith('.js')) acc.push(full);
  }
  return acc;
}

function scannedFiles() {
  const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
  return [
    path.join(ROOT, 'public', 'index.html'),
    path.join(ROOT, 'public', 'manifest.json'),
    ...walk(path.join(ROOT, 'public', 'js')),
    ...walk(path.join(ROOT, 'src')),
  ].map(rel).filter((f) => !SKIP.some((s) => s.test(f)));
}

// Every (file, line, reason) where a wrong form appears in `files` (relative path -> text).
function findWrongForms(files) {
  const hits = [];
  for (const [file, text] of Object.entries(files)) {
    text.split(/\r?\n/).forEach((line, i) => {
      for (const w of WRONG_FORMS) {
        if (w.files && !w.files.test(file)) continue;
        if (w.re.test(line)) hits.push(`${file}:${i + 1}: ${w.why}\n    ${line.trim().slice(0, 160)}`);
      }
    });
  }
  return hits;
}

test('the guard scans the user-facing sources and skips the AI prompts', () => {
  const files = scannedFiles();
  for (const f of ['public/index.html', 'public/js/errors.js', 'public/js/dates.js', 'src/routes/auth.js']) assert.ok(files.includes(f), f);
  for (const f of ['src/lib/analysis.js', 'src/lib/hebrewName.js']) assert.ok(!files.includes(f), f);
  assert.ok(!files.some((f) => f.startsWith('test/')));
});

test('each wrong form is caught, and the correct forms are not', () => {
  const wrong = {
    'public/js/a.js': [
      "label: 'סיסמא'", '<p>הכל במקום אחד</p>', "`${rec} קל'`", '<label>גובה (ס"מ)</label>', '`${v} ק"ג`',
      '<label>משקל (ק&quot;ג)</label>', 'placeholder="שם האוכל"', "showToast('הרשומה נמחקה')", "|| 'אוכל לא ידוע'",
      '`מחובר כ: ${u}`', '`ממוצע יומי ב-${rows.length} ימים`', "const months = ['ינו','פבר'];",
    ].join('\n'),
  };
  assert.equal(findWrongForms(wrong).length, 12, findWrongForms(wrong).join('\n'));
  const right = {
    'public/js/a.js': [
      "label: 'סיסמה'", '<p>הכול במקום אחד</p>', '`${rec} קק״ל`', '<label>גובה (ס״מ)</label>', '`${v} ק״ג`',
      'placeholder="שם המנה"', "showToast('המנה נמחקה')", "|| 'מנה ללא שם'", '`מחובר בתור ${u}`',
      "const months = ['ינו׳','פבר׳','מרץ','יוני','יולי','דצמ׳'];", "'פעילות קלה'", "{ e: '🍟', k: ['צ\\'יפס'] }",
      "const re = /קלאסי'/;",
    ].join('\n'),
  };
  assert.deepEqual(findWrongForms(right), []);
  // the month rule applies to the frontend only
  assert.deepEqual(findWrongForms({ 'src/x.js': "const a = 'אוק';" }), []);
});

test('no known wrong Hebrew form in the app sources', () => {
  const files = Object.fromEntries(scannedFiles().map((f) => [f, fs.readFileSync(path.join(ROOT, f), 'utf8')]));
  const hits = findWrongForms(files);
  assert.deepEqual(hits, [], `Known wrong Hebrew forms (see docs/hebrew-copy-audit-summary.md):\n${hits.join('\n')}`);
});
