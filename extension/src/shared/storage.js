/**
 * Storage Abstraction Layer
 * Uses chrome.storage/browser.storage API with LRU cache support
 */

import browserAPI from './browser-api.js';
import { STORAGE_KEYS, CACHE_CONFIG, DEFAULT_SETTINGS, canonicalCountry, affiliationWasChecked, normalizeHost } from './constants.js';
import { LRUCache } from './lru-cache.js';

/**
 * User cache data storage with per-entry expiry tracking
 */
class UserCacheStorage {
    constructor() {
        // Each in-memory LRU value is an envelope `{ value, expiry }` so that the
        // per-entry expiry is freed automatically when the LRU evicts an entry.
        this.cache = new LRUCache(CACHE_CONFIG.MAX_ENTRIES);
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

                // Load non-expired entries with their original expiry times,
                // keeping the persisted `{ value, expiry }` shape in memory.
                for (const [key, data] of Object.entries(stored)) {
                    if (!data || !Number.isFinite(data.expiry) || !data.value) continue;

                    const value = UserCacheStorage.fromPersistedValue(data.value);
                    // Older saves dropped the source timestamp. Keep that age explicitly
                    // unknown and retain the old deadline rather than inventing freshness.
                    const timestamp = UserCacheStorage.observationTimestamp(value, now);
                    const expiry = timestamp === null
                        ? data.expiry
                        : Math.min(data.expiry, timestamp + CACHE_CONFIG.EXPIRY_MS);
                    if (expiry > now) {
                        this.cache.set(key, { value: { ...value, timestamp }, expiry });
                        loadedCount++;
                    } else {
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

    /**
     * Project a cache value down to what is worth writing to disk.
     *
     * The full X API record was being persisted verbatim at roughly 830 bytes an entry.
     * With MAX_ENTRIES at 50k that is ~40 MB against chrome.storage.local's 10 MB quota
     * (no `unlimitedStorage` permission), so past about 12.6k accounts every write threw
     * and the cache silently stopped persisting while re-serialising tens of MB a minute.
     *
     * Keep location, device, accuracy, affiliation, and source freshness/provenance.
     * The affiliation filter reads `meta.affiliate` / `meta.affiliateUsername`. The
     * display name, avatar, verification state and the rest stay in memory for this
     * session and are dropped on write — `partial` tells the hovercard to do a live fetch
     * rather than render a card with half its fields blank.
     * @param {any} value
     * @returns {any}
     */
    static toPersistedValue(value) {
        if (!value || typeof value !== 'object') return value;

        const slim = {
            location: value.location ?? null,
            device: value.device ?? null,
            locationAccurate: value.locationAccurate !== false,
            timestamp: UserCacheStorage.observationTimestamp(value)
        };
        if (typeof value.fromCloud === 'boolean') slim.fromCloud = value.fromCloud;

        // Affiliation is flattened to a single short key rather than a nested meta object,
        // which is worth ~55 bytes on every one of up to 50k entries:
        //   absent  → nobody has checked this account (filter treats it as unknown)
        //   ''      → checked, has no affiliation
        //   'Name'  → affiliated
        if (affiliationWasChecked(value.meta)) {
            slim.af = value.meta.affiliate?.name || '';
        }

        return slim;
    }

    /**
     * Inverse of toPersistedValue: rebuild the in-memory shape from a stored entry.
     * Entries written before this format simply pass through — they still carry their
     * original `meta`, so nothing needs migrating.
     * @param {any} value
     * @returns {any}
     */
    static fromPersistedValue(value) {
        if (!value || typeof value !== 'object' || value.af === undefined) return value;

        const { af, ...rest } = value;
        return {
            ...rest,
            meta: {
                // Only the shared subset was persisted, so the hovercard must refetch
                // rather than render a card missing the name, avatar and verification.
                partial: true,
                // Present-but-null is what marks this account as "affiliation checked".
                affiliateUsername: null,
                affiliate: af ? { name: af } : null
            }
        };
    }

    /**
     * Drop the least-recently-used slice of the cache. Used to recover from a quota
     * failure: the Map preserves recency order, so the head is the coldest.
     * @param {number} fraction - portion of entries to shed, 0-1
     * @returns {number} how many were evicted
     */
    evictOldest(fraction = 0.25) {
        const target = Math.ceil(this.cache.size * fraction);
        let evicted = 0;
        for (const key of [...this.cache.keys()]) {
            if (evicted >= target) break;
            this.cache.delete(key);
            evicted++;
        }
        return evicted;
    }

    async save(force = false) {
        this.pruneExpired();
        // Dirty-gated: skip the whole rebuild+write when nothing changed.
        if (!this.dirty && !force) return;

        // Clear any pending save
        if (this.saveTimeoutId) {
            clearTimeout(this.saveTimeoutId);
            this.saveTimeoutId = null;
        }

        try {
            const exportData = {};

            // The in-memory value is already `{ value, expiry }`, matching the
            // persisted format — no per-entry expiry lookup needed.
            for (const [key, entry] of this.cache.entries()) {
                exportData[key] = {
                    value: UserCacheStorage.toPersistedValue(entry.value),
                    expiry: entry.expiry
                };
            }

            // Clear the dirty flag for THIS snapshot before the async write (the
            // snapshot build above is synchronous, so nothing interleaves). A set()
            // that lands during the await re-sets dirty=true and arms a fresh timer,
            // and must not be clobbered by a post-await reset — so we do NOT touch
            // dirty after the write succeeds.
            this.dirty = false;

            await browserAPI.storage.local.set({
                [STORAGE_KEYS.CACHE]: exportData
            });
        } catch (error) {
            this.dirty = true;

            // A quota failure never fixes itself: retrying the same oversized snapshot
            // every 60s just burns CPU while the cache silently stops persisting. Shed the
            // coldest quarter and write again immediately; only fall back to the timer if
            // that still fails or the error was something else (e.g. a transient write).
            if (/quota/i.test(error?.message || '')) {
                const evicted = this.evictOldest(0.25);
                console.warn(`⚠️ User cache exceeded storage quota — evicted ${evicted} least-recently-used entries and retrying`);
                if (evicted > 0) {
                    return this.save(true);
                }
            }

            // Re-arm a save so the snapshot is retried autonomously, not only on the
            // next cache mutation.
            this.scheduleSave();
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
        const entry = this.cache.get(screenName);
        if (!entry) return undefined;
        if (entry.expiry <= Date.now()) {
            this.delete(screenName);
            return undefined;
        }
        return entry.value;
    }

    /** Source observation time in milliseconds; null means unknown or invalid. */
    static observationTimestamp(data, now = Date.now()) {
        const timestamp = data?.timestamp;
        return Number.isFinite(timestamp) && timestamp > 0 && timestamp <= now
            ? timestamp
            : null;
    }

    static isFreshObservation(data, now = Date.now()) {
        const timestamp = UserCacheStorage.observationTimestamp(data, now);
        return timestamp !== null && timestamp + CACHE_CONFIG.EXPIRY_MS > now;
    }

    /**
     * Store live data or a dated cached observation without renewing its source age.
     * Undated live callers remain supported. Cached/imported data must carry a
     * timestamp (null when unknown); an unknown legacy entry keeps its old expiry.
     * @returns {boolean} whether the value was accepted
     */
    set(screenName, data) {
        if (!data || typeof data !== 'object') return false;
        const now = Date.now();
        const isUndatedLive = !Object.hasOwn(data, 'timestamp') && data.fromCloud !== true;
        const timestamp = isUndatedLive ? now : UserCacheStorage.observationTimestamp(data, now);
        const previous = this.cache.get(screenName);
        let expiry;
        if (timestamp === null) {
            // Re-selecting the same legacy local record after a cloud lookup must not
            // renew it. A newly received cloud/import record of unknown age is a miss.
            if (!previous || previous.value !== data || previous.expiry <= now) return false;
            expiry = previous.expiry;
        } else {
            expiry = timestamp + CACHE_CONFIG.EXPIRY_MS;
            if (previous?.value === data) expiry = Math.min(expiry, previous.expiry);
            if (expiry <= now) return false;
        }
        this.cache.set(screenName, { value: { ...data, timestamp }, expiry });
        this.dirty = true;
        this.scheduleSave();
        return true;
    }

    has(screenName) {
        return this.get(screenName) !== undefined;
    }

    delete(screenName) {
        const result = this.cache.delete(screenName);
        if (result) {
            this.dirty = true;
            this.scheduleSave();
        }
        return result;
    }

    async clear() {
        this.cache.clear();
        this.dirty = true;
        await this.save(true);
    }

    get size() {
        this.pruneExpired();
        return this.cache.size;
    }

    pruneExpired() {
        const now = Date.now();
        for (const [key, entry] of this.cache.entries()) {
            if (entry.expiry <= now) this.delete(key);
        }
    }

    /**
     * Iterate raw entries without allocating an object per entry.
     * Callback receives (screenName, value) for each cached user.
     * Prefer this over getAll() when computing aggregates.
     * @param {(screenName: string, value: object) => void} callback
     */
    forEach(callback) {
        this.pruneExpired();
        for (const [key, entry] of this.cache.entries()) {
            callback(key, entry.value);
        }
    }

    getAll() {
        this.pruneExpired();
        return Array.from(this.cache.entries()).map(([key, entry]) => ({
            screenName: key,
            ...entry.value
        }));
    }
}

/**
 * Generic Set-backed blocked-value storage.
 *
 * Consolidates the previously near-identical BlockedCountries/Regions/Tags
 * classes. Parameterized by:
 *   - storageKey: the chrome.storage key to persist under
 *   - label:      human-readable label for log lines
 *   - normalize:  function applied to incoming values before storing/looking up
 *                 (countries/regions: trim + lowercase; tags: trim, case-kept)
 *   - defaults:   optional array seeded on first run only (when the key has never
 *                 been written). After that the user's edits — including clearing
 *                 the list — always win, because the key then exists as an array.
 *
 * normalize returns a falsy value to reject the input (e.g. empty after trim).
 */
class BlockedSetStorage {
    constructor({ storageKey, label, normalize, defaults = [] }) {
        this.values = new Set();
        this.loaded = false;
        this.storageKey = storageKey;
        this.label = label;
        this.normalize = normalize;
        this.defaults = Array.isArray(defaults) ? defaults : [];
        this.mutationQueue = Promise.resolve();
    }

    async load() {
        try {
            const result = await browserAPI.storage.local.get(this.storageKey);
            const stored = result[this.storageKey];

            if (Array.isArray(stored)) {
                // Aliases and normalizers can change between releases. Old saved
                // values must obey the same rules as newly added values.
                this.values = new Set(stored.map(value => this.normalize(value)).filter(Boolean));
                console.log(`🚫 Loaded ${this.values.size} ${this.label}`);
            } else if (this.defaults.length) {
                // First run only: the key has never been written. Seed the defaults
                // and persist once so the value is real and consistent everywhere —
                // after this the user's edits (including clearing) stick.
                await this.setAll(this.defaults);
                console.log(`🌱 Seeded ${this.values.size} default ${this.label}`);
            }

            this.loaded = true;
        } catch (error) {
            console.error(`Failed to load ${this.label}:`, error);
            this.loaded = true;
        }
    }

    async save(values = this.values) {
        try {
            const array = Array.from(values);
            await browserAPI.storage.local.set({
                [this.storageKey]: array
            });
            console.log(`💾 Saved ${array.length} ${this.label}`);
        } catch (error) {
            console.error(`Failed to save ${this.label}:`, error);
            throw error;
        }
    }

    /** Commit one mutation at a time; failed writes never change the visible Set. */
    commitMutation(change) {
        const operation = this.mutationQueue.then(async () => {
            const next = new Set(this.values);
            if (change(next) === false) return;
            await this.save(next);
            this.values = next;
        });
        // Keep later operations usable after a failure, while returning the real
        // rejection to the caller so the message handler reports success:false.
        this.mutationQueue = operation.catch(() => {});
        return operation;
    }

    /**
     * Replace the entire in-memory set from an array/iterable and persist once.
     * Mutates the Set a single time and performs exactly one write.
     * @param {Iterable<string>} valuesIterable
     * @returns {Promise<void>}
     */
    setAll(valuesIterable) {
        const next = new Set();
        if (valuesIterable) {
            for (const value of valuesIterable) {
                const normalized = this.normalize(value);
                if (normalized) {
                    next.add(normalized);
                }
            }
        }
        return this.commitMutation(values => {
            values.clear();
            for (const value of next) values.add(value);
        });
    }

    isBlocked(value) {
        if (!value) return false;
        const normalized = this.normalize(value);
        if (!normalized) return false;
        return this.values.has(normalized);
    }

    add(value) {
        const normalized = this.normalize(value);
        if (!normalized) return Promise.resolve();
        return this.commitMutation(values => {
            if (values.has(normalized)) return false;
            values.add(normalized);
        });
    }

    remove(value) {
        const normalized = this.normalize(value);
        if (!normalized) return Promise.resolve();
        return this.commitMutation(values => values.delete(normalized));
    }

    toggle(value) {
        const normalized = this.normalize(value);
        if (!normalized) return Promise.resolve();
        return this.commitMutation(values => {
            if (values.has(normalized)) values.delete(normalized);
            else values.add(normalized);
        });
    }

    /**
     * Check if any of the given values are blocked.
     * @param {string[]} valuesToCheck - Array of values to check
     * @returns {string|null} - The first blocked value found, or null
     */
    findBlocked(valuesToCheck) {
        if (!valuesToCheck || !Array.isArray(valuesToCheck)) return null;
        for (const value of valuesToCheck) {
            if (this.isBlocked(value)) {
                return this.normalize(value);
            }
        }
        return null;
    }

    clear() {
        return this.commitMutation(values => { values.clear(); });
    }

    get size() {
        return this.values.size;
    }

    getAll() {
        return Array.from(this.values);
    }

    has(value) {
        return this.isBlocked(value);
    }
}

// Normalizers: countries/regions are trimmed + lowercased; tags keep their case.
const normalizeLower = value => {
    if (!value || typeof value !== 'string') return '';
    return value.trim().toLowerCase();
};
// Countries additionally fold aliases onto the canonical name, so a config imported
// with "Macedonia" or "USA" still matches what X reports.
const normalizeCountry = value => canonicalCountry(value);
const normalizeTag = value => {
    if (!value || typeof value !== 'string') return '';
    return value.trim();
};
// Languages are stored as the lowercase primary BCP-47 subtag ("zh" from "zh-Hant"),
// matching how observer.js reads X's per-tweet lang attribute.
const normalizeLanguage = value => {
    if (!value || typeof value !== 'string') return '';
    return value.trim().toLowerCase().split('-')[0];
};
// Allowlisted accounts are stored as the lowercase screen name (X handles are
// case-insensitive). Accepts an optional leading "@" and enforces X's handle rule
// (1-15 chars, alphanumeric + underscore); anything else is rejected.
const normalizeUsername = value => {
    if (!value || typeof value !== 'string') return '';
    const handle = value.trim().replace(/^@+/, '').toLowerCase();
    return /^[a-z0-9_]{1,15}$/.test(handle) ? handle : '';
};
// Linked domains are stored as a bare lowercase host: scheme, "www.", port, path and
// query are all stripped, so pasting a full profile URL works and every stored value is
// directly comparable. Anything that isn't a plausible host normalizes to '' and is
// dropped by BlockedSetStorage, which is also what rejects junk on import.
const normalizeLinkDomain = value => normalizeHost(value);

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
export const blockedCountries = new BlockedSetStorage({
    storageKey: STORAGE_KEYS.BLOCKED_COUNTRIES,
    label: 'blocked countries',
    normalize: normalizeCountry
});
export const blockedRegions = new BlockedSetStorage({
    storageKey: STORAGE_KEYS.BLOCKED_REGIONS,
    label: 'blocked regions',
    normalize: normalizeLower
});
export const blockedTags = new BlockedSetStorage({
    storageKey: STORAGE_KEYS.BLOCKED_TAGS,
    label: 'blocked tags',
    normalize: normalizeTag
});
// Bio tags are matched case-insensitively against the account's bio, so they are stored
// lowercased — unlike display-name tags, which keep their case because emoji and bracketed
// markers are compared literally.
export const blockedBioTags = new BlockedSetStorage({
    storageKey: STORAGE_KEYS.BLOCKED_BIO_TAGS,
    label: 'blocked bio tags',
    normalize: normalizeLower
});
// Account-label choices (PCF labels and the optional grey-checkmark filter). Keep
// the existing storage key for backup and settings compatibility; none are seeded.
export const blockedPcf = new BlockedSetStorage({
    storageKey: STORAGE_KEYS.BLOCKED_PCF,
    label: 'blocked account labels',
    normalize: normalizeLower
});
export const blockedLanguages = new BlockedSetStorage({
    storageKey: STORAGE_KEYS.BLOCKED_LANGUAGES,
    label: 'blocked languages',
    normalize: normalizeLanguage
});
export const blockedAffiliations = new BlockedSetStorage({
    storageKey: STORAGE_KEYS.BLOCKED_AFFILIATIONS,
    label: 'blocked affiliations',
    normalize: normalizeLower
});
export const blockedLinks = new BlockedSetStorage({
    storageKey: STORAGE_KEYS.BLOCKED_LINKS,
    label: 'blocked links',
    normalize: normalizeLinkDomain
});
export const allowedUsers = new BlockedSetStorage({
    storageKey: STORAGE_KEYS.ALLOWED_USERS,
    label: 'always-show accounts',
    normalize: normalizeUsername,
    // Ship the extension author allowlisted by default (issue #26). First run only —
    // remove it and it stays removed.
    defaults: ['xaitax']
});
export const settings = new SettingsStorage();
export const headersStorage = new HeadersStorage();

// Export classes for testing
export { LRUCache, UserCacheStorage, BlockedSetStorage, SettingsStorage, HeadersStorage };

/**
 * Initialize all storage modules
 */
export async function initializeStorage() {
    await Promise.all([
        userCache.load(),
        blockedCountries.load(),
        blockedRegions.load(),
        blockedTags.load(),
        blockedBioTags.load(),
        blockedPcf.load(),
        blockedLanguages.load(),
        blockedAffiliations.load(),
        blockedLinks.load(),
        allowedUsers.load(),
        settings.load(),
        headersStorage.load()
    ]);
    
    console.log('💾 All storage modules initialized');
}
