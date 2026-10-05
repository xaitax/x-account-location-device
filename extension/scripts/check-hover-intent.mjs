/**
 * Exercise the production hovercard controller with a deterministic clock and
 * small DOM doubles. No browser session, requests, clipboard or downloads.
 * Run with node scripts/check-hover-intent.mjs.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { parseAst } from 'rollup/parseAst';
import { LRUCache } from '../src/shared/lru-cache.js';

const source = fs.readFileSync(new URL('../src/content/hovercard.js', import.meta.url), 'utf8');
const declarations = parseAst(source).body.filter(node =>
    (node.type === 'ClassDeclaration' && node.id.name === 'HovercardController') ||
    (node.type === 'VariableDeclaration' && node.declarations.some(declaration =>
        ['TOUCH', 'HOVER_INTENT_MS'].includes(declaration.id.name))));
assert.equal(declarations.length, 3, 'Test the production controller and its actual hover delay');
const controllerSource = declarations.map(node => source.slice(node.start, node.end)).join('\n');

class EventTargetDouble {
    constructor() { this.listeners = new Map(); }
    addEventListener(type, listener) {
        if (!this.listeners.has(type)) this.listeners.set(type, new Set());
        this.listeners.get(type).add(listener);
    }
    removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
    dispatch(type, extras = {}) {
        const event = { type, target: this, detail: 1, prevented: false, stopped: false,
            preventDefault() { this.prevented = true; },
            stopPropagation() { this.stopped = true; }, ...extras };
        for (const listener of [...(this.listeners.get(type) || [])]) {
            if (this.listeners.get(type).has(listener)) listener(event);
        }
        return event;
    }
}

class ElementDouble extends EventTargetDouble {
    constructor(document, screenName = '') {
        super();
        this.document = document;
        this.screenName = screenName;
        this.dataset = {};
        this.attributes = new Map();
        this.isConnected = true;
        this.hovered = false;
        this.parent = null;
        const classes = new Set();
        this.classList = { add: name => classes.add(name), remove: name => classes.delete(name),
            contains: name => classes.has(name) };
    }
    setAttribute(name, value) { this.attributes.set(name, value); }
    contains(node) {
        for (let candidate = node; candidate; candidate = candidate.parent) {
            if (candidate === this) return true;
        }
        return false;
    }
    querySelector(selector) {
        if (selector === '.x-badge-details') return this.details || null;
        if (selector === '.x-posed-card-close') return this.close || null;
        return null;
    }
    closest(selector) {
        if (selector === '[data-x-screen-name]') return { dataset: { xScreenName: this.screenName } };
        return null;
    }
    matches(selector) { return selector === ':hover' && this.hovered; }
    replaceChildren() {}
    focus() { this.document.activeElement = this; }
    remove() { this.isConnected = false; }
    enter() { this.hovered = true; this.dispatch('mouseenter'); }
    leave() { this.hovered = false; this.dispatch('mouseleave'); }
}

function environment({ touch = false, clickOnly = false } = {}) {
    let time = 0;
    let nextId = 1;
    const timers = new Map();
    const document = new EventTargetDouble();
    document.activeElement = null;
    document.hidden = false;
    const window = new EventTargetDouble();
    window.matchMedia = () => ({ matches: !touch });
    const requests = [];
    const card = new ElementDouble(document);
    card.close = new ElementDouble(document);
    card.close.parent = card;
    document.getElementById = () => card;
    const context = vm.createContext({ window, document, LRUCache, CARD_ID: 'x-posed-hovercard',
        setTimeout: (callback, delay) => {
            const id = nextId++;
            timers.set(id, { callback, at: time + delay });
            return id;
        },
        clearTimeout: id => timers.delete(id),
        requestAnimationFrame: callback => {
            const id = nextId++;
            timers.set(id, { callback, at: time + 1 });
            return id;
        },
        cancelAnimationFrame: id => timers.delete(id),
        queueMicrotask: callback => callback(),
        resolveDisplayNamePresentation: value => value,
        positionCard() {}, setLocationWarningHelp() {},
        buildCardContent: () => card });
    vm.runInContext(`${controllerSource}\nglobalThis.Controller = HovercardController;`, context);
    const controller = new context.Controller();
    controller._createAllowlistState = () => null;
    controller._createImageState = () => ({ pending: false, controller: null, resetTimer: null });
    controller._fetchAndUpdate = (_anchor, screenName) => {
        requests.push(screenName);
        return Promise.resolve();
    };
    const options = screenName => ({ screenName, displayName: screenName, info: {} });
    const badge = screenName => {
        const node = new ElementDouble(document, screenName);
        node.details = new ElementDouble(document);
        node.details.parent = node;
        controller.attach(node, { ...options(screenName), clickToOpen: clickOnly });
        return node;
    };
    const advance = amount => {
        const target = time + amount;
        for (;;) {
            const next = [...timers].filter(([, timer]) => timer.at <= target)
                .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
            if (!next) break;
            time = next[1].at;
            timers.delete(next[0]);
            next[1].callback();
        }
        time = target;
    };
    const noIntentListeners = () => {
        for (const [target, types] of [[document, ['keydown', 'pointerdown', 'visibilitychange']],
            [window, ['scroll', 'resize', 'blur']]]) {
            for (const type of types) assert.equal(
                target.listeners.get(type)?.has(controller._handleHoverIntentCancel) || false,
                false, `Remove pending-only ${type} listener`);
        }
    };
    return { controller, document, window, requests, card, badge, advance, options,
        noIntentListeners, timers };
}

let groups = 0;
function check(name, run) {
    run();
    groups++;
    console.log(`PASS ${name}`);
}

check('300 ms hover intent gates both opening and rich requests', () => {
    const e = environment();
    const a = e.badge('alpha');
    a.enter(); e.advance(299);
    assert.equal(e.controller.card, null);
    assert.equal(e.requests.length, 0);
    e.advance(1);
    assert.equal(e.controller.currentAnchor, a);
    assert.deepEqual(e.requests, ['alpha']);
    assert.equal(a.details.attributes.get('aria-expanded'), 'true');
    e.noIntentListeners();
});

check('brief hover cancels opening without account requests', () => {
    const e = environment();
    const a = e.badge('alpha');
    a.enter(); e.advance(299); a.leave(); e.advance(1000);
    assert.equal(e.controller.card, null);
    assert.equal(e.requests.length, 0);
    assert.equal(a.details.attributes.get('aria-expanded'), 'false');
    e.noIntentListeners();
});

check('only the latest badge opens, even with a late old leave event', () => {
    const e = environment();
    const a = e.badge('alpha'); const b = e.badge('beta');
    a.enter(); e.advance(200); b.enter(); a.leave(); e.advance(299);
    assert.equal(e.requests.length, 0);
    e.advance(1);
    assert.deepEqual(e.requests, ['beta']);
    e.noIntentListeners();
});

check('a previous card close timer cannot cancel a new badge intent', () => {
    const e = environment();
    const a = e.badge('alpha'); const b = e.badge('beta');
    a.enter(); e.advance(300); a.leave(); b.enter(); e.advance(299);
    assert.equal(e.controller.currentAnchor, a);
    e.advance(1);
    assert.equal(e.controller.currentAnchor, b);
    assert.deepEqual(e.requests, ['alpha', 'beta']);
});

check('returning to the open badge immediately cancels closing', () => {
    const e = environment(); const a = e.badge('alpha');
    a.enter(); e.advance(300); a.leave(); e.advance(119); a.enter(); e.advance(500);
    assert.equal(e.controller.currentAnchor, a);
    assert.equal(e.controller.hoverIntent, null);
    assert.deepEqual(e.requests, ['alpha']);
});

check('badge-to-card travel retains the 120 ms grace', () => {
    const e = environment(); const a = e.badge('alpha');
    a.enter(); e.advance(300); a.leave(); e.advance(119); e.card.enter(); e.advance(500);
    assert.equal(e.controller.currentAnchor, a);
    e.card.leave(); e.advance(119);
    assert.equal(e.controller.currentAnchor, a);
    e.advance(1);
    assert.equal(e.controller.currentAnchor, null);
});

check('entering the current card cancels another pending badge', () => {
    const e = environment(); const a = e.badge('alpha'); const b = e.badge('beta');
    a.enter(); e.advance(300); a.leave(); b.enter(); e.advance(150); e.card.enter(); e.advance(500);
    assert.equal(e.controller.currentAnchor, a);
    assert.deepEqual(e.requests, ['alpha']);
    e.noIntentListeners();
});

check('direct click cancels waiting and pins immediately', () => {
    const e = environment(); const a = e.badge('alpha');
    a.enter(); e.advance(100); a.dispatch('click', { target: a.details });
    assert.equal(e.controller.currentAnchor, a);
    assert.equal(e.controller._clickMode, true);
    a.leave(); e.advance(500);
    assert.deepEqual(e.requests, ['alpha']);
    e.noIntentListeners();
});

check('keyboard activation opens immediately and focuses Close', () => {
    const e = environment(); const a = e.badge('alpha');
    a.dispatch('click', { target: a.details, detail: 0 });
    assert.equal(e.controller.currentAnchor, a);
    assert.equal(e.document.activeElement, e.card.close);
    assert.deepEqual(e.requests, ['alpha']);
});

check('touch and configured click-only mode never schedule hover', () => {
    for (const settings of [{ touch: true }, { clickOnly: true }]) {
        const e = environment(settings); const a = e.badge('alpha');
        a.enter(); e.advance(500);
        assert.equal(e.requests.length, 0);
        a.dispatch('click', { target: a.details });
        assert.deepEqual(e.requests, ['alpha']);
    }
});

check('Share activation cancels opening without toggling details', () => {
    const e = environment(); const a = e.badge('alpha');
    const share = { closest: selector => selector === '.x-capture-btn' ? {} : null };
    a.enter(); a.dispatch('click', { target: share }); e.advance(500);
    assert.equal(e.requests.length, 0);
    e.noIntentListeners();
});

check('Escape cancels unopened intent without consuming the key', () => {
    const e = environment(); const a = e.badge('alpha'); a.enter();
    const normalKey = e.document.dispatch('keydown', { key: 'ArrowDown' });
    assert.notEqual(e.controller.hoverIntent, null);
    assert.equal(normalKey.prevented, false);
    const escape = e.document.dispatch('keydown', { key: 'Escape' }); e.advance(500);
    assert.equal(escape.prevented, false); assert.equal(escape.stopped, false);
    assert.equal(e.requests.length, 0);
    e.noIntentListeners();
});

check('pointerdown, scroll, resize and window blur cancel pending intent', () => {
    for (const type of ['pointerdown', 'scroll', 'resize', 'blur']) {
        const e = environment(); const a = e.badge('alpha'); a.enter();
        (type === 'pointerdown' ? e.document : e.window).dispatch(type); e.advance(500);
        assert.equal(e.requests.length, 0, type);
        e.noIntentListeners();
    }
});

check('hidden documents cancel pending intent and refuse new scheduling', () => {
    const e = environment(); const a = e.badge('alpha'); a.enter();
    e.document.dispatch('visibilitychange');
    assert.notEqual(e.controller.hoverIntent, null, 'Visible change alone does not cancel');
    e.document.hidden = true; e.document.dispatch('visibilitychange'); e.advance(500);
    assert.equal(e.requests.length, 0);
    a.enter(); e.advance(500); assert.equal(e.controller.hoverIntent, null);
    e.noIntentListeners();
    const other = environment(); const b = other.badge('beta'); b.enter();
    other.document.hidden = true; other.advance(300);
    assert.equal(other.requests.length, 0, 'Timer also guards hidden state without an event');
    other.noIntentListeners();
});

check('disconnected, no-longer-hovered and stale-generation badges cannot open', () => {
    for (const invalidate of [(e, a) => { a.isConnected = false; },
        (e, a) => { a.hovered = false; }, e => { e.controller.generation++; }]) {
        const e = environment(); const a = e.badge('alpha'); a.enter(); invalidate(e, a); e.advance(500);
        assert.equal(e.requests.length, 0);
        e.noIntentListeners();
    }
});

check('failed new intent lets the old card close normally', () => {
    const e = environment(); const a = e.badge('alpha'); const b = e.badge('beta');
    a.enter(); e.advance(300); a.leave(); b.enter(); b.isConnected = false; e.advance(419);
    assert.equal(e.controller.currentAnchor, a);
    e.advance(1); assert.equal(e.controller.currentAnchor, null);
    assert.deepEqual(e.requests, ['alpha']);
    e.noIntentListeners();
});

check('hide and teardown cancel timers and all pending listeners', () => {
    for (const action of ['hide', 'teardown']) {
        const e = environment(); const a = e.badge('alpha'); a.enter();
        e.controller[action](); e.advance(500);
        assert.equal(e.requests.length, 0, action);
        assert.equal(e.timers.size, 0);
        e.noIntentListeners();
    }
});

check('replacement cancels the pending badge but not unrelated enrichment', () => {
    const e = environment(); const a = e.badge('alpha'); const b = e.badge('beta');
    a.enter(); e.controller.replaceAnchor(a, e.badge('alpha')); e.advance(500);
    assert.equal(e.requests.length, 0);
    a.enter(); e.advance(300); a.leave(); b.enter();
    const replacement = e.badge('alpha');
    e.controller.replaceAnchor(a, replacement); e.advance(300);
    assert.equal(e.controller.currentAnchor, b);
    assert.deepEqual(e.requests, ['alpha', 'beta']);
});

check('passing hover cannot interrupt a pinned, focused or exporting card', () => {
    for (const protect of [e => { e.controller._clickMode = true; },
        e => { e.document.activeElement = e.card.close; },
        (e, a) => { e.document.activeElement = a.details; },
        e => { e.controller.imageState.pending = true; }]) {
        const e = environment(); const a = e.badge('alpha'); const b = e.badge('beta');
        a.enter(); e.advance(300); protect(e, a); b.enter(); e.advance(500);
        assert.equal(e.controller.currentAnchor, a);
        assert.deepEqual(e.requests, ['alpha']);
        e.noIntentListeners();
        b.dispatch('click', { target: b.details });
        assert.equal(e.controller.currentAnchor, b, 'Deliberate click can still switch');
    }
});

check('protection acquired during the delay is checked again at delivery', () => {
    for (const protect of [e => { e.controller.imageState.pending = true; },
        e => { e.document.activeElement = e.card.close; }]) {
        const e = environment(); const a = e.badge('alpha'); const b = e.badge('beta');
        a.enter(); e.advance(300); b.enter(); protect(e); e.advance(500);
        assert.equal(e.controller.currentAnchor, a);
        assert.deepEqual(e.requests, ['alpha']);
        e.noIntentListeners();
    }
});

console.log(`Hover intent regression checks passed (${groups} groups).`);
