'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { reconcileItems, LIMITS, RULES } = require('../../src/lib/nutrition');

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
    ALCOHOL_KCAL_PER_G: 2.4,
    MAX_KCAL_PER_G: 9,
  });
});

test('the rule ids are the five rules, in execution order', () => {
  assert.deepEqual(Object.values(RULES), ['invalid', 'weight', 'macro_weight', 'calories_macros', 'kcal_density']);
  assert.ok(!Object.values(RULES).includes('density'));
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

// The density rule (weight against volume_ml) was removed with the volume method (owner
// decision 2026-10-03: the scale-grounded prompt asks for no volume). A volume_ml a model
// still writes is an unknown key: kept on the copy and never acted on.
test('a volume_ml that contradicts the weight is ignored', () => {
  const item = ok({ volume_ml: 10, weight_g: 150 }); // 15 g/ml: the old density rule would have acted
  const { items, report } = one(item);
  assert.deepEqual(items[0], item);
  assert.deepEqual(report, { adjusted: 0, calories_delta: 0, rules: {} });
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

test('calories_macros: the lower side is exactly max(40, 20%) below the macros', () => {
  // expected 290: tolerance is max(40, 58) = 58
  assert.equal(one(ok({ calories: 290 - 58 })).items[0].calories, 232);
  const under = one(ok({ calories: 290 - 59 }));
  assert.equal(under.items[0].calories, 290);
  assert.equal(under.report.rules.calories_macros, 1);

  // small expected: the absolute 40 applies (expected 40 = 10 g carbs; weight 10 keeps the alcohol allowance at 24)
  const small = { weight_g: 10, protein_g: 0, carbs_g: 10, fat_g: 0, fiber_g: 0 };
  assert.equal(one({ ...small, calories: 0 }).items[0].calories, 0);
  assert.equal(one({ ...small, calories: 80 }).items[0].calories, 80);
  assert.equal(one({ ...small, calories: 81 }).items[0].calories, 40);
  assert.equal(one({ ...small, calories: 200 }).items[0].calories, 40);
});

test('calories_macros: the upper side adds ALCOHOL_KCAL_PER_G per gram; exactly on the limit stays', () => {
  // weight 100, expected 290: limit is 290 + max(40, 58, 2.4 * 100) = 530
  const item = (calories) => ok({ weight_g: 100, calories });
  assert.equal(one(item(530)).items[0].calories, 530);
  const over = one(item(531));
  assert.equal(over.items[0].calories, 290);
  assert.equal(over.report.rules.calories_macros, 1);

  // weight 0: the allowance is 0, so the limit is 290 + 58
  const noWeight = (calories) => ({ weight_g: 0, calories, protein_g: 20, carbs_g: 30, fat_g: 10, fiber_g: 3 });
  assert.equal(one(noWeight(348)).items[0].calories, 348);
  assert.equal(one(noWeight(349)).items[0].calories, 290);

  // a small allowance never shrinks the normal tolerance: weight 10 (allowance 24) and expected 40 give max(40, 8, 24) = 40
  const small = (calories) => ({ weight_g: 10, protein_g: 5, carbs_g: 5, fat_g: 0, fiber_g: 0, calories });
  assert.equal(one(small(80)).items[0].calories, 80);
  assert.equal(one(small(81)).items[0].calories, 40);
});

test('calories_macros: wine and beer keep the calories their carbs cannot explain', () => {
  const wine = { name: 'wine', weight_g: 150, calories: 125, protein_g: 0.1, carbs_g: 3.8, fat_g: 0, fiber_g: 0 };
  const beer = { name: 'beer', weight_g: 330, calories: 142, protein_g: 1.6, carbs_g: 11, fat_g: 0, fiber_g: 0 };
  const { items, report } = reconcileItems([wine, beer]);
  assert.deepEqual(items, [wine, beer]);
  assert.equal(report.adjusted, 0);
});

test('calories_macros: a spirit shot with no macros keeps its calories', () => {
  const shot = { name: 'vodka', weight_g: 44, calories: 100, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 };
  const { items, report } = one(shot);
  assert.deepEqual(items[0], shot);
  assert.equal(report.adjusted, 0);
});

test('calories_macros: 900 kcal on 100 g with macros worth 125 kcal is still corrected', () => {
  const { items, report } = one({ weight_g: 100, calories: 900, protein_g: 10, carbs_g: 10, fat_g: 5, fiber_g: 0 });
  assert.equal(items[0].calories, 125);
  assert.equal(report.rules.calories_macros, 1);
  assert.equal(report.rules.kcal_density, undefined);
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
  const b = ok({ name: 'b', calories: 1000 }); // calories_macros: 1000 -> 290 (the upper limit is 290 + 360 at 150 g)
  const c = ok({ name: 'c' }); // untouched
  const { items, report } = reconcileItems([a, b, c]);
  assert.equal(items[0].calories, 900);
  assert.equal(items[1].calories, 290);
  assert.deepEqual(report, { adjusted: 2, calories_delta: -100 + -710, rules: { kcal_density: 1, calories_macros: 1 } });
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
