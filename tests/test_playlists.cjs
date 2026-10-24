'use strict';

// Run with Node 18+: node tests/test_playlists.cjs. No browser or network is used.
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
    this.tagName = String(tag).toLowerCase();
    this.children = [];
    this.attributes = new Map();
    this.events = new Map();
    this.className = '';
    this.dataset = {};
    this.style = {setProperty() {}, getPropertyValue: () => ''};
    this._hidden = false;
    this.disabled = false;
    this.value = '';
    this.type = '';
    this.checked = false;
    this._text = '';
    this.classList = {
      add: name => { if (!this.className.split(/\s+/).includes(name)) this.className = (this.className + ' ' + name).trim(); },
      remove: name => { this.className = this.className.split(/\s+/).filter(c => c !== name).join(' '); },
      contains: name => this.className.split(/\s+/).includes(name),
      toggle: (name, force) => { const on = force === undefined ? !this.classList.contains(name) : Boolean(force); this.classList[on ? 'add' : 'remove'](name); return on; },
    };
  }
  get hidden() { return this._hidden; }
  set hidden(value) { this._hidden = Boolean(value); }
  set textContent(value) { this.replaceChildren(); this._text = String(value ?? ''); }
  get textContent() { return this._text + this.children.map(child => child.textContent || '').join(''); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  append(...nodes) { for (const node of nodes) { if (node && typeof node === 'object') { node.parentElement = this; this.children.push(node); } } }
  appendChild(node) { this.append(node); return node; }
  replaceChildren() { this.children = []; this._text = ''; }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(c => c !== this); }
  querySelector(selector) { return this._query(selector, false); }
  querySelectorAll(selector) { return this._query(selector, true); }
  _query(selector, all) {
    const wanted = selector.startsWith('.') ? selector.slice(1) : selector;
    const found = [];
    const visit = node => {
      for (const child of node.children || []) {
        if (child.classList && child.classList.contains(wanted)) found.push(child);
        visit(child);
      }
    };
    visit(this);
    return all ? found : found[0] || null;
  }
  matches(selector) { return selector.startsWith('.') ? this.classList.contains(selector.slice(1)) : false; }
  getBoundingClientRect() { return { left: 400, right: 480, top: 200, bottom: 226, width: 80, height: 26 }; }
  get isConnected() { return true; }
  addEventListener(name, callback) { this.events.set(name, callback); }
  emit(name, event = {}) { const handler = this.events.get(name); if (handler) handler(event); }
  focus() {}
}

function harness(options = {}) {
  const requests = [];
  const responses = new Map(options.responses || []);
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, new Element());
    return nodes.get(id);
  };
  const context = vm.createContext({
    __popoverMock: (() => { const picker = node('playlist-picker'); picker._open = false; picker.showPopover = () => { picker._open = true; }; picker.hidePopover = () => { picker._open = false; }; picker.matches = selector => selector === ':popover-open' ? picker._open : Element.prototype.matches.call(picker, selector); return picker; })(),
    TextDecoder, AbortController, URL, console,
    __SPINSHARE_UI_CATALOG__: catalog,
    document: {getElementById: node, addEventListener() {}, documentElement: new Element(), hidden: false},
    innerWidth: 1280, innerHeight: 720,
    addEventListener() {},
    cardViews: new Map(),
    playlistFilter: null,
    sessionConnected: options.connected === false ? () => false : () => true,
    installerRequest(method, path, body) {
      requests.push({method, path, body});
      if (responses.has(path)) return Promise.resolve(typeof responses.get(path) === 'function' ? responses.get(path)(body) : responses.get(path));
      return Promise.resolve({});
    },
    m: key => key, number: value => String(value),
    uiText: (target, value) => { if (target) target.textContent = value; },
    uiAttr: (target, name, value) => { if (target) target.setAttribute(name, value); },
    errorText: error => String(error?.uiMessage || error?.message || error),
    uiError: message => Object.assign(new Error(String(message)), {uiMessage: String(message)}),
    $: node,
    element: (tag, text, className) => { const el = new Element(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el; },
    icon: () => new Element('svg'),
    focusResults() {}, scrollBatchSize: 20, page: 1, visibleCount: 20,
    getComputedStyle: () => ({ getPropertyValue: () => '64' }),
    createPopoverEngine: (opts) => {
      const engine = {
        open: () => { if (opts.popover.showPopover) opts.popover.showPopover(); },
        close: () => { if (opts.popover.hidePopover) opts.popover.hidePopover(); },
        reposition: () => {}, isOpen: () => true,
      };
      return engine;
    },
    requestAnimationFrame: () => 0,
    cancelAnimationFrame() {},
    rebuild() {}, renderPlaylistFilterBar() {}, renderPlaylistsPanel() {}, refreshPlaylistButtons() {},
  });
  vm.runInContext(extract('let myPlaylists=', 'function setupPlaylists('), context);
  const run = (expression, values = {}) => { Object.assign(context, values); return vm.runInContext(expression, context); };
  return {context, node, nodes, requests, run, responses};
}

test('playlist list loads, caches, and renders rows with counts', async () => {
  const h = harness({responses: [['/v1/playlists', {playlists: [
    {id: 827, title: '1', songs: 3, cover: 'https://spinsha.re/uploads/cover/x.png'},
    {id: 900, title: 'Rave night', songs: 1, cover: null},
  ]}]]});
  await h.run('fetchMyPlaylists(true)');
  assert.equal(h.requests.length, 1);
  await h.run('fetchMyPlaylists()');
  assert.equal(h.requests.length, 1, 'fresh cache avoids a second request');
  h.run('renderPlaylistsPanel()');
  const rows = h.node('playlists-list').children;
  assert.equal(rows.length, 2);
  assert.equal(rows[0].querySelector('playlists-title').textContent, '1');
  assert.equal(rows[0].querySelector('playlists-count').textContent, '3 songs');
  assert.equal(rows[1].querySelector('playlists-count').textContent, '1 song');
});

test('create posts the title and appends the created playlist', async () => {
  const h = harness({responses: [
    ['/v1/playlists', {playlists: []}],
    ['/v1/playlists/create', {playlist: {id: 950, title: '测试歌单', songs: 0, cover: null}}],
  ]});
  await h.run('fetchMyPlaylists(true)');
  const created = await h.run('createPlaylist("  测试歌单  ")');
  assert.equal(created.id, 950);
  assert.equal(h.requests.at(-1).method, 'POST');
  assert.equal(h.requests.at(-1).path, '/v1/playlists/create');
  assert.equal(h.requests.at(-1).body.title, '测试歌单');
  h.run('renderPlaylistsPanel()');
  assert.equal(h.node('playlists-list').children.length, 1);
});

test('delete posts the id and drops it from the cached list', async () => {
  const h = harness({responses: [['/v1/playlists', {playlists: [{id: 827, title: '1', songs: 0, cover: null}]}]]});
  await h.run('fetchMyPlaylists(true)');
  await h.run('deletePlaylist(827)');
  assert.equal(h.requests.at(-1).method, 'POST');
  assert.equal(h.requests.at(-1).path, '/v1/playlists/delete');
  assert.equal(h.requests.at(-1).body.playlistId, 827);
  assert.equal(h.run('myPlaylists.length'), 0);
});

test('picker opens instantly, confirms membership in place, and saves', async () => {
  const h = harness({responses: [
    ['/v1/playlists', {playlists: [{id: 827, title: '1', songs: 1, cover: null}, {id: 830, title: 'Two', songs: 0, cover: null}]}],
    ['/v1/playlists/827', {id: 827, title: '1', songIds: [15188]}],
    ['/v1/playlists/830', {id: 830, title: 'Two', songIds: []}],
    ['/v1/playlists/song', {playlists: [{id: 827, title: '1', songs: 1, cover: null}, {id: 830, title: 'Two', songs: 1, cover: null}]}],
  ]});
  await h.run('fetchMyPlaylists(true)');
  const row = [15188, 'Song', '', '', '', '2026-01-01', [[4, 20]], 20, {}];
  const anchor = new Element('button');
  h.run('openPlaylistPicker(__row,__anchor)', {__row: row, __anchor: anchor});
  // The picker is open before any detail request resolves.
  let boxes = h.node('playlist-picker-list').children.filter(child => child.tagName === 'label');
  assert.equal(boxes.length, 2, 'picker renders from the cached list immediately');
  // Let the background membership refresh settle.
  await new Promise(resolve => setImmediate(resolve));
  boxes = h.node('playlist-picker-list').children.filter(child => child.tagName === 'label');
  assert.equal(boxes[0].children[0].checked, true, 'song is already in playlist 827');
  assert.equal(boxes[1].children[0].checked, false);
  // Toggle: remove from 827, add to 830.
  h.run('playlistPickerState.checks.set(827,false);playlistPickerState.checks.set(830,true)');
  await h.run('savePlaylistPicker()');
  assert.equal(h.requests.at(-1).method, 'POST');
  assert.equal(h.requests.at(-1).path, '/v1/playlists/song');
  assert.equal(h.requests.at(-1).body.songId, 15188);
  assert.equal(h.requests.at(-1).body.playlistIds[0], 830);
  assert.equal(h.requests.at(-1).body.playlistIds.length, 1);
  assert.equal(h.run('myPlaylists.find(p=>p.id===830).songs'), 1);
});

test('picker keeps user toggles over a late membership refresh', async () => {
  const h = harness({responses: [
    ['/v1/playlists', {playlists: [{id: 827, title: '1', songs: 1, cover: null}]}],
    ['/v1/playlists/827', {id: 827, title: '1', songIds: [15188]}],
  ]});
  await h.run('fetchMyPlaylists(true)');
  const row = [15188, 'Song', '', '', '', '2026-01-01', [[4, 20]], 20, {}];
  h.run('openPlaylistPicker(__row,__anchor)', {__row: row, __anchor: new Element('button')});
  // The user unchecks before the background refresh lands.
  h.run('playlistPickerState.checks.set(827,false);playlistPickerState.touched.add(827)');
  await new Promise(resolve => setImmediate(resolve));
  const boxes = h.node('playlist-picker-list').children.filter(child => child.tagName === 'label');
  assert.equal(boxes[0].children[0].checked, false, 'the user toggle wins over the refresh');
});

test('picker new-playlist flow creates and pre-checks the fresh list', async () => {
  const h = harness({responses: [
    ['/v1/playlists', {playlists: []}],
    ['/v1/playlists/create', {playlist: {id: 970, title: 'New', songs: 0, cover: null}}],
  ]});
  await h.run('fetchMyPlaylists(true)');
  const row = [42, 'Song', '', '', '', '2026-01-01', [[4, 20]], 20, {}];
  h.run('showPlaylistPicker(__anchor, __row, new Set(), false)', {__row: row, __anchor: new Element('button')});
  const created = await h.run('createPlaylist("New")');
  assert.equal(created.id, 970);
  h.run('attachPickerCreate(__created)', {__created: created});
  assert.equal(h.run('playlistPickerState.checks.get(970)'), true, 'a playlist created from the picker is pre-checked');
});

test('playlist filter bar renders the chip and clears it', async () => {
  const h = harness();
  h.run('playlistFilter={id:827,title:"1",songIds:new Set([1,2,3])}');
  h.run('renderPlaylistFilterBar()');
  const bar = h.node('playlist-filter-bar');
  assert.equal(bar.hidden, false);
  assert.equal(bar.children.length, 1);
  assert.match(bar.children[0].querySelector('playlist-chip-label').textContent, /1 \(3\)/);
  h.run('clearPlaylistFilter()');
  assert.equal(h.run('playlistFilter'), null);
  assert.equal(h.node('playlist-filter-bar').hidden, true);
});

test('session gating hides the entry and refuses panel opens', async () => {
  const h = harness({connected: false});
  h.run('syncPlaylistsUI()');
  h.run('renderPlaylistsPanel()');
  assert.match(h.node('playlists-list').children[0].textContent, /Sign in/);
  await h.run('fetchMyPlaylists(true)');
  assert.equal(h.requests.length, 0, 'no requests while signed out');
});
