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

// Keep-alive interval for MV3 service workers (Chrome can kill them after 30s of inactivity)
let keepAliveInterval = null;

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
        
        // Start keep-alive mechanism for MV3 service workers
        startKeepAlive();
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
 * Fetch user info handler
 */
async function handleFetchUserInfo({ screenName, csrfToken }) {
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
 * Fetch hovercard info handler
 *
 * Intentionally forces a live API call so we only pay rate limit cost on user interaction.
 */
async function handleFetchHovercardInfo({ screenName, csrfToken }) {
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

    // Notify all tabs about settings change (parallelized)
    await broadcastToTabs({
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
 * Set blocked countries handler
 */
async function handleSetBlockedCountries({ action, country, countries }) {
    switch (action) {
        case 'add':
            blockedCountries.add(country);
            break;
        case 'remove':
            blockedCountries.remove(country);
            break;
        case 'toggle':
            blockedCountries.toggle(country);
            break;
        case 'clear':
            await blockedCountries.clear();
            break;
        case 'set':
            // Replace all blocked countries
            await blockedCountries.clear();
            for (const c of countries) {
                blockedCountries.add(c);
            }
            break;
    }
    
    // Notify all tabs about blocked countries change (parallelized)
    await broadcastToTabs({
        type: MESSAGE_TYPES.BLOCKED_COUNTRIES_UPDATED,
        payload: blockedCountries.getAll()
    });

    return {
        success: true,
        data: blockedCountries.getAll(),
        size: blockedCountries.size
    };
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
    switch (action) {
        case 'add':
            blockedRegions.add(region);
            break;
        case 'remove':
            blockedRegions.remove(region);
            break;
        case 'toggle':
            blockedRegions.toggle(region);
            break;
        case 'clear':
            await blockedRegions.clear();
            break;
        case 'set':
            // Replace all blocked regions
            await blockedRegions.clear();
            for (const r of regions) {
                blockedRegions.add(r);
            }
            break;
    }
    
    // Notify all tabs about blocked regions change (parallelized)
    await broadcastToTabs({
        type: MESSAGE_TYPES.BLOCKED_REGIONS_UPDATED,
        payload: blockedRegions.getAll()
    });

    return {
        success: true,
        data: blockedRegions.getAll(),
        size: blockedRegions.size
    };
}

/**
 * Set blocked tags handler
 */
async function handleSetBlockedTags({ action, tag, tags }) {
    switch (action) {
        case 'add':
            blockedTags.add(tag);
            break;
        case 'remove':
            blockedTags.remove(tag);
            break;
        case 'toggle':
            blockedTags.toggle(tag);
            break;
        case 'clear':
            await blockedTags.clear();
            break;
        case 'set':
            // Replace all blocked tags
            await blockedTags.clear();
            for (const t of tags) {
                blockedTags.add(t);
            }
            break;
    }
    
    // Notify all tabs about blocked tags change (parallelized)
    await broadcastToTabs({
        type: MESSAGE_TYPES.BLOCKED_TAGS_UPDATED,
        payload: blockedTags.getAll()
    });

    return {
        success: true,
        data: blockedTags.getAll(),
        size: blockedTags.size
    };
}

/**
 * Get statistics handler
 */
function handleGetStatistics() {
    const cacheEntries = userCache.getAll();
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
        await broadcastToTabs({
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
        
        // Import blocked countries if provided
        if (Array.isArray(importBlockedCountries)) {
            // Clear existing and set new
            await blockedCountries.clear();
            for (const country of importBlockedCountries) {
                blockedCountries.add(country);
            }
            results.blockedCountries.count = importBlockedCountries.length;
        }
        
        // Import blocked regions if provided
        if (Array.isArray(importBlockedRegions)) {
            // Clear existing and set new
            await blockedRegions.clear();
            for (const region of importBlockedRegions) {
                blockedRegions.add(region);
            }
            results.blockedRegions.count = importBlockedRegions.length;
        }
        
        // Import blocked tags if provided
        if (Array.isArray(importBlockedTags)) {
            // Clear existing and set new
            await blockedTags.clear();
            for (const tag of importBlockedTags) {
                blockedTags.add(tag);
            }
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
 * Start keep-alive mechanism for MV3 service workers
 * Chrome can terminate service workers after ~30s of inactivity
 */
function startKeepAlive() {
    // Clear any existing interval
    if (keepAliveInterval) {
        clearInterval(keepAliveInterval);
    }
    
    // Set up periodic keep-alive
    keepAliveInterval = setInterval(() => {
        // Simple operation to keep service worker alive
        // No logging to avoid console spam
        void 0;
    }, TIMING.KEEP_ALIVE_INTERVAL_MS);
    
    // Also start periodic cleanup for notFoundCache
    startNotFoundCacheCleanup();
}

/**
 * Stop keep-alive mechanism (kept for potential future use/testing)
 */
// eslint-disable-next-line no-unused-vars
function stopKeepAlive() {
    if (keepAliveInterval) {
        clearInterval(keepAliveInterval);
        keepAliveInterval = null;
        console.log('💓 Service worker keep-alive stopped');
    }
    stopNotFoundCacheCleanup();
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

/**
 * Stop notFoundCache cleanup
 */
function stopNotFoundCacheCleanup() {
    if (notFoundCleanupInterval) {
        clearInterval(notFoundCleanupInterval);
        notFoundCleanupInterval = null;
    }
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

// Set up install/update listener (Chrome MV3 style)
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onInstalled) {
    chrome.runtime.onInstalled.addListener(handleInstalled);
}

// Set up startup listener
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onStartup) {
    chrome.runtime.onStartup.addListener(handleStartup);
}

// Firefox compatibility: browser.runtime instead of chrome.runtime
if (typeof browser !== 'undefined' && browser.runtime) {
    if (browser.runtime.onInstalled) {
        browser.runtime.onInstalled.addListener(handleInstalled);
    }
    if (browser.runtime.onStartup) {
        browser.runtime.onStartup.addListener(handleStartup);
    }
}

// Initialize on load
initialize();

// Export for potential use in popup
export { handleMessage, initialize };
