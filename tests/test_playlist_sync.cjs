'use strict';

// Run with Node 18+: node tests/test_playlist_sync.cjs. No browser or network is used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {test} = require('node:test');

const web = path.join(__dirname, '..', 'web');
const appSource = fs.readFileSync(path.join(web, 'app.js'), 'utf8');
const catalog = JSON.parse(fs.readFileSync(path.join(web, 'locales.json'), 'utf8'));

function extract(start, end) {
  const from = appSource.indexOf(start), to = appSource.indexOf(end, from);
  assert(from >= 0 && to > from, `Missing production block: ${start}`);
  return appSource.slice(from, to);
}

class Element {
  constructor(tag = 'div') {
    this.tagName = tag; this.children = []; this.attributes = new Map(); this.events = new Map();
    this.className = ''; this.dataset = {}; this._hidden = false; this.disabled = false; this.value = '';
    this.classList = {add() {}, remove() {}, contains: () => false, toggle() {}};
  }
  get hidden() { return this._hidden; }
  set hidden(value) { this._hidden = Boolean(value); }
  set textContent(value) { this._text = String(value ?? ''); this.children = []; }
  get textContent() { return (this._text || '') + this.children.map(c => c.textContent || '').join(''); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  append(...nodes) { for (const node of nodes) this.children.push(node); }
  replaceChildren() { this.children = []; }
  addEventListener(name, callback) { this.events.set(name, callback); }
  focus() {}
}

function harness(options = {}) {
  const nodes = new Map();
  const node = id => { if (!nodes.has(id)) nodes.set(id, new Element()); return nodes.get(id); };
  const dialog = node('playlist-sync-dialog');
  dialog.showModal = () => { dialog._open = true; };
  dialog.close = () => { dialog._open = false; };
  const started = [];
  const requests = [];
  const gaps = [];
  let pendingSongs = new Set(options.initiallyPending || []);
  let stopAfter = Infinity;
  const context = vm.createContext({
    TextDecoder, AbortController, URL, console,
    __SPINSHARE_UI_CATALOG__: catalog,
    document: {getElementById: node, addEventListener() {}},
    $: node,
    m: key => key, number: value => String(value),
    uiText: (target, value) => { if (target) target.textContent = value; },
    uiAttr: (target, name, value) => { if (target) target.setAttribute(name, value); },
    element: (tag, text, className) => { const el = new Element(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el; },
    catalog: options.catalog || [
      {id: 1, title: 'A', fileReference: 'spinshare_a', updateHash: 'a'.repeat(32), hasEasyDifficulty: true, easyDifficulty: 3, uploadDate: {date: '2026-01-01'}},
      {id: 2, title: 'B', fileReference: 'spinshare_b', updateHash: 'b'.repeat(32), hasNormalDifficulty: true, normalDifficulty: 5, uploadDate: {date: '2026-01-02'}},
      {id: 3, title: 'C', fileReference: 'spinshare_c', updateHash: 'c'.repeat(32), hasHardDifficulty: true, hardDifficulty: 8, uploadDate: {date: '2026-01-03'}},
    ],
    compact: (data, criteria) => data.map(song => {
      const diffs = []; const keys = [['hasEasyDifficulty','easyDifficulty'],['hasNormalDifficulty','normalDifficulty'],['hasHardDifficulty','hardDifficulty'],['hasExpertDifficulty','expertDifficulty'],['hasXDDifficulty','XDDifficulty']];
      keys.forEach(([flag, key], index) => { if (song[flag] && criteria.diffs.includes(index)) diffs.push([index, song[key]]); });
      return [song.id, song.title, '', '', '', '2026-01-01', diffs, diffs[0]?.[1] ?? 0, {fileReference: song.fileReference, updateHash: song.updateHash, dlc: song.dlc || null}];
    }),
    installDirectoryConfirmed: true,
    settingsRevision: 'f'.repeat(32),
    installationStates: new Map(),
    installationPending: songId => pendingSongs.has(songId),
    startInstallation: row => {
      started.push(row[0]);
      if (started.length >= stopAfter) return;
      // Simulate an installation that finishes on the next poll tick.
      pendingSongs.add(row[0]);
      setImmediate(() => pendingSongs.delete(row[0]));
    },
    appExiting: false,
    refreshInstallationChecks() {},
    requestInstallation() {},
    playlistHint() {},
    playlistDetailCached: async playlistId => ({id: playlistId, title: 'List', songIds: options.playlistSongs || [1, 2, 3, 4242]}),
    installerRequest: async (method, requestPath, body) => {
      requests.push({method, path: requestPath, body});
      if (requestPath === '/v1/installations/check') {
        const states = {};
        for (const chart of body.charts) states[String(chart.songId)] = options.installed?.includes(chart.songId) ? true : false;
        return {charts: states};
      }
      return {};
    },
    setTimeout: (callback, delay) => { gaps.push(delay); callback(); return gaps.length; },
    setInterval: (callback) => { const timer = setInterval(callback, 1); return timer; },
    clearInterval: timer => clearInterval(timer),
  });
  vm.runInContext(extract('let playlistSync=null;', 'function setupPlaylistSync('), context);
  const run = (expression, values = {}) => { Object.assign(context, values); return vm.runInContext(expression, context); };
  return {context, node, nodes, started, requests, gaps, run, stopWhen: count => { stopAfter = count; }};
}

test('preview diffs against installed presence and catalog coverage', async () => {
  const h = harness({installed: [2], playlistSongs: [1, 2, 3, 4242]});
  await h.run('openPlaylistSync(827)');
  assert.equal(h.run('playlistSync.rows.length'), 2, 'installed song 2 is skipped');
  assert.equal(h.run('playlistSync.rows.map(r=>r[0]).join(",")'), '1,3');
  assert.equal(h.run('playlistSync.skipped'), 1);
  assert.equal(h.run('playlistSync.unavailable.length'), 1, 'song 4242 is not in the catalog');
  const check = h.requests.find(r => r.path === '/v1/installations/check');
  assert.equal(check.body.charts.length, 3);
});

test('the loop installs serially with spacing and reports completion', async () => {
  const h = harness({playlistSongs: [1, 2, 3]});
  await h.run('openPlaylistSync(827)');
  const done = h.run('runPlaylistSync()');
  await done;
  assert.equal(h.started.join(','), '1,2,3', 'each song is installed exactly once, in order');
  assert.equal(h.gaps.filter(delay => delay === 1200).length, 2, 'a fixed gap separates submissions');
  assert.equal(h.run('playlistSync.running'), false);
  assert.equal(h.run('playlistSync.started'), true);
});

test('stop halts future installs but never kills the in-flight one', async () => {
  const h = harness({playlistSongs: [1, 2, 3]});
  await h.run('openPlaylistSync(827)');
  const done = h.run('runPlaylistSync()');
  // Stop as soon as the first installation starts.
  await new Promise(resolve => setImmediate(resolve));
  h.run('stopPlaylistSync()');
  await done;
  assert.equal(h.started.join(','), '1', 'no further submissions after stopping');
  assert.equal(h.run('playlistSync.stopping'), true);
  assert.equal(h.run('playlistSync.running'), false);
});

test('unconfirmed install directory blocks the sync entry', async () => {
  const h = harness({playlistSongs: [1]});
  h.run('installDirectoryConfirmed=false');
  let asked = 0;
  h.run('requestInstallation=()=>{globalThis.__asked=(globalThis.__asked||0)+1;}', {});
  await h.run('openPlaylistSync(827)');
  assert.equal(h.run('playlistSync'), null, 'no sync state is created');
  assert.equal(h.requests.filter(r => r.path === '/v1/installations/check').length, 0);
});
