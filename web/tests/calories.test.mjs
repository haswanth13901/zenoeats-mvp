/** Calories follow the choices, the same way the price does: an item states
 *  what it contains as it comes, a size states what it changes that by, and
 *  a combo adds up what was actually chosen. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root = path.resolve('src');
const cache = new Map();
function load(filename) {
  const file = ['', '.ts'].map((ext) => filename + ext).find((p) => fs.existsSync(p) && fs.statSync(p).isFile());
  if (!file) throw new Error(`Missing test module: ${filename}`);
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} };
  cache.set(file, module);
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const local = (id) =>
    id.startsWith('@/') ? load(path.join(root, id.slice(2)))
      : id.startsWith('.') ? load(path.resolve(path.dirname(file), id))
        : require(id);
  new Function('require', 'module', 'exports', source)(local, module, module.exports);
  return module.exports;
}
const { comboCalories, kcal, selectionCalories, canAddCalories } =
  load(path.join(root, 'features/cart/calories.ts'));

/** Fries as the menu carries them: 310 as it comes, sizes that add. */
const small = { id: 'small', name: 'Small', price_delta_minor: 0, calories_delta: 0, is_available: true, image_url: null };
const large = { id: 'large', name: 'Large', price_delta_minor: 50, calories_delta: 230, is_available: true, image_url: null };
const noSalt = { id: 'nosalt', name: 'No salt', price_delta_minor: 0, calories_delta: null, is_available: true, image_url: null };
const fries = {
  id: 'fries', name: 'Fries', item_type_id: 'sides', description: null, calories: 310,
  base_price_minor: 200, currency: 'USD', is_available: true, image_url: null,
  included_option_ids: ['small'],
  modifier_groups: [{ id: 'size', name: 'Size', selection_type: 'SINGLE', is_required: true, min_select: 1, max_select: 1, options: [small, large, noSalt] }],
};
const drink = { ...fries, id: 'drink', name: 'Coke', calories: 140, included_option_ids: [], modifier_groups: [] };
const unstated = { ...drink, id: 'mystery', name: 'Special', calories: null };
const pick = (...options) => new Map([['Size', options]]);

test('a figure is shown only where the restaurant stated one', () => {
  assert.equal(kcal(540), '540 kcal');
  assert.equal(kcal(1250), '1,250 kcal');
  assert.equal(kcal(null), null);
  assert.equal(kcal(undefined), null);
});

test('the size chosen decides the figure', () => {
  assert.equal(selectionCalories(fries, pick(large)), 540);
  assert.equal(selectionCalories(fries, new Map()), 310);
});

test('what the item comes with adds nothing, as with the price', () => {
  // Small is included: it is already part of the 310 the item states.
  assert.equal(selectionCalories(fries, pick(small)), 310);
});

test('a choice stating no change adds nothing', () => {
  assert.equal(selectionCalories(fries, pick(large, noSalt)), 540);
});

test('an item that states no figure has none however it is configured', () => {
  assert.equal(selectionCalories(unstated, pick(large)), null);
});

test('the card says "from" only when a choice can raise the figure', () => {
  assert.equal(canAddCalories(fries), true);
  assert.equal(canAddCalories(drink), false);
});

test('a combo adds up the choices as configured', () => {
  const total = comboCalories([
    { item: fries, selected: pick(large) },
    { item: drink, selected: new Map() },
  ]);
  assert.equal(total, 680);
});

test('one choice with no figure means no total at all', () => {
  // Worse than showing nothing: 540 would read as the whole meal.
  assert.equal(comboCalories([{ item: fries, selected: pick(large) }, { item: unstated, selected: new Map() }]), null);
});

test('nothing chosen yet is not a total of zero', () => {
  assert.equal(comboCalories([]), null);
});
