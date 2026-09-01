'use strict';

// Run with Node 18+: node tests/test_audio_player.cjs. No browser or network is used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {test} = require('node:test');

const web = path.join(__dirname, '..', 'web');
const appSource = fs.readFileSync(path.join(web, 'app.js'), 'utf8');
const cardSource = fs.readFileSync(path.join(web, 'chart-card.js'), 'utf8');
const interfaceSource = fs.readFileSync(path.join(web, 'interface.css'), 'utf8');
const html = fs.readFileSync(path.join(web, 'index.html'), 'utf8');
const portableSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'spinshare_portable.py'), 'utf8');

function extract(source, start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from);
  assert(from >= 0 && to > from, `Missing production block: ${start}`);
  return source.slice(from, to);
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
}

class Element {
  constructor(tag = 'div') {
    this.tagName = String(tag).toLowerCase();
    this.children = [];
    this.parentElement = null;
    this.attributes = new Map();
    this.events = new Map();
    this.className = '';
    this.dataset = {};
    this.style = {
      values: new Map(),
      setProperty: (name, value) => this.style.values.set(name, String(value)),
      getPropertyValue: name => this.style.values.get(name) || '',
    };
    this._hidden = false;
    this.disabled = false;
    this.value = '';
    this.max = '';
    this.type = '';
    this._text = '';
    const change = (name, enabled) => {
      const classes = new Set(this.className.split(/\s+/).filter(Boolean));
      if (enabled) classes.add(name); else classes.delete(name);
      this.className = [...classes].join(' ');
    };
    this.classList = {
      add: (...names) => names.forEach(name => change(name, true)),
      remove: (...names) => names.forEach(name => change(name, false)),
      contains: name => this.className.split(/\s+/).includes(name),
      toggle: (name, force) => {
        const enabled = force === undefined ? !this.classList.contains(name) : Boolean(force);
        change(name, enabled); return enabled;
      },
    };
  }
  get hidden() { return this._hidden; }
  set hidden(value) {
    this._hidden = Boolean(value);
    if (this._hidden) this.attributes.set('hidden', ''); else this.attributes.delete('hidden');
  }
  set textContent(value) { this.replaceChildren(); this._text = String(value ?? ''); }
  get textContent() { return this._text + this.children.map(child => child.textContent || '').join(''); }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === 'hidden') this._hidden = true;
  }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  hasAttribute(name) { return this.attributes.has(name); }
  removeAttribute(name) {
    this.attributes.delete(name);
    if (name === 'hidden') this._hidden = false;
  }
  append(...children) {
    for (const child of children) {
      if (typeof child === 'string') {
        const text = new Element('#text'); text._text = child; text.parentElement = this; this.children.push(text); continue;
      }
      child.remove?.(); child.parentElement = this; this.children.push(child);
    }
  }
  replaceChildren(...children) {
    for (const child of this.children) child.parentElement = null;
    this.children = []; this._text = ''; this.append(...children);
  }
  remove() {
    if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this);
    this.parentElement = null;
  }
  contains(node) { return this === node || this.children.some(child => child.contains(node)); }
  matches(selector) {
    if (selector.startsWith('.')) return this.classList.contains(selector.slice(1));
    return this.tagName === selector.toLowerCase();
  }
  closest(selector) {
    const selectors = String(selector).split(',').map(value => value.trim());
    for (let node = this; node; node = node.parentElement) {
      if (selectors.some(value => node.matches(value))) return node;
    }
    return null;
  }
  querySelector(selector) {
    for (const child of this.children) {
      if (child.matches(selector)) return child;
      const nested = child.querySelector(selector); if (nested) return nested;
    }
    return null;
  }
  querySelectorAll(selector) {
    return this.children.flatMap(child => [
      ...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector),
    ]);
  }
  addEventListener(name, callback) {
    if (!this.events.has(name)) this.events.set(name, []);
    this.events.get(name).push(callback);
  }
  removeEventListener(name, callback) {
    this.events.set(name, (this.events.get(name) || []).filter(item => item !== callback));
  }
  emit(name, details = {}) {
    const event = {
      target: this, defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; },
      ...details,
    };
    for (const callback of [...(this.events.get(name) || [])]) callback(event);
    return event;
  }
  focus() { this.focused = true; }
  blur() { this.blurred = true; }
}

class AudioElement extends Element {
  constructor() {
    super('audio');
    this._currentTime = 0;
    this.seekHistory = [];
    this.duration = Number.NaN;
    this.readyState = 0;
    this.paused = true;
    this.loadCalls = 0;
    this.pauseCalls = 0;
    this.playCalls = 0;
    this.playResults = [];
    this.sourceHistory = [];
    this._src = '';
  }
  get currentTime() { return this._currentTime; }
  set currentTime(value) { this._currentTime = Number(value); this.seekHistory.push(this._currentTime); }
  get src() { return this._src; }
  set src(value) {
    this._src = String(value);
    if (this._src) this.sourceHistory.push(this._src);
  }
  removeAttribute(name) {
    super.removeAttribute(name);
    if (name === 'src') this._src = '';
  }
  load() {
    this.loadCalls++;
    // HTMLMediaElement.load() resets the selected resource and its timeline.
    // Keep this realistic so fallback tests cannot accidentally preserve time.
    this._currentTime = 0; this.duration = Number.NaN; this.readyState = 0; this.paused = true;
  }
  pause() { this.pauseCalls++; this.paused = true; }
  play() {
    this.playCalls++; this.paused = false;
    return this.playResults.length ? this.playResults.shift() : Promise.resolve();
  }
}

function playerHarness(options = {}) {
  const nodes = new Map(), frames = new Map(), timers = new Map(), motions = [], requests = [], windowEvents = new Element('window');
  let nextFrame = 0, nextTimer = 0, clock = 0;
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, id === 'preview-audio' ? new AudioElement() : new Element());
    return nodes.get(id);
  };
  const document = new Element('document');
  document.hidden = false;
  const player = node('preview-player'), placeholder = new Element('svg'), body = new Element('div');
  placeholder.className = 'global-player-placeholder'; body.className = 'global-player-body';
  player.append(placeholder, body); player.hidden = true;
  node('preview-player-image').hidden = true;
  node('player-shortcut-hint').hidden = true;
  const playerToggle = node('preview-player-toggle');
  playerToggle.tagName = 'button'; playerToggle.className = 'global-player-cover preview-toggle';
  const playerProgress = node('preview-player-progress');
  playerProgress.tagName = 'input'; playerProgress.type = 'range'; playerProgress.value = '0';
  const coverViews = new Map();
  const context = vm.createContext({
    __coverViews: coverViews,
    $: node, document, URL, Number, Promise,
    APP_CONFIG: Object.freeze({playerShortcutHintShown: options.hintShown !== false}),
    cacheGeneration: 'test',
    appExiting: false,
    MOTION_MS: Object.freeze({feedback: 150, standard: 180, panel: 220, expressive: 280}),
    m: key => key,
    element(tag, value, className = '') {
      const target = new Element(tag); target.className = className;
      if (value !== undefined) target.textContent = value;
      return target;
    },
    icon(name) { const target = new Element('svg'); target.className = `icon icon-${name}`; return target; },
    makePreviewGlyphs() { const target = new Element('span'); target.className = 'preview-glyphs'; return target; },
    syncCovers() {},
    uiText: (target, value) => { target.textContent = value; },
    uiAttr: (target, name, value) => target.setAttribute(name, value),
    coverURL: value => typeof value === 'string' && /^https:\/\/spinshare\.b-cdn\.net\/uploads\/(cover|thumbnail)\/[a-z0-9_-]+\.jpg$/i.test(value) ? value : '',
    playMotion: (target, frames, options) => { motions.push({target, frames, options}); return null; },
    installerRequest(method, requestPath, body) {
      requests.push({method, path: requestPath, body}); return Promise.resolve({shown: true});
    },
    requestAnimationFrame(callback) { const id = ++nextFrame; frames.set(id, callback); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
    setTimeout(callback, delay) { const id = ++nextTimer; timers.set(id, {callback, due: clock + delay}); return id; },
    clearTimeout(id) { timers.delete(id); },
    addEventListener: (...args) => windowEvents.addEventListener(...args),
    fetch() { assert.fail('Audio playback must not use fetch or a counted chart endpoint'); },
  });
  vm.runInContext([
    extract(appSource, 'const PREVIEW_LOAD_TIMEOUT_MS=', 'const READING_MOTION='),
    'const coverViews=__coverViews;',
    extract(appSource, 'function makeCover(row){', '// One explicit, song-level stream.'),
    extract(appSource, '// One explicit, song-level stream.', 'const chartDescriptionViews='),
  ].join('\n'), context);

  const row = (id, reference = `spinshare_${id.toString(16)}`, fields = {}) => [
    id, fields.title || `Chart ${id}`, '', fields.artist || `Artist ${id}`, 'Charter', '2026-09-01', [[4, 30]], 30,
    {fileReference: reference, updateHash: fields.updateHash || String(id).padStart(32, '0'), cover: fields.cover || '', thumbnail: fields.thumbnail || ''},
  ];
  const state = () => vm.runInContext(`({
    id:previewTrack?.id??null, reference:previewTrack?.reference??'', state:previewState,
    format:previewFormat, source:previewExpectedSource, generation:previewGeneration,
    attempt:previewPlayAttempt, ready:previewReady, wantsPlay:previewWantsPlay,
    frame:previewFrame, watchdog:previewSourceTimer, shortcutPending:previewShortcutPending,
    shortcutTimer:previewShortcutTimer, playbackConfirmed:previewPlaybackConfirmed,
    hintShown:previewShortcutHintShown, hintTimer:previewHintTimer
  })`, context);
  const run = (expression, values = {}) => {
    Object.assign(context, values); return vm.runInContext(expression, context);
  };
  const api = {
    context, document, windowEvents, nodes, node, player, audio: node('preview-audio'), coverViews, motions, requests, frames, timers, row, state,
    source: (reference, format) => run('previewSource(__reference,__format)', {__reference: reference, __format: format}),
    reference: item => run('chartPreviewReference(__row)', {__row: item}),
    makeCover: item => run('makeCover(__row)', {__row: item}),
    start: (item, force = false) => run('startChartPreview(__row,__force)', {__row: item, __force: force}),
    toggle: () => run('toggleCurrentPreview()'),
    syncButtons: () => run('syncPreviewButtons()'),
    reconcile: data => run('reconcilePreviewCatalog(__data)', {__data: data}),
    setup: () => run('setupAudioPreview()'),
    dispose: () => run('disposePreview()'),
    advance(milliseconds) {
      const end = clock + milliseconds;
      for (;;) {
        const next = [...timers].filter(([, timer]) => timer.due <= end).sort((a, b) => a[1].due - b[1].due || a[0] - b[0])[0];
        if (!next) break;
        const [id, timer] = next; clock = timer.due; timers.delete(id); timer.callback();
      }
      clock = end;
    },
    runFrames() {
      for (const [id, callback] of [...frames]) { frames.delete(id); callback(clock); }
    },
  };
  return api;
}

function spaceTarget(kind) {
  const inputType = kind.startsWith('input:') ? kind.slice(6) : '';
  const controlKinds = new Set([
    'textarea', 'select', 'button', 'summary', 'editable', 'editable-empty', 'editable-plaintext',
    'role-button', 'checkbox', 'radio', 'switch', 'textbox', 'combobox', 'slider', 'menuitem',
    'listbox', 'option', 'menu', 'spinbutton', 'tree', 'treeitem', 'grid', 'gridcell', 'tab', 'calendar',
  ]);
  return {
    closest(selector) {
      if (inputType && selector.split(',').includes('input')) return {type: inputType};
      if (kind === 'link' && selector.includes('a[href]')) return this;
      if (kind === 'reading' && selector.includes('.reading-content')) return this;
      if (controlKinds.has(kind)) {
        if (kind === 'editable') return selector.includes('[contenteditable="true"]') ? this : null;
        if (kind === 'editable-empty') return selector.includes('[contenteditable=""]') ? this : null;
        if (kind === 'editable-plaintext') return selector.includes('[contenteditable="plaintext-only"]') ? this : null;
        if (kind === 'calendar') return selector.includes('.calendar-popover') ? this : null;
        const role = kind === 'role-button' ? 'button' : kind;
        if (!['textarea', 'select', 'button', 'summary'].includes(kind)) return selector.includes(`[role="${role}"]`) ? this : null;
        return selector.includes(kind) ? this : null;
      }
      return null;
    },
  };
}

function keyEvent(target, details = {}) {
  return {
    key: ' ', code: 'Space', target, repeat: false, defaultPrevented: false,
    isComposing: false, ctrlKey: false, altKey: false, metaKey: false, shiftKey: false,
    preventDefault() { this.defaultPrevented = true; }, ...details,
  };
}

function pressKey(harness, control, details = {}) {
  harness.document.activeElement = control;
  const keydown = harness.document.emit('keydown', keyEvent(control, details));
  const nativeClick = () => {
    if (!keydown.defaultPrevented && !keydown.repeat && control.tagName === 'button' && !control.disabled) control.emit('click', {detail: 0});
  };
  if (keydown.key === 'Enter') nativeClick();
  harness.document.emit('keyup', keyEvent(control, details));
  if (keydown.key === ' ' || keydown.code === 'Space') nativeClick();
  return keydown;
}

async function flush() {
  await Promise.resolve(); await new Promise(resolve => setImmediate(resolve));
}

test('one inert media element and strict CDN references play full songs without counted requests', () => {
  const audioTags = html.match(/<audio\b[^>]*>/gi) || [];
  assert.equal(audioTags.length, 1, 'The page must own exactly one Audio element');
  assert.match(audioTags[0], /\bid="preview-audio"/);
  assert.match(audioTags[0], /\bpreload="none"/);
  assert.doesNotMatch(audioTags[0], /\bsrc=/, 'Opening the app must not preload a song');
  const production = extract(appSource, '// One explicit, song-level stream.', 'const chartDescriptionViews=');
  assert.doesNotMatch(production, /\bnew\s+Audio\b|createElement\(['"]audio['"]\)|\bfetch\s*\(/);

  const h = playerHarness(), valid = 'spinshare_6a5acd00054e4';
  assert.equal(h.source(valid, 'ogg'), `https://spinshare.b-cdn.net/uploads/audio/${valid}_0.ogg`);
  assert.equal(h.source(valid, 'mp3'), `https://spinshare.b-cdn.net/uploads/audio/${valid}_0.mp3`);
  for (const value of ['', 'spinshare_', 'spinshare_abc/0', 'spinshare_abc?x=1', 'spinshare_abc.mp3', 'https://evil.test/x', 'spinshare_' + 'a'.repeat(65)]) {
    assert.equal(h.source(value, 'ogg'), '', value);
    assert.equal(h.reference(h.row(1, value)), '', value);
  }
  assert.equal(h.source(valid, 'wav'), '');
  const selected = h.row(17, valid);
  assert.equal(h.start(selected), true);
  assert.strictEqual(h.node('preview-audio'), h.audio);
  assert.deepEqual(h.audio.sourceHistory, [`https://spinshare.b-cdn.net/uploads/audio/${valid}_0.ogg`]);
  assert.equal(h.player.hidden, false);
});

test('the first accepted song selection shows and persists one keyboard shortcut hint', () => {
  assert.match(html, /id="player-shortcut-hint"[^>]*role="status"/);
  assert.match(html, /data-ui-static="Space"/);
  assert.match(html, /<kbd>\u2190 \/ \u2192<\/kbd>/);
  assert.match(portableSource, /["']playerShortcutHintShown["']:\s*False/);
  assert.match(portableSource, /if self\.path == ["']\/v1\/player-shortcuts-seen["']:/);
  assert.match(portableSource, /mark_player_shortcut_hint_shown\(\)/);

  const first = playerHarness({hintShown: false}), hint = first.node('player-shortcut-hint');
  assert.equal(hint.hidden, true);
  first.start(first.row(101, 'spinshare_101'));
  assert.equal(hint.hidden, false);
  assert.equal(hint.inert, false);
  assert.equal(first.requests.length, 1);
  assert.equal(first.requests[0].method, 'POST'); assert.equal(first.requests[0].path, '/v1/player-shortcuts-seen');
  assert.equal(Object.keys(first.requests[0].body).length, 0);
  first.advance(6499); assert.equal(hint.hidden, false);
  first.advance(1); assert.equal(hint.hidden, true); assert.equal(hint.inert, true);
  first.start(first.row(102, 'spinshare_102'));
  assert.equal(first.requests.length, 1, 'The same installation must never repeat the first-play hint');

  const returning = playerHarness();
  returning.start(returning.row(103, 'spinshare_103'));
  assert.equal(returning.node('player-shortcut-hint').hidden, true);
  assert.equal(returning.requests.length, 0, 'Persisted config suppresses the hint in later app sessions');
});

test('a missing cover keeps valid song audio playable while unavailable audio stays inert', () => {
  const playable = playerHarness(), row = playable.row(21, 'spinshare_21');
  const box = playable.makeCover(row), view = [...playable.coverViews.values()].at(-1);
  assert.strictEqual(view.box, box);
  assert.equal(view.state, 'missing');
  assert.equal(view.placeholder.hidden, false);
  assert.equal(view.missing.hidden, false);
  assert.equal(view.media.hasAttribute('title'), false, 'Missing artwork must not create a native hover tooltip');
  assert.equal(view.play.disabled, false, 'Missing artwork must not disable valid song audio');
  assert.equal(view.play.getAttribute('aria-label'), 'Play song: Chart 21');
  assert.equal(view.play.hasAttribute('title'), false, 'The cover control must not create a native hover tooltip');
  assert.equal(view.play.getAttribute('aria-pressed'), 'false');
  assert.equal(view.play.getAttribute('aria-busy'), 'false');
  view.play.emit('click');
  assert.deepEqual(playable.audio.sourceHistory, [
    'https://spinshare.b-cdn.net/uploads/audio/spinshare_21_0.ogg',
  ]);

  const unavailable = playerHarness(), invalid = unavailable.row(22, 'not-a-preview-reference');
  const unavailableBox = unavailable.makeCover(invalid), unavailableView = [...unavailable.coverViews.values()].at(-1);
  assert.strictEqual(unavailableView.box, unavailableBox);
  assert.equal(unavailableView.missing.hidden, false);
  assert.equal(unavailableView.play.disabled, true);
  assert.equal(unavailableView.play.getAttribute('aria-label'), 'Song unavailable: Chart 22');
  assert.equal(unavailable.start(invalid), false);
  assert.deepEqual(unavailable.audio.sourceHistory, [], 'Unavailable songs must never select an audio source');
  assert.equal(unavailable.player.hidden, true);
});

test('top and card controls expose matching pressed and busy states throughout playback', () => {
  const h = playerHarness(), row = h.row(23, 'spinshare_23');
  h.makeCover(row);
  let view = [...h.coverViews.values()].at(-1);
  const expectState = (pressed, busy) => {
    for (const control of [h.node('preview-player-toggle'), view.play]) {
      assert.equal(control.getAttribute('aria-pressed'), String(pressed));
      assert.equal(control.getAttribute('aria-busy'), String(busy));
      assert.equal(control.hasAttribute('title'), false);
    }
    assert.equal(h.player.getAttribute('aria-busy'), String(busy));
  };

  h.start(row); expectState(true, true);
  h.audio.duration = 100; h.audio.readyState = 4; h.audio.emit('loadedmetadata'); h.audio.emit('playing');
  expectState(true, false);

  h.coverViews.clear(); h.makeCover(row); view = [...h.coverViews.values()].at(-1);
  expectState(true, false, 'A replacement card must inherit the current state');

  h.toggle(); expectState(false, false);
  h.toggle(); expectState(true, true);
  h.audio.emit('playing'); expectState(true, false);
  h.audio.currentTime = 100; h.audio.emit('ended'); expectState(false, false);

  h.toggle(); expectState(true, true);
  h.audio.emit('error');
  assert.equal(h.state().format, 'mp3'); expectState(true, true);
  h.audio.emit('error');
  assert.equal(h.state().state, 'error'); expectState(false, false);
});

test('metadata, seeking and completion use the complete native song duration', () => {
  const h = playerHarness(), first = h.row(1, 'spinshare_a1');
  h.setup(); h.start(first);
  h.audio.duration = 91.4; h.audio.readyState = 4; h.audio.emit('loadedmetadata');
  assert.equal(h.node('preview-player-progress').max, '91.4');
  assert.equal(h.node('preview-player-duration').textContent, '1:31');
  h.audio.emit('playing');
  h.audio.currentTime = 8.75; h.audio.emit('timeupdate');
  assert.equal(h.node('preview-player-current').textContent, '0:08');
  assert.equal(h.node('preview-player-progress').value, '8.75');
  h.audio.currentTime = 45; h.audio.emit('timeupdate');
  assert.equal(h.state().state, 'playing', 'Playback must continue beyond the former 25-second limit');

  const progress = h.node('preview-player-progress'); progress.value = '999'; progress.emit('input');
  assert.equal(h.audio.currentTime, 91.4, 'Drag seeking must clamp to the complete song duration');
  assert.equal(h.state().state, 'ended'); assert.equal(h.state().wantsPlay, false);
  assert.equal(h.audio.currentTime, 91.4); assert.equal(progress.value, '91.4');
  const plays = h.audio.playCalls; h.toggle();
  assert.equal(h.audio.currentTime, 0, 'Replay after the native endpoint starts from zero');
  assert.equal(h.audio.playCalls, plays + 1);

  const short = h.row(2, 'spinshare_a2'); h.start(short);
  h.audio.duration = 12.4; h.audio.emit('loadedmetadata');
  assert.equal(progress.max, '12.4'); assert.equal(h.node('preview-player-duration').textContent, '0:12');
  h.audio.currentTime = 12.4; h.audio.emit('ended');
  assert.equal(h.state().state, 'ended'); assert.equal(h.audio.currentTime, 12.4);
});

test('OGG falls back once, restores an interrupted position after MP3 metadata, and explicit retry is bounded', () => {
  const h = playerHarness(), track = h.row(7, 'spinshare_abc123');
  h.start(track);
  assert.equal(h.state().format, 'ogg');
  h.audio.duration = 80; h.audio.readyState = 4; h.audio.emit('loadedmetadata');
  h.audio.currentTime = 9.75; h.audio.emit('playing');
  const playsBeforeFallback = h.audio.playCalls;
  h.audio.emit('error');
  assert.equal(h.state().format, 'mp3');
  assert.equal(h.audio.sourceHistory.at(-1), 'https://spinshare.b-cdn.net/uploads/audio/spinshare_abc123_0.mp3');
  assert.equal(h.audio.currentTime, 0, 'Changing the media resource resets its native timeline');
  assert.equal(h.audio.playCalls, playsBeforeFallback, 'Fallback waits for metadata before seeking and resuming');
  h.audio.duration = 80; h.audio.readyState = 4; h.audio.emit('loadedmetadata');
  assert.equal(h.audio.currentTime, 9.75, 'The MP3 continues from the interrupted OGG position');
  assert.equal(h.audio.playCalls, playsBeforeFallback + 1);
  const attempts = h.audio.sourceHistory.length;
  h.audio.emit('error');
  assert.equal(h.state().state, 'error'); assert.equal(h.state().wantsPlay, false);
  h.audio.emit('error');
  assert.equal(h.audio.sourceHistory.length, attempts, 'A failed MP3 must never loop back to OGG');
  h.toggle();
  assert.equal(h.state().format, 'ogg');
  assert.equal(h.audio.sourceHistory.at(-1), 'https://spinshare.b-cdn.net/uploads/audio/spinshare_abc123_0.ogg');
});

test('a current NotSupportedError falls back once and never returns from a failed MP3', async () => {
  const h = playerHarness(), work = deferred(), fallback = deferred(), unsupported = new Error('unsupported codec');
  unsupported.name = 'NotSupportedError'; h.audio.playResults.push(work.promise, fallback.promise);
  h.start(h.row(24, 'spinshare_24')); work.reject(unsupported); await flush();
  assert.equal(h.state().state, 'loading'); assert.equal(h.state().format, 'mp3');
  assert.deepEqual(h.audio.sourceHistory, [
    'https://spinshare.b-cdn.net/uploads/audio/spinshare_24_0.ogg',
    'https://spinshare.b-cdn.net/uploads/audio/spinshare_24_0.mp3',
  ]);
  h.audio.emit('error'); h.audio.emit('error');
  assert.equal(h.state().state, 'error'); assert.equal(h.state().wantsPlay, false);
  assert.equal(h.audio.sourceHistory.length, 2, 'A failed fallback must not cycle formats');
});

test('an OGG failure after 25 seconds still falls back and preserves full-song progress', () => {
  const h = playerHarness(); h.start(h.row(25, 'spinshare_25'));
  h.audio.duration = 240; h.audio.readyState = 4; h.audio.emit('loadedmetadata');
  h.audio.currentTime = 75; h.audio.emit('error');
  assert.equal(h.state().state, 'loading'); assert.equal(h.state().wantsPlay, true);
  assert.equal(h.state().format, 'mp3');
  assert.deepEqual(h.audio.sourceHistory, [
    'https://spinshare.b-cdn.net/uploads/audio/spinshare_25_0.ogg',
    'https://spinshare.b-cdn.net/uploads/audio/spinshare_25_0.mp3',
  ]);
  h.audio.duration = 240; h.audio.readyState = 4; h.audio.emit('loadedmetadata');
  assert.equal(h.audio.currentTime, 75);
});

test('a 15-second loading watchdog advances OGG to MP3 to error without looping', () => {
  const h = playerHarness(); h.start(h.row(6, 'spinshare_600d'));
  assert.equal(h.state().state, 'loading'); assert.equal(h.state().format, 'ogg'); assert.equal(h.timers.size, 1);
  h.advance(14999);
  assert.equal(h.state().format, 'ogg'); assert.equal(h.audio.sourceHistory.length, 1);
  h.advance(1);
  assert.equal(h.state().state, 'loading'); assert.equal(h.state().format, 'mp3');
  assert.deepEqual(h.audio.sourceHistory, [
    'https://spinshare.b-cdn.net/uploads/audio/spinshare_600d_0.ogg',
    'https://spinshare.b-cdn.net/uploads/audio/spinshare_600d_0.mp3',
  ]);
  assert.equal(h.timers.size, 1, 'The fallback source receives one fresh watchdog');
  h.advance(14999); assert.equal(h.state().state, 'loading');
  h.advance(1);
  assert.equal(h.state().state, 'error'); assert.equal(h.state().wantsPlay, false); assert.equal(h.timers.size, 0);
  h.advance(60000);
  assert.equal(h.audio.sourceHistory.length, 2, 'A timed-out MP3 must not return to OGG');
});

test('policy play rejection pauses the same source instead of pretending the audio format failed', async () => {
  const h = playerHarness(), work = deferred(), blocked = new Error('Autoplay policy'); blocked.name = 'NotAllowedError';
  h.audio.playResults.push(work.promise);
  h.start(h.row(3, 'spinshare_abcde')); work.reject(blocked); await flush();
  assert.equal(h.state().format, 'ogg'); assert.equal(h.state().state, 'paused');
  assert.equal(h.state().wantsPlay, false);
  assert.deepEqual(h.audio.sourceHistory, ['https://spinshare.b-cdn.net/uploads/audio/spinshare_abcde_0.ogg']);
  assert.equal(h.audio.pauseCalls > 0, true);
});

test('a stale play Promise on the same source cannot reject a newer play attempt', async () => {
  const h = playerHarness(), old = deferred(), current = deferred();
  h.audio.playResults.push(old.promise, current.promise); h.start(h.row(4, 'spinshare_4a4'));
  const source = h.audio.src; h.toggle(); h.toggle();
  assert.equal(h.state().state, 'loading'); assert.equal(h.state().wantsPlay, true);
  const stale = new Error('old decoder decision'); stale.name = 'NotSupportedError'; old.reject(stale); await flush();
  assert.equal(h.audio.src, source); assert.equal(h.state().format, 'ogg');
  assert.equal(h.state().state, 'loading'); assert.equal(h.state().wantsPlay, true);
  assert.equal(h.audio.sourceHistory.length, 1, 'The old attempt must not force a same-source fallback');
  current.resolve(); await flush(); h.audio.emit('playing');
  assert.equal(h.state().state, 'playing'); assert.equal(h.timers.size, 0);
});

test('completion is idempotent when timeupdate and ended arrive repeatedly', () => {
  const h = playerHarness(); h.start(h.row(5, 'spinshare_f1a15'));
  h.audio.duration = 100; h.audio.readyState = 4; h.audio.emit('loadedmetadata'); h.audio.emit('playing');
  h.audio.currentTime = 100; h.audio.emit('ended');
  assert.equal(h.state().state, 'ended'); assert.equal(h.audio.currentTime, 100);
  const seeks = h.audio.seekHistory.length, pauses = h.audio.pauseCalls;
  h.audio.emit('timeupdate'); h.audio.emit('ended'); h.audio.emit('timeupdate');
  assert.equal(h.state().state, 'ended'); assert.equal(h.audio.currentTime, 100);
  assert.equal(h.audio.seekHistory.length, seeks, 'Late completion events must not seek again');
  assert.equal(h.audio.pauseCalls, pauses, 'Late completion events must not pause again');
});

test('dragging to the native endpoint ends immediately and dragging back resumes from that position', () => {
  const h = playerHarness(); h.setup(); h.start(h.row(8, 'spinshare_8e8'));
  h.audio.duration = 100; h.audio.readyState = 4; h.audio.emit('loadedmetadata'); h.audio.emit('playing');
  const progress = h.node('preview-player-progress'); progress.value = '100'; progress.emit('input');
  assert.equal(h.state().state, 'ended'); assert.equal(h.state().wantsPlay, false); assert.equal(h.audio.currentTime, 100);
  progress.value = '10'; progress.emit('input');
  assert.equal(h.state().state, 'paused'); assert.equal(h.state().wantsPlay, false); assert.equal(h.audio.currentTime, 10);
  const plays = h.audio.playCalls; h.toggle();
  assert.equal(h.state().state, 'loading'); assert.equal(h.state().wantsPlay, true);
  assert.equal(h.audio.currentTime, 10, 'Resuming after a backward seek must not reset to zero');
  assert.equal(h.audio.playCalls, plays + 1);
});

test('stalled while already playing preserves state and continues beyond 25 seconds', () => {
  const h = playerHarness(); h.start(h.row(10, 'spinshare_a10'));
  h.audio.duration = 100; h.audio.readyState = 4; h.audio.emit('loadedmetadata'); h.audio.emit('playing');
  const frame = h.state().frame;
  assert.notEqual(frame, 0); assert.equal(h.frames.has(frame), true); assert.equal(h.timers.size, 0);
  h.audio.emit('stalled');
  assert.equal(h.state().state, 'playing'); assert.equal(h.state().frame, frame);
  assert.equal(h.frames.has(frame), true); assert.equal(h.timers.size, 0, 'A playing stall must not arm the loading watchdog');
  h.audio.currentTime = 25; h.runFrames();
  assert.equal(h.state().state, 'playing', 'The retained frame must not enforce an artificial playback boundary');
  h.audio.currentTime = 100; h.audio.emit('ended');
  assert.equal(h.state().state, 'ended');
});

test('late play and media callbacks cannot overwrite a newer song, and replacement cards resync without stopping it', async () => {
  const h = playerHarness(), pending = deferred(), first = h.row(1, 'spinshare_a'), second = h.row(2, 'spinshare_b');
  h.audio.playResults.push(pending.promise, Promise.resolve());
  h.start(first);
  const staleError = [...h.audio.events.get('error')];
  h.start(second); h.audio.currentTime = 6.5;
  pending.reject(new Error('late failure')); await flush();
  for (const callback of staleError) callback({target: h.audio});
  assert.equal(h.state().id, 2); assert.equal(h.state().format, 'ogg');
  assert.equal(h.state().source, 'https://spinshare.b-cdn.net/uploads/audio/spinshare_b_0.ogg');
  h.audio.emit('playing');
  assert.equal(h.state().state, 'playing');

  h.coverViews.clear();
  const box = new Element(), play = new Element('button');
  h.coverViews.set('replacement', {row: second, box, play}); h.syncButtons();
  assert.equal(play.classList.contains('is-current'), true);
  assert.equal(play.classList.contains('is-playing'), true);
  assert.match(play.getAttribute('aria-label'), /^Pause song:/);
  assert.equal(h.audio.currentTime, 6.5); assert.equal(h.state().state, 'playing');

  h.reconcile([{id: 2, fileReference: 'spinshare_b', updateHash: second[8].updateHash}]);
  assert.equal(h.state().id, 2, 'An unchanged catalog generation must keep playback alive');
  h.reconcile([{id: 2, fileReference: 'spinshare_changed', updateHash: second[8].updateHash}]);
  assert.equal(h.state().id, null, 'Changed media identity must retire the stale source');
  assert.equal(h.audio.src, ''); assert.equal(h.player.hidden, true);
});

test('Space toggles globally except where the focused control has its own Space action', async () => {
  const empty = playerHarness(); empty.setup();
  const noTrack = empty.document.emit('keydown', keyEvent(spaceTarget('page')));
  assert.equal(noTrack.defaultPrevented, false); assert.equal(empty.audio.playCalls, 0);

  const reserved = [
    'link', 'textarea', 'select', 'button', 'summary', 'editable', 'editable-empty', 'editable-plaintext',
    'role-button', 'checkbox', 'radio', 'switch', 'textbox', 'combobox', 'slider', 'menu', 'menuitem',
    'listbox', 'option', 'spinbutton', 'tree', 'treeitem', 'grid', 'gridcell', 'tab',
    'input:search', 'input:date', 'reading', 'calendar',
  ];
  for (const kind of reserved) {
    const h = playerHarness(); h.setup(); h.audio.readyState = 4; h.start(h.row(1, 'spinshare_a')); h.audio.emit('playing');
    const event = h.document.emit('keydown', keyEvent(spaceTarget(kind)));
    assert.equal(event.defaultPrevented, false, kind);
    assert.equal(h.state().state, 'playing', kind);
  }
  for (const kind of ['page', 'input:range']) {
    const h = playerHarness(); h.setup(); h.audio.readyState = 4; h.start(h.row(1, 'spinshare_a')); h.audio.emit('playing');
    const event = h.document.emit('keydown', keyEvent(spaceTarget(kind)));
    assert.equal(event.defaultPrevented, true, kind);
    assert.equal(h.state().state, 'paused', kind);
  }

  for (const position of ['card', 'player']) {
    const focused = playerHarness(); focused.setup(); const focusedRow = focused.row(2, 'spinshare_b'); focused.makeCover(focusedRow);
    const focusedView = [...focused.coverViews.values()][0], control = position === 'card' ? focusedView.play : focused.node('preview-player-toggle');
    focused.document.activeElement = focusedView.play; focusedView.play.emit('click'); focused.audio.emit('playing');
    const paused = pressKey(focused, control);
    assert.equal(paused.defaultPrevented, true, `${position}: the current song control joins the global Space path`);
    assert.equal(focused.state().state, 'paused', `${position}: one Space pauses exactly once`);
    assert.equal(focused.node('preview-player-toggle').classList.contains('is-shortcut-feedback'), true, `${position}: pause feedback appears immediately`);
    focused.advance(900);
    const resumed = pressKey(focused, control); focused.audio.emit('playing'); await flush();
    assert.equal(resumed.defaultPrevented, true, `${position}: resume also suppresses native button activation`);
    assert.equal(focused.state().state, 'playing', `${position}: a second Space resumes exactly once`);
    assert.equal(focused.node('preview-player-toggle').classList.contains('is-shortcut-feedback'), true, `${position}: resume feedback appears without touching the range`);
  }

  const switched = playerHarness(); switched.setup(); const firstRow = switched.row(3, 'spinshare_c'), secondRow = switched.row(4, 'spinshare_d');
  switched.makeCover(firstRow); switched.makeCover(secondRow); const [firstView, secondView] = [...switched.coverViews.values()];
  switched.document.activeElement = firstView.play; firstView.play.emit('click'); switched.audio.emit('playing');
  const switchSong = pressKey(switched, secondView.play);
  assert.equal(switchSong.defaultPrevented, false, 'A different song button keeps its native keyboard action');
  assert.equal(switched.state().id, secondRow[0], 'Native Space activation may explicitly select the focused different song');
  switched.audio.emit('playing');
  const pauseSecond = pressKey(switched, secondView.play);
  assert.equal(pauseSecond.defaultPrevented, true, 'The newly selected cover immediately becomes the global Space control');
  assert.equal(switched.state().state, 'paused', 'A newly selected song needs no progress click before feedback works');
  assert.equal(switched.node('preview-player-toggle').classList.contains('is-shortcut-feedback'), true);

  const modified = playerHarness(); modified.setup(); modified.audio.readyState = 4; modified.start(modified.row(1, 'spinshare_a')); modified.audio.emit('playing');
  for (const details of [{defaultPrevented: true}, {isComposing: true}, {ctrlKey: true}, {altKey: true}, {metaKey: true}, {shiftKey: true}]) {
    const before = modified.audio.pauseCalls;
    modified.document.emit('keydown', keyEvent(spaceTarget('page'), details));
    assert.equal(modified.audio.pauseCalls, before);
  }
  const repeated = modified.document.emit('keydown', keyEvent(spaceTarget('page'), {repeat: true}));
  assert.equal(repeated.defaultPrevented, true); assert.equal(modified.state().state, 'playing');

  const repeatFocused = playerHarness(); repeatFocused.setup(); const repeatRow = repeatFocused.row(5, 'spinshare_e'); repeatFocused.makeCover(repeatRow);
  const repeatView = [...repeatFocused.coverViews.values()][0]; repeatFocused.start(repeatRow); repeatFocused.audio.emit('playing');
  const repeatEvent = pressKey(repeatFocused, repeatView.play, {repeat: true});
  assert.equal(repeatEvent.defaultPrevented, true); assert.equal(repeatFocused.state().state, 'playing', 'Key repeat cannot leak into a native cover click');

  const enter = playerHarness(); enter.setup(); const enterRow = enter.row(6, 'spinshare_f'); enter.makeCover(enterRow); const enterView = [...enter.coverViews.values()][0];
  enter.start(enterRow); enter.audio.emit('playing');
  const enterEvent = pressKey(enter, enterView.play, {key: 'Enter', code: 'Enter'});
  assert.equal(enterEvent.defaultPrevented, false); assert.equal(enter.state().state, 'paused', 'Enter keeps the button\'s native action');
  assert.equal(enter.node('preview-player-toggle').classList.contains('is-shortcut-feedback'), false, 'Enter is not presented as the global Space shortcut');
});

test('Left and Right seek five seconds globally while preserving native control behavior', () => {
  const empty = playerHarness(); empty.setup();
  const noTrack = empty.document.emit('keydown', keyEvent(spaceTarget('page'), {key: 'ArrowRight', code: 'ArrowRight'}));
  assert.equal(noTrack.defaultPrevented, false); assert.deepEqual(empty.audio.seekHistory, []);

  const h = playerHarness(); h.setup(); h.start(h.row(28, 'spinshare_28'));
  h.audio.duration = 120; h.audio.readyState = 4; h.audio.emit('loadedmetadata'); h.audio.emit('playing');
  h.audio.currentTime = 40;
  const back = h.document.emit('keydown', keyEvent(spaceTarget('page'), {key: 'ArrowLeft', code: 'ArrowLeft'}));
  assert.equal(back.defaultPrevented, true); assert.equal(h.audio.currentTime, 35);
  const forward = h.document.emit('keydown', keyEvent(spaceTarget('page'), {key: 'ArrowRight', code: 'ArrowRight'}));
  assert.equal(forward.defaultPrevented, true); assert.equal(h.audio.currentTime, 40);
  h.audio.currentTime = 2;
  h.document.emit('keydown', keyEvent(spaceTarget('page'), {key: 'ArrowLeft', code: 'ArrowLeft'}));
  assert.equal(h.audio.currentTime, 0, 'Rewind clamps to the song start');
  h.audio.currentTime = 118;
  h.document.emit('keydown', keyEvent(spaceTarget('page'), {key: 'ArrowRight', code: 'ArrowRight'}));
  assert.equal(h.audio.currentTime, 120); assert.equal(h.state().state, 'ended');

  for (const position of ['card', 'player']) {
    const focused = playerHarness(); focused.setup(); const row = focused.row(31, position === 'card' ? 'spinshare_31ca' : 'spinshare_31b'); focused.makeCover(row);
    const view = [...focused.coverViews.values()][0], control = position === 'card' ? view.play : focused.node('preview-player-toggle');
    view.play.emit('click'); focused.audio.duration = 120; focused.audio.readyState = 4; focused.audio.emit('loadedmetadata'); focused.audio.emit('playing'); focused.audio.currentTime = 40.37;
    const forward = pressKey(focused, control, {key: 'ArrowRight', code: 'ArrowRight'});
    assert.equal(forward.defaultPrevented, true, `${position}: the current song control joins the global seek path`);
    assert.equal(focused.audio.currentTime, 45.37, `${position}: a focused playback control seeks forward exactly five seconds`);
    const back = pressKey(focused, control, {key: 'ArrowLeft', code: 'ArrowLeft'});
    assert.equal(back.defaultPrevented, true, `${position}: rewind stays on the same global seek path`);
    assert.equal(focused.audio.currentTime, 40.37, `${position}: a focused playback control seeks back exactly five seconds`);
  }

  const progressFocused = playerHarness(); progressFocused.setup(); progressFocused.start(progressFocused.row(32, 'spinshare_32'));
  progressFocused.audio.duration = 120; progressFocused.audio.readyState = 4; progressFocused.audio.emit('loadedmetadata'); progressFocused.audio.emit('playing'); progressFocused.audio.currentTime = 40.37; progressFocused.audio.emit('timeupdate');
  const progress = progressFocused.node('preview-player-progress'); progressFocused.document.activeElement = progress;
  const progressArrow = progressFocused.document.emit('keydown', keyEvent(progress, {key: 'ArrowRight', code: 'ArrowRight'}));
  if (!progressArrow.defaultPrevented) {
    progress.value = String(Number(progress.value) + .01); progress.emit('input');
  }
  assert.equal(progressArrow.defaultPrevented, true, 'The player range must not apply its native 0.01-second Arrow step');
  assert.equal(progressFocused.audio.currentTime, 45.37, 'A focused player range seeks forward exactly five seconds');
  const progressBack = progressFocused.document.emit('keydown', keyEvent(progress, {key: 'ArrowLeft', code: 'ArrowLeft'}));
  assert.equal(progressBack.defaultPrevented, true);
  assert.equal(progressFocused.audio.currentTime, 40.37, 'A focused player range seeks back exactly five seconds');

  const reserved = [
    'input:range', 'input:search', 'textarea', 'select', 'button', 'summary', 'editable',
    'slider', 'menu', 'menuitem', 'listbox', 'option', 'spinbutton', 'tree', 'treeitem',
    'grid', 'gridcell', 'tab', 'reading', 'calendar',
  ];
  for (const kind of reserved) {
    const control = playerHarness(); control.setup(); control.start(control.row(29, 'spinshare_29'));
    control.audio.duration = 120; control.audio.readyState = 4; control.audio.emit('loadedmetadata'); control.audio.currentTime = 40;
    const event = control.document.emit('keydown', keyEvent(spaceTarget(kind), {key: 'ArrowRight', code: 'ArrowRight'}));
    assert.equal(event.defaultPrevented, false, kind);
    assert.equal(control.audio.currentTime, 40, kind);
  }

  const modified = playerHarness(); modified.setup(); modified.start(modified.row(30, 'spinshare_30'));
  modified.audio.duration = 120; modified.audio.readyState = 4; modified.audio.emit('loadedmetadata'); modified.audio.currentTime = 40;
  for (const details of [{defaultPrevented: true}, {isComposing: true}, {ctrlKey: true}, {altKey: true}, {metaKey: true}, {shiftKey: true}]) {
    const before = modified.audio.currentTime;
    modified.document.emit('keydown', keyEvent(spaceTarget('page'), {key: 'ArrowRight', code: 'ArrowRight', ...details}));
    assert.equal(modified.audio.currentTime, before);
  }
});

test('Space feedback follows the earliest real media state transition and retires itself', async () => {
  assert.match(interfaceSource, /\.global-player-cover\.is-shortcut-feedback \.preview-glyphs\s*\{\s*opacity:\s*1/);
  const h = playerHarness(), toggle = h.node('preview-player-toggle'), progress = h.node('preview-player-progress');
  h.setup(); h.audio.readyState = 4; h.start(h.row(30, 'spinshare_30')); h.audio.emit('loadedmetadata'); h.audio.emit('playing');

  h.document.activeElement = progress;
  const paused = h.document.emit('keydown', keyEvent(spaceTarget('input:range')));
  assert.equal(paused.defaultPrevented, true);
  assert.equal(h.state().state, 'paused');
  assert.equal(progress.blurred, true, 'The global shortcut must not leave a focus frame on the progress range');
  assert.equal(toggle.classList.contains('is-playing'), false);
  assert.equal(toggle.classList.contains('is-shortcut-feedback'), true, 'Pause feedback appears on the cover');
  h.advance(899); assert.equal(toggle.classList.contains('is-shortcut-feedback'), true);
  h.advance(1); assert.equal(toggle.classList.contains('is-shortcut-feedback'), false);

  h.document.activeElement = null;
  const resumed = deferred(); h.audio.playResults.push(resumed.promise);
  h.document.emit('keydown', keyEvent(spaceTarget('page')));
  assert.equal(h.state().state, 'loading');
  assert(h.state().shortcutPending > 0);
  assert.equal(toggle.classList.contains('is-shortcut-feedback'), false, 'A play request is not presented as playback yet');
  resumed.resolve(); await flush();
  assert(h.state().shortcutPending > 0);
  assert.equal(h.state().state, 'loading');
  assert.equal(toggle.classList.contains('is-loading'), true, 'A fulfilled play request remains loading until the media playing event');
  h.audio.emit('playing');
  const feedbackTimer = h.state().shortcutTimer;
  assert.equal(h.state().shortcutPending, 0);
  assert.equal(toggle.classList.contains('is-playing'), true);
  assert.equal(toggle.classList.contains('is-loading'), false);
  assert.equal(toggle.classList.contains('is-shortcut-feedback'), true, 'The media playing event gives visible cover feedback');
  h.audio.emit('playing');
  assert.equal(h.state().shortcutTimer, feedbackTimer, 'A repeated playing event must not restart the feedback animation');
  h.advance(900); assert.equal(toggle.classList.contains('is-shortcut-feedback'), false);

  h.document.emit('keydown', keyEvent(spaceTarget('page'))); h.advance(900);
  const rejected = deferred(), denied = new Error('Autoplay policy'); denied.name = 'NotAllowedError';
  h.audio.playResults.push(rejected.promise);
  h.document.emit('keydown', keyEvent(spaceTarget('page')));
  assert(h.state().shortcutPending > 0);
  rejected.reject(denied); await flush();
  assert.equal(h.state().shortcutPending, 0);
  assert.equal(toggle.classList.contains('is-shortcut-feedback'), false, 'Rejected playback never flashes a false play state');

  const early = playerHarness(), firstPlay = deferred(); early.audio.playResults.push(firstPlay.promise); early.setup(); early.start(early.row(32, 'spinshare_32'));
  early.audio.duration = 180; early.audio.readyState = 4; early.audio.emit('loadedmetadata');
  firstPlay.resolve(); await flush();
  assert.equal(early.state().state, 'loading'); assert.equal(early.state().playbackConfirmed, false,
    'A Promise alone is not allowed to end the loading state');
  early.audio.emit('playing');
  assert.equal(early.state().state, 'playing'); assert.equal(early.state().playbackConfirmed, true);
  early.audio.emit('waiting');
  assert.equal(early.state().state, 'loading'); assert.equal(early.state().playbackConfirmed, true);
  assert.equal(early.node('preview-player-toggle').getAttribute('aria-busy'), 'true');
  const earlyPause = early.document.emit('keydown', keyEvent(spaceTarget('page')));
  assert.equal(earlyPause.defaultPrevented, true); assert.equal(early.state().state, 'paused');
  assert.equal(early.node('preview-player-toggle').classList.contains('is-shortcut-feedback'), true,
    'A confirmed play cycle keeps truthful pause feedback while buffering');

  const loading = playerHarness(); loading.setup(); loading.start(loading.row(31, 'spinshare_31'));
  loading.document.emit('keydown', keyEvent(spaceTarget('page')));
  assert.equal(loading.state().state, 'paused');
  assert.equal(loading.node('preview-player-toggle').classList.contains('is-shortcut-feedback'), false,
    'Cancelling a still-pending load must not claim that audible playback was paused');

  const cycle = playerHarness(), pendingResume = deferred(); cycle.setup(); cycle.start(cycle.row(34, 'spinshare_34')); cycle.audio.emit('playing');
  cycle.document.emit('keydown', keyEvent(spaceTarget('page'))); cycle.advance(900);
  cycle.audio.playResults.push(pendingResume.promise); cycle.document.emit('keydown', keyEvent(spaceTarget('page')));
  assert.equal(cycle.state().playbackConfirmed, false);
  cycle.document.emit('keydown', keyEvent(spaceTarget('page')));
  assert.equal(cycle.state().state, 'paused');
  assert.equal(cycle.node('preview-player-toggle').classList.contains('is-shortcut-feedback'), false,
    'Cancelling an unconfirmed resume must not reuse evidence from an earlier play cycle');

  const fallback = playerHarness(), oggPlay = deferred(), mp3Play = deferred(), unsupported = new Error('unsupported codec');
  unsupported.name = 'NotSupportedError'; fallback.setup(); fallback.start(fallback.row(33, 'spinshare_33'));
  fallback.audio.duration = 180; fallback.audio.readyState = 4; fallback.audio.emit('loadedmetadata'); fallback.audio.emit('playing'); fallback.audio.currentTime = 12;
  fallback.document.emit('keydown', keyEvent(spaceTarget('page'))); fallback.advance(900);
  fallback.audio.playResults.push(oggPlay.promise, mp3Play.promise);
  fallback.document.emit('keydown', keyEvent(spaceTarget('page')));
  const oggAttempt = fallback.state().shortcutPending; oggPlay.reject(unsupported); await flush();
  assert.equal(fallback.state().format, 'mp3'); assert.equal(fallback.state().shortcutPending, 0);
  fallback.audio.duration = 180; fallback.audio.readyState = 4; fallback.audio.emit('loadedmetadata');
  assert(fallback.state().shortcutPending > oggAttempt,
    'The shortcut intent moves to the fallback play attempt');
  mp3Play.resolve(); await flush();
  assert.equal(fallback.state().state, 'loading'); assert(fallback.state().shortcutPending > 0);
  fallback.audio.emit('playing');
  assert.equal(fallback.state().state, 'playing'); assert.equal(fallback.state().shortcutPending, 0);
  assert.equal(fallback.node('preview-player-toggle').classList.contains('is-shortcut-feedback'), true,
    'Successful fallback playback confirms the same Space action exactly at playing');
});

test('visibility pauses without discarding the song, while page exit disposes media and listeners', () => {
  const h = playerHarness(); h.setup(); h.audio.readyState = 4; h.start(h.row(9, 'spinshare_9')); h.audio.emit('playing');
  const source = h.audio.src; h.document.hidden = true; h.document.emit('visibilitychange');
  assert.equal(h.state().state, 'paused'); assert.equal(h.state().id, 9); assert.equal(h.audio.src, source);
  h.document.hidden = false; h.document.emit('visibilitychange');
  assert.equal(h.state().state, 'paused', 'Returning to the app must not autoplay');
  h.windowEvents.emit('pagehide');
  assert.equal(h.state().id, null); assert.equal(h.audio.src, ''); assert.equal(h.player.hidden, true);
  for (const name of ['loadedmetadata', 'durationchange', 'timeupdate', 'playing', 'waiting', 'stalled', 'pause', 'ended', 'error']) {
    assert.equal((h.audio.events.get(name) || []).length, 0, name);
  }
});

test('chart titles are text and one separate external link owns official navigation', () => {
  const coverBlock = extract(appSource, 'function makeCover(row){', '// One explicit, song-level stream.');
  assert.match(coverBlock, /element\('button',undefined,'cover-play preview-toggle'\)/);
  assert.match(coverBlock, /toggleChartPreview\(view\.row\)/);
  assert.doesNotMatch(coverBlock, /spinsha\.re\/song|element\('a'/, 'The cover must not navigate externally');

  const context = vm.createContext({
    URL,
    labels: ['Easy', 'Normal', 'Hard', 'Expert', 'XD'], shortLabels: ['E', 'N', 'H', 'EX', 'XD'],
    reviewCounts: new Map(),
    element(tag, text, className = '') { const node = new Element(tag); node.className = className; if (text !== undefined) node.textContent = text; return node; },
    icon(name) { const value = new Element('svg'); value.className = 'icon icon-' + name; return value; },
    m: key => key, number: value => String(value), uiAttr: (target, name, value) => target.setAttribute(name, value),
    tagKey: value => String(value).trim().toLowerCase(),
    makeCover() { const box = new Element(); box.className = 'cover-box'; const button = new Element('button'); button.className = 'cover-play'; box.append(button); return box; },
    makeAvatar() { return new Element('span'); },
    installationControl() {}, bindReviewDrawer() {}, bindChartDescriptionCard() {}, bindChartDescription() {},
    ensureChartTagsPopover() {}, makeChartTagButton() { return new Element('button'); }, scheduleChartTagsRefresh() {},
  });
  vm.runInContext(cardSource, context);
  const row = [42, 'Plain title', 'Subtitle', 'Artist', 'Charter', '2026-09-01', [[4, 40]], 40,
    {views: 1, downloads: 2, tags: [], description: ''}];
  context.__row = row; const view = vm.runInContext('createChartCard(__row)', context), card = view.card;
  const title = card.querySelector('.song-title'), links = card.querySelectorAll('a'), official = card.querySelector('.chart-official-link');
  assert.equal(title.tagName, 'h2'); assert.equal(title.href, undefined);
  assert.equal(links.length, 1); assert.strictEqual(links[0], official);
  assert.equal(official.href, 'https://spinsha.re/song/42');
  assert.equal(official.target, '_blank'); assert.equal(official.rel, 'noopener noreferrer');
  assert.equal(official.getAttribute('aria-label'), 'Open on SpinShare: Plain title');
  assert.equal(official.contains(card.querySelector('.cover-play')), false, 'Interactive controls must not be nested');
  assert.equal(card.getAttribute('aria-labelledby'), title.id);

  const steam = 'https://store.steampowered.com/app/1058830/Spin_Rhythm_XD__Monstercat_DLC/';
  const dlcRow = [...row.slice(0, 8), {...row[8], dlc: {id: 1, identifier: 'monstercat', title: 'Monstercat DLC', storeLink: steam}}];
  context.__row = dlcRow; const dlcCard = vm.runInContext('createChartCard(__row)', context).card, requirement = dlcCard.querySelector('.dlc-requirement');
  assert.equal(requirement.tagName, 'a'); assert.equal(requirement.href, steam); assert.equal(requirement.target, '_blank'); assert.equal(requirement.rel, 'noopener noreferrer');
  assert.equal(requirement.textContent, 'Requires Monstercat DLC'); assert.equal(requirement.getAttribute('aria-label'), 'Open required DLC on Steam: Monstercat DLC');
  assert.strictEqual(requirement.parentElement, dlcCard.querySelector('.song-copy'), 'The DLC requirement stays with song identity below the artist');

  for (const [title, storeLink] of [
    ['', steam], ['Monstercat\u202e DLC', steam], ['Monstercat DLC', 'http://store.steampowered.com/app/1058830/Test/'],
    ['Monstercat DLC', 'https://store.steampowered.com.evil.example/app/1058830/Test/'],
    ['Monstercat DLC', 'https://store.steampowered.com/app/1058830/Test/?ref=chart'],
    ['Monstercat DLC', 'https://store.steampowered.com/app/1058830/Test%2FMore/'],
    ['Monstercat DLC', 'https://store.steampowered.com/sub/1058830/'],
  ]) {
    context.__row = [...row.slice(0, 8), {...row[8], dlc: {title, storeLink}}];
    const fallback = vm.runInContext('createChartCard(__row)', context).card.querySelector('.dlc-requirement');
    assert.equal(fallback.tagName, 'span'); assert.equal(fallback.textContent, 'Requires DLC'); assert.equal(fallback.href, undefined);
    assert.equal(fallback.getAttribute('aria-label'), 'Requires DLC');
  }
});
