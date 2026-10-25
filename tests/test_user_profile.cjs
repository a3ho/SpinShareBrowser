'use strict';

// Run with Node 18+: node tests/test_user_profile.cjs. No browser or network is used.
// Regression guards for 2.3.4 field reports:
// 1. "My profile" was silently dead after signing in post-launch: the identity
//    read the frozen APP_CONFIG.session boot snapshot instead of the live
//    sessionAccount, so a session created after boot always looked unsigned.
// 2. The profile view sat INSIDE #chart-panel — hiding the panel hid the view
//    with it (0×0 render, "my profile never opens").
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {test} = require('node:test');

const web = path.join(__dirname, '..', 'web');
const appSource = fs.readFileSync(path.join(web, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(web, 'index.html'), 'utf8');

function extract(start, end) {
  const from = appSource.indexOf(start), to = appSource.indexOf(end, from);
  assert(from >= 0 && to > from, `Missing block: ${start}`);
  return appSource.slice(from, to);
}

function identityHarness({connected, sessionAccount}) {
  const context = vm.createContext({
    console,
    APP_CONFIG: Object.freeze({session: {connected: false, username: null, userId: null}}),
    sessionConnected: () => connected,
    sessionAccount,
  });
  // user-profile block: from its header comment to the playlists module.
  vm.runInContext(extract('// Live session state', 'async function openUserProfile'), context);
  return vm.runInContext('profileIdentity()', context);
}

test('profileIdentity uses the live session, not the frozen boot snapshot', () => {
  // Boot was signed out (frozen snapshot stays null); the user signed in later.
  const identity = identityHarness({
    connected: true,
    sessionAccount: {connected: true, username: '刘易手', userId: 42, loginActive: false},
  });
  assert.equal(identity && identity.userId, 42, 'a post-launch sign-in must expose the profile');
});

test('profileIdentity stays null while signed out, whatever the snapshot says', () => {
  assert.equal(identityHarness({connected: false, sessionAccount: {connected: false, username: null, userId: null, loginActive: false}}), null);
});

test('profileIdentity tolerates a missing live session object', () => {
  assert.equal(identityHarness({connected: false}), null);
});

test('the profile view is NOT nested inside the panel it hides', () => {
  const viewAt = html.indexOf('id="user-profile-view"');
  const panelOpen = html.indexOf('id="chart-panel"');
  const panelClose = html.indexOf('</main>');
  assert(viewAt > panelOpen && viewAt < panelClose, 'view must stay inside main');
  // Recompute the panel's closing tag by depth so the assertion tracks the real DOM.
  const before = html.slice(panelOpen, viewAt);
  const opens = (before.match(/<div/g) || []).length;
  const closes = (before.match(/<\/div>/g) || []).length;
  // Outside the panel means every div opened by the panel is already closed
  // at the view's position (opens == closes), so hiding the panel cannot
  // swallow the view.
  assert.strictEqual(closes >= opens, true, 'user-profile-view must live outside #chart-panel (2.3.4 "my profile never opens")');
});
