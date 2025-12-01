/**
 * X-Posed Mobile App - Cloud Cache API Service
 * Handles lookups from the community cloud cache
 */

import { LocationEntry, CloudCacheResponse, BatchLookupResult } from '../types';

// Cloud Cache Configuration
const CLOUD_CACHE_CONFIG = {
  API_URL: 'https://x-posed-cache.xaitax.workers.dev',
  LOOKUP_TIMEOUT_MS: 5000,
  BATCH_SIZE: 50,
  MAX_RETRIES: 2,
  RETRY_DELAY_MS: 1000,
};

/**
 * Cloud Cache API Service
 * Provides anonymous lookups for cached user data
 */
export class CacheAPI {
  private static requestCount = 0;
  private static requestWindowStart = Date.now();
  private static consecutiveFailures = 0;
  private static backoffUntil = 0;

  /**
   * Check if we should back off due to consecutive failures
   */
  private static shouldBackoff(): boolean {
    return Date.now() < this.backoffUntil;
  }

  /**
   * Calculate backoff delay based on consecutive failures
   */
  private static getBackoffDelay(): number {
    // Exponential backoff: 1s, 2s, 4s, 8s, max 30s
    return Math.min(1000 * Math.pow(2, this.consecutiveFailures), 30000);
  }

  /**
   * Record a successful request (reset backoff)
   */
  private static recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.backoffUntil = 0;
  }

  /**
   * Record a failed request (increase backoff)
   */
  private static recordFailure(): void {
    this.consecutiveFailures++;
    this.backoffUntil = Date.now() + this.getBackoffDelay();
  }

  /**
   * Lookup a single user in the cloud cache
   * @param username - X username without @
   * @returns LocationEntry or null if not found
   */
  static async lookupUser(username: string): Promise<LocationEntry | null> {
    try {
      // Check backoff
      if (this.shouldBackoff()) {
        return null;
      }

      const lowerUsername = username.toLowerCase().trim();
      
      // Create abort controller for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), CLOUD_CACHE_CONFIG.LOOKUP_TIMEOUT_MS);

      try {
        const response = await fetch(
          `${CLOUD_CACHE_CONFIG.API_URL}/lookup?users=${encodeURIComponent(lowerUsername)}`,
          {
            method: 'GET',
            headers: {
              'Accept': 'application/json',
            },
            signal: controller.signal,
          }
        );

        clearTimeout(timeoutId);

        if (!response.ok) {
          if (response.status === 429) {
            this.recordFailure();
          }
          
          return null;
        }

        const data: CloudCacheResponse = await response.json();

        this.recordSuccess();

        if (data.results && data.results[lowerUsername]) {
          const result = data.results[lowerUsername];
          return {
            location: result.l || '',
            device: result.d || '',
            isAccurate: result.a !== false,
            timestamp: (result.t || Math.floor(Date.now() / 1000)) * 1000, // Convert to ms
            fromCloud: true,
            username: lowerUsername,
          };
        }

        return null;
      } catch (fetchError: any) {
        clearTimeout(timeoutId);
        this.recordFailure();
        return null;
      }
    } catch (error) {
      this.recordFailure();
      return null;
    }
  }

  /**
   * Lookup multiple users in batch
   * @param usernames - Array of X usernames
   * @returns Map of username to LocationEntry
   */
  static async lookupBatch(usernames: string[]): Promise<Map<string, LocationEntry>> {
    const results = new Map<string, LocationEntry>();
    
    if (!usernames || usernames.length === 0) {
      return results;
    }

    // Check backoff
    if (this.shouldBackoff()) {
      return results;
    }

    // Process in batches
    const batches: string[][] = [];
    for (let i = 0; i < usernames.length; i += CLOUD_CACHE_CONFIG.BATCH_SIZE) {
      batches.push(usernames.slice(i, i + CLOUD_CACHE_CONFIG.BATCH_SIZE));
    }

    for (const batch of batches) {
      try {
        const lowerUsernames = batch.map(u => u.toLowerCase().trim());
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), CLOUD_CACHE_CONFIG.LOOKUP_TIMEOUT_MS);

        const response = await fetch(
          `${CLOUD_CACHE_CONFIG.API_URL}/lookup?users=${encodeURIComponent(lowerUsernames.join(','))}`,
          {
            method: 'GET',
            headers: {
              'Accept': 'application/json',
            },
            signal: controller.signal,
          }
        );

        clearTimeout(timeoutId);

        if (response.ok) {
          const data: CloudCacheResponse = await response.json();
          
          if (data.results) {
            for (const [username, info] of Object.entries(data.results)) {
              results.set(username.toLowerCase(), {
                location: info.l || '',
                device: info.d || '',
                isAccurate: info.a !== false,
                timestamp: (info.t || Math.floor(Date.now() / 1000)) * 1000,
                fromCloud: true,
                username: username.toLowerCase(),
              });
            }
          }
          
          this.recordSuccess();
        } else {
          if (response.status === 429) {
            this.recordFailure();
            break; // Stop processing batches on rate limit
          }
        }
      } catch (error: any) {
        this.recordFailure();
      }

      // Small delay between batches
      if (batches.indexOf(batch) < batches.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    return results;
  }

  /**
   * Lookup with detailed results for batch operations
   * @param usernames - Array of usernames
   * @returns Array of BatchLookupResult
   */
  static async lookupBatchWithDetails(usernames: string[]): Promise<BatchLookupResult[]> {
    const cacheResults = await this.lookupBatch(usernames);
    
    return usernames.map(username => {
      const lowerUsername = username.toLowerCase().trim();
      const data = cacheResults.get(lowerUsername) || null;
      
      return {
        username,
        data,
        error: data ? undefined : 'Not found in cache',
      };
    });
  }

  /**
   * Get cloud cache server statistics
   */
  static async getServerStats(): Promise<{ totalEntries: number; totalContributions: number } | null> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(`${CLOUD_CACHE_CONFIG.API_URL}/stats`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      return {
        totalEntries: data.totalEntries || 0,
        totalContributions: data.totalContributions || 0,
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Legacy method for backward compatibility
   */
  static async lookup(username: string): Promise<LocationEntry | null> {
    return this.lookupUser(username);
  }
}

export default CacheAPI;
