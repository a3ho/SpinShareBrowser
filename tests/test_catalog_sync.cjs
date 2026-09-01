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
    CHART_ERROR_TEXT: {charts_network_error: 'The chart server could not be reached.'},
    CHART_TOAST_ERROR_TEXT: {charts_network_error: 'Chart server unavailable.', charts_cache_error: 'Chart data could not be saved locally.'}, INSTALLER_ERROR_TEXT: {},
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
  assert.match(html, /id="refresh-data-help"[^>]*popovertarget="refresh-data-help-panel"/);
  assert.match(html, /id="refresh-data-help-panel"[^>]*popover="auto"[^>]*role="tooltip"/);
  assert.match(html, /data-ui-static="Data update guide">Data update guide</);
  assert.doesNotMatch(html, /Automatic data updates/, 'The help heading must not make the manual button look automatic');
  assert.match(html, /data-ui-static="Automatic sync">Automatic sync<[\s\S]*Saved chart data older than 12 hours syncs automatically/);
  assert.match(html, /data-ui-static="Manual update">Manual update<[\s\S]*At most one manual update can run every 10 minutes/);
  assert.match(css, /\.catalog-help-rules > div\s*\{[^}]*grid-template-columns:\s*max-content minmax\(0, 1fr\)/s, 'Automatic and manual rules share one aligned layout');
  assert.doesNotMatch(html, /Loading charts timed out\. Retry will follow the catalog refresh interval\./, 'Cache-only retries never inherit the remote cooldown wording');
  assert.match(html, /id="catalog-sync-toast"[^>]*aria-live="polite"[^>]*aria-atomic="true"[\s\S]*id="catalog-sync-toast-message"(?![^>]*role="status")/, 'The toast has one live region owner');
  const start = html.indexOf('id="catalog-sync-dialog"'), dialog = html.slice(start, html.indexOf('</dialog>', start));
  assert.match(dialog, /id="catalog-sync-retry"/); assert.match(dialog, /id="catalog-sync-fallback"/);
  assert.doesNotMatch(dialog, /Close|Skip|catalog-sync-close/i, 'Startup focus has no close or skip action');
  assert.match(html, /catalog-sync-retry'\)\.addEventListener\('click',\(\)=>manualCatalogSync\(true\)\)/, 'Startup retry must use the foreground manual channel');
  assert.match(css, /\.catalog-sync-dialog::backdrop[^{]*\{[^}]*backdrop-filter:\s*blur\(5px\)/s);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*catalog-sync-loading-icon[\s\S]*animation:\s*none/);
  assert.match(css, /catalog-sync-meter\.is-indeterminate[^}]*animation:/, 'Unknown totals need an indeterminate track');
  const toastMotion = extract('function hideCatalogToast(', 'function catalogProgressText(');
  const dialogMotion = extract('function openCatalogSyncDialog(', 'function showCatalogSyncLoading(');
  assert.doesNotMatch(toastMotion + dialogMotion, /translate|scale\(/, 'Sync toast and startup card must fade in place without directional motion');
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
  assert.match(h.dom.get('catalog-sync-detail').textContent, /61 seconds/);
  assert.equal(h.api.catalogAutomaticNextAllowedAt, h.api.Date.now() + 5 * 60 * 1000, 'Missing automatic retry metadata falls back to the first five-minute backoff');
  h.enqueue({data: [chart(1)], cached: true, stale: true, fetchedAt: old, changed: false, outcome: 'cooldown', retryAfterSeconds: 42});
  assert.equal(await h.api.manualCatalogSync(true), false); assert.equal(new URL(h.requests.at(-1).url).pathname, '/v1/charts/manual');
  assert.equal(h.dom.get('catalog-sync-dialog').dataset.state, 'error'); assert.match(h.dom.get('catalog-sync-detail').textContent, /42 seconds/);
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
  assert.match(manual.uiMessage, /^The chart server could not be reached\.\nManual update can be retried in 42 seconds\.$/,
    'The concrete failure category must precede manual cooldown details');
  const automatic = h.api.catalogPayloadError({outcome: 'backoff', errorCode: 'charts_network_error', automaticRetryAfterSeconds: 61});
  assert.match(automatic.uiMessage, /^The chart server could not be reached\.\nAutomatic updates will retry in 61 seconds\. Manual retry is still available\.$/,
    'Automatic backoff must leave foreground retry visibly available');
  assert.equal(h.api.catalogToastFailure(manual), 'Chart server unavailable.\nContinuing with the last saved chart data.');
  for (const language of ['en', 'zh-CN']) {
    const messages = locales[language];
    for (const key of ['Chart server unavailable.', 'The chart server timed out.', 'Chart server access was refused.',
      'Chart server rate limit reached.', 'The chart server returned an error.', 'The chart server rejected the update.',
      'Chart data transfer timed out.', 'Chart data transfer was interrupted.', 'Chart data exceeded the safe size limit.',
      'The chart server returned invalid data.', 'Chart data could not be saved locally.', 'Continuing with the last saved chart data.',
      'Automatic updates will retry in ', ' seconds. Manual retry is still available.']) {
      assert.equal(typeof messages[key], 'string', `${language} must localize ${key}`); assert(messages[key].length > 0);
    }
  }
  assert.match(locales['zh-CN']['Chart server unavailable.'], /谱面服务器/);
  assert.match(locales['zh-CN']['Continuing with the last saved chart data.'], /上次保存/);
  assert.match(locales['zh-CN'][' seconds. Manual retry is still available.'], /手动重试/);
}

async function main() {
  checkMarkupAndMotion(); await checkEndpointContract(); checkChangedAuthority(); await checkStartupFreshAndStale();
  await checkStartupFailureAndManualRetry(); await checkNoCacheFailure(); await checkManualAndForegroundAutomatic(); checkProgressModes(); checkClassifiedErrorsInBothLanguages();
  console.log('PASS: cache-only startup, focused automatic sync, foreground manual retry/cooldown, nonblocking updates, visibility ownership, authoritative changed flags, classified bilingual errors, progress modes, help copy and reduced motion.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
