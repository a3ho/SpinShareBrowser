'use strict';

// Run with Node 18+: node tests/test_auto_update.cjs. No browser or network is used.
// Regression guard: APP_CONFIG is frozen in production. The 2.3.3 toggle assigned
// APP_CONFIG.autoUpdateCharts directly — a silent no-op that made the checkbox snap
// back off after every click ("the switch cannot be operated"). These tests run the
// production block against a frozen APP_CONFIG, so the revert fails here.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {test} = require('node:test');

const web = path.join(__dirname, '..', 'web');
const appSource = fs.readFileSync(path.join(web, 'app.js'), 'utf8');

function extractBlock() {
  const from = appSource.indexOf('// APP_CONFIG is frozen at bootstrap');
  const to = appSource.indexOf('// Unified popover positioning engine', from);
  assert(from >= 0 && to > from, 'Missing auto-update block in app.js');
  return appSource.slice(from, to);
}

class Element {
  constructor() {
    this.events = new Map();
    this.checked = false;
    this.disabled = false;
  }
  addEventListener(name, callback) { this.events.set(name, callback); }
}

function harness({bootstrap = false, respondWith, rejectWith} = {}) {
  const box = new Element();
  const nodes = new Map([['settings-auto-update', box]]);
  const node = id => { if (!nodes.has(id)) nodes.set(id, new Element()); return nodes.get(id); };
  const posts = [];
  const context = vm.createContext({
    console,
    document: {getElementById: node, addEventListener() {}},
    APP_CONFIG: Object.freeze({autoUpdateCharts: bootstrap}),  // frozen, like production
    $: node,
    installerRequest: async (method, path, body) => {
      posts.push({method, path, body});
      if (rejectWith) throw rejectWith;
      return respondWith ? respondWith : {autoUpdateCharts: body.enabled};
    },
  });
  vm.runInContext(extractBlock(), context);
  vm.runInContext('setupAutoUpdate()', context);
  return {box, posts, context};
}

async function flip(box, checked) {
  box.checked = checked;
  await box.events.get('change')({target: box});
  await new Promise(resolve => setImmediate(resolve));
}

test('bootstrap value drives the checkbox before any interaction', () => {
  const off = harness({bootstrap: false});
  assert.equal(off.box.checked, false);
  const on = harness({bootstrap: true});
  assert.equal(on.box.checked, true, 'a stored true setting checks the box');
});

test('change events toggle the box and persist the confirmed value against frozen APP_CONFIG', async () => {
  const {box, posts} = harness({bootstrap: false});
  await flip(box, true);
  assert.equal(posts.length, 1, 'exactly one POST per change');
  assert.equal(posts[0].body.enabled, true);
  assert.equal(box.checked, true, 'the box must stay checked after the server confirms');
  assert.equal(box.disabled, false, 'the box re-enables after the round trip');
  await flip(box, false);
  assert.equal(posts[1].body.enabled, false);
  assert.equal(box.checked, false);
});

test('a failed POST keeps the last confirmed value and releases the busy flag', async () => {
  const {box, posts} = harness({bootstrap: true, rejectWith: new Error('offline')});
  assert.equal(box.checked, true);
  await flip(box, false);
  assert.equal(posts.length, 1);
  assert.equal(box.checked, true, 'a failed POST reverts to the last confirmed value');
  assert.equal(box.disabled, false, 'the busy flag releases after an error');
  await flip(box, false);
  assert.equal(posts.length, 2, 'the toggle keeps working after an error');
});
