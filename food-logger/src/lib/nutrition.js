'use strict';

// Sanity rules for the numbers of an AI nutrition estimate (spec sections 4 and 5.2).
// Pure and dependency-free: it never throws, never drops or reorders items and never
// mutates its input. It only makes the numbers consistent; it logs nothing.

const LIMITS = Object.freeze({
  MAX_ITEM_WEIGHT_G: 2000, // nobody eats more in one item (a 1.5 litre drink fits)
  MACRO_WEIGHT_TOLERANCE: 0.02, // macros may exceed the weight by 2% before they are scaled
  CALORIE_TOLERANCE_ABS: 40, // calories may differ from the macros' value by this many kcal...
  CALORIE_TOLERANCE_REL: 0.2, // ...or by this share of the expected value, whichever is larger
  // Drinks carry calories no macro field holds. 2.4 kcal per gram of weight is spirits at
  // about 35-40 % ABV, the physical ceiling for a drink; it widens only the upper tolerance.
  ALCOHOL_KCAL_PER_G: 2.4,
  MAX_KCAL_PER_G: 9, // pure fat is the physical limit
  MIN_DENSITY: 0.02, // g/ml; popcorn, chips, loose greens and foam
  MAX_DENSITY: 1.6, // g/ml; dense fat, honey, nut butter
  // A density outside [MIN_DENSITY / 10, MAX_DENSITY * 10] is a unit slip (litres written as ml,
  // and the like), not a wrong estimate: the density rule leaves such an item alone.
  UNIT_SLIP_FACTOR: 10,
});

const RULES = Object.freeze({
  INVALID: 'invalid',
  WEIGHT: 'weight',
  DENSITY: 'density',
  MACRO_WEIGHT: 'macro_weight',
  CALORIES_MACROS: 'calories_macros',
  KCAL_DENSITY: 'kcal_density',
});

const NUMERIC_FIELDS = ['weight_g', 'calories', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g'];
const NUTRIENT_FIELDS = ['calories', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g'];
const MACRO_FIELDS = ['protein_g', 'carbs_g', 'fat_g', 'fiber_g'];

const round1 = (n) => Math.round(n * 10) / 10;

// The finite number a raw value stands for, or null when it is not a number at all
// ("150" counts; "150 g", null, booleans, objects and NaN/Infinity do not).
function toFinite(v) {
  if (typeof v === 'string') {
    if (v.trim() === '') return null;
  } else if (typeof v !== 'number') {
    return null;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const isPlainItem = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

function reconcileOne(raw, hit) {
  const item = isPlainItem(raw) ? { ...raw } : {};
  const snapshot = () => NUMERIC_FIELDS.map((f) => item[f]).join('|');
  // Runs one rule and counts it when it changed any number of the item.
  const run = (id, fn) => {
    const before = snapshot();
    fn();
    if (snapshot() !== before) hit(id);
  };

  // The calories before any rule, for calories_delta (garbage counts as 0, a negative stays as given).
  const caloriesBefore = toFinite(raw && raw.calories) || 0;

  // 1. invalid: a present-but-bad value becomes 0 (a missing field is silently 0).
  let replaced = false;
  for (const f of NUMERIC_FIELDS) {
    const present = item[f] !== undefined;
    const n = toFinite(item[f]);
    if (n === null || n < 0) {
      if (present) replaced = true;
      item[f] = 0;
    } else {
      item[f] = n;
    }
  }
  if (replaced) hit(RULES.INVALID);

  // 2. weight cap.
  run(RULES.WEIGHT, () => {
    if (item.weight_g > LIMITS.MAX_ITEM_WEIGHT_G) item.weight_g = LIMITS.MAX_ITEM_WEIGHT_G;
  });

  // 3. density (spec 5.2): weight and volume must agree; move the weight to the nearest bound
  // and scale the nutrition by the same factor.
  run(RULES.DENSITY, () => {
    const volume = toFinite(item.volume_ml);
    if (volume === null || volume <= 0 || item.weight_g <= 0) return;
    const density = item.weight_g / volume;
    if (density >= LIMITS.MIN_DENSITY && density <= LIMITS.MAX_DENSITY) return;
    if (density < LIMITS.MIN_DENSITY / LIMITS.UNIT_SLIP_FACTOR || density > LIMITS.MAX_DENSITY * LIMITS.UNIT_SLIP_FACTOR) return;
    const oldWeight = item.weight_g;
    const newWeight = round1(volume * (density < LIMITS.MIN_DENSITY ? LIMITS.MIN_DENSITY : LIMITS.MAX_DENSITY));
    const factor = newWeight / oldWeight;
    item.weight_g = newWeight;
    item.calories = Math.round(item.calories * factor);
    for (const f of MACRO_FIELDS) item[f] = round1(item[f] * factor);
  });

  // 4. macros fit the weight (the weight is trusted first).
  run(RULES.MACRO_WEIGHT, () => {
    if (item.weight_g <= 0) return;
    const sum = MACRO_FIELDS.reduce((s, f) => s + item[f], 0);
    if (sum > item.weight_g * (1 + LIMITS.MACRO_WEIGHT_TOLERANCE)) {
      const factor = item.weight_g / sum;
      for (const f of MACRO_FIELDS) item[f] = round1(item[f] * factor);
    }
  });

  // 5. calories match the macros (skipped when the macros are all 0: a drink can have calories only).
  // The upper side also allows ALCOHOL_KCAL_PER_G per gram of weight (wine and beer carry calories
  // no macro field holds); with weight 0 that allowance is 0.
  run(RULES.CALORIES_MACROS, () => {
    if (item.protein_g + item.carbs_g + item.fat_g === 0) return;
    const expected = 4 * item.protein_g + 4 * item.carbs_g + 9 * item.fat_g;
    const tolerance = Math.max(LIMITS.CALORIE_TOLERANCE_ABS, LIMITS.CALORIE_TOLERANCE_REL * expected);
    const upperTolerance = Math.max(tolerance, LIMITS.ALCOHOL_KCAL_PER_G * item.weight_g);
    if (item.calories < expected - tolerance || item.calories > expected + upperTolerance) {
      item.calories = Math.round(expected);
    }
  });

  // 6. calories per gram cannot exceed the physical limit.
  run(RULES.KCAL_DENSITY, () => {
    if (item.weight_g > 0 && item.calories > LIMITS.MAX_KCAL_PER_G * item.weight_g) {
      item.calories = Math.round(LIMITS.MAX_KCAL_PER_G * item.weight_g);
    }
  });

  return { item, caloriesBefore };
}

function reconcileItems(items) {
  const report = { adjusted: 0, calories_delta: 0, rules: {} };
  if (!Array.isArray(items)) return { items: [], report };

  let before = 0;
  let after = 0;
  const out = items.map((raw) => {
    const hits = [];
    const { item, caloriesBefore } = reconcileOne(raw, (id) => hits.push(id));
    if (hits.length) {
      report.adjusted += 1;
      for (const id of hits) report.rules[id] = (report.rules[id] || 0) + 1;
    }
    before += caloriesBefore;
    after += item.calories;
    return item;
  });
  report.calories_delta = round1(after - before);
  return { items: out, report };
}

module.exports = { reconcileItems, LIMITS, RULES };
