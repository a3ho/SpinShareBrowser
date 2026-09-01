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
    this.classList = {toggle: (name, on) => on ? this.classes.add(name) : this.classes.delete(name)};
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  focus() { this.focused = true; }
  close() { this.open = false; }
}
const row = id => [id, `Song ${id}`, '', '', '', '', '', 20, {dlc: false}];
const settings = (revision, directory, confirmed = false) => ({
  revision, targetDirectory: directory, defaultDirectory: 'C:\\Game\\Custom', customDirectory: directory,
  closeBehavior: 'ask', installDirectoryConfirmed: confirmed, version: '2.0.0', exiting: false,
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
    const h = harness(), first = row(9);
    h.setService(async () => ({cancelled: true, settings: settings('a'.repeat(32), 'C:\\Game\\Custom')}));
    h.api.requestInstallation(first, new Element());
    await h.api.changeInstallDirectoryFromConfirmation();
    assert.equal(h.node('install-directory-dialog').open, true, 'Cancelling the Windows picker keeps the confirmation open');
    assert.equal(h.api.installDirectoryConfirmed, false); assert.deepEqual(h.starts, []);
    assert.equal(h.node('install-directory-confirm-path').textContent, 'C:\\Game\\Custom');
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
    assert.deepEqual(h.starts, []);
    await h.api.confirmInstallDirectoryAndContinue();
    assert.deepEqual(h.calls.map(call => call.route), ['/v1/directory/select', '/v1/install-directory-confirmation']);
    assert.deepEqual(h.starts, [11]);
  }
  console.log('PASS: first-install directory confirmation is single-flight, revision-bound, persistent-gated, cancellable and directory-picker safe.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
