'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { reconcileItems, LIMITS } = require('../../src/lib/nutrition');

const FIELDS = ['weight_g', 'calories', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g'];

// A consistent item: 4*20 + 4*30 + 9*10 = 290 kcal, macros 63 g of 150 g.
const ok = (extra = {}) => ({ name: 'x', weight_g: 150, calories: 290, protein_g: 20, carbs_g: 30, fat_g: 10, fiber_g: 3, ...extra });
const one = (item) => reconcileItems([item]);

test('constants are the agreed values', () => {
  assert.deepEqual(LIMITS, {
    MAX_ITEM_WEIGHT_G: 2000,
    MACRO_WEIGHT_TOLERANCE: 0.02,
    CALORIE_TOLERANCE_ABS: 40,
    CALORIE_TOLERANCE_REL: 0.2,
    MAX_KCAL_PER_G: 9,
    MIN_DENSITY: 0.05,
    MAX_DENSITY: 1.6,
  });
});

test('invalid: a present-but-bad value becomes 0 and is counted; "150" is accepted', () => {
  const { items, report } = one(ok({ weight_g: '150', protein_g: -5, carbs_g: 'abc', fat_g: null, fiber_g: NaN }));
  assert.equal(items[0].weight_g, 150);
  for (const f of ['protein_g', 'carbs_g', 'fat_g', 'fiber_g']) assert.equal(items[0][f], 0, f);
  assert.equal(report.rules.invalid, 1);
});

test('invalid: a missing field is silently 0 and not counted', () => {
  const { items, report } = one({ name: 'x', weight_g: 100 });
  for (const f of FIELDS.slice(1)) assert.equal(items[0][f], 0, f);
  assert.equal(items[0].weight_g, 100);
  assert.equal(report.rules.invalid, undefined);
  assert.equal(report.adjusted, 0);
});

test('weight: 2000 stays, 2001 is capped to 2000', () => {
  // water-like item: macros 0, calories 0, so only the weight rule can fire
  const stay = one({ weight_g: 2000, calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 });
  assert.equal(stay.items[0].weight_g, 2000);
  assert.equal(stay.report.adjusted, 0);
  const cap = one({ weight_g: 2001, calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 });
  assert.equal(cap.items[0].weight_g, 2000);
  assert.equal(cap.report.rules.weight, 1);
  assert.equal(cap.report.adjusted, 1);
});

test('density: exactly 0.05 and 1.6 g/ml stay', () => {
  for (const [w, v] of [[50, 1000], [160, 100]]) {
    const item = { weight_g: w, volume_ml: v, calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 };
    const { items, report } = one({ ...item, calories: 100 });
    assert.equal(items[0].weight_g, w);
    assert.equal(items[0].calories, 100);
    assert.equal(report.rules.density, undefined);
  }
});

test('density: 0.049 is raised to 0.05 and calories/macros scale with the weight', () => {
  // 49 g in 1000 ml -> weight 50 (factor 50/49)
  const { items, report } = one({ name: 'popcorn', weight_g: 49, volume_ml: 1000, calories: 98, protein_g: 4.9, carbs_g: 9.8, fat_g: 0, fiber_g: 0 });
  assert.equal(items[0].weight_g, 50);
  assert.equal(items[0].calories, 100);
  assert.equal(items[0].protein_g, 5);
  assert.equal(items[0].carbs_g, 10);
  assert.equal(items[0].volume_ml, 1000);
  assert.equal(items[0].name, 'popcorn');
  assert.equal(report.rules.density, 1);
});

test('density: 1.61 is lowered to 1.6 and calories/macros scale down', () => {
  // 161 g in 100 ml -> weight 160 (factor 160/161)
  const { items, report } = one({ weight_g: 161, volume_ml: 100, calories: 322, protein_g: 0, carbs_g: 80.5, fat_g: 0, fiber_g: 0 });
  assert.equal(items[0].weight_g, 160);
  assert.equal(items[0].calories, 320);
  assert.equal(items[0].carbs_g, 80);
  assert.equal(report.rules.density, 1);
  assert.equal(report.calories_delta, -2);
});

test('density: skipped without a usable volume or weight', () => {
  for (const volume_ml of [undefined, 0, -5, '250', NaN, null]) {
    const { items, report } = one(ok({ volume_ml, weight_g: 150 }));
    assert.equal(items[0].weight_g, 150, String(volume_ml));
    assert.equal(report.rules.density, undefined, String(volume_ml));
  }
  const { items, report } = one({ weight_g: 0, volume_ml: 100, calories: 50 });
  assert.equal(items[0].weight_g, 0);
  assert.equal(report.rules.density, undefined);
});

test('macro_weight: a sum of exactly 1.02x the weight stays, above is scaled to the weight', () => {
  // sum 102 on weight 100 -> stays (calories consistent: 4*30 + 4*40 + 9*10 = 370 would be 100 g? use calories as given)
  const stay = one({ weight_g: 100, protein_g: 30, carbs_g: 40, fat_g: 10, fiber_g: 22, calories: 370 });
  assert.deepEqual([stay.items[0].protein_g, stay.items[0].carbs_g, stay.items[0].fat_g, stay.items[0].fiber_g], [30, 40, 10, 22]);
  assert.equal(stay.report.rules.macro_weight, undefined);

  // sum 103 on weight 100 -> scaled by 100/103
  const scaled = one({ weight_g: 100, protein_g: 30, carbs_g: 40, fat_g: 10, fiber_g: 23, calories: 370 });
  const it = scaled.items[0];
  assert.equal(scaled.report.rules.macro_weight, 1);
  assert.equal(it.protein_g, Math.round(30 * 100 / 103 * 10) / 10);
  assert.equal(it.carbs_g, Math.round(40 * 100 / 103 * 10) / 10);
  assert.equal(it.fat_g, Math.round(10 * 100 / 103 * 10) / 10);
  assert.equal(it.fiber_g, Math.round(23 * 100 / 103 * 10) / 10);
  assert.equal(it.weight_g, 100);
});

test('calories_macros: a deviation of exactly max(40, 20%) stays, above is replaced', () => {
  // expected 290: tolerance is max(40, 58) = 58
  const at = ok({ calories: 290 + 58 });
  assert.equal(one(at).items[0].calories, 348);
  assert.equal(one(ok({ calories: 290 - 58 })).items[0].calories, 232);
  const over = one(ok({ calories: 290 + 59 }));
  assert.equal(over.items[0].calories, 290);
  assert.equal(over.report.rules.calories_macros, 1);
  assert.equal(one(ok({ calories: 290 - 59 })).items[0].calories, 290);

  // small expected: tolerance is the absolute 40 (expected 40 = 10 g carbs)
  const small = { weight_g: 100, protein_g: 0, carbs_g: 10, fat_g: 0, fiber_g: 0 };
  assert.equal(one({ ...small, calories: 80 }).items[0].calories, 80);
  assert.equal(one({ ...small, calories: 81 }).items[0].calories, 40);
  assert.equal(one({ ...small, calories: 200 }).items[0].calories, 40);
});

test('calories_macros: the expected value is rounded to an integer', () => {
  const { items } = one({ weight_g: 100, protein_g: 10.3, carbs_g: 0, fat_g: 0, fiber_g: 0, calories: 500 });
  assert.equal(items[0].calories, 41); // 4 * 10.3 = 41.2
});

test('kcal_density: 10 kcal/g is brought down to 9 kcal/g', () => {
  const { items, report } = one({ name: 'oil', weight_g: 100, calories: 1000, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 });
  assert.equal(items[0].calories, 900);
  assert.equal(report.rules.kcal_density, 1);
  assert.equal(report.calories_delta, -100);
  // exactly 9 kcal/g stays
  assert.equal(one({ weight_g: 100, calories: 900 }).items[0].calories, 900);
});

test('kcal_density: the result is an integer', () => {
  const { items } = one({ weight_g: 10.5, calories: 500 });
  assert.equal(items[0].calories, 95); // 9 * 10.5 = 94.5 -> 95
});

test('a drink with calories only keeps its calories', () => {
  const { items, report } = one({ weight_g: 330, calories: 140 });
  assert.equal(items[0].calories, 140);
  assert.equal(items[0].weight_g, 330);
  assert.equal(report.adjusted, 0);
  assert.equal(report.calories_delta, 0);
});

test('an item with weight 0 is not weight-checked', () => {
  // supplement-like: macros present, no weight; none of the weight rules may fire
  const { items, report } = one({ weight_g: 0, calories: 290, protein_g: 20, carbs_g: 30, fat_g: 10, fiber_g: 3 });
  assert.deepEqual(items[0], { weight_g: 0, calories: 290, protein_g: 20, carbs_g: 30, fat_g: 10, fiber_g: 3 });
  assert.equal(report.adjusted, 0);
  // calories 5000 on weight 0: the density rule is skipped; the calories rule may still apply
  const big = one({ weight_g: 0, calories: 5000 });
  assert.equal(big.items[0].calories, 5000);
  assert.equal(big.report.rules.kcal_density, undefined);
});

test('garbage fields never produce NaN', () => {
  const garbage = [
    {},
    { weight_g: '150 g', calories: null, protein_g: -5, fat_g: NaN, carbs_g: Infinity },
    { weight_g: Infinity, calories: -Infinity, protein_g: {}, carbs_g: [], fat_g: true, fiber_g: 'x', volume_ml: NaN },
    null, undefined, 'text', 7, [],
  ];
  const { items, report } = reconcileItems(garbage);
  assert.equal(items.length, garbage.length);
  for (const it of items) {
    for (const f of FIELDS) {
      assert.equal(typeof it[f], 'number', f);
      assert.ok(Number.isFinite(it[f]) && it[f] >= 0, `${f} = ${it[f]}`);
    }
  }
  assert.ok(Number.isFinite(report.calories_delta));
  assert.ok(Number.isInteger(report.adjusted));
  assert.deepEqual(items[0], { weight_g: 0, calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 });
  assert.equal(items[1].weight_g, 0);
  assert.equal(items[1].calories, 0);
});

test('input is not mutated', () => {
  const input = [ok({ weight_g: 5000, volume_ml: 10, calories: 99999 }), { weight_g: '150 g', calories: null }, ok()];
  const clone = structuredClone(input);
  input.forEach(Object.freeze);
  Object.freeze(input);
  const { items } = reconcileItems(input);
  assert.deepEqual(input, clone);
  assert.notEqual(items[0], input[0]);
});

test('consistent items are returned equal and report adjusted 0', () => {
  const input = [ok(), ok({ name: 'y', weight_g: 330, calories: 140, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0, volume_ml: 330 })];
  const { items, report } = reconcileItems(input);
  assert.deepEqual(items, input);
  assert.deepEqual(report, { adjusted: 0, calories_delta: 0, rules: {} });
});

test('unknown keys are kept on the copies', () => {
  const { items } = one(ok({ name: 'לחם', volume_ml: 200, extra: { a: 1 } }));
  assert.equal(items[0].name, 'לחם');
  assert.equal(items[0].volume_ml, 200);
  assert.deepEqual(items[0].extra, { a: 1 });
});

test('order and length are kept', () => {
  const input = [ok({ name: 'a', weight_g: 5000 }), ok({ name: 'b' }), { name: 'c' }, ok({ name: 'd', calories: 5000 })];
  const { items } = reconcileItems(input);
  assert.deepEqual(items.map((i) => i.name), ['a', 'b', 'c', 'd']);
});

test('a corrected weight feeds the nutrition rules (execution order)', () => {
  // weight 5000 -> 2000; macros 3000 g sum -> scaled to 2000 g; then calories checked against the scaled macros
  const { items, report } = one({ weight_g: 5000, calories: 20000, protein_g: 1000, carbs_g: 1000, fat_g: 1000, fiber_g: 0 });
  const it = items[0];
  assert.equal(it.weight_g, 2000);
  assert.ok(it.protein_g + it.carbs_g + it.fat_g + it.fiber_g <= 2000 * 1.02 + 0.2);
  assert.ok(it.calories <= 9 * 2000);
  assert.equal(report.rules.weight, 1);
  assert.equal(report.rules.macro_weight, 1);
  assert.equal(report.rules.calories_macros, 1);
});

test('report counts', () => {
  const a = { name: 'a', weight_g: 100, calories: 1000, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 }; // kcal_density: 1000 -> 900
  const b = ok({ name: 'b', calories: 500 }); // calories_macros: 500 -> 290
  const c = ok({ name: 'c' }); // untouched
  const { items, report } = reconcileItems([a, b, c]);
  assert.equal(items[0].calories, 900);
  assert.equal(items[1].calories, 290);
  assert.deepEqual(report, { adjusted: 2, calories_delta: -100 + -210, rules: { kcal_density: 1, calories_macros: 1 } });
});

test('report: an item hitting several rules counts once in adjusted and once per rule', () => {
  const { report } = one({ weight_g: 3000, calories: -1, protein_g: 20, carbs_g: 0, fat_g: 0, fiber_g: 0 });
  assert.equal(report.adjusted, 1);
  assert.equal(report.rules.invalid, 1);
  assert.equal(report.rules.weight, 1);
  assert.equal(report.rules.calories_macros, 1);
  // before = -1 (raw), after = 80
  assert.equal(report.calories_delta, 81);
});

test('reconcileItems([]) and non-array input return empty items', () => {
  const empty = { items: [], report: { adjusted: 0, calories_delta: 0, rules: {} } };
  assert.deepEqual(reconcileItems([]), empty);
  for (const bad of [undefined, null, 'x', 5, {}, { length: 2 }]) assert.deepEqual(reconcileItems(bad), empty);
});
