/** The map's own colours: presets, and one derived from the restaurant's
 *  palette so the map matches the storefront it was opened from. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root = path.resolve('src');
const cache = new Map();
function load(filename) {
  const file = ['', '.ts'].map((ext) => filename + ext).find((p) => fs.existsSync(p) && fs.statSync(p).isFile());
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
const { mapStyle, MAP_STYLES, isMapStyleKey, paletteStyle } =
  load(path.join(root, 'features/storefront/mapStyles.ts'));

const forest = { brand: '#174D39', hero: '#102A1D', accent: '#F1C958', paper: '#FAF8F2', font_pair: 'default' };
const midnight = { ...forest, paper: '#181C1A' };
const geometryOf = (style, feature) =>
  style.find((r) => r.featureType === feature && r.elementType === 'geometry').stylers[0].color;

test('the keys the portal offers are the keys the server accepts', () => {
  // backend/app/services/maps.py holds the same four.
  assert.deepEqual(MAP_STYLES.map((s) => s.key), ['standard', 'light', 'dark', 'palette']);
  assert.equal(isMapStyleKey('dark'), true);
  assert.equal(isMapStyleKey('aubergine'), false);
});

test("the standard map is Google's own, which is no style at all", () => {
  assert.equal(mapStyle('standard', forest), null);
  assert.equal(mapStyle(null, forest), null);
});

test('light and dark do not need a palette', () => {
  assert.ok(mapStyle('light', null).length > 0);
  assert.equal(geometryOf(mapStyle('dark', null), 'water'), '#1A2426');
});

test('a palette map with no palette falls back rather than half-deriving', () => {
  assert.equal(mapStyle('palette', null), null);
});

test('the palette map is built from the storefront colours', () => {
  const style = paletteStyle(forest);
  // The ground is the restaurant's paper, and the water carries its brand.
  assert.equal(geometryOf(style, 'all'), forest.paper);
  assert.notEqual(geometryOf(style, 'water'), forest.paper);
  assert.notEqual(geometryOf(style, 'poi.park'), forest.paper);
});

test('a dark palette gets pale labels, a light one dark labels', () => {
  const ink = (style) =>
    style.find((r) => r.elementType === 'labels.text.fill').stylers[0].color;
  assert.equal(ink(paletteStyle(forest)), '#5C5B54');
  assert.equal(ink(paletteStyle(midnight)), '#C8CFC6');
});
