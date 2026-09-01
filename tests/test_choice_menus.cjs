'use strict';

// Offline interaction checks for the production choice-menu enhancement.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../web/app.js'), 'utf8');
const styles = fs.readFileSync(path.join(__dirname, '../web/interface.css'), 'utf8');
const start = source.indexOf('function element(');
const end = source.indexOf('function countValue(', start);
assert(start >= 0 && end > start, 'The production choice-menu controller must exist');

const nodes = new Map();
const observers = [];
class Element {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase(); this.children = []; this.parentElement = null;
    this.attributes = new Map(); this.events = new Map(); this.dataset = {}; this.style = {};
    this.className = ''; this.disabled = false; this.open = false; this._textContent = '';
    this._value = ''; this.rect = null; this.naturalWidth = 220; this.naturalHeight = 132;
    this.classList = {
      contains: name => this.className.split(/\s+/).includes(name),
      add: (...names) => { const values = new Set(this.className.split(/\s+/).filter(Boolean)); for (const name of names) values.add(name); this.className = [...values].join(' '); },
      toggle: (name, force) => {
        const values = new Set(this.className.split(/\s+/).filter(Boolean));
        const enabled = force === undefined ? !values.has(name) : Boolean(force);
        if (enabled) values.add(name); else values.delete(name); this.className = [...values].join(' '); return enabled;
      },
    };
  }
  set id(value) { this._id = String(value); nodes.set(this._id, this); }
  get id() { return this._id || ''; }
  set textContent(value) { for (const child of this.children) child.parentElement = null; this.children = []; this._textContent = String(value ?? ''); }
  get textContent() { return this._textContent + this.children.map(child => child.textContent).join(''); }
  set value(value) { this._value = String(value); }
  get value() { return this._value; }
  set tabIndex(value) { this.setAttribute('tabindex', value); }
  get tabIndex() {
    if (this.getAttribute('tabindex') !== null) return Number(this.getAttribute('tabindex'));
    return ['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA'].includes(this.tagName) || this.tagName === 'A' && this.hasAttribute('href') ? 0 : -1;
  }
  get parentNode() { return this.parentElement; }
  get options() { return this.tagName === 'SELECT' ? this.children.filter(child => child.tagName === 'OPTION') : undefined; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  hasAttribute(name) { return this.attributes.has(name); }
  removeAttribute(name) { this.attributes.delete(name); }
  remove() {
    if (!this.parentElement) return;
    const siblings = this.parentElement.children, index = siblings.indexOf(this);
    if (index >= 0) siblings.splice(index, 1); this.parentElement = null;
  }
  append(...children) { for (const child of children) { child.remove(); child.parentElement = this; this.children.push(child); } }
  insertBefore(child, reference) {
    assert(this.children.includes(reference), 'insertBefore() requires a child reference'); child.remove();
    const index = this.children.indexOf(reference); child.parentElement = this; this.children.splice(index, 0, child); return child;
  }
  replaceChildren(...children) { for (const child of this.children) child.parentElement = null; this.children = []; this._textContent = ''; this.append(...children); }
  before(child) {
    assert(this.parentElement, 'before() requires a parent'); child.remove();
    const index = this.parentElement.children.indexOf(this); child.parentElement = this.parentElement;
    this.parentElement.children.splice(index, 0, child);
  }
  contains(node) { return this === node || this.children.some(child => child.contains(node)); }
  matches(selector) {
    if (selector.includes(',')) return selector.split(',').some(value => this.matches(value.trim()));
    if (selector === ':popover-open') return this.open;
    if (selector === '.choice-option:not(:disabled)') return this.classList.contains('choice-option') && !this.disabled;
    if (selector.startsWith('.')) return this.classList.contains(selector.slice(1));
    if (selector === '[popover]') return this.hasAttribute('popover');
    if (selector === '[tabindex]') return this.hasAttribute('tabindex');
    if (selector === 'a[href]') return this.tagName === 'A' && this.hasAttribute('href');
    return this.tagName === selector.toUpperCase();
  }
  querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  closest(selector) {
    if (selector.includes(',')) return selector.split(',').map(value => value.trim()).find(value => this.matches(value)) ? this : this.parentElement?.closest(selector);
    return this.matches(selector) ? this : this.parentElement?.closest(selector);
  }
  addEventListener(name, callback) { if (!this.events.has(name)) this.events.set(name, []); this.events.get(name).push(callback); }
  emit(name, details = {}) {
    const event = {target: this, bubbles: true, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, ...details};
    for (let target = this; target; target = event.bubbles && !event.stopped ? target.parentElement : null) {
      for (const callback of target.events.get(name) || []) callback(event);
    }
    return event;
  }
  dispatchEvent(event) { return !this.emit(event.type, event).defaultPrevented; }
  click() { if (!this.disabled) this.emit('click'); }
  focus(options) { document.activeElement = this; this.focusOptions = options; }
  showPopover() { if (!this.open) { this.open = true; this.emit('toggle', {newState: 'open'}); } }
  hidePopover() { if (this.open) { this.open = false; this.emit('toggle', {newState: 'closed'}); } }
  getBoundingClientRect() {
    if (this.rect) return this.rect;
    const parsed = parseFloat(this.style.width);
    return {left: 0, top: 0, bottom: this.naturalHeight, width: Number.isFinite(parsed) ? parsed : this.naturalWidth, height: this.naturalHeight};
  }
}
class MutationObserver {
  constructor(callback) { this.callback = callback; observers.push(this); }
  observe(target, options) { this.target = target; this.options = options; }
}
class FakeEvent { constructor(type, options = {}) { this.type = type; Object.assign(this, options); } }
const document = {
  body: new Element('body'), activeElement: null,
  createElement: tag => new Element(tag), createElementNS: (_, tag) => new Element(tag),
  querySelectorAll: selector => document.body.querySelectorAll(selector),
};
function node(id, tag = 'div', text = '') {
  const element = new Element(tag); element.id = id; element.textContent = text; document.body.append(element); return element;
}
function option(value, text, disabled = false) { const item = new Element('option'); item.value = value; item.textContent = text; item.disabled = disabled; return item; }

const viewportEvents = new Map();
const context = {
  document, MutationObserver, Event: FakeEvent, uiLanguage: 'en',
  innerWidth: 800, innerHeight: 600,
  $: id => nodes.get(id) || null, m: value => value, uiText: (target, value) => { target.textContent = value; },
  queueMicrotask: callback => callback(), clearTimeout, setTimeout,
  requestAnimationFrame: callback => { callback(); return 1; },
  addEventListener: (name, callback) => viewportEvents.set(name, callback),
};
context.globalThis = context;
const api = vm.createContext(context);
vm.runInContext(source.slice(start, end), api);

const previous = node('previous-control', 'button', 'Previous');
const label = node('installation-filter-label', 'span', 'Installation status');
const message = node('installation-filter-message', 'span', 'Local installation state');
const select = node('installation-filter', 'select');
select.setAttribute('data-choice-menu', ''); select.setAttribute('aria-labelledby', label.id); select.setAttribute('aria-describedby', message.id);
select.append(option('all', 'All'), option('installed', 'Installed only'), option('uninstalled', 'Not installed only'), option('blocked', 'Unavailable', true));
select.value = 'all';
const next = node('next-control', 'button', 'Next');

const view = api.enhanceChoiceSelect(select);
const choices = () => view.menu.querySelectorAll('.choice-option');
const choice = value => choices().find(item => item.dataset.value === value);

// Initial enhancement exposes the key and current value as one accessible name.
assert.equal(view.value.textContent, 'All');
assert.equal(view.button.getAttribute('aria-labelledby'), 'installation-filter-label installation-filter-choice-value');
assert.equal(view.button.getAttribute('aria-describedby'), 'installation-filter-message');
assert.equal(view.menu.getAttribute('aria-label'), 'Installation status');
assert.equal(view.button.getAttribute('aria-expanded'), 'false');
assert.equal(select.getAttribute('aria-hidden'), 'true');
assert.equal(select.tabIndex, -1);
assert.equal(choice('all').getAttribute('aria-selected'), 'true');
assert(choice('all').classList.contains('is-selected'));
assert.equal(choice('blocked').disabled, true);

// Pointer and keyboard activation use the same open state without native select chrome.
view.button.click(); assert(view.menu.open); assert.equal(view.button.getAttribute('aria-expanded'), 'true'); assert(view.button.classList.contains('is-open'));
view.button.click(); assert.equal(view.menu.open, false); assert.equal(view.button.getAttribute('aria-expanded'), 'false');
let event = view.button.emit('keydown', {key: 'Enter'}); assert(event.defaultPrevented); assert(view.menu.open); assert.strictEqual(document.activeElement, choice('all'));
event = view.menu.emit('keydown', {key: 'Escape'}); assert(event.defaultPrevented && event.stopped); assert.equal(view.menu.open, false); assert.strictEqual(document.activeElement, view.button);
event = view.button.emit('keydown', {key: ' '}); assert(event.defaultPrevented); assert(view.menu.open); view.button.emit('keydown', {key: ' '}); assert.equal(view.menu.open, false);

// Tab closes the detached popover and follows the trigger's real document order.
api.openChoice(view, 0); event = view.menu.emit('keydown', {key: 'Tab', shiftKey: false});
assert(event.defaultPrevented); assert.equal(view.menu.open, false); assert.strictEqual(document.activeElement, next);
api.openChoice(view, 0); event = view.menu.emit('keydown', {key: 'Tab', shiftKey: true});
assert(event.defaultPrevented); assert.equal(view.menu.open, false); assert.strictEqual(document.activeElement, previous);

// Arrow keys, Home, and End move among enabled options and wrap at both edges.
view.button.emit('keydown', {key: 'ArrowUp'}); assert.strictEqual(document.activeElement, choice('uninstalled'));
view.menu.emit('keydown', {key: 'Home'}); assert.strictEqual(document.activeElement, choice('all'));
view.menu.emit('keydown', {key: 'End'}); assert.strictEqual(document.activeElement, choice('uninstalled'));
view.menu.emit('keydown', {key: 'ArrowDown'}); assert.strictEqual(document.activeElement, choice('all'));
view.menu.emit('keydown', {key: 'ArrowUp'}); assert.strictEqual(document.activeElement, choice('uninstalled'));

// Repeating one initial cycles matching values instead of building an impossible "pp" query.
select.options[1].textContent = 'Past day'; select.options[2].textContent = 'Past week'; api.syncChoiceMenus(true);
choice('all').focus(); view.menu.emit('keydown', {key: 'p'}); assert.strictEqual(document.activeElement, choice('installed'));
view.menu.emit('keydown', {key: 'p'}); assert.strictEqual(document.activeElement, choice('uninstalled'));
select.options[1].textContent = 'Installed only'; select.options[2].textContent = 'Not installed only'; api.syncChoiceMenus(true);

// Re-selecting the same value closes silently; a new value emits exactly one change.
let changes = 0; select.addEventListener('change', () => changes++);
choice('all').click(); assert.equal(changes, 0); assert.equal(select.value, 'all'); assert.equal(view.menu.open, false);
api.openChoice(view, null); choice('installed').click();
assert.equal(changes, 1); assert.equal(select.value, 'installed'); assert.equal(view.value.textContent, 'Installed only');
api.openChoice(view, null); assert.equal(choice('installed').getAttribute('aria-selected'), 'true');

// Native disabled state and programmatic values remain the single source of truth.
select.disabled = true; observers[0].callback();
assert.equal(view.button.disabled, true); assert.equal(view.menu.open, false);
select.disabled = false; observers[0].callback(); select.value = 'uninstalled'; api.syncChoiceMenus(true);
assert.equal(view.button.disabled, false); assert.equal(view.value.textContent, 'Not installed only'); assert.equal(changes, 1, 'Programmatic synchronization must not invent a change event');
assert.equal(choice('uninstalled').getAttribute('aria-selected'), 'true');

// Relocalization rebuilds the trigger, menu label, and open option text in place.
label.textContent = '安装状态'; select.options[0].textContent = '全部'; select.options[1].textContent = '仅已安装'; select.options[2].textContent = '仅未安装';
api.openChoice(view, null); api.syncChoiceMenus(true);
assert.equal(view.menu.getAttribute('aria-label'), '安装状态'); assert.equal(view.value.textContent, '仅未安装');
assert.equal(choice('all').textContent.trim(), '全部'); assert.equal(choice('uninstalled').textContent.trim(), '仅未安装'); assert(view.menu.open);

// Position below when space permits, flip above near the viewport bottom.
view.button.rect = {left: 100, top: 80, bottom: 116, width: 160, height: 36}; api.positionChoiceMenu(view);
assert.equal(view.menu.style.left, '100px'); assert.equal(view.menu.style.top, '123px'); assert.equal(view.menu.style.width, '220px');
view.button.rect = {left: 100, top: 500, bottom: 536, width: 160, height: 36}; api.positionChoiceMenu(view);
assert.equal(view.menu.style.top, '361px', 'The menu must flip above its trigger instead of crossing the viewport edge');

// Every responsive rule keeps enough inline space for its longest English value;
// the detached menu already grows to max-content in positionChoiceMenu().
for (const [selector, minimum] of [['installation-filter-control', 160], ['sort-field', 148], ['direction-field', 120]]) {
  const rules = [...styles.matchAll(new RegExp(`\\.${selector}\\s*\\{([^}]*)\\}`, 'g'))];
  assert(rules.length, `Missing ${selector} sizing rule`);
  for (const [, declarations] of rules) {
    const widths = [...declarations.matchAll(/(?:^|;)\s*(?:min-)?width:\s*(\d+)px/g)].map(match => Number(match[1]));
    assert(widths.some(width => width >= minimum), `${selector} can truncate its longest English choice: ${declarations.trim()}`);
  }
}
assert.match(source, /menu\.style\.width='max-content'/, 'Open choice menus must measure their complete option labels');

console.log('choice menus: PASS');
