'use strict';

// Run with Node 18+: node tests/test_catalog_ui.cjs. No browser or network is used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const web = path.join(__dirname, '..', 'web');
const html = require('./read_web_template.cjs').readWebTemplate();
const catalog = JSON.parse(fs.readFileSync(path.join(web, 'locales.json'), 'utf8'));
function extract(start, end) {
  const from = html.indexOf(start), to = html.indexOf(end, from);
  assert(from >= 0 && to > from, `Missing production code: ${start}`);
  return html.slice(from, to);
}

const timers = new Map(), requests = [], responses = [];
let now = 1700000000000, nextTimer = 0;
function createNodes() {
  const nodes = new Map();
  return id => {
    if (!nodes.has(id)) nodes.set(id, {
      disabled: false, hidden: false, value: '', textContent: '', attributes: new Map(), events: new Map(),
      setAttribute(name, value) { this.attributes.set(name, value); },
      removeAttribute(name) { this.attributes.delete(name); },
      addEventListener(name, callback) { this.events.set(name, callback); },
      focus() {}, classList: {toggle() {}},
    });
    return nodes.get(id);
  };
}
const node = createNodes();
const api = vm.createContext({
  __SPINSHARE_UI_CATALOG__: catalog, TextDecoder, AbortController,
  $: node, document: {activeElement: null}, Date: {now: () => now},
  setTimeout: (callback, delay) => { const id = ++nextTimer; timers.set(id, {callback, delay}); return id; },
  clearTimeout: id => timers.delete(id),
  phase: 'idle', applied: null, appExiting: false, catalogNextAllowedAt: 0,
  INSTALL_ORIGIN: 'http://127.0.0.1:12345', INSTALL_KEY: 'a'.repeat(64), responseLimit: 32 * 1024 * 1024,
  settingsStale: false, searchFields: {title: 1, subtitle: 2, artist: 3, creator: 4},
  searchScopes: new Set(['title', 'subtitle', 'artist', 'creator']), textSearchWork: null, textSearchProblem: '',
  loadingIndicator() {}, setStatus() {}, filtersChanged: () => false,
  syncResultTools() {}, syncTagControls() {}, unknownSearchUploaders: () => false,
  updateAllInstallationViews: () => assert.fail('Queue saturation must not invalidate installation settings'),
  fetch: async (url, options) => {
    requests.push({url, options});
    assert(responses.length, `Unexpected request: ${url}`);
    const {status = 200, body} = responses.shift();
    return new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});
  },
});
vm.runInContext([
  extract('const UI_CATALOG=', 'function setUILanguage('),
  extract('const INSTALLER_MESSAGE_REPLACEMENTS=', 'function directoryText('),
  extract('function syncFilters(', 'function cancelQuery('),
  extract('function titleKey(', 'function remember('),
  extract('function canSearchUsers(', 'function unknownSearchUploaders('),
  extract('function syncSearchControls(', '// Tag matching uses only'),
  extract('function syncCatalogRefresh(', 'async function readReviews('),
  extract('async function installerRequest(', 'function installationPending('),
  extract('function applyActivity(', 'function showActivity('),
].join('\n'), api);

function checkCachedSearchAvailable() {
  api.syncFilters();
  api.syncSearchControls();
  for (const id of ['difficulty-fields', 'date-fields', 'apply-filters', 'local-search', 'search-submit', 'search-clear']) {
    assert.equal(node(id).disabled, false, `${id} must remain usable while saved data is current`);
  }
  assert.equal(node('refresh-data').disabled, false, 'Refresh list can reuse data during the server interval');
}
function checkNoCountdown() {
  assert.equal(node('refresh-data').attributes.get('title'), catalog['zh-CN']['Refresh list']);
  assert.equal(timers.size, 0, 'A catalog deadline must not schedule a UI countdown');
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
}
async function completes(promise) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('The catalog action did not finish; check for an unexpected request')), 1500);
    })]);
  } finally { clearTimeout(timer); }
}
function applyHarness() {
  const node = createNodes(), timers = new Map(), requests = [], statuses = [], renders = [];
  const criteria = {diffs: [4], min: 0, max: 99, dateFrom: '', dateTo: ''};
  let now = 1700000000000, nextTimer = 0;
  class ClockDate extends Date { static now() { return now; } }
  const app = vm.createContext({
    __SPINSHARE_UI_CATALOG__: catalog, TextDecoder, AbortController, DOMException, TypeError, URL, Date: ClockDate,
    $: node, document: {activeElement: null},
    INSTALL_ORIGIN: 'http://127.0.0.1:12345', INSTALL_KEY: 'a'.repeat(64),
    phase: 'idle', applied: null, appExiting: false, controller: null, catalog: null, catalogFetchedAt: null, catalogNextAllowedAt: 0,
    currentRows: [], filtered: [], lastAppliedCriteria: null, appliedText: '', page: 1, visibleCount: 20, scrollBatchSize: 20,
    textSearchWork: null, textSearchProblem: '', textFilterTimer: null,
    searchFields: {title: 1, subtitle: 2, artist: 3, creator: 4}, searchScopes: new Set(['title']),
    reviewCounts: new Map(), reviewCache: new Map(), profileCache: new Map(), userSearchCache: new Map(),
    installedCharts: new Map(), presenceQueue: new Map(), cacheGeneration: 0, presenceGeneration: 0,
    selectedTags: new Map(), tagCatalog: new Map(), tagResultCounts: new Map(), installationCandidates: [], pendingTagAnchor: null,
    readCriteria: () => ({...criteria, diffs: [...criteria.diffs]}), filtersChanged: () => false,
    loadingIndicator() {}, syncResultTools() {}, syncTagControls() {}, syncInstallationFilter() {},
    installationFilterMode: () => 'all', captureTagViewport: () => ({viewport: true}), dismissChartTags() {}, flyTag() {}, pulseTag() {},
    readUserSearch() { assert.fail('Title and tag filtering must not fetch uploader profiles'); },
    setStatus(message = '', error = false) { statuses.push({message, error}); },
    render() {
      renders.push({phase: app.phase, rows: Array.from(app.filtered, row => row[0])}); app.syncFilters();
    },
    setTimeout(callback, delay) { const id = ++nextTimer; timers.set(id, {callback, delay, due: now + delay}); return id; },
    clearTimeout: id => timers.delete(id),
    fetch(url, options) {
      assert.equal(url, app.INSTALL_ORIGIN + '/v1/charts', 'Filtering may only read the authenticated local catalog endpoint');
      assert.equal(options.method, 'GET'); assert.equal(options.mode, 'same-origin'); assert.equal(options.redirect, 'error');
      assert.equal(options.headers['X-SpinShare-Key'], app.INSTALL_KEY);
      const request = {url, options, ignoreAbort: false, ...deferred()}; requests.push(request);
      options.signal.addEventListener('abort', () => {
        if (!request.ignoreAbort) request.reject(new DOMException('Aborted', 'AbortError'));
      }, {once: true});
      return request.promise;
    },
  });
  vm.runInContext([
    extract('const UI_CATALOG=', 'function setUILanguage('),
    extract('const keys =', 'const FIRST_UPLOAD_DATE='),
    extract('const INSTALLER_MESSAGE_REPLACEMENTS=', 'function directoryText('),
    extract('function syncFilters(', 'function validDate('),
    extract('function validDate(', 'function siteToday('),
    extract('function titleKey(', 'function syncSearchControls('),
    extract('function syncSearchControls(', '// Tag matching uses only'),
    extract('function tagKey(', 'function positionTagPanel('),
    extract('function addTagFilter(', 'function removeTagFilter('),
    extract('function stopTextSearch(', 'function changeSearchScope('),
    extract('function countValue(', 'const defaultAvatarURL='),
    extract('function sortRows(', 'function changePage('),
    extract('function compact(', 'async function readReviews('),
    extract('async function apply(', "for(const field of Object.keys(searchFields))"),
    extract("$('local-search').addEventListener('input'", "for(const suffix of ['','-bottom'])"),
  ].join('\n'), app);
  node('sort').value = 'date'; node('sort-direction').value = 'desc'; app.syncFilters();
  const respond = (body, request = requests.at(-1), status = 200) => {
    assert(request, 'A catalog request must exist before replying');
    request.resolve(new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}}));
  };
  const advance = milliseconds => {
    const end = now + milliseconds;
    for (;;) {
      const next = [...timers].filter(([, timer]) => timer.due <= end).sort((a, b) => a[1].due - b[1].due)[0];
      if (!next) break;
      const [id, timer] = next; now = timer.due; timers.delete(id); timer.callback();
    }
    now = end;
  };
  const trigger = async (id, type, details = {}) => {
    const element = node(id), handler = element.events.get(type); assert(handler, `No production handler for ${id}:${type}`);
    const event = {target: element, preventDefault() { this.defaultPrevented = true; }, ...details};
    await completes(handler(event)); return event;
  };
  return {app, node, timers, requests, statuses, renders, criteria, respond, advance, trigger,
    apply: () => completes(app.apply()), now: () => now,
    timeout: vm.runInContext('requestTimeout', app),
    ids: () => Array.from(app.filtered, row => row[0]),
    status: () => ({text: app.renderUI(statuses.at(-1)?.message || '', 'en'), error: statuses.at(-1)?.error || false})};
}
function chart(id, title = 'Chart ' + id, tags = []) {
  return {id, title, artist: 'Artist', charter: 'Charter', uploadDate: {date: '2026-09-01 00:00:00'},
    hasXDDifficulty: true, XDDifficulty: 20 + id, tags, views: id * 10, downloads: id * 5};
}
async function restoreCatalog(h, data = [chart(1), chart(2)], extra = {}) {
  const work = h.apply();
  h.respond({data, cached: true, fetchedAt: h.now() - 1000, nextAllowedAt: h.now() + 600000, ...extra});
  await work; assert.equal(h.app.phase, 'ready'); assert.equal(h.timers.size, 0);
  return h.app.catalog;
}
const derivedCacheNames = ['reviewCounts', 'reviewCache', 'profileCache', 'userSearchCache', 'installedCharts', 'presenceQueue'];
function seedDerivedCaches(h) {
  for (const name of derivedCacheNames) h.app[name].set(17, {saved: name});
  h.app.cacheGeneration = 4; h.app.presenceGeneration = 8;
  return derivedCacheNames.map(name => h.app[name].get(17));
}
function assertDerivedCaches(h, previous, changed) {
  for (const [index, name] of derivedCacheNames.entries()) {
    if (changed) assert.equal(h.app[name].size, 0, `${name} belongs to the old catalog generation`);
    else assert.strictEqual(h.app[name].get(17), previous[index], `${name} must survive a same-version cached reply`);
  }
  assert.equal(h.app.cacheGeneration, changed ? 5 : 4); assert.equal(h.app.presenceGeneration, changed ? 9 : 8);
}

function checkExpandedActivityQueue() {
  let updated = 0, rendered = 0;
  api.updateAllInstallationViews = () => { updated++; };
  api.renderActivity = () => { rendered++; };
  function job(index = 0) {
    return {
      id: (index + 1).toString(16).padStart(32, '0'), songId: index + 1,
      state: ['queued', 'downloading', 'validating', 'extracting'][index % 4],
      downloadedBytes: 0, totalBytes: null, filesWritten: 0, fileCount: 0,
    };
  }
  for (const count of [17, 128]) {
    const jobs = Array.from({length: count}, (_, index) => job(index));
    api.activityProblem = 'Previous refresh failed';
    api.applyActivity({exiting: false, activeCount: count, jobs});
    assert.strictEqual(api.activityJobs, jobs);
    assert.equal(api.activityProblem, '');
    assert.equal(api.appExiting, false);
  }
  assert.equal(updated, 2);
  assert.equal(rendered, 2);
  const accepted = api.activityJobs;
  const invalid = [
    {exiting: false, activeCount: 129, jobs: Array.from({length: 129}, (_, index) => job(index))},
    {exiting: false, activeCount: 17, jobs: [job()]},
    {exiting: 'false', activeCount: 0, jobs: []},
    ...[
      {id: 'broken'}, {songId: 0}, {state: 'complete'},
      {downloadedBytes: -1}, {fileCount: Number.MAX_SAFE_INTEGER + 1}, {totalBytes: undefined},
    ].map(fields => ({exiting: false, activeCount: 1, jobs: [{...job(), ...fields}]})),
  ];
  for (const data of invalid) {
    assert.throws(() => api.applyActivity(data), error => {
      assert.equal(api.renderUI(api.errorText(error)), api.renderUI(api.m('Task status is unavailable. Please retry.')));
      return true;
    });
    assert.strictEqual(api.activityJobs, accepted, 'Reject malformed activity before changing the visible queue');
  }
  assert.equal(updated, 2, 'Invalid activity must not update card installation states');
  assert.equal(rendered, 2, 'Invalid activity must not render a broken footer');
}

async function checkApplyFlows() {
  let checked = 0;
  async function check(name, run) {
    try { await run(); checked++; }
    catch (error) { throw new Error(name, {cause: error}); }
  }
  await check('startup restores the complete saved catalog in each new page', async () => {
    const saved = [chart(1), chart(2), {...chart(3), hasXDDifficulty: false, hasNormalDifficulty: true, normalDifficulty: 18}];
    for (let session = 0; session < 2; session++) {
      const h = applyHarness(); h.app.catalogNextAllowedAt = h.now() + 600000;
      const work = h.trigger('filters', 'submit');
      assert.equal(h.requests.length, 1, 'A new page must ask the local service even when its deadline is in the future');
      assert.equal(h.app.phase, 'loading'); assert.equal(h.node('apply-filters').disabled, true);
      h.respond({data: saved, cached: true, fetchedAt: h.now() - 20000, nextAllowedAt: h.now() + 580000});
      assert.equal((await work).defaultPrevented, true);
      assert.equal(h.app.catalog.length, 3, 'Keep the full catalog, including charts excluded by the initial difficulty');
      assert.deepEqual(h.ids(), [2, 1]); assert.equal(h.app.phase, 'ready'); assert.equal(h.app.cacheGeneration, 0);
      assert.equal(h.app.catalogFetchedAt, h.now() - 20000); assert.deepEqual(h.status(), {text: '', error: false});
      assert.equal(h.node('refresh-data').disabled, false); assert.equal(h.timers.size, 0);
    }
  });
  await check('filter, refresh, title search, sorting and tags reuse the same unexpired table', async () => {
    const h = applyHarness();
    const saved = await restoreCatalog(h, [chart(1, 'A Piano', ['Piano']), chart(2, 'Z Drums', ['Drums']),
      {...chart(3, 'Normal chart'), hasXDDifficulty: false, hasNormalDifficulty: true, normalDifficulty: 18}]);
    const caches = seedDerivedCaches(h);
    h.node('local-search').value = 'piano'; await h.trigger('chart-search-form', 'submit'); assert.deepEqual(h.ids(), [1]);
    await h.trigger('search-clear', 'click');
    h.node('sort').value = 'title'; h.node('sort-direction').value = 'asc'; await h.trigger('sort', 'change');
    assert.deepEqual(h.ids(), [1, 2]); assert.equal(h.app.addTagFilter('Piano'), true); assert.deepEqual(h.ids(), [1]);
    h.app.selectedTags.clear(); h.criteria.diffs = [1]; await h.trigger('apply-filters', 'click'); assert.deepEqual(h.ids(), [3]);
    h.advance(599999); await h.trigger('refresh-data', 'click'); assert.deepEqual(h.ids(), [3]);
    assert.strictEqual(h.app.catalog, saved); assert.equal(h.requests.length, 1);
    assertDerivedCaches(h, caches, false); assert.deepEqual(h.status(), {text: '', error: false}); assert.equal(h.timers.size, 0);
  });
  await check('the exact expiry boundary automatically obtains a fresh generation through Filter charts', async () => {
    const h = applyHarness(); await restoreCatalog(h); const caches = seedDerivedCaches(h);
    h.advance(599999); await h.trigger('apply-filters', 'click'); assert.equal(h.requests.length, 1);
    h.advance(1); const work = h.trigger('apply-filters', 'click'); assert.equal(h.requests.length, 2);
    assert.equal(h.app.phase, 'loading'); assert.equal(h.node('refresh-data').disabled, true);
    await h.apply(); assert.equal(h.requests.length, 2, 'Concurrent filter activation must not duplicate the active request');
    h.respond({data: [chart(9, 'Updated chart', ['New tag'])], cached: false, fetchedAt: h.now(), nextAllowedAt: h.now() + 600000});
    await work;
    assert.deepEqual(h.ids(), [9]); assert.equal(h.app.catalogFetchedAt, h.now()); assertDerivedCaches(h, caches, true);
    assert.equal(h.app.tagCatalog.has('new tag'), true); assert.equal(h.app.phase, 'ready'); assert.equal(h.app.controller, null);
    assert.equal(h.timers.size, 0);
  });
  await check('same-version cached responses retain derived data while a newer saved version invalidates it', async () => {
    for (const newer of [false, true]) {
      const h = applyHarness(); await restoreCatalog(h); const caches = seedDerivedCaches(h), fetchedAt = h.app.catalogFetchedAt;
      h.advance(600000); const work = h.trigger('refresh-data', 'click');
      h.respond({data: newer ? [chart(8)] : [chart(1), chart(2)], cached: true,
        fetchedAt: newer ? fetchedAt + 1 : fetchedAt, nextAllowedAt: h.now() + 600000});
      await work; assertDerivedCaches(h, caches, newer); assert.deepEqual(h.ids(), newer ? [8] : [2, 1]);
      assert.deepEqual(h.status(), {text: '', error: false}); assert.equal(h.timers.size, 0);
    }
  });
  await check('saved data survives service failures, connection loss and timeout without becoming an error page', async () => {
    for (const failure of ['cache-write', 'connection', 'timeout', 'empty-cache-timeout']) {
      const h = applyHarness(), saved = await restoreCatalog(h, failure === 'empty-cache-timeout' ? [] : [chart(1), chart(2)]);
      const caches = seedDerivedCaches(h), fetchedAt = h.app.catalogFetchedAt;
      h.advance(600000); const work = h.apply(), request = h.requests.at(-1);
      if (failure === 'cache-write') h.respond({code: 'charts_cache_error', nextAllowedAt: h.now() + 600000}, request, 503);
      else if (failure === 'connection') request.reject(new TypeError('Local connection failed'));
      else h.advance(h.timeout);
      await work;
      assert.strictEqual(h.app.catalog, saved); assert.equal(h.app.catalogFetchedAt, fetchedAt); assertDerivedCaches(h, caches, false);
      assert.equal(h.app.phase, 'ready'); assert(h.app.applied); assert.deepEqual(h.ids(), saved.length ? [2, 1] : []);
      assert.equal(h.status().error, false); assert.match(h.status().text, /last saved copy/); assert.equal(h.timers.size, 0);
      if (failure.includes('timeout')) assert.equal(request.options.signal.aborted, true);
    }
  });
  await check('a local cached fallback response reports a neutral notice without clearing review data', async () => {
    const h = applyHarness(); await restoreCatalog(h); const caches = seedDerivedCaches(h), fetchedAt = h.app.catalogFetchedAt;
    h.advance(600000); const work = h.apply();
    h.respond({data: [chart(1), chart(2)], cached: true, fetchedAt, nextAllowedAt: h.now() + 600000, refreshError: 'The remote service is offline'});
    await work; assertDerivedCaches(h, caches, false); assert.deepEqual(h.ids(), [2, 1]);
    assert.equal(h.status().error, false); assert.match(h.status().text, /last saved copy/);
    await h.trigger('refresh-data', 'click'); assert.equal(h.requests.length, 2); assert.deepEqual(h.status(), {text: '', error: false});
  });
  await check('without any saved catalog, service failure and timeout stay errors', async () => {
    for (const failure of ['unavailable', 'timeout']) {
      const h = applyHarness(), work = h.apply();
      if (failure === 'unavailable') h.respond({code: 'charts_unavailable', nextAllowedAt: h.now() + 600000}, undefined, 503);
      else h.advance(h.timeout);
      await work;
      assert.equal(h.app.catalog, null); assert.equal(h.app.catalogFetchedAt, null); assert.equal(h.app.applied, null);
      assert.equal(h.app.phase, 'error'); assert.deepEqual(h.ids(), []); assert.equal(h.status().error, true);
      assert.match(h.status().text, failure === 'timeout' ? /timed out/ : /No saved charts/);
      assert.equal(h.app.controller, null); assert.equal(h.timers.size, 0);
    }
  });
  await check('explicit cancellation cannot republish a late response or its deadline and status', async () => {
    const h = applyHarness(), saved = await restoreCatalog(h), caches = seedDerivedCaches(h), fetchedAt = h.app.catalogFetchedAt;
    h.advance(600000); const work = h.apply(), request = h.requests.at(-1); request.ignoreAbort = true;
    h.app.cancelQuery(); const deadline = h.app.catalogNextAllowedAt, status = h.status(), renders = h.renders.length;
    assert.equal(request.options.signal.aborted, true);
    h.respond({data: [chart(99)], cached: false, fetchedAt: h.now(), nextAllowedAt: h.now() + 600000}, request); await work;
    assert.equal(h.app.phase, 'idle'); assert.equal(h.app.controller, null); assert.equal(h.app.applied, null); assert.deepEqual(h.ids(), []);
    assert.strictEqual(h.app.catalog, saved); assert.equal(h.app.catalogFetchedAt, fetchedAt); assert.equal(h.app.catalogNextAllowedAt, deadline);
    assertDerivedCaches(h, caches, false); assert.equal(h.renders.length, renders); assert.deepEqual(h.status(), status);
    assert.equal(h.timers.size, 0);
  });
  await check('a superseded response cannot clear a newer controller or overwrite its finished results', async () => {
    for (const finishNewFirst of [false, true]) {
      const h = applyHarness(); await restoreCatalog(h); seedDerivedCaches(h); h.advance(600000);
      const oldWork = h.apply(), oldRequest = h.requests.at(-1); oldRequest.ignoreAbort = true; h.app.cancelQuery();
      const newWork = h.apply(), newRequest = h.requests.at(-1), active = h.app.controller;
      if (finishNewFirst) {
        h.respond({data: [chart(20)], cached: false, fetchedAt: h.now() + 2, nextAllowedAt: h.now() + 600000}, newRequest); await newWork;
      }
      const deadline = h.app.catalogNextAllowedAt, status = h.status(), renders = h.renders.length;
      h.respond({data: [chart(90)], cached: false, fetchedAt: h.now() + 1, nextAllowedAt: h.now() + 300000}, oldRequest); await oldWork;
      assert.equal(h.app.catalogNextAllowedAt, deadline); assert.equal(h.renders.length, renders); assert.deepEqual(h.status(), status);
      if (!finishNewFirst) {
        assert.strictEqual(h.app.controller, active); assert.equal(h.app.phase, 'loading'); assert.equal(newRequest.options.signal.aborted, false);
        assert.equal(h.timers.size, 1, 'The old finally block must not cancel the current timeout');
        h.respond({data: [chart(20)], cached: false, fetchedAt: h.now() + 2, nextAllowedAt: h.now() + 600000}, newRequest); await newWork;
      }
      assert.deepEqual(h.ids(), [20]); assert.equal(h.app.cacheGeneration, 5); assert.equal(h.app.presenceGeneration, 9);
      assert.equal(h.app.controller, null); assert.equal(h.timers.size, 0);
    }
  });
  return checked;
}

async function main() {
  const controller = new AbortController();
  responses.push({body: {data: [{id: 17}], cached: true, nextAllowedAt: now + 600000}});
  const initial = await api.loadRemote(controller.signal);
  assert.equal(initial.cached, true);
  assert.equal(initial.data[0].id, 17);
  checkNoCountdown();
  api.syncFilters();
  assert.equal(node('refresh-data').disabled, true, 'Refresh list requires an applied result set');
  assert.equal(node('apply-filters').disabled, false, 'The first filter operation must still be available');
  assert.equal(node('local-search').disabled, true, 'Search still requires an applied filter');

  api.phase = 'ready';
  api.applied = {diffs: [4], min: 20, max: 30};
  node('local-search').value = 'Piano';
  checkCachedSearchAvailable();
  checkNoCountdown();

  responses.push({status: 429, body: {code: 'charts_cooldown', nextAllowedAt: now + 95000}});
  await assert.rejects(api.loadRemote(controller.signal), /No saved charts are available yet/);
  assert.equal(api.catalogNextAllowedAt, now + 95000);
  checkNoCountdown();
  checkCachedSearchAvailable();

  responses.push({status: 503, body: {code: 'charts_unavailable', nextAllowedAt: now + 600000}});
  await assert.rejects(api.loadRemote(controller.signal), /No saved charts are available yet/);
  assert.equal(api.catalogNextAllowedAt, now + 600000);
  checkNoCountdown();
  checkCachedSearchAvailable();

  assert.equal(requests.length, 3);
  for (const {url, options} of requests) {
    assert.equal(url, api.INSTALL_ORIGIN + '/v1/charts', 'Full catalog reads must use the throttled local endpoint');
    assert.equal(options.method, 'GET');
    assert.equal(options.headers['X-SpinShare-Key'], api.INSTALL_KEY);
    assert.equal(options.mode, 'same-origin');
    assert.equal(options.redirect, 'error');
    assert.strictEqual(options.signal, controller.signal);
  }

  now += 599001;
  api.syncCatalogRefresh();
  checkNoCountdown(); assert.equal(node('refresh-data').disabled, false);
  now += 999;
  api.syncCatalogRefresh();
  assert.equal(node('refresh-data').disabled, false);
  checkNoCountdown();
  for (const phase of ['idle', 'loading', 'error']) {
    api.phase = phase; api.syncCatalogRefresh(); assert.equal(node('refresh-data').disabled, true);
  }
  api.phase = 'ready'; api.appExiting = true; api.syncCatalogRefresh(); assert.equal(node('refresh-data').disabled, true);
  api.appExiting = false; api.syncCatalogRefresh(); assert.equal(node('refresh-data').disabled, false);

  const revision = 'b'.repeat(32), requestId = 'c'.repeat(32);
  for (const detail of [
    'The install queue is full (128 tasks). Wait for a task to finish.',
    'Check the install folder in Settings, then try again.',
  ]) {
    responses.push({status: 429, body: {code: 'queue_full', error: detail}});
    await assert.rejects(api.installerRequest('POST', '/v1/install', {songId: 17, requestId}, revision), error => {
      assert.equal(error.code, 'queue_full');
      assert.equal(error.httpStatus, 429);
      const visibleMessage = api.renderUI(api.errorText(error));
      assert.match(visibleMessage, /队列.*满/);
      assert.doesNotMatch(visibleMessage, /目录|设置/);
      assert.equal(api.settingsStale, false);
      return true;
    });
    assert.equal(timers.size, 0, 'Rejected installer requests must clear their timeout');
    const {url, options} = requests.at(-1);
    assert.equal(url, api.INSTALL_ORIGIN + '/v1/install');
    assert.equal(options.headers['X-SpinShare-Key'], api.INSTALL_KEY);
    assert.equal(options.headers['X-SpinShare-Settings'], revision);
  }
  checkExpandedActivityQueue();
  assert(requests.every(({url}) => new URL(url).origin === api.INSTALL_ORIGIN), 'No tested flow may fetch SpinShare directly');
  assert.equal(responses.length, 0);
  const applyChecks = await checkApplyFlows();
  console.log(`PASS: authenticated catalog requests, available cached search without a countdown, queue-full feedback, 128-job activity validation, and ${applyChecks} catalog apply scenarios.`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
