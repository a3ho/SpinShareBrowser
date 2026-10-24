'use strict';

// Run with Node 18+: node tests/test_popover_engine.cjs. No browser or network is used.
// Regression guard: the engine's reposition() used to bail on document.hidden,
// so a popover opened while the window was backgrounded stayed at its CSS
// default position ("popover opens in the wrong place"). The engine must run
// its first synchronous positioning even when the page is hidden; only a zero
// viewport skips positioning.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {test} = require('node:test');

const web = path.join(__dirname, '..', 'web');
const appSource = fs.readFileSync(path.join(web, 'app.js'), 'utf8');

function extractEngine() {
  const from = appSource.indexOf('// Unified popover positioning engine');
  const to = appSource.indexOf('let userProfileCache=', from);
  assert(from >= 0 && to > from, 'Missing popover-engine block in app.js');
  return appSource.slice(from, to);
}

function fakeRect(x, y, w, h) {
  return {x, y, width: w, height: h, left: x, top: y, right: x + w, bottom: y + h};
}

function makeEnv({hidden = false, viewport = [1920, 1038], anchorRect, anchorConnected = true, popoverSize = [320, 200], onDismiss} = {}) {
  const popover = {
    style: {}, _open: false, offsetWidth: popoverSize[0], offsetHeight: popoverSize[1],
    showPopover() { this._open = true; },
    hidePopover() { this._open = false; },
    matches() { return this._open; },
  };
  const anchor = {
    isConnected: anchorConnected,
    getBoundingClientRect: () => fakeRect(...anchorRect),
  };
  const context = vm.createContext({
    console,
    __popover: popover,
    __anchor: anchor,
    __dismissed: [],
    document: {
      hidden,
      documentElement: {clientHeight: viewport[1]},
      getComputedStyle: () => ({getPropertyValue: () => '64px'}),
    },
    innerWidth: viewport[0],
    innerHeight: viewport[1],
    getComputedStyle: () => ({getPropertyValue: () => '64px'}),
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
  });
  vm.runInContext(extractEngine(), context);
  const engine = vm.runInContext(
    'createPopoverEngine({popover: __popover, getAnchor: () => __anchor, onDismiss: () => __dismissed.push(1)})',
    context,
  );
  return {engine, popover, anchor, dismissed: context.__dismissed};
}

test('hidden page still positions the popover on open (wrong-position regression)', () => {
  const {engine, popover} = makeEnv({hidden: true, anchorRect: [1618, 15, 84, 34]});
  engine.open();
  assert.equal(popover._open, true);
  const top = Number.parseInt(popover.style.top, 10);
  const left = Number.parseInt(popover.style.left, 10);
  // Anchor bottom = 49; the popover must sit 8px below it, not at a CSS default.
  assert.equal(top, 49 + 8, 'popover must open 8px under the anchor while the page is hidden');
  assert.equal(Number.parseInt(popover.style.left, 10), 1588, 'clamped to the right edge, still overlapping the chip');
});

test('popover opens below the anchor with the configured gap', () => {
  const {engine, popover} = makeEnv({anchorRect: [100, 200, 60, 30]});
  engine.open();
  assert.equal(Number.parseInt(popover.style.top, 10), 230 + 8);
});

test('popover flips above the anchor when below would overflow', () => {
  const {engine, popover} = makeEnv({anchorRect: [100, 900, 60, 30], popoverSize: [320, 200]});
  engine.open();
  // 930 + 8 + 200 > 1038 - 12 → flips above: top = 900 - 200 - 8 = 692.
  assert.equal(Number.parseInt(popover.style.top, 10), 692);
});

test('popover clamps to the window edge when the anchor is near the right', () => {
  const {engine, popover} = makeEnv({anchorRect: [1700, 15, 84, 34], popoverSize: [320, 200]});
  engine.open();
  assert.equal(Number.parseInt(popover.style.left, 10), 1920 - 320 - 12, 'clamped to innerWidth - width - edge');
});

test('dismissing a disconnected anchor closes the popover', () => {
  const env = makeEnv({anchorRect: [100, 200, 60, 30]});
  env.engine.open();
  assert.equal(env.popover._open, true);
  env.anchor.isConnected = false;
  env.engine.reposition();
  assert.equal(env.popover._open, false, 'a gone anchor dismisses');
  assert.equal(env.dismissed.length, 1, 'onDismiss runs once');
});

test('zero viewport skips positioning without crashing', () => {
  const {engine, popover} = makeEnv({viewport: [0, 0], anchorRect: [100, 200, 60, 30]});
  engine.open();
  assert.equal(popover._open, true);
  assert.equal(popover.style.top, undefined, 'no positioning with a zero viewport');
});

test('close() hides the popover and runs onDismiss once', () => {
  const env = makeEnv({anchorRect: [100, 200, 60, 30]});
  env.engine.open();
  env.engine.close();
  env.engine.close();
  assert.equal(env.popover._open, false);
  assert.equal(env.engine.isOpen(), false);
  assert.equal(env.dismissed.length, 1);
});
