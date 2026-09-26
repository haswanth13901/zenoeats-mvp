/** The guest's order-view token: read from the fragment (or, for older links,
 *  the query), taken out of the address bar, and kept for the tab. The token
 *  opens a pickup PIN for days, so where it travels is the point. */
import assert from 'node:assert/strict';
import { test, beforeEach } from 'node:test';
import fs from 'node:fs';
import ts from 'typescript';

function loadOrderToken() {
  const source = ts.transpileModule(fs.readFileSync('src/features/storefront/orderToken.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function('module', 'exports', source)(module, module.exports);
  return module.exports;
}

function browserAt(href) {
  const store = new Map();
  const location = new URL(href);
  const replaced = [];
  globalThis.window = {
    location,
    sessionStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
    },
    history: {
      state: null,
      replaceState: (_s, _t, url) => {
        replaced.push(url);
        const next = new URL(url, location.href);
        location.search = next.search;
        location.hash = next.hash;
      },
    },
  };
  return { replaced, store };
}

let takeOrderToken;
beforeEach(() => {
  ({ takeOrderToken } = loadOrderToken());
});

test('a token in the fragment is read and removed from the address bar', () => {
  const { replaced } = browserAt('https://spicehouse.zenoeats.com/orders/abc#t=TOKEN123');
  assert.equal(takeOrderToken(), 'TOKEN123');
  assert.deepEqual(replaced, ['/orders/abc']);
  assert.equal(window.location.hash, '');
});

test('it survives a reload of the same tab, from session storage', () => {
  browserAt('https://spicehouse.zenoeats.com/orders/abc#t=TOKEN123');
  takeOrderToken();
  assert.equal(takeOrderToken(), 'TOKEN123');
});

test('an older ?t= link still works, and is removed the same way', () => {
  const { replaced } = browserAt('https://spicehouse.zenoeats.com/orders/abc?t=OLD&x=1');
  assert.equal(takeOrderToken(), 'OLD');
  assert.deepEqual(replaced, ['/orders/abc?x=1']);
});

test('the rest of the fragment is kept', () => {
  const { replaced } = browserAt('https://spicehouse.zenoeats.com/orders/abc#t=TOKEN123&tab=items');
  takeOrderToken();
  assert.deepEqual(replaced, ['/orders/abc#tab=items']);
});

test("a token for one order is never offered for another", () => {
  const { store } = browserAt('https://spicehouse.zenoeats.com/orders/abc#t=TOKEN123');
  takeOrderToken();
  window.location.pathname = '/orders/other';
  window.location.hash = '';
  assert.equal(takeOrderToken(), null);
  assert.equal(store.size, 1);
});

test('no token anywhere is no token', () => {
  browserAt('https://spicehouse.zenoeats.com/orders/abc');
  assert.equal(takeOrderToken(), null);
});
