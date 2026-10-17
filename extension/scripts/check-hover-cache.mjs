/** Production cache/transport regressions, with an isolated clock and no network or browser session. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { parseAst } from 'rollup/parseAst';
import { CACHE_CONFIG, STORAGE_KEYS, affiliationWasChecked } from '../src/shared/constants.js';
import { parseAccountResponse } from '../src/shared/account-response.js';

const originalNow = Date.now;
const originalSetTimeout = globalThis.setTimeout;
const originalClearTimeout = globalThis.clearTimeout;
const originalBrowser = globalThis.browser;
let now = 1800000000000;
let nextTimer = 0;
const timers = new Map();
let stored = {};
Date.now = () => now;
globalThis.setTimeout = callback => { const id = ++nextTimer; timers.set(id, callback); return id; };
globalThis.clearTimeout = id => timers.delete(id);
globalThis.browser = {
    runtime: { getManifest: () => ({}) },
    storage: {
        local: {
            get: async key => ({ [key]: stored[key] }),
            set: async patch => { stored = { ...stored, ...structuredClone(patch) }; },
            remove: async key => { delete stored[key]; }
        }
    }
};

const { UserCacheStorage } = await import('../src/shared/storage.js');
let checks = 0;
async function check(name, action) {
    await action();
    checks += 1;
    console.log(`✓ ${name}`);
}
const full = (timestamp = now, overrides = {}) => ({
    ...parseAccountResponse({ data: { user_result_by_screen_name: { result: {
        core: { screen_name: 'Example', name: 'Example', created_at: '2011-10-12' }, rest_id: '123',
        about_profile: { account_based_in: 'Switzerland', source: 'Switzerland App Store', location_accurate: true },
        is_blue_verified: true, verification_info: { reason: { verified_since_msec: '1323727113221' } }
    } } } }, 'Example'),
    timestamp, fromCloud: false,
    ...overrides
});
const partial = (timestamp = now, overrides = {}) => ({
    location: 'Switzerland', device: 'Switzerland App Store', locationAccurate: true,
    timestamp, fromCloud: true, meta: { partial: true, restId: '123', affiliateUsername: null },
    ...overrides
});

try {
    await check('mixed-case handles share one cache entry and deletion', () => {
        const cache = new UserCacheStorage();
        assert.equal(cache.set(' ExampleName ', full()), true);
        assert.equal(cache.size, 1);
        assert.equal(cache.get('examplename').meta.name, 'Example');
        assert.equal(cache.has('EXAMPLENAME'), true);
        assert.equal(cache.delete('eXaMpLeNaMe'), true);
        assert.equal(cache.has('ExampleName'), false);
    });

    await check('older partial writes cannot erase newer full metadata or signals', () => {
        const cache = new UserCacheStorage();
        cache.set('Example', full());
        cache.set('EXAMPLE', partial(now - 1000, { location: 'United Kingdom', device: 'Web' }));
        assert.equal(cache.get('example').location, 'Switzerland');
        assert.equal(cache.get('example').meta.blueVerified, true);
        assert.equal(cache.get('example').timestamp, now);
        assert.equal(cache.cache.get('example').expiry, now + CACHE_CONFIG.EXPIRY_MS);
    });

    await check('newer changed signals do not inherit stale full metadata', () => {
        const cache = new UserCacheStorage();
        cache.set('Example', full(now - 1000));
        cache.set('example', partial(now, { location: 'United Kingdom', device: 'Web' }));
        const value = cache.get('example');
        assert.equal(value.location, 'United Kingdom');
        assert.equal(value.meta.partial, true);
        assert.equal(value.meta.blueVerified, undefined);
        assert.equal(value.timestamp, now);
    });

    await check('newer compatible subsets retain rich details without changing their own source deadline', () => {
        const cache = new UserCacheStorage();
        cache.set('Example', full(now - 1000));
        const metadataExpiry = cache.get('example').metaExpiresAt;
        cache.set('example', partial());
        const value = cache.get('EXAMPLE');
        assert.notEqual(value.meta.partial, true);
        assert.equal(value.meta.blueVerified, true);
        assert.equal(value.timestamp, now);
        assert.equal(value.metaTimestamp, now - 1000);
        assert.equal(value.metaExpiresAt, metadataExpiry);
        assert.equal(cache.cache.get('example').expiry, now + CACHE_CONFIG.EXPIRY_MS);
    });

    await check('real cloud null defaults preserve the complete projection and affiliation artwork', () => {
        const cache = new UserCacheStorage();
        const prior = full(now - 1000);
        Object.assign(prior.meta, { usernameChanges: 0, affiliateUsername: 'PrimeVideo',
            affiliate: { name: 'Prime Video', badgeUrl: 'https://pbs.twimg.com/profile_images/example.png',
                url: 'https://x.com/PrimeVideo' } });
        cache.set('Example', prior);
        const before = cache.get('example');
        const cloud = partial(now, { meta: { partial: true, affiliate: null, affiliateUsername: null,
            restId: '123', createdAt: null, usernameChanges: null } });
        cache.set('example', cloud);
        const value = cache.get('example');
        assert.deepEqual(value.meta, prior.meta);
        assert.equal(value.metaTimestamp, before.metaTimestamp);
        assert.equal(value.metaExpiresAt, before.metaExpiresAt);
        assert.equal(UserCacheStorage.hasCompleteMetadata(value), true);
    });

    await check('new observed shared metadata conflicts stay partial and require true enrichment', () => {
        for (const conflicting of [{ usernameChanges: 1 }, { createdAt: '2012-01-01' },
            { affiliate: { name: 'Another Organization' } }, { affiliateUsername: 'AnotherOrganization' }]) {
            const cache = new UserCacheStorage();
            const prior = full(now - 1000); prior.meta.usernameChanges = 0;
            cache.set('Example', prior);
            cache.set('example', partial(now, { meta: { partial: true, restId: '123', ...conflicting } }));
            assert.equal(UserCacheStorage.hasCompleteMetadata(cache.get('example')), false);
            assert.equal(cache.get('example').meta.blueVerified, undefined);
        }
    });

    await check('equivalent created instants and either known affiliation label preserve complete metadata', () => {
        const cache = new UserCacheStorage();
        const prior = full(now - 1000);
        Object.assign(prior.meta, { usernameChanges: 0, affiliateUsername: 'PrimeVideo', affiliate: { name: 'Prime Video' } });
        cache.set('Example', prior);
        cache.set('example', partial(now, { meta: { partial: true, restId: '123',
            createdAt: new Date(prior.meta.createdAt).toISOString(), usernameChanges: 0,
            affiliate: { name: 'Prime Video' }, affiliateUsername: 'PrimeVideo' } }));
        assert.deepEqual(cache.get('example').meta, prior.meta);
        assert.equal(UserCacheStorage.hasCompleteMetadata(cache.get('example')), true);
    });

    await check('conflicting IDs and changed accuracy do not reuse full metadata', () => {
        for (const candidate of [
            partial(now, { meta: { partial: true, restId: '456' } }),
            partial(now, { locationAccurate: false })
        ]) {
            const cache = new UserCacheStorage();
            cache.set('Example', full(now - 1000));
            cache.set('example', candidate);
            assert.equal(cache.get('example').meta.partial, true);
            assert.equal(cache.get('example').meta.blueVerified, undefined);
        }
    });

    await check('missing stable IDs never upgrade a newer partial observation', () => {
        for (const [previousId, candidateId] of [[null, '123'], ['123', null], [null, null]]) {
            const cache = new UserCacheStorage();
            const prior = full(now - 1000);
            prior.meta.restId = previousId;
            cache.set('Example', prior);
            const candidate = partial();
            candidate.meta.restId = candidateId;
            cache.set('Example', candidate);
            const value = cache.get('example');
            assert.equal(value.meta.partial, true);
            assert.equal(value.meta.blueVerified, undefined);
            assert.equal(UserCacheStorage.hasCompleteMetadata(value), false);
        }
    });

    await check('unmarked lean/page metadata is not mistaken for a completed full response', () => {
        const complete = full();
        assert.equal(UserCacheStorage.hasCompleteMetadata(complete), true);
        assert.equal(UserCacheStorage.hasCompleteMetadata({ ...complete, meta: {} }), false);
        assert.equal(UserCacheStorage.hasCompleteMetadata({ ...complete, meta: { restId: '123', name: 'Example' } }), false);
        const withoutVerification = { ...complete, meta: { ...complete.meta } };
        delete withoutVerification.meta.verifiedSinceMsec;
        assert.equal(UserCacheStorage.hasCompleteMetadata(withoutVerification), false);
        const knownEmpty = full();
        Object.assign(knownEmpty.meta, { blueVerified: false, verified: false, verifiedSinceMsec: null,
            avatarUrl: null, profileImageShape: null, createdAt: null, restId: null });
        assert.equal(UserCacheStorage.hasCompleteMetadata(knownEmpty), true, 'Known false/null must count as observed');
    });

    await check('partial signals preserve an exact shorter metadata expiry without renewing rich observation time', () => {
        const cache = new UserCacheStorage();
        const observedAt = now - 1000;
        const deadline = now + 1000;
        cache.set('Example', full(observedAt, { metaTimestamp: observedAt, metaExpiresAt: deadline }));
        cache.set('example', partial());
        assert.equal(cache.get('example').metaTimestamp, observedAt);
        assert.equal(cache.get('example').metaExpiresAt, deadline);
        now += 500;
        cache.set('example', partial());
        assert.equal(cache.get('example').metaTimestamp, observedAt);
        assert.equal(cache.get('example').metaExpiresAt, deadline);
        assert.equal(UserCacheStorage.hasCompleteMetadata(cache.get('example')), true);
        now = deadline;
        assert.equal(cache.has('example'), true, 'Location signals can remain cached after rich details expire');
        assert.equal(UserCacheStorage.hasCompleteMetadata(cache.get('example')), false);
        cache.set('example', partial());
        assert.equal(UserCacheStorage.hasCompleteMetadata(cache.get('example')), false);
        assert.equal(cache.get('example').meta.blueVerified, undefined);
    });

    await check('fresh undated live full responses establish metadata time, lean inputs do not', () => {
        const cache = new UserCacheStorage();
        const live = full();
        delete live.timestamp;
        cache.set('Example', live);
        assert.equal(cache.get('example').metaTimestamp, now);
        assert.equal(cache.get('example').metaExpiresAt, now + CACHE_CONFIG.EXPIRY_MS);
        assert.equal(UserCacheStorage.hasCompleteMetadata(cache.get('example')), true);
        cache.set('Another', { location: 'Switzerland', device: 'Web', meta: {} });
        assert.equal(cache.get('another').metaTimestamp, undefined);
        assert.equal(UserCacheStorage.hasCompleteMetadata(cache.get('another')), false);
    });

    await check('equal-time partial cloud responses cannot erase complete live records', () => {
        const cache = new UserCacheStorage();
        cache.set('Example', full());
        cache.set('example', partial(now, { device: 'Web' }));
        assert.equal(cache.get('example').device, 'Switzerland App Store');
        assert.equal(cache.get('example').meta.blueVerified, true);
        assert.equal(cache.get('example').fromCloud, false);
    });

    await check('repeated snapshots and expired candidates never renew source expiry', () => {
        const cache = new UserCacheStorage();
        const observedAt = now - CACHE_CONFIG.EXPIRY_MS + 1000;
        cache.set('Example', full(observedAt));
        const expiry = cache.cache.get('example').expiry;
        const value = cache.get('example');
        now += 250;
        cache.set('EXAMPLE', value);
        assert.equal(cache.cache.get('example').expiry, expiry);
        assert.equal(cache.set('Example', partial(now - CACHE_CONFIG.EXPIRY_MS)), false);
        now = expiry;
        assert.equal(cache.has('example'), false);
    });

    await check('disk saves remain compact and reload as partial metadata', async () => {
        const cache = new UserCacheStorage();
        cache.set('ExampleName', full());
        await cache.save();
        const persisted = stored[STORAGE_KEYS.CACHE].examplename;
        assert.deepEqual(Object.keys(persisted.value).sort(),
            ['af', 'device', 'fromCloud', 'location', 'locationAccurate', 'timestamp']);
        assert.equal(JSON.stringify(persisted).includes('verifiedSinceMsec'), false);
        assert.equal(JSON.stringify(persisted).includes('metaTimestamp'), false);
        assert.equal(JSON.stringify(persisted).includes('metaExpiresAt'), false);
        const reloaded = new UserCacheStorage();
        await reloaded.load();
        assert.equal(reloaded.get('EXAMPLENAME').meta.partial, true);
        assert.equal(reloaded.get('examplename').meta.name, undefined);
        assert.equal(reloaded.cache.get('examplename').expiry, persisted.expiry);
    });

    await check('re-selecting the same live cache snapshot does not dirty persisted state again', async () => {
        const cache = new UserCacheStorage(); cache.set('Example', full()); await cache.save();
        const previous = cache.get('example'); const expiry = cache.cache.get('example').expiry;
        assert.equal(cache.dirty, false); assert.equal(cache.saveTimeoutId, null);
        assert.equal(cache.set('EXAMPLE', previous), true);
        assert.equal(cache.get('example'), previous); assert.equal(cache.dirty, false);
        assert.equal(cache.saveTimeoutId, null); assert.equal(cache.cache.get('example').expiry, expiry);
    });

    await check('legacy mixed-case duplicate keys load the freshest observation, not iteration order', async () => {
        stored[STORAGE_KEYS.CACHE] = {
            ExampleName: { value: full(now - 100), expiry: now + 5000 },
            examplename: { value: partial(now - 1000), expiry: now + 10000 }
        };
        const cache = new UserCacheStorage();
        await cache.load();
        assert.equal(cache.size, 1);
        assert.equal(cache.get('EXAMPLENAME').meta.blueVerified, true);
        assert.equal(cache.cache.get('examplename').expiry, now + 5000);
    });

    await check('unknown legacy timestamps retain their original deadline and cannot create fresh entries', async () => {
        stored[STORAGE_KEYS.CACHE] = {
            ExampleName: { value: { location: 'Switzerland', device: 'Web' }, expiry: now + 2000 }
        };
        const cache = new UserCacheStorage();
        await cache.load();
        const value = cache.get('examplename');
        assert.equal(value.timestamp, null);
        now += 100;
        cache.set('EXAMPLENAME', value);
        assert.equal(cache.cache.get('examplename').expiry, now + 1900);
        assert.equal(cache.set('Another', { location: 'Switzerland', timestamp: null, fromCloud: true }), false);
    });

    const source = fs.readFileSync(new URL('../src/background/service-worker.js', import.meta.url), 'utf8');
    const functions = parseAst(source).body.filter(node => node.type === 'FunctionDeclaration' &&
        ['wantsRicherRecord', '_resolveUserInfo', 'handleFetchHovercardInfo'].includes(node.id.name));
    assert.equal(functions.length, 3, 'Exercise the actual production cloud and hover handlers');
    const handlerSource = functions.map(node => source.slice(node.start, node.end)).join('\n');
    const handlers = ({ cache, lookup, api, contribute = () => {} }) => {
        const context = vm.createContext({
            userCache: cache, UserCacheStorage, Date, console, affiliationWasChecked,
            settings: { get: () => false }, blockedAffiliations: new Set(),
            isNotFoundCached: () => false, cacheNotFound: () => {},
            headersStorage: { clear: async () => {} }, API_ERROR_CODES: {},
            apiClient: { fetchUserInfo: api },
            cloudCache: { isEnabled: () => true, isConfigured: () => true, lookup, contribute }
        });
        vm.runInContext(handlerSource + '\nglobalThis.handlers = { _resolveUserInfo, handleFetchHovercardInfo };', context);
        return context.handlers;
    };

    await check('a pending cloud lookup returns newly enriched local data instead of stale cloud data', async () => {
        const cache = new UserCacheStorage();
        let releaseCloud;
        let apiCalls = 0;
        const cloud = new Promise(resolve => { releaseCloud = resolve; });
        const { _resolveUserInfo } = handlers({ cache, lookup: () => cloud,
            api: async () => { apiCalls += 1; return full(); } });
        const pending = _resolveUserInfo({ screenName: 'ExampleName' });
        cache.set('examplename', full());
        releaseCloud(new Map([['examplename', partial(now - 1000)]]));
        const result = await pending;
        assert.equal(result.success, true);
        assert.equal(result.data.meta.blueVerified, true);
        assert.equal(result.data.timestamp, now);
        assert.equal(result.source, 'local');
        assert.equal(apiCalls, 0);
    });

    await check('mixed-case rich hover cache hits spend no API request', async () => {
        const cache = new UserCacheStorage();
        cache.set('ExampleName', full());
        let apiCalls = 0;
        const { handleFetchHovercardInfo } = handlers({ cache, lookup: async () => new Map(),
            api: async () => { apiCalls += 1; return full(); } });
        const response = await handleFetchHovercardInfo({ screenName: 'EXAMPLENAME' });
        assert.equal(response.source, 'local');
        assert.equal(response.data.meta.blueVerified, true);
        assert.equal(apiCalls, 0);
    });

    await check('expired rich metadata and unmarked lean metadata request real enrichment', async () => {
        for (const seed of [full(now - 1000, { metaExpiresAt: now }), { ...partial(), meta: { restId: '123' } }]) {
            const cache = new UserCacheStorage();
            cache.set('Example', seed);
            let apiCalls = 0;
            const { handleFetchHovercardInfo } = handlers({ cache, lookup: async () => new Map(),
                api: async () => { apiCalls += 1; return full(); } });
            const response = await handleFetchHovercardInfo({ screenName: 'EXAMPLE' });
            assert.equal(response.source, 'api');
            assert.equal(apiCalls, 1);
            assert.equal(UserCacheStorage.hasCompleteMetadata(cache.get('example')), true);
        }
    });

    await check('a live hover response rejected by the cache guard returns the actual winner and is not contributed', async () => {
        const winner = full(now, { location: 'United Kingdom', device: 'Web' }); let contributions = 0;
        const guardedCache = { has: () => false, set: () => false, get: () => winner };
        const { handleFetchHovercardInfo } = handlers({ cache: guardedCache, lookup: async () => new Map(),
            api: async () => full(now - 1000), contribute: () => { contributions += 1; } });
        const response = await handleFetchHovercardInfo({ screenName: 'EXAMPLE' });
        assert.equal(response.data, winner); assert.equal(response.source, 'local'); assert.equal(contributions, 0);
    });
    console.log(`Hover cache checks passed (${checks}).`);
} finally {
    Date.now = originalNow;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
    if (originalBrowser === undefined) delete globalThis.browser;
    else globalThis.browser = originalBrowser;
}
