/** A combo's calories are added up from what the customer has chosen, and
 *  only when every one of those choices states a figure. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const file = path.resolve('src/features/cart/calories.ts');
const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const module = { exports: {} };
new Function('require', 'module', 'exports', source)(() => {}, module, module.exports);
const { comboCalories, kcal } = module.exports;

test('a figure is shown only where the restaurant stated one', () => {
  assert.equal(kcal(540), '540 kcal');
  assert.equal(kcal(0), '0 kcal');
  assert.equal(kcal(1250), '1,250 kcal');
  assert.equal(kcal(null), null);
  assert.equal(kcal(undefined), null);
});

test('the total is the chosen items added up', () => {
  assert.equal(comboCalories([{ calories: 540 }, { calories: 250 }, { calories: 0 }]), 790);
});

test('one choice with no figure means no total at all', () => {
  // Worse than showing nothing: 540 would read as the whole meal.
  assert.equal(comboCalories([{ calories: 540 }, { calories: null }]), null);
  assert.equal(comboCalories([{ calories: 540 }, {}]), null);
});

test('nothing chosen yet is not a total of zero', () => {
  assert.equal(comboCalories([]), null);
});
