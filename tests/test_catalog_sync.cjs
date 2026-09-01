'use strict';

// Run with Node 18+: node tests/test_catalog_ui.cjs. No browser or network is used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = require('./read_web_template.cjs').readWebTemplate();
const css = fs.readFileSync(path.join(__dirname, '..', 'web', 'interface.css'), 'utf8');
const locales = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'web', 'locales.json'), 'utf8'));

function extract(start, end) {
  const from = html.indexOf(start), to = html.indexOf(end, from);
  assert(from >= 0 && to > from, `Missing production code: ${start}`);
  return html.slice(from, to);
}

function classes() {
  const values = new Set();
  return {
    add: (...names) => names.forEach(name => values.add(name)),
    remove: (...names) => names.forEach(name => values.delete(name)),
    contains: name => values.has(name),
    toggle(name, force) {
      const active = force === undefined ? !values.has(name) : Boolean(force);
      if (active) values.add(name); else values.delete(name);
      return active;
    },
  };
}

function nodeFactory() {
  const nodes = new Map();
  function make(id) {
    const events = new Map(), attributes = new Map(), fill = {style: {transform: '', removeProperty(name) { this[name] = ''; }}};
    return {
      id, hidden: false, disabled: false, inert: false, open: false, textContent: '', dataset: {},
      classList: classes(), style: {left: '', top: ''}, attributes, events,
      setAttribute(name, value) { attributes.set(name, String(value)); },
      removeAttribute(name) { attributes.delete(name); },
      addEventListener(name, callback) { events.set(name, callback); },
      querySelector(selector) { return selector === 'span' ? fill : null; },
      contains() { return false; },
      matches(selector) { return selector === ':popover-open' ? Boolean(this.popoverOpen) : false; },
      showPopover() { this.popoverOpen = true; }, hidePopover() { this.popoverOpen = false; },
      showModal() { this.open = true; }, close() { this.open = false; }, focus() {},
      getBoundingClientRect() { return {left: 100, right: 140, top: 100, bottom: 130, width: 320, height: 150}; },
      fill,
    };
  }
  const get = id => { if (!nodes.has(id)) nodes.set(id, make(id)); return nodes.get(id); };
  return {get, nodes};
}

function chart(id, title = `Chart ${id}`) {
  return {id, title, artist: 'Artist', charter: 'Charter', uploadDate: {date: '2026-09-01 00:00:00'}, hasXDDifficulty: true, XDDifficulty: 20};
}

function harness({now = 2_000_000_000_000, visible = true, hidden = false, catalog = null, fetchedAt = null} = {}) {
  const dom = nodeFactory(), requests = [], responses = [], timers = new Map();
  dom.get('catalog-sync-toast').hidden = true;
  let nextTimer = 0;
  class ClockDate extends Date { static now() { return now; } }
  const context = {
    AbortController, DOMException, TypeError, Date: ClockDate,
    INSTALL_ORIGIN: 'http://127.0.0.1:3210', INSTALL_KEY: 'a'.repeat(64), responseLimit: 32 * 1024 * 1024,
    CHART_ENDPOINTS: {cache: '/v1/charts', manual: '/v1/charts/manual', automatic: '/v1/charts/automatic', status: '/v1/charts/status'},
    CATALOG_STALE_MS: 12 * 60 * 60 * 1000, CATALOG_STATUS_POLL_MS: 500, requestTimeout: 120000,
    CHART_ERROR_TEXT: {charts_network_error: 'Could not connect to the chart server'},
    CHART_TOAST_ERROR_TEXT: {charts_network_error: 'Could not connect to the chart server', charts_cache_error: 'Local chart data could not be read or saved'}, INSTALLER_ERROR_TEXT: {},
    catalog, catalogFetchedAt: fetchedAt, catalogNextAllowedAt: 0, catalogAutomaticNextAllowedAt: 0,
    catalogStartupBusy: true, catalogManualBusy: false, catalogAutomaticBusy: false, catalogAutomaticTimer: null, catalogStartupWork: null,
    catalogFailureHasData: false, catalogStatusPoll: null, catalogHelpTimer: null, catalogDialogCloseTimer: null,
    catalogToastTimer: null, catalogToastMotion: null, catalogToastStartedAt: 0, catalogToastRemaining: 0, catalogPendingToast: null,
    appExiting: false, hostVisible: visible, phase: 'idle', applied: null,
    cacheGeneration: 0, presenceGeneration: 0, reviewCounts: new Map(), reviewCache: new Map(), profileCache: new Map(), userSearchCache: new Map(), installedCharts: new Map(), presenceQueue: new Map(),
    document: {hidden, activeElement: null, documentElement: {clientWidth: 1200, clientHeight: 800}, addEventListener() {}},
    globalThis: null, $: dom.get,
    m: value => String(value), number: value => String(value),
    uiText(node, value) { node.textContent = String(value ?? ''); return node; },
    uiError(value) { const error = new Error(String(value)); error.uiMessage = String(value); return error; },
    errorText(error) { return error?.uiMessage || error?.message || String(error); },
    loadingIndicator(node, active) { node.classList.toggle('is-loading', active); },
    setStatus() {}, syncFilters() {}, indexCatalogTags(data) { context.indexed = data; },
    reconcilePreviewCatalog(data) { context.reconciled = data; }, stopTextSearch() {}, compact() { return []; }, async rebuild() {},
    playMotion() { return null; }, motionAllowed() { return false; }, MOTION_MS: {feedback: 150, standard: 180, panel: 220, expressive: 280},
    async exitTool() { return true; },
    setTimeout(callback, delay) { const id = ++nextTimer; timers.set(id, {callback, delay}); return id; },
    clearTimeout(id) { timers.delete(id); },
    async readJSONResponse(response, _limit, onProgress) { if (response.body?.progress) onProgress?.(response.body.progress); return response.body; },
    async fetch(url, options) {
      requests.push({url, options}); assert(responses.length, `Unexpected request: ${url}`);
      const response = responses.shift();
      return {ok: response.ok, status: response.status, headers: {get: name => name === 'Content-Length' ? response.length : null}, body: response.body};
    },
  };
  context.globalThis = context;
  const api = vm.createContext(context);
  vm.runInContext(extract('function syncCatalogRefresh(', 'async function readJSONResponse('), api);
  api.syncFilters = () => api.syncCatalogRefresh();
  const enqueue = (body, {ok = true, status = ok ? 200 : 503, length = null} = {}) => responses.push({body, ok, status, length});
  return {api, dom, requests, responses, timers, enqueue, setNow(value) { now = value; }};
}

function checkMarkupAndMotion() {
  assert.match(html, /const CATALOG_STALE_MS=12\*60\*60\*1000/, 'The production automatic update threshold stays at 12 hours');
  const summary = html.slice(html.indexOf('<summary>'), html.indexOf('</summary>') + 10);
  assert.match(summary, /id="refresh-data"[\s\S]*data-ui-static="Update data"/);
  assert.match(summary, /id="refresh-data-help"[\s\S]*aria-describedby="refresh-data-help-panel"/);
  assert.doesNotMatch(summary, /\btitle=/i, 'Update controls must not create native hover text');
  const refreshHelpButton = summary.match(/<button id="refresh-data-help"[^>]*>/)?.[0] || '';
  assert.doesNotMatch(refreshHelpButton, /\bpopovertarget(?:action)?=/, 'Hover help must not retain native click-to-toggle behavior');
  for (const id of ['refresh-data-help-panel', 'settings-close-help-panel', 'app-dialog-help-panel']) {
    assert.match(html, new RegExp(`id="${id}"[^>]*popover="manual"[^>]*role="tooltip"`), `${id} is controlled only by hover and keyboard focus`);
  }
  const filterStart = html.indexOf('<details id="filter-panel"'), filterEnd = html.indexOf('</details>', filterStart);
  const refreshHelpPanel = html.indexOf('id="refresh-data-help-panel"');
  assert(filterStart >= 0 && filterEnd > filterStart && refreshHelpPanel > filterEnd,
    'The data help panel must remain renderable when the filter details is collapsed');
  assert.match(html, /data-ui-static="Data update guide">Data update guide</);
  assert.doesNotMatch(html, /Automatic data updates/, 'The help heading must not make the manual button look automatic');
  assert.match(html, /data-ui-static="Automatic sync">Automatic sync<[\s\S]*Saved chart data older than 12 hours syncs automatically/);
  assert.match(html, /data-ui-static="Manual update">Manual update<[\s\S]*At most one manual update can run every 10 minutes/);
  assert.match(css, /\.catalog-help-rules > div\s*\{[^}]*grid-template-columns:\s*max-content minmax\(0, 1fr\)/s, 'Automatic and manual rules share one aligned layout');
  assert.doesNotMatch(html, /Loading charts timed out\. Retry will follow the catalog refresh interval\./, 'Cache-only retries never inherit the remote cooldown wording');
  assert.match(html, /id="catalog-sync-toast"[^>]*aria-live="polite"[^>]*aria-atomic="true"[\s\S]*id="catalog-sync-toast-message"(?![^>]*role="status")/, 'The toast has one live region owner');
  for (const id of ['catalog-sync-toast-primary-label', 'catalog-sync-toast-primary-value', 'catalog-sync-toast-secondary-label', 'catalog-sync-toast-secondary-value']) {
    assert.match(html, new RegExp(`id="${id}"`), `The structured update toast exposes ${id}`);
  }
  const start = html.indexOf('id="catalog-sync-dialog"'), dialog = html.slice(start, html.indexOf('</dialog>', start));
  assert.match(dialog, /id="catalog-sync-retry"/); assert.match(dialog, /id="catalog-sync-fallback"/);
  assert.match(dialog, /id="catalog-sync-retry-state"/); assert.match(dialog, /id="catalog-sync-local-state"/);
  assert.doesNotMatch(dialog, /Close|Skip|catalog-sync-close/i, 'Startup focus has no close or skip action');
  assert.match(html, /catalog-sync-retry'\)\.addEventListener\('click',\(\)=>manualCatalogSync\(true\)\)/, 'Startup retry must use the foreground manual channel');
  assert.match(css, /\.catalog-sync-dialog::backdrop[^{]*\{[^}]*backdrop-filter:\s*blur\(5px\)/s);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*catalog-sync-loading-icon[\s\S]*animation:\s*none/);
  assert.match(css, /catalog-sync-meter\.is-indeterminate[^}]*animation:/, 'Unknown totals need an indeterminate track');
  const toastMotion = extract('function hideCatalogToast(', 'function catalogProgressText(');
  const dialogMotion = extract('function openCatalogSyncDialog(', 'function showCatalogSyncLoading(');
  assert.doesNotMatch(toastMotion + dialogMotion, /translate|scale\(/, 'Sync toast and startup card must fade in place without directional motion');
}

function checkHelpPopoverInteractions() {
  class HelpNode {
    constructor(id, rect = {}) {
      this.id = id; this.hidden = false; this.disabled = false; this.inert = false; this.open = false;
      this.popoverOpen = false; this.hovered = false; this.focusVisible = false; this.events = new Map();
      this.attributes = new Map(); this.classList = classes(); this.style = {left: '', top: '', maxHeight: ''};
      this.rect = {left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0, ...rect};
    }
    addEventListener(name, callback) {
      if (!this.events.has(name)) this.events.set(name, []);
      this.events.get(name).push(callback);
    }
    emit(name, details = {}) {
      if (name === 'pointerenter') this.hovered = true;
      if (name === 'pointerleave') this.hovered = false;
      if (name === 'focus' || name === 'focusin') { this.focusVisible = true; helpDocument.activeElement = this; }
      if (name === 'blur' || name === 'focusout') { this.focusVisible = false; helpDocument.activeElement = details.relatedTarget || null; }
      const event = {target: this, relatedTarget: null,
        preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.propagationStopped = true; }, ...details};
      for (const callback of this.events.get(name) || []) callback(event);
      return event;
    }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    matches(selector) {
      if (selector === ':popover-open') return this.popoverOpen;
      if (selector === ':hover') return this.hovered;
      if (selector === ':focus-visible') return this.focusVisible;
      return selector === '.help-toggle' && this.classList.contains('help-toggle');
    }
    showPopover() { if (!this.popoverOpen) { this.popoverOpen = true; this.emit('toggle', {newState: 'open'}); } }
    hidePopover() { if (this.popoverOpen) { this.popoverOpen = false; this.emit('toggle', {newState: 'closed'}); } }
    getBoundingClientRect() { return {...this.rect}; }
    querySelector(selector) { return selector === '.help-toggle' ? this.helpToggle || null : null; }
  }

  const nodes = new Map(), timers = new Map(), viewportEvents = new Map(); let nextTimer = 0;
  const add = (id, rect) => { const node = new HelpNode(id, rect); nodes.set(id, node); return node; };
  const refreshButton = add('refresh-data-help', {left: 900, right: 928, top: 80, bottom: 108, width: 28, height: 28});
  const refreshPanel = add('refresh-data-help-panel', {width: 360, height: 180});
  const filter = add('filter-panel'); filter.open = false;
  const settingsButton = add('settings-close-help', {left: 520, right: 548, top: 340, bottom: 368, width: 28, height: 28});
  const settingsPanel = add('settings-close-help-panel', {width: 340, height: 220});
  const settingsOwner = add('settings-panel', {left: 300, right: 900, top: 180, bottom: 680, width: 600, height: 500});
  const dialogButton = add('app-dialog-help', {left: 560, right: 588, top: 500, bottom: 528, width: 28, height: 28});
  const dialogPanel = add('app-dialog-help-panel', {width: 340, height: 220});
  const dialogOwner = add('app-dialog', {left: 300, right: 900, top: 300, bottom: 680, width: 600, height: 380});
  for (const [button, panel, owner] of [[settingsButton, settingsPanel, settingsOwner], [dialogButton, dialogPanel, dialogOwner]]) {
    button.classList.add('help-toggle'); owner.open = true; owner.helpToggle = button;
  }
  const helpDocument = {
    hidden: false, activeElement: null,
    documentElement: {clientWidth: 1200, clientHeight: 800, dataset: {inputModality: 'keyboard'}},
    querySelectorAll(selector) { return selector === '.close-help-task' ? [] : []; },
    addEventListener(name, callback) {
      if (!viewportEvents.has(name)) viewportEvents.set(name, []);
      viewportEvents.get(name).push(callback);
    },
  };
  const context = {
    $: id => nodes.get(id), document: helpDocument, hostVisible: true, appDialogState: null,
    hasActiveInstallations: () => false, catalogHelpTimer: null,
    setTimeout(callback, delay) { const id = ++nextTimer; timers.set(id, {callback, delay}); return id; },
    clearTimeout(id) { timers.delete(id); },
    addEventListener(name, callback) {
      if (!viewportEvents.has(name)) viewportEvents.set(name, []);
      viewportEvents.get(name).push(callback);
    },
  };
  context.globalThis = context;
  const api = vm.createContext(context);
  const starts = ['const helpPopoverTimers', 'function setupHoverHelp(', 'function refreshCloseHelpTasks(']
    .map(marker => html.indexOf(marker)).filter(index => index >= 0);
  const helpStart = Math.min(...starts), closeEnd = html.indexOf('async function openSettings(', helpStart);
  assert(Number.isFinite(helpStart) && closeEnd > helpStart, 'The shared hover-help controller must be extractable');
  const catalogStart = html.indexOf('function positionCatalogHelp('), catalogEnd = html.indexOf('function pauseCatalogToast(', catalogStart);
  assert(catalogStart >= 0 && catalogEnd > catalogStart, 'The data-help controller must be extractable');
  vm.runInContext(html.slice(helpStart, closeEnd) + '\n' + html.slice(catalogStart, catalogEnd), api);
  api.setupCloseHelp(); api.setupCatalogHelp();

  const runTimers = () => {
    while (timers.size) {
      const pending = [...timers.values()]; timers.clear();
      for (const timer of pending) timer.callback();
    }
  };
  const focus = node => { node.emit('focus'); node.emit('focusin'); };
  const blur = (node, relatedTarget = null) => { node.emit('blur', {relatedTarget}); node.emit('focusout', {relatedTarget}); };
  const openByPointer = (button, panel) => {
    button.emit('pointerenter', {pointerType: 'mouse'});
    assert.equal(panel.popoverOpen, true, `${button.id} opens on hover`);
  };
  const closeByLeaving = (target, button, panel) => {
    target.emit('pointerleave', {pointerType: 'mouse'}); runTimers();
    assert.equal(panel.popoverOpen, false, `${button.id} closes after leaving its hover union`);
  };

  openByPointer(refreshButton, refreshPanel);
  assert.equal(filter.open, false, 'Collapsed filters do not block data help');
  assert(parseFloat(refreshPanel.style.top) >= refreshButton.rect.bottom,
    'Data help prefers the space below its question button');
  const refreshClick = refreshButton.emit('click');
  assert.equal(refreshPanel.popoverOpen, true, 'Clicking an open hover tooltip must not toggle it closed');
  assert.equal(filter.open, false, 'Clicking the question button must not expand or collapse the filter details');
  assert.equal(refreshClick.propagationStopped, true, 'The question button click must not activate its summary ancestor');
  refreshButton.emit('pointerleave', {pointerType: 'mouse'}); refreshPanel.emit('pointerenter', {pointerType: 'mouse'}); runTimers();
  assert.equal(refreshPanel.popoverOpen, true, 'Moving from the question button into its panel keeps it open');
  closeByLeaving(refreshPanel, refreshButton, refreshPanel);
  refreshButton.emit('click');
  assert.equal(refreshPanel.popoverOpen, false, 'Clicking a closed question button must not open it');
  focus(refreshButton); assert.equal(refreshPanel.popoverOpen, true, 'Keyboard focus opens data help while filters are collapsed');
  blur(refreshButton); runTimers(); assert.equal(refreshPanel.popoverOpen, false, 'Leaving keyboard focus closes data help');

  for (const [button, panel] of [[settingsButton, settingsPanel], [dialogButton, dialogPanel]]) {
    openByPointer(button, panel);
    button.emit('click'); assert.equal(panel.popoverOpen, true, `${button.id} click does not toggle hover help`);
    closeByLeaving(button, button, panel);
    focus(button); assert.equal(panel.popoverOpen, true, `${button.id} opens for keyboard focus`);
    blur(button); runTimers(); assert.equal(panel.popoverOpen, false, `${button.id} closes after keyboard focus leaves`);
  }
  openByPointer(dialogButton, dialogPanel);
  assert(parseFloat(dialogPanel.style.top) + dialogPanel.rect.height <= dialogButton.rect.top,
    'The close-window explanation prefers the space above its question button');
}

async function checkEndpointContract() {
  const h = harness(), signal = new AbortController().signal, payload = {data: [chart(1)], cached: true, stale: false, fetchedAt: 10, changed: false, nextAllowedAt: 20, automaticNextAllowedAt: 30};
  for (const kind of ['cache', 'manual', 'automatic']) { h.enqueue(payload); await h.api.requestCatalog(kind, signal); }
  assert.deepEqual(h.requests.map(request => [new URL(request.url).pathname, request.options.method]), [['/v1/charts', 'GET'], ['/v1/charts/manual', 'POST'], ['/v1/charts/automatic', 'POST']]);
  assert.equal(h.requests[0].options.body, undefined); for (const request of h.requests.slice(1)) assert.equal(request.options.body, '{}');
  for (const request of h.requests) { assert.equal(request.options.headers['X-SpinShare-Key'], h.api.INSTALL_KEY); assert.equal(request.options.mode, 'same-origin'); assert.equal(request.options.redirect, 'error'); }
  assert.equal(h.api.catalogNextAllowedAt, 20); assert.equal(h.api.catalogAutomaticNextAllowedAt, 30);
}

function checkChangedAuthority() {
  const saved = [chart(1)], h = harness({catalog: saved, fetchedAt: 100}), names = ['reviewCounts', 'reviewCache', 'profileCache', 'userSearchCache', 'installedCharts', 'presenceQueue'];
  for (const name of names) h.api[name].set(17, name);
  let result = h.api.publishCatalogResult({data: saved, cached: true, stale: false, fetchedAt: 200, changed: false});
  assert.equal(result.changed, false); assert.equal(result.serverChanged, false); assert.equal(h.api.cacheGeneration, 0); assert.equal(h.api.presenceGeneration, 0);
  for (const name of names) assert.equal(h.api[name].get(17), name, `${name} survives changed=false`);
  result = h.api.publishCatalogResult({data: [chart(2)], cached: false, stale: false, fetchedAt: 300, changed: true});
  assert.equal(result.changed, true); assert.equal(result.serverChanged, true); assert.equal(h.api.cacheGeneration, 1); assert.equal(h.api.presenceGeneration, 1);
  for (const name of names) assert.equal(h.api[name].size, 0, `${name} belongs to the old generation`);

  for (const name of names) h.api[name].set(18, name);
  result = h.api.publishCatalogResult({data: [chart(3)], cached: true, stale: false, fetchedAt: 400, changed: false, outcome: 'fresh'});
  assert.equal(result.changed, true, 'A newer tray-owned cache generation must rebuild the visible results');
  assert.equal(result.serverChanged, false, 'Reopening must not announce another foreground update');
  assert.equal(h.api.cacheGeneration, 2); assert.equal(h.api.presenceGeneration, 2);
  for (const name of names) assert.equal(h.api[name].size, 0, `${name} cannot survive a tray cache handoff`);
}

async function checkStartupFreshAndStale() {
  {
    const h = harness(), fetchedAt = h.api.Date.now();
    h.enqueue({data: [chart(1)], cached: true, stale: false, fetchedAt, changed: false, nextAllowedAt: fetchedAt + 600000, automaticNextAllowedAt: fetchedAt + 43200000});
    await h.api.startCatalogRuntime();
    assert.deepEqual(h.requests.map(request => new URL(request.url).pathname), ['/v1/charts']);
    assert.equal(h.api.catalogStartupBusy, false); assert.equal(h.dom.get('catalog-sync-dialog').open, false);
    assert.equal(h.dom.get('refresh-data').disabled, false, 'Manual update is available before any filter is applied');
  }
  {
    const h = harness(), old = h.api.Date.now() - 43200001;
    h.enqueue({data: [chart(1)], cached: true, stale: true, fetchedAt: old, changed: false, automaticNextAllowedAt: 0});
    h.enqueue({data: [chart(2)], cached: false, stale: false, fetchedAt: h.api.Date.now(), changed: true, outcome: 'updated', automaticNextAllowedAt: h.api.Date.now() + 43200000});
    await h.api.startCatalogRuntime();
    assert.deepEqual(h.requests.map(request => [new URL(request.url).pathname, request.options.method]), [['/v1/charts', 'GET'], ['/v1/charts/automatic', 'POST']]);
    assert.equal(h.dom.get('catalog-sync-dialog').dataset.state, 'success'); assert.equal(h.dom.get('catalog-sync-dialog').open, true);
    assert.equal(h.api.catalogStartupBusy, false); assert.equal(h.dom.get('refresh-data').disabled, false);
  }
}

async function checkStartupFailureAndManualRetry() {
  const h = harness(), old = h.api.Date.now() - 43200001;
  h.enqueue({data: [chart(1)], cached: true, stale: true, fetchedAt: old, changed: false});
  h.enqueue({data: [chart(1)], cached: true, stale: true, fetchedAt: old, changed: false, outcome: 'backoff', automaticRetryAfterSeconds: 61});
  await h.api.startCatalogRuntime();
  assert.equal(h.dom.get('catalog-sync-dialog').dataset.state, 'error'); assert.equal(h.dom.get('catalog-sync-fallback').textContent, 'Use local data');
  assert.equal(h.dom.get('catalog-sync-retry-state').textContent, 'Available now',
    'Automatic backoff must not disable the independent manual retry action');
  assert.equal(h.dom.get('catalog-sync-local-state').textContent, 'Local chart data');
  assert.equal(h.api.catalogAutomaticNextAllowedAt, h.api.Date.now() + 5 * 60 * 1000, 'Missing automatic retry metadata falls back to the first five-minute backoff');
  h.enqueue({data: [chart(1)], cached: true, stale: true, fetchedAt: old, changed: false, outcome: 'cooldown', retryAfterSeconds: 42});
  assert.equal(await h.api.manualCatalogSync(true), false); assert.equal(new URL(h.requests.at(-1).url).pathname, '/v1/charts/manual');
  assert.equal(h.dom.get('catalog-sync-dialog').dataset.state, 'error'); assert.equal(h.dom.get('catalog-sync-retry-state').textContent, 'Available in 42 sec');
  assert.equal(h.dom.get('catalog-sync-local-state').textContent, 'Local chart data');
  assert.equal(h.api.catalogStartupBusy, true, 'Cooldown cannot unlock the startup surface');
  h.enqueue({data: [chart(2)], cached: false, stale: false, fetchedAt: h.api.Date.now(), changed: true, outcome: 'updated'});
  assert.equal(await h.api.manualCatalogSync(true), true); assert.equal(h.dom.get('catalog-sync-dialog').dataset.state, 'success'); assert.equal(h.api.catalogStartupBusy, false);
}

async function checkNoCacheFailure() {
  const h = harness();
  h.enqueue({data: null, cached: false, stale: true, fetchedAt: null, changed: false});
  h.enqueue({data: null, cached: false, stale: true, outcome: 'failed', errorCode: 'charts_network_error'}, {ok: false, status: 502});
  await h.api.startCatalogRuntime();
  assert.equal(h.dom.get('catalog-sync-dialog').dataset.state, 'error'); assert.equal(h.dom.get('catalog-sync-fallback').textContent, 'Quit app');
  assert.equal(h.api.catalog, null); assert.equal(h.api.catalogStartupBusy, true);
}

async function checkManualAndForegroundAutomatic() {
  {
    const h = harness({catalog: [chart(1)], fetchedAt: 100}); h.api.catalogStartupBusy = false; h.api.syncCatalogRefresh();
    h.enqueue({data: [chart(1)], cached: true, stale: false, fetchedAt: 200, changed: false, outcome: 'unchanged'});
    assert.equal(await h.api.manualCatalogSync(false), true); assert.equal(new URL(h.requests[0].url).pathname, '/v1/charts/manual');
    assert.equal(h.api.phase, 'idle'); assert.equal(h.api.applied, null); assert.equal(h.dom.get('catalog-sync-toast').hidden, false);
    assert.equal(h.dom.get('catalog-sync-toast-message').textContent, 'Chart data is already up to date.');
  }
  {
    const h = harness({catalog: [chart(1)], fetchedAt: 0, hidden: true}); h.api.catalogStartupBusy = false;
    assert.equal(h.api.maybeRunAutomaticCatalogSync(), undefined); assert.equal(h.requests.length, 0, 'Hidden WebView leaves tray synchronization to desktop');
    h.api.document.hidden = false; h.api.hostVisible = false;
    assert.equal(h.api.maybeRunAutomaticCatalogSync(), undefined); assert.equal(h.requests.length, 0);
    h.api.hostVisible = true; h.enqueue({data: [chart(1)], cached: true, stale: false, fetchedAt: h.api.Date.now(), changed: false, outcome: 'unchanged'});
    await h.api.maybeRunAutomaticCatalogSync(); assert.equal(new URL(h.requests[0].url).pathname, '/v1/charts/automatic');
    assert.equal(h.dom.get('catalog-sync-toast').hidden, true, 'changed=false remains quiet');
  }
}

function checkProgressModes() {
  const h = harness();
  h.api.updateCatalogSyncProgress({phase: 'receiving', bytesReceived: 1_200_000, contentLength: null});
  assert.equal(h.dom.get('catalog-sync-meter').classList.contains('is-indeterminate'), true); assert.match(h.dom.get('catalog-sync-progress').textContent, /Received 1.2 MB/);
  h.api.updateCatalogSyncProgress({phase: 'receiving', bytesReceived: 2_500_000, contentLength: 10_000_000});
  assert.equal(h.dom.get('catalog-sync-meter').classList.contains('is-determinate'), true); assert.equal(h.dom.get('catalog-sync-meter').fill.style.transform, 'scaleX(0.25)');
  h.api.updateCatalogSyncProgress({phase: 'saving'}); assert.equal(h.dom.get('catalog-sync-progress').textContent, 'Saving chart data safely...');
}

function checkClassifiedErrorsInBothLanguages() {
  const h = harness(), manual = h.api.catalogPayloadError({outcome: 'failed', errorCode: 'charts_network_error', retryAfterSeconds: 42});
  assert.equal(manual.uiMessage, 'Could not connect to the chart server',
    'The reason remains concise because retry timing has its own structured field');
  const automatic = h.api.catalogPayloadError({outcome: 'backoff', errorCode: 'charts_network_error', automaticRetryAfterSeconds: 61});
  assert.equal(automatic.uiMessage, 'Could not connect to the chart server',
    'Automatic retry timing must not be concatenated into the reason');
  const failedToast = h.api.catalogToastFailure(manual);
  assert.equal(failedToast.title, 'Could not connect to the chart server');
  assert.deepEqual([failedToast.primary.label, failedToast.primary.value], ['Manual retry', 'Available in 42 sec']);
  assert.deepEqual([failedToast.secondary.label, failedToast.secondary.value], ['Currently using', 'Local chart data']);

  const cooldown = h.api.catalogPayloadError({outcome: 'cooldown', retryAfterSeconds: 595});
  const cooldownToast = h.api.catalogToastFailure(cooldown, 'manual');
  assert.equal(cooldownToast.title, 'Manual update is not available yet');
  assert.deepEqual([cooldownToast.primary.label, cooldownToast.primary.value], ['Manual retry', 'Available in 9 min 55 sec']);
  assert.deepEqual([cooldownToast.secondary.label, cooldownToast.secondary.value], ['Currently using', 'Local chart data']);
  h.api.showCatalogToast(cooldownToast, 'error');
  assert.equal(h.dom.get('catalog-sync-toast-message').textContent, 'Manual update is not available yet');
  assert.deepEqual([h.dom.get('catalog-sync-toast-primary-label').textContent, h.dom.get('catalog-sync-toast-primary-value').textContent], ['Manual retry', 'Available in 9 min 55 sec']);
  assert.deepEqual([h.dom.get('catalog-sync-toast-secondary-label').textContent, h.dom.get('catalog-sync-toast-secondary-value').textContent], ['Currently using', 'Local chart data']);
  for (const language of ['en', 'zh-CN']) {
    const messages = locales[language];
    for (const key of ['Could not connect to the chart server', 'The chart server did not respond in time',
      'The chart server denied access', 'The chart server is temporarily limiting updates',
      'The chart server is temporarily unavailable', 'The chart server rejected this update',
      'Chart data transfer timed out', 'Chart data transfer was interrupted', 'Chart data exceeded the safe size limit',
      'The chart server returned invalid data', 'Local chart data could not be read or saved', ' min ', ' min', ' sec',
      'Manual update is not available yet', 'Automatic sync did not finish', 'Manual retry', 'Automatic retry',
      'Currently using', 'Available in ', 'Available now', 'Local chart data', 'No local chart data']) {
      assert.equal(typeof messages[key], 'string', `${language} must localize ${key}`); assert(messages[key].length > 0);
    }
  }
  assert.match(locales['zh-CN']['Could not connect to the chart server'], /谱面服务器/);
}

async function main() {
  checkMarkupAndMotion(); checkHelpPopoverInteractions(); await checkEndpointContract(); checkChangedAuthority(); await checkStartupFreshAndStale();
  await checkStartupFailureAndManualRetry(); await checkNoCacheFailure(); await checkManualAndForegroundAutomatic(); checkProgressModes(); checkClassifiedErrorsInBothLanguages();
  console.log('PASS: cache-only startup, focused automatic sync, foreground manual retry/cooldown, nonblocking updates, visibility ownership, authoritative changed flags, classified bilingual errors, progress modes, hover help behavior and reduced motion.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
