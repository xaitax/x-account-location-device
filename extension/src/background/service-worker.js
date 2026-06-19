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
import { MESSAGE_TYPES, VERSION, STORAGE_KEYS, TIMING } from '../shared/constants.js';
import { userCache, blockedCountries, blockedRegions, blockedTags, settings, headersStorage, initializeStorage } from '../shared/storage.js';
import { apiClient, API_ERROR_CODES } from './api-client.js';
import { calculateStatistics } from '../shared/utils.js';
import cloudCache from './cloud-cache.js';

// Track initialization state
let initialized = false;

// Cache for negative results (users not found) to avoid repeat API calls
const notFoundCache = new Map();
const NOT_FOUND_CACHE_MAX_SIZE = 1000;
let notFoundCleanupInterval = null;

/**
 * Initialize the background worker
 */
async function initialize() {
    if (initialized) return;
    
    console.log(`🚀 X-Posed v${VERSION} Background Worker starting...`);
    
    try {
        // Initialize storage modules
        await initializeStorage();
        
        // Initialize cloud cache
        await cloudCache.init();
        
        // Restore cached headers to API client
        const storedHeaders = headersStorage.get();
        if (storedHeaders) {
            apiClient.setHeaders(storedHeaders);
        }

        initialized = true;
        console.log('✅ Background worker initialized');

        // Periodically purge expired entries from the in-memory not-found cache.
        // (No keep-alive timer: plain timers don't reset MV3 idle shutdown, and
        // persistence is already debounced, so SW termination is fine.)
        startNotFoundCacheCleanup();
    } catch (error) {
        console.error('❌ Background worker initialization failed:', error);
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
            
            case MESSAGE_TYPES.GET_BLOCKED_COUNTRIES:
                return handleGetBlockedCountries();
            
            case MESSAGE_TYPES.SET_BLOCKED_COUNTRIES:
                return await handleSetBlockedCountries(payload);
            
            case MESSAGE_TYPES.GET_BLOCKED_REGIONS:
                return handleGetBlockedRegions();
            
            case MESSAGE_TYPES.SET_BLOCKED_REGIONS:
                return await handleSetBlockedRegions(payload);
            
            case MESSAGE_TYPES.GET_BLOCKED_TAGS:
                return handleGetBlockedTags();
            
            case MESSAGE_TYPES.SET_BLOCKED_TAGS:
                return await handleSetBlockedTags(payload);
            
            case MESSAGE_TYPES.GET_STATISTICS:
                return handleGetStatistics();
            
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
    if (userCache.has(screenName)) {
        const cached = userCache.get(screenName);
        return {
            success: true,
            data: cached,
            cached: true,
            source: 'local'
        };
    }

    // 2. Check cloud cache if enabled
    if (cloudCache.isEnabled() && cloudCache.isConfigured()) {
        try {
            const cloudResults = await cloudCache.lookup([screenName]);
            if (cloudResults.has(screenName.toLowerCase())) {
                const cloudData = cloudResults.get(screenName.toLowerCase());
                
                // Store in local cache for future use
                userCache.set(screenName, cloudData);
                
                return {
                    success: true,
                    data: cloudData,
                    cached: true,
                    source: 'cloud'
                };
            }
        } catch (error) {
            console.warn('☁️ Cloud cache lookup failed:', error.message);
            // Continue to X API if cloud fails
        }
    }

    // 3. Fetch from X API
    try {
        const data = await apiClient.fetchUserInfo(screenName, csrfToken);
        
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
    // Serve a cached entry first — but ONLY if it carries the rich hovercard `meta`
    // (i.e. it came from a live X API fetch). Cloud-sourced entries hold just
    // location/device/locationAccurate and no meta, so we let those fall through to a
    // live fetch to enrich the card. This still avoids a fresh 401 for API-sourced
    // (meta-bearing) known users — the issue #14 goal — without permanently degrading
    // hovercards for cloud-sourced users.
    if (userCache.has(screenName)) {
        const cached = userCache.get(screenName);
        if (cached && cached.meta) {
            return { success: true, data: cached, source: 'local' };
        }
    }

    try {
        const data = await apiClient.fetchUserInfo(screenName, csrfToken);

        // Persist enriched response locally to speed up future hovers
        userCache.set(screenName, data);

        // Contribute (location/device only) to cloud cache if enabled
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
        userCache.set(screenName, data);
        return { success: true };
    }

    return { success: false, error: 'Invalid cache operation' };
}

/**
 * Get settings handler
 */
function handleGetSettings() {
    return {
        success: true,
        data: settings.get()
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

/**
 * Set settings handler
 */
async function handleSetSettings(newSettings) {
    await settings.set(newSettings);

    // Notify all tabs (fire-and-forget): the caller's response shouldn't wait on a
    // tabs.query + per-tab message round-trip, and the broadcast already swallows errors.
    broadcastToTabs({
        type: MESSAGE_TYPES.SETTINGS_UPDATED,
        payload: settings.get()
    });

    return { success: true, data: settings.get() };
}

/**
 * Get blocked countries handler
 */
function handleGetBlockedCountries() {
    return {
        success: true,
        data: blockedCountries.getAll(),
        size: blockedCountries.size
    };
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

    // Notify all tabs (fire-and-forget — don't block the caller's response on it).
    broadcastToTabs({
        type: updatedType,
        payload: store.getAll()
    });

    return {
        success: true,
        data: store.getAll(),
        size: store.size
    };
}

/**
 * Set blocked countries handler
 */
async function handleSetBlockedCountries({ action, country, countries }) {
    return handleSetBlockedSet(blockedCountries, MESSAGE_TYPES.BLOCKED_COUNTRIES_UPDATED, {
        action,
        value: country,
        values: countries
    });
}

/**
 * Get blocked regions handler
 */
function handleGetBlockedRegions() {
    return {
        success: true,
        data: blockedRegions.getAll(),
        size: blockedRegions.size
    };
}

/**
 * Get blocked tags handler
 */
function handleGetBlockedTags() {
    return {
        success: true,
        data: blockedTags.getAll(),
        size: blockedTags.size
    };
}

/**
 * Set blocked regions handler
 */
async function handleSetBlockedRegions({ action, region, regions }) {
    return handleSetBlockedSet(blockedRegions, MESSAGE_TYPES.BLOCKED_REGIONS_UPDATED, {
        action,
        value: region,
        values: regions
    });
}

/**
 * Set blocked tags handler
 */
async function handleSetBlockedTags({ action, tag, tags }) {
    return handleSetBlockedSet(blockedTags, MESSAGE_TYPES.BLOCKED_TAGS_UPDATED, {
        action,
        value: tag,
        values: tags
    });
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
                    locationAccurate: entry.locationAccurate
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
 * Import data handler - imports settings, blocked countries, blocked regions, and cache from exported JSON
 */
async function handleImportData({ settings: importSettings, blockedCountries: importBlockedCountries, blockedRegions: importBlockedRegions, blockedTags: importBlockedTags, cache: importCache }) {
    const results = {
        settings: false,
        blockedCountries: { count: 0 },
        blockedRegions: { count: 0 },
        blockedTags: { count: 0 },
        cache: { count: 0 }
    };
    
    try {
        // Import settings if provided
        if (importSettings && typeof importSettings === 'object') {
            await settings.set(importSettings);
            results.settings = true;
        }
        
        // Import blocked countries if provided (one mutation + one write)
        if (Array.isArray(importBlockedCountries)) {
            await blockedCountries.setAll(importBlockedCountries);
            results.blockedCountries.count = importBlockedCountries.length;
        }

        // Import blocked regions if provided (one mutation + one write)
        if (Array.isArray(importBlockedRegions)) {
            await blockedRegions.setAll(importBlockedRegions);
            results.blockedRegions.count = importBlockedRegions.length;
        }

        // Import blocked tags if provided (one mutation + one write)
        if (Array.isArray(importBlockedTags)) {
            await blockedTags.setAll(importBlockedTags);
            results.blockedTags.count = importBlockedTags.length;
        }
        
        // Import cache entries if provided
        if (Array.isArray(importCache)) {
            for (const entry of importCache) {
                if (entry.screenName) {
                    userCache.set(entry.screenName, entry);
                    results.cache.count++;
                }
            }
        }
        
        // Notify all tabs about updates (parallelized - all messages sent concurrently)
        await Promise.all([
            broadcastToTabs({ type: MESSAGE_TYPES.SETTINGS_UPDATED, payload: settings.get() }),
            broadcastToTabs({ type: MESSAGE_TYPES.BLOCKED_COUNTRIES_UPDATED, payload: blockedCountries.getAll() }),
            broadcastToTabs({ type: MESSAGE_TYPES.BLOCKED_REGIONS_UPDATED, payload: blockedRegions.getAll() }),
            broadcastToTabs({ type: MESSAGE_TYPES.BLOCKED_TAGS_UPDATED, payload: blockedTags.getAll() })
        ]);
        
        return {
            success: true,
            importedSettings: results.settings,
            importedBlockedCountries: results.blockedCountries.count,
            importedBlockedRegions: results.blockedRegions.count,
            importedBlockedTags: results.blockedTags.count,
            importedCache: results.cache.count
        };
    } catch (error) {
        return {
            success: false,
            error: error.message,
            importedSettings: results.settings,
            importedBlockedCountries: results.blockedCountries.count,
            importedBlockedRegions: results.blockedRegions.count,
            importedBlockedTags: results.blockedTags.count,
            importedCache: results.cache.count
        };
    }
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

        // Open options page to welcome new users
        browserAPI.runtime.openOptionsPage();
    } else if (details.reason === 'update') {
        // Extension updated
        const previousVersion = details.previousVersion || '1.0.0';
        console.log('Updated from version:', previousVersion);
        
        // Check if this is a major/minor version update that should show "What's New"
        const prevMajorMinor = previousVersion.split('.').slice(0, 2).join('.');
        const currentMajorMinor = VERSION.split('.').slice(0, 2).join('.');
        
        // Show "What's New" if updating to a new major/minor version
        if (prevMajorMinor !== currentMajorMinor) {
            console.log(`🆕 Major update: ${prevMajorMinor} → ${currentMajorMinor}`);
            
            // Mark that we should show the "What's New" banner
            await browserAPI.storage.local.set({
                [STORAGE_KEYS.LAST_VERSION]: VERSION,
                [STORAGE_KEYS.WHATS_NEW_SEEN]: false
            });
            
            // Open options page with "whats-new" parameter
            const optionsUrl = browserAPI.runtime.getURL('options/options.html') + '?whats-new=true';
            browserAPI.tabs.create({ url: optionsUrl });
        } else {
            // Minor patch update, just save version
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
    initialize();
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
initialize();

// Export for potential use in popup
export { handleMessage, initialize };
