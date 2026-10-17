/**
 * Quick-filter regression checks against production storage and filter verdicts.
 * No browser, account API requests, clipboard writes or account mutations.
 * Run with node scripts/check-quick-filters.mjs.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { setImmediate } from 'node:timers';
import { parseAst } from 'rollup/parseAst';
import { DEFAULT_SETTINGS, MESSAGE_TYPES, STORAGE_KEYS, COUNTRY_LIST, REGION_NAMES, canonicalCountry, isRegion, GOVERNMENT_LABEL, normalizeAccountId, observedAccountId } from '../src/shared/constants.js';
import { FILTER_SOURCES } from '../src/shared/filter-registry.js';
import { prepareBackupImport } from '../src/shared/backup.js';
import { matchingBlockedRegions } from '../src/shared/region-membership.js';
import { ACCOUNT_COUNT_FILTERS, isAccountCountThreshold, matchesAccountCount } from '../src/shared/account-counts.js';
import { PROFILE_LIMITS, projectProfileUser, profilePatchFromWire, mergeProjectedProfile } from '../src/shared/profile-data.js';
import { setProfile, getProfile, clearProfiles } from '../src/content/profile-cache.js';
import { formatCountryName, getDeviceCountry } from '../src/shared/utils.js';
import { normalizePostRelation, projectPostRelation, collectPostRelations } from '../src/shared/post-relations.js';
import { configurePostRelations, mergePostRelationsBatch, getPostRelation, rememberPostRelation, clearPostRelations } from '../src/content/post-relations-cache.js';

function productionDeclarations(path, names) {
    const source = fs.readFileSync(new URL(path, import.meta.url), 'utf8');
    const declarations = parseAst(source).body.map(node => node.type === 'ExportNamedDeclaration' ? node.declaration : node);
    return names.map(name => {
        const declaration = declarations.find(node => ['FunctionDeclaration', 'ClassDeclaration'].includes(node?.type) && node.id.name === name);
        assert.ok(declaration, `Exercise the actual production ${name} declaration`);
        return source.slice(declaration.start, declaration.end);
    }).join('\n');
}

function nestedProductionDeclaration(path, name) {
    const source = fs.readFileSync(new URL(path, import.meta.url), 'utf8');
    let declaration;
    function visit(node) {
        if (!node || typeof node !== 'object') return;
        if (node.type === 'FunctionDeclaration' && node.id.name === name) declaration = node;
        if (node.type === 'VariableDeclaration' && node.declarations.some(item => item.id.name === name)) declaration = node;
        for (const child of Object.values(node)) {
            if (Array.isArray(child)) child.forEach(visit);
            else if (child && typeof child === 'object') visit(child);
        }
    }
    visit(parseAst(source));
    assert.ok(declaration, `Exercise the actual nested production ${name} declaration`);
    return source.slice(declaration.start, declaration.end);
}

const observerSource = productionDeclarations('../src/content/observer.js', [
    'isAuthorExempt', 'shouldHighlightMatches', 'resolveAuthorBlockState',
    'resolveBlockReasons', 'applyBlockState', 'knownPostVerdict', 'relatedVerdict'
]);
const workerSource = productionDeclarations('../src/background/service-worker.js', [
    'handleGetBlockedSet', 'handleSetBlockedSet'
]);
const memory = new Map(), writes = [];
let writeFailure = null;
globalThis.browser = {
    storage: { local: {
        async get(keys) { return Object.fromEntries(keys.filter(key => memory.has(key)).map(key => [key, structuredClone(memory.get(key))])); },
        async set(values) {
            if (writeFailure) { const failure = writeFailure; writeFailure = null; throw failure; }
            writes.push(structuredClone(values));
            for (const [key, value] of Object.entries(values)) memory.set(key, structuredClone(value));
        }
    } }
};
const { filterStores, BlockedSetStorage } = await import('../src/shared/storage.js');
const accountSource = FILTER_SOURCES.find(source => source.kind === 'accounts');
const ACCOUNT_ID = '2097352012367015936';
const OTHER_ID = '389229444';
const MAX_ID = '99999999999999999999';
const broadcasts = [];
const worker = vm.createContext({ broadcastToAll: value => broadcasts.push(structuredClone(value)) });
vm.runInContext(`${workerSource}\nObject.assign(globalThis, {handleGetBlockedSet, handleSetBlockedSet});`, worker);

function environment() {
    const following = new Set(), profiles = new Map(), info = new Map();
    const location = { pathname: '/home' };
    const context = vm.createContext({
        location, canonicalCountry, matchingBlockedRegions, GOVERNMENT_LABEL, observedAccountId, normalizeAccountId,
        BLOCK_REASON_LABELS: { account: 'Account', country: 'Country', region: 'Region', tag: 'Display name' },
        isFollowing: name => following.has(name), getLoggedInUsername: () => 'reader',
        isInsideQuoteTweet: element => element.quote === true,
        getProfile: name => profiles.get(name) || null,
        knownAuthorInfo: name => info.get(name?.toLowerCase()) || null,
        effectiveCountry: value => value?.location || null,
        extractDisplayName: element => element.name || 'Account Name',
        hasBlockedTag: (name, tags) => !!name && [...(tags || [])].some(tag => name.toLowerCase().includes(tag.toLowerCase())),
        hasBlockedBio: () => false, hasBlockedLink: () => false,
        hasBlockedAccountLabel: () => false, hasBlockedAffiliation: () => false,
        resolveAccountCountReasons: () => [], displayNameCounts: new WeakMap(),
        countDisplayNameDigits: value => (value.match(/\d/g) || []).length,
        CSS_CLASSES: { TWEET_BLOCKED: 'x-tweet-blocked' },
        isFocalTweet: value => value?.focal === true,
        syncQuotePlaceholder: () => {}, releaseQuoteCard: () => {}, filterStatisticsReporter: null
    });
    vm.runInContext(`${observerSource}\nObject.assign(globalThis, {observedAccountId, resolveAuthorBlockState, applyBlockState, knownPostVerdict});`, context);
    return { context, location, following, profiles, info };
}

function filters(settings = {}, extra = {}) {
    return { settings: { ...DEFAULT_SETTINGS, ...settings },
        blockedCountries: new Set(), blockedRegions: new Set(), blockedAccounts: new Set(),
        blockedTags: new Set(), blockedBioTags: new Set(), blockedLinks: new Set(),
        blockedPcf: new Set(), blockedAffiliations: new Set(), blockedLanguages: new Set(),
        allowedUsers: new Set(), ...extra };
}

function node({ country = '', quote = false, focal = false, name = 'Account Name' } = {}) {
    const classes = new Set();
    return { quote, focal, name, dataset: { xCountry: country }, classList: {
        contains: value => classes.has(value),
        toggle: (value, enabled) => enabled ? classes.add(value) : classes.delete(value)
    } };
}

function apply(e, author, f, { element = node(), tweet = node(), info = { meta: { restId: ACCOUNT_ID } }, userCell = false } = {}) {
    const state = e.context.resolveAuthorBlockState(element, author, info, f, tweet, userCell);
    return { state, verdict: e.context.applyBlockState(element, tweet, state), element, tweet };
}

class ControlElement {
    constructor(tag, ownerDocument = null) {
        this.localName = tag; this.children = []; this.dataset = {}; this.attributes = new Map(); this.listeners = new Map(); this.hidden = false; this.ownText = '';
        this.ownerDocument = ownerDocument;
        this.className = '';
        this.classList = {
            contains: name => this.className.split(/\s+/).includes(name),
            toggle: (name, enabled) => {
                const classes = new Set(this.className.split(/\s+/).filter(Boolean));
                if (enabled) classes.add(name); else classes.delete(name);
                this.className = [...classes].join(' ');
            }
        };
    }
    set textContent(value) { this.ownText = value; this.children = []; }
    get textContent() { return this.ownText + this.children.map(child => child.textContent).join(''); }
    set title(value) { this.setAttribute('title', value); }
    get title() { return this.getAttribute('title') || ''; }
    set id(value) { this.setAttribute('id', value); }
    get id() { return this.getAttribute('id') || ''; }
    append(...children) { this.children.push(...children); }
    appendChild(child) { this.children.push(child); return child; }
    replaceChildren(...children) { this.children = [...children]; }
    setAttribute(key, value) { this.attributes.set(key, String(value)); }
    getAttribute(key) { return this.attributes.get(key) ?? null; }
    removeAttribute(key) { this.attributes.delete(key); }
    addEventListener(type, listener) { this.listeners.set(type, listener); }
    click() { this.listeners.get('click')?.({ preventDefault() {}, stopPropagation() {} }); }
    focus() { this.ownerDocument.activeElement = this; }
}

const quickSource = productionDeclarations('../src/content/hovercard-filters.js', [
    'element', 'includes', 'locationTarget', 'createQuickFilterControl'
]) + '\n' + nestedProductionDeclaration('../src/content/hovercard-filters.js', 'quickFilterSequence');
function quickEnvironment({ info = { location: 'Belgium', meta: { restId: ACCOUNT_ID } }, settings = {}, filterState = {} } = {}) {
    clearProfiles();
    const state = { ...Object.fromEntries(FILTER_SOURCES.map(source => [source.field, []])), ...filterState, settings: { ...DEFAULT_SETTINGS, ...settings } };
    const calls = [], pending = [], writes = new Map();
    const document = { activeElement: null, createElement: tag => new ControlElement(tag, document) };
    const context = vm.createContext({
        COUNTRIES: new Set(COUNTRY_LIST), MESSAGE_TYPES, REGION_NAMES, canonicalCountry, isRegion, observedAccountId, matchingBlockedRegions,
        formatCountryName, getDeviceCountry, getProfile, getLoggedInUsername: () => null, isFollowing: () => false,
        document,
        dialogIcon: (name, size) => { const icon = new ControlElement('svg'); icon.dataset.icon = name; icon.dataset.size = String(size); return icon; }
    });
    vm.runInContext(`${quickSource}\nglobalThis.createQuickFilterControl = createQuickFilterControl;`, context);
    const e = { state, calls, pending, hold: false, fail: '', current: true, writes, document };
    const sendMessage = async message => {
        calls.push(structuredClone(message));
        const commit = () => {
            if (e.fail === 'transport') throw new Error('Injected quick-filter transport failure');
            if (e.fail === 'denied') return { success: false };
            if (e.fail === 'malformed') return { success: true, data: [] };
            const source = FILTER_SOURCES.find(source => source.set === message.type);
            assert.ok(source, 'Only existing local filter mutations are allowed');
            const values = new Set(state[source.field]), value = message.payload[source.valueKey];
            if (message.payload.action === 'add') values.add(value);
            else values.delete(value);
            state[source.field] = [...values];
            return { success: true, data: [...values], revision: 1 };
        };
        return e.hold ? new Promise((resolve, reject) => pending.push(() => { try { resolve(commit()); } catch (error) { reject(error); } })) : commit();
    };
    e.mount = (nextInfo = info, handle = 'demo_account') => context.createQuickFilterControl({ handle, info: nextInfo, getState: () => state, sendMessage, isCurrent: () => e.current, writes });
    e.control = e.mount();
    e.button = (kind, control = e.control) => control.element.children.find(child => child.classList.contains('x-posed-footer-section-controls'))
        .children.find(button => button.dataset.action === kind);
    e.tick = () => new Promise(resolve => setImmediate(resolve));
    e.release = async () => { e.hold = false; assert.ok(pending.length); pending.shift()(); await e.tick(); };
    return e;
}

let groups = 0;
async function check(name, action) { await action(); groups++; console.log(`PASS ${name}`); }

await check('Account filters have unique storage/message IDs and preserve existing import order', () => {
    assert.deepEqual(FILTER_SOURCES.map(source => source.kind), [
        'countries', 'regions', 'tags', 'bioTags', 'pcf', 'languages', 'affiliations', 'links', 'allowedUsers', 'accounts'
    ]);
    assert.ok(accountSource);
    assert.equal(accountSource.field, 'blockedAccounts');
    assert.equal(accountSource.storageKey, STORAGE_KEYS.BLOCKED_ACCOUNTS);
    assert.equal(accountSource.get, MESSAGE_TYPES.GET_BLOCKED_ACCOUNTS);
    assert.equal(accountSource.set, MESSAGE_TYPES.SET_BLOCKED_ACCOUNTS);
    assert.equal(accountSource.update, MESSAGE_TYPES.BLOCKED_ACCOUNTS_UPDATED);
    assert.equal(accountSource.valueKey, 'accountId');
    assert.equal(accountSource.valuesKey, 'accountIds');
    assert.equal(accountSource.callback, 'onAccountAction');
    for (const key of ['field', 'kind', 'storageKey', 'get', 'set', 'update']) {
        assert.equal(new Set(FILTER_SOURCES.map(source => source[key])).size, FILTER_SOURCES.length, key);
    }
});

await check('Accounts start empty and store immutable IDs as exact decimal strings without name rules', async () => {
    const store = filterStores.blockedAccounts;
    await store.load();
    assert.deepEqual(store.getAll(), []);
    await store.add(ACCOUNT_ID);
    await store.add(ACCOUNT_ID);
    assert.deepEqual(store.getAll(), [ACCOUNT_ID]);
    assert.equal(store.has(ACCOUNT_ID), true);
    assert.equal(store.has(OTHER_ID), false);
    assert.equal(store.has('209735201236701593'), false);
    assert.deepEqual(memory.get(STORAGE_KEYS.BLOCKED_ACCOUNTS), [ACCOUNT_ID]);
    assert.equal(store.revision, 1, 'Duplicate additions neither write nor advance revision');
    assert.equal(memory.has(STORAGE_KEYS.BLOCKED_TAGS), false, 'Exact account edits never create display-name rules');
});

await check('Handles, unsafe numbers and malformed IDs cannot become rules or trigger writes', async () => {
    const store = filterStores.blockedAccounts;
    const before = structuredClone(store.snapshot()), count = writes.length;
    for (const invalid of ['', '   ', '@alice', 'alice', 'https://x.com/i/user/123', '/user', '0', '0123', '-1', '1.2', '1e9', '1'.repeat(21), '<script>', '123\n', '123\r', '123\r\n', '123\u2028', '123\u2029', null, 123, Number(ACCOUNT_ID), {}]) {
        await store.add(invalid);
        assert.equal(store.has(invalid), false);
    }
    assert.deepEqual(store.snapshot(), before);
    assert.equal(writes.length, count);
});

await check('Failed writes roll back account state and queued mutations recover', async () => {
    const store = filterStores.blockedAccounts, before = structuredClone(store.snapshot());
    writeFailure = new Error('Injected account-filter save failure');
    await assert.rejects(store.add(OTHER_ID), /Injected account-filter save failure/);
    assert.deepEqual(store.snapshot(), before);
    assert.deepEqual(memory.get(STORAGE_KEYS.BLOCKED_ACCOUNTS), before.data);
    await Promise.all([store.add(OTHER_ID), store.add(MAX_ID), store.remove(ACCOUNT_ID)]);
    assert.deepEqual([...store.getAll()].sort(), [OTHER_ID, MAX_ID].sort());
    assert.equal(store.revision, before.revision + 3);
});

await check('Account normalization also applies on load and bulk replacement', async () => {
    const store = new BlockedSetStorage({ storageKey: 'qa_accounts', label: 'test accounts', normalize: filterStores.blockedAccounts.normalize });
    memory.set('qa_accounts', [ACCOUNT_ID, ACCOUNT_ID, OTHER_ID, 'bad name', 123]);
    await store.load();
    assert.deepEqual(store.getAll(), [ACCOUNT_ID, OTHER_ID]);
    await store.setAll([MAX_ID, MAX_ID, 'bad/url']);
    assert.deepEqual(store.getAll(), [MAX_ID]);
    await store.remove(MAX_ID);
    assert.deepEqual(store.getAll(), []);
});

await check('Worker account edits return and broadcast the same committed snapshot/revision', async () => {
    const store = filterStores.blockedAccounts;
    const before = store.revision;
    const result = await worker.handleSetBlockedSet(store, accountSource.update, { action: 'add', value: ACCOUNT_ID });
    assert.equal(result.success, true);
    assert.equal(result.revision, before + 1);
    assert.deepEqual(Array.from(result.data), store.getAll());
    assert.deepEqual(broadcasts.at(-1), { type: accountSource.update, payload: store.getAll(), revision: result.revision });
    const read = worker.handleGetBlockedSet(store);
    assert.deepEqual(Array.from(read.data), store.getAll());
    assert.equal(read.size, store.size);
    const published = broadcasts.length;
    writeFailure = new Error('Injected worker save failure');
    await assert.rejects(worker.handleSetBlockedSet(store, accountSource.update, { action: 'add', value: '12345' }), /Injected worker save failure/);
    assert.equal(broadcasts.length, published, 'Uncommitted rules are never broadcast');
});

await check('Backup round trips include account rules while older partial backups do not erase them', () => {
    const data = { blockedAccounts: [ACCOUNT_ID, MAX_ID], blockedCountries: ['belgium'], blockedTags: ['Chris'] };
    assert.deepEqual(prepareBackupImport(data), data);
    assert.equal(Object.hasOwn(prepareBackupImport({ blockedCountries: [] }), 'blockedAccounts'), false);
    for (const invalid of [null, ACCOUNT_ID, [123], [ACCOUNT_ID, {}]]) {
        assert.throws(() => prepareBackupImport({ blockedAccounts: invalid }), /blockedAccounts/);
    }
});

await check('The account editor accepts exact string IDs or canonical permanent links, never user handles', () => {
    const drafts = {}, context = vm.createContext({ drafts, view: {}, normalizeAccountId });
    vm.runInContext(`${nestedProductionDeclaration('../src/content/graphite-dialog.js', 'normalizedDraft')}\nglobalThis.normalizedDraft = normalizedDraft;`, context);
    for (const id of ['1', OTHER_ID, ACCOUNT_ID, MAX_ID]) {
        for (const input of [id, `https://x.com/i/user/${id}`, `  https://x.com/i/user/${id}  `]) {
            drafts.accounts = input;
            assert.equal(context.normalizedDraft('accounts'), id);
        }
    }
    for (const invalid of ['0', '0123', '-1', '1.2', '1e20', '1'.repeat(21), '@alice', 'alice',
        'http://x.com/i/user/123', 'https://twitter.com/i/user/123', 'https://x.com/i/user/123/',
        'https://x.com/i/user/123?x=1', 'https://x.com/i/user/123#x',
        'https://x.com:443/i/user/123', 'https://user@x.com/i/user/123', 'https://x.com.evil/i/user/123',
        'https://x.com/i/user/%31%32%33', 'https://x.com/i/user/123\n456']) {
        drafts.accounts = invalid;
        assert.equal(context.normalizedDraft('accounts'), '', invalid);
    }
    drafts.allowedUsers = '@ALICE';
    assert.equal(context.normalizedDraft('allowedUsers'), 'alice', 'Always Show keeps its existing handle-based editor');
});

await check('Saved-filter totals include account rules once and exclude Always Show accounts', () => {
    const sets = Object.fromEntries(FILTER_SOURCES.map(source => [source.kind, new Set()]));
    sets.accounts = new Set([ACCOUNT_ID, MAX_ID]);
    sets.countries.add('belgium');
    sets.tags.add('Chris');
    sets.allowedUsers.add('alice');
    const settings = { ...DEFAULT_SETTINGS, minPosts: 100 };
    const context = vm.createContext({ FILTER_SOURCES, ACCOUNT_COUNT_FILTERS, isAccountCountThreshold, sets, settings });
    const source = ['SOURCES', 'COUNT_SOURCE', 'FILTERS', 'filterValues', 'filterTotal']
        .map(name => nestedProductionDeclaration('../src/content/graphite-dialog.js', name)).join('\n');
    vm.runInContext(`${source}\nglobalThis.filterTotal = filterTotal;`, context);
    assert.equal(context.filterTotal(), 5);
    sets.accounts.delete(ACCOUNT_ID);
    assert.equal(context.filterTotal(), 4);
    settings.minPosts = 0;
    assert.equal(context.filterTotal(), 3);
    sets.allowedUsers.add('bob');
    assert.equal(context.filterTotal(), 3);
});

await check('Immutable ID matching follows renamed handles and ignores names or reused old handles', () => {
    const e = environment(), f = filters({}, { blockedAccounts: new Set([ACCOUNT_ID]) });
    for (const handle of ['cmwdotme', 'CmWdotme', 'renamed_account']) {
        const result = apply(e, handle, f, { element: node({ name: 'A completely different display name' }) });
        assert.deepEqual(Array.from(result.state.reasons), ['account']);
        assert.equal(result.verdict.hide, true);
    }
    for (const handle of ['cmwdotme', 'cmwdotme2', 'other']) {
        const result = apply(e, handle, f, { element: node({ name: 'cmwdotme' }), info: { meta: { restId: OTHER_ID } } });
        assert.deepEqual(Array.from(result.state.reasons), []);
        assert.equal(result.verdict.hide, false);
    }
});

await check('Unknown identity never falls back to a matching handle, name, prefix or coerced number', () => {
    const e = environment(), f = filters({}, { blockedAccounts: new Set([ACCOUNT_ID]) });
    for (const restId of [undefined, null, Number(ACCOUNT_ID), '0', '0123', `${ACCOUNT_ID}0`, '@alice', 'alice']) {
        const result = apply(e, 'alice', f, { info: { meta: { restId } } });
        assert.deepEqual(Array.from(result.state.reasons), []);
        assert.equal(result.verdict.hide, false);
    }
    for (const id of [ACCOUNT_ID, MAX_ID, '1']) assert.equal(e.context.observedAccountId({ meta: { restId: id } }, null), id);
});

await check('Fresh harvested user ID supersedes stale cached identity even with profile enrichment off', () => {
    const e = environment(), f = filters({ profileEnrichment: false }, { blockedAccounts: new Set([ACCOUNT_ID]) });
    e.profiles.set('alice', { userId: OTHER_ID });
    assert.equal(apply(e, 'alice', f).verdict.hide, false, 'Reused handle does not inherit cached old-account rules');
    e.profiles.set('alice', { userId: ACCOUNT_ID });
    assert.equal(apply(e, 'alice', f, { info: {} }).verdict.hide, true, 'Already harvested immutable identity is not a bio-enrichment feature');
    assert.equal(e.context.observedAccountId({ meta: { restId: ACCOUNT_ID } }, { userId: Number(OTHER_ID) }), null,
        'An invalid newer identity cannot silently resurrect stale cached identity');
});

await check('Passive timeline identity projects and relays exact ID strings without extra account requests', () => {
    for (const id of [OTHER_ID, ACCOUNT_ID, MAX_ID]) {
        const projected = projectProfileUser({ core: { screen_name: 'ALICE' }, rest_id: id });
        assert.deepEqual(projected, { u: 'alice', i: id });
        assert.deepEqual(profilePatchFromWire(projected), { userId: id });
    }
    for (const invalid of [Number(ACCOUNT_ID), 123, null, '0', '0123', '123\n', 'bad']) {
        assert.equal(projectProfileUser({ core: { screen_name: 'alice' }, rest_id: invalid }), null);
    }
});

await check('Reused-handle identity changes erase old passive bio/count/link evidence instead of inheriting it', () => {
    clearProfiles();
    setProfile('alice', { userId: ACCOUNT_ID, bio: 'Old person', followers: 10, websiteHosts: ['example.com'], websiteUrls: ['https://example.com/old'] });
    setProfile('ALICE', { userId: OTHER_ID });
    assert.deepEqual(getProfile('alice'), { userId: OTHER_ID });
    const oldWire = { u: 'alice', i: ACCOUNT_ID, b: 'Old person', f: 10, w: ['example.com'], W: ['https://example.com/old'] };
    assert.deepEqual(mergeProjectedProfile(oldWire, { u: 'alice', i: OTHER_ID }), { u: 'alice', i: OTHER_ID });
    setProfile('alice', { userId: OTHER_ID, bio: 'New person', followers: 2 });
    setProfile('alice', { media: 3 });
    assert.deepEqual(getProfile('alice'), { userId: OTHER_ID, bio: 'New person', followers: 2, media: 3 });
    assert.deepEqual(mergeProjectedProfile({ u: 'alice', i: OTHER_ID, b: 'New person' }, { u: 'alice', m: 3 }),
        { u: 'alice', i: OTHER_ID, b: 'New person', m: 3 });
    clearProfiles();
});

await check('Production profile listener rederives account-only filters and syncs open quick controls on native identity changes', () => {
    clearProfiles();
    const listeners = new Map(), passes = [], f = filters({}, { blockedAccounts: new Set([ACCOUNT_ID]) });
    let controlSyncs = 0;
    const context = vm.createContext({
        settingsLoaded: true, isEnabled: true, isCleanedUp: false, settings: f.settings, filterSets: f,
        PROFILE_LIMITS, profilePatchFromWire, setProfile, getProfile, clearProfiles,
        ACCOUNT_COUNT_FILTERS, isAccountCountThreshold, matchesAccountCount,
        hovercard: { syncFilters: () => { controlSyncs++; } },
        currentFilters: () => f, updateBlockedTweets: (_filters, names) => passes.push([...names]),
        window: {}, syncEnrichmentSetting() {}, debug() {}, sendMessage() { assert.fail('Passive identity must not request account data'); }
    });
    vm.runInContext(`${productionDeclarations('../src/content/content-script.js', ['setupProfileListener'])}\nglobalThis.setupProfileListener = setupProfileListener;`, context);
    context.setupProfileListener({ listen: (_target, type, handler) => listeners.set(type, handler), add() {} });
    const relay = users => listeners.get('x-posed-profiles')({ detail: JSON.stringify({ users }) });
    relay([{ u: 'alice', i: ACCOUNT_ID }]);
    assert.deepEqual(passes, [['alice']]);
    assert.equal(controlSyncs, 1);
    assert.equal(getProfile('alice').userId, ACCOUNT_ID);
    relay([{ u: 'alice', i: ACCOUNT_ID }]);
    assert.deepEqual(passes, [['alice']], 'Unchanged identity alone does not reprocess every post');
    relay([{ u: 'alice', i: OTHER_ID }]);
    assert.deepEqual(passes, [['alice'], ['alice']], 'A reused handle must reevaluate the old-account verdict');
    assert.equal(getProfile('alice').userId, OTHER_ID);
    assert.equal(controlSyncs, 3);
    context.isCleanedUp = true;
    relay([{ u: 'alice', i: ACCOUNT_ID }]);
    assert.equal(getProfile('alice').userId, OTHER_ID, 'Disposed content sessions do not resurrect stale identity');
    assert.equal(controlSyncs, 3);
    clearProfiles();
});

await check('Reader, Always Show and opt-in followed-account exemptions precede exact-account rules', () => {
    const e = environment();
    for (const who of ['reader', 'trusted', 'friend']) {
        const f = filters({ alwaysShowFollowing: true }, { blockedAccounts: new Set([ACCOUNT_ID]), allowedUsers: new Set(['trusted']) });
        e.following.add('friend');
        const result = apply(e, who.toUpperCase(), f);
        assert.deepEqual(Array.from(result.state.reasons), [], who);
        assert.equal(result.verdict.hide, false, who);
        assert.equal(result.verdict.highlight, false, who);
    }
    const f = filters({ alwaysShowFollowing: false }, { blockedAccounts: new Set([ACCOUNT_ID]) });
    assert.equal(apply(e, 'friend', f).verdict.hide, true, 'Following is not an unconditional bypass');
});

await check('Exact-account filters follow global Hide/Highlight and optional curated-List highlighting', () => {
    const e = environment(), f = filters({}, { blockedAccounts: new Set([ACCOUNT_ID]) });
    assert.equal(apply(e, 'alice', f).verdict.hide, true);
    f.settings.highlightBlockedTweets = true;
    assert.equal(apply(e, 'alice', f).verdict.highlight, true);
    f.settings.highlightBlockedTweets = false;
    f.settings.highlightInLists = true;
    e.location.pathname = '/i/lists/123';
    assert.equal(apply(e, 'alice', f).verdict.highlight, true);
    e.location.pathname = '/home';
    assert.equal(apply(e, 'alice', f).verdict.hide, true);
    assert.equal(f.settings.highlightBlockedTweets, false);
});

await check('Removing one quick filter preserves all overlapping filter reasons', () => {
    const e = environment(), element = node({ country: 'Belgium' }), tweet = node();
    const f = filters({}, { blockedAccounts: new Set([ACCOUNT_ID]), blockedCountries: new Set(['belgium']) });
    assert.deepEqual(Array.from(apply(e, 'alice', f, { element, tweet }).state.reasons), ['account', 'country']);
    f.blockedAccounts.clear();
    assert.deepEqual(Array.from(apply(e, 'alice', f, { element, tweet }).state.reasons), ['country']);
    assert.equal(tweet.classList.contains('x-tweet-blocked'), true);
    f.blockedCountries.clear();
    assert.equal(apply(e, 'alice', f, { element, tweet }).verdict.hide, false);
    assert.equal(element.dataset.xBlock, '');
    assert.equal(tweet.classList.contains('x-tweet-blocked'), false);
});

await check('Region quick filters do not silently expand into member countries', () => {
    const e = environment(), f = filters({}, { blockedRegions: new Set(['africa']) });
    assert.deepEqual(Array.from(apply(e, 'alice', f, { element: node({ country: 'Africa' }) }).state.reasons), ['region']);
    assert.deepEqual(Array.from(apply(e, 'alice', f, { element: node({ country: 'Egypt' }) }).state.reasons), []);
    f.settings.regionCountrySelections = { africa: ['egypt'] };
    assert.deepEqual(Array.from(apply(e, 'alice', f, { element: node({ country: 'Egypt' }) }).state.reasons), ['region']);
    assert.equal(f.blockedCountries.size, 0);
});

await check('Quoted-account rules mark only the quoted account, not the containing author/post', () => {
    const e = environment(), f = filters({}, { blockedAccounts: new Set([ACCOUNT_ID]) });
    const element = node({ quote: true }), tweet = node();
    const result = apply(e, 'alice', f, { element, tweet });
    assert.equal(result.verdict.hide, false);
    assert.equal(element.dataset.xQuoteBlock, 'hide');
    assert.equal(element.dataset.xQuoteReason, 'account');
    assert.equal(tweet.classList.contains('x-tweet-blocked'), false);
    f.blockedAccounts.clear();
    apply(e, 'alice', f, { element, tweet });
    assert.equal(element.dataset.xQuoteBlock, '');
    assert.equal(element.dataset.xQuoteReason, '');
});

await check('An explicit account filter hides a deliberately opened focal post in Hide mode', () => {
    const e = environment(), f = filters({}, { blockedAccounts: new Set([ACCOUNT_ID]) });
    const element = node(), tweet = node({ focal: true });
    const result = apply(e, 'alice', f, { element, tweet });
    assert.deepEqual(Array.from(result.state.reasons), ['account']);
    assert.equal(result.state.highlightMode, false);
    assert.equal(result.verdict.hide, true);
    assert.equal(result.verdict.highlight, false);
    assert.equal(element.dataset.xBlock, 'hide');
    assert.equal(tweet.classList.contains('x-tweet-blocked'), true);
    assert.equal(tweet.classList.contains('x-tweet-highlighted'), false);
    f.blockedAccounts.clear();
    const removed = apply(e, 'alice', f, { element, tweet });
    assert.equal(removed.verdict.hide, false);
    assert.equal(removed.verdict.highlight, false);
    assert.equal(element.dataset.xBlock, '');
    assert.equal(tweet.classList.contains('x-tweet-blocked'), false);
});

await check('People-list rows remain visible with account highlighting in Hide mode', () => {
    const e = environment(), f = filters({}, { blockedAccounts: new Set([ACCOUNT_ID]) });
    const result = apply(e, 'alice', f, { userCell: true });
    assert.equal(result.verdict.hide, false);
    assert.equal(result.verdict.highlight, true);
    assert.equal(result.element.dataset.xBlock, 'highlight');
});

await check('Global Highlight keeps an account-filtered focal post visible and clears a prior Hide verdict', () => {
    const e = environment(), f = filters({}, { blockedAccounts: new Set([ACCOUNT_ID]) });
    const element = node(), tweet = node({ focal: true });
    assert.equal(apply(e, 'alice', f, { element, tweet }).verdict.hide, true);
    f.settings.highlightBlockedTweets = true;
    const result = apply(e, 'alice', f, { element, tweet });
    assert.equal(result.verdict.hide, false);
    assert.equal(result.verdict.highlight, true);
    assert.equal(element.dataset.xBlock, 'highlight');
    assert.equal(tweet.classList.contains('x-tweet-blocked'), false);
    assert.equal(tweet.classList.contains('x-tweet-highlighted'), true);
});

await check('Removing an overlapping account filter restores the broad-country focal readability exception', () => {
    const e = environment(), element = node({ country: 'Belgium' }), tweet = node({ focal: true });
    const f = filters({}, { blockedAccounts: new Set([ACCOUNT_ID]), blockedCountries: new Set(['belgium']) });
    const accountAndCountry = apply(e, 'alice', f, { element, tweet });
    assert.deepEqual(Array.from(accountAndCountry.state.reasons), ['account', 'country']);
    assert.equal(accountAndCountry.verdict.hide, true);
    assert.equal(element.dataset.xBlock, 'hide');
    f.blockedAccounts.clear();
    const countryOnly = apply(e, 'alice', f, { element, tweet });
    assert.deepEqual(Array.from(countryOnly.state.reasons), ['country']);
    assert.equal(countryOnly.verdict.hide, false);
    assert.equal(countryOnly.verdict.highlight, true);
    assert.equal(element.dataset.xBlock, 'highlight');
    assert.equal(tweet.classList.contains('x-tweet-blocked'), false);
    assert.equal(tweet.classList.contains('x-tweet-highlighted'), true);
});

await check('An explicitly revealed related post remains visible despite an account filter', () => {
    const e = environment(), f = filters({}, { blockedAccounts: new Set([ACCOUNT_ID]) });
    for (const focal of [false, true]) {
        const tweet = node({ focal });
        tweet.dataset.xRelatedBlock = 'shown';
        const result = apply(e, 'alice', f, { tweet });
        assert.equal(result.verdict.hide, false);
        assert.equal(result.verdict.highlight, true);
        assert.equal(result.element.dataset.xBlock, 'highlight');
        assert.equal(tweet.dataset.xRelatedBlock, 'shown');
    }
});

await check('Always Show, the reader and followed-account exemptions still precede focal account filtering', () => {
    const e = environment();
    e.following.add('friend');
    const f = filters({ alwaysShowFollowing: true }, {
        blockedAccounts: new Set([ACCOUNT_ID]), allowedUsers: new Set(['trusted'])
    });
    for (const author of ['reader', 'trusted', 'friend']) {
        const result = apply(e, author, f, { tweet: node({ focal: true }) });
        assert.deepEqual(Array.from(result.state.reasons), [], author);
        assert.equal(result.verdict.hide, false, author);
        assert.equal(result.verdict.highlight, false, author);
        assert.equal(result.element.dataset.xBlock, '', author);
    }
});

await check('Curated List Highlight still overrides account Hide without changing the general preference', () => {
    const e = environment(), element = node(), tweet = node();
    const f = filters({ highlightInLists: true }, { blockedAccounts: new Set([ACCOUNT_ID]) });
    assert.equal(apply(e, 'alice', f, { element, tweet }).verdict.hide, true);
    e.location.pathname = '/i/lists/123';
    const result = apply(e, 'alice', f, { element, tweet });
    assert.equal(result.verdict.hide, false);
    assert.equal(result.verdict.highlight, true);
    assert.equal(element.dataset.xBlock, 'highlight');
    assert.equal(tweet.classList.contains('x-tweet-blocked'), false);
    assert.equal(f.settings.highlightBlockedTweets, false);
    e.location.pathname = '/home';
    assert.equal(apply(e, 'alice', f, { element, tweet }).verdict.hide, true);
    assert.equal(element.dataset.xBlock, 'hide');
});

await check('Related-post filtering derives immutable-ID reasons from current rules and exemptions', () => {
    const e = environment(), f = filters({}, { blockedAccounts: new Set([ACCOUNT_ID]) });
    e.info.set('alice', { meta: { restId: ACCOUNT_ID } });
    e.info.set('alice2', { meta: { restId: OTHER_ID } });
    const record = { id: '123', author: 'ALICE', authorId: ACCOUNT_ID, displayName: 'Unrelated name', language: 'en' };
    assert.deepEqual(Array.from(e.context.knownPostVerdict(record, f).reasons), ['account']);
    assert.deepEqual(Array.from(e.context.knownPostVerdict({ ...record, author: 'alice2', authorId: OTHER_ID }, f).reasons), []);
    f.allowedUsers.add('alice');
    assert.deepEqual(Array.from(e.context.knownPostVerdict(record, f).reasons), []);
    f.allowedUsers.clear();
    f.blockedAccounts.clear();
    assert.deepEqual(Array.from(e.context.knownPostVerdict(record, f).reasons), []);
});

await check('Historical parents require their own explicit ID, never the current owner of a reused handle', () => {
    const e = environment(), f = filters({}, { blockedAccounts: new Set([ACCOUNT_ID]) });
    e.info.set('reused', { meta: { restId: ACCOUNT_ID } });
    e.profiles.set('reused', { userId: ACCOUNT_ID });
    const parent = { id: '123', author: 'reused' };
    assert.deepEqual(Array.from(e.context.knownPostVerdict(parent, f).reasons), [], 'Current cached/harvested identity is not evidence about a historical post');
    assert.deepEqual(Array.from(e.context.knownPostVerdict({ ...parent, authorId: OTHER_ID }, f).reasons), [], 'Unfiltered historical owner cannot inherit the new owner\'s filter');
    e.info.set('reused', { meta: { restId: OTHER_ID } });
    e.profiles.set('reused', { userId: OTHER_ID });
    assert.deepEqual(Array.from(e.context.knownPostVerdict({ ...parent, authorId: ACCOUNT_ID }, f).reasons), ['account'], 'The historical owner still matches after its old handle changes hands');
    assert.deepEqual(Array.from(e.context.knownPostVerdict({ ...parent, author: 'renamed', authorId: ACCOUNT_ID }, f).reasons), ['account'], 'An exact native ID does not require a current handle lookup');
});

await check('Missing or malformed parent account IDs fail open only for account rules', () => {
    const e = environment(), f = filters({}, { blockedAccounts: new Set([ACCOUNT_ID]) });
    e.info.set('alice', { location: 'Belgium', meta: { restId: ACCOUNT_ID } });
    e.profiles.set('alice', { userId: ACCOUNT_ID });
    for (const authorId of [undefined, null, Number(ACCOUNT_ID), 123, '0', '0123', '123\n', '@alice', '1'.repeat(21)]) {
        const record = { id: '123', author: 'alice', authorId };
        assert.deepEqual(Array.from(e.context.knownPostVerdict(record, f).reasons), [], String(authorId));
    }
    f.blockedCountries.add('belgium');
    assert.deepEqual(Array.from(e.context.knownPostVerdict({ id: '123', author: 'alice' }, f).reasons), ['country'], 'Country and other existing rules retain their previous behavior');
});

await check('Native post projection preserves only a strict account ID attached to that exact post', () => {
    const modern = { __typename: 'Tweet', rest_id: '123', legacy: { lang: 'en' },
        core: { user_results: { result: { rest_id: ACCOUNT_ID, core: { screen_name: 'ALICE' } } } } };
    assert.deepEqual(projectPostRelation(modern), { id: '123', author: 'alice', authorId: ACCOUNT_ID, language: 'en' });
    assert.equal(projectPostRelation({ __typename: 'TweetWithVisibilityResults', tweet: modern }).authorId, ACCOUNT_ID);
    assert.equal(projectPostRelation({ ...modern, legacy: { user_id_str: ACCOUNT_ID } }).authorId, ACCOUNT_ID);
    const old = { id_str: '456', full_text: 'Synthetic legacy post', user_id_str: MAX_ID, user: { id_str: MAX_ID, screen_name: 'renamed' } };
    assert.deepEqual(projectPostRelation(old), { id: '456', author: 'renamed', authorId: MAX_ID });
    assert.equal(Object.hasOwn(projectPostRelation({ ...modern, legacy: { user_id_str: OTHER_ID } }), 'authorId'), false,
        'Conflicting explicit post/user identities are not safe account-filter evidence');
    for (const invalid of [undefined, null, Number(ACCOUNT_ID), '0', '0123', '123\n', 'bad']) {
        const post = { __typename: 'Tweet', rest_id: '123', legacy: { user_id_str: invalid }, core: { user_results: { result: { core: { screen_name: 'alice' } } } } };
        assert.equal(Object.hasOwn(projectPostRelation(post), 'authorId'), false, String(invalid));
        assert.equal(Object.hasOwn(normalizePostRelation({ id: '123', authorId: invalid }), 'authorId'), false);
    }
    const records = collectPostRelations({ data: [modern, old] });
    assert.equal(records.find(record => record.id === '123').authorId, ACCOUNT_ID);
    assert.equal(records.find(record => record.id === '456').authorId, MAX_ID);
});

await check('Optional native parent IDs survive bounded relay/cache merging without DOM handle inference', () => {
    clearPostRelations();
    const context = configurePostRelations(true);
    mergePostRelationsBatch({ generation: context.generation, posts: [{ id: '123', author: 'alice', authorId: ACCOUNT_ID }] });
    assert.equal(getPostRelation('123').authorId, ACCOUNT_ID);
    rememberPostRelation({ id: '123', author: 'renamed', displayName: 'Synthetic account' });
    assert.equal(getPostRelation('123').authorId, ACCOUNT_ID, 'Sparse DOM evidence cannot erase an already known native ID');
    rememberPostRelation({ id: '456', author: 'alice', displayName: 'Different historical post' });
    assert.equal(Object.hasOwn(getPostRelation('456'), 'authorId'), false, 'A shared author handle does not invent post identity');
    mergePostRelationsBatch({ generation: context.generation, posts: [{ id: '123', language: 'en' }, { id: '789', authorId: Number(ACCOUNT_ID) }] });
    assert.equal(getPostRelation('123').authorId, ACCOUNT_ID);
    assert.equal(Object.hasOwn(getPostRelation('789'), 'authorId'), false);
    clearPostRelations();
});

await check('Quick controls read current snapshots without requests and follow general Hide/Highlight in place', () => {
    const e = quickEnvironment(), account = e.button('account'), location = e.button('location');
    assert.equal(account.children[1].textContent, 'Account');
    assert.equal(location.children[1].textContent, 'Country');
    assert.match(account.getAttribute('aria-label'), /^Account: Hide @demo_account\./);
    assert.match(location.getAttribute('aria-label'), /^Country: Hide Belgium\./);
    assert.match(account.dataset.xTooltipHeading, /Hide @demo_account/);
    assert.match(account.dataset.xTooltipDescription, /account.*handle changes/i, 'The explanation makes immutable-ID scope understandable');
    assert.match(location.dataset.xTooltipHeading, /Hide Belgium/);
    assert.ok(location.dataset.xTooltipDescription.length > 20, 'Country scope is explained, not just its name');
    for (const button of [account, location]) {
        assert.equal(button.classList.contains('x-posed-card-action'), true, 'Every footer cell shares the same base treatment');
        assert.equal(button.children[0].children[0].dataset.size, '18');
        assert.equal(button.children[1].className, 'x-posed-card-action-label');
        assert.equal(button.getAttribute('title'), null, 'Native tooltips must not duplicate the styled explanation');
    }
    assert.deepEqual(e.calls, []);
    e.state.settings.highlightBlockedTweets = true;
    e.control.refresh();
    assert.equal(account.children[1].textContent, 'Account', 'Visible captions remain compact and stable across modes');
    assert.match(account.getAttribute('aria-label'), /^Account: Highlight @demo_account\./);
    assert.match(account.dataset.xTooltipHeading, /Highlight @demo_account/);
    assert.equal(account.getAttribute('title'), null);
    assert.equal(account, e.button('account'));
    e.state.blockedAccounts = [ACCOUNT_ID];
    e.control.refresh();
    assert.equal(account.children[1].textContent, 'Account');
    assert.match(account.getAttribute('aria-label'), /^Account: Remove account filter/);
    assert.match(account.dataset.xTooltipHeading, /Remove account filter/);
    assert.equal(account.getAttribute('title'), null);
    assert.equal(account.getAttribute('aria-pressed'), 'true');
    assert.equal(account.children.find(child => child.classList.contains('x-posed-card-action-check')).hidden, false, 'Selected cells expose a small visual check');
});

await check('Grouped quick filters retain a labelled live mode heading and focused controls through pending saves/enrichment', async () => {
    const e = quickEnvironment(), section = e.control.element, heading = e.control.heading;
    const account = e.button('account'), location = e.button('location'); account.focus();
    assert.equal(section.classList.contains('x-posed-footer-section'), true);
    assert.equal(section.getAttribute('role'), 'group'); assert.equal(section.getAttribute('aria-labelledby'), heading.id);
    assert.ok(heading.id); assert.equal(heading.classList.contains('x-posed-footer-section-heading'), true);
    assert.equal(heading.textContent, 'Hide');
    e.state.settings.highlightBlockedTweets = true; e.control.refresh();
    assert.equal(heading.textContent, 'Highlight'); assert.equal(e.control.heading, heading);
    assert.equal(e.document.activeElement, account);
    e.hold = true; account.click(); await e.tick();
    e.state.settings.highlightBlockedTweets = false; e.control.refresh();
    e.control.updateInfo({ location: 'Belgium', meta: { restId: ACCOUNT_ID, usernameChanges: 4 } });
    assert.equal(e.control.heading, heading); assert.equal(heading.textContent, 'Hide');
    assert.equal(e.button('account'), account); assert.equal(e.button('location'), location);
    assert.equal(account.getAttribute('aria-disabled'), 'true'); assert.equal(e.document.activeElement, account);
    await e.release();
    assert.equal(e.control.heading, heading); assert.equal(section.getAttribute('aria-labelledby'), heading.id);
    assert.equal(account.getAttribute('aria-pressed'), 'true'); assert.equal(account.getAttribute('aria-disabled'), 'false');
    assert.equal(e.document.activeElement, account); assert.match(e.control.status.textContent, /Account filter added/);
    const reopened = e.mount();
    assert.notEqual(reopened.heading.id, heading.id, 'Separately owned sections cannot duplicate their accessible label ID');
});

await check('A direct Pakistan filter is selected on the first array-backed Blocking snapshot without requests', () => {
    const e = quickEnvironment({ info: { location: 'Pakistan', meta: { restId: ACCOUNT_ID } }, filterState: { blockedCountries: ['pakistan'] } });
    const country = e.button('location'), account = e.button('account');
    assert.equal(country.getAttribute('aria-pressed'), 'true');
    assert.notEqual(country.dataset.coverage, 'region');
    assert.equal(country.children.find(child => child.classList.contains('x-posed-card-action-check')).hidden, false);
    assert.equal(country.children.find(child => child.classList.contains('x-posed-card-action-coverage')).hidden, true);
    assert.match(country.dataset.xTooltipHeading, /Remove country filter/);
    assert.equal(account.getAttribute('aria-pressed'), 'false'); assert.deepEqual(e.calls, []);
});

await check('Pakistan included through active South Asia is distinguished from a directly selected country/account', () => {
    const e = quickEnvironment({ info: { location: 'Pakistan', meta: { restId: ACCOUNT_ID } },
        settings: { regionCountrySelections: { 'south asia': ['pakistan'] } }, filterState: { blockedRegions: ['south asia'] } });
    const country = e.button('location'), account = e.button('account');
    assert.equal(country.dataset.coverage, 'region'); assert.equal(country.getAttribute('aria-pressed'), 'false');
    const indirect = country.children.find(child => child.classList.contains('x-posed-card-action-coverage'));
    assert.equal(indirect.hidden, false); assert.equal(indirect.textContent, '', 'The decorative CSS minus does not pollute the visible caption');
    assert.equal(indirect.getAttribute('aria-hidden'), 'true');
    assert.equal(country.textContent, 'Country'); assert.equal(account.textContent, 'Account');
    assert.equal(country.children.find(child => child.classList.contains('x-posed-card-action-check')).hidden, true);
    assert.match(country.dataset.xTooltipHeading, /Included through South Asia/);
    assert.match(country.dataset.xTooltipDescription, /Pakistan.*South Asia/);
    assert.match(country.dataset.xTooltipDescription, /adds a separate country filter/);
    assert.match(country.getAttribute('aria-label'), /already covered by South Asia.*adds a separate country filter/);
    assert.equal(account.getAttribute('aria-pressed'), 'false'); assert.notEqual(account.dataset.coverage, 'region');
    assert.doesNotMatch(account.dataset.xTooltipDescription, /South Asia/);
    assert.deepEqual(e.state.blockedCountries, []); assert.deepEqual(e.calls, []);
});

await check('Inactive, label-only, empty and excluding regions never imply country coverage', () => {
    for (const [regions, selections] of [
        [[], { 'south asia': ['pakistan'] }], [['south asia'], {}],
        [['south asia'], { 'south asia': [] }], [['south asia'], { 'south asia': ['india'] }],
        [['asia'], { 'south asia': ['pakistan'] }]
    ]) {
        const e = quickEnvironment({ info: { location: 'Pakistan', meta: { restId: ACCOUNT_ID } },
            settings: { regionCountrySelections: selections }, filterState: { blockedRegions: regions } });
        assert.notEqual(e.button('location').dataset.coverage, 'region');
        assert.equal(e.button('location').getAttribute('aria-pressed'), 'false');
        assert.match(e.button('location').dataset.xTooltipHeading, /Hide Pakistan/);
        assert.deepEqual(e.calls, []);
    }
    const literal = quickEnvironment({ info: { location: 'South Asia', meta: { restId: ACCOUNT_ID } }, filterState: { blockedRegions: ['south asia'] } });
    assert.equal(literal.button('location').children[1].textContent, 'Region');
    assert.equal(literal.button('location').getAttribute('aria-pressed'), 'true', 'Literal X region labels retain direct-region semantics');
    assert.notEqual(literal.button('location').dataset.coverage, 'region');
});

await check('Coverage normalizes case aliases and names every overlapping active region without guessing membership', () => {
    const e = quickEnvironment({ info: { location: 'PAKISTAN', meta: { restId: ACCOUNT_ID } },
        settings: { regionCountrySelections: { Asia: ['PAKISTAN'], 'South Asia': ['Pakistan'] } },
        filterState: { blockedRegions: ['ASIA', 'South Asia'] } });
    assert.equal(e.button('location').dataset.coverage, 'region');
    assert.match(e.button('location').dataset.xTooltipHeading, /Included through regions/);
    assert.match(e.button('location').dataset.xTooltipDescription, /Asia, South Asia|South Asia, Asia/);
    e.state.blockedCountries = ['PaKiStAn']; e.control.refresh();
    assert.equal(e.button('location').getAttribute('aria-pressed'), 'true');
    assert.notEqual(e.button('location').dataset.coverage, 'region');
    assert.match(e.button('location').dataset.xTooltipDescription, /Asia, South Asia|South Asia, Asia/);
    assert.match(e.button('location').getAttribute('aria-label'), /remains after removing this direct country filter/);
    assert.deepEqual(e.calls, []);
    const alias = quickEnvironment({ info: { location: 'USA', meta: { restId: ACCOUNT_ID } },
        settings: { regionCountrySelections: { 'North America': ['United States'] } }, filterState: { blockedRegions: ['NORTH AMERICA'] } });
    assert.equal(alias.button('location').dataset.coverage, 'region', 'Canonical country aliases use the same membership as observed country names');
    assert.match(alias.button('location').dataset.xTooltipDescription, /United States.*North America/);
});

await check('Adding/removing direct Pakistan preserves all regional coverage and never edits region settings', async () => {
    const selections = { 'south asia': ['pakistan'], asia: ['pakistan'] };
    const e = quickEnvironment({ info: { location: 'Pakistan', meta: { restId: ACCOUNT_ID } },
        settings: { regionCountrySelections: selections }, filterState: { blockedRegions: ['south asia', 'asia'] } });
    const regions = e.state.blockedRegions, before = structuredClone(selections), country = e.button('location'); country.focus();
    country.click(); await e.tick();
    assert.deepEqual(e.calls[0], { type: MESSAGE_TYPES.SET_BLOCKED_COUNTRIES, payload: { action: 'add', country: 'pakistan' } });
    assert.deepEqual(e.state.blockedCountries, ['pakistan']); assert.equal(country.getAttribute('aria-pressed'), 'true');
    assert.notEqual(country.dataset.coverage, 'region');
    assert.match(country.dataset.xTooltipDescription, /still apply through your region selections/);
    country.click(); await e.tick();
    assert.equal(e.calls[1].payload.action, 'remove'); assert.deepEqual(e.state.blockedCountries, []);
    assert.equal(country.dataset.coverage, 'region'); assert.equal(country.getAttribute('aria-pressed'), 'false');
    assert.equal(e.state.blockedRegions, regions); assert.deepEqual(e.state.settings.regionCountrySelections, before);
    assert.equal(e.document.activeElement, country); assert.equal(e.button('account').getAttribute('aria-pressed'), 'false');
    assert.equal(e.calls.length, 2); assert.ok(e.calls.every(call => call.type === MESSAGE_TYPES.SET_BLOCKED_COUNTRIES));
});

await check('Live settings, country snapshots and location enrichment rederive coverage without replacing focused controls', () => {
    const e = quickEnvironment({ info: { location: 'Pakistan', meta: { restId: ACCOUNT_ID } },
        settings: { regionCountrySelections: { 'south asia': ['pakistan'] } }, filterState: { blockedRegions: ['south asia'] } });
    const country = e.button('location'); country.focus();
    e.state.settings = { ...e.state.settings, highlightBlockedTweets: true }; e.control.refresh();
    assert.equal(e.control.heading.textContent, 'Highlight'); assert.equal(country.dataset.coverage, 'region');
    e.state.settings = { ...e.state.settings, regionCountrySelections: { 'south asia': ['india'] } }; e.control.refresh();
    assert.notEqual(country.dataset.coverage, 'region');
    e.control.updateInfo({ location: 'India', meta: { restId: ACCOUNT_ID } }); assert.equal(country.dataset.coverage, 'region');
    e.state.blockedCountries = ['india']; e.control.refresh(); assert.equal(country.getAttribute('aria-pressed'), 'true');
    e.state.blockedCountries = []; e.control.refresh(); assert.equal(country.dataset.coverage, 'region');
    e.control.updateInfo({ meta: { restId: ACCOUNT_ID } });
    assert.notEqual(country.dataset.coverage, 'region'); assert.equal(country.getAttribute('aria-disabled'), 'true');
    e.control.updateInfo({ location: 'India', meta: { restId: ACCOUNT_ID } }); assert.equal(country.dataset.coverage, 'region');
    e.state.blockedRegions = []; e.control.refresh(); assert.notEqual(country.dataset.coverage, 'region');
    assert.equal(e.button('location'), country); assert.equal(e.document.activeElement, country); assert.deepEqual(e.calls, []);
});

await check('Regional coverage retains exemption notices and survives a failed direct-country write without false success', async () => {
    const e = quickEnvironment({ info: { location: 'Pakistan', meta: { restId: ACCOUNT_ID } },
        settings: { regionCountrySelections: { 'south asia': ['pakistan'] } },
        filterState: { blockedRegions: ['south asia'], allowedUsers: ['demo_account'] } });
    const country = e.button('location'); country.focus();
    assert.equal(e.control.element.dataset.exempt, 'true');
    assert.equal(country.dataset.coverage, 'region');
    assert.match(country.dataset.xTooltipDescription, /South Asia.*Always Show takes priority/);
    e.fail = 'denied'; country.click(); await e.tick();
    assert.deepEqual(e.state.blockedCountries, []); assert.deepEqual(e.state.blockedRegions, ['south asia']);
    assert.equal(country.dataset.coverage, 'region'); assert.equal(country.getAttribute('aria-pressed'), 'false');
    assert.equal(e.control.status.dataset.tone, 'error'); assert.match(e.control.status.textContent, /Could not save/);
    assert.equal(e.document.activeElement, country); assert.equal(e.button('account').getAttribute('aria-pressed'), 'false');
    assert.deepEqual(e.calls, [{ type: MESSAGE_TYPES.SET_BLOCKED_COUNTRIES, payload: { action: 'add', country: 'pakistan' } }]);
});

await check('Pending direct-country additions retain their target across live regional changes and reject duplicate account/country clicks', async () => {
    const e = quickEnvironment({ info: { location: 'Pakistan', meta: { restId: ACCOUNT_ID } },
        settings: { regionCountrySelections: { 'south asia': ['pakistan'] } }, filterState: { blockedRegions: ['south asia'] } });
    const country = e.button('location'); country.focus(); e.hold = true;
    country.click(); country.click(); e.button('account').click(); await e.tick();
    assert.equal(e.calls.length, 1); assert.deepEqual(e.state.blockedCountries, []);
    assert.equal(country.dataset.coverage, 'region'); assert.equal(country.getAttribute('aria-disabled'), 'true');
    e.state.blockedRegions = []; e.control.refresh();
    assert.notEqual(country.dataset.coverage, 'region'); assert.equal(country.getAttribute('aria-disabled'), 'true');
    await e.release();
    assert.deepEqual(e.state.blockedCountries, ['pakistan']); assert.deepEqual(e.state.blockedRegions, []);
    assert.equal(country.getAttribute('aria-pressed'), 'true'); assert.equal(country.getAttribute('aria-disabled'), 'false');
    assert.equal(e.button('account').getAttribute('aria-pressed'), 'false'); assert.equal(e.document.activeElement, country);
    assert.deepEqual(e.calls, [{ type: MESSAGE_TYPES.SET_BLOCKED_COUNTRIES, payload: { action: 'add', country: 'pakistan' } }]);
});

await check('Quick account and region actions edit only their exact source with lossless IDs', async () => {
    const e = quickEnvironment({ info: { location: 'Africa', meta: { restId: MAX_ID } } });
    assert.equal(e.button('location').children[1].textContent, 'Region');
    assert.match(e.button('location').getAttribute('aria-label'), /^Region: Hide Africa\./);
    assert.match(e.button('location').dataset.xTooltipHeading, /Hide Africa/);
    e.button('account').click(); await e.tick();
    assert.deepEqual(e.calls[0], { type: MESSAGE_TYPES.SET_BLOCKED_ACCOUNTS, payload: { action: 'add', accountId: MAX_ID } });
    e.button('location').click(); await e.tick();
    assert.deepEqual(e.calls[1], { type: MESSAGE_TYPES.SET_BLOCKED_REGIONS, payload: { action: 'add', region: 'africa' } });
    assert.deepEqual(e.state.blockedAccounts, [MAX_ID]);
    assert.deepEqual(e.state.blockedRegions, ['africa']);
    assert.deepEqual(e.state.blockedCountries, []);
    e.button('account').click(); await e.tick();
    assert.deepEqual(e.state.blockedAccounts, []);
});

await check('Unknown IDs stay unavailable until already-normal metadata enrichment supplies a valid ID', async () => {
    const e = quickEnvironment({ info: {} }), account = e.button('account');
    assert.equal(account.getAttribute('aria-disabled'), 'true');
    account.click(); await e.tick();
    assert.deepEqual(e.calls, []);
    e.control.updateInfo({ meta: { restId: ACCOUNT_ID } });
    assert.equal(account.getAttribute('aria-disabled'), 'false');
    assert.equal(account, e.button('account'));
    account.click(); await e.tick();
    assert.deepEqual(e.state.blockedAccounts, [ACCOUNT_ID]);
});

await check('Quick writes never optimistically change filters and keep one shared operation across reopen', async () => {
    const e = quickEnvironment(); e.hold = true;
    e.button('account').click(); e.button('account').click(); await e.tick();
    assert.deepEqual(e.state.blockedAccounts, []);
    assert.equal(e.calls.length, 1);
    assert.equal(e.control.pending, true);
    e.control.dispose(); e.control = e.mount(); e.button('account').click(); await e.tick();
    assert.equal(e.calls.length, 1);
    assert.equal(e.button('account').getAttribute('aria-disabled'), 'true');
    await e.release();
    assert.equal(e.button('account').getAttribute('aria-disabled'), 'false');
    assert.equal(e.button('account').children[1].textContent, 'Account');
    assert.match(e.button('account').getAttribute('aria-label'), /Remove account filter/);
    assert.deepEqual(e.state.blockedAccounts, [ACCOUNT_ID]);
});

await check('Failed or unconfirmed quick writes announce errors and leave prior rule state unchanged', async () => {
    for (const failure of ['transport', 'denied', 'malformed']) {
        const e = quickEnvironment(); e.fail = failure;
        e.button('account').click(); await e.tick();
        assert.deepEqual(e.state.blockedAccounts, [], failure);
        assert.match(e.control.status.textContent, /Could not save/);
        assert.equal(e.control.status.dataset.tone, 'error', 'Errors expose the visible status treatment');
        assert.equal(e.control.status.getAttribute('aria-live'), 'polite');
        assert.equal(e.control.pending, false);
        assert.equal(e.button('account').getAttribute('aria-disabled'), 'false');
    }
});

await check('Late quick-save feedback is bound to the captured immutable ID or location, never replacement metadata', async () => {
    for (const kind of ['account', 'location']) {
        const e = quickEnvironment(); e.hold = true;
        e.button(kind).click(); await e.tick();
        e.control.updateInfo({ location: 'Germany', meta: { restId: OTHER_ID } });
        await e.release();
        assert.doesNotMatch(e.control.status.textContent, /added|removed|saved/i, kind);
        assert.deepEqual(e.state.blockedAccounts, kind === 'account' ? [ACCOUNT_ID] : []);
        assert.deepEqual(e.state.blockedCountries, kind === 'location' ? ['belgium'] : []);
    }
});

await check('Completed feedback clears when identity changes and Always Show remains an explicit priority notice', async () => {
    const e = quickEnvironment();
    e.button('account').click(); await e.tick();
    assert.match(e.control.status.textContent, /Account filter added/);
    assert.equal(e.control.status.dataset.tone, 'success', 'Success feedback can remain screen-reader-only without hiding errors');
    e.control.updateInfo({ meta: { restId: OTHER_ID } });
    assert.doesNotMatch(e.control.status.textContent, /added/);
    e.state.allowedUsers = ['demo_account']; e.control.refresh();
    assert.match(e.control.status.textContent, /Always Show takes priority/);
    assert.equal(e.control.element.dataset.exempt, 'true');
    for (const kind of ['location', 'account']) {
        assert.match(e.button(kind).dataset.xTooltipDescription, /Always Show takes priority/);
        assert.equal(e.button(kind).getAttribute('title'), null);
    }
    assert.deepEqual(e.state.blockedAccounts, [ACCOUNT_ID]);
});

console.log(`\n${groups} quick-filter regression groups passed.`);
