'use strict';

// Pure counting side of the naming evaluation: the flags of a name and the summary of a
// results object (old / new / optional extra variant). No HTML here (see report.js).

const { findForeignScript } = require('../../src/lib/hebrewName');

const FLAGS = ['foreign', 'repaired', 'cleaned', 'fallback', 'long', 'empty'];
const MAX_WORDS = 6;

function flagsFor(name, action) {
  const flags = [];
  const text = typeof name === 'string' ? name : '';
  if (!text.trim()) return ['empty'];
  if (findForeignScript(text)) flags.push('foreign');
  if (action === 'repaired' || action === 'cleaned' || action === 'fallback') flags.push(action);
  if (text.trim().split(/\s+/).length > MAX_WORDS) flags.push('long');
  return flags;
}

// The old pipeline's name differs from what the AI wrote beyond whitespace: it was stripped.
const wasStripped = (rec) => typeof rec.raw === 'string' && rec.raw.trim().replace(/\s+/g, ' ') !== rec.name;

const emptyCounts = () => ({ ...Object.fromEntries(FLAGS.map((f) => [f, 0])), stripped: 0, errors: 0 });

function countSide(runs, side) {
  const counts = emptyCounts();
  for (const r of runs) {
    const rec = r[side];
    if (!rec || rec.error) { counts.errors++; continue; }
    for (const f of flagsFor(rec.name, rec.action)) counts[f]++;
    if (side === 'old' && wasStripped(rec)) counts.stripped++;
  }
  return counts;
}

// A rating field per variant: `natural` rates the NEW variant, `extra` the extra-model one.
function naturalOf(photos, ratings, field) {
  let rated = 0;
  let natural = 0;
  for (const photo of photos) {
    const verdict = ratings?.[photo.file]?.[field];
    if (typeof verdict !== 'boolean') continue;
    rated++;
    if (verdict) natural++;
  }
  return rated ? { rated, natural, percent: Math.round((natural / rated) * 1000) / 10 } : null;
}

// The third variant exists when the results say so (variants.extra) or any run holds one.
const hasExtra = (results) => Boolean(results?.variants?.extra) || (results?.photos || []).some((p) => (p.runs || []).some((r) => r.extra));

function summarize(results, ratings) {
  const photos = results.photos || [];
  const all = photos.flatMap((p) => p.runs || []);
  const extra = hasExtra(results);
  return {
    photos: photos.length,
    runsPerPhoto: results.runsPerPhoto ?? Math.max(0, ...photos.map((p) => (p.runs || []).length)),
    totalRuns: all.length,
    old: countSide(all, 'old'),
    new: countSide(all, 'new'),
    extra: extra ? countSide(all, 'extra') : null,
    natural: naturalOf(photos, ratings, 'natural'),
    naturalExtra: extra ? naturalOf(photos, ratings, 'extra') : null,
  };
}

module.exports = { FLAGS, MAX_WORDS, flagsFor, wasStripped, summarize, hasExtra };
