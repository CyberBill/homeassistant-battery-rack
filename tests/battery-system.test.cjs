const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');

function setup() {
    const elements = new Map();
    const timers = new Map();
    const listeners = new Map();
    let now = Date.parse('2026-10-20T12:00:00Z');
    const context = {
        HTMLElement: class {
            attachShadow() {
                this.shadowRoot = { innerHTML: '', querySelector: () => null };
            }
        },
        customElements: { define: (name, element) => elements.set(name, element) },
        Date: class extends Date { static now() { return now; } },
        document: {
            hidden: false,
            addEventListener: (name, listener) => listeners.set(name, listener),
            removeEventListener: (name, listener) => {
                if (listeners.get(name) === listener) listeners.delete(name);
            },
        },
        window: {
            setInterval: (callback) => { timers.set(callback, callback); return callback; },
            clearInterval: (id) => timers.delete(id),
        },
    };
    vm.runInNewContext(readFileSync(require.resolve('../battery-system.js'), 'utf8'), context);
    const card = new (elements.get('battery-rack-card'))();
    card.setConfig({ serial: 'example', last_active_entity: 'sensor.last_active' });
    const hass = (state) => ({ states: { 'sensor.last_active': { state } } });
    return { card, hass, timers, listeners, context, advance: (ms) => { now += ms; } };
}

test('an initially offline card recovers when only its heartbeat changes', () => {
    const { card, hass } = setup();
    card.hass = hass('unavailable');
    assert.match(card.shadowRoot.innerHTML, /OFFLINE/);
    card.hass = hass('2026-10-20T12:00:00Z');
    assert.doesNotMatch(card.shadowRoot.innerHTML, /OFFLINE/);
});

test('idle cards expire and recover after background-tab resume', () => {
    const { card, hass, timers, listeners, context, advance } = setup();
    card.hass = hass('2026-10-20T12:00:00Z');
    card.connectedCallback();
    advance(120_001);
    context.document.hidden = false;
    listeners.get('visibilitychange')();
    assert.match(card.shadowRoot.innerHTML, /OFFLINE/);
    card.hass = hass('2026-10-20T12:02:00Z');
    assert.doesNotMatch(card.shadowRoot.innerHTML, /OFFLINE/);
    advance(120_000);
    for (const callback of timers.values()) callback();
    assert.match(card.shadowRoot.innerHTML, /OFFLINE/);
    card.disconnectedCallback();
    assert.equal(timers.size, 0);
    assert.equal(listeners.size, 0);
    card.connectedCallback();
    assert.equal(timers.size, 1);
    assert.equal(listeners.size, 1);
});

test('missing and invalid heartbeats stay offline; empty slots stay empty', () => {
    const { card, hass } = setup();
    for (const state of [undefined, 'unknown', 'unavailable', 'invalid']) {
        card.hass = hass(state);
        assert.match(card.shadowRoot.innerHTML, /OFFLINE/);
    }
    card.setConfig({ empty: true, position: 'C1' });
    assert.match(card.shadowRoot.innerHTML, /EMPTY/);
    assert.doesNotMatch(card.shadowRoot.innerHTML, /OFFLINE/);
});
