/** The profile page's two account controls: where the email action sits, and
 *  who is offered the account closure. Rendered with the same loader the
 *  storefront test uses. */
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
  const module = { exports: {} };
  cache.set(file, module);
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const local = (id) =>
    id.startsWith('@/') ? load(path.join(root, id.slice(2)))
      : id.startsWith('.') ? load(path.resolve(path.dirname(file), id))
        : require(id);
  new Function('require', 'module', 'exports', source)(local, module, module.exports);
  return module.exports;
}

const { ContactFields } = load(path.join(root, 'features/storefront/components/ContactFields'));
const contact = { full_name: 'Avinash', phone: '', address: '' };
const render = (component, props) => renderToStaticMarkup(React.createElement(component, props));

test('the email action sits with the email, not at the foot of the card', () => {
  const markup = render(ContactFields, {
    contact,
    onChange: () => {},
    errors: {},
    email: 'avinash@example.com',
    emailHint: 'The email you sign in with.',
    emailAction: React.createElement('button', { type: 'button' }, 'Change'),
  });
  // The action is inside the email label, above the input that holds the
  // address it acts on.
  const label = markup.slice(markup.indexOf('Email'), markup.indexOf('avinash@example.com'));
  assert.ok(label.includes('Change'), 'the action belongs beside the email');
});

test('without an action the email field is unchanged', () => {
  const markup = render(ContactFields, {
    contact,
    onChange: () => {},
    errors: {},
    email: 'avinash@example.com',
  });
  assert.ok(markup.includes('avinash@example.com'));
  assert.ok(!markup.includes('<button'), 'no action, no button');
});
