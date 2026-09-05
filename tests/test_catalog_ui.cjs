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
    if (!nodes.has(id)) {
      const classes = new Set();
      nodes.set(id, {
        disabled: false, hidden: false, value: '', textContent: '', attributes: new Map(), events: new Map(),
        setAttribute(name, value) { this.attributes.set(name, value); },
        removeAttribute(name) { this.attributes.delete(name); },
        addEventListener(name, callback) { this.events.set(name, callback); },
        focus() {}, classList: {
          toggle(name, force) { const active = force === undefined ? !classes.has(name) : Boolean(force); if (active) classes.add(name); else classes.delete(name); return active; },
          add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name),
        },
      });
    }
    return nodes.get(id);
  };
}
const node = createNodes();
const api = vm.createContext({
  __SPINSHARE_UI_CATALOG__: catalog, TextDecoder, AbortController,
  $: node, document: {activeElement: null, hidden: false, documentElement: {clientWidth: 1200, clientHeight: 800}, addEventListener() {}}, Date: {now: () => now},
  setTimeout: (callback, delay) => { const id = ++nextTimer; timers.set(id, {callback, delay}); return id; },
  clearTimeout: id => timers.delete(id),
  phase: 'idle', applied: null, appExiting: false, catalogNextAllowedAt: 0, catalogAutomaticNextAllowedAt: 0,
  catalogStartupBusy: false, catalogManualBusy: false, catalogAutomaticBusy: false, catalogAutomaticTimer: null,
  catalogStartupWork: null, catalogFailureHasData: false, catalogStatusPoll: null, catalogHelpTimer: null,
  catalogDialogCloseTimer: null, catalogToastTimer: null, catalogToastMotion: null, catalogToastStartedAt: 0,
  catalogToastRemaining: 0, catalogPendingToast: null, hostVisible: true,
  CHART_ENDPOINTS: {cache: '/v1/charts', manual: '/v1/charts/manual', automatic: '/v1/charts/automatic', status: '/v1/charts/status'},
  CATALOG_STALE_MS: 43200000, CATALOG_STATUS_POLL_MS: 500, CHART_ERROR_TEXT: {}, INSTALLER_ERROR_TEXT: {},
  INSTALL_ORIGIN: 'http://127.0.0.1:12345', INSTALL_KEY: 'a'.repeat(64), responseLimit: 32 * 1024 * 1024,
  settingsStale: false, searchFields: {title: 1, subtitle: 2, artist: 3, creator: 4},
  searchScopes: new Set(['title', 'subtitle', 'artist', 'creator']), textSearchWork: null, textSearchProblem: '',
  loadingIndicator() {}, setStatus() {}, filtersChanged: () => false, playMotion() { return null; }, motionAllowed() { return false; },
  number: value => String(value), disposePreview() {},
  MOTION_MS: {feedback: 150, standard: 180, panel: 220, expressive: 280},
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
  extract('function markAppExiting(', 'function cancelPreviewResolve('),
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
  assert.equal(node('refresh-data').attributes.has('title'), false, 'Refresh controls must not create native hover tooltips');
  assert.equal(timers.size, 0, 'A catalog deadline must not schedule a UI countdown');
}

function checkQueryStatusOwnership() {
  const queryNode = createNodes(), view = vm.createContext({__SPINSHARE_UI_CATALOG__: catalog, $: queryNode, phase: 'loading'});
  vm.runInContext([
    extract('const UI_CATALOG=', 'function setUILanguage('),
    extract('function loadingIndicator(', 'function updateTaskProgress('),
    extract('function setStatus(', 'const INSTALLER_MESSAGE_REPLACEMENTS='),
    "uiLanguage='en';",
  ].join('\n'), view);
  view.setStatus(view.m('Loading charts...'));
  assert.equal(queryNode('status').textContent, '', 'Loading must not duplicate the result-stage status above the results');
  assert.equal(queryNode('empty').textContent, 'Loading charts…');
  assert.equal(queryNode('empty').classList.contains('is-loading'), true, 'The result stage owns the sole loading animation');
  view.phase = 'error'; view.setStatus('Detailed failure', true);
  assert.equal(queryNode('status').textContent, ''); assert.equal(queryNode('empty').textContent, 'Detailed failure');
  assert.equal(queryNode('empty').classList.contains('is-loading'), false); assert.equal(queryNode('empty').classList.contains('error'), true);
  view.phase = 'ready'; view.setStatus('Saved copy notice');
  assert.equal(queryNode('status').textContent, 'Saved copy notice', 'A completed-query notice remains available outside the loading stage');
  assert.equal(queryNode('status').classList.contains('is-loading'), false);
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
    $: node, document: {activeElement: null, hidden: false, documentElement: {clientWidth: 1200, clientHeight: 800}, addEventListener() {}},
    INSTALL_ORIGIN: 'http://127.0.0.1:12345', INSTALL_KEY: 'a'.repeat(64),
    phase: 'idle', applied: null, appExiting: false, controller: null, catalog: null, catalogFetchedAt: null, catalogNextAllowedAt: 0,
    catalogAutomaticNextAllowedAt: 0, catalogStartupBusy: false, catalogManualBusy: false, catalogAutomaticBusy: false,
    catalogAutomaticTimer: null, catalogStartupWork: null, catalogFailureHasData: false, catalogStatusPoll: null,
    catalogHelpTimer: null, catalogDialogCloseTimer: null, catalogToastTimer: null, catalogToastMotion: null,
    catalogToastStartedAt: 0, catalogToastRemaining: 0, catalogPendingToast: null, hostVisible: true,
    CHART_ENDPOINTS: {cache: '/v1/charts', manual: '/v1/charts/manual', automatic: '/v1/charts/automatic', status: '/v1/charts/status'},
    CATALOG_STALE_MS: 43200000, CATALOG_STATUS_POLL_MS: 500, CHART_ERROR_TEXT: {}, INSTALLER_ERROR_TEXT: {},
    currentRows: [], filtered: [], lastAppliedCriteria: null, appliedText: '', page: 1, visibleCount: 20, scrollBatchSize: 20,
    textSearchWork: null, textSearchProblem: '', textFilterTimer: null,
    searchFields: {title: 1, subtitle: 2, artist: 3, creator: 4}, searchScopes: new Set(['title', 'subtitle', 'artist', 'creator']),
    reviewCounts: new Map(), reviewCache: new Map(), profileCache: new Map(), profileRequests: new Map(), userSearchCache: new Map(),
    installedCharts: new Map(), presenceQueue: new Map(), cacheGeneration: 0, presenceGeneration: 0,
    selectedTags: new Map(), tagCatalog: new Map(), tagResultCounts: new Map(), installationCandidates: [], pendingTagAnchor: null,
    readCriteria: () => ({...criteria, diffs: [...criteria.diffs]}), filtersChanged: () => false,
    loadingIndicator() {}, syncResultTools() {}, syncTagControls() {}, syncInstallationFilter() {},
    playMotion() { return null; }, motionAllowed() { return false; }, number: value => String(value),
    MOTION_MS: {feedback: 150, standard: 180, panel: 220, expressive: 280},
    installationFilterMode: () => 'all', captureTagViewport: () => ({viewport: true}), dismissChartTags() {}, flyTag() {}, pulseTag() {},
    setStatus(message = '', error = false) { statuses.push({message, error}); },
    render() {
      renders.push({phase: app.phase, rows: Array.from(app.filtered, row => row[0])}); app.syncFilters();
    },
    setTimeout(callback, delay) { const id = ++nextTimer; timers.set(id, {callback, delay, due: now + delay}); return id; },
    clearTimeout: id => timers.delete(id),
    fetch(url, options) {
      if (url === 'https://spinsha.re/api/searchUsers') {
        assert.equal(options.method, 'POST'); assert.equal(options.mode, 'cors'); assert.equal(options.credentials, 'omit');
      } else {
        assert.equal(url, app.INSTALL_ORIGIN + '/v1/charts', 'Catalog filtering may only read the authenticated local endpoint');
        assert.equal(options.method, 'GET'); assert.equal(options.mode, 'same-origin'); assert.equal(options.redirect, 'error');
        assert.equal(options.headers['X-SpinShare-Key'], app.INSTALL_KEY);
      }
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
    extract('function changeSearchScope(', 'function resetFilters('),
    extract('function countValue(', 'const defaultAvatarURL='),
    extract('const defaultAvatarURL=', 'function makeAvatar('),
    extract('async function readSharedUser(', 'async function readUserProfile('),
    extract('async function readUserSearch(', 'function prunePageDetails('),
    extract('function sortRows(', 'function changePage('),
    extract('function compact(', 'async function readReviews('),
    extract('async function apply(', "for(const field of Object.keys(searchFields))"),
    extract("$('search-retry').addEventListener(", "$('installation-filter').addEventListener("),
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
    const event = {target: element, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.propagationStopped = true; }, ...details};
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
      assert.equal(h.node('difficulty-fields').disabled, true); assert.equal(h.node('date-fields').disabled, true);
      assert.equal(h.node('reset-filters').disabled, true); assert.equal(h.node('apply-filters').classList.contains('is-loading'), false);
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
    h.advance(599999); assert.deepEqual(h.ids(), [3]);
    assert.strictEqual(h.app.catalog, saved); assert.equal(h.requests.length, 1);
    assertDerivedCaches(h, caches, false); assert.deepEqual(h.status(), {text: '', error: false}); assert.equal(h.timers.size, 0);
  });
  await check('filtering stays cache-only after the saved table becomes stale', async () => {
    const h = applyHarness(), saved = await restoreCatalog(h); const caches = seedDerivedCaches(h), fetchedAt = h.app.catalogFetchedAt;
    h.advance(12 * 60 * 60 * 1000); await h.trigger('apply-filters', 'click');
    assert.equal(h.requests.length, 1, 'Filter charts must not turn a stale cache read into a network update');
    assert.strictEqual(h.app.catalog, saved); assert.equal(h.app.catalogFetchedAt, fetchedAt); assertDerivedCaches(h, caches, false);
    assert.deepEqual(h.ids(), [2, 1]); assert.equal(h.app.phase, 'ready'); assert.equal(h.timers.size, 0);
  });
  await check('default search retains local matches when online uploader lookup fails and retries without a catalog update', async () => {
    const h = applyHarness();
    await restoreCatalog(h, [
      {...chart(1, 'Piano solo'), uploader: 11}, {...chart(2, 'Drum solo'), uploader: 22},
      {...chart(3, 'A third song'), charter: 'Piano charter', uploader: 33},
    ]);
    assert.deepEqual([...h.app.searchScopes], ['title', 'subtitle', 'artist', 'creator'], 'Exercise the shipped default field selection');
    h.app.syncSearchControls(); assert.equal(h.node('search-network-hint').hidden, false);
    h.node('local-search').value = 'piano';
    const search = h.trigger('chart-search-form', 'submit'), lookup = h.requests.at(-1);
    assert.equal(lookup.url, 'https://spinsha.re/api/searchUsers');
    assert.deepEqual(JSON.parse(lookup.options.body), {searchQuery: 'piano'});
    assert.deepEqual(h.ids(), [3, 1], 'Local title and charter matches appear before uploader lookup finishes');
    assert.equal(h.node('local-search').disabled, false);
    lookup.reject(new TypeError('Synthetic offline connection')); await search;
    assert.equal(h.app.phase, 'ready'); assert.deepEqual(h.ids(), [3, 1]);
    assert.equal(h.node('local-search').value, 'piano'); assert.equal(h.node('search-retry').hidden, false);
    assert.equal(h.node('search-message').textContent, catalog['zh-CN']['Uploader lookup failed. Showing local matches only.']);
    const retry = h.trigger('search-retry', 'click');
    h.respond({status: 200, data: [{id: 22, username: 'Piano uploader'}]}, h.requests.at(-1)); await retry;
    assert.deepEqual(h.ids(), [3, 2, 1]); assert.equal(h.node('search-feedback').hidden, true);
    assert.equal(h.requests.filter(request => request.url === h.app.INSTALL_ORIGIN + '/v1/charts').length, 1, 'Uploader lookup never updates catalog data');
    assert.equal(h.requests.length, 3);
    h.app.changeSearchScope('creator'); assert.equal(h.node('search-network-hint').hidden, true);
    assert.deepEqual(h.ids(), [1]); assert.equal(h.requests.length, 3, 'Title-only searches do not use the online account lookup');
    assert.equal(h.timers.size, 0);
  });
  await check('without any saved catalog, service failure and timeout stay errors', async () => {
    for (const failure of ['network', 'timeout']) {
      const h = applyHarness(), work = h.apply();
      if (failure === 'network') h.respond({code: 'charts_network_error', nextAllowedAt: h.now(), retryAfterSeconds: 0}, undefined, 502);
      else h.advance(h.timeout);
      await work;
      assert.equal(h.app.catalog, null); assert.equal(h.app.catalogFetchedAt, null); assert.equal(h.app.applied, null);
      assert.equal(h.app.phase, 'error'); assert.deepEqual(h.ids(), []); assert.equal(h.status().error, true);
      assert.match(h.status().text, failure === 'timeout' ? /timed out/ : /connect to the chart server/);
      assert.equal(h.app.controller, null); assert.equal(h.timers.size, 0);
    }
  });
  await check('explicit cancellation cannot republish a late response or its deadline and status', async () => {
    const h = applyHarness(), work = h.apply(), request = h.requests.at(-1); request.ignoreAbort = true;
    h.app.cancelQuery(); const deadline = h.app.catalogNextAllowedAt, status = h.status(), renders = h.renders.length;
    assert.equal(request.options.signal.aborted, true);
    h.respond({data: [chart(99)], cached: true, stale: false, fetchedAt: h.now(), nextAllowedAt: h.now() + 600000, changed: false}, request); await work;
    assert.equal(h.app.phase, 'idle'); assert.equal(h.app.controller, null); assert.equal(h.app.applied, null); assert.deepEqual(h.ids(), []);
    assert.equal(h.app.catalog, null); assert.equal(h.app.catalogFetchedAt, null); assert.equal(h.app.catalogNextAllowedAt, deadline);
    assert.equal(h.app.cacheGeneration, 0); assert.equal(h.app.presenceGeneration, 0); assert.equal(h.renders.length, renders); assert.deepEqual(h.status(), status);
    assert.equal(h.timers.size, 0);
  });
  await check('a superseded response cannot clear a newer controller or overwrite its finished results', async () => {
    for (const finishNewFirst of [false, true]) {
      const h = applyHarness(), oldWork = h.apply(), oldRequest = h.requests.at(-1); oldRequest.ignoreAbort = true; h.app.cancelQuery();
      const newWork = h.apply(), newRequest = h.requests.at(-1), active = h.app.controller;
      if (finishNewFirst) {
        h.respond({data: [chart(20)], cached: true, stale: false, changed: false, fetchedAt: h.now() + 2, nextAllowedAt: h.now() + 600000}, newRequest); await newWork;
      }
      const deadline = h.app.catalogNextAllowedAt, status = h.status(), renders = h.renders.length;
      h.respond({data: [chart(90)], cached: true, stale: false, changed: false, fetchedAt: h.now() + 1, nextAllowedAt: h.now() + 300000}, oldRequest); await oldWork;
      assert.equal(h.app.catalogNextAllowedAt, deadline); assert.equal(h.renders.length, renders); assert.deepEqual(h.status(), status);
      if (!finishNewFirst) {
        assert.strictEqual(h.app.controller, active); assert.equal(h.app.phase, 'loading'); assert.equal(newRequest.options.signal.aborted, false);
        assert.equal(h.timers.size, 1, 'The old finally block must not cancel the current timeout');
        h.respond({data: [chart(20)], cached: true, stale: false, changed: false, fetchedAt: h.now() + 2, nextAllowedAt: h.now() + 600000}, newRequest); await newWork;
      }
      assert.deepEqual(h.ids(), [20]); assert.equal(h.app.cacheGeneration, 0); assert.equal(h.app.presenceGeneration, 0);
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
  checkQueryStatusOwnership();
  assert.doesNotMatch(html, /id="cancel"/, 'The query UI must not expose a repeatedly triggerable cancel action');
  assert.match(html, /id="query-retry"[\s\S]*data-ui-static="Retry"/, 'A failed first load needs one explicit retry action in the result stage');
  assert.match(html, /\$\('query-retry'\)\.addEventListener\('click',\(\)=>apply\(\)\)/, 'Retry must re-enter the guarded catalog flow');
  api.syncFilters();
  assert.equal(node('refresh-data').disabled, false, 'Manual updates stay available before filters are applied');
  assert.equal(node('apply-filters').disabled, false, 'The first filter operation must still be available');
  assert.equal(node('local-search').disabled, true, 'Search still requires an applied filter');

  api.phase = 'ready';
  api.applied = {diffs: [4], min: 20, max: 30};
  node('local-search').value = 'Piano';
  checkCachedSearchAvailable();
  checkNoCountdown();

  responses.push({status: 429, body: {code: 'charts_cooldown', nextAllowedAt: now + 95000}});
  await assert.rejects(api.loadRemote(controller.signal), /manual update interval has not ended yet/);
  assert.equal(api.catalogNextAllowedAt, now + 95000);
  checkNoCountdown();
  checkCachedSearchAvailable();

  responses.push({status: 502, body: {code: 'charts_network_error', nextAllowedAt: now, retryAfterSeconds: 0}});
  await assert.rejects(api.loadRemote(controller.signal), /connect to the chart server/);
  assert.equal(api.catalogNextAllowedAt, now);
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
    api.phase = phase; api.syncCatalogRefresh(); assert.equal(node('refresh-data').disabled, false, 'Query state does not own catalog update availability');
  }
  api.phase = 'ready'; api.appExiting = true; api.syncCatalogRefresh(); assert.equal(node('refresh-data').disabled, true);
  api.appExiting = false; api.syncCatalogRefresh(); assert.equal(node('refresh-data').disabled, false);

  const revision = 'b'.repeat(32), requestId = 'c'.repeat(32);
  responses.push({status: 409, body: {code: 'installation_recovery_required', error: 'Internal recovery information'}});
  await assert.rejects(api.installerRequest('POST', '/v1/installations/index', {expectedRevision: revision}), error => {
    assert.equal(error.code, 'installation_recovery_required');
    assert.match(api.renderUI(api.errorText(error), 'zh-CN'), /恢复.*重试.*备份/);
    assert.match(api.renderUI(api.errorText(error), 'en'), /needs recovery.*retry.*Backups/);
    return true;
  });
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
