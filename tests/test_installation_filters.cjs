'use strict';
// Offline checks run the production sorting, filter, presence queue and render functions.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../web/app.js'), 'utf8');
const markup = fs.readFileSync(path.join(__dirname, '../web/index.html'), 'utf8');
const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, '../web/locales.json'), 'utf8'));
function extract(start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from);
  assert(from >= 0 && to > from, `Missing production code: ${start}`);
  return source.slice(from, to);
}
class Element {
  constructor(tag = 'div') {
    this.tagName = tag; this.children = []; this.attributes = new Map(); this.events = new Map();
    this.value = ''; this.hidden = false; this.disabled = false; this.textContent = '';
    const classes = new Set();
    this.classList = {toggle(name, on) { if (on) classes.add(name); else classes.delete(name); }, contains: name => classes.has(name)};
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name); }
  removeAttribute(name) { this.attributes.delete(name); }
  remove() { if (this.parentElement) { const siblings = this.parentElement.children; siblings.splice(siblings.indexOf(this), 1); this.parentElement = null; } }
  append(...children) { for (const child of children) this.insertBefore(child, null); }
  insertBefore(child, before) { child.remove(); child.parentElement = this; this.children.splice(before ? this.children.indexOf(before) : this.children.length, 0, child); }
  replaceChildren(...children) { for (const child of [...this.children]) child.remove(); this.append(...children); }
  addEventListener(type, callback) { this.events.set(type, [...this.events.get(type) || [], callback]); }
  emit(type) { for (const callback of this.events.get(type) || []) callback({target: this}); }
  matches() { return false; }
}
const criteria = {diffs: [4], min: 20, max: 30, dateFrom: '2024-02-01', dateTo: '2024-02-29'};
function song(id, changes = {}) {
  return {
    id, title: `Piano ${String(id).padStart(3, '0')}`, subtitle: '', artist: 'Artist', charter: 'Charter',
    uploadDate: {date: '2024-02-29'}, hasXDDifficulty: true, XDDifficulty: 25,
    fileReference: `spinshare_${id.toString(16)}`, updateHash: 'a'.repeat(32), tags: ['Rock', id % 2 ? 'Slow' : 'Fast'],
    ...changes,
  };
}
function harness(songs, installed = new Set()) {
  const nodes = new Map(), calls = [], deferred = [], reviewWatches = []; let service, rendered = 0, retired = 0;
  const node = id => { if (!nodes.has(id)) nodes.set(id, new Element()); return nodes.get(id); };
  node('installation-filter').value = 'all'; node('page-size').value = '10'; node('sort').value = 'date'; node('sort-direction').value = 'desc';
  const reply = (body, present = installed) => ({settingsRevision: body.expectedRevision, installations: Array.from(body.charts, chart => ({songId: chart.songId, installed: present.has(chart.songId)}))});
  service = (method, route, body) => { assert.equal(method, 'POST'); assert.equal(route, '/v1/installations/check'); return reply(body); };
  const api = vm.createContext({
    __SPINSHARE_UI_CATALOG__: catalog, URL, Date, AbortController, queueMicrotask, setTimeout, clearTimeout,
    $: node, document: {activeElement: null, hidden: false, createElement: tag => new Element(tag), querySelectorAll: () => []},
    number: String, labels: ['Easy', 'Normal', 'Hard', 'Expert', 'XD'], keys: [['hasEasyDifficulty', 'easyDifficulty'], ['hasNormalDifficulty', 'normalDifficulty'], ['hasHardDifficulty', 'hardDifficulty'], ['hasExtremeDifficulty', 'expertDifficulty'], ['hasXDDifficulty', 'XDDifficulty']],
    INSTALL_DIRECTORY: 'fixture-directory-a', DEFAULT_INSTALL_DIRECTORY: 'fixture-directory-a', settingsRevision: 'a'.repeat(32),
    settingsStale: false, settingsBusy: '', settingsLoaded: true, appExiting: false, activityJobs: [], installationActivityIds: new Map(),
    installationStates: new Map(), installationViews: new Map(), installedCharts: new Map(), presenceQueue: new Map(),
    presenceBusy: false, presenceGeneration: 0, installationCandidates: [], installationFilterPending: false, presenceRefreshQueued: false,
    currentRows: [], applied: criteria, lastAppliedCriteria: criteria, filtered: [], appliedText: '', phase: 'ready', page: 1, visibleCount: 20, scrollBatchSize: 20, controller: null,
    renderedCount: 0, pageDetails: null, pendingTagAnchor: null, cardViews: new Map(), tagResultCounts: new Map(), selectedTags: new Map(),
    searchFields: {title: 1, subtitle: 2, artist: 3, creator: 4}, searchScopes: new Set(['title']), userSearchCache: new Map(), profileCache: new Map(),
    textFilterTimer: null, textSearchWork: null, textSearchProblem: '', cacheGeneration: 0, reviewCounts: new Map(),
    installerRequest: async (method, route, body) => { calls.push({method, route, body}); return service(method, route, body); },
    fetch: () => assert.fail('Installation filtering must not use network fetch'),
    startTextSearch: text => { assert.equal(text, '', 'A presence refresh must not start uploader lookup'); },
    stopTextSearch() {}, scopeSearchUsers() {}, needsUserSearch: () => false,
    loadingIndicator() {}, updateTaskProgress() {}, refreshSettingsControls() {}, syncCloseOptions() {}, renderActivity() {}, refreshActivity() {},
    syncCatalogRefresh() {}, filtersChanged: () => false, syncResultTools() {}, syncTagControls() {}, syncSearchControls() {}, setStatus() {}, applyDatePreset() {},
    prepareTagAnchor() {}, dismissChartTags() {}, dismissChartDescription() {}, scheduleChartDescriptions() {}, stopPageDetails() {}, prunePageDetails() {}, queueEntry() {}, pruneEntries() {},
    renderPageLinks() {}, syncReviewVisibility() {}, watchMore() {}, syncCovers() {}, restoreTagAnchor() {},
    watchPageReviews: cells => reviewWatches.push(Array.from(cells, cell => cell.row[0])),
    readReviews: () => assert.fail('Sorting must not read reviews outside the rendered-page queue'),
    scheduleInstallationPoll() {}, installationRequestId: () => 'd'.repeat(32), localizeInstallerMessage: String,
    retireReviewCell: cell => { cell.retired = true; retired++; }, icon: () => new Element('svg'),
  });
  vm.runInContext([
    extract('const UI_CATALOG=', 'function setUILanguage('),
    extract('function titleKey(', 'function remember('),
    extract('function validDate(', 'function siteToday('),
    extract('function tagKey(', 'function indexCatalogTags('),
    extract('function element(', 'function icon('),
    extract('function countValue(', 'const defaultAvatarURL='),
    extract('function updateAllInstallationViews(', 'function readSettings('),
    extract('function applySettings(', 'async function loadSettings('),
    extract('function installerJob(', 'async function installerRequest('),
    extract('function installationPending(', 'function scheduleInstallationPoll('),
    extract('function receiveInstallationJob(', 'async function pollInstallation('),
    extract('async function startInstallation(', 'function applyActivity('),
    extract('function applyActivity(', 'function showActivity('),
    extract('function installationControl(', 'function renderPageLinks('),
    extract('function sortRows(', 'async function rebuild('),
    extract('async function rebuild(', 'function changePage('),
    extract('function render(append=', 'function setBusy('),
    extract('function compact(', 'function syncCatalogRefresh('),
    extract('function syncFilters(', 'function cancelQuery('),
    extract('function cancelQuery(', 'function validDate('),
    extract('function resetFilters(', 'function element('),
    extract("$('installation-filter').addEventListener(", "$('reset-filters').addEventListener("),
    "uiLanguage='en';",
  ].join('\n'), api);
  api.createChartCard = row => {
    const card = new Element(), cell = {row, retired: false};
    api.installationControl(row, new Element(), card); return {row, card, cell};
  };
  const render = api.render; api.render = (...args) => { rendered++; return render(...args); };
  api.currentRows = api.compact(songs, criteria);
  return {
    api, node, calls, reply, deferred, reviewWatches, ids: () => Array.from(api.filtered, row => row[0]),
    get rendered() { return rendered; }, get retired() { return retired; },
    service: handler => { service = handler; },
    hold: () => { service = (method, route, body) => { assert.equal(route, '/v1/installations/check'); return new Promise(resolve => deferred.push({body, resolve})); }; },
    mode(value) { node('installation-filter').value = value; node('installation-filter').emit('change'); },
  };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
async function idle(h) { for (let i = 0; i < 5 && (h.api.presenceBusy || h.api.presenceRefreshQueued); i++) await tick(); await tick(); assert.equal(h.api.presenceBusy, false, 'Presence work must finish without a render/check loop'); }
function resolveNext(h, installed) { assert(h.deferred.length, 'Expected a deferred local presence request'); const next = h.deferred.shift(); next.resolve(h.reply(next.body, installed)); return next.body; }

async function fullCandidateFilter() {
  const h = harness(Array.from({length: 65}, (_, i) => song(i + 1)), new Set(Array.from({length: 32}, (_, i) => (i + 1) * 2)));
  h.api.phase = 'idle'; h.api.applied = null; h.api.syncFilters();
  assert.equal(h.node('installation-filter').disabled, true); assert.equal(h.api.installationFilterMode(), 'all');
  h.mode('installed'); assert.equal(h.calls.length, 0, 'The filter is inactive until base criteria are applied');
  h.node('installation-filter').value = 'all'; h.api.phase = 'ready'; h.api.applied = criteria;
  await h.api.rebuild(false); await idle(h);
  assert.equal(h.ids().length, 65, 'Default all includes unchecked and uninstalled charts');
  assert.equal(h.calls.flatMap(call => Array.from(call.body.charts)).length, 10, 'Default all only checks visible cards');
  h.mode('installed'); await idle(h);
  assert.equal(h.node('installation-filter').disabled, false);
  assert.deepEqual(h.ids(), Array.from({length: 32}, (_, i) => 64 - i * 2));
  assert.equal(h.node('count').textContent, '32 charts'); assert.equal(h.api.pages(), 4);
  assert.equal(h.api.tagResultCounts.get('fast'), 32); assert.equal(h.api.tagResultCounts.has('slow'), false);
  const checked = h.calls.flatMap(call => Array.from(call.body.charts, chart => chart.songId));
  assert.equal(checked.length, 65); assert.equal(new Set(checked).size, 65, 'Every candidate, including off-page charts, is checked once');
  for (const call of h.calls) { assert.equal(call.route, '/v1/installations/check'); assert(call.body.charts.length <= 30); }
  const requests = h.calls.length;
  await h.api.rebuild(false); h.api.render(); await idle(h);
  assert.equal(h.calls.length, requests, 'Stable renders reuse validated statuses');
  h.node('sort').value = 'title'; h.node('sort-direction').value = 'asc'; await h.api.rebuild(false);
  assert.equal(h.ids()[0], 2); assert.equal(h.calls.length, requests, 'Existing sort values compose without more presence requests');
  h.api.appExiting = true; h.api.syncFilters(); assert.equal(h.node('installation-filter').disabled, true);
  h.api.appExiting = false; h.api.resetFilters(); h.api.refreshInstallationChecks(); await idle(h);
  assert.equal(h.node('installation-filter').value, 'installed'); assert.equal(h.node('installation-filter').disabled, true);
  assert.equal(h.calls.length, requests, 'Focus after resetting base filters must not check the previous candidate set');
}

async function combinedFilters() {
  const h = harness([
    song(1, {tags: ['Rock', 'Fast']}), song(2), song(3, {tags: ['Fast']}),
    song(4, {title: 'Other song'}), song(5, {uploadDate: {date: '2024-03-01'}}),
    song(6, {XDDifficulty: 10}), song(7, {tags: ['ROCK', 'FAST']}),
  ], new Set([1, 3, 4, 5, 6, 7]));
  h.node('local-search').value = 'piano'; h.api.selectedTags.set('rock', 'Rock'); h.api.selectedTags.set('fast', 'Fast');
  h.mode('installed'); await idle(h);
  assert.deepEqual(h.ids(), [7, 1]); assert.equal(h.api.tagResultCounts.get('rock'), 2);
  assert.deepEqual(h.calls.flatMap(call => Array.from(call.body.charts, chart => chart.songId)).sort((a, b) => a - b), [1, 2, 7]);
  h.node('sort').value = 'title'; h.node('sort-direction').value = 'asc'; await h.api.rebuild(false);
  assert.deepEqual(h.ids(), [1, 7]); assert.equal(h.node('installation-filter').value, 'installed');
  h.api.selectedTags.delete('fast'); h.node('local-search').value = 'other'; await h.api.rebuild(false); await idle(h);
  assert.deepEqual(h.ids(), [4]); assert.equal(h.node('installation-filter').value, 'installed');
  h.node('installation-filter').value = 'uninstalled'; h.node('local-search').value = ''; await h.api.rebuild(false); await idle(h);
  assert.deepEqual(h.ids(), [2]); assert.equal(h.api.tagResultCounts.get('fast'), 1);
}

async function unknownIsNotUninstalled() {
  const h = harness([song(1), song(2), song(3, {dlc: true}), song(4, {updateHash: ''})]);
  h.service(() => { throw new Error('Fixture check failure'); }); h.mode('uninstalled'); await idle(h);
  assert.deepEqual(h.ids(), []); assert.equal(h.node('installation-filter-message').textContent, 'Installation status unknown: 4 charts excluded.');
  assert.equal(h.node('installation-filter-retry').hidden, false);
  const calls = h.calls.length; await h.api.rebuild(false); h.api.render(); await idle(h);
  assert.equal(h.calls.length, calls, 'Failed checks are not automatically retried on every render');
  h.service((method, route, body) => h.reply(body, new Set([1])));
  h.node('installation-filter-retry').emit('click'); await idle(h);
  assert.deepEqual(h.ids(), [2]); assert.equal(h.node('installation-filter-message').textContent, 'Installation status unknown: 2 charts excluded.');
  assert.equal(h.node('installation-filter-retry').hidden, true, 'Unsupported metadata is not endlessly retried');
  assert.deepEqual(h.calls.at(-1).body.charts.map(chart => chart.songId).join(','), '1,2');
  h.mode('all'); await idle(h); assert.equal(h.ids().length, 4, 'All remains available for charts whose presence cannot be verified');
  assert.equal(h.api.installationViews.get(4).presence.textContent, 'Installation status unknown');
  for (const installations of [[{songId: 1, installed: false}], [{songId: 1, installed: false}, {songId: 1, installed: false}], [{songId: 1, installed: false}, {songId: 2, installed: 'false'}]]) {
    const invalid = harness([song(1), song(2)]);
    invalid.service((method, route, body) => ({settingsRevision: body.expectedRevision, installations}));
    invalid.mode('uninstalled'); await idle(invalid); assert.deepEqual(invalid.ids(), [], 'A partial or malformed response cannot classify charts as uninstalled');
  }
}

async function directoryAndMetadataRace() {
  const h = harness(Array.from({length: 41}, (_, i) => song(i + 1))); h.hold(); h.mode('installed');
  assert.equal(h.deferred.length, 1);
  h.api.applySettings({revision: 'b'.repeat(32), targetDirectory: 'fixture-directory-b', defaultDirectory: 'fixture-directory-a', closeBehavior: 'ask', exiting: false});
  await tick(); assert.deepEqual(h.ids(), []);
  const old = resolveNext(h, new Set(Array.from({length: 41}, (_, i) => i + 1))); await tick();
  assert.equal(old.expectedRevision, 'a'.repeat(32)); assert.deepEqual(h.ids(), [], 'A previous-directory response must not enter the result set');
  while (h.deferred.length) { const body = resolveNext(h, new Set([2, 40])); assert.equal(body.expectedRevision, 'b'.repeat(32)); await tick(); }
  await idle(h); assert.deepEqual(h.ids(), [40, 2]); assert.equal(h.api.tagResultCounts.get('fast'), 2);
  const updated = h.api.compact([song(2, {updateHash: 'b'.repeat(32)})], criteria)[0];
  h.api.currentRows = [updated]; h.mode('uninstalled'); await tick();
  assert.equal(h.deferred.length, 1, 'Changed chart fingerprints require a fresh local check');
  assert.equal(h.deferred[0].body.charts[0].updateHash, 'b'.repeat(32));
  resolveNext(h, new Set()); await idle(h); assert.deepEqual(h.ids(), [2]);
}

async function changingCandidatesDuringCheck() {
  const h = harness(Array.from({length: 65}, (_, i) => song(i + 1))); h.hold(); h.mode('installed');
  h.node('local-search').value = 'Piano 065'; h.api.selectedTags.set('slow', 'Slow'); h.mode('uninstalled');
  assert.deepEqual(h.ids(), []); resolveNext(h, new Set(Array.from({length: 30}, (_, i) => i + 1))); await tick();
  assert.deepEqual(h.ids(), [], 'The old broader result must not return when its request completes');
  assert.equal(h.deferred.length, 1); assert.deepEqual(Array.from(h.deferred[0].body.charts, chart => chart.songId), [65]);
  let textSearchFired = false;
  h.api.textFilterTimer = setTimeout(() => { textSearchFired = true; }, 15);
  resolveNext(h, new Set()); await idle(h); await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(h.ids(), [65]); assert.equal(h.node('count').textContent, '1 charts');
  assert.equal(h.api.tagResultCounts.get('slow'), 1); assert.equal(h.api.tagResultCounts.has('fast'), false);
  assert.equal(h.calls.length, 2, 'Obsolete queued candidates do not delay the new filter');
  assert.equal(textSearchFired, true, 'Finishing a local presence check must not cancel a pending text-search debounce');
  h.mode('all'); await idle(h); assert.deepEqual(h.ids(), [65]);
}

async function backgroundChecksPreserveCards() {
  const present = new Set(Array.from({length: 41}, (_, i) => i + 1));
  const h = harness(Array.from(present, id => song(id)), present); h.mode('installed'); await idle(h);
  h.api.page = 3; h.api.render(); const before = [...h.node('rows').children], views = [...h.api.cardViews.values()], renders = h.rendered, retired = h.retired;
  views[0].cell.reviewTemporaryOpen = true; h.hold(); h.api.refreshInstallationChecks(); await tick();
  assert.deepEqual(h.node('rows').children, before); assert.equal(h.rendered, renders); assert.equal(h.api.page, 3);
  assert.equal(h.node('installation-filter-feedback').hidden, false);
  resolveNext(h, present); await tick();
  assert.deepEqual(h.node('rows').children, before, 'An intermediate batch must not clear stable result cards');
  assert.equal(h.rendered, renders); assert.equal(h.api.page, 3);
  resolveNext(h, present); await idle(h);
  assert.deepEqual(h.node('rows').children, before); assert.equal(h.retired, retired); assert.equal(h.api.page, 3);
  assert.equal(views[0].cell.reviewTemporaryOpen, true, 'A same-directory focus check preserves the temporary review drawer');
  assert.equal(h.rendered, renders + 1, 'Refresh results once, after the complete candidate set is checked');
  assert.equal(h.node('installation-filter-feedback').hidden, true);
  h.api.page = 5; h.api.render(); h.api.refreshInstallationChecks();
  while (h.deferred.length) { resolveNext(h, new Set([2, 4])); await tick(); }
  await idle(h); assert.equal(h.api.page, 1); assert.equal(h.api.pages(), 1); assert.equal(h.node('count').textContent, '2 charts');
  assert.equal(h.api.tagResultCounts.get('fast'), 2, 'Background changes update tag candidates and clamp pagination');
}

async function installationCompletionRace() {
  const h = harness([song(1), song(2), song(3)]); h.mode('uninstalled'); await idle(h);
  h.hold(); h.api.queueInstallationChecks([h.api.currentRows[0]], true); const old = h.deferred.shift(); assert(old);
  h.service((method, route, body) => {
    if (route === '/v1/install') return {job: {id: 'c'.repeat(32), songId: body.songId, state: 'complete', zipRemoved: true, targetDirectory: h.api.INSTALL_DIRECTORY}};
    assert.equal(route, '/v1/installations/check'); return h.reply(body, new Set([1]));
  });
  await h.api.startInstallation(h.api.currentRows[0]); await tick();
  assert.deepEqual(h.ids(), [3, 2], 'An unconfirmed/completing installation is not kept as uninstalled');
  old.resolve(h.reply(old.body, new Set())); await idle(h);
  assert.equal(h.api.installationPresence(h.api.currentRows[0]), true, 'The pre-install check cannot overwrite the post-install result');
  assert.deepEqual(h.ids(), [3, 2]); assert.equal(h.api.tagResultCounts.get('slow'), 1);
  const afterStart = h.calls.slice(1).flatMap(call => call.route === '/v1/installations/check' ? Array.from(call.body.charts, chart => chart.songId) : []);
  assert.deepEqual(afterStart, [1, 1], 'Only the installed row is rechecked; unrelated valid records remain cached');
  h.mode('installed'); await idle(h); assert.deepEqual(h.ids(), [1]);
}

async function activityCompletionAndStaleSettings() {
  const h = harness([song(1), song(2)]); h.mode('uninstalled'); await idle(h);
  const job = {id: 'c'.repeat(32), songId: 1, state: 'downloading', downloadedBytes: 1, totalBytes: 2, fileCount: 0, filesWritten: 0};
  h.api.applyActivity({exiting: false, activeCount: 1, jobs: [job]}); await idle(h);
  assert.deepEqual(h.ids(), [2], 'An active job from another local page is unknown, not uninstalled');
  h.service((method, route, body) => h.reply(body, new Set([1])));
  h.api.applyActivity({exiting: false, activeCount: 0, jobs: []}); await idle(h);
  h.mode('installed'); await idle(h); assert.deepEqual(h.ids(), [1]);
  h.api.settingsStale = true; h.api.updateAllInstallationViews(); await idle(h);
  assert.deepEqual(h.ids(), []); assert.equal(h.node('installation-filter-retry').hidden, true);
  assert.equal(h.node('installation-filter-message').textContent, 'Open Settings to confirm the changed install directory.');
  const before = h.calls.length; h.api.refreshInstallationChecks(); assert.equal(h.calls.length, before);
  h.api.applySettings({revision: 'a'.repeat(32), targetDirectory: 'fixture-directory-a', defaultDirectory: 'fixture-directory-a', closeBehavior: 'ask', exiting: false});
  await idle(h); assert.deepEqual(h.ids(), [1], 'Confirming even the same directory revision revalidates stale status');
}

async function sortOptionsAndFallbacks() {
  const h = harness([
    song(7, {title: 'Bravo', uploadDate: {date: '2024-02-03'}, XDDifficulty: 28, views: 1, downloads: 2}),
    song(2, {title: 'Charlie', uploadDate: {date: '2024-02-01'}, XDDifficulty: 24, views: 5, downloads: 7}),
    song(9, {title: 'Alpha', uploadDate: {date: '2024-02-02'}, XDDifficulty: 21, views: 9, downloads: 4}),
  ]);
  const ascending = {date: [2, 9, 7], views: [7, 2, 9], downloads: [7, 9, 2], level: [9, 2, 7], title: [9, 7, 2]};
  for (const [mode, expected] of Object.entries(ascending)) {
    for (const direction of ['asc', 'desc']) {
      h.node('sort').value = mode; h.node('sort-direction').value = direction;
      await h.api.rebuild(false); await idle(h);
      assert.deepEqual(h.ids(), direction === 'asc' ? expected : [...expected].reverse(), `${mode} ${direction}`);
      assert.equal(h.node('sort').value, mode);
    }
  }
  for (const invalid of ['comments', '', 'unknown', '__proto__', 'toString', null, undefined]) {
    for (const direction of ['asc', 'desc']) {
      h.node('sort').value = invalid; h.node('sort-direction').value = direction;
      await h.api.rebuild(false); await idle(h);
      assert.equal(h.node('sort').value, 'date', 'Invalid or restored legacy values must visibly fall back to upload date');
      assert.deepEqual(h.ids(), direction === 'asc' ? ascending.date : [...ascending.date].reverse());
      assert.equal(h.node('sort-direction').value, direction, 'Fallback must preserve the selected direction');
    }
  }
  const missing = harness([song(1, {views: 0}), song(3), song(2, {views: 0}), song(8)]);
  for (const direction of ['asc', 'desc']) {
    missing.node('sort').value = 'views'; missing.node('sort-direction').value = direction;
    await missing.api.rebuild(false); await idle(missing);
    assert.deepEqual(missing.ids(), [2, 1, 8, 3], 'Missing metrics stay last and equal values keep the stable ID tie-break');
  }
}

async function sortingOnlyLoadsRenderedCounts() {
  const h = harness(Array.from({length: 601}, (_, i) => song(i + 1, {views: i, downloads: 601 - i})));
  let queuedCount = 0;
  for (const mode of ['comments', 'date', 'views', 'downloads', 'level', 'title']) {
    h.reviewWatches.length = 0; h.node('sort').value = mode;
    await h.api.rebuild(false); await idle(h);
    const shown = Array.from(h.node('rows').children), visibleIds = new Set(h.api.cardViews.keys());
    assert.equal(h.ids().length, 601, 'Results must not wait for whole-candidate review counts or ranking confirmation');
    assert.equal(shown.length, 10); assert.equal(h.node('next').disabled, false);
    assert.equal(h.api.reviewCounts.size, 0, 'This fixture deliberately leaves every count unknown');
    assert(h.reviewWatches.flat().length <= 10, 'Sorting may enqueue only newly rendered cards');
    queuedCount += h.reviewWatches.flat().length;
    for (const id of h.reviewWatches.flat()) assert(visibleIds.has(id), 'Off-page charts must not be queued for review counting');
  }
  assert(queuedCount > 0, 'Ordinary per-page review counting must remain connected');
}

async function paginationOnlyAppearsWhenUseful() {
  const single = harness(Array.from({length: 8}, (_, i) => song(i + 1)));
  await single.api.rebuild(false); await idle(single);
  assert.equal(single.node('pager').hidden, true, 'A single result page must not show the top pager');
  assert.equal(single.node('pager-bottom').hidden, true, 'A single result page must not show the bottom pager');

  const multiple = harness(Array.from({length: 25}, (_, i) => song(i + 1)));
  await multiple.api.rebuild(false); await idle(multiple);
  assert.equal(multiple.node('pager').hidden, false, 'Multiple pages show the top pager');
  assert.equal(multiple.node('pager-bottom').hidden, false, 'Multiple pages show the bottom pager');
  multiple.node('page-size').value = 'all'; multiple.api.render();
  assert.equal(multiple.node('pager').hidden, false, 'Unlimited mode keeps one display-size control so the user can leave it');
  assert.equal(multiple.node('pager').classList.contains('is-display-only'), true);
  assert.equal(multiple.node('pager-bottom').hidden, true, 'Unlimited mode does not render a redundant bottom pager');
  assert.equal(multiple.node('page-controls').hidden, true);
  assert.equal(multiple.node('page-jump').hidden, true);
}

async function main() {
  assert.match(markup, /<select id="installation-filter"[^>]*disabled>/);
  assert.match(markup, /<option value="all" data-ui-static="All installation states">All<\/option>/);
  assert.equal(catalog.en['All installation states'], 'All');
  assert.equal(catalog['zh-CN']['All installation states'], '全部');
  const sortMarkup = markup.match(/<select id="sort">([\s\S]*?)<\/select>/);
  assert(sortMarkup, 'The result sort control remains available');
  assert.deepEqual(Array.from(sortMarkup[1].matchAll(/<option value="([^"]+)"/g), match => match[1]), ['date', 'views', 'downloads', 'level', 'title']);
  assert.doesNotMatch(markup, /id="(?:ranking-panel|ranking-status|cancel-ranking)"/);
  assert.doesNotMatch(markup, /id="results-note"/, 'The repeated installation explanation is not part of the result layout');
  await fullCandidateFilter(); await combinedFilters(); await unknownIsNotUninstalled();
  await directoryAndMetadataRace(); await changingCandidatesDuringCheck(); await backgroundChecksPreserveCards(); await installationCompletionRace();
  await activityCompletionAndStaleSettings();
  await sortOptionsAndFallbacks(); await sortingOnlyLoadsRenderedCounts(); await paginationOnlyAppearsWhenUseful();
  console.log('PASS: 11 scenarios covering installation filters, full-candidate presence checks, unknown/retry states, combined criteria, directory/install races, useful pagination, five sort modes, legacy fallback and rendered-page review counting.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
