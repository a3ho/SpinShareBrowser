'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'web', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'web', 'interface.css'), 'utf8');
const locales = JSON.parse(fs.readFileSync(path.join(root, 'web', 'locales.json'), 'utf8'));

function extract(start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from);
  assert(from >= 0 && to > from, `Missing production code: ${start}`);
  return source.slice(from, to);
}

class Element {
  constructor(name = '') {
    this.name = name; this.children = []; this.parentElement = null; this.hidden = false; this.disabled = false; this.textContent = ''; this.attributes = new Map();
    const classes = new Set(); this.classList = {toggle: (key, on) => on ? classes.add(key) : classes.delete(key), contains: key => classes.has(key)};
  }
  get isConnected() { return Boolean(this.connected || this.parentElement?.isConnected); }
  append(...children) { for (const child of children) { child.parentElement = this; this.children.push(child); } }
  remove() { if (!this.parentElement) return; const list = this.parentElement.children; list.splice(list.indexOf(this), 1); this.parentElement = null; }
  contains(target) { return this === target || this.children.some(child => child.contains?.(target)); }
  querySelector(selector) { return selector === '.song-title' ? this.title : null; }
  setAttribute(key, value) { this.attributes.set(key, String(value)); }
  removeAttribute(key) { this.attributes.delete(key); }
  focus() { if (this.isConnected && !this.hidden && !this.disabled) document.activeElement = this; }
}

const document = {activeElement: null};
const tick = () => new Promise(resolve => setImmediate(resolve));
const row = (id, changes = {}) => [id, `Chart ${id}`, '', 'Artist', 'Charter', '2026-01-01', [[4, 25]], 25, {fileReference: `spinshare_${id.toString(16)}`, updateHash: 'a'.repeat(32), dlc: null, tags: ['Rock'], ...changes}];

async function runtimeScenario() {
  const nodes = new Map(), rows = new Element('rows'), calls = [], pending = [];
  rows.connected = true; nodes.set('rows', rows); nodes.set('results-start', new Element('results-start')); nodes.get('results-start').connected = true;
  const installationFilter = new Element('installation-filter'); installationFilter.value = 'installed'; nodes.set('installation-filter', installationFilter);
  for (const id of ['installation-filter-feedback', 'installation-filter-retry', 'installation-filter-message']) nodes.set(id, new Element(id));
  const api = vm.createContext({
    Number, document, queueMicrotask, setTimeout, clearTimeout,
    $: id => nodes.get(id) || (() => { const value = new Element(id); nodes.set(id, value); return value; })(),
    INSTALL_DIRECTORY: 'C:\\Spin Rhythm\\CustomLevels', settingsRevision: 'a'.repeat(32), settingsStale: false, settingsBusy: '', appExiting: false,
    activityJobs: [], installationActivityIds: new Map(), installationStates: new Map(), installationViews: new Map(), installedCharts: new Map(), presenceQueue: new Map(),
    deletionStates: new Map(), deletionQueue: [], deletionBusy: false, installationCandidates: [], currentRows: [], presenceBusy: false, presenceGeneration: 0,
    installationIndex: null, presenceProblem: false, installationMutationGeneration: 0,
    installationFilterPending: false, installationFilterRemaining: 0, installationFilterTotal: 0, presenceRefreshQueued: false, applied: {}, phase: 'ready',
    m: value => value, number: String, uiError: value => Object.assign(new Error(value), {uiMessage: value}), errorText: error => error.uiMessage || error.message,
    uiText: (node, value) => { node.textContent = String(value); }, uiAttr: (node, key, value) => node.setAttribute(key, value),
    loadingIndicator: (node, active, queued) => { node.classList.toggle('is-loading', active && !queued); node.classList.toggle('is-queued', active && queued); },
    updateTaskProgress() {}, refreshSettingsControls() {}, refreshActivity() {}, renderActivity() {}, syncInstallationFilter: () => 0,
    playMotion: () => null, MOTION_MS: {standard: 180},
    rebuild() {
      for (const card of [...rows.children]) if (api.installedCharts.get(card.songId)?.value === false) card.remove();
    },
    installerRequest: async (method, route, body) => {
      calls.push({method, route, body});
      return new Promise((resolve, reject) => pending.push({body, resolve, reject}));
    },
  });
  vm.runInContext(extract('function installationStatePending(', 'function scheduleInstallationPoll('), api);

  function add(id, changes = {}) {
    const chart = row(id, changes), card = new Element(`card-${id}`), title = new Element(`title-${id}`), install = new Element(`install-${id}`), installLabel = new Element(), remove = new Element(`delete-${id}`), removeLabel = new Element(), note = new Element(), presence = new Element(), progress = new Element();
    card.songId = id; card.title = title; card.append(title, install, remove); rows.append(card);
    api.installationViews.set(id, {button: install, label: installLabel, deleteButton: remove, deleteLabel: removeLabel, note, presence, progress, row: chart, card, songTitle: chart[1]});
    api.currentRows.push(chart); api.installedCharts.set(id, {key: api.installationKey(chart), value: true, pending: false}); api.updateInstallationView(id); return {chart, card, title, install, installLabel, remove, removeLabel, note};
  }

  const first = add(1), second = add(2), third = add(3);
  api.installationStates.set(99, {requestId: 'request-unknown', running: false, requesting: false, rejected: false, expired: false, job: null, targetDirectory: api.INSTALL_DIRECTORY});
  api.syncInstallationInterlocks();
  assert.equal(first.remove.disabled, true, 'An installation request with an unknown result disables deletion globally');
  api.startDeletion(first.chart); assert.equal(calls.length, 0, 'An unresolved install submission blocks the delete API');
  api.installationStates.delete(99);
  api.activityJobs.push({songId: 99}); api.syncInstallationInterlocks();
  assert.equal(first.remove.disabled, true, 'Any active install disables deletion on every chart');
  api.startDeletion(first.chart); assert.equal(calls.length, 0, 'A globally blocked delete never reaches the API');
  api.activityJobs.length = 0; api.syncInstallationInterlocks();
  document.activeElement = second.remove;
  api.startDeletion(first.chart); api.startDeletion(second.chart);
  assert.equal(calls.length, 1, 'Only one local deletion runs at a time');
  assert.equal(first.removeLabel.textContent, 'Deleting...'); assert.equal(second.removeLabel.textContent, 'Queued');
  assert.equal(first.install.disabled, true); assert.equal(second.install.disabled, true); assert.equal(third.install.disabled, true, 'Any queued deletion disables installation on every chart');
  assert.deepEqual(Object.keys(calls[0].body), ['expectedRevision', 'songId', 'fileReference', 'updateHash']);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0].body)), {expectedRevision: 'a'.repeat(32), songId: 1, fileReference: 'spinshare_1', updateHash: 'a'.repeat(32)});

  pending.shift().resolve({settingsRevision: 'a'.repeat(32), songId: 1, deleted: true, filesDeleted: 4}); await tick(); await tick();
  assert.equal(calls.length, 2, 'The next queued chart starts after the first response');
  assert.equal(document.activeElement, second.remove, 'Removing another card never steals focus');
  assert.deepEqual(rows.children.map(card => card.songId), [2, 3]);

  pending.shift().resolve({settingsRevision: 'a'.repeat(32), songId: 2, deleted: true, filesDeleted: 3}); await tick(); await tick();
  assert.deepEqual(rows.children.map(card => card.songId), [3]);
  assert.equal(document.activeElement, third.title, 'Focus moves to the next title only when the removed card owned focus');
  assert.equal(api.installedCharts.get(2).value, false); assert.equal(api.deletionStates.size, 0);
  assert.equal(nodes.get('installation-announcement').textContent, 'Deleted local chart: Chart 2');

  const dlc = add(15, {dlc: {id: 1, identifier: 'monstercat', title: 'Monstercat DLC', storeLink: 'https://store.steampowered.com/app/1058830/Spin_Rhythm_XD__Monstercat_DLC/'}});
  api.startDeletion(dlc.chart); await tick();
  assert.deepEqual(JSON.parse(JSON.stringify(calls.at(-1).body)), {expectedRevision: 'a'.repeat(32), songId: 15, fileReference: 'spinshare_f', updateHash: 'a'.repeat(32)}, 'DLC deletion uses the same exact file reference and hash contract');
  pending.shift().resolve({settingsRevision: 'a'.repeat(32), songId: 15, deleted: true, filesDeleted: 1}); await tick(); await tick();
  assert.equal(api.installedCharts.get(15).value, false); assert.equal(rows.children.includes(dlc.card), false, 'An installed-only DLC card leaves after successful deletion');

  installationFilter.value = 'all';
  const malformed = add(4); document.activeElement = malformed.remove; api.startDeletion(malformed.chart); await tick();
  pending.shift().resolve({settingsRevision: 'a'.repeat(32), songId: 4, deleted: true}); await tick(); await tick();
  assert.equal(api.deletionStates.get(4).phase, 'error', 'Malformed success data becomes a per-card error');
  assert.equal(api.installedCharts.get(4).value, undefined, 'An uncertain deletion result cannot preserve the old installed claim');
  assert.equal(calls.at(-1).route, '/v1/installations/index', 'Every deletion failure rechecks the actual filesystem state');
  assert.equal(malformed.remove.hidden, true); assert.equal(malformed.install.disabled, false); assert.equal(malformed.note.classList.contains('is-error'), true);
  pending.shift().resolve({settingsRevision: 'a'.repeat(32), installations: []}); await tick(); await tick();
  assert.equal(api.installedCharts.get(4).value, false, 'The inventory response resolves an uncertain successful deletion');

  const changedContext = add(5); api.startDeletion(changedContext.chart); await tick();
  api.settingsRevision = 'b'.repeat(32);
  pending.shift().resolve({settingsRevision: 'a'.repeat(32), songId: 5, deleted: true, filesDeleted: 1}); await tick(); await tick();
  assert.notEqual(api.installedCharts.get(5)?.value, false, 'An old-directory deletion cannot mark the new directory uninstalled');
  assert.equal(calls.at(-1).route, '/v1/installations/index', 'A changed context schedules a fresh presence index');
  pending.shift().resolve({settingsRevision: 'b'.repeat(32), installations: [{fileReference: 'spinshare_5', updateHash: 'a'.repeat(32)}]}); await tick(); await tick();

  const partial = add(6); api.startDeletion(partial.chart); await tick();
  pending.shift().reject(Object.assign(new Error('partial restore'), {code: 'delete_partial', uiMessage: 'Some local chart files could not be restored.'})); await tick(); await tick();
  assert.equal(api.deletionStates.get(6).phase, 'error', 'A partial restore keeps an explicit per-card error in the same context');
  assert.equal(api.installedCharts.get(6).value, undefined, 'A partial restore invalidates the old installed value');
  assert.equal(calls.at(-1).route, '/v1/installations/index', 'A partial restore forces a fresh presence index');
  assert.equal(nodes.get('installation-announcement').textContent, 'Some local chart files could not be restored.', 'Partial recovery is announced outside the card');
  pending.shift().resolve({settingsRevision: 'b'.repeat(32), installations: []}); await tick(); await tick();
  assert.equal(api.installedCharts.get(6).value, false, 'The presence response, not the rollback assumption, decides partial recovery state');

  const oldCatalog = add(7); api.startDeletion(oldCatalog.chart); await tick();
  const newCatalogRow = row(7); newCatalogRow[8] = {...newCatalogRow[8], updateHash: 'b'.repeat(32)};
  api.currentRows = api.currentRows.map(item => item[0] === 7 ? newCatalogRow : item); api.installationViews.get(7).row = newCatalogRow;
  pending.shift().reject(Object.assign(new Error('changed'), {code: 'installation_changed', uiMessage: 'The installed chart files changed.'})); await tick(); await tick();
  assert.equal(api.deletionStates.has(7), false, 'A failure from an old catalog row cannot attach its error to the replacement row');
  assert.equal(calls.at(-1).route, '/v1/installations/index');
  assert.deepEqual(JSON.parse(JSON.stringify(calls.at(-1).body)), {expectedRevision: 'b'.repeat(32)});
  pending.shift().resolve({settingsRevision: 'b'.repeat(32), installations: [{fileReference: 'spinshare_7', updateHash: 'b'.repeat(32)}]}); await tick(); await tick();
  assert.equal(api.installationPresence(newCatalogRow), true, 'The returned index is matched against the current catalog fingerprint');

  const failed = add(8); api.startDeletion(failed.chart); await tick();
  pending.shift().reject(Object.assign(new Error('locked'), {code: 'delete_failed', uiMessage: 'Could not delete local chart files.'})); await tick(); await tick();
  assert.equal(api.installedCharts.get(8).value, undefined, 'A known rollback failure also invalidates the cached presence claim');
  assert.equal(calls.at(-1).route, '/v1/installations/index', 'All deletion failures converge on an actual inventory read');
  pending.shift().resolve({settingsRevision: 'b'.repeat(32), installations: [{fileReference: 'spinshare_8', updateHash: 'a'.repeat(32)}]}); await tick(); await tick();
  assert.equal(api.installationPresence(failed.chart), true, 'A failed deletion may be confirmed as still installed');

  const race = add(9); api.queueInstallationChecks([race.chart], true); await tick();
  assert.equal(calls.at(-1).route, '/v1/installations/index'); api.startDeletion(race.chart); await tick();
  assert.equal(calls.at(-1).route, '/v1/installations/delete', 'Deletion can start from stale-while-revalidate installed state');
  pending.shift().resolve({settingsRevision: 'b'.repeat(32), installations: [{fileReference: 'spinshare_9', updateHash: 'a'.repeat(32)}]}); await tick(); await tick();
  assert.equal(api.installedCharts.get(9).pending, false, 'A successful inventory response settles records skipped for an active deletion');
  pending.shift().reject(Object.assign(new Error('locked'), {code: 'delete_failed', uiMessage: 'Could not delete local chart files.'})); await tick(); await tick();
  assert.equal(calls.at(-1).route, '/v1/installations/index');
  pending.shift().resolve({settingsRevision: 'b'.repeat(32), installations: [{fileReference: 'spinshare_9', updateHash: 'a'.repeat(32)}]}); await tick(); await tick();
  assert.equal(api.installationPresence(race.chart), true); assert.equal(api.installedCharts.get(9).pending, false);

  const uncertainRace = add(14); api.queueInstallationChecks([uncertainRace.chart], true); await tick();
  const oldInventory = pending.shift(); api.startDeletion(uncertainRace.chart); await tick(); const uncertainDelete = pending.shift();
  uncertainDelete.reject(Object.assign(new Error('timeout'), {uiMessage: 'Deletion timed out.'})); await tick(); await tick();
  assert.equal(api.installedCharts.get(14).value, undefined, 'An uncertain failure invalidates the record while an older inventory is in flight');
  oldInventory.resolve({settingsRevision: 'b'.repeat(32), installations: [{fileReference: 'spinshare_e', updateHash: 'a'.repeat(32)}]}); await tick(); await tick();
  assert.equal(calls.at(-1).route, '/v1/installations/index', 'The mutation epoch forces a post-failure inventory instead of consuming the queued check with an older response');
  assert.equal(pending.length, 1);
  pending.shift().resolve({settingsRevision: 'b'.repeat(32), installations: []}); await tick(); await tick();
  assert.equal(api.installationPresence(uncertainRace.chart), false, 'Only the post-failure inventory decides the uncertain deletion result');

  const focusedDelete = add(10); document.activeElement = focusedDelete.remove; api.startDeletion(focusedDelete.chart); await tick();
  pending.shift().resolve({settingsRevision: 'b'.repeat(32), songId: 10, deleted: true, filesDeleted: 1}); await tick(); await tick();
  assert.equal(document.activeElement, focusedDelete.install, 'All mode moves focus only from the delete button that becomes hidden');
  assert.equal(rows.children.includes(focusedDelete.card), true, 'All mode keeps the now-uninstalled card in place');

  const stableFocus = add(11); api.startDeletion(stableFocus.chart); document.activeElement = stableFocus.title; await tick();
  pending.shift().resolve({settingsRevision: 'b'.repeat(32), songId: 11, deleted: true, filesDeleted: 1}); await tick(); await tick();
  assert.equal(document.activeElement, stableFocus.title, 'Deleting in All mode does not steal focus from another stable control in the same card');

  const queuedFocus = add(12), queuedAfter = add(13); api.startDeletion(queuedFocus.chart); api.startDeletion(queuedAfter.chart); document.activeElement = queuedFocus.remove;
  pending.shift().resolve({settingsRevision: 'b'.repeat(32), songId: 12, deleted: true, filesDeleted: 1}); await tick(); await tick();
  assert.equal(queuedFocus.install.disabled, true, 'Another queued deletion keeps installation disabled');
  assert.equal(document.activeElement, queuedFocus.title, 'Focus falls back to the retained title instead of a disabled install button');
  pending.shift().resolve({settingsRevision: 'b'.repeat(32), songId: 13, deleted: true, filesDeleted: 1}); await tick(); await tick();

  for (const card of [...rows.children]) card.remove();
  const lastPage = add(20), previousPage = new Element('previous-page-card'), previousTitle = new Element('previous-page-title'), rebuild = api.rebuild;
  previousPage.title = previousTitle; previousPage.append(previousTitle); installationFilter.value = 'installed'; document.activeElement = lastPage.remove;
  api.rebuild = () => { lastPage.card.remove(); rows.append(previousPage); };
  api.startDeletion(lastPage.chart); await tick();
  pending.shift().resolve({settingsRevision: 'b'.repeat(32), songId: 20, deleted: true, filesDeleted: 1}); await tick(); await tick();
  assert.equal(document.activeElement, nodes.get('results-start'), 'An emptied last page focuses the result summary, not the first card on the clamped previous page');
  assert.notEqual(document.activeElement, previousTitle); api.rebuild = rebuild;
}

async function main() {
  for (const language of ['en', 'zh-CN']) for (const key of ['Delete', 'Deleting...', 'Waiting to delete local files.', 'Deleting local chart files...', 'Delete this chart, its cover, and its audio from the install directory.', 'Could not confirm deletion. Refresh the installation status before trying again.', 'Some local chart files could not be restored. Check the install folder before trying again.', 'Deleted local chart: ']) assert.equal(typeof locales[language][key], 'string');
  assert.match(source, /'\/v1\/installations\/delete'/);
  assert.match(source, /installationPresence\(row\)!==true/);
  assert.match(source, /playMotion\(card,[\s\S]*?opacity:0[\s\S]*?translateY\(-4px\)[\s\S]*?MOTION_MS\.standard/);
  assert.doesNotMatch(extract('function startDeletion(', 'function scheduleInstallationPoll('), /confirm\s*\(|showModal\s*\(/i);
  assert.match(source, /async function startInstallation\(row\)\{[\s\S]*?if\(deletionWorkActive\(\)\)return;/);
  assert.match(source, /if\(changed\)\{[^}]*clearDeletionErrors\(\)/, 'Changing installation context clears stale deletion errors');
  assert.match(source, /function invalidateCatalogDerived\(\)[\s\S]*?clearDeletionErrors\(\)/, 'Publishing a changed catalog clears stale deletion errors');
  assert.match(css, /\.delete-button\s*\{[^}]*width:\s*96px[^}]*font-size:\s*var\(--type-control\)/s);
  assert.match(css, /@media \(forced-colors: active\)[\s\S]*?\.delete-button/);
  assert.doesNotMatch(css.match(/\.delete-button\s*\{[^}]*\}/s)[0], /font-family/);
  await runtimeScenario();
  console.log('PASS: queued multi-delete, unresolved-install interlock, context-safe errors, partial-recovery recheck, focus repair, motion, responsive styling, forced colors and bilingual copy.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
