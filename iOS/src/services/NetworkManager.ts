/**
 * X-Posed Mobile App - Network Manager
 * Routes requests based on mode (cache vs live)
 */

import { LocationEntry, Session, LookupMode, BatchLookupResult } from '../types';
import { CacheAPI } from './CacheAPI';
import { XGraphQLAPI } from './XGraphQLAPI';
import cloudCache from './CloudCache';

/**
 * Network Manager
 * Handles routing between Cache API and Live GraphQL API
 */
export class NetworkManager {
  /**
   * Lookup a single user
   * @param username - X username without @
   * @param mode - 'cache' or 'live'
   * @param session - Session (required for live mode)
   * @returns LocationEntry or null
   */
  static async lookupUser(
    username: string,
    mode: LookupMode,
    session?: Session
  ): Promise<LocationEntry | null> {
    // Validate username
    if (!username || typeof username !== 'string') {
      return null;
    }

    const cleanUsername = username.trim().replace(/^@/, '');
    
    // Basic username validation (1-15 chars, alphanumeric + underscore)
    if (!/^[a-zA-Z0-9_]{1,15}$/.test(cleanUsername)) {
      return null;
    }

    if (mode === 'cache') {
      // Use CloudCache singleton for stats tracking
      return cloudCache.lookup(cleanUsername);
    } else {
      // Live mode requires session
      if (!session || !session.authToken || !session.csrfToken) {
        return null;
      }
      return XGraphQLAPI.fetchUserInfo(cleanUsername, session);
    }
  }

  /**
   * Lookup multiple users in batch
   * @param usernames - Array of usernames
   * @param mode - 'cache' or 'live'
   * @param session - Session (required for live mode)
   * @param onProgress - Optional progress callback for live mode
   * @returns Map of username to LocationEntry
   */
  static async lookupBatch(
    usernames: string[],
    mode: LookupMode,
    session?: Session,
    onProgress?: (completed: number, total: number, current: string) => void
  ): Promise<Map<string, LocationEntry>> {
    if (!usernames || usernames.length === 0) {
      return new Map();
    }

    // Clean usernames
    const cleanUsernames = usernames
      .map(u => u.trim().replace(/^@/, ''))
      .filter(u => /^[a-zA-Z0-9_]{1,15}$/.test(u));

    if (mode === 'cache') {
      return CacheAPI.lookupBatch(cleanUsernames);
    } else {
      if (!session || !session.authToken || !session.csrfToken) {
        return new Map();
      }
      return XGraphQLAPI.lookupBatch(cleanUsernames, session, onProgress);
    }
  }

  /**
   * Lookup with detailed results
   */
  static async lookupBatchWithDetails(
    usernames: string[],
    mode: LookupMode,
    session?: Session,
    onProgress?: (completed: number, total: number, current: string) => void
  ): Promise<BatchLookupResult[]> {
    if (!usernames || usernames.length === 0) {
      return [];
    }

    // Clean usernames
    const cleanUsernames = usernames
      .map(u => u.trim().replace(/^@/, ''))
      .filter(u => /^[a-zA-Z0-9_]{1,15}$/.test(u));

    if (mode === 'cache') {
      return CacheAPI.lookupBatchWithDetails(cleanUsernames);
    } else {
      if (!session || !session.authToken || !session.csrfToken) {
        return cleanUsernames.map(username => ({
          username,
          data: null,
          error: 'Authentication required for live mode',
        }));
      }
      return XGraphQLAPI.lookupBatchWithDetails(cleanUsernames, session, onProgress);
    }
  }

  /**
   * Smart lookup - try cache first, then live if cache miss
   * If live mode returns data and cloud cache is enabled, contribute it
   * @param username - Username to lookup
   * @param session - Session for live fallback
   * @returns LocationEntry with source info
   */
  static async smartLookup(
    username: string,
    session?: Session
  ): Promise<{ data: LocationEntry | null; source: 'cache' | 'live' | 'none' }> {
    const cleanUsername = username.trim().replace(/^@/, '').toLowerCase();
    
    // Try cache first (uses CloudCache singleton for stats tracking)
    const cacheResult = await cloudCache.lookup(cleanUsername);
    
    if (cacheResult) {
      return { data: cacheResult, source: 'cache' };
    }

    // If we have a session, try live
    if (session && session.authToken && session.csrfToken) {
      const liveResult = await this.lookupUser(username, 'live', session);
      if (liveResult) {
        // Contribute to cloud cache if enabled
        if (cloudCache.isEnabled()) {
          cloudCache.contribute(cleanUsername, liveResult);
        }
        return { data: liveResult, source: 'live' };
      }
    }

    return { data: null, source: 'none' };
  }

  /**
   * Get rate limit status
   */
  static getRateLimitStatus(): { cache: boolean; live: { isRateLimited: boolean; remainingMs: number | null } } {
    const liveStatus = XGraphQLAPI.getRateLimitStatus();
    
    return {
      cache: false, // Cache API doesn't expose rate limit status yet
      live: {
        isRateLimited: liveStatus.isRateLimited,
        remainingMs: liveStatus.remainingMs,
      },
    };
  }

  /**
   * Parse username from input (handles URLs and @ prefix)
   */
  static parseUsername(input: string): string | null {
    if (!input) return null;
    
    let username = input.trim();
    
    // Handle X/Twitter URLs
    const urlPatterns = [
      /(?:https?:\/\/)?(?:www\.)?(?:twitter\.com|x\.com)\/([a-zA-Z0-9_]+)/i,
      /^@?([a-zA-Z0-9_]{1,15})$/,
    ];
    
    for (const pattern of urlPatterns) {
      const match = username.match(pattern);
      if (match && match[1]) {
        const extracted = match[1];
        // Validate (exclude reserved names)
        const reserved = ['home', 'explore', 'notifications', 'messages', 'search', 'settings', 'i', 'compose'];
        if (!reserved.includes(extracted.toLowerCase()) && /^[a-zA-Z0-9_]{1,15}$/.test(extracted)) {
          return extracted;
        }
      }
    }
    
    return null;
  }
}

export default NetworkManager;
