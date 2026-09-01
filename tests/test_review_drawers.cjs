'use strict';

// Run with Node 18+: node tests/test_review_drawers.cjs.
// Production functions run offline. Synthetic events/sizes exercise ownership and
// cleanup only; native keyboard navigation, text clipping, popover placement and scroll stability need a browser.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {test} = require('node:test');
const web = path.join(__dirname, '..', 'web');
const app = fs.readFileSync(path.join(web, 'app.js'), 'utf8');
const cards = fs.readFileSync(path.join(web, 'chart-card.js'), 'utf8');
const styles = fs.readFileSync(path.join(web, 'interface.css'), 'utf8');
function extract(source, start, end) {
  const from = source.indexOf(start), to = end ? source.indexOf(end, from) : source.length;
  assert(from >= 0 && to > from, 'Missing production function: ' + start);
  return source.slice(from, to);
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
}
async function settle(until = () => true) {
  for (let attempt = 0; attempt < 30; attempt++) {
    await new Promise(resolve => setImmediate(resolve));
    if (until()) return;
  }
  assert.fail('The expected asynchronous transition did not finish');
}

function harness({now = Date.UTC(2026, 8, 1), storage = new Map(), storageAvailable = true} = {}) {
  const nodes = new Map(), timers = new Map(), frames = new Map(), requests = [], profiles = [], motions = [], entries = [], observers = [], styleReads = [];
  const selection = {isCollapsed: true, anchorNode: null};
  let nextTimer = 0, nextFrame = 0, allowMotion = false, clock = now;
  class ClockDate extends Date { static now() { return clock; } }
  const styles = () => Object.defineProperties({}, {
    setProperty: {value(name, value) { this[name] = String(value); }},
    getPropertyValue: {value(name) { return this[name] || ''; }},
    removeProperty: {value(name) { const value = this[name] || ''; delete this[name]; return value; }},
  });
  class Element {
    constructor(tag = 'div') {
      this.tagName = tag; this.children = []; this.attributes = new Map(); this.events = new Map();
      this.className = ''; this.dataset = {}; this.hidden = false; this.disabled = false;
      this.inert = false; this.hovered = false; this.replacements = 0; this.value = ''; this._text = '';
      this.style = styles(); this.popoverOpen = false; this.clientWidth = 1280; this.scrollWidth = 1280;
      this.clientHeight = 200; this.scrollHeight = 200; this._scrollTop = 0;
      const change = (name, enabled) => {
        const classes = new Set(this.className.split(' ').filter(Boolean));
        if (enabled) classes.add(name); else classes.delete(name);
        this.className = [...classes].join(' ');
      };
      this.classList = {
        contains: name => this.className.split(' ').includes(name),
        add: name => change(name, true), remove: name => change(name, false),
        toggle: (name, force) => change(name, force ?? !this.classList.contains(name)),
      };
    }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    hasAttribute(name) { return this.attributes.has(name); }
    removeAttribute(name) { this.attributes.delete(name); if (name === 'style') this.style = styles(); }
    set textContent(value) { this.replaceChildren(); this._text = String(value); }
    get textContent() { return this._text + this.children.map(child => typeof child === 'string' ? child : child.textContent).join(''); }
    append(...children) {
      for (const child of children) {
        if (child.tagName === '#fragment') { this.append(...[...child.children]); continue; }
        if (typeof child !== 'string') {
          child.remove(); child.parentElement = this;
        }
        this.children.push(child);
      }
    }
    remove() {
      if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this);
      this.parentElement = null;
    }
    after(...nodes) {
      const parent = this.parentElement; if (!parent) return;
      for (const node of nodes) node.remove();
      const index = parent.children.indexOf(this); parent.children.splice(index + 1, 0, ...nodes);
      for (const node of nodes) node.parentElement = parent;
    }
    get isConnected() { return document.contains(this); }
    replaceChildren(...children) {
      this.replacements++; this._text = '';
      for (const child of [...this.children]) if (typeof child !== 'string') child.remove();
      this.children = []; this.append(...children);
    }
    contains(node) { return node != null && (this === node || this.children.some(child => typeof child !== 'string' && child.contains(node))); }
    matches(selector) {
      if (selector === ':hover') return this.hovered;
      if (selector === ':popover-open') return this.popoverOpen;
      return selector.startsWith('.') ? this.classList.contains(selector.slice(1)) : this.tagName === selector;
    }
    closest(selector) {
      for (let node = this; node; node = node.parentElement) if (node.matches?.(selector)) return node;
      return null;
    }
    showPopover() {
      assert(this.hasAttribute('popover')); assert.equal(this.hidden, false);
      this.popoverOpen = true; queueMicrotask(() => this.emit('toggle', {newState: 'open'}));
    }
    hidePopover() { this.popoverOpen = false; queueMicrotask(() => this.emit('toggle', {newState: 'closed'})); }
    querySelector(selector) {
      for (const child of this.children) {
        if (typeof child === 'string') continue;
        if (child.matches(selector)) return child;
        const result = child.querySelector(selector); if (result) return result;
      }
      return null;
    }
    querySelectorAll(selector) {
      return this.children.filter(child => typeof child !== 'string').flatMap(child => [
        ...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector),
      ]);
    }
    addEventListener(name, callback, options) {
      if (!this.events.has(name)) this.events.set(name, []);
      this.events.get(name).push({callback, options});
    }
    emit(name, details = {}) {
      const event = {target: this, detail: 1, preventDefault() { if (!this.passive) this.defaultPrevented = true; },
        stopPropagation() { this.propagationStopped = true; }, ...details};
      for (const {callback, options} of this.events.get(name) || []) {
        event.passive = Boolean(options?.passive); callback(event);
      }
      return event;
    }
    get scrollTop() { return this._scrollTop; }
    set scrollTop(value) { this._scrollTop = Math.max(0, Math.min(value, Math.max(0, this.scrollHeight - this.clientHeight))); }
    animate(frames, options) {
      const work = deferred(), motion = {target: this, frames, options, finished: work.promise, cancelled: false,
        finish() {
          if (options.iterations === Infinity) throw new DOMException('Infinite animation', 'InvalidStateError');
          work.resolve();
        },
        cancel() { this.cancelled = true; work.reject(new DOMException('Cancelled', 'AbortError')); }};
      motions.push(motion); return motion;
    }
    focus(options) { document.activeElement = this; this.focusOptions = options; }
    getBoundingClientRect() { return this.bounds || {top: 100, bottom: 300, left: 100, right: 300, width: 200, height: this.hidden ? 0 : 200}; }
  }
  const element = (tag, text, className = '') => {
    const node = new Element(tag); node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const document = Object.assign(new Element('document'), {
    documentElement: new Element('html'), body: new Element('body'), activeElement: null, hidden: false,
    createDocumentFragment: () => new Element('#fragment'),
    createRange() {
      let selected;
      return {selectNodeContents: node => { selected = node; }, getClientRects: () => selected?.textRects || []};
    },
  });
  document.append(document.documentElement); document.documentElement.append(document.body);
  document.documentElement.clientHeight = 800;
  const window = new Element('window');
  const node = id => { if (!nodes.has(id)) nodes.set(id, new Element()); return nodes.get(id); };
  class Observer {
    constructor(callback) { this.callback = callback; this.targets = new Set(); observers.push(this); }
    observe(target) { this.targets.add(target); }
    unobserve(target) { this.targets.delete(target); }
    disconnect() { this.targets.clear(); this.disconnected = true; }
    show(...targets) { this.callback(targets.filter(target => this.targets.has(target)).map(target => ({target, isIntersecting: true}))); }
  }
  const api = vm.createContext({
    document, $: node, element, AbortController, DOMException, Response, TextDecoder, TypeError, URL, queueMicrotask, Date: ClockDate,
    getSelection: () => selection,
    localStorage: {
      getItem(key) { if (!storageAvailable) throw new Error('Storage unavailable'); return storage.get(key) ?? null; },
      setItem(key, value) { if (!storageAvailable) throw new Error('Storage unavailable'); storage.set(key, String(value)); },
    },
    phase: 'ready', cardViews: new Map(), reviewCounts: new Map(), reviewCache: new Map(), profileCache: new Map(),
    cacheGeneration: 0, moreObserver: null, filtered: [], innerWidth: 1280, innerHeight: 800, scrollY: 0,
    activeMotions: new Set(), hostVisible: true, appExiting: false, selectedTags: new Map(),
    labels: ['Easy', 'Normal', 'Hard', 'Expert', 'XD'], shortLabels: ['E', 'N', 'H', 'EX', 'XD'],
    m: key => key, number: value => String(value), uiText: (target, value) => { target.textContent = value; },
    uiAttr: (target, name, value) => target.setAttribute(name, value), uiError: message => new Error(message),
    errorText: error => error.message, publicUser: user => user,
    icon: name => element('svg', undefined, 'icon-' + name),
    makeAvatar: () => element('span'), makeCover: () => element('img'),
    userLink: (user, className) => element('a', user.name, className),
    installationControl: (_, stats, card) => card.append(stats),
    loadingIndicator: (target, active) => { target.loading = active; },
    pruneEntries() {}, queueEntry: (...args) => entries.push(args),
    sortRows() { assert.fail('These cases must not change result sorting'); },
    render() { assert.fail('Drawer operations must not rebuild the page'); },
    motionAllowed: () => allowMotion,
    getComputedStyle(target, pseudo) {
      styleReads.push({target, pseudo});
      return {opacity: '1', transform: 'none', lineHeight: '16px',
        ...(pseudo === '::backdrop' ? target.backdropComputed : target.computed),
        getPropertyValue: name => name === '--top' ? '64px' : ''};
    },
    setTimeout(callback, delay) { const id = ++nextTimer; timers.set(id, {callback, delay, due: clock + delay}); return id; },
    clearTimeout: id => timers.delete(id), IntersectionObserver: Observer, ResizeObserver: Observer,
    requestAnimationFrame(callback) { const id = ++nextFrame; frames.set(id, callback); return id; },
    cancelAnimationFrame: id => frames.delete(id),
    addEventListener: (...args) => window.addEventListener(...args),
    scrollTo() { assert.fail('Review state changes must not call scrollTo; actual anchoring is checked in a browser'); },
    fetch(url, options) {
      assert.match(url, /^https:\/\/spinsha\.re\/api\/song\/\d+\/reviews$/, 'Never use a view-counting song detail endpoint');
      assert.equal(options.redirect, 'error', 'Reviews must not follow redirects to a view-counting endpoint');
      const work = {url, options, ...deferred()}; requests.push(work); return work.promise;
    },
    readUserProfile(id, signal) { const work = {id, signal, ...deferred()}; profiles.push(work); return work.promise; },
  });
  vm.runInContext([
    extract(app, 'let showChartReviews=', 'const searchFields='),
    extract(app, 'const MOTION_MS=', 'const activeMotions='),
    extract(app, 'function playMotion(', 'function rememberEntry('),
    extract(app, 'function remember(', 'function canSearchUsers('),
    extract(app, 'function tagKey(', 'function cleanTags('),
    extract(app, 'const CHART_DISCLOSURE_CONFIG=', 'function installationRequestId('),
    extract(app, 'function reviewsOpen(', 'function setupScrolling('),
    extract(app, 'async function readJSONResponse(', 'async function readSharedUser('),
    extract(app, 'function prunePageDetails(', 'async function apply('),
    extract(cards, 'function appendChartDescription('),
  ].join('\n'), api);
  node('sort').value = 'date';
  node('topbar').bounds = {top: 0, bottom: 64};
  api.setupPageControls();
  function card(id = api.cardViews.size + 1, uploader = '', metadata = {}, identity = {}) {
    const row = [id, identity.title || 'Chart ' + id, identity.subtitle || '', identity.artist || 'Artist', 'Charter', '2026-08-31', [[4, 40]], 40,
      {views: null, downloads: null, uploader, ...metadata}];
    const view = api.createChartCard(row); api.cardViews.set(id, view); document.body.append(view.card);
    api.syncReviewVisibility(false, [view.cell]); return view.cell;
  }
  const click = (cell, input = 'mouse') => {
    if (input !== 'keyboard') cell.toggle.emit('pointerdown', {pointerType: input});
    cell.toggle.emit('click', {detail: input === 'keyboard' ? 0 : 1});
  };
  const global = enabled => { node('show-chart-reviews').checked = enabled; node('show-chart-reviews').emit('change'); };
  const runTimers = delay => {
    for (const [id, timer] of [...timers]) if (timer.delay === delay) { timers.delete(id); timer.callback(); }
  };
  const runFrames = () => { for (const [id, callback] of [...frames]) { frames.delete(id); callback(clock); } };
  const advance = milliseconds => {
    const end = clock + milliseconds;
    for (;;) {
      const next = [...timers].filter(([, timer]) => timer.due <= end).sort((a, b) => a[1].due - b[1].due || a[0] - b[0])[0];
      if (!next) break;
      const [id, timer] = next; clock = timer.due; timers.delete(id); timer.callback();
    }
    clock = end;
  };
  const reply = (request, items) => request.resolve(new Response(JSON.stringify({
    status: 200, data: {reviews: items.map(item => ({user: item.user, comment: item.text,
      reviewDate: {date: item.date, timezone: item.timezone}, recommended: item.recommended})), average: items.length > 1 ? 75 : false},
  }), {headers: {'Content-Type': 'application/json'}}));
  const rawReply = (request, data, status = 200) => request.resolve(new Response(JSON.stringify(data), {status, headers: {'Content-Type': 'application/json'}}));
  return {api, card, click, global, node, document, window, element, runTimers, runFrames, advance, reply, rawReply, requests, profiles, timers, frames, motions, entries, observers, storage, styleReads,
    state: () => vm.runInContext('pageDetails', api), all: () => vm.runInContext('showChartReviews', api),
    now: () => clock, nextRefresh: () => vm.runInContext('reviewRefreshNextAllowedAt', api),
    refreshOwner: () => vm.runInContext('reviewRefreshOwner', api), refreshTimer: () => vm.runInContext('reviewRefreshTimer', api),
    storageKey: vm.runInContext('REVIEW_REFRESH_STORAGE_KEY', api),
    owner: () => vm.runInContext('reviewPopoverOwner', api), animate: () => { allowMotion = true; },
    reviewObserver: () => observers.find(observer => [...observer.targets].some(target => target.classList?.contains('chart-card'))),
    descriptionViews: () => vm.runInContext('chartDescriptionViews', api),
    descriptionOwner: () => vm.runInContext('chartDescriptionOwner', api),
    selection,
    readingMotion: () => vm.runInContext('READING_MOTION', api),
    tagsOwner: () => vm.runInContext('chartTagsOwner', api),
    reduceMotion: () => { allowMotion = false; api.syncMotion(); }};
}
function review(index = 1, text = 'Full review ' + index) {
  return {user: {id: String(index), name: 'Reader ' + index, avatar: '', verified: false, patron: false},
    text, date: '2026-08-31 12:00:00.000000', timezone: 'Europe/Berlin', recommended: true};
}
function cached(items = [review()]) { return {items, total: items.length, comments: items.filter(item => item.text.trim()).length, average: 75}; }
async function counted(h, cell, items = [review()]) {
  h.api.watchPageReviews([cell]);
  const request = h.requests.at(-1); assert(request, 'Rendered cards must fetch counts while collapsed');
  h.reply(request, items); await settle(() => !cell.pending);
  return request;
}
function assertClosed(cell, empty = false) {
  assert.equal(cell.target.hidden, true); assert.equal(cell.target.inert, true);
  assert.equal(cell.target.matches(':popover-open'), false);
  assert.equal(cell.toggle.getAttribute('aria-expanded'), empty ? null : 'false');
}
function assertKnownZero(h, cell) {
  assert.equal(h.api.reviewCounts.get(cell.row[0]), 0); assert.equal(cell.commentValue.textContent, '0');
  assertClosed(cell, true); assert.equal(cell.toggle.disabled, true); assert.equal(cell.chevron.hidden, true);
  assert.equal(cell.toggle.hasAttribute('aria-controls'), false); assert.equal(cell.toggle.hasAttribute('aria-haspopup'), false);
  assert.match(cell.toggle.getAttribute('aria-label'), /Reviews: 0/);
  assert.equal(cell.reviewTemporaryOpen, false); assert.equal(cell.reviewLoaded, false);
  assert.equal(cell.list.children.length, 0); assert.notStrictEqual(h.owner(), cell);
}
function described(h, id = 1, text = 'A complete chart note', lines = 7, tags = []) {
  const cell = h.card(id, '', {description: text, tags}), preview = cell.card.querySelector('.chart-description');
  const content = preview.querySelector('.chart-description-text');
  // These glyph boxes are inputs to the production measurement algorithm, not
  // evidence of font rendering or a browser's visible clipping boundary.
  content.computed = {lineHeight: '20px'}; content.scrollHeight = lines * 20;
  content.bounds = {top: 100, bottom: 100 + lines * 20, left: 0, right: 200, width: 200, height: lines * 20};
  content.textRects = Array.from({length: lines}, (_, index) => ({top: 102 + index * 20, bottom: 116 + index * 20, width: 200, height: 14}));
  h.runFrames();
  const view = h.descriptionViews().get(preview); assert.strictEqual(view.card, cell.card);
  const collapsed = view.cut + 3, notesHeight = collapsed + (tags.length ? 40 : 0);
  preview.clientHeight = collapsed; preview.clientWidth = 520;
  preview.bounds = {top: 130, bottom: 130 + collapsed, left: 700, right: 1220, width: 520, height: collapsed};
  view.notes.clientHeight = notesHeight;
  view.notes.bounds = {top: 130, bottom: 130 + notesHeight, left: 674, right: 1220, width: 546, height: notesHeight};
  return {cell, view, preview, content};
}
function songCredits(h, id, subtitle, artist, subtitleLines, artistLines) {
  const cell = h.card(id, '', {}, {subtitle, artist});
  const measure = (selector, lines) => {
    const preview = cell.card.querySelector(selector), content = preview.querySelector('.song-credit-text');
    content.computed = {lineHeight: '20px'}; content.scrollHeight = lines * 20;
    content.bounds = {top: 100, bottom: 100 + lines * 20, left: 0, right: 300, width: 300, height: lines * 20};
    content.textRects = Array.from({length: lines}, (_, index) => ({top: 102 + index * 20, bottom: 116 + index * 20, width: 300, height: 14}));
    preview.clientWidth = 300;
    return {cell, preview, content};
  };
  const subtitleView = subtitle ? measure('.subtitle', subtitleLines) : null;
  const artistView = measure('.artist', artistLines);
  h.runFrames();
  for (const item of [subtitleView, artistView].filter(Boolean)) item.view = h.descriptionViews().get(item.preview);
  return {cell, subtitle: subtitleView, artist: artistView};
}
function clickDescription(item, input = 'mouse') {
  if (input !== 'keyboard') item.preview.emit('pointerdown', {pointerType: input});
  return item.preview.emit('click', {detail: input === 'keyboard' ? 0 : 1});
}
function assertDisclosureCollapsed(item, cardExpanded = false) {
  if (!item) return;
  assert.equal(item.view.expanded, false); assert.equal(item.preview.getAttribute('aria-expanded'), 'false');
  assert.equal(item.preview.classList.contains('is-expanded'), false); assert.equal(item.content.inert, true);
  assert.equal(item.preview.classList.contains('is-floating'), false);
  assert.equal(item.cell.card.classList.contains('is-description-expanded'), cardExpanded);
  assert.equal(item.content.scrollTop, 0, 'A fully collapsed disclosure must reset its reading position');
}
function assertDescriptionClosed(h, item) {
  assert.equal(h.descriptionOwner(), null); assertDisclosureCollapsed(item);
}

test('collapsed cards load positive and zero counts without mounting reviews, and still discover uploaders', async () => {
  const h = harness(), positive = h.card(1, '123'), empty = h.card(2);
  assert.equal(h.all(), false); assertClosed(positive);
  assert.equal(positive.toggle.tagName, 'button'); assert.equal(positive.toggle.type, 'button');
  assert.equal(positive.toggle.getAttribute('aria-controls'), positive.target.id);
  assert.equal(positive.toggle.getAttribute('aria-haspopup'), 'dialog');
  assert.equal(positive.commentValue.textContent, '…', 'Unknown counts must not look like zero');
  h.api.watchPageReviews([positive, empty]); h.reviewObserver().show(positive.card, empty.card);
  assert.equal(h.requests.length, 2); assert.equal(h.state().active, 2);
  assert.equal(h.profiles.length, 0, 'Profiles share the two-worker budget');
  assert(h.requests.every(request => request.options.priority === 'low'));
  h.reply(h.requests[0], [review(), review(2, '')]); await settle(() => h.profiles.length === 1);
  h.reply(h.requests[1], []); h.profiles[0].resolve({id: '123', name: 'Uploader', avatar: ''});
  await settle(() => h.state().active === 0);
  assert.equal(positive.commentValue.textContent, '2'); assert.equal(empty.commentValue.textContent, '0');
  assert.equal(h.api.reviewCounts.get(1), 2); assert.equal(h.api.reviewCounts.get(2), 0);
  assert.match(positive.toggle.getAttribute('aria-label'), /Reviews: 2/);
  assert.equal(positive.commentValue.getAttribute('aria-busy'), 'false');
  assert.equal(positive.uploader.hidden, false); assert.equal(positive.profile.name, 'Uploader');
  assertClosed(positive); assert.equal(positive.list.children.length, 0); assert.equal(positive.reviewLoaded, undefined);
  assertKnownZero(h, empty);
  assert.equal(h.entries.length, 0); assert.equal(h.timers.size, 0);
});

test('failed counts never become zero; network retry is bounded and invalid payloads remain retryable', async () => {
  const h = harness(), cell = h.card(); h.api.watchPageReviews([cell]);
  h.requests[0].reject(new TypeError('offline')); await settle(() => h.requests.length === 2);
  h.requests[1].reject(new TypeError('still offline')); await settle(() => !cell.pending);
  assert.equal(h.requests.length, 2); assert.equal(h.api.reviewCounts.has(1), false);
  assert.equal(cell.commentValue.textContent, '!'); assert(cell.toggle.classList.contains('is-count-error'));
  assert.equal(cell.toggle.disabled, false);
  assert.equal(cell.toggle.hasAttribute('title'), false);
  assert.match(cell.toggle.getAttribute('aria-description'), /could not be updated/); assertClosed(cell);
  h.click(cell); assert.equal(h.requests.length, 3);
  assert.equal(h.requests[2].options.priority, 'high');
  h.rawReply(h.requests[2], {status: 200, data: {average: 0}});
  await settle(() => !cell.pending);
  assert.equal(h.requests.length, 3, 'Missing reviews is invalid data, not an empty review list');
  assert.equal(h.api.reviewCounts.has(1), false); assert.equal(h.api.reviewCache.has(1), false);
  assert.equal(cell.commentValue.textContent, '!'); assert.match(cell.note.textContent, /Refresh reviews/);
  cell.refresh.emit('click'); assert.equal(h.requests.length, 4);
  h.reply(h.requests[3], []); await settle(() => !cell.pending);
  assert.equal(cell.commentValue.textContent, '0'); assert.equal(cell.reviewError, '');
  assert.equal(cell.toggle.classList.contains('is-count-error'), false);
  assertKnownZero(h, cell);
  h.advance(60000);
  assert.equal(h.timers.size, 0);
});

test('only the documented missing-reviews sentinel or an explicit empty array confirms zero reviews', async () => {
  for (const data of [{average: false}, {average: false, reviews: []}]) {
    const h = harness(), cell = h.card(); h.api.watchPageReviews([cell]);
    h.rawReply(h.requests[0], {version: 1, status: 200, data}); await settle(() => !cell.pending);
    assertKnownZero(h, cell); assert.equal(cell.reviewError, '');
    const result = h.api.reviewCache.get(1);
    assert.equal(result.items.length, 0); assert.equal(result.total, 0); assert.equal(result.comments, 0);
    assert.equal(result.average, null);
  }
  const invalid = [
    {}, null, [], {reviews: null, average: false}, {reviews: {}, average: false},
    {reviews: false, average: false}, {reviews: [null], average: false},
    {average: 0}, {average: 75}, {average: null}, {average: true}, {average: 'false'},
  ].map(data => ({payload: {version: 1, status: 200, data}, httpStatus: 200}));
  for (const status of [404, 500]) {
    invalid.push({payload: {version: 1, status, data: {average: false}}, httpStatus: 200});
    invalid.push({payload: {version: 1, status: 200, data: {average: false}}, httpStatus: status});
  }
  for (const {payload, httpStatus} of invalid) {
    const h = harness(), cell = h.card(); h.api.watchPageReviews([cell]);
    h.rawReply(h.requests[0], payload, httpStatus); await settle(() => !cell.pending);
    assert.equal(h.api.reviewCounts.has(1), false, 'Invalid responses cannot confirm zero: ' + JSON.stringify(payload));
    assert.equal(h.api.reviewCache.has(1), false); assert.equal(cell.commentValue.textContent, '!');
    assert.equal(cell.toggle.disabled, false); assert(cell.reviewError); assertClosed(cell);
    assert.equal(h.requests.length, 1, 'Invalid data is reported without an automatic retry loop');
  }
});

test('confirmed zero ignores mouse, keyboard and global expansion while a single rating without text still opens', async () => {
  const h = harness(), empty = h.card(1), rated = h.card(2);
  h.api.watchPageReviews([empty, rated]);
  h.rawReply(h.requests[0], {version: 1, status: 200, data: {average: false}});
  h.reply(h.requests[1], [review(2, ' \n ')]); await settle(() => h.state().active === 0);
  assertKnownZero(h, empty);
  assert.equal(rated.toggle.disabled, false); assert.equal(rated.chevron.hidden, false);
  assert.equal(rated.commentValue.textContent, '1');
  const rating = h.api.reviewCache.get(2);
  assert.equal(rating.total, 1); assert.equal(rating.comments, 0); assert.equal(rating.average, null);
  const outside = h.element('button'); outside.focus();
  for (const input of ['mouse', 'keyboard', 'touch']) {
    h.click(empty, input); assertKnownZero(h, empty); assert.equal(h.owner(), null);
    assert.strictEqual(h.document.activeElement, outside);
  }
  assert.equal(h.requests.length, 2);
  h.global(true); await settle(() => rated.reviewLoaded && !rated.pending);
  assertKnownZero(h, empty); assert.equal(rated.target.hidden, false);
  assert.equal(rated.target.getAttribute('role'), 'region');
  assert.equal(rated.list.querySelector('.review-text').textContent, 'Rating only');
  h.global(false); assertKnownZero(h, empty); assertClosed(rated);
  h.click(rated); assert.strictEqual(h.owner(), rated);
  h.click(empty, 'keyboard'); assertKnownZero(h, empty);
  assert.strictEqual(h.owner(), rated, 'An unavailable zero-count action must not dismiss another card');
  assert.equal(h.requests.length, 2);
});

test('an asynchronous zero closes open content, cancels motion and uses preventScroll only for affected focus', async () => {
  for (const input of ['keyboard', 'mouse', 'external-focus', 'global']) {
    const h = harness(), cell = h.card(), outside = h.element('button');
    h.api.watchPageReviews([cell]); h.animate();
    if (input === 'global') { h.global(true); cell.refresh.focus(); }
    else {
      h.click(cell, input === 'keyboard' ? 'keyboard' : 'mouse');
      if (input === 'mouse') cell.toggle.focus();
      if (input === 'external-focus') outside.focus();
      cell.card.emit('pointerleave', {pointerType: 'mouse', relatedTarget: null});
    }
    const opening = cell.readingMotion, backdrop = cell.readingBackdropMotion, request = h.requests[0];
    assert.equal(cell.target.hidden, false);
    h.rawReply(request, {version: 1, status: 200, data: {average: false}});
    await settle(() => !cell.pending);
    assertKnownZero(h, cell); assert.equal(cell.reviewLeaveTimer, null); assert.equal(h.owner(), null);
    assert.equal(cell.readingMotion, null); if (opening) assert.equal(opening.cancelled, true);
    assert.equal(cell.readingBackdropMotion, null); if (backdrop) assert.equal(backdrop.cancelled, true);
    assert.equal(request.options.signal.aborted, false);
    if (input === 'external-focus') assert.strictEqual(h.document.activeElement, outside);
    else {
      const title = cell.card.querySelector('.song-title');
      assert.strictEqual(h.document.activeElement, title); assert.equal(title.focusOptions.preventScroll, true);
    }
    assert.equal(h.requests.length, 1); assert.equal(h.timers.size, 0);
  }
});

test('refreshing a positive count to zero clears old content and disclosure state while retaining the shared minute', async () => {
  const h = harness(), first = h.card(1), second = h.card(2);
  await counted(h, first, [review(1, 'Old full review')]); await counted(h, second);
  h.click(first); await settle(() => first.reviewLoaded && !first.pending);
  assert.equal(first.list.children.length, 1); const started = h.now();
  first.refresh.focus(); first.refresh.emit('click'); assert.equal(h.requests.length, 3);
  h.rawReply(h.requests[2], {version: 1, status: 200, data: {average: false}}); await settle(() => !first.pending);
  assertKnownZero(h, first); assert.equal(h.api.reviewCache.get(1).items.length, 0);
  assert.equal(h.api.reviewCache.get(1).total, 0); assert.equal(h.nextRefresh(), started + 60000);
  assert.equal(h.refreshOwner(), null); assert.equal(second.refresh.disabled, true);
  assert.strictEqual(h.document.activeElement, first.card.querySelector('.song-title'));
  assert.equal(h.document.activeElement.focusOptions.preventScroll, true);
  h.global(true); await settle(() => second.reviewLoaded && !second.pending);
  assertKnownZero(h, first); assert.equal(second.target.hidden, false);
  h.global(false); h.click(first); h.click(first, 'keyboard'); assertKnownZero(h, first);
  assert.equal(h.requests.length, 3);
  h.click(second); h.advance(59000); second.refresh.emit('click');
  assert.equal(h.requests.length, 3); assert.equal(h.api.reviewCounts.get(2), 1);
  h.advance(1000); second.refresh.emit('click'); assert.equal(h.requests.length, 4);
  assert.equal(h.nextRefresh(), started + 120000);
  h.reply(h.requests[3], [review(2, 'Other chart update')]); await settle(() => !second.pending);
  assertKnownZero(h, first); h.api.stopPageDetails(); assert.equal(h.refreshTimer(), null);
});

test('opening and closing reuse the same count request; a closed response updates counts without rendering', async () => {
  const h = harness(), first = h.card(1), second = h.card(2);
  h.api.watchPageReviews([first, second]);
  const initial = first.request, other = second.request;
  h.click(first); h.click(first); h.click(first);
  assert.strictEqual(first.request, initial); assert.equal(initial.signal.aborted, false);
  assert.equal(first.pending, true); assert.equal(h.requests.length, 2);
  h.click(second);
  assertClosed(first); assert.strictEqual(h.owner(), second);
  assert.strictEqual(second.request, other); assert.equal(other.signal.aborted, false);
  h.click(second); assertClosed(second);
  h.reply(h.requests[0], [review(1, 'Keep this full review')]); h.reply(h.requests[1], [review(2)]);
  await settle(() => h.state().active === 0);
  for (const cell of [first, second]) {
    assert.equal(cell.commentValue.textContent, '1'); assert.equal(cell.reviewLoaded, undefined);
    assert.equal(cell.list.children.length, 0); assertClosed(cell);
  }
  h.click(first); await settle(() => first.reviewLoaded && !first.pending);
  assert.equal(h.requests.length, 2); assert.match(first.list.textContent, /Keep this full review/);
  const replacements = first.list.replacements;
  h.click(first); h.click(first); await settle();
  assert.equal(first.list.replacements, replacements, 'Already mounted full reviews are reused');
  assert.equal(h.requests.length, 2); assert.equal(h.timers.size, 0);
});

test('rapid global switches retain count requests and later reuse complete cached reviews in inline mode', async () => {
  const h = harness(), first = h.card(1), second = h.card(2);
  h.api.watchPageReviews([first, second]);
  h.reply(h.requests[0], [review(1, 'First complete review')]); await settle(() => !first.pending);
  h.click(first); await settle(() => first.reviewLoaded && !first.pending);
  const pending = second.request;
  h.global(true); h.global(false);
  assert.strictEqual(second.request, pending); assert.equal(pending.signal.aborted, false);
  assert.equal(second.pending, true); assert.equal(h.owner(), null);
  assertClosed(first); assertClosed(second);
  h.reply(h.requests[1], [review(2, 'Second complete review')]); await settle(() => !second.pending);
  assert.equal(second.commentValue.textContent, '1'); assert.equal(second.list.children.length, 0);
  h.global(true); await settle(() => second.reviewLoaded && !second.pending);
  assert.equal(h.requests.length, 2);
  for (const cell of [first, second]) {
    assert.equal(cell.target.hidden, false); assert.equal(cell.target.hasAttribute('popover'), false);
    assert.equal(cell.target.getAttribute('role'), 'region'); assert.equal(cell.list.children.length, 1);
  }
  assert.match(first.list.textContent, /First complete review/);
  assert.match(second.list.textContent, /Second complete review/);
  h.global(false);
  assertClosed(first); assertClosed(second);
  assert.equal(first.reviewTemporaryOpen, false); assert.equal(second.reviewTemporaryOpen, false);
});

test('all rendered counts use two workers, with open cards, visible counts and profiles ahead of unseen counts', async () => {
  const h = harness(), cells = Array.from({length: 6}, (_, index) => h.card(index + 1, index === 5 ? '600' : ''));
  h.api.watchPageReviews(cells);
  assert.equal(h.requests.length, 2); assert.equal(h.state().active, 2);
  assert.equal(h.state().jobs.filter(job => job.kind === 'reviews').length, 4);
  h.reviewObserver().show(cells[5].card); h.click(cells[3]);
  h.reply(h.requests[0], [review()]); await settle(() => h.requests.length === 3);
  assert.match(h.requests[2].url, /\/4\/reviews$/); assert.equal(h.requests[2].options.priority, 'high');
  assert.equal(h.state().active, 2);
  h.click(cells[3]); assert.equal(h.requests[2].options.signal.aborted, false);
  h.reply(h.requests[1], [review()]); await settle(() => h.requests.length === 4);
  assert.match(h.requests[3].url, /\/6\/reviews$/);
  h.reply(h.requests[2], [review()]); await settle(() => h.profiles.length === 1);
  assert.equal(h.requests.length, 4); assert.equal(h.state().active, 2);
  h.reply(h.requests[3], [review()]); await settle(() => h.requests.length === 5);
  assert.match(h.requests[4].url, /\/3\/reviews$/);
  h.profiles[0].resolve({id: '600', name: 'Visible uploader', avatar: ''});
  await settle(() => h.requests.length === 6);
  assert.match(h.requests[5].url, /\/5\/reviews$/); assert.equal(h.state().active, 2);
  h.reply(h.requests[4], [review()]); h.reply(h.requests[5], [review()]);
  await settle(() => h.state().active === 0);
  assert(cells.every(cell => cell.commentValue.textContent === '1' && cell.list.children.length === 0));
  assert.equal(cells[5].profile.name, 'Visible uploader'); assert.equal(h.state().jobs.length, 0);
});

test('popover owner, union hover, keyboard, touch, outside clicks and scroll dismissal remain separate from pinned mode', async () => {
  const h = harness(), first = h.card(1), second = h.card(2);
  h.click(first);
  assert.strictEqual(h.owner(), first); assert(first.card.contains(first.target));
  assert(first.card.contains(first.refresh)); assert.equal(first.target.getAttribute('role'), 'dialog');
  assert.equal(first.target.querySelector('.review-close'), null, 'The popover no longer has an X close control');
  assert.equal(first.target.matches(':popover-open'), true); assert.equal(first.context.hidden, false);
  first.toggle.focus();
  first.card.emit('pointerleave', {pointerType: 'mouse', relatedTarget: first.refresh});
  assert.equal(first.reviewLeaveTimer, null);
  first.card.emit('pointerleave', {pointerType: 'mouse', relatedTarget: null});
  first.target.emit('pointerenter', {pointerType: 'mouse'}); h.runTimers(180);
  assert.equal(first.target.matches(':popover-open'), true, 'Moving into the floating descendant must keep it open');
  first.target.emit('pointerleave', {pointerType: 'mouse', relatedTarget: first.card});
  assert.equal(first.reviewLeaveTimer, null, 'Moving from the floating surface into its source card stays inside the union');
  first.target.emit('pointerleave', {pointerType: 'mouse', relatedTarget: null});
  first.card.emit('pointerenter'); h.runTimers(180);
  assert.equal(first.target.matches(':popover-open'), true, 'Reentering the card cancels dismissal');
  first.card.hovered = true;
  first.card.emit('pointerleave', {pointerType: 'mouse', relatedTarget: null}); h.runTimers(180);
  first.card.hovered = false;
  assert.equal(first.target.matches(':popover-open'), false, 'A stale CSS hover state must not veto a real union leave');
  assertClosed(first); assert.equal(h.owner(), null);
  h.click(first, 'keyboard');
  assert.strictEqual(h.document.activeElement, first.target); assert.equal(first.target.focusOptions.preventScroll, true);
  first.card.emit('pointerleave', {pointerType: 'mouse', relatedTarget: null}); h.runTimers(180);
  assert.equal(first.target.hidden, false);
  first.card.emit('focusout', {relatedTarget: first.refresh}); assert.equal(first.target.hidden, false);
  h.document.emit('keydown', {key: 'Escape', defaultPrevented: true}); assert.equal(first.target.hidden, false);
  const escape = h.document.emit('keydown', {key: 'Escape'});
  assert(escape.defaultPrevented); assertClosed(first);
  assert.strictEqual(h.document.activeElement, first.toggle); assert.equal(first.toggle.focusOptions.preventScroll, true);
  h.click(first, 'keyboard'); first.card.emit('focusout', {relatedTarget: h.element('button')}); assertClosed(first);
  h.click(first, 'touch');
  first.card.emit('pointerleave', {pointerType: 'touch', relatedTarget: null}); h.runTimers(180);
  h.document.emit('pointerdown', {target: first.refresh}); h.document.emit('scroll', {target: first.list});
  assert.equal(first.target.hidden, false, 'Internal controls and scrolling are inside the union region');
  const outside = h.element('button'); outside.focus();
  h.document.emit('pointerdown', {target: outside}); assertClosed(first);
  assert.strictEqual(h.document.activeElement, outside, 'Outside dismissal must not steal focus');
  for (const scrollTarget of [h.document, h.document.documentElement]) {
    h.click(first); h.document.emit('scroll', {target: scrollTarget}); assertClosed(first);
  }
  h.click(first); h.window.emit('blur'); assertClosed(first);
  h.click(first); first.target.hidePopover(); await settle(); assertClosed(first); assert.equal(h.owner(), null);
  h.click(first); h.global(true);
  assert.equal(h.owner(), null);
  for (const cell of [first, second]) {
    assert.equal(cell.target.hidden, false); assert.equal(cell.target.hasAttribute('popover'), false);
    assert.equal(cell.target.getAttribute('role'), 'region'); assert.equal(cell.context.hidden, true);
    assert.equal(cell.toggle.getAttribute('aria-disabled'), 'true');
    assert.equal(cell.toggle.hasAttribute('aria-haspopup'), false);
    h.click(cell); cell.card.emit('pointerleave', {pointerType: 'mouse', relatedTarget: null}); h.runTimers(180);
    assert.equal(cell.target.hidden, false);
  }
  h.document.emit('pointerdown', {target: outside}); h.document.emit('scroll');
  assert.equal(first.target.hidden, false); assert.equal(second.target.hidden, false);
  h.global(false);
  for (const cell of [first, second]) {
    assertClosed(cell); assert.equal(cell.reviewTemporaryOpen, false);
    assert.equal(cell.toggle.getAttribute('aria-disabled'), 'false');
  }
});

test('wheel input over the whole popover scrolls only its list, including boundaries, with pixel, line and page units', async () => {
  const h = harness(), cell = h.card(); h.click(cell);
  cell.list.clientHeight = 120; cell.list.scrollHeight = 2000; cell.list.computed = {lineHeight: '24px'};
  // Simulate the event reaching the surface from each descendant. Actual browser
  // bubbling and scroll chaining are intentionally outside this offline harness.
  for (const [target, deltaMode, deltaY, expected] of [
    [cell.context, 0, 27, 27], [cell.summary, 1, 2, 75],
    [cell.list, 2, 1, 195], [cell.target, 0, -15, 180],
  ]) {
    const event = cell.target.emit('wheel', {target, deltaMode, deltaY});
    assert.equal(event.defaultPrevented, true); assert.equal(event.propagationStopped, true);
    assert.equal(cell.list.scrollTop, expected);
  }
  cell.list.computed.lineHeight = 'normal';
  cell.target.emit('wheel', {deltaMode: 1, deltaY: -2}); assert.equal(cell.list.scrollTop, 148);
  cell.list.clientHeight = 0; cell.target.clientHeight = 240;
  cell.target.emit('wheel', {deltaMode: 2, deltaY: 1}); assert.equal(cell.list.scrollTop, 388);
  cell.list.clientHeight = 120;
  for (const [scrollHeight, start, deltaY, expected] of [
    [2000, 0, -100, 0], [2000, 1880, 100, 1880], [120, 0, 100, 0], [120, 0, -100, 0],
  ]) {
    cell.list.scrollHeight = scrollHeight; cell.list.scrollTop = start;
    const event = cell.target.emit('wheel', {target: cell.context, deltaMode: 0, deltaY});
    assert.equal(event.defaultPrevented, true, 'At either boundary and with short content the page default stays cancelled');
    assert.equal(event.propagationStopped, true); assert.equal(cell.list.scrollTop, expected);
  }
  cell.list.scrollHeight = 2000; cell.list.scrollTop = 50;
  const zoom = cell.target.emit('wheel', {deltaMode: 0, deltaY: 80, ctrlKey: true});
  assert(!zoom.defaultPrevented); assert(!zoom.propagationStopped); assert.equal(cell.list.scrollTop, 50);
  h.animate(); h.click(cell);
  assert.equal(cell.target.inert, true); assert.equal(cell.target.matches(':popover-open'), true);
  const fading = cell.target.emit('wheel', {deltaMode: 0, deltaY: 80});
  assert(!fading.defaultPrevented); assert(!fading.propagationStopped); assert.equal(cell.list.scrollTop, 50);
  cell.readingMotion.finish(); await settle(); assertClosed(cell);
  const hidden = cell.target.emit('wheel', {deltaMode: 0, deltaY: 80});
  assert(!hidden.defaultPrevented); assert(!hidden.propagationStopped); assert.equal(cell.list.scrollTop, 50);
  h.global(true);
  const inline = cell.target.emit('wheel', {target: cell.list, deltaMode: 0, deltaY: 80});
  assert(!inline.defaultPrevented); assert(!inline.propagationStopped); assert.equal(cell.list.scrollTop, 50);
  assert.equal(cell.target.getAttribute('role'), 'region'); assert.equal(h.owner(), null);
});

test('surface and backdrop transitions resume from current styles, settle without loops and honor reduced motion', async () => {
  const h = harness(), cell = h.card(); h.animate(); h.click(cell);
  const opening = cell.readingMotion, openingBackdrop = cell.readingBackdropMotion;
  assert.strictEqual(opening.target, cell.body); assert.strictEqual(openingBackdrop.target, cell.target);
  assert.equal(openingBackdrop.options.pseudoElement, '::backdrop');
  assert.equal(h.readingMotion().enter.duration, 220); assert.equal(h.readingMotion().exit.duration, 150);
  assert.equal(opening.options.duration, h.readingMotion().enter.duration); assert.equal(openingBackdrop.options.duration, opening.options.duration);
  assert.equal(opening.options.easing, h.readingMotion().enter.easing); assert.equal(openingBackdrop.options.easing, opening.options.easing);
  assert.equal(opening.frames[0].opacity, 0); assert.equal(opening.frames.at(-1).opacity, 1);
  assert.equal(opening.frames.at(-1).transform, 'translateY(0) scale(1)');
  assert(openingBackdrop.frames.every(frame => Object.keys(frame).join() === 'opacity'));
  cell.body.computed = {opacity: '0.42', transform: 'matrix(0.99, 0, 0, 0.99, 0, -4)'};
  cell.target.backdropComputed = {opacity: '0.31'}; h.styleReads.length = 0;
  const cancelOpening = opening.cancel;
  opening.cancel = function () {
    assert.equal(h.styleReads.filter(read => read.target === cell.body).length, 1, 'Read the current surface before cancelling its effect');
    assert.equal(h.styleReads.filter(read => read.target === cell.target && read.pseudo === '::backdrop').length, 1, 'Snapshot both effects before cancelling either');
    cancelOpening.call(this);
  };
  h.click(cell);
  const closing = cell.readingMotion, closingBackdrop = cell.readingBackdropMotion;
  assert.equal(opening.cancelled, true); assert.equal(openingBackdrop.cancelled, true);
  assert.equal(closing.options.duration, h.readingMotion().exit.duration); assert.equal(closingBackdrop.options.duration, closing.options.duration);
  assert.equal(closing.options.easing, h.readingMotion().exit.easing); assert.equal(closingBackdrop.options.easing, closing.options.easing);
  assert.equal(closing.frames[0].opacity, '0.42'); assert.equal(closing.frames[0].transform, cell.body.computed.transform);
  assert.equal(closingBackdrop.frames[0].opacity, '0.31');
  assert.equal(h.styleReads.filter(read => read.target === cell.body).length, 1);
  assert.equal(h.styleReads.filter(read => read.target === cell.target && read.pseudo === '::backdrop').length, 1);
  assert.equal(cell.target.hidden, false); assert.equal(cell.target.inert, true);
  assert.equal(cell.target.matches(':popover-open'), true, 'The surface remains mounted until its exit finishes');
  cell.body.computed = {opacity: '0.24', transform: 'matrix(0.988, 0, 0, 0.988, 0, -5)'};
  cell.target.backdropComputed = {opacity: '0.17'}; h.click(cell);
  const reopening = cell.readingMotion, reopeningBackdrop = cell.readingBackdropMotion;
  assert.equal(closing.cancelled, true); assert.equal(closingBackdrop.cancelled, true);
  assert.equal(reopening.frames[0].opacity, '0.24'); assert.equal(reopening.frames[0].transform, cell.body.computed.transform);
  assert.equal(reopeningBackdrop.frames[0].opacity, '0.17');
  reopening.finish(); await settle();
  assert.equal(cell.readingMotion, null); assert.equal(cell.readingBackdropMotion, null);
  assert.equal(reopeningBackdrop.cancelled, true); assert.equal(h.api.activeMotions.size, 0);
  assert.equal(cell.target.hidden, false); assert.equal(cell.target.inert, false); assert.strictEqual(h.owner(), cell);
  const settledMotions = h.motions.length; h.advance(10000);
  assert.equal(h.motions.length, settledMotions, 'Reading a settled popover must not schedule a floating loop');
  assert(h.motions.every(motion => !motion.options.iterations || motion.options.iterations === 1));
  h.click(cell); const reducedClosing = cell.readingMotion, reducedBackdrop = cell.readingBackdropMotion;
  h.reduceMotion(); await settle();
  assertClosed(cell); assert.equal(reducedClosing.cancelled, true); assert.equal(reducedBackdrop.cancelled, true);
  assert.equal(cell.readingMotion, null); assert.equal(cell.readingBackdropMotion, null);
  assert.equal(h.api.activeMotions.size, 0);
  const beforeReduced = h.motions.length; h.click(cell);
  assert.equal(cell.target.hidden, false); assert.equal(cell.target.matches(':popover-open'), true);
  assert.equal(cell.readingMotion, null); assert.equal(cell.readingBackdropMotion, null);
  h.document.emit('keydown', {key: 'Escape'}); assertClosed(cell);
  assert.strictEqual(h.document.activeElement, cell.toggle); assert.equal(cell.toggle.focusOptions.preventScroll, true);
  assert.equal(h.motions.length, beforeReduced, 'Reduced motion changes state without starting either WAAPI animation');
});

test('late fade callbacks cannot hide a reopened popover, another owner, or pinned inline content', async () => {
  const h = harness(), first = h.card(1), second = h.card(2); h.animate();
  h.click(first); const opening = first.readingMotion;
  opening.finish(); h.click(first); const closing = first.readingMotion, closingBackdrop = first.readingBackdropMotion;
  await settle(); assert.strictEqual(first.readingMotion, closing);
  assert.strictEqual(first.readingBackdropMotion, closingBackdrop);
  closing.finish(); h.click(first); const reopening = first.readingMotion, reopeningBackdrop = first.readingBackdropMotion;
  await settle();
  assert.strictEqual(first.readingMotion, reopening); assert.equal(first.target.hidden, false);
  assert.strictEqual(first.readingBackdropMotion, reopeningBackdrop);
  assert.equal(first.target.matches(':popover-open'), true); assert.strictEqual(h.owner(), first);
  h.click(second); const oldOwnerClosing = first.readingMotion, secondBackdrop = second.readingBackdropMotion;
  oldOwnerClosing.finish(); await settle();
  assertClosed(first); assert.strictEqual(h.owner(), second); assert.equal(second.target.hidden, false);
  assert.strictEqual(second.readingBackdropMotion, secondBackdrop);
  h.click(second); const beforePinned = second.readingMotion;
  beforePinned.finish(); const animations = h.motions.length; h.global(true); await settle();
  assert.equal(h.motions.length, animations, 'Global inline mode does not start a height or fade transition');
  for (const cell of [first, second]) {
    assert.equal(cell.target.hidden, false); assert.equal(cell.target.hasAttribute('popover'), false);
    assert.equal(cell.readingMotion, null); assert.equal(cell.readingBackdropMotion, null);
    assert.deepEqual(cell.target.style, {}); assert.deepEqual(cell.body.style, {});
  }
  h.global(false); assert.equal(h.motions.length, animations);
  h.click(first); const active = first.readingMotion, backdrop = first.readingBackdropMotion;
  first.card.emit('pointerleave', {pointerType: 'mouse', relatedTarget: null});
  h.api.retireReviewCell(first);
  assert.equal(active.cancelled, true); assert.equal(first.reviewLeaveTimer, null);
  assert.equal(backdrop.cancelled, true); assert.equal(first.readingBackdropMotion, null);
  assert.equal(first.readingMotion, null); assert.equal(first.target.hidden, true);
  assert.equal(first.target.matches(':popover-open'), false); assert.equal(h.owner(), null);
  for (const motion of h.motions) for (const frame of motion.frames) {
    assert.equal('height' in frame, false); assert.equal('width' in frame, false);
  }
  assert.equal(h.document.documentElement.classList.contains('review-layout-update'), false);
});

test('description overflow keeps the five-line budget and exposes a real half line without oscillation', () => {
  const h = harness(), short = described(h, 1, 'Guide: https://example.com/short.', 3), long = described(h, 2);
  assert.equal(short.view.overflow, false); assert.equal(short.content.inert, false);
  assert.equal(short.preview.getAttribute('role'), 'region'); assert.equal(short.preview.tabIndex, -1);
  assert.equal(short.preview.hasAttribute('aria-expanded'), false); assert.equal(short.preview.hasAttribute('aria-haspopup'), false);
  const link = short.content.querySelector('a'); assert.equal(link.href, 'https://example.com/short');
  const shortClick = short.preview.emit('click', {target: link});
  assert(!shortClick.defaultPrevented); assertDescriptionClosed(h);

  assert.equal(long.view.overflow, true); assert.equal(long.content.inert, true);
  assert.equal(long.preview.getAttribute('role'), 'button'); assert.equal(long.preview.tabIndex, 0);
  assert.equal(long.preview.getAttribute('aria-expanded'), 'false'); assert.equal(long.preview.hasAttribute('aria-haspopup'), false);
  assert.equal(long.preview.getAttribute('aria-controls'), long.content.id);
  assert.equal(long.preview.style.getPropertyValue('--description-preview-height'), '89px');
  assert.equal(long.preview.classList.contains('has-overflow'), true);
  long.preview.clientHeight = 89;
  for (let i = 0; i < 3; i++) {
    h.api.refreshChartDescriptions(); assert.equal(long.view.overflow, true);
    assert.equal(long.preview.style.getPropertyValue('--description-preview-height'), '89px');
  }
  long.content.textRects.splice(4, 1); // A blank fifth line must not become the clipping target.
  long.content.textRects.push({top: 190, bottom: 198, height: 8, width: 0});
  h.api.refreshChartDescriptions();
  assert.equal(long.preview.style.getPropertyValue('--description-preview-height'), '69px');
  long.content.textRects = []; h.api.refreshChartDescriptions();
  assert.equal(long.preview.style.getPropertyValue('--description-preview-height'), '90px', 'Missing glyph boxes retain the four-and-a-half-line fallback');
  long.content.scrollHeight = 101; h.api.refreshChartDescriptions();
  assert.equal(long.view.overflow, false); assert.equal(long.content.inert, false);
  assert.equal(long.preview.getAttribute('role'), 'region'); assert.equal(long.preview.style.getPropertyValue('--description-preview-height'), '');
  assert.equal(long.preview.classList.contains('has-overflow'), false); assert.equal(long.preview.hasAttribute('aria-expanded'), false);
  h.api.refreshChartDescriptions(); assert.equal(long.view.overflow, false);
  assert.equal(h.requests.length, 0);
});

test('card selection CSS keeps collapsed disclosures and every clickable label action-only', () => {
  assert.match(styles, /\.chart-card\s*\{[^}]*user-select:\s*text;/s, 'Ordinary card information stays selectable');
  assert.match(styles, /\.chart-disclosure\.has-overflow \.chart-disclosure-text\s*\{[^}]*pointer-events:\s*none;[^}]*user-select:\s*none;/s);
  assert.match(styles, /\.chart-disclosure\.has-overflow\.is-floating\.is-expanded \.chart-disclosure-text\s*\{[^}]*pointer-events:\s*auto;[^}]*user-select:\s*text;/s);
  assert.match(styles, /\.chart-card\s+:is\(a,\s*button,\s*\[role=button\]\)[^{]*\{[^}]*user-select:\s*none;/s,
    'Links, buttons, and disclosure triggers must be clickable instead of text-selectable');
});

test('subtitle and artist independently use a two-line budget, half-line preview, and ordinary short text', () => {
  const h = harness();
  const short = songCredits(h, 1, 'Short subtitle', 'Short artist', 1, 1);
  for (const item of [short.subtitle, short.artist]) {
    assert.equal(item.view.overflow, false); assert.equal(item.content.inert, false);
    assert.equal(item.preview.classList.contains('has-overflow'), false);
    assert.equal(item.preview.getAttribute('role'), null); assert.equal(item.preview.tabIndex, -1);
    assert.equal(item.preview.hasAttribute('aria-expanded'), false);
    assert.equal(item.preview.style.getPropertyValue('--description-preview-height'), '');
  }

  const longSubtitle = songCredits(h, 2, 'A subtitle long enough to wrap across three complete lines', 'Short artist', 3, 1);
  const longArtist = songCredits(h, 3, 'Short subtitle', 'An artist credit long enough to wrap independently across four lines', 1, 4);
  for (const [item, kind] of [[longSubtitle.subtitle, 'subtitle'], [longArtist.artist, 'artist']]) {
    assert.equal(item.view.config, vm.runInContext(`CHART_DISCLOSURE_CONFIG.${kind}`, h.api));
    assert.equal(item.view.overflow, true); assert.equal(item.view.cut, 29);
    assert.equal(item.preview.style.getPropertyValue('--description-preview-height'), '29px');
    assert.equal(item.preview.classList.contains('has-overflow'), true);
    assert.equal(item.preview.getAttribute('role'), 'button'); assert.equal(item.preview.tabIndex, 0);
    assert.equal(item.preview.getAttribute('aria-expanded'), 'false'); assert.equal(item.content.inert, true);
  }
  assert.equal(longSubtitle.artist.view.overflow, false, 'A long subtitle must not turn a short artist into a disclosure');
  assert.equal(longArtist.subtitle.view.overflow, false, 'A long artist must not turn a short subtitle into a disclosure');

  clickDescription(longSubtitle.subtitle);
  assert.strictEqual(h.descriptionOwner(), longSubtitle.subtitle.view);
  assert.equal(longSubtitle.subtitle.preview.classList.contains('is-floating'), true);
  assert.equal(longSubtitle.subtitle.content.inert, false);
  clickDescription(longSubtitle.subtitle); assertDescriptionClosed(h, longSubtitle.subtitle);
});

test('credit disclosures share keyboard, touch, reduced-motion, cleanup, and exclusive ownership behavior', () => {
  const h = harness(), credits = songCredits(h, 1, 'Long subtitle '.repeat(8), 'Long artist '.repeat(8), 4, 4);
  const note = described(h, 2, 'Long description '.repeat(20), 7, ['tag']);
  const strip = note.cell.card.querySelector('.chart-tags'); strip.clientWidth = 80; strip.scrollWidth = 180;

  let event = credits.subtitle.preview.emit('keydown', {target: credits.subtitle.preview, key: 'Enter'});
  assert.equal(event.defaultPrevented, true); assert.strictEqual(h.descriptionOwner(), credits.subtitle.view);
  event = credits.subtitle.preview.emit('keydown', {target: credits.subtitle.preview, key: ' '});
  assert.equal(event.defaultPrevented, true); assertDescriptionClosed(h, credits.subtitle);

  clickDescription(credits.subtitle, 'touch');
  credits.subtitle.preview.emit('pointerleave', {pointerType: 'touch', relatedTarget: null});
  assert.strictEqual(h.descriptionOwner(), credits.subtitle.view);
  clickDescription(credits.artist);
  assertDisclosureCollapsed(credits.subtitle, true); assert.strictEqual(h.descriptionOwner(), credits.artist.view);
  clickDescription(note);
  assertDisclosureCollapsed(credits.artist); assert.strictEqual(h.descriptionOwner(), note.view);
  assert.equal(h.api.showChartTags(strip), true); assertDisclosureCollapsed(note); assert.strictEqual(h.tagsOwner(), strip);
  clickDescription(credits.artist); assert.equal(h.tagsOwner(), null); assert.strictEqual(h.descriptionOwner(), credits.artist.view);
  h.click(note.cell); assertDisclosureCollapsed(credits.artist); assert.strictEqual(h.owner(), note.cell);

  h.click(note.cell); const before = h.motions.length;
  clickDescription(credits.subtitle, 'keyboard'); assert.strictEqual(h.descriptionOwner(), credits.subtitle.view);
  clickDescription(credits.subtitle, 'keyboard'); assertDescriptionClosed(h, credits.subtitle);
  assert.equal(h.motions.length, before, 'Reduced motion changes credit disclosure state without animations');

  const observer = h.observers.find(candidate => candidate.targets.has(credits.artist.preview)); assert(observer);
  credits.cell.card.remove(); h.api.cardViews.delete(credits.cell.row[0]); h.api.refreshChartDescriptions();
  assert.equal(h.descriptionViews().has(credits.subtitle.preview), false);
  assert.equal(h.descriptionViews().has(credits.artist.preview), false);
  assert.equal(observer.targets.has(credits.subtitle.preview), false); assert.equal(observer.targets.has(credits.artist.preview), false);
  assert.equal(h.requests.length, 0, 'Disclosure ownership changes do not create network work');
});

test('description grows downward from its original region as one floating surface without moving card layout', () => {
  const h = harness(), text = '完整说明\n' + 'Read every line 😀\n'.repeat(8) + 'Guide: https://example.com/guide?q=1#part.\nFinal line';
  const item = described(h, 1, text, 11), originalContent = item.content, replacements = item.content.replacements;
  for (const pointerType of ['mouse', 'pen', 'touch']) {
    item.preview.emit('pointerenter', {pointerType}); item.cell.card.emit('pointerenter', {pointerType}); h.advance(1000); h.runFrames();
    assertDescriptionClosed(h, item);
  }

  assert.equal(clickDescription(item).defaultPrevented, true);
  assert.strictEqual(h.descriptionOwner(), item.view); assert.equal(item.view.expanded, true);
  assert.equal(item.preview.classList.contains('is-expanded'), true); assert.equal(item.preview.classList.contains('is-floating'), true);
  assert.equal(item.preview.getAttribute('role'), 'region'); assert.equal(item.preview.hasAttribute('aria-expanded'), false);
  assert.equal(item.content.inert, false);
  assert.equal(item.cell.card.classList.contains('is-description-expanded'), true);
  assert.equal(item.view.notes.classList.contains('is-description-expanded'), true);
  assert.equal(item.view.notes.style.height, '92px', 'The collapsed note column keeps its original layout height');
  assert.equal(item.preview.style.getPropertyValue('--description-float-top'), '0px');
  assert.equal(item.preview.style.getPropertyValue('--description-float-left'), '26px');
  assert.equal(item.preview.style.getPropertyValue('--description-float-width'), '520px');
  assert.equal(item.preview.style.getPropertyValue('--description-expanded-height'), '220px');
  assert.strictEqual(item.preview.querySelector('.chart-description-text'), originalContent);
  assert.strictEqual(item.cell.card.querySelector('.chart-description-text'), originalContent);
  assert.equal(item.content.textContent, text); assert.equal(item.content.replacements, replacements);
  assert.equal(h.document.querySelectorAll('.chart-description-popover').length, 0, 'The original surface floats; no detached card or title is created');
  const link = item.content.querySelector('a');
  assert.equal(link.href, 'https://example.com/guide?q=1#part'); assert.equal(link.target, '_blank'); assert.equal(link.rel, 'noopener noreferrer');
  const linkClick = item.preview.emit('click', {target: link}); assert(!linkClick.defaultPrevented);
  assert.strictEqual(h.descriptionOwner(), item.view, 'Links remain usable inside the expanded disclosure');

  h.selection.isCollapsed = false; h.selection.anchorNode = item.content;
  const selectedClick = item.preview.emit('click', {target: item.content}); assert(!selectedClick.defaultPrevented);
  assert.strictEqual(h.descriptionOwner(), item.view, 'Finishing a text selection must not collapse the disclosure');
  h.selection.isCollapsed = true; h.selection.anchorNode = null;
  assert.equal(clickDescription(item).defaultPrevented, true); assertDescriptionClosed(h, item);

  for (const key of ['Enter', ' ']) {
    const opening = item.preview.emit('keydown', {key}); assert.equal(opening.defaultPrevented, true);
    assert.strictEqual(h.descriptionOwner(), item.view); assert.equal(item.preview.getAttribute('role'), 'region');
    const closing = item.preview.emit('keydown', {key}); assert.equal(closing.defaultPrevented, true); assertDescriptionClosed(h, item);
  }
  const unrelated = item.preview.emit('keydown', {key: 'ArrowDown'}); assert(!unrelated.defaultPrevented); assertDescriptionClosed(h, item);

  clickDescription(item);
  item.content.clientHeight = 80; item.content.scrollHeight = 240;
  const wheel = item.preview.emit('wheel', {deltaY: 42, deltaMode: 0});
  assert.equal(wheel.defaultPrevented, true); assert.equal(wheel.propagationStopped, true); assert.equal(item.content.scrollTop, 42);
  const boundary = item.preview.emit('wheel', {deltaY: 1000, deltaMode: 0});
  assert.equal(boundary.defaultPrevented, true); assert.equal(item.content.scrollTop, 160, 'Wheel remains trapped at the inner boundary');
  const zoom = item.preview.emit('wheel', {deltaY: 20, deltaMode: 0, ctrlKey: true}); assert.equal(zoom.defaultPrevented, undefined);
  item.preview.emit('pointerleave', {pointerType: 'mouse', relatedTarget: null}); assertDescriptionClosed(h, item);

  clickDescription(item, 'touch');
  assert.equal(item.content.scrollTop, 0, 'Reopening starts at the beginning after a complete collapse');
  item.preview.emit('pointerleave', {pointerType: 'touch', relatedTarget: null});
  assert.strictEqual(h.descriptionOwner(), item.view, 'Touch has no hover-leave concept and closes by a second tap');
  clickDescription(item, 'touch'); assertDescriptionClosed(h, item);
  assert.equal(h.requests.length, 0); assert.equal(h.profiles.length, 0); assert.equal(h.timers.size, 0);
});

test('description ownership is exclusive with another description, temporary reviews and tag popovers', () => {
  const h = harness(), first = described(h, 1, 'First complete note'), second = described(h, 2, 'Second complete note', 7, ['A tag']);
  const strip = second.cell.card.querySelector('.chart-tags'); strip.clientWidth = 100; strip.scrollWidth = 220;

  clickDescription(first); h.click(second.cell);
  assertDescriptionClosed(h, first); assert.strictEqual(h.owner(), second.cell);
  h.click(second.cell); assert.equal(h.owner(), null);

  clickDescription(first); assert.strictEqual(h.descriptionOwner(), first.view);
  assert.equal(h.api.showChartTags(strip), true); assertDescriptionClosed(h, first); assert.strictEqual(h.tagsOwner(), strip);
  clickDescription(second); assert.equal(h.tagsOwner(), null); assert.strictEqual(h.descriptionOwner(), second.view);
  assert.equal(second.preview.getAttribute('role'), 'region'); assert.equal(first.preview.getAttribute('aria-expanded'), 'false');

  clickDescription(first);
  assert.strictEqual(h.descriptionOwner(), first.view); assert.equal(first.preview.getAttribute('role'), 'region');
  assert.equal(second.preview.getAttribute('aria-expanded'), 'false'); assert.equal(second.view.expanded, false);
  assert.strictEqual(first.preview.querySelector('.chart-description-text'), first.content);
  assert.strictEqual(second.preview.querySelector('.chart-description-text'), second.content);
  assert.equal(h.document.querySelectorAll('.chart-description-popover').length, 0); assert.equal(h.requests.length, 0);
});

test('description removal, replacement, rapid reversal and reduced motion leave one coherent disclosure state', async () => {
  const h = harness(), item = described(h), observer = h.observers.find(candidate => candidate.targets.has(item.preview)); assert(observer);
  h.animate(); clickDescription(item);
  const opening = item.view.motion; assert(opening); assert.equal(opening.options.duration, 220);
  item.content.clientHeight = 80; item.content.scrollHeight = 240; item.content.scrollTop = 120;
  item.preview.bounds.height = 118;
  clickDescription(item); const closing = item.view.motion;
  assert(opening.cancelled); assert(closing); assert.equal(closing.options.duration, 180); assert.notStrictEqual(closing, opening);
  assert.equal(item.content.scrollTop, 120, 'An in-flight collapse need not reset before it settles');
  assert.equal(item.preview.classList.contains('is-floating'), true, 'The reverse animation keeps the floating geometry until it reaches the source');
  assert.equal(item.preview.classList.contains('is-collapsing'), true);
  item.preview.bounds.height = 104;
  clickDescription(item); const reopening = item.view.motion;
  assert(closing.cancelled); assert(reopening); assert.strictEqual(h.descriptionOwner(), item.view);
  assert.equal(item.content.scrollTop, 120, 'Rapid reversal preserves the active reading position');
  assert.equal(item.preview.classList.contains('is-collapsing'), false);
  h.reduceMotion(); await settle();
  assert.equal(item.view.motion, null); assert.equal(h.api.activeMotions.size, 0);
  const beforeReduced = h.motions.length;
  clickDescription(item); assertDescriptionClosed(h, item);
  assert.equal(item.content.scrollTop, 0, 'The eventual complete collapse resets after rapid reversal');
  clickDescription(item); assert.strictEqual(h.descriptionOwner(), item.view);
  assert.equal(h.motions.length, beforeReduced, 'Reduced motion changes state without creating WAAPI work');

  h.document.hidden = true; h.document.emit('visibilitychange'); assertDescriptionClosed(h, item);
  h.document.hidden = false;
  h.animate(); clickDescription(item); const detachedOpening = item.view.motion; assert(detachedOpening);
  h.api.retireReviewCell(item.cell); item.cell.card.remove(); h.api.cardViews.delete(item.cell.row[0]);
  h.api.refreshChartDescriptions(); await settle();
  assert.equal(h.descriptionOwner(), null); assert.equal(h.descriptionViews().has(item.preview), false);
  assert.equal(observer.targets.has(item.preview), false); assert.equal(detachedOpening.cancelled, true);
  assert.equal(h.api.showChartDescription(item.view), false);

  const replacement = described(h, 1, 'A replacement note');
  assert.notStrictEqual(replacement.preview, item.preview); assert.notStrictEqual(replacement.content, item.content);
  clickDescription(replacement); assert.strictEqual(h.descriptionOwner(), replacement.view);
  assert.strictEqual(replacement.preview.querySelector('.chart-description-text'), replacement.content);
  h.api.dismissChartDescription(true, false); assertDescriptionClosed(h, replacement);
  assert.strictEqual(h.document.activeElement, replacement.preview); assert.equal(replacement.preview.focusOptions.preventScroll, true);
  assert.equal(h.document.querySelectorAll('.chart-description-popover').length, 0);
});
test('cached counts survive refresh failures; full cached contents can be remounted on a replacement card', async () => {
  const h = harness(), first = h.card(7);
  await counted(h, first, [review(1, 'Cached complete text')]);
  h.click(first); await settle(() => first.reviewLoaded && !first.pending);
  assert.equal(h.requests.length, 1); assert.match(first.list.textContent, /Cached complete text/);
  const oldCache = h.api.reviewCache.get(7);
  first.refresh.emit('click'); assert.equal(h.requests.length, 2); assert.strictEqual(h.api.reviewCache.get(7), oldCache);
  h.rawReply(h.requests[1], {status: 200, data: {reviews: {}}}); await settle(() => !first.pending);
  assert.equal(first.commentValue.textContent, '1'); assert.equal(h.api.reviewCounts.get(7), 1);
  assert(first.reviewError); assert(first.toggle.classList.contains('is-count-error'));
  assert.strictEqual(h.api.reviewCache.get(7), oldCache, 'A failed refresh keeps the previous full cache');
  h.advance(60000);
  first.refresh.emit('click'); h.reply(h.requests[2], [review(1, 'Refreshed text'), review(2)]);
  await settle(() => first.reviewLoaded && !first.pending);
  assert.equal(first.commentValue.textContent, '2'); assert.equal(first.reviewError, '');
  h.api.retireReviewCell(first); first.card.remove(); h.api.cardViews.delete(7);
  const replacement = h.card(7); h.api.watchPageReviews([replacement]);
  assert.equal(replacement.commentValue.textContent, '2'); assert.equal(replacement.reviewLoaded, undefined);
  assert.equal(h.requests.length, 3);
  h.click(replacement); await settle(() => replacement.reviewLoaded && !replacement.pending);
  assert.equal(h.requests.length, 3); assert.match(replacement.list.textContent, /Refreshed text/);
  assert.doesNotMatch(replacement.list.textContent, /Cached complete text/);
});

test('manual refresh shares one minute across cards; failure keeps cache, initial reads remain free, and 59/60 seconds differ', async () => {
  const h = harness(), first = h.card(1), second = h.card(2);
  await counted(h, first, [review(1, 'Still readable after failure')]); await counted(h, second, [review(2)]);
  h.click(first); await settle(() => first.reviewLoaded && !first.pending);
  const before = h.now(), firstCache = h.api.reviewCache.get(1), secondCache = h.api.reviewCache.get(2);
  assert.equal(h.nextRefresh(), 0); assert.equal(h.storage.size, 0);
  first.refresh.emit('click'); assert.equal(h.requests.length, 3);
  assert.strictEqual(h.refreshOwner().cell, first); assert.equal(h.refreshOwner().started, true);
  assert.equal(h.nextRefresh(), before + 60000); assert.equal(h.storage.get(h.storageKey), String(before + 60000));
  h.requests[2].reject(new TypeError('Manual refresh failed')); await settle(() => !first.pending);
  assert.equal(h.requests.length, 3, 'A failed force request must not retry automatically');
  assert.equal(h.refreshOwner(), null); assert.equal(h.nextRefresh(), before + 60000);
  assert.strictEqual(h.api.reviewCache.get(1), firstCache); assert.equal(h.api.reviewCounts.get(1), 1);
  assert(first.reviewError); assert.equal(second.refresh.disabled, true);
  h.api.queueReviews(second, h.state(), true);
  await assert.rejects(h.api.readReviews(2, new AbortController().signal, true), error => error.code === 'review_refresh_cooldown');
  assert.equal(h.requests.length, 3); assert.strictEqual(h.api.reviewCache.get(2), secondCache);
  assert.equal(h.api.reviewCounts.get(2), 1); assert.equal(h.nextRefresh(), before + 60000);
  h.click(first); h.click(first); await settle(() => first.reviewLoaded && !first.pending);
  assert.match(first.list.textContent, /Still readable after failure/); assert.equal(h.requests.length, 3);
  const third = h.card(3); await counted(h, third, [review(3)]);
  assert.equal(third.commentValue.textContent, '1'); assert.equal(h.requests.length, 4);
  assert.equal(h.nextRefresh(), before + 60000, 'Initial count reads and cache opens do not consume or extend cooldown');
  h.click(second); await settle(() => second.reviewLoaded && !second.pending);
  const timer = h.refreshTimer();
  for (let index = 0; index < 20; index++) h.api.syncReviewRefresh();
  assert.strictEqual(h.refreshTimer(), timer);
  assert.equal([...h.timers.values()].filter(item => item.delay === 1000).length, 1);
  assert.match(second.refreshLabel.textContent, /1:00$/);
  h.advance(1000); assert.match(second.refreshLabel.textContent, /0:59$/);
  h.advance(58000); assert.match(second.refreshLabel.textContent, /0:01$/);
  assert.equal(second.refresh.disabled, true); second.refresh.emit('click');
  assert.equal(h.requests.length, 4); assert.equal(h.api.reviewCounts.get(2), 1);
  h.advance(1000); assert.equal(second.refresh.disabled, false); assert.equal(h.refreshTimer(), null);
  second.refresh.emit('click'); assert.equal(h.requests.length, 5);
  assert.equal(h.nextRefresh(), before + 120000);
  h.reply(h.requests[4], [review(2, 'New review'), review(4)]); await settle(() => !second.pending);
  assert.equal(h.api.reviewCounts.get(2), 2); assert.notStrictEqual(h.api.reviewCache.get(2), secondCache);
  h.api.stopPageDetails(); assert.equal(h.refreshTimer(), null);
  assert.equal(h.storage.get(h.storageKey), String(before + 120000));
});

test('queued refresh reserves one owner without starting cooldown, and pruning releases it before another card starts', async () => {
  const h = harness(), first = h.card(1), second = h.card(2);
  await counted(h, first); await counted(h, second);
  h.global(true); await settle(() => first.reviewLoaded && second.reviewLoaded && !first.pending && !second.pending);
  const blockers = [h.card(3), h.card(4)]; h.api.watchPageReviews(blockers);
  assert.equal(h.state().active, 2); assert.equal(h.requests.length, 4);
  first.refresh.emit('click'); const abandoned = h.refreshOwner();
  assert.strictEqual(abandoned.cell, first); assert.equal(abandoned.started, false);
  h.advance(5000); assert.equal(h.nextRefresh(), 0); assert.equal(h.storage.size, 0);
  assert.equal(h.refreshTimer(), null); assert.equal(second.refresh.disabled, true);
  const retainedCache = h.api.reviewCache.get(2);
  await assert.rejects(h.api.readReviews(2, new AbortController().signal, true), error => error.code === 'review_refresh_queued');
  assert.equal(h.requests.length, 4); assert.strictEqual(h.api.reviewCache.get(2), retainedCache);
  assert.equal(h.api.reviewCounts.get(2), 1);
  h.api.retireReviewCell(first); h.api.prunePageDetails(new Set([second, ...blockers]));
  first.card.remove(); h.api.cardViews.delete(1);
  assert.equal(h.refreshOwner(), null); assert.equal(first.pending, false); assert.equal(h.nextRefresh(), 0);
  second.refresh.emit('click'); const replacement = h.refreshOwner();
  assert.strictEqual(replacement.cell, second); assert.equal(replacement.started, false);
  await assert.rejects(h.api.readReviews(1, new AbortController().signal, true, 'high', abandoned), error => error.name === 'AbortError');
  assert.strictEqual(h.refreshOwner(), replacement); assert.equal(h.nextRefresh(), 0);
  h.reply(h.requests[2], [review(3)]); await settle(() => h.requests.length === 5);
  assert.strictEqual(h.refreshOwner(), replacement); assert.equal(replacement.started, true);
  assert.equal(h.nextRefresh(), h.now() + 60000); assert.match(h.requests[4].url, /\/2\/reviews$/);
  h.reply(h.requests[3], [review(4)]); h.reply(h.requests[4], [review(2)]);
  await settle(() => h.state().active === 0);
  assert.equal(h.refreshOwner(), null);
  assert.equal(h.requests.filter(request => /\/1\/reviews$/.test(request.url)).length, 1, 'The pruned force request never reaches fetch');
  h.api.stopPageDetails(); assert.equal(h.refreshTimer(), null);
});

test('a retired force request cannot release a newer refresh owner when its response finally arrives', async () => {
  const h = harness(), first = h.card(1), second = h.card(2);
  await counted(h, first); await counted(h, second);
  h.global(true); await settle(() => first.reviewLoaded && second.reviewLoaded && !first.pending && !second.pending);
  const originalCache = h.api.reviewCache.get(1), started = h.now();
  first.refresh.emit('click'); const oldOwner = h.refreshOwner(), stale = h.requests[2];
  h.api.retireReviewCell(first); h.api.prunePageDetails(new Set([second]));
  first.card.remove(); h.api.cardViews.delete(1);
  assert.equal(stale.options.signal.aborted, true); assert.equal(h.refreshOwner(), null);
  assert.equal(h.nextRefresh(), started + 60000, 'Retirement releases the slot, not the consumed minute');
  h.advance(60000); second.refresh.emit('click');
  const currentOwner = h.refreshOwner(), current = h.requests[3];
  assert(current); assert.notStrictEqual(currentOwner, oldOwner); assert.strictEqual(currentOwner.cell, second);
  assert.equal(h.nextRefresh(), started + 120000);
  h.reply(stale, [review(1, 'STALE force response')]); await settle(() => !first.pending);
  assert.strictEqual(h.refreshOwner(), currentOwner); assert.equal(second.pending, true);
  assert.strictEqual(second.request.signal, current.options.signal); assert.equal(current.options.signal.aborted, false);
  assert.strictEqual(h.api.reviewCache.get(1), originalCache); assert.equal(h.api.reviewCounts.get(1), 1);
  assert.equal(h.nextRefresh(), started + 120000);
  h.reply(current, [review(2), review(3)]); await settle(() => !second.pending);
  assert.equal(h.refreshOwner(), null); assert.equal(h.api.reviewCounts.get(2), 2);
  h.api.stopPageDetails(); assert.equal(h.refreshTimer(), null);
});

test('reload restores the origin deadline, all buttons share one updating timer, and unavailable storage keeps the in-page gate', async () => {
  const h = harness(), first = h.card(1); await counted(h, first);
  first.refresh.emit('click'); h.reply(h.requests[1], [review()]); await settle(() => !first.pending);
  const deadline = h.nextRefresh(); h.api.stopPageDetails();
  assert.equal(h.refreshTimer(), null); assert.equal(h.storage.get(h.storageKey), String(deadline));
  const reloaded = harness({now: deadline - 1000, storage: h.storage});
  const cells = Array.from({length: 20}, (_, index) => reloaded.card(index + 1));
  assert.equal(reloaded.nextRefresh(), deadline);
  assert(cells.every(cell => cell.refresh.disabled && /0:01$/.test(cell.refreshLabel.textContent)));
  assert.equal([...reloaded.timers.values()].filter(timer => timer.delay === 1000).length, 1);
  const sharedTimer = reloaded.refreshTimer();
  for (let index = 0; index < 20; index++) reloaded.api.syncReviewRefresh();
  assert.strictEqual(reloaded.refreshTimer(), sharedTimer);
  await counted(reloaded, cells[1]);
  reloaded.api.queueReviews(cells[1], reloaded.state(), true);
  assert.equal(reloaded.requests.length, 1); assert.equal(reloaded.nextRefresh(), deadline);
  reloaded.advance(1000);
  assert(cells.every(cell => !cell.refresh.disabled && cell.refreshLabel.textContent === 'Refresh reviews'));
  assert.equal(reloaded.refreshTimer(), null); assert.equal(reloaded.timers.size, 0);
  cells[1].refresh.emit('click'); assert.equal(reloaded.requests.length, 2);
  reloaded.reply(reloaded.requests[1], [review(2)]); await settle(() => !cells[1].pending);
  assert.equal(reloaded.storage.get(reloaded.storageKey), String(deadline + 60000));
  reloaded.api.stopPageDetails(); assert.equal(reloaded.refreshTimer(), null);
  const privatePage = harness({storageAvailable: false}), privateCell = privatePage.card(1);
  await counted(privatePage, privateCell); privateCell.refresh.emit('click');
  privatePage.reply(privatePage.requests[1], [review()]); await settle(() => !privateCell.pending);
  assert.equal(privatePage.nextRefresh(), privatePage.now() + 60000);
  privateCell.refresh.emit('click'); assert.equal(privatePage.requests.length, 2);
  assert.equal(privateCell.refresh.disabled, true); privatePage.api.stopPageDetails();
});

test('successful oversized force responses replace old small cache entries without losing new full text or counts', async () => {
  const h = harness(), first = h.card(1); await counted(h, first, [review(1, 'Old small cache')]);
  h.click(first); await settle(() => first.reviewLoaded && !first.pending);
  const oldCache = h.api.reviewCache.get(1), text = '完整更新 '.repeat(14000);
  first.refresh.emit('click'); const deadline = h.nextRefresh();
  assert.strictEqual(h.api.reviewCache.get(1), oldCache);
  h.reply(h.requests[1], [review(1, text), review(2, '')]); await settle(() => first.reviewLoaded && !first.pending);
  assert.equal(h.api.reviewCache.has(1), false, 'An oversized valid replacement must not leave the old small entry readable as current');
  assert.equal(h.api.reviewCounts.get(1), 2); assert.equal(first.commentValue.textContent, '2');
  assert.equal(first.list.querySelector('.review-text').textContent, text);
  h.api.retireReviewCell(first); first.card.remove(); h.api.cardViews.delete(1);
  const replacement = h.card(1); h.api.watchPageReviews([replacement]); h.click(replacement);
  assert.equal(h.requests.length, 3, 'Missing full text can be fetched normally during manual cooldown');
  assert.equal(h.nextRefresh(), deadline); assert.equal(replacement.commentValue.textContent, '2');
  h.reply(h.requests[2], [review(1, text), review(2, '')]); await settle(() => replacement.reviewLoaded && !replacement.pending);
  assert.equal(replacement.list.querySelector('.review-text').textContent, text); assert.equal(h.nextRefresh(), deadline);
  h.api.stopPageDetails(); assert.equal(h.refreshTimer(), null);
});

test('cache eviction preserves known counts but reopening refetches missing complete contents', async () => {
  const h = harness(), first = h.card(1); await counted(h, first, [review(1, 'Evicted text')]);
  // Exercise the production reader/cache boundary with responses from other pages.
  for (let id = 2; id <= 129; id++) {
    const reading = h.api.readReviews(id, new AbortController().signal);
    h.reply(h.requests.at(-1), [review(id)]); await reading;
  }
  assert.equal(h.api.reviewCache.size, 128); assert.equal(h.api.reviewCache.has(1), false);
  assert.equal(h.api.reviewCache.has(129), true); assert.equal(first.commentValue.textContent, '1');
  const before = h.requests.length; h.click(first);
  assert.equal(h.requests.length, before + 1); assert.equal(first.commentValue.textContent, '1');
  h.reply(h.requests.at(-1), [review(1, 'Fetched after eviction')]);
  await settle(() => first.reviewLoaded && !first.pending);
  assert.match(first.list.textContent, /Fetched after eviction/); assert.equal(h.api.reviewCache.size, 128);
});

test('oversized cache entries still render in full and retain counts without storing the full response', async () => {
  const h = harness(), first = h.card(9), text = '完整评论 '.repeat(14000);
  await counted(h, first, [review(1, text)]);
  assert.equal(h.api.reviewCache.has(9), false); assert.equal(first.commentValue.textContent, '1');
  assert.equal(first.list.children.length, 0);
  h.click(first); assert.equal(h.requests.length, 2);
  h.reply(h.requests[1], [review(1, text)]); await settle(() => first.reviewLoaded && !first.pending);
  assert.equal(first.list.querySelector('.review-text').textContent, text);
  assert.equal(h.api.reviewCache.has(9), false);
  h.click(first); h.click(first); assert.equal(h.requests.length, 2, 'Mounted full text survives closing even when too large to cache');
  h.api.retireReviewCell(first); first.card.remove(); h.api.cardViews.delete(9);
  const replacement = h.card(9); h.api.watchPageReviews([replacement]);
  assert.equal(h.requests.length, 2); assert.equal(replacement.commentValue.textContent, '1');
  h.click(replacement); assert.equal(h.requests.length, 3);
  h.reply(h.requests[2], [review(1, text)]); await settle(() => replacement.reviewLoaded && !replacement.pending);
  assert.equal(replacement.list.querySelector('.review-text').textContent, text);
});

test('removed cards cancel their work; late responses cannot overwrite a replacement card or its request state', async () => {
  const h = harness(), old = h.card(1), kept = h.card(2), queued = h.card(3);
  h.api.watchPageReviews([old, kept, queued]); h.click(old);
  const stale = h.requests[0], live = h.requests[1];
  h.api.retireReviewCell(old); h.api.retireReviewCell(queued);
  h.api.prunePageDetails(new Set([kept]));
  old.card.remove(); queued.card.remove(); h.api.cardViews.delete(1); h.api.cardViews.delete(3);
  assert.equal(stale.options.signal.aborted, true); assert.equal(live.options.signal.aborted, false);
  assert.equal(h.state().jobs.length, 0); assert.equal(queued.pending, false);
  assert.equal(h.owner(), null); assert.equal(h.state().targets.has(old.card), false);
  const replacement = h.card(1); h.api.watchPageReviews([replacement]); h.click(replacement);
  h.reply(live, [review(2)]); await settle(() => h.requests.length === 3);
  const current = h.requests[2], controller = replacement.request;
  h.reply(stale, [review(1, 'STALE retired response')]); await settle(() => !old.pending);
  assert.strictEqual(replacement.request, controller); assert.strictEqual(controller.signal, current.options.signal);
  assert.equal(replacement.pending, true); assert.equal(replacement.refresh.disabled, true);
  assert.equal(replacement.commentValue.getAttribute('aria-busy'), 'true');
  assert.equal(h.api.reviewCounts.has(1), false); assert.equal(h.api.reviewCache.has(1), false);
  h.reply(current, [review(1, 'Current response')]); await settle(() => replacement.reviewLoaded && h.state().active === 0);
  assert.match(replacement.list.textContent, /Current response/);
  assert.doesNotMatch(replacement.list.textContent, /STALE/); assert.equal(h.api.reviewCounts.get(2), 1);
  assert.equal(h.requests.some(request => /\/3\/reviews$/.test(request.url)), false);
  assert.equal(h.timers.size, 0);
});

test('timeout retry, catalog generations and page shutdown do not publish stale results', async () => {
  const h = harness(), first = h.card(1); h.api.watchPageReviews([first]);
  h.runTimers(20000); assert.equal(h.requests[0].options.signal.aborted, true);
  h.requests[0].reject(new DOMException('Aborted', 'AbortError'));
  await settle(() => h.requests.length === 2);
  h.reply(h.requests[1], [review()]); await settle(() => !first.pending);
  assert.equal(first.commentValue.textContent, '1'); assert.equal(first.reviewError, '');
  const stale = h.card(2); h.api.watchPageReviews([stale]);
  h.api.cacheGeneration++; h.reply(h.requests[2], [review(2)]);
  await settle(() => !stale.pending);
  assert.equal(h.api.reviewCounts.has(2), false); assert.equal(h.api.reviewCache.has(2), false);
  const active = h.card(3, '333'); h.api.watchPageReviews([active]); const reviewObserver = h.reviewObserver(); reviewObserver.show(active.card);
  assert.equal(h.state().active, 2); assert.equal(h.profiles.length, 1);
  const state = h.state(), pending = h.requests[3], profile = h.profiles[0];
  h.click(active); h.api.stopPageDetails();
  assert.equal(h.state(), null); assert.equal(state.stopped, true); assert.equal(h.owner(), null);
  assert.equal(pending.options.signal.aborted, true); assert.equal(profile.signal.aborted, true);
  assert(reviewObserver.disconnected); assert.equal(state.jobs.length, 0);
  h.reply(pending, [review(3, 'After shutdown')]); profile.resolve({id: '333', name: 'Late uploader', avatar: ''});
  await settle(() => state.active === 0);
  assert.equal(h.api.reviewCounts.has(3), false); assert.equal(active.profile, undefined);
  assert.equal(active.list.children.length, 0); assert.equal(h.timers.size, 0);
});

test('a completed network read cannot time out while 85 reviews await DOM batches', async () => {
  const h = harness(), cell = h.card(); h.api.watchPageReviews([cell]); h.click(cell);
  const request = h.requests[0], before = cell.list.replacements;
  assert([...h.timers.values()].some(timer => timer.delay === 20000));
  h.reply(request, Array.from({length: 85}, (_, index) => review(index + 1, 'Complete late response ' + index)));
  await settle(() => [...h.timers.values()].some(timer => timer.delay === 0));
  assert.equal(cell.commentValue.textContent, '85'); assert.equal(cell.pending, true);
  assert.equal(cell.reviewLoaded, undefined); assert.equal(cell.list.children.length, 0);
  assert.equal([...h.timers.values()].some(timer => timer.delay === 20000), false,
    'The network deadline must be removed before yielding between DOM batches');
  // Model a response arriving just before its deadline, with DOM work still paused.
  h.runTimers(20000); assert.equal(request.options.signal.aborted, false);
  h.runTimers(0); await settle(() => [...h.timers.values()].some(timer => timer.delay === 0));
  assert.equal(cell.list.children.length, 0);
  h.runTimers(20000); assert.equal(request.options.signal.aborted, false);
  h.runTimers(0); await settle(() => cell.reviewLoaded && !cell.pending);
  assert.equal(cell.list.children.length, 85); assert.equal(cell.list.replacements, before + 1);
  assert.equal(cell.list.children[84].querySelector('.review-text').textContent, 'Complete late response 84');
  assert.equal(cell.summary.loading, false); assert.match(cell.summary.textContent, /^85 ratings/);
  assert.equal(cell.target.getAttribute('aria-busy'), 'false'); assert.equal(cell.reviewError, '');
  assert.equal(h.requests.length, 1); assert.equal(h.timers.size, 0);
});

test('85 long reviews attach once in batches; closure or abort preserves prior content and timezone data', async () => {
  const h = harness(), cell = h.card(); h.click(cell);
  const state = {stopped: false}, text = '全文保留。\n' + 'A complete long comment.\n'.repeat(300);
  const items = Array.from({length: 85}, (_, index) => review(index + 1, index === 84 ? '' : text + index));
  const before = cell.list.replacements, request = new AbortController();
  const rendering = h.api.renderAllReviews(cell, cached(items), state, request);
  assert.equal(cell.list.children.length, 0, 'The first batch stays detached');
  h.runTimers(0); await settle(); assert.equal(cell.list.children.length, 0, 'The second batch stays detached');
  h.runTimers(0); assert.equal(await rendering, true);
  assert.equal(cell.list.replacements, before + 1); assert.equal(cell.list.children.length, 85);
  assert.equal(h.entries.length, 85);
  assert.equal(cell.list.children[0].querySelector('.review-text').textContent, text + '0');
  assert.equal(cell.list.children[83].querySelector('.review-text').textContent, text + '83');
  assert.equal(cell.list.children[84].querySelector('.review-text').textContent, 'Rating only');
  const date = cell.list.children[0].querySelector('.review-date');
  assert.equal(date.textContent, '2026-08-31 12:00:00');
  assert.equal(date.getAttribute('datetime'), '2026-08-31T12:00:00');
  assert.equal(items[0].timezone, 'Europe/Berlin', 'Only the displayed suffix is removed');
  const unchanged = cell.list.replacements, closingRequest = new AbortController();
  const closedBuild = h.api.renderAllReviews(cell, cached(items), state, closingRequest);
  h.api.closeTemporaryReviews(cell);
  h.runTimers(0); await settle(); h.runTimers(0);
  assert.equal(await closedBuild, false); assert.equal(closingRequest.signal.aborted, false);
  assert.equal(cell.list.replacements, unchanged, 'A closed popover must not mount a late partial build');
  h.click(cell);
  const stopped = new AbortController(), cancelled = h.api.renderAllReviews(cell, cached(items), state, stopped);
  stopped.abort(); h.runTimers(0); assert.equal(await cancelled, false);
  assert.equal(cell.list.replacements, unchanged);
  assert.equal(h.timers.size, 0);
});
