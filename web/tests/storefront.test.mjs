/** Render the real presentation components without adding a test framework.
 * TypeScript and React already ship with this project; this tiny loader only
 * resolves the same local aliases that Vite resolves in the browser. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
const root = path.resolve('src');
const cache = new Map();
function load(filename) {
  const file = ['', '.ts', '.tsx'].map((ext) => filename + ext).find((p) => fs.existsSync(p) && fs.statSync(p).isFile());
  if (!file) throw new Error(`Missing test module: ${filename}`);
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} }; cache.set(file, module);
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const local = (id) => id.startsWith('@/') ? load(path.join(root, id.slice(2))) : id.startsWith('.') ? load(path.resolve(path.dirname(file), id)) : require(id);
  new Function('require', 'module', 'exports', source)(local, module, module.exports);
  return module.exports;
}
const theme = load(path.join(root, 'features/storefront/theme.ts'));
const presentation = load(path.join(root, 'features/storefront/components/HomePresentation.tsx'));
globalThis.document = { hidden: false };
globalThis.window = { matchMedia: () => ({ matches: true }) };
const restaurant = { name: 'Test Kitchen', tagline: 'Made here', delivery_offered: false };
const meals = [{ id: 'lunch', combos: [], sections: [
  { item_type_id: 'food', label: 'Food', groups: [], items: [{ id: 'dish', name: 'Dish', image_url: '/dish.webp', is_available: true }] },
  { item_type_id: 'drinks', label: 'Drinks', groups: [], items: [{ id: 'drink', name: 'Drink', image_url: null, is_available: true }] },
] }];
const render = (component, props) => renderToStaticMarkup(React.createElement(component, props));

test('gate-off and empty slides render the identical fallback banner', () => {
  const props = { restaurant, photo: presentation.heroPhoto(meals) };
  const original = render(presentation.HomeBanner, props);
  assert.equal(render(presentation.HomeBanner, { ...props, storefront: null }), original);
  assert.equal(render(presentation.HomeBanner, { ...props, storefront: { banners: [], banner_interval_ms: 2000 } }), original);
  assert.match(original, /src="\/dish.webp"/);
  assert.doesNotMatch(original, /carousel|Pause slides/);
  assert.deepEqual(theme.themeVariables(null), {});
});

test('category visibility changes shortcuts only; own photo wins and order follows types', () => {
  const unchanged = JSON.stringify(meals);
  const output = render(presentation.CategoryShortcuts, { meals, severalPeriods: false, categories: { food: { image_url: '/category.webp', show_in_shortcuts: true, sort_order: 2 }, drinks: { image_url: null, show_in_shortcuts: true, sort_order: 1 } } });
  assert.match(output, /src="\/category.webp"/);
  assert.ok(output.indexOf('Drinks') < output.indexOf('Food'));
  const hidden = render(presentation.CategoryShortcuts, { meals, severalPeriods: false, categories: { food: { show_in_shortcuts: false } } });
  assert.doesNotMatch(hidden, />Food</);
  assert.equal(JSON.stringify(meals), unchanged);
});

test('carousel has labelled manual controls and only the current slide image', () => {
  const banners = [1, 2, 3].map((n) => ({ id: String(n), image_url: `/banner-${n}.webp`, headline: `Headline ${n}`, subline: 'Subline', cta_label: 'Order', cta_target_kind: 'menu', cta_target_id: null, focal_x: 50, focal_y: 60, zoom: 100 }));
  const html = render(presentation.HomeBanner, { restaurant, photo: null, storefront: { banners, banner_interval_ms: 5000 } });
  assert.match(html, /aria-roledescription="carousel"/);
  assert.match(html, /Slide 2 of 3/);
  // No pause button: hover, focus, a hidden tab and reduced motion stop the
  // slides, and the dots move between them.
  assert.doesNotMatch(html, /Pause slides|Play slides/);
  assert.equal((html.match(/<h1/g) ?? []).length, 1);
  assert.match(html, /Headline 1/);
  assert.doesNotMatch(html, /src="\/banner-2.webp"|aria-live/);
});

test('each banner is framed by its own focal point and zoom', () => {
  const slide = { id: '1', image_url: '/banner-1.webp', headline: 'H', subline: 'S', cta_label: 'Order', cta_target_kind: 'menu', cta_target_id: null, focal_x: 20, focal_y: 85, zoom: 160 };
  const html = render(presentation.HomeBanner, { restaurant, photo: null, storefront: { banners: [slide], banner_interval_ms: 5000 } });
  assert.match(html, /object-position:20% 85%/);
  assert.match(html, /scale\(1.6\)/);
  assert.match(html, /transform-origin:20% 85%/);

  // A photo left alone carries no transform at all.
  const plain = render(presentation.HomeBanner, { restaurant, photo: null, storefront: { banners: [{ ...slide, focal_x: 50, focal_y: 60, zoom: 100 }], banner_interval_ms: 5000 } });
  assert.match(plain, /object-position:50% 60%/);
  assert.doesNotMatch(plain, /scale\(/);
});

test('every preset meets the same contrast pairs as the server', () => {
  for (const palette of theme.PALETTES) {
    for (const check of theme.contrastResults(palette.theme)) {
      assert.ok(check.ratio >= 4.5, `${palette.name}: ${check.name} (${check.ratio})`);
    }
    assert.notEqual(theme.themeVariables(palette.theme)['--ze-brand-hover'], theme.themeVariables(palette.theme)['--ze-brand']);
  }
});
