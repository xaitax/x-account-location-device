/** First-paint and enrichment regressions using the production controller, with no network/browser session. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { parseAst } from 'rollup/parseAst';
import { LRUCache } from '../src/shared/lru-cache.js';
import { CACHE_CONFIG, MESSAGE_TYPES, SELECTORS } from '../src/shared/constants.js';
import { parseAccountResponse } from '../src/shared/account-response.js';
import { resolveCardAvatar } from '../src/content/hovercard-avatar.js';

const source = fs.readFileSync(new URL('../src/content/hovercard.js', import.meta.url), 'utf8');
const declarations = parseAst(source).body.map(node => node.type === 'ExportNamedDeclaration' ? node.declaration : node);
const helperBoundary = declarations.find(node => node?.type === 'FunctionDeclaration' && node.id.name === 'isSafeHttpsUrl').start;
const helpers = declarations.filter(node => node?.start < helperBoundary &&
    ['FunctionDeclaration', 'VariableDeclaration'].includes(node.type));
const controller = declarations.filter(node =>
    (node?.type === 'ClassDeclaration' && node.id.name === 'HovercardController') ||
    (node?.type === 'VariableDeclaration' && node.declarations.some(declaration =>
        ['TOUCH', 'HOVER_INTENT_MS'].includes(declaration.id.name))));
assert.equal(controller.length, 3, 'Extract the real controller and delay/device policy');
for (const name of ['hasRichMetadata', 'metadataObservedAt', 'hasUsableMetadata', 'selectKnownHovercardInfo', 'mergeHovercardInfo']) {
    assert.ok(helpers.some(node => node.type === 'FunctionDeclaration' && node.id.name === name),
        `Exercise the production ${name} policy`);
}
const production = [...helpers, ...controller].map(node => source.slice(node.start, node.end)).join('\n');
const epoch = 1800000000000;
const rich = (timestamp = epoch, overrides = {}) => ({
    ...parseAccountResponse({ data: { user_result_by_screen_name: { result: {
        core: { screen_name: 'example', name: 'Example', created_at: '2011-10-12' }, rest_id: '123',
        about_profile: { account_based_in: 'Switzerland', source: 'Switzerland App Store', location_accurate: true },
        is_blue_verified: true, verification_info: { reason: { verified_since_msec: '1323727113221' } }
    } } } }, 'example'),
    timestamp, metaTimestamp: timestamp, metaExpiresAt: timestamp + CACHE_CONFIG.EXPIRY_MS,
    fromCloud: false, ...overrides
});
const partial = (timestamp = epoch, overrides = {}) => ({
    location: 'Switzerland', device: 'Switzerland App Store', locationAccurate: true,
    timestamp, fromCloud: true, meta: { partial: true, restId: '123', affiliateUsername: null }, ...overrides
});

class Target {
    constructor() { this.listeners = new Map(); }
    addEventListener(type, callback) {
        if (!this.listeners.has(type)) this.listeners.set(type, new Set());
        this.listeners.get(type).add(callback);
    }
    removeEventListener(type, callback) { this.listeners.get(type)?.delete(callback); }
    dispatchEvent(event) {
        for (const callback of [...(this.listeners.get(event.type) || [])]) callback(event);
        return true;
    }
}
class Element extends Target {
    constructor(document, parent = null) {
        super(); this.document = document; this.parent = parent; this.isConnected = true; this.dataset = {};
        this.attributes = new Map(); const classes = new Set();
        this.classList = { add: value => classes.add(value), remove: value => classes.delete(value),
            contains: value => classes.has(value) };
    }
    setAttribute(name, value) { this.attributes.set(name, value); }
    contains(node) {
        for (let candidate = node; candidate; candidate = candidate.parent) if (candidate === this) return true;
        return false;
    }
    querySelector(selector) { return selector === '.x-badge-details' ? this.details : null; }
    matches(selector) { return selector === ':hover'; }
    closest() { return null; }
    replaceChildren() {}
    remove() { this.isConnected = false; }
    focus() { this.document.activeElement = this; }
}

function environment() {
    let now = epoch;
    let timerId = 0;
    const timers = new Map();
    const document = new Target(); document.hidden = false; document.activeElement = null;
    const window = new Target(); window.matchMedia = () => ({ matches: true });
    const card = new Element(document);
    document.getElementById = () => card;
    const paints = []; const requests = []; const events = [];
    class ClockDate extends Date { static now() { return now; } }
    class Event { constructor(type, options = {}) { this.type = type; Object.assign(this, options); } }
    document.addEventListener('xposed:authoritative-info', event => events.push(event.detail));
    const context = vm.createContext({
        window, document, LRUCache, CACHE_CONFIG, MESSAGE_TYPES, Date: ClockDate, CustomEvent: Event,
        resolveCardAvatar, getProfile: () => null,
        setTimeout: (callback, delay) => { const id = ++timerId; timers.set(id, { callback, at: now + delay }); return id; },
        clearTimeout: id => timers.delete(id), requestAnimationFrame: () => ++timerId, cancelAnimationFrame() {},
        queueMicrotask: callback => callback(), resolveDisplayNamePresentation: value => value,
        positionCard() {}, setLocationWarningHelp() {}, describeHovercardError: () => 'Mock failure',
        createCardTooltip: () => ({ refresh() {}, dismiss: () => false, dispose() {} }),
        buildCardContent: options => { paints.push(structuredClone({ info: options.info, loading: options.loading,
            errorText: options.errorText, screenName: options.screenName, displayName: options.displayName,
            avatar: options.avatar })); return card; },
        browserAPI: { runtime: { sendMessage: message => {
            assert.equal(message.type, MESSAGE_TYPES.FETCH_HOVERCARD_INFO, 'Only mock the real account-details transport');
            let resolve; const promise = new Promise(done => { resolve = done; });
            requests.push({ message, resolve }); return promise;
        } } }
    });
    vm.runInContext(production + '\nglobalThis.Controller = HovercardController;', context);
    const instance = new context.Controller();
    instance._createAllowlistState = () => null;
    instance._createImageState = () => ({ pending: false, controller: null, resetTimer: null });
    const badge = () => { const element = new Element(document); element.details = new Element(document, element); return element; };
    const open = (info, extras = {}) => {
        const anchor = extras.anchor || badge();
        instance.show(anchor, { screenName: 'example', displayName: 'Visible Example', info, ...extras });
        return anchor;
    };
    const respond = (data, index = requests.length - 1) => requests[index].resolve({ success: true, data });
    const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
    const advance = milliseconds => {
        const target = now + milliseconds;
        for (;;) {
            const next = [...timers].filter(([, timer]) => timer.at <= target)
                .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
            if (!next) break;
            now = next[1].at; timers.delete(next[0]); next[1].callback();
        }
        now = target;
    };
    return { instance, paints, requests, events, card, document, context, badge, open, respond, settle,
        advance, get now() { return now; } };
}

function attachAvatar(anchor, url, handle = 'example') {
    const article = { querySelectorAll: () => [container] };
    const owner = { dataset: { xScreenName: handle }, parentElement: article };
    const closest = selector => selector === SELECTORS.TWEET ? article : null;
    const container = {
        parentElement: article, closest, style: {}, matches: () => false,
        getAttribute: name => name === 'data-testid' ? `UserAvatar-Container-${handle}` : null,
        querySelectorAll: () => [image], contains: node => node === image || node === container
    };
    const image = {
        parentElement: container, isConnected: true, hidden: false, currentSrc: '', style: {}, closest,
        getClientRects: () => [{}], matches: () => false,
        getAttribute: name => name === 'src' ? url : null
    };
    anchor.closest = selector => selector === '[data-x-screen-name]' ? owner : closest(selector);
    return image;
}

let groups = 0;
async function check(name, action) {
    await action(); groups += 1; console.log(`PASS ${name}`);
}

await check('fresh full metadata appears on the first paint without account RPC or loading state', async () => {
    const e = environment(); e.open(rich());
    assert.equal(e.paints[0].info.meta.blueVerified, true);
    assert.equal(e.paints[0].info.meta.restId, '123');
    assert.equal(e.paints[0].loading, false);
    await e.settle(); assert.equal(e.requests.length, 0);
});

await check('the author avatar appears on first paint from existing DOM without an avatar or account lookup', async () => {
    const url = 'https://pbs.twimg.com/profile_images/123/example_bigger.jpg';
    for (const info of [rich(), partial()]) {
        const e = environment(); const anchor = e.badge(); attachAvatar(anchor, url);
        e.open(info, { anchor });
        assert.deepEqual(e.paints[0].avatar, { url, shape: 'circle' });
        const expectedRequests = info.meta.partial ? 1 : 0;
        assert.equal(e.requests.length, expectedRequests, 'Only normal incomplete-metadata enrichment may request details');
        if (expectedRequests) { e.respond(rich()); await e.settle(); }
        assert.deepEqual(e.paints.at(-1).avatar, { url, shape: 'circle' });
        assert.equal(e.requests.length, expectedRequests, 'Avatar display never creates a separate request');
    }
});

await check('fresh cached avatar metadata is available on first paint and does not force revalidation', async () => {
    const e = environment(); const known = rich();
    const url = 'https://pbs.twimg.com/profile_images/123/example_normal.png';
    Object.assign(known.meta, { avatarUrl: url, profileImageShape: 'Square' });
    e.instance.hoverCache.set('example', { data: known, fetchedAt: e.now });
    e.open(partial());
    assert.deepEqual(e.paints[0].avatar, { url, shape: 'square' });
    await e.settle(); assert.equal(e.requests.length, 0);
});

await check('fresh rich hover cache fills a partial badge immediately without RPC', async () => {
    const e = environment(); e.instance.hoverCache.set('example', { data: rich(), fetchedAt: e.now });
    e.open(partial());
    assert.equal(e.paints[0].info.meta.blueVerified, true);
    assert.equal(e.paints[0].loading, false);
    await e.settle(); assert.equal(e.requests.length, 0);
});

await check('61-second soft-stale rich metadata remains visible during quiet refresh', async () => {
    const e = environment(); e.open(rich(epoch - 61000));
    assert.equal(e.paints[0].info.meta.blueVerified, true);
    assert.equal(e.paints[0].loading, false);
    assert.equal(e.requests.length, 1);
    e.respond(rich()); await e.settle();
    assert.equal(e.paints.at(-1).info.meta.blueVerified, true);
    assert.equal(e.paints.at(-1).loading, false);
});

await check('partial updates cannot make retained rich metadata fresh by signal timestamp', async () => {
    const e = environment(); e.open(rich(epoch, { metaTimestamp: epoch - 61000 }));
    assert.equal(e.paints[0].loading, false);
    assert.equal(e.requests.length, 1, 'Revalidate using rich metadata age rather than signal age');
    e.respond(rich()); await e.settle();
});

await check('hard-expired metadata does not suppress enrichment or masquerade as complete', async () => {
    const e = environment(); e.open(rich(epoch - 1000, { metaExpiresAt: epoch }));
    assert.equal(e.paints[0].loading, true);
    assert.equal(e.requests.length, 1);
    e.respond(rich()); await e.settle();
    assert.equal(e.paints.at(-1).loading, false);
});

await check('unmarked lean metadata starts enrichment instead of being treated as full', async () => {
    for (const meta of [{}, { name: 'Example', restId: '123' }, { ...partial().meta, partial: false }]) {
        const e = environment(); e.open({ ...partial(), meta });
        assert.equal(e.paints[0].loading, true);
        assert.equal(e.requests.length, 1);
        e.respond(rich()); await e.settle();
    }
});

await check('known null and false fields are complete, not an invitation to repeat requests', async () => {
    const e = environment(); const known = rich();
    Object.assign(known.meta, { blueVerified: false, verified: false, identityVerified: false,
        verifiedType: null, verifiedSinceMsec: null, restId: null, avatarUrl: null });
    e.open(known); assert.equal(e.paints[0].loading, false);
    await e.settle(); assert.equal(e.requests.length, 0);
});

await check('getInfo supplies the latest same-account snapshot at opening, not the badge closure', async () => {
    const e = environment(); let current = partial(); const options = { getInfo: () => current };
    current = rich(); e.open(partial(epoch - 1000), options);
    assert.equal(e.paints[0].info.meta.blueVerified, true);
    assert.equal(e.paints[0].loading, false);
    await e.settle(); assert.equal(e.requests.length, 0);
});

await check('metadata arriving during the 300 ms intent is present on the first paint', async () => {
    const e = environment(); let current = partial(); const anchor = e.badge();
    e.instance.attach(anchor, { screenName: 'example', info: current, getInfo: () => current });
    anchor.dispatchEvent({ type: 'mouseenter' }); e.advance(299);
    assert.equal(e.paints.length, 0); assert.equal(e.requests.length, 0);
    current = rich(e.now); e.advance(1);
    assert.equal(e.paints[0].info.meta.blueVerified, true); assert.equal(e.paints[0].loading, false);
    await e.settle(); assert.equal(e.requests.length, 0);
});

await check('a failed quiet refresh preserves full metadata and does not replace it with an error card', async () => {
    const e = environment(); e.open(rich(epoch - 61000));
    e.requests[0].resolve({ success: false, error: 'Mock unavailable' }); await e.settle();
    assert.equal(e.paints.at(-1).info.meta.blueVerified, true);
    assert.equal(e.paints.at(-1).loading, false); assert.equal(e.paints.at(-1).errorText, '');
});

await check('validated older complete metadata reopens quietly without another runtime request until receipt expires', async () => {
    const e = environment(); const old = rich(epoch - 61000); e.open(old);
    assert.equal(e.requests.length, 1); e.respond(old); await e.settle();
    assert.equal(e.instance.hoverCache.get('example').data.metaTimestamp, epoch - 61000);
    e.instance.hide(); e.advance(1000); e.open(old);
    assert.equal(e.paints.at(-1).loading, false); assert.equal(e.requests.length, 1);
    e.instance.hide(); e.advance(60000); e.open(old);
    assert.equal(e.requests.length, 2, 'The revalidation receipt is short-lived, not a renewed metadata observation');
});

await check('partial and unknown-age responses never establish a skip-revalidation receipt', async () => {
    for (const info of [partial(), rich(epoch, { timestamp: null, metaTimestamp: null })]) {
        const e = environment(); e.open(info);
        assert.equal(e.requests.length, 1); e.respond(info); await e.settle();
        e.instance.hide(); e.advance(1000); e.open(info);
        assert.equal(e.requests.length, 2, 'Unknown/incomplete details must still be enriched');
    }
});

await check('a receipt for older metadata cannot suppress enrichment after the latest signal identity changes', async () => {
    const e = environment(); const old = rich(epoch - 61000); e.open(old);
    e.respond(old); await e.settle(); e.instance.hide(); e.advance(1000);
    e.open(partial(e.now, { location: 'United Kingdom', device: 'Web' }));
    assert.equal(e.requests.length, 2); assert.equal(e.paints.at(-1).loading, true);
    assert.equal(e.paints.at(-1).info.location, 'United Kingdom');
});

await check('newer changed location/device in getInfo wins over an older in-flight full response', async () => {
    const e = environment(); let current = partial(epoch - 1000);
    e.open(current, { getInfo: () => current });
    current = partial(epoch, { location: 'United Kingdom', device: 'Web' });
    e.respond(rich(epoch - 500)); await e.settle();
    const visible = e.paints.at(-1).info;
    assert.equal(visible.location, 'United Kingdom'); assert.equal(visible.device, 'Web');
    assert.notEqual(visible.meta?.blueVerified, true, 'Do not transplant verification from incompatible signals');
});

await check('changed stable IDs do not inherit another account full metadata from hover cache', async () => {
    for (const timestamp of [epoch, null]) {
        const e = environment(); e.instance.hoverCache.set('example', { data: rich(epoch - 100), fetchedAt: e.now });
        e.open(partial(timestamp, { meta: { partial: true, restId: '456' } }));
        assert.equal(e.paints[0].info.meta.restId, '456');
        assert.notEqual(e.paints[0].info.meta.blueVerified, true);
        assert.equal(e.paints[0].loading, true); assert.equal(e.requests.length, 1);
        e.respond(rich(epoch, { meta: { ...rich().meta, restId: '456' } })); await e.settle();
    }
});

await check('cloud-shaped null defaults keep all known rich fields and affiliation artwork on first paint', async () => {
    const e = environment(); const prior = rich(epoch - 1000);
    Object.assign(prior.meta, { usernameChanges: 0, affiliateUsername: 'PrimeVideo',
        affiliate: { name: 'Prime Video', badgeUrl: 'https://pbs.twimg.com/profile_images/example.png',
            url: 'https://x.com/PrimeVideo' } });
    e.instance.hoverCache.set('example', { data: prior, fetchedAt: epoch - 1000 });
    e.open(partial(epoch, { meta: { partial: true, restId: '123', createdAt: null,
        usernameChanges: null, affiliate: null, affiliateUsername: null } }));
    assert.deepEqual(e.paints[0].info.meta, prior.meta);
    assert.equal(e.paints[0].info.metaTimestamp, prior.metaTimestamp);
    assert.equal(e.paints[0].info.metaExpiresAt, prior.metaExpiresAt);
    assert.equal(e.paints[0].loading, false); await e.settle(); assert.equal(e.requests.length, 0);
});

await check('new shared metadata conflicts do not masquerade as a compatible complete projection', async () => {
    for (const change of [{ createdAt: '2012-01-01' }, { usernameChanges: 1 },
        { affiliate: { name: 'Another Organization' } }, { affiliateUsername: 'AnotherOrganization' }]) {
        const e = environment(); const prior = rich(epoch - 1000); prior.meta.usernameChanges = 0;
        e.instance.hoverCache.set('example', { data: prior, fetchedAt: epoch - 1000 });
        e.open(partial(epoch, { meta: { partial: true, restId: '123', ...change } }));
        assert.equal(e.paints[0].loading, true); assert.equal(e.requests.length, 1);
        assert.notEqual(e.paints[0].info.meta.blueVerified, true);
        e.respond(rich()); await e.settle();
    }
});

await check('late responses cannot redraw a different current account or torn-down session', async () => {
    const e = environment(); e.open(partial());
    const second = rich(); const url = 'https://pbs.twimg.com/profile_images/456/second_normal.png';
    second.meta.avatarUrl = url;
    e.open(second, { screenName: 'second' }); const paints = e.paints.length;
    assert.deepEqual(e.paints.at(-1).avatar, { url, shape: 'circle' });
    e.respond(rich(), 0); await e.settle(); assert.equal(e.paints.length, paints);
    assert.deepEqual(e.paints.at(-1).avatar, { url, shape: 'circle' }, 'Late account details cannot replace another account\'s avatar');
    const ended = environment(); ended.open(partial()); ended.instance.teardown();
    const afterTeardown = ended.paints.length; ended.respond(rich()); await ended.settle();
    assert.equal(ended.paints.length, afterTeardown); assert.equal(ended.instance.hoverCache.size, 0);
});

console.log(`Hover loading/data lifecycle checks passed (${groups} groups).`);
