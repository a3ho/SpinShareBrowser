'use strict';

// Run with Node 18+: node tests/test_reviews_write.cjs. No browser or network is used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {test} = require('node:test');

const web = path.join(__dirname, '..', 'web');
const appSource = fs.readFileSync(path.join(web, 'app.js'), 'utf8');
const moduleSource = fs.readFileSync(path.join(web, 'src', 'js', 'reviews-write.js'), 'utf8');
const catalog = JSON.parse(fs.readFileSync(path.join(web, 'locales.json'), 'utf8'));

function extract(start, end) {
  const from = appSource.indexOf(start), to = appSource.indexOf(end, from);
  assert(from >= 0 && to > from, `Missing production block: ${start}`);
  return appSource.slice(from, to);
}

class Element {
  constructor(tag = 'div') {
    this.tagName = tag; this.children = []; this.attributes = new Map(); this.events = new Map();
    this.className = ''; this.dataset = {}; this.style = {}; this._hidden = false; this.disabled = false;
    this.value = ''; this.rows = 3; this.maxLength = 2000; this.checked = false; this.type = '';
    this.classList = {add() {}, remove() {}, contains: () => false, toggle() {}};
  }
  get hidden() { return this._hidden; }
  set hidden(value) { this._hidden = Boolean(value); }
  set textContent(value) { this._text = String(value ?? ''); this.children = []; }
  get textContent() { return (this._text || '') + this.children.map(c => c.textContent || '').join(''); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  append(...nodes) { for (const node of nodes) { node.parentElement = this; this.children.push(node); } }
  appendChild(node) { node.parentElement = this; this.children.push(node); return node; }
  prepend(node) { node.parentElement = this; this.children.unshift(node); }
  replaceChildren() { this.children = []; this._text = ''; }
  insertBefore(node) { this.children.unshift(node); }
  remove() {
    if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this);
  }
  querySelector(selector) {
    const wanted = selector.startsWith('.') ? selector.slice(1) : selector.replace(/^\[data-review-id="/, '').replace(/"\]$/, '');
    let found = null;
    const visit = node => {
      for (const child of node.children || []) {
        if (child.classList && child.classList.contains(wanted)) found = found || child;
        if (selector.startsWith('[data-review-id') && child.dataset && child.dataset.reviewId === wanted) found = found || child;
        visit(child);
      }
    };
    visit(this);
    return found;
  }
  addEventListener(name, callback) { this.events.set(name, callback); }
  emit(name, event = {}) { const handler = this.events.get(name); if (handler) return handler(event); }
  focus() {}
  get placeholder() { return this._placeholder || ''; }
  set placeholder(value) { this._placeholder = value; }
}

function harness(options = {}) {
  const requests = [];
  const nodes = new Map();
  const node = id => { if (!nodes.has(id)) nodes.set(id, new Element()); return nodes.get(id); };
  const reviewCache = new Map(options.cache || []);
  const reviewCounts = new Map(options.counts || []);
  let sessionAccount = options.signedIn === false
    ? {connected: false, username: null, userId: null}
    : {connected: true, username: 'tester', userId: 42};
  const context = vm.createContext({
    TextDecoder, AbortController, URL, console,
    __SPINSHARE_UI_CATALOG__: catalog,
    document: {getElementById: node},
    APP_CONFIG: {session: sessionAccount},
    m: key => key, number: value => String(value),
    uiText: (target, value) => { if (target) target.textContent = value; },
    uiAttr: (target, name, value) => { if (target) target.setAttribute(name, value); },
    uiError: message => Object.assign(new Error(String(message)), {uiMessage: String(message)}),
    errorText: error => String(error?.uiMessage || error?.message || error),
    element: (tag, text, className) => { const el = new Element(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el; },
    reviewElement: item => { const article = new Element('article'); article.className = 'review-item'; article.dataset.reviewId = String(item.id); article.textContent = item.text; return article; },
    pruneEntries() {},
    reviewCache, reviewCounts,
    syncReviewCount() {},
    sessionConnected: () => sessionAccount.connected === true,
    syncSessionControls() {},
    installerRequest: async (method, requestPath, body) => {
      requests.push({method, path: requestPath, body});
      if (requestPath === '/v1/reviews/add') {
        if (options.failAdd) throw Object.assign(new Error('x'), {code: options.failAdd});
        return {review: {reviewId: 777, recommended: body.recommended, comment: body.comment}};
      }
      if (requestPath === '/v1/reviews/delete') {
        if (options.failDelete) throw Object.assign(new Error('x'), {code: options.failDelete});
        return {ok: true};
      }
      return {};
    },
    setTimeout: callback => 0, // the disarm timer must not fire in tests
    clearTimeout() {},
  });
  Object.defineProperty(context, 'sessionAccount', {get: () => sessionAccount, set: value => { sessionAccount = value; }});
  vm.runInContext(moduleSource, context);
  const run = (expression, values = {}) => { Object.assign(context, values); return vm.runInContext(expression, context); };
  const makeCell = (songId, title = 'Song') => {
    const body = new Element('div'); const note = new Element('p'); const list = new Element('div');
    body.appendChild(note); body.appendChild(list);
    return {row: [songId, title], body, note, list};
  };
  return {context, node, requests, reviewCache, reviewCounts, run, makeCell};
}

test('compose stays hidden while signed out', () => {
  const h = harness({signedIn: false});
  const cell = h.makeCell(1);
  h.run('syncReviewCompose(__cell)', {__cell: cell});
  const host = cell.body.children[0];
  assert.equal(host.hidden, true);
  assert.equal(host.children.length, 0);
});

test('compose form posts the production body and inserts the review locally', async () => {
  const h = harness();
  const cell = h.makeCell(15188, 'Majesty');
  h.run('syncReviewCompose(__cell)', {__cell: cell});
  const host = cell.body.children[0];
  assert.equal(host.hidden, false);
  const form = host.children.find(child => child.className === 'review-compose-form');
  assert.ok(form, 'compose form renders when no own review exists');
  const box = form.children[0].children[0], text = form.children[1], submit = form.children[2].children[0];
  box.checked = true; text.value = '  Great chart  ';
  const handler = form.events.get('submit');
  assert.ok(handler);
  await handler({preventDefault() {}});
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].path, '/v1/reviews/add');
  assert.equal(h.requests[0].body.songId, 15188);
  assert.equal(h.requests[0].body.recommended, true);
  assert.equal(h.requests[0].body.comment, 'Great chart', 'comment is trimmed');
  assert.equal(h.reviewCache.has(15188), false, 'cache invalidated for a fresh reload later');
  assert.equal(cell.list.children[0].dataset.reviewId, '777', 'review inserted locally');
  assert.equal(h.reviewCounts.get(15188), 1);
  // After a successful post the section switches to the own-review state.
  h.reviewCache.set(15188, {items: [{id: 777, user: {id: 42}, text: 'Great chart', recommended: true}]});
  h.run('syncReviewCompose(__cell)', {__cell: cell});
  const mine = cell.body.children[0].children.find(child => child.className === 'review-compose-mine');
  assert.ok(mine, 'own-review mode renders');
});

test('empty comments are rejected before any request', async () => {
  const h = harness();
  const cell = h.makeCell(1);
  h.run('syncReviewCompose(__cell)', {__cell: cell});
  const form = cell.body.children[0].children.find(child => child.className === 'review-compose-form');
  const text = form.children[1];
  text.value = '   ';
  await form.events.get('submit')({preventDefault() {}});
  assert.equal(h.requests.length, 0);
});

test('own-review delete is a two-step action and updates the list locally', async () => {
  const h = harness({cache: [[9646, {items: [{id: 555, user: {id: 42}, text: 'mine', recommended: false}]}]], counts: [[9646, 3]]});
  const cell = h.makeCell(9646, 'Own chart');
  const article = new Element('article'); article.dataset.reviewId = '555'; cell.list.appendChild(article);
  const other = new Element('article'); other.dataset.reviewId = '9001'; cell.list.appendChild(other);
  h.run('syncReviewCompose(__cell)', {__cell: cell});
  const mine = cell.body.children[0].children.find(child => child.className === 'review-compose-mine');
  const remove = mine.children[1];
  remove.emit('click'); // arms
  assert.equal(h.requests.length, 0);
  remove.emit('click'); // confirms
  await new Promise(resolve => setImmediate(resolve)); // let the async delete settle
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].path, '/v1/reviews/delete');
  assert.equal(h.requests[0].body.reviewId, 555);
  assert.equal(cell.list.children.length, 1, 'only my review row is removed');
  assert.equal(cell.list.children[0].dataset.reviewId, '9001');
  assert.equal(h.reviewCounts.get(9646), 2);
});

test('session expiry during posting signs the UI out', async () => {
  const h = harness({failAdd: 'session_expired'});
  const cell = h.makeCell(1);
  h.run('syncReviewCompose(__cell)', {__cell: cell});
  const form = cell.body.children[0].children.find(child => child.className === 'review-compose-form');
  const text = form.children[1];
  text.value = 'hello';
  await form.events.get('submit')({preventDefault() {}});
  assert.equal(h.run('sessionAccount.connected'), false);
});
