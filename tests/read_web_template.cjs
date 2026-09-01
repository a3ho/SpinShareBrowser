'use strict';

// Match load_web_template() without executing application code or requiring Python.
const fs = require('node:fs');
const path = require('node:path');

function readWebTemplate() {
  const web = path.join(__dirname, '..', 'web');
  const read = name => fs.readFileSync(path.join(web, name), 'utf8').replace(/\r\n?/g, '\n');
  const template = read('index.html');
  const fragments = new Map([
    ['/*__SPINSHARE_STYLES__*/', read('interface.css')],
    ['/*__SPINSHARE_CARDS__*/', read('chart-card.js')],
    ['/*__SPINSHARE_APP__*/', read('app.js')],
  ]);
  for (const marker of fragments.keys()) {
    if (template.split(marker).length !== 2) throw new Error('Missing or duplicate frontend fragment: ' + marker);
  }
  return template.replace(/\/\*__SPINSHARE_(?:STYLES|CARDS|APP)__\*\//g, marker => fragments.get(marker));
}

module.exports = {readWebTemplate};
