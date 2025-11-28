/**
 * LRU (Least Recently Used) Cache Implementation
 * Shared across the extension for consistent caching behavior
 * @module lru-cache
 */

// Default max size - same as CACHE_CONFIG.MAX_ENTRIES but avoiding import
// to prevent potential circular dependencies
const DEFAULT_MAX_SIZE = 50000;

/**
 * LRU Cache with configurable max size and automatic eviction
 * @template K, V
 */
export class LRUCache {
    /**
     * @param {number} [maxSize=50000] - Maximum number of entries
     */
    constructor(maxSize = DEFAULT_MAX_SIZE) {
        this.maxSize = maxSize;
        /** @type {Map<K, V>} */
        this.cache = new Map();
    }

    /**
     * Get a value from the cache, updating its position to most recently used
     * @param {K} key - The key to look up
     * @returns {V|undefined} - The cached value or undefined if not found
     */
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

    /**
     * Set a value in the cache, evicting oldest entry if at capacity
     * @param {K} key - The key to store
     * @param {V} value - The value to store
     */
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

    /**
     * Check if a key exists in the cache
     * @param {K} key - The key to check
     * @returns {boolean}
     */
    has(key) {
        return this.cache.has(key);
    }

    /**
     * Delete a key from the cache
     * @param {K} key - The key to delete
     * @returns {boolean} - True if the key was deleted
     */
    delete(key) {
        return this.cache.delete(key);
    }

    /**
     * Clear all entries from the cache
     */
    clear() {
        this.cache.clear();
    }

    /**
     * Get the current number of entries
     * @returns {number}
     */
    get size() {
        return this.cache.size;
    }

    /**
     * Get an iterator of [key, value] pairs
     * @returns {IterableIterator<[K, V]>}
     */
    entries() {
        return this.cache.entries();
    }

    /**
     * Get an iterator of keys
     * @returns {IterableIterator<K>}
     */
    keys() {
        return this.cache.keys();
    }

    /**
     * Get an iterator of values
     * @returns {IterableIterator<V>}
     */
    values() {
        return this.cache.values();
    }

    /**
     * Convert cache to a plain object
     * @returns {Object<string, V>}
     */
    toObject() {
        const obj = {};
        for (const [key, value] of this.cache) {
            obj[key] = value;
        }
        return obj;
    }

    /**
     * Load entries from a plain object
     * @param {Object<string, V>} obj - Object with entries to load
     */
    fromObject(obj) {
        this.clear();
        for (const [key, value] of Object.entries(obj)) {
            this.set(key, value);
        }
    }
}

export default LRUCache;