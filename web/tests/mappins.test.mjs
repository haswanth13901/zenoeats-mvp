/** The pins the delivery map draws: the restaurant's palette where it has
 *  one and it wants it, the platform's otherwise. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const file = path.resolve('src/features/storefront/theme.ts');
const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const module = { exports: {} };
new Function('require', 'module', 'exports', source)(() => {}, module, module.exports);
const { mapPins, DEFAULT_PINS, contrast } = module.exports;

const forest = { brand: '#174D39', hero: '#102A1D', accent: '#F1C958', paper: '#FAF8F2', font_pair: 'default' };

test('a restaurant with no palette keeps the platform pins', () => {
  assert.deepEqual(mapPins(null, true), DEFAULT_PINS);
});

test('turning it off keeps them too, palette or not', () => {
  assert.deepEqual(mapPins(forest, false), DEFAULT_PINS);
});

test('the palette paints the three pins', () => {
  const pins = mapPins(forest, true);
  assert.equal(pins.driver, forest.brand);
  assert.equal(pins.home, forest.accent);
  // Pale, not brand: two dark pins would compete on a dark map.
  assert.equal(pins.restaurant, forest.paper);
});

test('the arrow inside the driver reads against the brand behind it', () => {
  const dark = mapPins(forest, true);
  assert.equal(dark.onDriver, '#FFFFFF');
  const pale = mapPins({ ...forest, brand: '#F3E9C8' }, true);
  assert.equal(pale.onDriver, '#1D1B16');
  assert.ok(contrast(pale.onDriver, '#F3E9C8') >= 4.5);
});
