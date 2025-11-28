/**
 * Storage Abstraction Layer
 * Uses chrome.storage/browser.storage API with LRU cache support
 */

import browserAPI from './browser-api.js';
import { STORAGE_KEYS, CACHE_CONFIG, DEFAULT_SETTINGS } from './constants.js';

/**
 * LRU Cache implementation for in-memory caching with eviction
 */
class LRUCache {
    constructor(maxSize = CACHE_CONFIG.MAX_ENTRIES) {
        this.maxSize = maxSize;
        this.cache = new Map();
    }

    get(key) {
        if (!this.cache.has(key)) {
            return undefined;
        }
        // Move to end (most recently used)
        const value = this.cache.get(key);
        this.cache.delete(key);
        this.cache.set(key, value);
        return value;
    }

    set(key, value) {
        // Delete if exists to update position
        if (this.cache.has(key)) {
            this.cache.delete(key);
        }
        // Evict oldest if at capacity
        if (this.cache.size >= this.maxSize) {
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
        }
        this.cache.set(key, value);
    }

    has(key) {
        return this.cache.has(key);
    }

    delete(key) {
        return this.cache.delete(key);
    }

    clear() {
        this.cache.clear();
    }

    get size() {
        return this.cache.size;
    }

    entries() {
        return this.cache.entries();
    }

    keys() {
        return this.cache.keys();
    }

    values() {
        return this.cache.values();
    }

    toObject() {
        const obj = {};
        for (const [key, value] of this.cache) {
            obj[key] = value;
        }
        return obj;
    }

    fromObject(obj) {
        this.clear();
        for (const [key, value] of Object.entries(obj)) {
            this.set(key, value);
        }
    }
}

/**
 * User cache data storage with per-entry expiry tracking
 */
class UserCacheStorage {
    constructor() {
        this.cache = new LRUCache(CACHE_CONFIG.MAX_ENTRIES);
        this.expiryMap = new Map(); // Track individual entry expiry times
        this.dirty = false;
        this.loaded = false;
        this.saveTimeoutId = null;
    }

    async load() {
        try {
            const result = await browserAPI.storage.local.get(STORAGE_KEYS.CACHE);
            const stored = result[STORAGE_KEYS.CACHE];
            
            if (stored && typeof stored === 'object') {
                const now = Date.now();
                let loadedCount = 0;
                let expiredCount = 0;
                
                // Load non-expired entries with their original expiry times
                for (const [key, data] of Object.entries(stored)) {
                    if (data && data.expiry > now && data.value) {
                        this.cache.set(key, data.value);
                        this.expiryMap.set(key, data.expiry); // Preserve original expiry
                        loadedCount++;
                    } else if (data && data.expiry <= now) {
                        expiredCount++;
                    }
                }
                
                console.log(`📦 Loaded ${loadedCount} cached user entries (${expiredCount} expired)`);
            }
            
            this.loaded = true;
        } catch (error) {
            console.error('Failed to load user cache:', error);
            this.loaded = true; // Mark as loaded even on error to prevent blocking
        }
    }

    async save(force = false) {
        if (!this.dirty && !force) return;
        
        // Clear any pending save
        if (this.saveTimeoutId) {
            clearTimeout(this.saveTimeoutId);
            this.saveTimeoutId = null;
        }

        try {
            const now = Date.now();
            const defaultExpiry = now + CACHE_CONFIG.EXPIRY_MS;
            const exportData = {};
            
            for (const [key, value] of this.cache.entries()) {
                // Use existing expiry if available, otherwise use default
                const expiry = this.expiryMap.get(key) || defaultExpiry;
                exportData[key] = { value, expiry };
            }
            
            await browserAPI.storage.local.set({
                [STORAGE_KEYS.CACHE]: exportData
            });
            
            this.dirty = false;
        } catch (error) {
            console.error('Failed to save user cache:', error);
        }
    }

    scheduleSave() {
        if (this.saveTimeoutId) return;
        
        this.saveTimeoutId = setTimeout(() => {
            this.saveTimeoutId = null;
            this.save();
        }, CACHE_CONFIG.SAVE_INTERVAL_MS);
    }

    get(screenName) {
        return this.cache.get(screenName);
    }

    set(screenName, data) {
        this.cache.set(screenName, data);
        // Set fresh expiry for new/updated entries
        this.expiryMap.set(screenName, Date.now() + CACHE_CONFIG.EXPIRY_MS);
        this.dirty = true;
        this.scheduleSave();
    }

    has(screenName) {
        return this.cache.has(screenName);
    }

    delete(screenName) {
        const result = this.cache.delete(screenName);
        if (result) {
            this.expiryMap.delete(screenName);
            this.dirty = true;
            this.scheduleSave();
        }
        return result;
    }

    clear() {
        this.cache.clear();
        this.expiryMap.clear();
        this.dirty = true;
        return this.save(true);
    }

    get size() {
        return this.cache.size;
    }

    getAll() {
        return Array.from(this.cache.entries()).map(([key, value]) => ({
            screenName: key,
            ...value
        }));
    }
}

/**
 * Blocked countries storage
 */
class BlockedCountriesStorage {
    constructor() {
        this.countries = new Set();
        this.loaded = false;
    }

    async load() {
        try {
            const result = await browserAPI.storage.local.get(STORAGE_KEYS.BLOCKED_COUNTRIES);
            const stored = result[STORAGE_KEYS.BLOCKED_COUNTRIES];
            
            if (Array.isArray(stored)) {
                this.countries = new Set(stored);
                console.log(`🚫 Loaded ${this.countries.size} blocked countries`);
            }
            
            this.loaded = true;
        } catch (error) {
            console.error('Failed to load blocked countries:', error);
            this.loaded = true;
        }
    }

    async save() {
        try {
            const array = Array.from(this.countries);
            await browserAPI.storage.local.set({
                [STORAGE_KEYS.BLOCKED_COUNTRIES]: array
            });
            console.log(`💾 Saved ${array.length} blocked countries`);
        } catch (error) {
            console.error('Failed to save blocked countries:', error);
        }
    }

    isBlocked(country) {
        if (!country) return false;
        return this.countries.has(country.trim().toLowerCase());
    }

    add(country) {
        const normalized = country.trim().toLowerCase();
        if (!this.countries.has(normalized)) {
            this.countries.add(normalized);
            this.save();
            return true;
        }
        return false;
    }

    remove(country) {
        const normalized = country.trim().toLowerCase();
        if (this.countries.has(normalized)) {
            this.countries.delete(normalized);
            this.save();
            return true;
        }
        return false;
    }

    toggle(country) {
        const normalized = country.trim().toLowerCase();
        if (this.countries.has(normalized)) {
            this.countries.delete(normalized);
        } else {
            this.countries.add(normalized);
        }
        this.save();
        return this.countries.has(normalized);
    }

    clear() {
        this.countries.clear();
        return this.save();
    }

    get size() {
        return this.countries.size;
    }

    getAll() {
        return Array.from(this.countries);
    }

    has(country) {
        return this.isBlocked(country);
    }
}

/**
 * Settings storage
 */
class SettingsStorage {
    constructor() {
        this.settings = { ...DEFAULT_SETTINGS };
        this.loaded = false;
        this.listeners = new Set();
    }

    async load() {
        try {
            const result = await browserAPI.storage.local.get(STORAGE_KEYS.SETTINGS);
            const stored = result[STORAGE_KEYS.SETTINGS];
            
            if (stored && typeof stored === 'object') {
                this.settings = { ...DEFAULT_SETTINGS, ...stored };
            }
            
            this.loaded = true;
            console.log('⚙️ Settings loaded:', this.settings);
        } catch (error) {
            console.error('Failed to load settings:', error);
            this.loaded = true;
        }
    }

    async save() {
        try {
            await browserAPI.storage.local.set({
                [STORAGE_KEYS.SETTINGS]: this.settings
            });
            this.notifyListeners();
        } catch (error) {
            console.error('Failed to save settings:', error);
        }
    }

    get(key) {
        if (key) {
            return this.settings[key];
        }
        return { ...this.settings };
    }

    set(key, value) {
        if (typeof key === 'object') {
            // Bulk set
            this.settings = { ...this.settings, ...key };
        } else {
            this.settings[key] = value;
        }
        return this.save();
    }

    toggle(key) {
        if (typeof this.settings[key] === 'boolean') {
            this.settings[key] = !this.settings[key];
            return this.save();
        }
        return Promise.resolve();
    }

    addListener(callback) {
        this.listeners.add(callback);
        return () => this.listeners.delete(callback);
    }

    notifyListeners() {
        for (const listener of this.listeners) {
            try {
                listener(this.settings);
            } catch (error) {
                console.error('Settings listener error:', error);
            }
        }
    }

    get isEnabled() {
        return this.settings.enabled;
    }
}

/**
 * Captured headers storage (for API authentication)
 */
class HeadersStorage {
    constructor() {
        this.headers = null;
    }

    async load() {
        try {
            const result = await browserAPI.storage.local.get(STORAGE_KEYS.HEADERS);
            this.headers = result[STORAGE_KEYS.HEADERS] || null;
            
            if (this.headers) {
                console.log('🔑 Loaded cached API headers');
            }
        } catch (error) {
            console.error('Failed to load headers:', error);
        }
    }

    async save(headers) {
        try {
            this.headers = headers;
            await browserAPI.storage.local.set({
                [STORAGE_KEYS.HEADERS]: headers
            });
            console.log('🔑 Saved API headers');
        } catch (error) {
            console.error('Failed to save headers:', error);
        }
    }

    get() {
        return this.headers;
    }

    clear() {
        this.headers = null;
        return browserAPI.storage.local.remove(STORAGE_KEYS.HEADERS);
    }

    hasHeaders() {
        return this.headers !== null && this.headers.authorization;
    }
}

// Export singleton instances
export const userCache = new UserCacheStorage();
export const blockedCountries = new BlockedCountriesStorage();
export const settings = new SettingsStorage();
export const headersStorage = new HeadersStorage();

// Export classes for testing
export { LRUCache, UserCacheStorage, BlockedCountriesStorage, SettingsStorage, HeadersStorage };

/**
 * Initialize all storage modules
 */
export async function initializeStorage() {
    await Promise.all([
        userCache.load(),
        blockedCountries.load(),
        settings.load(),
        headersStorage.load()
    ]);
    
    console.log('💾 All storage modules initialized');
}