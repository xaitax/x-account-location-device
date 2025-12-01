/**
 * X-Posed Mobile App - Cloud Cache Service
 * Handles cloud cache lookup and contribution (opt-in)
 *
 * Based on the browser extension's cloud-cache.js implementation
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { LocationEntry } from '../types';

// Cloud cache configuration - matches extension
const CLOUD_CONFIG = {
  API_URL: 'https://x-posed-cache.xaitax.workers.dev',
  LOOKUP_TIMEOUT_MS: 8000,
  CONTRIBUTE_TIMEOUT_MS: 10000,
  BATCH_DELAY_MS: 100,
  BATCH_SIZE: 50,
  CONTRIBUTE_BATCH_SIZE: 25,
  CONTRIBUTE_DELAY_MS: 3000,
  STORAGE_KEY: 'cloud_contribution_enabled',
  STATS_KEY: 'cloud_stats',
  // Higher limit for our own cloud cache server (not X's API)
  // Allows batch scanning without hitting limits
  MAX_REQUESTS_PER_MINUTE: 10000,
};

interface CloudStats {
  contributions: number;
  lookups: number;
  hits: number;
  misses: number;
  errors: number;
  lastContribution?: number;
}

interface CloudEntry {
  l: string;  // location
  d: string;  // device
  a: boolean; // accurate
  t: number;  // timestamp (seconds)
}

class CloudCacheService {
  private enabled: boolean = false;
  private stats: CloudStats = {
    contributions: 0,
    lookups: 0,
    hits: 0,
    misses: 0,
    errors: 0,
  };
  private contributionQueue: Map<string, CloudEntry> = new Map();
  private contributeTimeout: ReturnType<typeof setTimeout> | null = null;
  private requestCount: number = 0;
  private requestWindowStart: number = Date.now();
  private consecutiveFailures: number = 0;
  private backoffUntil: number = 0;
  private initialized: boolean = false;

  constructor() {
    // Don't auto-load in constructor - call loadSettings explicitly
  }

  /**
   * Load settings from AsyncStorage
   */
  async loadSettings(): Promise<void> {
    if (this.initialized) return;
    
    try {
      const [enabledStr, statsStr] = await Promise.all([
        AsyncStorage.getItem(CLOUD_CONFIG.STORAGE_KEY),
        AsyncStorage.getItem(CLOUD_CONFIG.STATS_KEY),
      ]);

      this.enabled = enabledStr === 'true';
      
      if (statsStr) {
        try {
          this.stats = { ...this.stats, ...JSON.parse(statsStr) };
        } catch {
          // Invalid JSON, use defaults
        }
      }

      this.initialized = true;
    } catch (error) {
      // Silent fail
    }
  }

  /**
   * Set cloud contribution enabled state
   */
  async setEnabled(enabled: boolean): Promise<void> {
    this.enabled = enabled;
    await AsyncStorage.setItem(CLOUD_CONFIG.STORAGE_KEY, String(enabled));
  }

  /**
   * Check if cloud contribution is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Get statistics
   */
  getStats(): CloudStats {
    return { ...this.stats };
  }

  /**
   * Save statistics
   */
  private async saveStats(): Promise<void> {
    try {
      await AsyncStorage.setItem(CLOUD_CONFIG.STATS_KEY, JSON.stringify(this.stats));
    } catch (error) {
      // Silent fail
    }
  }

  /**
   * Check rate limit
   */
  private checkRateLimit(): boolean {
    const now = Date.now();
    
    // Reset window if minute has passed
    if (now - this.requestWindowStart > 60000) {
      this.requestCount = 0;
      this.requestWindowStart = now;
    }
    
    if (this.requestCount >= CLOUD_CONFIG.MAX_REQUESTS_PER_MINUTE) {
      return false;
    }
    
    this.requestCount++;
    return true;
  }

  /**
   * Check if we should back off due to consecutive failures
   */
  private shouldBackoff(): boolean {
    return Date.now() < this.backoffUntil;
  }

  /**
   * Calculate backoff delay based on consecutive failures
   */
  private getBackoffDelay(): number {
    // Exponential backoff: 1s, 2s, 4s, 8s, 16s, max 30s
    return Math.min(1000 * Math.pow(2, this.consecutiveFailures), 30000);
  }

  /**
   * Record a successful request (reset backoff)
   */
  private recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.backoffUntil = 0;
  }

  /**
   * Record a failed request (increase backoff)
   */
  private recordFailure(): void {
    this.consecutiveFailures++;
    this.backoffUntil = Date.now() + this.getBackoffDelay();
  }

  /**
   * Sanitize input from cloud cache to prevent injection
   */
  private sanitizeInput(input: unknown): string | null {
    if (!input || typeof input !== 'string') return null;
    
    // Remove any HTML/script tags
    let sanitized = input.replace(/<[^>]*>/g, '');
    
    // Remove potential script injection patterns
    sanitized = sanitized.replace(/javascript:/gi, '');
    sanitized = sanitized.replace(/on\w+=/gi, '');
    
    // Limit length
    sanitized = sanitized.substring(0, 100);
    
    // Trim whitespace
    sanitized = sanitized.trim();
    
    return sanitized || null;
  }

  /**
   * Contribute a lookup result to the cloud cache
   */
  async contribute(username: string, data: LocationEntry): Promise<void> {
    if (!this.enabled || !username || !data || !data.location) {
      return;
    }

    const cleanUsername = username.toLowerCase().trim();
    
    // Validate username
    if (!cleanUsername || cleanUsername.length > 50) {
      return;
    }

    // Add to contribution queue
    this.contributionQueue.set(cleanUsername, {
      l: data.location,
      d: data.device || '',
      a: data.isAccurate !== false,
      t: Math.floor(Date.now() / 1000),
    });

    // Debounce contributions
    if (this.contributeTimeout) {
      clearTimeout(this.contributeTimeout);
    }

    this.contributeTimeout = setTimeout(() => {
      this.flushContributions();
    }, CLOUD_CONFIG.CONTRIBUTE_DELAY_MS);

    // Flush if batch is full
    if (this.contributionQueue.size >= CLOUD_CONFIG.CONTRIBUTE_BATCH_SIZE) {
      this.flushContributions();
    }
  }

  /**
   * Flush pending contributions to cloud
   */
  async flushContributions(): Promise<void> {
    if (this.contributionQueue.size === 0) {
      return;
    }

    if (this.contributeTimeout) {
      clearTimeout(this.contributeTimeout);
      this.contributeTimeout = null;
    }

    // Check backoff
    if (this.shouldBackoff()) {
      // Re-schedule
      const delay = this.backoffUntil - Date.now() + 1000;
      this.contributeTimeout = setTimeout(() => {
        this.flushContributions();
      }, delay);
      return;
    }

    // Check rate limit
    if (!this.checkRateLimit()) {
      this.contributeTimeout = setTimeout(() => {
        this.flushContributions();
      }, 60000);
      return;
    }

    // Extract and clear the queue
    const entries: Record<string, CloudEntry> = {};
    this.contributionQueue.forEach((value, key) => {
      entries[key] = value;
    });
    this.contributionQueue.clear();

    const entryCount = Object.keys(entries).length;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        CLOUD_CONFIG.CONTRIBUTE_TIMEOUT_MS
      );

      const response = await fetch(`${CLOUD_CONFIG.API_URL}/contribute`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ entries }),
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        const data = await response.json();
        const accepted = data.accepted || entryCount;
        this.stats.contributions += accepted;
        this.stats.lastContribution = Date.now();
        this.recordSuccess();
        this.saveStats();
      } else {
        // Restore entries for retry
        this.restoreContributions(entries);
        this.recordFailure();
        this.stats.errors++;
      }
    } catch (error: unknown) {
      this.stats.errors++;
      // Restore entries for retry
      this.restoreContributions(entries);
      this.recordFailure();
      this.saveStats();
    }
  }

  /**
   * Restore contributions to queue for retry
   */
  private restoreContributions(entries: Record<string, CloudEntry>): void {
    for (const [username, data] of Object.entries(entries)) {
      if (!this.contributionQueue.has(username)) {
        this.contributionQueue.set(username, data);
      }
    }
    
    // Schedule retry with backoff
    const delay = this.getBackoffDelay();
    this.contributeTimeout = setTimeout(() => {
      this.flushContributions();
    }, delay);
  }

  /**
   * Lookup a user in the cloud cache
   */
  async lookup(username: string): Promise<LocationEntry | null> {
    if (!username) return null;

    const cleanUsername = username.toLowerCase().trim();
    
    this.stats.lookups++;

    // Check backoff
    if (this.shouldBackoff()) {
      return null;
    }

    // Check rate limit
    if (!this.checkRateLimit()) {
      return null;
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), CLOUD_CONFIG.LOOKUP_TIMEOUT_MS);

      const response = await fetch(
        `${CLOUD_CONFIG.API_URL}/lookup?users=${encodeURIComponent(cleanUsername)}`,
        {
          method: 'GET',
          signal: controller.signal,
          headers: {
            'Accept': 'application/json',
          },
        }
      );

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      this.recordSuccess();

      if (data.results && data.results[cleanUsername]) {
        const info = data.results[cleanUsername];
        
        // Sanitize input
        const location = this.sanitizeInput(info.l);
        const device = this.sanitizeInput(info.d);
        
        if (!location) {
          this.stats.misses++;
          return null;
        }

        this.stats.hits++;
        this.saveStats();

        return {
          location: location,
          device: device || 'Unknown',
          isAccurate: info.a !== false,
          timestamp: (info.t || Math.floor(Date.now() / 1000)) * 1000,
          fromCloud: true, // Mark as from cloud cache
        };
      }

      this.stats.misses++;
      this.saveStats();
      return null;

    } catch (error: unknown) {
      this.recordFailure();
      this.stats.errors++;
      this.saveStats();
      return null;
    }
  }

  /**
   * Fetch server statistics
   */
  async fetchServerStats(): Promise<{ totalEntries: number; totalContributions: number; lastUpdated?: string } | null> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(`${CLOUD_CONFIG.API_URL}/stats`, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          'Accept': 'application/json',
        },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      return {
        totalEntries: data.totalEntries || 0,
        totalContributions: data.totalContributions || 0,
        lastUpdated: data.lastUpdated || undefined,
      };
    } catch (error) {
      return null;
    }
  }
}

// Singleton instance
const cloudCache = new CloudCacheService();
export default cloudCache;