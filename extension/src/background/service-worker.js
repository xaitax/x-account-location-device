/**
 * Background Service Worker
 * Centralized message handling and coordination for the extension
 * Works in both Chrome (MV3 service worker) and Firefox (background script)
 *
 * CHANGELOG v2.5.0:
 * - Parallelized tab broadcasts with Promise.all (5-10x faster updates)
 * - Added broadcastToTabs() helper to reduce code duplication
 */

import browserAPI from '../shared/browser-api.js';
import { prepareBackupImport } from '../shared/backup.js';
import { MESSAGE_TYPES, VERSION, STORAGE_KEYS, TIMING, affiliationWasChecked } from '../shared/constants.js';
import { userCache, filterStores, blockedAffiliations, settings, headersStorage, initializeStorage } from '../shared/storage.js';
import { FILTER_SOURCES } from '../shared/filter-registry.js';
import { apiClient, API_ERROR_CODES } from './api-client.js';
import { calculateStatistics } from '../shared/utils.js';
import cloudCache from './cloud-cache.js';
import { filterStatistics } from './filter-statistics.js';

// Track initialization state
let initialized = false;
let initializationPromise = null;

// Cache for negative results (users not found) to avoid repeat API calls
const notFoundCache = new Map();
const NOT_FOUND_CACHE_MAX_SIZE = 1000;
let notFoundCleanupInterval = null;

/**
 * Initialize the background worker
 */
async function initialize() {
    if (initialized) return;
    if (initializationPromise) return initializationPromise;

    // Startup messages and a keyboard command can arrive together. Loading twice
    // could replace a freshly committed setting with an earlier storage snapshot.
    initializationPromise = (async () => {
        console.log(`🚀 X-Posed v${VERSION} Background Worker starting...`);
        try {
            await initializeStorage();
            await cloudCache.init();

            const storedHeaders = headersStorage.get();
            if (storedHeaders) apiClient.setHeaders(storedHeaders);

            initialized = true;
            console.log('✅ Background worker initialized');
            startNotFoundCacheCleanup();
        } catch (error) {
            console.error('❌ Background worker initialization failed:', error);
            throw error;
        }
    })();
    try {
        await initializationPromise;
    } finally {
        initializationPromise = null;
    }
}

/**
 * Handle messages from content scripts and popup
 */
async function handleMessage(message, _sender) {
    // Ensure initialization
    if (!initialized) {
        await initialize();
    }

    const { type, payload } = message;

    try {
        const filter = FILTER_SOURCES.find(source => source.get === type || source.set === type);
        if (filter) {
            const store = filterStores[filter.field];
            if (type === filter.get) return handleGetBlockedSet(store);
            return await handleSetBlockedSet(store, filter.update, {
                action: payload?.action, value: payload?.[filter.valueKey], values: payload?.[filter.valuesKey]
            });
        }
        switch (type) {
            case MESSAGE_TYPES.FETCH_USER_INFO:
                return await handleFetchUserInfo(payload);

            case MESSAGE_TYPES.FETCH_HOVERCARD_INFO:
                return await handleFetchHovercardInfo(payload);
            
            case MESSAGE_TYPES.CAPTURE_HEADERS:
                return await handleCaptureHeaders(payload);
            
            case MESSAGE_TYPES.GET_CACHE:
                return handleGetCache(payload);
            
            case MESSAGE_TYPES.SET_CACHE:
                return handleSetCache(payload);
            
            case MESSAGE_TYPES.GET_SETTINGS:
                return handleGetSettings();
            
            case MESSAGE_TYPES.SET_SETTINGS:
                return await handleSetSettings(payload);

            case MESSAGE_TYPES.OPEN_OPTIONS_PAGE:
                await browserAPI.runtime.openOptionsPage();
                return { success: true };

            case MESSAGE_TYPES.GET_STATISTICS:
                return handleGetStatistics();

            case MESSAGE_TYPES.GET_FILTER_STATISTICS:
                return { success: true, data: await filterStatistics.getSnapshot() };

            case MESSAGE_TYPES.RECORD_FILTER_STATISTICS:
                return await filterStatistics.record(payload);

            case MESSAGE_TYPES.RESET_FILTER_STATISTICS: {
                const result = await filterStatistics.reset(payload);
                if (result.success) {
                    broadcastToAll({
                        type: MESSAGE_TYPES.FILTER_STATISTICS_RESET,
                        payload: result.data,
                        revision: result.data.revision
                    });
                }
                return result;
            }
            
            case MESSAGE_TYPES.GET_THEME:
                return handleGetTheme();
            
            case MESSAGE_TYPES.SET_THEME:
                return await handleSetTheme(payload);
            
            case MESSAGE_TYPES.GET_RATE_LIMIT_STATUS:
                return handleGetRateLimitStatus();
            
            // Cloud cache handlers
            case MESSAGE_TYPES.GET_CLOUD_CACHE_STATUS:
                return handleGetCloudCacheStatus();
            
            case MESSAGE_TYPES.SET_CLOUD_CACHE_ENABLED:
                return await handleSetCloudCacheEnabled(payload);
            
            case MESSAGE_TYPES.GET_CLOUD_STATS:
                return handleGetCloudStats();
            
            case MESSAGE_TYPES.GET_CLOUD_SERVER_STATS:
                return await handleGetCloudServerStats();
            
            case MESSAGE_TYPES.SYNC_LOCAL_TO_CLOUD:
                return await handleSyncLocalToCloud();
            
            case MESSAGE_TYPES.IMPORT_DATA:
                return await handleImportData(payload);
            
            default:
                console.warn('Unknown message type:', type);
                return { success: false, error: 'Unknown message type' };
        }
    } catch (error) {
        console.error(`Error handling ${type}:`, error);
        return { 
            success: false, 
            error: error.message,
            code: error.code || 'UNKNOWN'
        };
    }
}

/**
 * Check if a user is in the "not found" cache
 */
function isNotFoundCached(screenName) {
    const key = screenName.toLowerCase();
    const entry = notFoundCache.get(key);
    
    if (!entry) return false;
    
    // Check if expired
    if (Date.now() > entry.expiry) {
        notFoundCache.delete(key);
        return false;
    }
    
    return true;
}

/**
 * Add a user to the "not found" cache
 */
function cacheNotFound(screenName) {
    const key = screenName.toLowerCase();
    
    // Evict oldest entries if at capacity
    if (notFoundCache.size >= NOT_FOUND_CACHE_MAX_SIZE) {
        const firstKey = notFoundCache.keys().next().value;
        notFoundCache.delete(firstKey);
    }
    
    notFoundCache.set(key, {
        expiry: Date.now() + TIMING.NOT_FOUND_CACHE_EXPIRY_MS
    });
}

/**
 * Should a cached entry be refetched from X because we can't tell whether the account
 * has an affiliation?
 *
 * The community cache only started carrying affiliations in Worker v2.8.0, so a missing
 * `af` is ambiguous: it can mean "this account has no affiliation" or "nobody has looked
 * yet". Treating the second case as the first makes the affiliation filter quietly
 * under-block, which is worse than not offering it.
 *
 * CONTRACT: the `affiliateUsername` KEY is the marker for "affiliation was parsed". Both
 * full parsers always emit it (null when the account has none), while records written by
 * older code paths omit it entirely. Its mere presence — not its value — is what proves
 * the account was actually inspected.
 *
 * Deliberately NOT keyed on restId: the in-page fallback used to emit restId without ever
 * looking at affiliation, so those records would masquerade as confirmed-unaffiliated and
 * never be re-checked.
 *
 * IMPORTANT: a true answer only ever authorises a CLOUD re-check, never an X API call.
 * Affiliation reaches the cloud when someone opens an account's info hovercard, which
 * already performs a full fetch — so coverage grows without anyone spending extra API
 * calls, and turning this filter on can never re-resolve a whole timeline.
 * @param {{meta?: {affiliate?: object|null, affiliateUsername?: string|null}}|null|undefined} data
 * @returns {boolean}
 */
function wantsRicherRecord(data) {
    // Not filtering on affiliation → the missing field is irrelevant, never spend a lookup.
    if (blockedAffiliations.size === 0) return false;

    return !affiliationWasChecked(data?.meta);
}

/**
 * In-flight dedup for concurrent FETCH_USER_INFO messages: the observer fires one per
 * visible username, so the same author across several on-screen tweets would otherwise
 * each run the whole local→cloud→API pipeline (and each wait on the cloud batch).
 * Concurrent callers for the same screen name share a single promise.
 */
const inFlightUserFetches = new Map();

function handleFetchUserInfo(args) {
    const key = (args?.screenName || '').toLowerCase();
    if (!key) return _resolveUserInfo(args);

    const existing = inFlightUserFetches.get(key);
    if (existing) return existing;

    const promise = _resolveUserInfo(args).finally(() => {
        inFlightUserFetches.delete(key);
    });
    inFlightUserFetches.set(key, promise);
    return promise;
}

/**
 * Resolve user info: not-found cache → local cache → cloud cache → X API.
 */
async function _resolveUserInfo({ screenName, csrfToken }) {
    // Issue #23 diagnostic: trace which source (local/cloud/api) supplied the country and
    // how stale a cloud hit was, so the next flag/pop-up mismatch can be pinned down.
    const debug23 = settings.get('debugMode') === true;

    // 0. Check not-found cache first (avoid repeat API calls for non-existent users)
    if (isNotFoundCached(screenName)) {
        return {
            success: false,
            error: 'User not found (cached)',
            code: API_ERROR_CODES.NOT_FOUND,
            cached: true
        };
    }

    // 1. Check local cache first
    let localEntry = userCache.get(screenName) || null;
    if (localEntry) {
        if (!wantsRicherRecord(localEntry)) {
            if (debug23) console.log(`[xposed#23] @${screenName} source=local loc=${localEntry?.location}`);
            return {
                success: true,
                data: localEntry,
                cached: true,
                source: 'local'
            };
        }
        // We're filtering by affiliation and this record predates affiliation support.
        // Fall through to the CLOUD only — someone may have hovered this account since,
        // which contributes the full record. We never escalate to the X API for this.
    }

    // 2. Check cloud cache if enabled
    if (cloudCache.isEnabled() && cloudCache.isConfigured()) {
        try {
            const cloudResults = await cloudCache.lookup([screenName]);
            if (cloudResults.has(screenName.toLowerCase())) {
                const cloudData = cloudResults.get(screenName.toLowerCase());

                // Keep whichever record actually knows about affiliation. Without this a
                // lean cloud entry could overwrite a richer local one we already had.
                const cloudIsRicher = !wantsRicherRecord(cloudData);
                const best = (cloudIsRicher || !localEntry) ? cloudData : localEntry;

                if (debug23) console.log(`[xposed#23] @${screenName} source=cloud loc=${cloudData?.location} ageMs=${Date.now() - (cloudData?.timestamp || 0)}`);

                // A source observation can expire while the lookup is in flight.
                // Only serve it if the cache accepts its original deadline.
                if (userCache.set(screenName, best)) {
                    return {
                        success: true,
                        data: best,
                        cached: true,
                        source: best === cloudData ? 'cloud' : 'local'
                    };
                }
            }
        } catch (error) {
            console.warn('☁️ Cloud cache lookup failed:', error.message);
            // Continue to X API if cloud fails
        }
    }

    // 2b. We already had a usable record and only came this far hoping the cloud had a
    // richer one. It didn't, so serve what we have. Spending an X API call purely to
    // learn an affiliation is what would re-resolve an entire timeline and burn the
    // rate limit — the hovercard is the path that enriches these records instead.
    localEntry = userCache.get(screenName) || null;
    if (localEntry) {
        if (debug23) console.log(`[xposed#23] @${screenName} source=local (no richer cloud record)`);
        return {
            success: true,
            data: localEntry,
            cached: true,
            source: 'local'
        };
    }

    // 3. Fetch from X API (genuine cache miss only)
    try {
        const data = {
            ...await apiClient.fetchUserInfo(screenName, csrfToken),
            timestamp: Date.now(),
            fromCloud: false
        };
        if (debug23) console.log(`[xposed#23] @${screenName} source=api loc=${data?.location}`);

        // Cache the result locally
        userCache.set(screenName, data);
        
        // Contribute to cloud cache if enabled
        if (cloudCache.isEnabled() && cloudCache.isConfigured()) {
            cloudCache.contribute(screenName, data);
        }
        
        return {
            success: true,
            data,
            cached: false,
            source: 'api'
        };
    } catch (error) {
        // Log the error for debugging
        console.warn(`❌ API error for @${screenName}:`, error.message, 'code:', error.code);
        
        // Cache NOT_FOUND errors to avoid repeat lookups
        if (error.code === API_ERROR_CODES.NOT_FOUND) {
            cacheNotFound(screenName);
        }

        // Issue #14: drop stale stored headers on auth failure so freshly captured
        // headers replace them; the content script recovers via the in-page fetch.
        if (error.code === API_ERROR_CODES.UNAUTHORIZED) {
            await headersStorage.clear();
        }

        // Return specific error information
        return {
            success: false,
            error: error.message,
            code: error.code || API_ERROR_CODES.UNKNOWN,
            retryAfter: error.retryAfter || null
        };
    }
}

/**
 * Fetch hovercard info handler.
 *
 * Issue #14: this previously ALWAYS forced a live API call, so during a persistent
 * auth failure (e.g. a Firefox container cookie mismatch) every hovered user — even
 * ones already cached and rendering a badge fine — showed "Authentication failed".
 * Now we serve a cached entry first (it already carries the rich meta from the badge
 * fetch) and only go live on a cache miss, so known users render without a fresh
 * 401. Uncached users still go live and surface a clear, distinct error in the
 * hovercard if auth fails.
 */
async function handleFetchHovercardInfo({ screenName, csrfToken }) {
    // Serve a cached entry first — but ONLY if it carries the FULL hovercard `meta`
    // (i.e. it came from a live X API fetch). Cloud-sourced entries carry just the
    // shared subset and are flagged `meta.partial`, so they fall through to a live
    // fetch that fills in the display name, avatar and verification state. This still
    // avoids a fresh 401 for API-sourced known users — the issue #14 goal — without
    // rendering a half-empty card for cloud-sourced ones.
    if (userCache.has(screenName)) {
        const cached = userCache.get(screenName);
        if (cached && cached.meta && !cached.meta.partial) {
            return { success: true, data: cached, source: 'local' };
        }
    }

    try {
        const data = {
            ...await apiClient.fetchUserInfo(screenName, csrfToken),
            timestamp: Date.now(),
            fromCloud: false
        };

        // Persist enriched response locally to speed up future hovers
        userCache.set(screenName, data);

        // Contribute to the cloud. This is the hovercard path, so `data` is the full
        // record — location/device plus affiliation, account age, id and handle-change
        // count. Opening a hovercard is therefore how affiliation coverage grows for
        // everyone, without any lookup ever costing an extra X API call.
        if (cloudCache.isEnabled() && cloudCache.isConfigured()) {
            cloudCache.contribute(screenName, data);
        }

        return { success: true, data, source: 'api' };
    } catch (error) {
        // Issue #14: drop stale stored headers on auth failure (the in-page fetch
        // fallback in the content script recovers the lookup).
        if (error.code === API_ERROR_CODES.UNAUTHORIZED) {
            await headersStorage.clear();
        }
        return {
            success: false,
            error: error.message,
            code: error.code || API_ERROR_CODES.UNKNOWN,
            retryAfter: error.retryAfter || null
        };
    }
}

/**
 * Capture headers handler
 */
async function handleCaptureHeaders({ headers }) {
    const success = apiClient.setHeaders(headers);
    
    if (success) {
        // Store headers for persistence across sessions
        await headersStorage.save(headers);
    }
    
    return { success };
}

/**
 * Get cache handler
 */
function handleGetCache({ screenName }) {
    if (screenName) {
        const data = userCache.get(screenName);
        return { 
            success: true, 
            data: data || null,
            found: !!data
        };
    }
    
    // Return all cache entries
    return {
        success: true,
        data: userCache.getAll(),
        size: userCache.size
    };
}

/**
 * Set cache handler
 */
function handleSetCache({ action, screenName, data }) {
    if (action === 'clear') {
        void userCache.clear();
        return { success: true, cleared: true };
    }

    if (action === 'delete' && screenName) {
        userCache.delete(screenName);
        return { success: true, deleted: true };
    }

    if (screenName && data) {
        return { success: userCache.set(screenName, data) };
    }

    return { success: false, error: 'Invalid cache operation' };
}

/**
 * Get settings handler
 */
function handleGetSettings() {
    return {
        success: true,
        ...settings.snapshot()
    };
}

/**
 * Broadcast message to all X/Twitter tabs (parallelized for speed)
 */
async function broadcastToTabs(message) {
    try {
        const tabs = await browserAPI.tabs.query({ url: ['*://*.x.com/*', '*://*.twitter.com/*'] });
        await Promise.all(tabs.map(tab =>
            browserAPI.tabs.sendMessage(tab.id, message).catch(() => {
                // Tab might not have content script loaded
            })
        ));
    } catch (e) {
        console.debug('Could not notify tabs:', e);
    }
}

// Keep committed updates in order even when tab discovery is asynchronous. A
// batch (used for imports) queries tabs once rather than once for every list.
let stateBroadcastQueue = Promise.resolve();
function broadcastToAll(update) {
    const messages = Array.isArray(update) ? update : [update];
    const operation = stateBroadcastQueue.then(async () => {
        let tabs = [];
        try {
            tabs = await browserAPI.tabs.query({ url: ['*://*.x.com/*', '*://*.twitter.com/*'] });
        } catch (error) {
            console.debug('Could not find tabs to notify:', error);
        }
        await Promise.all(messages.flatMap(message => [
            browserAPI.runtime.sendMessage(message).catch(() => {}),
            ...tabs.map(tab => browserAPI.tabs.sendMessage(tab.id, message).catch(() => {}))
        ]));
    });
    stateBroadcastQueue = operation.catch(error => {
        console.debug('Could not notify extension state:', error);
    });
    return stateBroadcastQueue;
}

function publishSettings({ data, revision }) {
    // No open extension page / no listener is normal. Mutation acknowledgements
    // don't wait for broadcasts, and all surfaces receive the committed snapshot.
    broadcastToAll({
        type: MESSAGE_TYPES.SETTINGS_UPDATED,
        payload: data,
        revision
    });
    return { success: true, data, revision };
}

/** Persist a settings patch or atomic region edit before acknowledging or broadcasting it. */
async function handleSetSettings(newSettings) {
    if (newSettings && Object.hasOwn(newSettings, 'regionCountrySelection')) {
        // Transport-only command; the singular key is never a stored preference.
        const update = newSettings.regionCountrySelection;
        if (Object.keys(newSettings).length !== 1 || !update || typeof update !== 'object' ||
            Array.isArray(update) || !Object.hasOwn(update, 'region') || !Object.hasOwn(update, 'countries') ||
            (Object.hasOwn(update, 'activate') && typeof update.activate !== 'boolean')) {
            throw new TypeError('Invalid region-country update.');
        }
        await settings.setRegionCountries(update.region, update.countries, {
            activate: update.activate === true, regionStore: filterStores.blockedRegions
        });
        if (update.activate === true) {
            const snapshot = settings.snapshot();
            const regions = filterStores.blockedRegions.snapshot();
            broadcastToAll([
                { type: MESSAGE_TYPES.SETTINGS_UPDATED, payload: snapshot.data, revision: snapshot.revision },
                { type: MESSAGE_TYPES.BLOCKED_REGIONS_UPDATED, payload: regions.data, revision: regions.revision }
            ]);
            return { success: true, ...snapshot, blockedRegions: regions.data, regionsRevision: regions.revision };
        }
    } else {
        await settings.set(newSettings);
    }
    return publishSettings(settings.snapshot());
}

/**
 * Generic read handler for a blocked-set storage.
 * @param {object} store - a BlockedSetStorage singleton
 */
function handleGetBlockedSet(store) {
    const snapshot = store.snapshot();
    return { success: true, ...snapshot, size: snapshot.data.length };
}

/**
 * Generic handler for the blocked-set storages (countries/regions/tags).
 * Applies the requested mutation, persists, then broadcasts `updatedType`.
 *
 * @param {object} store - a BlockedSetStorage singleton
 * @param {string} updatedType - the *_UPDATED message type to broadcast
 * @param {object} payload - { action, value, values }
 *   `value`  - single value for add/remove/toggle
 *   `values` - array for the bulk 'set' action
 */
async function handleSetBlockedSet(store, updatedType, { action, value, values }) {
    switch (action) {
        case 'add':
            await store.add(value);
            break;
        case 'remove':
            await store.remove(value);
            break;
        case 'toggle':
            await store.toggle(value);
            break;
        case 'clear':
            await store.clear();
            break;
        case 'set':
            // Replace all in one mutation + one write
            await store.setAll(values || []);
            break;
    }

    // Capture data and revision together, before queuing asynchronous delivery.
    const snapshot = store.snapshot();
    // Notify tabs and extension pages without delaying the mutation response.
    broadcastToAll({
        type: updatedType,
        payload: snapshot.data,
        revision: snapshot.revision
    });

    return {
        success: true,
        ...snapshot,
        size: snapshot.data.length
    };
}

/**
 * Get statistics handler
 */
function handleGetStatistics() {
    // Iterate raw cache entries and project only the fields statistics needs,
    // instead of getAll() (which spreads the full value object — including the
    // large `meta` blob — per entry, up to 50k allocations).
    const cacheEntries = [];
    userCache.forEach((_screenName, value) => {
        cacheEntries.push({
            location: value.location,
            device: value.device,
            locationAccurate: value.locationAccurate
        });
    });
    const stats = calculateStatistics(cacheEntries);

    return {
        success: true,
        data: stats
    };
}

/**
 * Get theme handler
 */
async function handleGetTheme() {
    try {
        const result = await browserAPI.storage.local.get(STORAGE_KEYS.THEME);
        return {
            success: true,
            theme: result[STORAGE_KEYS.THEME] || 'dark'
        };
    } catch (error) {
        return {
            success: false,
            theme: 'dark'
        };
    }
}

/**
 * Set theme handler
 */
async function handleSetTheme({ theme }) {
    try {
        await browserAPI.storage.local.set({
            [STORAGE_KEYS.THEME]: theme
        });

        // Notify all tabs about theme change (parallelized)
        broadcastToTabs({
            type: MESSAGE_TYPES.THEME_UPDATED,
            payload: theme
        });

        return { success: true, theme };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

/**
 * Get rate limit status handler
 */
function handleGetRateLimitStatus() {
    const status = apiClient.getRateLimitStatus();
    return {
        success: true,
        ...status
    };
}

/**
 * Get cloud cache status handler
 */
function handleGetCloudCacheStatus() {
    return {
        success: true,
        enabled: cloudCache.isEnabled(),
        configured: cloudCache.isConfigured(),
        stats: cloudCache.getStats()
    };
}

/**
 * Set cloud cache enabled handler
 */
async function handleSetCloudCacheEnabled({ enabled }) {
    await cloudCache.setEnabled(enabled);
    return {
        success: true,
        enabled: cloudCache.isEnabled()
    };
}

/**
 * Get cloud stats handler
 */
function handleGetCloudStats() {
    return {
        success: true,
        stats: cloudCache.getStats()
    };
}

/**
 * Get cloud server stats handler (total entries in cloud cache)
 *
 * Optimized for UX:
 * - returns cached stats immediately when available
 * - triggers a background refresh (stale-while-revalidate)
 */
async function handleGetCloudServerStats() {
    try {
        const cached = cloudCache.getCachedServerStats?.();

        // If we have cached stats, return instantly and refresh in the background
        if (cached) {
            cloudCache.refreshServerStats?.({ timeoutMs: 15000 }).catch(() => {});
            return {
                success: true,
                serverStats: cached,
                cached: true
            };
        }

        // First-time fetch: wait for a (longer) network request
        const serverStats = await cloudCache.fetchServerStats({
            timeoutMs: 15000,
            allowStale: false,
            force: true
        });

        return {
            success: true,
            serverStats,
            cached: false
        };
    } catch (error) {
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Sync local cache to cloud handler
 */
async function handleSyncLocalToCloud() {
    try {
        // Get all local cache entries as array
        const cacheArray = userCache.getAll();
        
        if (!cacheArray || cacheArray.length === 0) {
            return {
                success: true,
                result: { synced: 0, skipped: 0, errors: 0, message: 'No local entries to sync' }
            };
        }
        
        // Convert array to object with screenName as key
        const cacheEntries = {};
        for (const entry of cacheArray) {
            if (entry.screenName) {
                cacheEntries[entry.screenName] = {
                    location: entry.location,
                    device: entry.device,
                    locationAccurate: entry.locationAccurate,
                    timestamp: entry.timestamp,
                    fromCloud: entry.fromCloud
                };
            }
        }
        
        if (Object.keys(cacheEntries).length === 0) {
            return {
                success: true,
                result: { synced: 0, skipped: 0, errors: 0, message: 'No valid entries to sync' }
            };
        }
        
        // Bulk sync to cloud
        const result = await cloudCache.bulkSync(cacheEntries);
        
        return {
            success: true,
            result
        };
    } catch (error) {
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Restore portable settings, filter lists and dated account-cache observations.
 */
async function handleImportData(payload) {
    payload = prepareBackupImport(payload);
    // Reject malformed rules before replacing any existing settings or lists.
    for (const { field } of FILTER_SOURCES) {
        if (payload[field]?.some(value => !filterStores[field].normalize(value))) {
            throw new TypeError(`Backup ${field} contains an invalid filter.`);
        }
    }
    const { settings: importSettings, cache: importCache } = payload;
    const results = {
        settings: false,
        theme: false,
        cloudCacheEnabled: false,
        ...Object.fromEntries(FILTER_SOURCES.map(source => [source.field, { count: 0 }])),
        cache: { count: 0, skipped: 0 }
    };
    
    let failure = null;
    const revisions = {};
    try {
        // Import settings if provided
        if (importSettings && typeof importSettings === 'object' && !Array.isArray(importSettings)) {
            await settings.set(importSettings);
            results.settings = true;
        }
        
        // One ordered commit per supplied list; missing fields in older backups stay intact.
        for (const source of FILTER_SOURCES) {
            const values = payload[source.field];
            if (!Array.isArray(values)) continue;
            const store = filterStores[source.field];
            await store.setAll(values);
            // Preserve the existing import response contract (links report normalized rules).
            results[source.field].count = source.kind === 'links' ? store.size : values.length;
        }

        if (Object.hasOwn(payload, 'theme')) {
            const response = await handleSetTheme({ theme: payload.theme });
            if (!response.success) throw new Error(response.error || 'Could not restore theme.');
            results.theme = true;
        }
        if (Object.hasOwn(payload, 'cloudCacheEnabled')) {
            await cloudCache.setEnabled(payload.cloudCacheEnabled);
            results.cloudCacheEnabled = true;
        }

        // Import cache entries if provided
        if (Array.isArray(importCache)) {
            // Handles are case-insensitive, but existing cache keys preserve casing.
            // Keep those keys usable without introducing duplicate aliases on restore.
            const currentAccounts = new Map();
            userCache.forEach((screenName, value) => {
                const key = screenName.toLowerCase();
                const current = currentAccounts.get(key) || { keys: [], timestamp: 0 };
                current.keys.push(screenName);
                if (Number.isFinite(value.timestamp)) current.timestamp = Math.max(current.timestamp, value.timestamp);
                currentAccounts.set(key, current);
            });
            for (const entry of importCache) {
                const valid = entry && typeof entry === 'object' && !Array.isArray(entry) &&
                    typeof entry.screenName === 'string' && /^[a-zA-Z0-9_]{1,15}$/.test(entry.screenName) &&
                    ['location', 'device'].every(key => entry[key] === null || entry[key] === undefined || typeof entry[key] === 'string') &&
                    (entry.locationAccurate === undefined || typeof entry.locationAccurate === 'boolean') &&
                    (entry.fromCloud === undefined || typeof entry.fromCloud === 'boolean') &&
                    Number.isFinite(entry.timestamp) && entry.timestamp > 0 && entry.timestamp <= Date.now();
                if (!valid) { results.cache.skipped++; continue; }
                const key = entry.screenName.toLowerCase();
                const current = currentAccounts.get(key);
                // Restoring an old backup must never age a newer live observation.
                if (Number.isFinite(current?.timestamp) && current.timestamp >= entry.timestamp) {
                    results.cache.skipped++;
                    continue;
                }
                const keys = current?.keys || [entry.screenName];
                let accepted = false;
                for (const screenName of keys) {
                    if (userCache.set(screenName, { ...entry, screenName })) accepted = true;
                }
                if (accepted) {
                    currentAccounts.set(key, { keys, timestamp: entry.timestamp });
                    results.cache.count++;
                } else results.cache.skipped++;
            }
            // MV3 may suspend before the regular debounced save. Acknowledge only
            // after persistence, and surface failure while retaining retry behavior.
            if (results.cache.count && !(await userCache.save())) {
                throw new Error('Could not save the restored account cache. Earlier settings or filters may already have been restored.');
            }
        }
        
    } catch (error) {
        failure = error;
    } finally {
        // Imports are intentionally partial: if a later write fails, earlier
        // commits still need to reach every open surface. One tab query per batch.
        const messages = [
            ['settings', MESSAGE_TYPES.SETTINGS_UPDATED, settings],
            ...FILTER_SOURCES.map(source => [source.field, source.update, filterStores[source.field]])
        ].map(([key, type, store]) => {
            const { data, revision } = store.snapshot();
            revisions[key] = revision;
            return { type, payload: data, revision };
        });
        if (results.theme) messages.push({ type: MESSAGE_TYPES.THEME_UPDATED, payload: payload.theme });
        broadcastToAll(messages);
    }

    return {
        success: !failure,
        ...(failure ? { error: failure.message } : {}),
        revisions,
        importedSettings: results.settings,
        importedTheme: results.theme,
        importedCloudCacheEnabled: results.cloudCacheEnabled,
        ...Object.fromEntries(FILTER_SOURCES.map(({ field }) => [
            `imported${field[0].toUpperCase()}${field.slice(1)}`, results[field].count
        ])),
        importedCache: results.cache.count,
        skippedCache: results.cache.skipped
    };
}

/**
 * Handle extension install/update
 */
async function handleInstalled(details) {
    console.log('🎉 Extension installed/updated:', details.reason);
    
    if (details.reason === 'install') {
        // First install - save current version
        console.log('First install - welcome!');
        await browserAPI.storage.local.set({
            [STORAGE_KEYS.LAST_VERSION]: VERSION
        });

        // v3.0.0: enable the community cloud cache by default for NEW installs only.
        // Existing users keep whatever they had (the update branch never touches it),
        // so this is not a silent opt-in for current users. It makes flags resilient
        // to X API rate-limiting out of the box; users can opt out in Options.
        // initialize() is idempotent and ensures cloudCache exists before we flip it.
        try {
            await initialize();
            await cloudCache.setEnabled(true);
        } catch (cloudErr) {
            console.warn('Could not enable cloud cache on install:', cloudErr);
        }

        // The same release tour introduces the extension to new users.
        const welcomeUrl = browserAPI.runtime.getURL('options/options.html') + '?welcome=true';
        browserAPI.tabs.create({ url: welcomeUrl });
    } else if (details.reason === 'update') {
        // Extension updated
        const previousVersion = details.previousVersion || '1.0.0';
        console.log('Updated from version:', previousVersion);
        
        // Major/minor updates show "What's New"; ordinary patches stay quiet.
        const prevMajorMinor = previousVersion.split('.').slice(0, 2).join('.');
        const currentMajorMinor = VERSION.split('.').slice(0, 2).join('.');
        
        if (prevMajorMinor !== currentMajorMinor) {
            console.log(`🆕 Feature update: ${previousVersion} → ${VERSION}`);
            
            // Mark that we should show the "What's New" banner
            await browserAPI.storage.local.set({
                [STORAGE_KEYS.LAST_VERSION]: VERSION,
                [STORAGE_KEYS.WHATS_NEW_SEEN]: false
            });
            
            // Open the "What's New" tab unless the user opted out (issue #24). onInstalled
            // can fire before the SW's top-level initialize() finishes, so make sure settings
            // are loaded first (initialize() is idempotent). WHATS_NEW_SEEN was still set to
            // false above, so an opted-out user simply sees the in-page banner the next time
            // they open Options — a graceful fallback rather than losing the notice.
            try {
                await initialize();
            } catch (_e) { /* fall through with defaults */ }

            if (settings.get('openChangelogOnUpdate') !== false) {
                const optionsUrl = browserAPI.runtime.getURL('options/options.html') + '?whats-new=true';
                browserAPI.tabs.create({ url: optionsUrl });
            }
        } else {
            // Other patches and same-version reinstalls remain quiet.
            await browserAPI.storage.local.set({
                [STORAGE_KEYS.LAST_VERSION]: VERSION
            });
        }
    }
}

/**
 * Handle startup (when browser starts with extension already installed)
 */
function handleStartup() {
    console.log('🌅 Browser startup - initializing...');
    initialize().catch(() => {}); // A later message retries a failed startup read.
}

/**
 * Start periodic cleanup of expired entries in notFoundCache
 * This prevents stale entries from accumulating over time
 */
function startNotFoundCacheCleanup() {
    // Clear any existing interval
    if (notFoundCleanupInterval) {
        clearInterval(notFoundCleanupInterval);
    }
    
    notFoundCleanupInterval = setInterval(() => {
        const now = Date.now();
        let cleanedCount = 0;
        
        for (const [key, entry] of notFoundCache.entries()) {
            if (now > entry.expiry) {
                notFoundCache.delete(key);
                cleanedCount++;
            }
        }
        
        if (cleanedCount > 0) {
            console.debug(`🧹 Cleaned ${cleanedCount} expired entries from notFoundCache, size: ${notFoundCache.size}`);
        }
    }, TIMING.NOT_FOUND_CLEANUP_INTERVAL_MS);
}

// Set up message listener
browserAPI.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Handle async response
    handleMessage(message, sender)
        .then(response => {
            sendResponse(response);
        })
        .catch(error => {
            sendResponse({ 
                success: false, 
                error: error.message 
            });
        });
    
    // Return true to indicate async response
    return true;
});

// Register install/update + startup listeners EXACTLY ONCE.
// Firefox exposes both a `browser` namespace and a `chrome` alias, so registering
// on both would double-fire handleInstalled (e.g. open two "What's New" tabs on an
// update). Prefer `browser` (Firefox) and fall back to `chrome` (Chromium).
const runtimeNS = (typeof browser !== 'undefined' && browser.runtime) ? browser
    : (typeof chrome !== 'undefined' && chrome.runtime) ? chrome
        : null;

if (runtimeNS?.runtime?.onInstalled) {
    runtimeNS.runtime.onInstalled.addListener(handleInstalled);
}
if (runtimeNS?.runtime?.onStartup) {
    runtimeNS.runtime.onStartup.addListener(handleStartup);
}

if (browserAPI.commands?.onCommand) {
    browserAPI.commands.onCommand.addListener(async command => {
        if (command !== 'toggle-blocking-mode') return;
        try {
            await initialize();
            // Compute the toggle inside the storage queue, so rapid commands do
            // not both read and write the same stale boolean.
            await settings.toggle('highlightBlockedTweets');
            publishSettings(settings.snapshot());
        } catch (error) {
            console.error('Could not switch blocking mode:', error);
        }
    });
}

// Flush deferred writes before the background suspends (reliable on Firefox event
// pages; best-effort on Chromium MV3). Prevents losing freshly-cached users and
// queued community-cache contributions on idle termination.
if (runtimeNS?.runtime?.onSuspend) {
    runtimeNS.runtime.onSuspend.addListener(() => {
        try { userCache.save(true); } catch { /* best-effort */ }
        try { cloudCache.flushContributions(); } catch { /* best-effort */ }
        try { cloudCache.forceSaveStats(); } catch { /* best-effort */ }
    });
}

// Initialize on load
initialize().catch(() => {}); // Logged by initialize; message requests can retry.

// Export for potential use in popup
export { handleMessage, initialize };
