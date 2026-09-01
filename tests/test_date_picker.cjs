'use strict';
// Offline interaction checks for the production calendar and existing date filters.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../web/app.js'), 'utf8');
const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, '../web/locales.json'), 'utf8'));
function extract(start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from);
  assert(from >= 0 && to > from, `Missing production code: ${start}`);
  return source.slice(from, to);
}

const nodes = new Map(), viewportEvents = new Map(), calendarMoves = [];
class Element {
  constructor(tag = 'div') {
    this.tagName = tag; this.children = []; this.attributes = new Map(); this.events = new Map();
    this.className = ''; this.dataset = {}; this.style = {}; this.value = ''; this.disabled = false;
    this.hidden = false; this.isConnected = true; this.open = false;
    this.classList = {
      contains: name => this.className.split(' ').includes(name),
      toggle: (name, value) => {
        const classes = new Set(this.className.split(' ').filter(Boolean));
        if (value) classes.add(name); else classes.delete(name);
        this.className = [...classes].join(' ');
      },
    };
  }
  set id(value) { this._id = value; nodes.set(value, this); }
  get id() { return this._id; }
  set tabIndex(value) { this.setAttribute('tabindex', String(value)); }
  get tabIndex() { return Number(this.getAttribute('tabindex') ?? -1); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); if (name === 'class') this.className = value; }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  remove() { if (this.parentElement) { const siblings = this.parentElement.children; siblings.splice(siblings.indexOf(this), 1); this.parentElement = null; } }
  append(...children) { for (const child of children) { child.remove(); child.parentElement = this; this.children.push(child); } }
  after(child) {
    calendarMoves.push({node: child, wasOpen: child.open}); child.remove(); child.parentElement = this.parentElement;
    this.parentElement.children.splice(this.parentElement.children.indexOf(this) + 1, 0, child);
  }
  replaceChildren(...children) { for (const child of this.children) child.parentElement = null; this.children = []; this.append(...children); }
  contains(node) { return this === node || this.children.some(child => child.contains(node)); }
  matches(selector) {
    if (selector.includes(',')) return selector.split(',').some(part => this.matches(part));
    if (selector === ':popover-open') return this.open;
    if (selector.startsWith('.')) return this.classList.contains(selector.slice(1));
    const attribute = selector.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);
    return Boolean(attribute && this.attributes.has(attribute[1]) && (attribute[2] === undefined || this.getAttribute(attribute[1]) === attribute[2]));
  }
  querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector); }
  addEventListener(name, callback) { if (!this.events.has(name)) this.events.set(name, []); this.events.get(name).push(callback); }
  emit(name, details = {}) {
    const event = {target: this, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, ...details};
    for (let target = this; target; target = target.parentElement) {
      for (const callback of target.events.get(name) || []) callback(event);
      if (event.stopped) break;
    }
    return event;
  }
  click() { if (!this.disabled) this.emit('click'); }
  focus(options) { document.activeElement = this; this.focusOptions = options; }
  showPopover() { this.open = true; this.emit('toggle'); }
  hidePopover() { this.open = false; this.emit('toggle'); }
  getBoundingClientRect() {
    if (this.className === 'topbar') return {bottom: 64};
    if (this.id !== 'date-calendar') return {left: 250, right: 284, top: 150, bottom: 186, width: 34, height: 36};
    const width = parseFloat(this.style.width) || 320, height = Math.min(350, parseFloat(this.style.maxHeight) || 350);
    return {width, height, left: parseFloat(this.style.left) || 0, top: parseFloat(this.style.top) || 0};
  }
}
const document = {
  documentElement: Object.assign(new Element('html'), {clientWidth: 900, clientHeight: 700}),
  body: new Element('body'), activeElement: null,
  createElement: tag => new Element(tag), createElementNS: (_, tag) => new Element(tag),
  querySelector(selector) { return this.body.querySelector(selector); },
  querySelectorAll(selector) { return selector === 'input[name="diff"]:checked' ? [{value: '4'}] : this.body.querySelectorAll(selector); },
};
function node(id) { if (!nodes.has(id)) { const element = new Element(); element.id = id; document.body.append(element); } return nodes.get(id); }
const topbar = new Element(); topbar.className = 'topbar'; document.body.append(topbar);
let now = '2026-09-01T12:00:00Z';
class Clock extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return Date.parse(now); } }
const api = vm.createContext({
  __SPINSHARE_UI_CATALOG__: catalog, document, $: node, Date: Clock, Intl,
  FIRST_UPLOAD_DATE: '2020-01-01', phase: 'idle', applied: null, appExiting: false,
  selectedTags: new Map([['piano', 'Piano']]), loadingIndicator() {}, syncResultTools() {},
  syncTagControls() {}, scheduleChartTagsRefresh() {}, scheduleChartDescriptions() {}, syncCatalogRefresh() {},
  addEventListener: (name, callback) => viewportEvents.set(name, callback),
  fetch() { assert.fail('Opening or editing dates must not request chart data'); },
});
vm.runInContext([
  extract('const UI_CATALOG=', 'async function saveLanguage('),
  extract('function readDifficulty(', 'function syncResultTools('),
  extract('function syncFilters(', 'function cancelQuery('),
  extract('function validDate(', 'function titleKey('),
  extract('function element(', 'function countValue('),
  extract("$('date-preset').addEventListener('change',applyDatePreset);", "for(const input of document.querySelectorAll('input[name=\"diff\"],#min,#max'))"),
].join('\n'), api);
node('min').value = '0'; node('max').value = '99'; node('date-preset').value = 'custom';
node('date-fields').append(node('custom-dates'));
for (const id of ['date-from', 'date-to']) {
  const field = new Element(), control = new Element(), label = new Element('label');
  field.className = 'field'; control.className = 'date-control'; label.setAttribute('for', id);
  control.append(node(id), node(id + '-open'), node(id + '-picker'));
  field.append(label, control); node('custom-dates').append(field);
}
for (const id of ['date-from-picker', 'date-to-picker']) {
  node(id).showPicker = () => assert.fail('Do not reopen the native calendar');
  node(id).click = () => assert.fail('Do not reopen the native calendar');
}
const calendar = () => node('date-calendar');
const days = () => calendar().querySelector('.calendar-days').children;
const day = value => days().find(button => button.dataset.date === value);
const focused = () => document.activeElement.dataset.date;
function open(id, value) {
  api.closeDateCalendar(); node(id).value = value; node('date-preset').value = 'custom'; api.syncDates(); node(id + '-open').click();
  assert(calendar().matches(':popover-open'));
  const control = node(id + '-open').closest('.date-control');
  assert(calendar().parentElement === control.parentElement, 'The calendar must belong to the active endpoint field');
  assert(control.parentElement.children[control.parentElement.children.indexOf(control) + 1] === calendar(), 'The calendar follows its date control in DOM order');
  assert(!control.contains(calendar()), 'Calendar buttons must not inherit date-control descendant styling');
  assert.equal(days().length, 42);
  assert.equal(days().filter(button => button.tabIndex === 0).length, 1);
  assert.equal(document.activeElement.disabled, false);
}
function key(value, shiftKey = false) {
  const event = document.activeElement.emit('keydown', {key: value, shiftKey});
  assert(event.defaultPrevented, `${value} must not scroll the document`);
}
function select(name, value) {
  const control = calendar().querySelector('.calendar-' + name); control.focus(); control.value = String(value); control.emit('change');
  assert.strictEqual(document.activeElement, control, 'Changing a month or year must leave the select usable');
}

// These UTC instants fall on the following Berlin date in winter and summer.
now = '2024-01-31T23:30:00Z'; assert.equal(api.siteToday(), '2024-02-01');
now = '2024-06-30T22:30:00Z'; assert.equal(api.siteToday(), '2024-07-01');
now = '2026-09-01T12:00:00Z';
assert(api.validDate('2024-02-29')); assert.equal(api.validDate('2023-02-29'), false);
assert.equal(api.validDate('2024-02-30'), false); assert.equal(api.validDate('2024-2-09'), false);

// Month/year navigation clamps the day, including leap years and December rollover.
open('date-from', '2024-01-31'); key('PageDown'); assert.equal(focused(), '2024-02-29');
key('PageDown', true); assert.equal(focused(), '2025-02-28');
open('date-from', '2023-12-31'); key('PageDown'); assert.equal(focused(), '2024-01-31');
open('date-from', '2024-03-31'); key('PageUp'); assert.equal(focused(), '2024-02-29');
select('year', 2025); assert.equal(calendar().querySelector('[tabindex="0"]').dataset.date, '2025-02-28');
select('month', 11); assert.equal(calendar().querySelector('[tabindex="0"]').dataset.date, '2025-12-28');
select('year', 2026); assert.equal(calendar().querySelector('[tabindex="0"]').dataset.date, '2026-09-01');
assert(calendar().querySelector('.calendar-month').children[9].disabled, 'October is unavailable before it occurs');
open('date-from', '2024-02-29'); key('ArrowRight'); assert.equal(focused(), '2024-03-01');
key('ArrowDown'); assert.equal(focused(), '2024-03-08'); key('Home'); assert.equal(focused(), '2024-03-04');
key('End'); assert.equal(focused(), '2024-03-10'); key('ArrowUp'); assert.equal(focused(), '2024-03-03');

// Both month buttons and keyboard navigation respect the same global bounds.
open('date-from', '2020-01-01');
assert.equal(days()[0].dataset.date, '2019-12-30', 'The first column is Monday');
assert(day('2019-12-31').disabled); assert(calendar().querySelectorAll('.calendar-nav')[0].disabled);
key('ArrowLeft'); assert.equal(focused(), '2020-01-01'); key('PageUp'); assert.equal(focused(), '2020-01-01');
open('date-to', api.siteToday());
assert(day('2026-09-02').disabled); assert(calendar().querySelectorAll('.calendar-nav')[1].disabled);
key('ArrowRight'); assert.equal(focused(), '2026-09-01'); key('PageDown'); assert.equal(focused(), '2026-09-01');
assert.equal(day('2026-09-01').getAttribute('aria-current'), 'date');
for (const id of ['date-from-picker', 'date-to-picker']) {
  assert.equal(node(id).getAttribute('min'), '2020-01-01'); assert.equal(node(id).getAttribute('max'), '2026-09-01');
}

// Keyboard confirmation must work without relying on a host-synthesized click.
for (const [field, other, confirmKey] of [['date-from', 'date-to', 'Enter'], ['date-to', 'date-from', ' ']]) {
  const otherValue = field === 'date-from' ? '2024-03-02' : '2024-02-28';
  node(other).value = otherValue; open(field, '2024-02-28');
  key('ArrowRight'); assert.equal(focused(), '2024-02-29'); key(confirmKey);
  assert.equal(node(field).value, '2024-02-29'); assert.equal(node(other).value, otherValue);
  assert.equal(node(field + '-picker').value, '2024-02-29'); assert.equal(node('date-preset').value, 'custom');
  assert.equal(calendar().open, false); assert.strictEqual(document.activeElement, node(field + '-open'));
  assert.equal(document.activeElement.focusOptions.preventScroll, true);
}

// Choosing a day preserves the opposite endpoint, tags, and the first filter action.
node('date-to').value = '2024-03-02'; open('date-from', '2024-02-28');
assert(day('2024-02-29').classList.contains('is-in-range'));
assert.equal(day('2024-02-28').getAttribute('aria-pressed'), 'true');
day('2024-02-29').click();
assert.equal(node('date-from').value, '2024-02-29'); assert.equal(node('date-to').value, '2024-03-02');
assert.equal(node('date-from-picker').value, '2024-02-29'); assert.equal(node('date-preset').value, 'custom');
assert.equal(calendar().open, false); assert.strictEqual(document.activeElement, node('date-from-open'));
assert.equal(document.activeElement.focusOptions.preventScroll, true); assert.equal(node('apply-filters').disabled, false);
assert.deepEqual([...api.selectedTags], [['piano', 'Piano']]); assert.equal(api.applied, null);
open('date-to', '2024-03-02'); calendar().querySelector('.calendar-clear').click();
assert.equal(node('date-to').value, ''); assert.equal(api.readCriteria().dateFrom, '2024-02-29');
open('date-to', ''); calendar().querySelector('.calendar-today').click(); assert.equal(node('date-to').value, '2026-09-01');
node('date-from').value = ''; node('date-to').value = '2024-02-29'; assert.equal(api.readCriteria().dateFrom, '');

// Hand entry is unchanged: partial text is kept, change trims, and validation stays explicit.
node('date-to').value = '';
for (const value of ['2024-02-', '2024-02-30', '2019-12-31', '2026-09-02']) {
  node('date-from').value = value; node('date-from').emit('input');
  assert.equal(node('date-from').value, value);
  assert.throws(() => api.readCriteria(), /Choose dates between 2020-01-01 and today/);
  open('date-from', value); key('Escape'); assert.equal(node('date-from').value, value);
}
node('date-from').value = ' 2024-02-29 '; node('date-from').emit('input');
assert.equal(node('date-from').value, ' 2024-02-29 '); assert.equal(node('date-from-picker').value, '2024-02-29');
node('date-from').emit('change'); assert.equal(api.readCriteria().dateFrom, '2024-02-29');
node('date-to').value = '2024-02-28'; assert.throws(() => api.readCriteria(), /start no later than the end/);
node('date-preset').value = 'all'; node('date-preset').emit('change');
assert.equal(node('date-from').value, ''); assert.equal(node('date-to').value, '');
assert.equal(api.presetDates('month', '2024-03-31').from, '2024-03-01');
assert.equal(api.presetDates('7', '2020-01-03').from, '2020-01-01');

// The shared popover relabels, retains dates and focus, and stays inside a narrow viewport.
open('date-from', '2024-02-29');
const beforeLabel = day('2024-02-29').getAttribute('aria-label');
api.setUILanguage('en');
assert.equal(calendar().querySelector('.calendar-context').textContent, 'Choose start date');
assert.equal(calendar().querySelector('.calendar-month').children[1].textContent, 'February');
assert.equal(calendar().querySelector('.calendar-weekdays').children[0].textContent, 'Mon');
assert.equal(day('2024-02-29').getAttribute('aria-label'), 'Thursday, February 29, 2024');
assert.notEqual(day('2024-02-29').getAttribute('aria-label'), beforeLabel);
assert.equal(node('date-from').value, '2024-02-29'); assert.equal(focused(), '2024-02-29');
document.documentElement.clientWidth = 280; viewportEvents.get('resize')();
assert.equal(calendar().style.width, '256px'); assert.equal(calendar().style.left, '12px');
const sharedPanel = calendar();
node('date-to-open').click();
assert.strictEqual(calendar(), sharedPanel); assert.equal(document.body.querySelectorAll('.date-calendar').length, 1);
assert.strictEqual(sharedPanel.parentElement, node('date-to').closest('.field'));
assert.equal(node('date-from').closest('.field').contains(sharedPanel), false);
assert.equal(sharedPanel.open, true, 'Switching endpoints reopens the same panel after moving it');
assert(calendarMoves.length >= 2 && calendarMoves.every(move => move.node === sharedPanel && !move.wasOpen), 'Only the shared, closed panel is reparented');
assert.equal(node('date-to-open').getAttribute('aria-expanded'), 'true');
assert.equal(node('date-from-open').getAttribute('aria-expanded'), 'false');
assert.equal(calendar().querySelector('.calendar-context').textContent, 'Choose end date');
api.appExiting = true; api.syncFilters(); assert.equal(calendar().open, false);
node('date-from-open').click(); assert.equal(calendar().open, false, 'Exiting must not reopen the calendar');
assert.equal(node('date-fields').disabled, true);
console.log('PASS: calendar navigation, Berlin date bounds, leap years, open ranges, manual input, focus, language and offline filtering.');
