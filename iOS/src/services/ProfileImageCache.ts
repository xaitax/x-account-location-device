/**
 * X-Posed Mobile App - Profile Image Cache Service
 * Caches profile image URLs to reduce API calls and provide offline access
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const CACHE_KEY = 'profile_image_cache';
const CACHE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const MAX_CACHE_SIZE = 500; // Maximum number of cached profiles

interface CachedProfileImage {
  url: string;
  timestamp: number;
  username: string;
}

interface ProfileImageCacheData {
  entries: Record<string, CachedProfileImage>;
  lastCleanup: number;
}

class ProfileImageCacheService {
  private cache: ProfileImageCacheData = { entries: {}, lastCleanup: 0 };
  private initialized = false;
  private saveTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // Load cache lazily
  }

  /**
   * Initialize the cache from AsyncStorage
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    try {
      const data = await AsyncStorage.getItem(CACHE_KEY);
      if (data) {
        const parsed = JSON.parse(data) as ProfileImageCacheData;
        this.cache = parsed;
        console.log(`[ProfileImageCache] Loaded ${Object.keys(this.cache.entries).length} cached profile images`);
      }
      this.initialized = true;

      // Run cleanup if needed (once per day)
      const dayMs = 24 * 60 * 60 * 1000;
      if (Date.now() - this.cache.lastCleanup > dayMs) {
        this.cleanup();
      }
    } catch (error) {
      console.warn('[ProfileImageCache] Failed to load cache:', error);
      this.initialized = true;
    }
  }

  /**
   * Get cached profile image URL
   * @param username - X username
   * @returns cached URL or null
   */
  async get(username: string): Promise<string | null> {
    await this.init();
    
    const key = username.toLowerCase();
    const entry = this.cache.entries[key];
    
    if (!entry) {
      return null;
    }

    // Check if expired
    if (Date.now() - entry.timestamp > CACHE_EXPIRY_MS) {
      delete this.cache.entries[key];
      this.scheduleSave();
      return null;
    }

    return entry.url;
  }

  /**
   * Cache a profile image URL
   * @param username - X username
   * @param url - Profile image URL
   */
  async set(username: string, url: string): Promise<void> {
    await this.init();

    const key = username.toLowerCase();
    
    this.cache.entries[key] = {
      url,
      timestamp: Date.now(),
      username: key,
    };

    this.scheduleSave();
    console.log(`[ProfileImageCache] Cached profile image for @${key}`);
  }

  /**
   * Remove a cached profile image
   * @param username - X username
   */
  async remove(username: string): Promise<void> {
    await this.init();

    const key = username.toLowerCase();
    delete this.cache.entries[key];
    this.scheduleSave();
  }

  /**
   * Clear all cached profile images
   */
  async clear(): Promise<void> {
    this.cache = { entries: {}, lastCleanup: Date.now() };
    await this.save();
    console.log('[ProfileImageCache] Cache cleared');
  }

  /**
   * Get cache statistics
   */
  async getStats(): Promise<{ count: number; oldestTimestamp: number | null }> {
    await this.init();

    const entries = Object.values(this.cache.entries);
    const count = entries.length;
    const oldestTimestamp = entries.length > 0 
      ? Math.min(...entries.map(e => e.timestamp))
      : null;

    return { count, oldestTimestamp };
  }

  /**
   * Schedule a debounced save
   */
  private scheduleSave(): void {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }
    this.saveTimeout = setTimeout(() => this.save(), 1000);
  }

  /**
   * Save cache to AsyncStorage
   */
  private async save(): Promise<void> {
    try {
      await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(this.cache));
    } catch (error) {
      console.warn('[ProfileImageCache] Failed to save cache:', error);
    }
  }

  /**
   * Cleanup expired entries and limit cache size
   */
  private async cleanup(): Promise<void> {
    const now = Date.now();
    const entries = Object.entries(this.cache.entries);
    
    // Remove expired entries
    let removedCount = 0;
    for (const [key, entry] of entries) {
      if (now - entry.timestamp > CACHE_EXPIRY_MS) {
        delete this.cache.entries[key];
        removedCount++;
      }
    }

    // If still over limit, remove oldest entries
    const remaining = Object.entries(this.cache.entries);
    if (remaining.length > MAX_CACHE_SIZE) {
      const sorted = remaining.sort((a, b) => a[1].timestamp - b[1].timestamp);
      const toRemove = sorted.slice(0, remaining.length - MAX_CACHE_SIZE);
      for (const [key] of toRemove) {
        delete this.cache.entries[key];
        removedCount++;
      }
    }

    this.cache.lastCleanup = now;
    await this.save();

    if (removedCount > 0) {
      console.log(`[ProfileImageCache] Cleanup: removed ${removedCount} entries`);
    }
  }
}

// Singleton instance
const profileImageCache = new ProfileImageCacheService();
export default profileImageCache;