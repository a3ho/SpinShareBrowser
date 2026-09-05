'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'web', 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'web', 'index.html'), 'utf8');
function extract(start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from);
  assert(from >= 0 && to > from, `${start} .. ${end}`);
  return source.slice(from, to);
}
class Element {
  constructor() {
    this.open = false; this.disabled = false; this.inert = false; this.isConnected = true;
    this.textContent = ''; this.attributes = new Map(); this.classes = new Set();
    this.classList = {toggle: (name, on) => on ? this.classes.add(name) : this.classes.delete(name), contains: name => this.classes.has(name)};
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  focus() { this.focused = true; }
  close() { this.open = false; }
}
const row = id => [id, `Song ${id}`, '', '', '', '', '', 20, {dlc: false}];
const settings = (revision, directory, confirmed = false) => ({
  revision, targetDirectory: directory, defaultDirectory: 'C:\\Game\\Custom', customDirectory: directory,
  closeBehavior: 'ask', installDirectoryConfirmed: confirmed, version: '2.1.0', exiting: false,
});

function harness() {
  const nodes = new Map(), calls = [], starts = [];
  const node = id => { if (!nodes.has(id)) nodes.set(id, new Element()); return nodes.get(id); };
  let service = async () => { throw new Error('Unexpected local request'); };
  let api;
  api = vm.createContext({
    installDirectoryConfirmed: false, installDirectoryConfirmation: null, installDirectoryConfirmBusy: false,
    INSTALL_DIRECTORY: 'C:\\Game\\Custom', DEFAULT_INSTALL_DIRECTORY: 'C:\\Game\\Custom', settingsRevision: 'a'.repeat(32),
    settingsBusy: '', settingsStale: false, appExiting: false,
    $: node, document: {activeElement: null}, m: String,
    uiText(target, value) { target.textContent = String(value); },
    loadingIndicator(target, active) { target.loading = active; },
    openDialogPanel(target) { target.open = true; },
    closeDialogPanel(target, done) { target.close(); done?.(); },
    updateAllInstallationViews() {}, errorText: error => error.message,
    uiError(message) { const error = new Error(message); error.uiMessage = message; return error; },
    readSettings(payload) { return payload.settings; },
    applySettings(value) {
      api.INSTALL_DIRECTORY = value.targetDirectory; api.DEFAULT_INSTALL_DIRECTORY = value.defaultDirectory;
      api.settingsRevision = value.revision; api.installDirectoryConfirmed = value.installDirectoryConfirmed;
      api.refreshInstallDirectoryConfirmation();
    },
    async installerRequest(method, route, body) { calls.push({method, route, body}); return service(method, route, body); },
    async startInstallation(value) { starts.push(value[0]); },
  });
  vm.runInContext(extract('const installDirectoryConfirmControls=', 'async function exitTool('), api);
  return {api, node, calls, starts, setService: value => { service = value; }};
}

async function run() {
  assert.match(html, /id="install-directory-dialog"/);
  assert.match(html, /id="install-directory-confirm-path"/);
  assert.match(html, /<h2 id="install-directory-title" data-ui-static="Current chart installation directory">/);
  assert.match(html, /id="install-directory-confirm-path" aria-labelledby="install-directory-title"/);
  assert.doesNotMatch(html, /Before your first chart installation|install-directory-message|install-directory-hint|You only need to confirm once/);
  assert.doesNotMatch(html, /install-directory-mark|install-directory-confirm-label|data-ui-static="Confirm installation directory"/);
  assert.match(html, /id="install-directory-change"[^>]*>[\s\S]*?use href="#icon-folder"/);

  {
    const h = harness(), first = row(1), second = row(2), focus = new Element();
    h.api.requestInstallation(first, focus);
    h.api.requestInstallation(first, focus);
    h.api.requestInstallation(second, new Element());
    assert.equal(h.node('install-directory-dialog').open, true);
    assert.equal(h.api.installDirectoryConfirmation.row[0], 1, 'Rapid clicks retain one original pending chart');
    assert.deepEqual(h.calls, [], 'Opening or repeating the prompt must never submit an installation');
    assert.deepEqual(h.starts, []);
    h.api.closeInstallDirectoryConfirmation();
    assert.equal(h.api.installDirectoryConfirmation, null);
    assert.deepEqual(h.calls, []); assert.deepEqual(h.starts, []);
  }

  {
    const h = harness(), first = row(7);
    h.setService(async (method, route, body) => {
      assert.equal(route, '/v1/install-directory-confirmation');
      assert.equal(body.expectedRevision, 'a'.repeat(32)); assert.deepEqual(Object.keys(body), ['expectedRevision']);
      return {confirmed: true, settingsRevision: body.expectedRevision, targetDirectory: 'C:\\Game\\Custom'};
    });
    h.api.requestInstallation(first, new Element());
    await h.api.confirmInstallDirectoryAndContinue();
    assert.deepEqual(h.calls.map(call => call.route), ['/v1/install-directory-confirmation']);
    assert.deepEqual(h.starts, [7], 'Only a successful persisted confirmation continues the original chart');
    assert.equal(h.api.installDirectoryConfirmed, true);
  }

  {
    const h = harness(), first = row(9); let finishPicker;
    h.setService(() => new Promise(resolve => { finishPicker = resolve; }));
    h.api.requestInstallation(first, new Element());
    const changing = h.api.changeInstallDirectoryFromConfirmation();
    await Promise.resolve();
    assert.equal(h.api.installDirectoryConfirmBusy, true);
    assert.equal(h.node('install-directory-error').loading, true, 'Only the inline status owns the picker spinner');
    assert.notEqual(h.node('install-directory-actions').loading, true, 'The action row must not render a second spinner');
    for (const id of ['install-directory-close', 'install-directory-change', 'install-directory-confirm']) assert.equal(h.node(id).disabled, true);
    finishPicker({cancelled: true, settings: settings('a'.repeat(32), 'C:\\Game\\Custom')});
    await changing;
    assert.equal(h.node('install-directory-dialog').open, true, 'Cancelling the Windows picker keeps the confirmation open');
    assert.equal(h.api.installDirectoryConfirmed, false); assert.deepEqual(h.starts, []);
    assert.equal(h.node('install-directory-confirm-path').textContent, 'C:\\Game\\Custom');
    assert.equal(h.node('install-directory-error').loading, false, 'The picker spinner retires after cancellation');
    assert.equal(h.node('install-directory-actions').loading, undefined);
  }

  {
    const h = harness();
    h.setService(async () => { throw new Error('Picker failed'); });
    h.api.requestInstallation(row(10), new Element());
    await h.api.changeInstallDirectoryFromConfirmation();
    assert.equal(h.node('install-directory-error').textContent, 'Picker failed');
    assert.equal(h.node('install-directory-error').loading, false, 'Picker errors never retain loading animation');
    assert.equal(h.node('install-directory-error').classes.has('is-error'), true);
    for (const id of ['install-directory-close', 'install-directory-change', 'install-directory-confirm']) assert.equal(h.node(id).disabled, false);
  }

  {
    const h = harness(), nextRevision = 'b'.repeat(32), nextDirectory = 'D:\\Rhythm\\Custom', first = row(11);
    h.setService(async (method, route, body) => {
      if (route === '/v1/directory/select') return {cancelled: false, settings: settings(nextRevision, nextDirectory)};
      assert.equal(route, '/v1/install-directory-confirmation');
      assert.equal(body.expectedRevision, nextRevision); assert.deepEqual(Object.keys(body), ['expectedRevision']);
      return {confirmed: true, settingsRevision: nextRevision, targetDirectory: nextDirectory};
    });
    h.api.requestInstallation(first, new Element());
    await h.api.changeInstallDirectoryFromConfirmation();
    assert.equal(h.node('install-directory-dialog').open, true);
    assert.equal(h.node('install-directory-confirm-path').textContent, nextDirectory);
    assert.equal(h.node('install-directory-error').loading, false, 'The picker spinner retires after a directory is selected');
    assert.deepEqual(h.starts, []);
    h.api.closeInstallDirectoryConfirmation();
    assert.equal(h.api.installDirectoryConfirmation, null, 'Closing after a directory change leaves no orphaned confirmation');
    const reopened = row(12); h.api.requestInstallation(reopened, new Element());
    assert.equal(h.node('install-directory-dialog').open, true, 'The next install reopens the same confirmation flow');
    assert.equal(h.api.installDirectoryConfirmation.row[0], 12);
    await h.api.confirmInstallDirectoryAndContinue();
    assert.deepEqual(h.calls.map(call => call.route), ['/v1/directory/select', '/v1/install-directory-confirmation']);
    assert.deepEqual(h.starts, [12]);
  }

  {
    let viewRefreshes = 0;
    const api = vm.createContext({
      AbortController, setTimeout, clearTimeout, INSTALL_KEY: 'key', INSTALL_ORIGIN: 'http://127.0.0.1:1',
      settingsRevision: 'b'.repeat(32), settingsStale: false,
      m: String, localizeInstallerMessage: String, INSTALLER_ERROR_TEXT: {settings_changed: 'The install directory changed'},
      errorText: error => error.uiMessage || error.message,
      uiError(message) { const error = new Error(message); error.uiMessage = message; return error; },
      updateAllInstallationViews() { viewRefreshes++; },
      async fetch() { return {ok: false, status: 409, headers: {}, body: {}}; },
      async readJSONResponse() { return {code: 'settings_changed', error: 'The install directory changed'}; },
    });
    vm.runInContext(extract('async function installerRequest(', 'function installationPending('), api);
    await assert.rejects(api.installerRequest('POST', '/v1/installations/index', {expectedRevision: 'a'.repeat(32)}), error => error.code === 'settings_changed');
    assert.equal(api.settingsStale, false, 'A late response for the previous directory cannot poison current settings');
    assert.equal(viewRefreshes, 0);
    await assert.rejects(api.installerRequest('POST', '/v1/install', {songId: 1}, 'a'.repeat(32)), error => error.code === 'settings_changed');
    assert.equal(api.settingsStale, false, 'A late install response with an old header revision is also obsolete');
    await assert.rejects(api.installerRequest('POST', '/v1/installations/index', {expectedRevision: 'b'.repeat(32)}), error => error.code === 'settings_changed');
    assert.equal(api.settingsStale, true, 'A mismatch for the current revision still enters the guarded stale state');
    assert.equal(viewRefreshes, 1);
  }
  console.log('PASS: first-install directory confirmation is single-flight, revision-bound, persistent-gated, cancellable and directory-picker safe.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
