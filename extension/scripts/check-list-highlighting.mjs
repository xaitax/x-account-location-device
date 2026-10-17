/**
 * Issue #15: exercise the production List-mode resolver, author/language/quote
 * verdicts and settings persistence. No browser, X requests or account changes.
 * Run with node scripts/check-list-highlighting.mjs.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { parseAst } from 'rollup/parseAst';
import { DEFAULT_SETTINGS, STORAGE_KEYS } from '../src/shared/constants.js';
import { ACCOUNT_COUNT_FILTERS, isAccountCountThreshold } from '../src/shared/account-counts.js';
import { BADGE_SIZES, normalizeBadgeSize } from '../src/shared/badge-appearance.js';
import { normalizeRegionCountrySelections } from '../src/shared/region-membership.js';

function productionDeclarations(path, names) {
    const source = fs.readFileSync(new URL(path, import.meta.url), 'utf8');
    const declarations = parseAst(source).body
        .map(node => node.type === 'ExportNamedDeclaration' ? node.declaration : node);
    return names.map(name => {
        const declaration = declarations.find(node =>
            ['FunctionDeclaration', 'ClassDeclaration'].includes(node?.type) && node.id.name === name);
        assert.ok(declaration, `Exercise the actual production ${name} declaration`);
        return source.slice(declaration.start, declaration.end);
    }).join('\n');
}

const observerSource = productionDeclarations('../src/content/observer.js', [
    'shouldHighlightMatches', 'isAuthorExempt', 'resolveAuthorBlockState',
    'resolveBlockReasons', 'applyBlockState', 'applyLanguageBlock'
]);
const storageSource = productionDeclarations('../src/shared/storage.js', ['SettingsStorage', 'nextStateRevision']);

function node({ quote = false, focal = false, language = '', author = 'filtered' } = {}) {
    const classes = new Set();
    return {
        quote, focal, language, author, dataset: {},
        classList: {
            contains: name => classes.has(name),
            toggle: (name, force) => force ? classes.add(name) : classes.delete(name)
        }
    };
}

function environment() {
    const following = new Set();
    const profile = new Map();
    const location = { pathname: '/home' };
    const context = vm.createContext({
        location,
        isFollowing: author => following.has(author),
        getLoggedInUsername: () => 'reader',
        isInsideQuoteTweet: element => element.quote,
        canonicalCountry: value => typeof value === 'string' ? value.toLowerCase() : '',
        getProfile: author => profile.get(author) || null,
        matchingBlockedRegions: (country, regions) => country === 'belgium' && regions.has('europe') ? ['europe'] : [],
        extractDisplayName: element => element.name || 'Filtered Author',
        hasBlockedTag: (name, tags) => [...tags].some(tag => name.toLowerCase().includes(tag)),
        hasBlockedBio: () => false,
        hasBlockedLink: () => false,
        hasBlockedAccountLabel: () => false,
        hasBlockedAffiliation: () => false,
        resolveAccountCountReasons: () => [],
        displayNameCounts: new WeakMap(),
        countDisplayNameDigits: text => (text.match(/\d/g) || []).length,
        CSS_CLASSES: { TWEET_BLOCKED: 'x-tweet-blocked' },
        isFocalTweet: tweet => tweet?.focal === true,
        releaseQuoteCard: () => {},
        syncQuotePlaceholder: () => {},
        filterStatisticsReporter: null,
        getMainTweetLanguage: tweet => tweet.language,
        isMainAuthorExempt: (tweet, allowed, settings) => context.isAuthorExempt(tweet.author, allowed, settings)
    });
    vm.runInContext(`${observerSource}\nObject.assign(globalThis, {
        shouldHighlightMatches, isAuthorExempt, resolveAuthorBlockState,
        applyBlockState, applyLanguageBlock
    });`, context);
    return { context, following, profile, location };
}

function filters(settings = {}, extra = {}) {
    return {
        settings: { ...DEFAULT_SETTINGS, ...settings },
        blockedCountries: new Set(), blockedRegions: new Set(), blockedTags: new Set(),
        blockedBioTags: new Set(), blockedLinks: new Set(), blockedPcf: new Set(),
        blockedAffiliations: new Set(), blockedLanguages: new Set(), allowedUsers: new Set(),
        ...extra
    };
}

function applyAuthor(environment, element, tweet, currentFilters, info = {}) {
    const state = environment.context.resolveAuthorBlockState(
        element, tweet?.author || 'filtered', info, currentFilters, tweet, false
    );
    return environment.context.applyBlockState(element, tweet, state);
}

let groups = 0;
async function check(name, run) {
    await run();
    groups++;
    console.log(`PASS ${name}`);
}

await check('Only exact numeric curated List feed routes receive the opt-in override', () => {
    const e = environment();
    for (const path of ['/i/lists/1', '/i/lists/123/', '/i/lists/2097352012367015936']) {
        assert.equal(e.context.shouldHighlightMatches({ highlightInLists: true }, path), true, path);
    }
    for (const path of ['/home', '/explore', '/notifications', '/i/lists', '/i/lists/',
        '/i/lists/0', '/i/lists/01', '/i/lists/-1', '/i/lists/abc', '/i/lists/1/members',
        '/i/lists/1/followers', '/i/lists/1/edit', '/i/lists/1//', '/i/lists/1?x=1',
        '/i/lists/1#members', '/someone', '/someone/lists', '/someone/status/1',
        '/someone/followers', '/someone/verified_followers', '/someone/following',
        undefined, null, 123]) {
        assert.equal(e.context.shouldHighlightMatches({ highlightInLists: true }, path), false, String(path));
    }
});

await check('Default is off and only true booleans enable either highlight preference', () => {
    const e = environment();
    assert.equal(DEFAULT_SETTINGS.highlightInLists, false);
    e.location.pathname = '/i/lists/123';
    assert.equal(e.context.shouldHighlightMatches(DEFAULT_SETTINGS), false);
    for (const value of [undefined, null, false, 0, 1, '', 'true', 'false', {}, []]) {
        assert.equal(e.context.shouldHighlightMatches({ highlightInLists: value }), false);
        assert.equal(e.context.shouldHighlightMatches({ highlightBlockedTweets: value }), false);
    }
    assert.equal(e.context.shouldHighlightMatches({ highlightInLists: true }), true);
});

await check('General Highlight is unaffected by List opt-in and route', () => {
    const e = environment();
    for (const path of ['/home', '/someone', '/i/lists/1', '/i/lists/1/members']) {
        for (const highlightInLists of [true, false, undefined]) {
            assert.equal(e.context.shouldHighlightMatches({ highlightBlockedTweets: true, highlightInLists }, path), true);
        }
    }
});

await check('Country, region and display-name author verdicts use effective mode without changing saved preferences', () => {
    for (const reason of ['country', 'region', 'tag']) {
        const e = environment();
        const author = node();
        author.dataset.xCountry = 'Belgium';
        const tweet = node();
        const f = filters({ highlightInLists: true }, {
            blockedCountries: new Set(reason === 'country' ? ['belgium'] : []),
            blockedRegions: new Set(reason === 'region' ? ['europe'] : []),
            blockedTags: new Set(reason === 'tag' ? ['filtered author'] : [])
        });
        assert.equal(applyAuthor(e, author, tweet, f).hide, true, reason);
        e.location.pathname = '/i/lists/123';
        assert.equal(applyAuthor(e, author, tweet, f).highlight, true, reason);
        assert.equal(author.dataset.xBlock, 'highlight');
        assert.equal(tweet.classList.contains('x-tweet-blocked'), false);
        e.location.pathname = '/home';
        assert.equal(applyAuthor(e, author, tweet, f).hide, true, reason);
        assert.equal(f.settings.highlightBlockedTweets, false, 'The general preference must not be mutated');
    }
});

await check('Settings changes rederive existing author markers instead of keeping stale Hide or Highlight', () => {
    const e = environment();
    e.location.pathname = '/i/lists/123';
    const author = node(), tweet = node();
    author.dataset.xCountry = 'Belgium';
    const f = filters({}, { blockedCountries: new Set(['belgium']) });
    assert.equal(applyAuthor(e, author, tweet, f).hide, true);
    f.settings.highlightInLists = true;
    assert.equal(applyAuthor(e, author, tweet, f).highlight, true);
    f.settings.highlightInLists = false;
    assert.equal(applyAuthor(e, author, tweet, f).hide, true);
    f.blockedCountries.clear();
    assert.equal(applyAuthor(e, author, tweet, f).highlight, false);
    assert.equal(author.dataset.xBlock, '');
    assert.equal(tweet.classList.contains('x-tweet-highlighted'), false);
});

await check('Location-warning filtering follows effective mode but nonmatching authors remain unmarked', () => {
    const e = environment();
    e.location.pathname = '/i/lists/123';
    const author = node(), tweet = node();
    const f = filters({ highlightInLists: true, showVpnUsers: false });
    assert.equal(applyAuthor(e, author, tweet, f, { locationAccurate: false }).highlight, true);
    assert.equal(tweet.classList.contains('x-tweet-vpn-blocked'), false);
    assert.equal(applyAuthor(e, author, tweet, f, { locationAccurate: true }).highlight, false);
    assert.equal(author.dataset.xBlock, '');
});

await check('Quote markers honor List mode independently and never hide their containing post', () => {
    const e = environment();
    const quote = node({ quote: true }), tweet = node();
    quote.dataset.xCountry = 'Belgium';
    const f = filters({ highlightInLists: true }, { blockedCountries: new Set(['belgium']) });
    assert.equal(applyAuthor(e, quote, tweet, f).hide, false);
    assert.equal(quote.dataset.xQuoteBlock, 'hide');
    e.location.pathname = '/i/lists/123';
    assert.equal(applyAuthor(e, quote, tweet, f).highlight, true);
    assert.equal(quote.dataset.xQuoteBlock, 'highlight');
    assert.equal(quote.dataset.xBlock, undefined);
    assert.equal(tweet.classList.contains('x-tweet-blocked'), false);
    quote.dataset.xQuoteBlock = 'shown';
    e.location.pathname = '/home';
    applyAuthor(e, quote, tweet, f);
    assert.equal(quote.dataset.xQuoteBlock, 'shown', 'Explicitly revealed quote stays revealed');
});

await check('Language-only matches use the same override and clear stale markers when a rule is removed', () => {
    const e = environment();
    const tweet = node({ language: 'es' });
    const settings = { ...DEFAULT_SETTINGS, highlightInLists: true };
    const languages = new Set(['es']);
    e.context.applyLanguageBlock(tweet, languages, settings, new Set());
    assert.equal(tweet.dataset.xLangBlock, 'hide');
    e.location.pathname = '/i/lists/123';
    e.context.applyLanguageBlock(tweet, languages, settings, new Set());
    assert.equal(tweet.dataset.xLangBlock, 'highlight');
    settings.highlightInLists = false;
    e.context.applyLanguageBlock(tweet, languages, settings, new Set());
    assert.equal(tweet.dataset.xLangBlock, 'hide');
    e.context.applyLanguageBlock(tweet, new Set(), settings, new Set());
    assert.equal(tweet.dataset.xLangBlock, undefined);
    tweet.language = 'und';
    e.context.applyLanguageBlock(tweet, new Set(['und']), settings, new Set());
    assert.equal(tweet.dataset.xLangBlock, undefined);
});

await check('Always Show, the reader and followed-account exemptions are retained for author and language rules', () => {
    for (const author of ['allowed', 'reader', 'following']) {
        const e = environment();
        e.location.pathname = '/i/lists/123';
        e.following.add('following');
        const tweet = node({ author, language: 'es' }), element = node();
        element.dataset.xCountry = 'Belgium';
        const f = filters({ highlightInLists: true, alwaysShowFollowing: true }, {
            allowedUsers: new Set(['allowed']), blockedCountries: new Set(['belgium'])
        });
        assert.equal(applyAuthor(e, element, tweet, f).highlight, false, author);
        e.context.applyLanguageBlock(tweet, new Set(['es']), f.settings, f.allowedUsers);
        assert.equal(tweet.dataset.xLangBlock, undefined, author);
    }
});

await check('Focal posts, people rows and explicitly revealed related posts keep their existing visibility rules', () => {
    const e = environment();
    for (const state of [{ focal: true }, { shown: true }, { neverHide: true }]) {
        const tweet = node({ focal: state.focal });
        if (state.shown) tweet.dataset.xRelatedBlock = 'shown';
        const element = node();
        assert.equal(e.context.applyBlockState(element, tweet, {
            isListBlocked: true, isVpnHidden: false, highlightMode: false, neverHide: !!state.neverHide
        }).hide, false);
        assert.equal(element.dataset.xBlock, 'highlight');
    }
    const focal = node({ language: 'es', focal: true });
    e.context.applyLanguageBlock(focal, new Set(['es']), DEFAULT_SETTINGS, new Set());
    assert.equal(focal.dataset.xLangBlock, 'highlight');
});

await check('Storage defaults and legacy/corrupt values normalize to off; true survives reload', async () => {
    for (const storedValue of [undefined, null, false, 0, 1, 'true', 'false', true]) {
        const stored = storedValue === undefined ? {} : { highlightInLists: storedValue };
        const context = vm.createContext({
            DEFAULT_SETTINGS, STORAGE_KEYS, ACCOUNT_COUNT_FILTERS, isAccountCountThreshold,
            BADGE_SIZES, normalizeBadgeSize, normalizeRegionCountrySelections,
            browserAPI: { storage: { local: { get: async () => ({ [STORAGE_KEYS.SETTINGS]: stored }) } } },
            console: { log() {}, error() {} }
        });
        vm.runInContext(`${storageSource}\nglobalThis.store = new SettingsStorage();`, context);
        await context.store.load();
        assert.equal(context.store.get('highlightInLists'), storedValue === true);
    }
});

await check('Persistence rejects nonboolean List preferences and writes valid booleans unchanged', async () => {
    const writes = [];
    const context = vm.createContext({
        DEFAULT_SETTINGS, STORAGE_KEYS, ACCOUNT_COUNT_FILTERS, isAccountCountThreshold,
        BADGE_SIZES, normalizeBadgeSize, normalizeRegionCountrySelections,
        browserAPI: { storage: { local: { set: async values => writes.push(values) } } },
        console: { log() {}, error() {} }
    });
    vm.runInContext(`${storageSource}\nglobalThis.store = new SettingsStorage();`, context);
    for (const invalid of [undefined, null, 0, 1, 'true', 'false', {}, []]) {
        await assert.rejects(context.store.save({ ...DEFAULT_SETTINGS, highlightInLists: invalid }), /Invalid List highlighting preference/);
    }
    assert.equal(writes.length, 0);
    for (const value of [true, false]) {
        await context.store.save({ ...DEFAULT_SETTINGS, highlightInLists: value });
        assert.equal(writes.at(-1)[STORAGE_KEYS.SETTINGS].highlightInLists, value);
        assert.equal(writes.at(-1)[STORAGE_KEYS.SETTINGS].highlightBlockedTweets, false);
    }
});

console.log(`\n${groups} production List-highlighting regression groups passed.`);
