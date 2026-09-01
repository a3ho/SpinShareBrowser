'use strict';

// Run with Node 18+: node tests/test_focus_modality.cjs. No browser or network is used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {readWebTemplate} = require('./read_web_template.cjs');

const html = readWebTemplate();
const css = fs.readFileSync(path.join(__dirname, '..', 'web', 'interface.css'), 'utf8');
const start = html.indexOf('function setupInputModality(');
const end = html.indexOf('function motionAllowed(', start);
assert(start >= 0 && end > start, 'The production input-modality controller must exist');

const listeners = new Map();
const root = {dataset: {}};
const context = {
  document: {documentElement: root},
  addEventListener(name, callback, options) { listeners.set(name, {callback, options}); },
};
context.globalThis = context;
const api = vm.createContext(context);
vm.runInContext(html.slice(start, end), api);
api.setupInputModality();

assert.equal(root.dataset.inputModality, 'keyboard');
assert.equal(listeners.get('pointerdown').options.capture, true);
assert.equal(listeners.get('pointerdown').options.passive, true);
listeners.get('pointerdown').callback({pointerType: 'mouse'});
assert.equal(root.dataset.inputModality, 'pointer', 'Pointer focus must not leave a persistent focus ring');
for (const key of ['Alt', 'Control', 'Meta', 'Shift', 'Escape', 'ArrowDown', 'Enter', ' ']) {
  listeners.get('keydown').callback({key});
  assert.equal(root.dataset.inputModality, 'pointer', `${JSON.stringify(key)} does not move focus to another control`);
}
for (const shiftKey of [false, true]) {
  listeners.get('pointerdown').callback({pointerType: 'mouse'});
  listeners.get('keydown').callback({key: 'Tab', shiftKey});
  assert.equal(root.dataset.inputModality, 'keyboard', `${shiftKey ? 'Shift+Tab' : 'Tab'} restores keyboard focus feedback`);
}

assert.match(css, /select:focus-visible\s*\{[^}]*outline:\s*1px solid var\(--focus-ring\);[^}]*outline-offset:\s*0;/s,
  'Every native select uses the compact one-pixel focus treatment');
assert.match(css, /html\[data-input-modality=pointer\][^{]*select:focus[^{]*\{\s*outline:\s*none;/s,
  'Pointer-focused selects explicitly suppress Chromium/WebView focus retention');
assert.doesNotMatch(css, /select:focus-visible[^{}]*\{[^}]*outline:\s*2px/s,
  'No native select may retain the old heavy two-pixel ring');
assert.match(css, /\.field input:focus\s*\{[^}]*border-color:\s*var\(--focus-ring\)/s,
  'Editable filter fields keep a thin pointer editing boundary');
assert.match(css, /\.page-jump input:focus\s*\{[^}]*border-color:\s*var\(--focus-ring\)/s,
  'The page field keeps a thin pointer editing boundary');
assert.match(css, /\.tag-input:focus\s*\{[^}]*border-color:\s*var\(--focus-ring\)/s,
  'The tag editor keeps a thin pointer editing boundary');
assert.match(html, /documentElement\.dataset\.inputModality==='keyboard'&&button\.matches\(':focus-visible'\)/,
  'Help popovers retain pointer focus only for genuine keyboard navigation');
assert.match(html, /documentElement\.dataset\.inputModality==='keyboard'&&focused\?\.matches\(':focus-visible'\)/,
  'Tag popovers retain pointer focus only for genuine keyboard navigation');
for (const id of ['ui-language', 'date-preset', 'installation-filter', 'sort', 'sort-direction', 'page-size', 'page-size-bottom', 'settings-language']) {
  assert.match(html, new RegExp(`<select id="${id}"`), `Global select policy covers #${id}`);
}
for (const className of ['calendar-year', 'calendar-month']) {
  assert.match(html, new RegExp(`element\\('select',undefined,'${className}'\\)`), `Global select policy covers .${className}`);
}

console.log('focus modality: PASS');
