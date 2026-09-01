'use strict';

// Run with: node tests/test_tag_filters.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = require('./read_web_template.cjs').readWebTemplate();
function extract(start, end) {
  const from = html.indexOf(start), to = html.indexOf(end, from);
  assert(from >= 0 && to > from, `Missing production code: ${start}`);
  return html.slice(from, to);
}

const tags = vm.createContext({selectedTags: new Map(), tagCatalog: new Map()});
vm.runInContext(extract('// Tag matching uses only', 'function tagFilterReady('), tags);
const selected = (...names) => new Map(names.map(name => [tags.tagKey(name), name]));
const ids = rows => Array.from(rows, row => row[0]);
const chart = (id, level, metadata) => Object.freeze([
  id, `Chart ${id}`, '', '', '', '2026-08-30', [[4, level]], '', Object.freeze(metadata),
]);
const rows = Object.freeze([
  chart(1, 23, {tags: Object.freeze(['EDM', 'Piano', 'Future core', 'edm'])}),
  chart(2, 21, {tags: Object.freeze(['EDM', 'Electronic'])}),
  chart(3, 10, {tags: Object.freeze(['edm', 'PIANO'])}),
  chart(4, 25, {tags: Object.freeze(['Rock', 'Piano'])}),
  chart(5, 20, {tags: Object.freeze([])}),
  chart(6, 20, {}),
  chart(7, 22, {tags: null}),
]);

assert.equal(tags.tagKey(' FUture Core '), 'future core');
assert.deepEqual(Array.from(tags.cleanTags([' EDM ', 'edm', 'Future core', 'future CORE', ' ', null, 7, 'Piano'])),
  ['EDM', 'Future core', 'Piano']);
for (const missing of [undefined, null, '', 'EDM', {}]) assert.deepEqual(Array.from(tags.cleanTags(missing)), []);

tags.indexCatalogTags([{tags: [' EDM ', 'Future core']}, {tags: ['edm', 'PIANO']}, {}, null, {tags: null}]);
assert.deepEqual(Array.from(tags.tagCatalog), [['edm', 'EDM'], ['future core', 'Future core'], ['piano', 'PIANO']]);
tags.indexCatalogTags([{tags: ['Rock']}]);
assert.deepEqual(Array.from(tags.tagCatalog), [['rock', 'Rock']], 'A new catalog must replace old candidates');

const original = JSON.stringify(rows);
assert.strictEqual(tags.rowsMatchingTags(rows, selected()), rows);
assert.deepEqual(ids(tags.rowsMatchingTags(rows, selected(' EDM ', 'piano'))), [1, 3], 'Multiple tags use AND');
assert.deepEqual(ids(tags.rowsMatchingTags(rows, selected('FUTURE CORE'))), [1], 'Spaces stay inside a tag');
assert.deepEqual(ids(tags.rowsMatchingTags(rows, selected('missing'))), []);
assert.equal(tags.countTagResults(rows).get('edm'), 3, 'One chart only contributes once per tag');

// Model an already-applied difficulty filter; tag candidates must not restore excluded rows.
const base = rows.filter(row => row[6][0][1] >= 20);
tags.selectedTags.set('edm', 'EDM');
const edmRows = tags.rowsMatchingTags(base), edmCounts = tags.countTagResults(edmRows);
assert.deepEqual(ids(edmRows), [1, 2]);
assert.equal(edmCounts.get('piano'), 1);
assert.equal(edmCounts.get('electronic'), 1);
assert.equal(edmCounts.get('rock') || 0, 0);
assert.equal(edmCounts.get('future core'), ids(tags.rowsMatchingTags(base, selected('EDM', 'Future core'))).length);

tags.selectedTags.set('piano', 'Piano');
const narrowed = tags.rowsMatchingTags(base), narrowedCounts = tags.countTagResults(narrowed);
assert.deepEqual(ids(narrowed), [1]);
assert.equal(narrowedCounts.get('electronic') || 0, 0);
assert.equal(edmCounts.get('electronic'), 1, 'Computing new candidates must not mutate old counts');
tags.selectedTags.delete('edm');
assert.deepEqual(ids(tags.rowsMatchingTags(base)), [1, 4]);
assert.equal(tags.countTagResults(tags.rowsMatchingTags(base)).get('rock'), 1);
assert.equal(tags.countTagResults(tags.rowsMatchingTags(base, selected('EDM', 'Rock'))).size, 0);
assert.equal(JSON.stringify(rows), original, 'Filtering and counting must not modify source rows');
assert.deepEqual(Array.from(tags.selectedTags), [['piano', 'Piano']], 'Filtering must not modify the selected tags');

function checkTagScrollRestoration() {
  const elements = new Map(), frames = new Map(), classes = new Set();
  let frameId = 0, api, continuous = false, maxScroll = 5000, cardTop = 100, cardReads = 0, flights = 0;
  function element(tag, text, className) {
    return {
      tag, text, className, children: [], dataset: {}, listeners: new Map(), hidden: false, inert: false, isConnected: true,
      append(...nodes) { this.children.push(...nodes); },
      addEventListener(type, listener) { this.listeners.set(type, listener); },
      contains(target) { return this === target || this.children.some(child => child.contains(target)); },
      matches() { return Boolean(this.open); },
      querySelector() { return this.children.find(child => child.tag === 'button'); },
      focus(options) { assert.equal(options?.preventScroll, true, 'Focus restoration must never scroll'); api.document.activeElement = this; },
    };
  }
  function node(id) {
    if (!elements.has(id)) elements.set(id, element('div'));
    return elements.get(id);
  }
  function refreshChips() {
    api.document.activeElement = api.document.body;
    for (const id of ['selected-tags', 'selected-tag-popover-content']) {
      node(id).children = [...api.selectedTags].map(([key, name]) => api.tagChip(key, name));
    }
    node('selected-tag-popover').children = [node('selected-tag-popover-content')];
    node('tag-filter-strip').hidden = !api.selectedTags.size;
    if (!api.selectedTags.size) node('selected-tag-popover').open = false;
  }
  api = vm.createContext({
    $: node, element, uiAttr() {}, m: text => text, tagKey: tags.tagKey, tagFilterReady: () => true,
    document: {body: element('body'), documentElement: {classList: {add: key => classes.add(key), remove: key => classes.delete(key)}}},
    selectedTags: new Map(), tagCatalog: new Map([['edm', 'EDM'], ['piano', 'Piano']]), cardViews: new Map(),
    pendingTagAnchor: null, tagViewportFrame: null, scrollX: 0, scrollY: 1966, page: 2, visibleCount: 80,
    filtered: Array.from({length: 80}, (_, index) => [1000 + index]), scrollBatchSize: 20, pageSize: () => 10,
    innerHeight: 900, dismissChartTags() {}, pulseTag() {}, flyTag: () => { flights++; },
    addEventListener() {},
    requestAnimationFrame: callback => { frames.set(++frameId, callback); return frameId; },
    cancelAnimationFrame: id => frames.delete(id),
    scrollTo: ({left, top, behavior}) => { assert.equal(behavior, 'instant'); api.scrollX = left; api.scrollY = Math.max(0, Math.min(top, maxScroll)); },
    scrollBy: ({top}) => { api.scrollY += top; },
    rebuild() {
      const viewport = api.pendingTagAnchor?.viewport;
      api.page = 1; api.visibleCount = 20; // rebuild resets pagination before render prepares the current position.
      api.prepareTagAnchor(true, continuous);
      assert.equal(classes.has('tag-viewport-update'), Boolean(viewport));
      refreshChips();
      cardTop = 600;
      api.scrollY = Math.min(api.scrollY + 500, maxScroll); // Simulate layout/anchoring moving the document.
      api.restoreTagAnchor();
    },
  });
  vm.runInContext([
    extract('function tagChip(', 'function updateTagOverflow('),
    extract('function captureTagAnchor(', 'function tagFlightTarget('),
    extract('function addTagFilter(', 'function stopTextSearch('),
  ].join('\n'), api);
  api.setupTagFilters();
  api.cardViews.set(1025, {row: [1025], card: {getBoundingClientRect: () => { cardReads++; return {top: cardTop, bottom: cardTop + 200}; }}});
  function flushFrames() {
    for (const [id, callback] of [...frames]) { frames.delete(id); callback(); }
    assert.equal(classes.has('tag-viewport-update'), false, 'Native scroll anchoring must resume after the update');
  }
  for (const [source, names, shorter] of [
    ['selected-tags', ['edm', 'piano'], false],
    ['selected-tag-popover-content', ['edm', 'piano'], false],
    ['selected-tag-popover-content', ['edm'], false],
    ['tag-clear', ['edm', 'piano'], false],
    ['tag-clear', ['edm'], true],
  ]) {
    api.selectedTags = new Map(names.map(key => [key, key]));
    api.page = 2; api.visibleCount = 80; api.scrollY = 1966; maxScroll = shorter ? 1200 : 5000;
    api.pendingTagAnchor = {id: 1025, top: 100}; // Removing must replace any pending add-source anchor.
    refreshChips();
    node('selected-tag-popover').open = source === 'selected-tag-popover-content';
    const button = source === 'tag-clear' ? node(source) : node(source).children[0].querySelector('button');
    api.document.activeElement = button;
    button.listeners.get('click')();
    assert.equal(api.page, 2, 'Removing a tag must not switch to the original chart\'s new page');
    assert.equal(api.visibleCount, 80, 'Keep already-expanded batches instead of shrinking to the first batch');
    assert.equal(api.scrollY, Math.min(1966, maxScroll));
    assert.equal(api.pendingTagAnchor, null);
    api.scrollY = 37; // A late native focus/anchor adjustment must not win over the captured viewport.
    flushFrames();
    assert.equal(api.scrollY, Math.min(1966, maxScroll));
  }
  assert.equal(cardReads, 0, 'Removal and clear must never read or follow a chart position');
  assert.equal(flights, 0);

  // Keep the existing card-source behavior for adding, including its flight animation.
  maxScroll = 5000; api.selectedTags.clear(); api.page = 2; api.scrollY = 1000; cardTop = 100;
  api.addTagFilter('EDM', {dataset: {chartId: '1025'}, getBoundingClientRect: () => ({top: 100})});
  assert.equal(api.page, 3, 'Adding from a chart still keeps that chart visible');
  assert.equal(cardReads, 2);
  assert.equal(flights, 1);
  assert.equal(frames.size, 0);

  // Input and suggestion buttons must allow consecutive additions without following a nearby chart.
  for (const kind of ['input', 'button']) {
    api.selectedTags.clear(); api.page = 2; api.scrollY = 1400;
    refreshChips();
    const source = element(kind), previousFlights = flights;
    source.getBoundingClientRect = () => ({top: 75});
    for (const name of ['EDM', 'Piano']) {
      assert.equal(api.addTagFilter(name, source), true);
      assert.equal(api.page, 2, 'Adding from the picker must preserve the current page');
      assert.equal(api.scrollY, 1400, 'Adding from the picker must not scroll the input out of view');
      assert.equal(cardReads, 2, 'Only chart-tag additions may read a chart position');
    }
    assert.equal(flights, previousFlights + 2, 'Picker additions must retain their flight animation');
    flushFrames();
    assert.equal(api.scrollY, 1400);
  }

  // A later removal supersedes an earlier animation-frame restore, including in continuous mode.
  continuous = true; api.selectedTags = new Map([['edm', 'EDM'], ['piano', 'Piano']]);
  api.visibleCount = 100; refreshChips(); api.removeTagFilter('edm');
  api.scrollY = 900; api.removeTagFilter('piano');
  assert.equal(frames.size, 1);
  flushFrames();
  assert.equal(api.scrollY, 900);
  assert.equal(api.visibleCount, 100);
}

checkTagScrollRestoration();

async function checkRequestPaths() {
  const requests = [], responses = [
    {data: [{id: 17, tags: ['EDM'], description: 'Author note'}], cached: false, nextAllowedAt: Date.now() + 600000},
    {status: 200, data: {reviews: [], average: null}},
  ];
  const api = vm.createContext({
    DOMException, responseLimit: 32 * 1024 * 1024, cacheGeneration: 0, reviewCache: new Map(),
    INSTALL_ORIGIN: 'http://127.0.0.1:12345', INSTALL_KEY: 'test-key', INSTALLER_ERROR_TEXT: {},
    CHART_ENDPOINTS: {cache: '/v1/charts', manual: '/v1/charts/manual', automatic: '/v1/charts/automatic'},
    catalogNextAllowedAt: 0, catalogAutomaticNextAllowedAt: 0, syncCatalogRefresh: () => {},
    m: text => text, number: value => String(value), uiError: text => new Error(text), setStatus: () => {},
    readJSONResponse: async response => response.body,
    remember: (cache, id, value) => cache.set(id, value),
    fetch: async (url, options) => {
      requests.push({url, options});
      assert(responses.length, `Unexpected additional request: ${url}`);
      return {ok: true, headers: {get: () => null}, body: responses.shift()};
    },
  });
  vm.runInContext(extract('function catalogPayloadError(', 'async function readJSONResponse(')
    + extract('async function readReviews(', 'async function readSharedUser('), api);
  const controller = new AbortController();
  const catalog = await api.loadRemote(controller.signal);
  assert.equal(catalog.data[0].description, 'Author note');
  assert(api.catalogNextAllowedAt > Date.now(), 'The backend cooldown must update the refresh control');
  assert.equal(requests[0].options.headers['X-SpinShare-Key'], 'test-key');
  await api.readReviews(17, controller.signal);
  await api.readReviews(17, controller.signal);
  assert.deepEqual(requests.map(({url, options}) => [url, options.method]), [
    ['http://127.0.0.1:12345/v1/charts', 'GET'],
    ['https://spinsha.re/api/song/17/reviews', 'GET'],
  ], 'Catalog reads use the throttled local service; cached reviews make no request');
  assert(!requests.some(({url}) => /^\/api\/song\/\d+\/?$/.test(new URL(url).pathname)),
    'The view-counting song detail endpoint must not be requested');
}

checkRequestPaths().then(() => console.log('PASS: tag filters, candidate counts, viewport-preserving removal, add animations, and discovery/review request paths.'),
  error => {console.error(error); process.exitCode = 1;});
