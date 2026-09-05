'use strict';

// Real browser DOM checks with an isolated profile and fully intercepted traffic.
// Install Playwright as a separate QA tool; no browser window is ever shown.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');
const {readWebTemplate} = require('../tests/read_web_template.cjs');
const root = path.resolve(__dirname, '..');
const version = /VERSION = "([^"]+)"/.exec(fs.readFileSync(path.join(root, 'src/spinshare_portable.py'), 'utf8'))[1];
const messages = JSON.parse(fs.readFileSync(path.join(root, 'web/locales.json'), 'utf8'));
const origin = 'http://127.0.0.1:18479';
const revision = 'a'.repeat(32), hash = 'b'.repeat(32);
const output = path.join(root, '.qa', 'browser-smoke');
fs.mkdirSync(output, {recursive: true});
const songs = [1, 2, 3].map(id => ({
  id, title: `Fixture chart ${id}`, subtitle: 'Isolated test data', artist: 'Test artist', charter: 'Test mapper',
  uploader: 10 + id, fileReference: `spinshare_${id}`, updateHash: hash,
  hasXDDifficulty: true, XDDifficulty: 25, tags: ['Fixture'],
  uploadDate: {date: '2026-09-01 12:00:00', timezone: 'Europe/Berlin'},
  description: id === 2 ? 'This chart contains local changes in this isolated test.' : '',
}));
const template = readWebTemplate();
const json = value => JSON.stringify(value).replace(/</g, '\\u003c');

async function scenario(browser, language, width, firstFailure = false) {
  const context = await browser.newContext({viewport: {width, height: 960}, reducedMotion: 'reduce', serviceWorkers: 'block'});
  const page = await context.newPage();
  const errors = [], unexpected = [], requests = [];
  let indexFailure = firstFailure, lookupFailure = true;
  const config = {mode: 'desktop', version, key: '1'.repeat(64), origin,
    targetDirectory: 'C:\\SpinShare Test\\Custom', defaultDirectory: 'C:\\SpinShare Test\\Custom',
    settingsRevision: revision, language, closeBehavior: 'ask', playerShortcutHintShown: true, installDirectoryConfirmed: true};
  const html = template.replace(/__SPINSHARE_(RUNTIME_CONFIG|CONNECT_ORIGIN|MEDIA_ORIGIN|UI_CATALOG)__/g,
    (_, key) => ({RUNTIME_CONFIG: json(config), CONNECT_ORIGIN: origin, MEDIA_ORIGIN: origin, UI_CATALOG: json(messages)})[key]);
  page.on('pageerror', error => errors.push(error.message));
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    requests.push(request.method() + ' ' + url.pathname);
    const respond = (body, status = 200) => route.fulfill({status, contentType: 'application/json',
      headers: {'Access-Control-Allow-Origin': origin}, body: JSON.stringify(body)});
    if (request.method() === 'OPTIONS') return route.fulfill({status: 204, headers: {
      'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Allow-Methods': 'GET,POST'}});
    if (url.origin === origin) {
      if (url.pathname === '/') return route.fulfill({contentType: 'text/html', body: html});
      assert.equal(request.headers()['x-spinshare-key'], config.key, 'Local API must remain authenticated');
      if (url.pathname === '/v1/charts') return respond({data: songs, fetchedAt: Date.now(), stale: false, cached: true, nextAllowedAt: 0});
      if (url.pathname === '/v1/settings') return respond({settings: {targetDirectory: config.targetDirectory,
        defaultDirectory: config.defaultDirectory, customDirectory: null, revision, version,
        installDirectoryConfirmed: true, exiting: false, closeBehavior: 'ask'}});
      if (url.pathname === '/v1/activity') return respond({exiting: false, activeCount: 0, jobs: []});
      if (url.pathname === '/v1/desktop/dialog') return respond({dialog: null});
      if (url.pathname === '/v1/desktop/window') return respond({window: {visible: true, customChrome: true, maximized: false}});
      if (url.pathname === '/v1/desktop/window/regions') return respond({ok: true});
      if (url.pathname === '/v1/installations/index') return indexFailure
        ? respond({code: 'installation_recovery_required', error: 'Recovery files retained.'}, 409)
        : respond({settingsRevision: revision, installations: [
          {fileReference: 'spinshare_1', updateHash: hash}, {fileReference: 'spinshare_2', updateHash: 'c'.repeat(32)}]});
    }
    if (url.origin === 'https://spinsha.re') {
      if (/^\/api\/song\/\d+\/reviews$/.test(url.pathname)) return respond({status: 200, data: {average: false, reviews: []}});
      if (/^\/api\/user\/\d+$/.test(url.pathname)) return respond({status: 503, data: null}, 503);
      if (url.pathname === '/api/searchUsers') return lookupFailure
        ? respond({status: 503, data: null}, 503) : respond({status: 200, data: []});
    }
    if (url.origin === 'https://spinshare.b-cdn.net') return route.fulfill({status: 404, body: ''});
    unexpected.push(request.method() + ' ' + url.origin + url.pathname);
    return route.abort('blockedbyclient');
  });
  const card = id => page.locator(`article[aria-labelledby="song-title-${id}"]`);
  const text = key => messages[language][key];
  const select = async value => {
    await page.locator('#installation-filter').evaluate((node, value) => {
      node.value = value; node.dispatchEvent(new Event('change', {bubbles: true}));
    }, value);
  };
  try {
    await page.goto(origin);
    await page.waitForFunction(() => !document.querySelector('#apply-filters').disabled);
    await page.locator('#date-preset').evaluate(node => {node.value = 'all'; node.dispatchEvent(new Event('change', {bubbles: true}));});
    await page.locator('#apply-filters').click();
    await page.waitForFunction(() => document.querySelectorAll('.chart-card').length === 3);
    if (firstFailure) {
      await page.locator('#installation-filter-retry').waitFor({state: 'visible'});
      assert.equal(await card(1).locator('.install-presence').textContent(), text('Installation status unknown'));
      assert(await page.locator('#installation-filter-feedback').isVisible());
      indexFailure = false;
      await page.locator('#installation-filter-retry').click();
    }
    await page.waitForFunction(expected => document.querySelector('#song-title-2').closest('article').querySelector('.install-presence').textContent === expected, text('Local files differ'));
    assert(await card(1).locator('.delete-button').isVisible());
    assert.equal(await card(2).locator('.delete-button').isVisible(), false);
    assert.equal(await card(3).locator('.delete-button').isVisible(), false);
    assert.equal(await card(2).locator('.install-note').textContent(), text('Installing again replaces the local chart and any local edits.'));
    for (const [mode, ids] of [['installed', [1, 2]], ['different', [2]], ['uninstalled', [3]], ['all', [1, 2, 3]]]) {
      await select(mode);
      await page.waitForFunction(count => document.querySelectorAll('.chart-card').length === count, ids.length);
      assert.deepEqual((await page.locator('.song-title').allTextContents()).sort(), ids.map(id => `Fixture chart ${id}`));
    }
    indexFailure = true;
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.locator('#installation-filter-retry').waitFor({state: 'visible'});
    assert.equal(await card(1).locator('.install-presence').textContent(), text('Installed'));
    assert(await page.locator('#installation-filter-feedback').isVisible());
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'No horizontal overflow');
    await page.screenshot({path: path.join(output, `${language}-${width}${firstFailure ? '-first-failure' : ''}.png`), fullPage: true});
    indexFailure = false;
    await page.locator('#installation-filter-retry').click();
    await page.locator('#installation-filter-retry').waitFor({state: 'hidden'});
    assert(await page.locator('#search-network-hint').isVisible());
    await page.locator('#local-search').fill('Fixture');
    await page.locator('#search-retry').waitFor({state: 'visible'});
    assert.equal(await page.locator('.chart-card').count(), 3, 'Local results survive uploader lookup failure');
    lookupFailure = false;
    await page.locator('#search-retry').click();
    await page.locator('#search-retry').waitFor({state: 'hidden'});
    assert(requests.includes('POST /api/searchUsers'));
    assert.equal(requests.some(item => /\/v1\/charts\/(automatic|manual)|\/download$/.test(item)), false);
    assert.deepEqual(errors, [], 'No uncaught browser exceptions');
    assert.deepEqual(unexpected, [], 'All traffic must be explicit fixtures');
    return {language, width, firstFailure, checks: 'passed'};
  } finally {
    await context.close();
  }
}

(async () => {
  const browser = await chromium.launch({headless: true, channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || 'msedge'});
  try {
    const results = [];
    for (const language of ['en', 'zh-CN']) for (const width of [1280, 680]) results.push(await scenario(browser, language, width));
    results.push(await scenario(browser, 'en', 680, true));
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({version, results}, null, 2) + '\n');
    console.log('Headless browser smoke: 5 scenarios passed (all traffic isolated).');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
