/** Where the sign-in pages send someone afterwards. Every case here is a
 *  value an attacker can put in ?next= on a link to our own sign-in page. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import ts from 'typescript';

const source = ts.transpileModule(fs.readFileSync('login/safe-next.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const mod = { exports: {} };
new Function('module', 'exports', source)(mod, mod.exports);
const { safeNextPath } = mod.exports;
globalThis.window = { location: { origin: 'https://spicehouse.zenoeats.com' } };

const next = (query) => safeNextPath(new URLSearchParams(query).get('next'), '/fallback');

test('ordinary paths go where they say, query and fragment kept', () => {
  assert.equal(next('next=/checkout'), '/checkout');
  assert.equal(next('next=' + encodeURIComponent('/profile?tab=favourites#top')), '/profile?tab=favourites#top');
});

test('another site is refused however it is spelled', () => {
  for (const q of [
    'next=https://evil.example',
    'next=//evil.example',
    'next=/%09/evil.example',   // tab, stripped by browsers: the bypass that was live
    'next=/%0A/evil.example',
    'next=/%0D/evil.example',
    'next=/%5Cevil.example',    // backslash
    'next=%2F%2Fevil.example',
    'next=/.//evil.example',    // resolves on-site to "//evil.example", protocol-relative
    'next=javascript:alert(1)',
    'next=evil.example',
    'next=',
  ]) {
    assert.equal(next(q), '/fallback', q);
  }
});

test('nothing at all is the fallback', () => {
  assert.equal(next(''), '/fallback');
});
