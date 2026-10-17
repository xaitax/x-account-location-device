/**
 * Exercise production badge-snapshot and authoritative-info synchronization with
 * small DOM doubles. No browser session, requests, clipboard or downloads.
 * Run with node scripts/check-hover-sync.mjs.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { parseAst } from 'rollup/parseAst';
import { LRUCache } from '../src/shared/lru-cache.js';

function productionFunctions(path, names) {
    const source = fs.readFileSync(new URL(path, import.meta.url), 'utf8');
    const declarations = parseAst(source).body
        .map(node => node.type === 'ExportNamedDeclaration' ? node.declaration : node)
        .filter(node => node?.type === 'FunctionDeclaration' && names.includes(node.id.name));
    assert.equal(declarations.length, names.length, `${path}: exercise every requested production function`);
    return declarations.map(node => source.slice(node.start, node.end)).join('\n');
}

const productionSource = [
    productionFunctions('../src/content/hovercard.js', ['hasNewerObservation']),
    productionFunctions('../src/content/ui.js', ['updateBadgeInfo', 'createBadge']),
    productionFunctions('../src/content/content-script.js', ['setupAuthoritativeInfoListener'])
].join('\n');

function environment() {
    const userInfoCache = new LRUCache(1000);
    const badgeSnapshots = new WeakMap();
    const microtasks = [];
    const rows = [];
    const replacements = [];
    const filterPasses = [];
    let filterSyncs = 0;
    const document = {
        activeElement: null,
        querySelectorAll: () => rows,
        createElement: () => { throw new Error('Compatible snapshots must not create new badge DOM'); }
    };
    let listener;
    let rebuilds = 0;
    const current = {
        disposed: false,
        listen: (_target, type, callback) => {
            assert.equal(type, 'xposed:authoritative-info');
            listener = callback;
        }
    };
    const context = vm.createContext({
        userInfoCache, badgeSnapshots, document,
        CSS_CLASSES: { INFO_BADGE: 'badge' }, SELECTORS: { USERNAME: 'user', USER_CELL: 'cell' },
        filterSets: { blockedAffiliations: new Set(), blockedAccounts: new Set() },
        updateBlockedTweets: (...args) => filterPasses.push(args),
        currentFilters: () => ({}),
        queueMicrotask: callback => microtasks.push(callback),
        hovercard: { replaceAnchor: (...args) => replacements.push(args), syncFilters: () => { filterSyncs++; } },
        memoizedProcessElementSafe: row => {
            rebuilds++;
            row.dataset.xScreenName = row.handle;
            row.dataset.xProcessed = 'true';
            row.badge = makeBadge(row.handle, userInfoCache.get(row.handle));
        }
    });
    vm.runInContext(`${productionSource}
        globalThis.setup = setupAuthoritativeInfoListener;
        globalThis.update = updateBadgeInfo;
        globalThis.create = createBadge;`, context);
    context.setup(current);

    function makeBadge(handle, info) {
        const badge = {
            isConnected: true,
            contains: () => false,
            remove: () => { badge.isConnected = false; },
            querySelector: () => null
        };
        badgeSnapshots.set(badge, { screenName: handle.toLowerCase(), info });
        return badge;
    }
    function row(handle, info) {
        const element = {
            handle,
            dataset: { xScreenName: handle, xProcessed: 'true' },
            badge: makeBadge(handle, info),
            querySelector: () => element.badge
        };
        rows.push(element);
        return element;
    }
    return {
        userInfoCache, badgeSnapshots, current, row, replacements, filterPasses, context,
        event: (screenName, info) => listener({ detail: { screenName, info } }),
        flush: () => { while (microtasks.length) microtasks.shift()(); },
        rebuilds: () => rebuilds, filterSyncs: () => filterSyncs
    };
}

let groups = 0;
function check(name, run) {
    run();
    groups++;
    console.log(`PASS ${name}`);
}

const now = Date.now();
const partial = {
    location: 'Belgium', device: 'Web', timestamp: now - 100,
    meta: { restId: '123', partial: true }
};
const rich = {
    ...partial, timestamp: now,
    meta: { restId: '123', usernameChanges: 0, createdAt: '2010' }
};

check('New identity metadata re-derives exact-account rules and refreshes quick actions without badge replacement', () => {
    const e = environment();
    const lean = { ...partial, meta: { partial: true } };
    const author = e.row('alpha', lean);
    const badge = author.badge;
    e.userInfoCache.set('alpha', lean);
    e.context.filterSets.blockedAccounts.add('123');
    e.event('alpha', rich);
    e.flush();
    assert.equal(author.badge, badge);
    assert.equal(e.rebuilds(), 0);
    assert.equal(e.filterPasses.length, 1);
    assert.equal(e.filterPasses[0][1].has('alpha'), true);
    assert.equal(e.filterSyncs(), 1);
});

check('Direct snapshot updates and existing-badge reprocessing retain account ownership and newer data', () => {
    const e = environment();
    const author = e.row('alpha', partial);
    const badge = author.badge;
    assert.equal(e.context.update(badge, 'ALPHA', rich), true);
    assert.equal(e.badgeSnapshots.get(badge).info, rich);
    assert.equal(partial.meta.createdAt, undefined, 'Do not mutate the original response');
    assert.equal(e.context.update(badge, 'beta', rich), false);
    assert.equal(e.context.update(badge, 'alpha', { ...rich, location: 'France' }), false);
    assert.equal(e.context.update(badge, 'alpha', { ...rich, locationAccurate: false }), false);
    assert.equal(e.context.update(badge, 'alpha', { ...rich, meta: { restId: '999' } }), false);
    assert.equal(e.context.update(badge, 'alpha', partial), false, 'Older direct updates cannot overwrite rich data');
    assert.equal(e.context.update(badge, 'alpha', { ...rich, timestamp: undefined }), false);
    assert.equal(e.badgeSnapshots.get(badge).info, rich);

    const enriched = { ...rich, meta: { ...rich.meta, verifiedType: 'blue' } };
    e.context.create(author, 'ALPHA', enriched, false, {});
    assert.equal(e.badgeSnapshots.get(badge).info, enriched, 'Reprocessing reads the latest compatible snapshot');
    e.context.create(author, 'alpha', partial, false, {});
    assert.equal(e.badgeSnapshots.get(badge).info, enriched, 'Reprocessing cannot roll back an older snapshot');
    assert.equal(author.badge, badge);
    assert.equal(e.rebuilds(), 0);
});

check('Metadata-only enrichment updates case aliases without replacing badge DOM', () => {
    const e = environment();
    const a = e.row('Alpha', partial);
    const b = e.row('alpha', partial);
    const other = e.row('beta', partial);
    const original = a.badge;
    const unrelated = other.badge;
    e.userInfoCache.set('Alpha', partial);
    e.userInfoCache.set('alpha', partial);
    e.event('ALPHA', rich);
    e.flush();
    assert.equal(e.rebuilds(), 0);
    assert.equal(e.replacements.length, 0);
    assert.equal(a.badge, original);
    assert.equal(other.badge, unrelated);
    assert.equal(e.badgeSnapshots.get(original).info, rich);
    assert.equal(e.badgeSnapshots.get(b.badge).info, rich);
    assert.equal(e.badgeSnapshots.get(unrelated).info, partial);
    assert.equal(e.userInfoCache.get('Alpha'), rich);
    assert.equal(e.userInfoCache.get('alpha'), rich);
    assert.equal(partial.meta.createdAt, undefined);
});

check('Visible signal changes retain the existing replacement and anchor path', () => {
    const e = environment();
    const author = e.row('alpha', partial);
    const original = author.badge;
    e.userInfoCache.set('alpha', partial);
    e.event('alpha', { ...rich, location: 'France' });
    e.flush();
    assert.equal(e.rebuilds(), 1);
    assert.equal(original.isConnected, false);
    assert.equal(e.replacements.length, 1);
    assert.equal(e.replacements[0][0], original);
    assert.equal(e.replacements[0][1], author.badge);
});

check('A newer case-alias observation rejects late authoritative signal rollback', () => {
    const e = environment();
    const author = e.row('alpha', rich);
    e.userInfoCache.set('ALPHA', rich);
    e.event('alpha', partial);
    e.flush();
    assert.equal(e.rebuilds(), 0);
    assert.equal(e.userInfoCache.has('alpha'), false);
    assert.equal(e.badgeSnapshots.get(author.badge).info, rich);
});

check('Recycled author roots and disposed page sessions ignore queued enrichment work', () => {
    const e = environment();
    const author = e.row('alpha', partial);
    e.userInfoCache.set('alpha', partial);
    e.event('alpha', rich);
    author.dataset.xScreenName = 'beta';
    e.flush();
    assert.equal(e.rebuilds(), 0);
    assert.equal(e.badgeSnapshots.get(author.badge).info, partial);

    const disposed = environment();
    const oldAuthor = disposed.row('alpha', partial);
    disposed.userInfoCache.set('alpha', partial);
    disposed.event('alpha', rich);
    disposed.current.disposed = true;
    disposed.flush();
    assert.equal(disposed.rebuilds(), 0);
    assert.equal(disposed.badgeSnapshots.get(oldAuthor.badge).info, partial);
});

check('Affiliation metadata re-derives filter visibility without replacing an unchanged badge', () => {
    const e = environment();
    e.row('alpha', partial);
    e.context.filterSets.blockedAffiliations.add('primevideo');
    e.userInfoCache.set('alpha', partial);
    e.event('alpha', rich);
    e.flush();
    assert.equal(e.rebuilds(), 0);
    assert.equal(e.filterPasses.length, 1);
    assert.equal(e.filterPasses[0][1].has('alpha'), true);
});

console.log(`${groups} hover synchronization regression groups passed.`);
