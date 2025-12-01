/**
 * X-Posed Mobile App - X GraphQL API Service
 * Handles live lookups directly from X's GraphQL API
 */

import { LocationEntry, Session, GraphQLResponse, BatchLookupResult, APIError } from '../types';

// Debug mode - set to true to see detailed request/response logging
const DEBUG_MODE = false;

/**
 * Debug logger for detailed API inspection
 */
const debugLog = {
  request: (url: string, headers: Record<string, string>) => {
    if (!DEBUG_MODE) return;
    console.log('\n========== [DEBUG] API REQUEST ==========');
    console.log('[DEBUG] URL:', url);
    console.log('[DEBUG] Headers:');
    Object.entries(headers).forEach(([key, value]) => {
      // Mask sensitive data but show structure
      if (key.toLowerCase() === 'cookie') {
        console.log(`  ${key}: auth_token=***; ct0=***`);
      } else if (key.toLowerCase() === 'authorization') {
        console.log(`  ${key}: Bearer ***...${value.slice(-20)}`);
      } else {
        console.log(`  ${key}: ${value}`);
      }
    });
    console.log('==========================================\n');
  },

  response: (status: number, statusText: string, headers: Headers) => {
    if (!DEBUG_MODE) return;
    console.log('\n========== [DEBUG] API RESPONSE ==========');
    console.log('[DEBUG] Status:', status, statusText);
    console.log('[DEBUG] Response Headers:');
    headers.forEach((value, key) => {
      console.log(`  ${key}: ${value}`);
    });
    console.log('==========================================\n');
  },

  responseBody: (data: any, username: string) => {
    if (!DEBUG_MODE) return;
    console.log('\n========== [DEBUG] RESPONSE BODY ==========');
    console.log('[DEBUG] Lookup for username:', username);
    console.log('[DEBUG] Raw JSON (first 2000 chars):');
    const jsonStr = JSON.stringify(data, null, 2);
    console.log(jsonStr.substring(0, 2000));
    if (jsonStr.length > 2000) {
      console.log(`... [truncated, total length: ${jsonStr.length}]`);
    }
    
    // Check for base64 patterns
    console.log('\n[DEBUG] Scanning for base64 patterns...');
    const base64Pattern = /[A-Za-z0-9+/]{20,}={0,2}/g;
    const matches = jsonStr.match(base64Pattern);
    if (matches && matches.length > 0) {
      console.log(`[DEBUG] Found ${matches.length} potential base64 strings:`);
      matches.forEach((match, i) => {
        console.log(`  [${i}] ${match.substring(0, 50)}... (length: ${match.length})`);
        // Try to decode
        try {
          const decoded = atob(match);
          if (decoded.length > 0 && /[\x20-\x7E]/.test(decoded)) {
            console.log(`      Decoded: ${decoded.substring(0, 100)}`);
          }
        } catch (e) {
          // Not valid base64
        }
      });
    } else {
      console.log('[DEBUG] No base64 patterns found');
    }

    // Log all string values that might contain usernames
    console.log('\n[DEBUG] Scanning for username-related strings...');
    const findStrings = (obj: any, path: string = ''): void => {
      if (typeof obj === 'string') {
        const lower = obj.toLowerCase();
        if (lower.includes('xaitax') || lower.includes('screen_name') || lower.includes('username')) {
          console.log(`[DEBUG] String at ${path}: "${obj}"`);
        }
      } else if (typeof obj === 'object' && obj !== null) {
        Object.entries(obj).forEach(([key, value]) => {
          const newPath = path ? `${path}.${key}` : key;
          // Log screen_name fields specifically
          if (key.toLowerCase().includes('screen') || key.toLowerCase().includes('name') || key.toLowerCase().includes('user')) {
            console.log(`[DEBUG] Key "${key}" at ${path}:`, value);
          }
          findStrings(value, newPath);
        });
      }
    };
    findStrings(data);
    
    console.log('==========================================\n');
  },

  parseResult: (profile: any, result: LocationEntry | null) => {
    if (!DEBUG_MODE) return;
    console.log('\n========== [DEBUG] PARSE RESULT ==========');
    console.log('[DEBUG] Profile object:', profile);
    console.log('[DEBUG] Parsed result:', result);
    if (profile) {
      console.log('[DEBUG] Profile keys:', Object.keys(profile));
      console.log('[DEBUG] account_based_in:', profile.account_based_in);
      console.log('[DEBUG] source:', profile.source);
      console.log('[DEBUG] location_accurate:', profile.location_accurate);
    }
    console.log('==========================================\n');
  },

  error: (context: string, error: any) => {
    if (!DEBUG_MODE) return;
    console.log('\n========== [DEBUG] ERROR ==========');
    console.log('[DEBUG] Context:', context);
    console.log('[DEBUG] Error:', error);
    if (error?.message) console.log('[DEBUG] Message:', error.message);
    if (error?.stack) console.log('[DEBUG] Stack:', error.stack);
    console.log('====================================\n');
  },

  dataPath: (data: any) => {
    if (!DEBUG_MODE) return;
    console.log('\n========== [DEBUG] DATA PATH ANALYSIS ==========');
    console.log('[DEBUG] data:', typeof data, data ? 'exists' : 'null/undefined');
    console.log('[DEBUG] data.data:', data?.data);
    console.log('[DEBUG] data.data.user_result_by_screen_name:', data?.data?.user_result_by_screen_name);
    console.log('[DEBUG] data.data.user_result_by_screen_name.result:', data?.data?.user_result_by_screen_name?.result);
    console.log('[DEBUG] data.data.user_result_by_screen_name.result.about_profile:', data?.data?.user_result_by_screen_name?.result?.about_profile);
    
    // Check for alternative paths
    if (data?.data) {
      console.log('[DEBUG] Top-level keys in data.data:', Object.keys(data.data));
    }
    if (data?.data?.user_result_by_screen_name?.result) {
      console.log('[DEBUG] Keys in result:', Object.keys(data.data.user_result_by_screen_name.result));
    }
    console.log('=================================================\n');
  }
};

// X GraphQL API Configuration
const API_CONFIG = {
  QUERY_ID: 'XRqGa7EeokUU5kppkh13EA',
  BASE_URL: 'https://x.com/i/api/graphql',
  BEARER_TOKEN: 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA',
  TIMEOUT_MS: 10000,
  MAX_RETRIES: 2,
  RETRY_DELAY_MS: 3000,
  MIN_INTERVAL_MS: 300,
};

// Error codes
const API_ERROR_CODES = {
  NO_SESSION: 'NO_SESSION',
  RATE_LIMITED: 'RATE_LIMITED',
  NETWORK_ERROR: 'NETWORK_ERROR',
  PARSE_ERROR: 'PARSE_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  UNAUTHORIZED: 'UNAUTHORIZED',
  UNKNOWN: 'UNKNOWN',
} as const;

/**
 * X GraphQL API Service
 * Provides live lookups for any X user (requires authentication)
 */
export class XGraphQLAPI {
  private static lastRequestTime = 0;
  private static rateLimitReset = 0;
  private static consecutiveFailures = 0;

  /**
   * Check if rate limited
   */
  private static isRateLimited(): boolean {
    return Date.now() < this.rateLimitReset;
  }

  /**
   * Enforce minimum interval between requests
   */
  private static async enforceRateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLast = now - this.lastRequestTime;
    
    if (timeSinceLast < API_CONFIG.MIN_INTERVAL_MS) {
      await new Promise<void>(resolve => 
        setTimeout(resolve, API_CONFIG.MIN_INTERVAL_MS - timeSinceLast)
      );
    }
    
    this.lastRequestTime = Date.now();
  }

  /**
   * Build request headers
   */
  private static buildHeaders(authToken: string, csrfToken: string): Record<string, string> {
    return {
      'authorization': `Bearer ${API_CONFIG.BEARER_TOKEN}`,
      'x-csrf-token': csrfToken,
      'x-twitter-active-user': 'yes',
      'x-twitter-auth-type': 'OAuth2Session',
      'content-type': 'application/json',
      'accept-language': 'en-US,en;q=0.9',
      'cookie': `auth_token=${authToken}; ct0=${csrfToken}`,
    };
  }

  /**
   * Build API URL with variables
   */
  private static buildUrl(screenName: string): string {
    const variables = JSON.stringify({ screenName });
    return `${API_CONFIG.BASE_URL}/${API_CONFIG.QUERY_ID}/AboutAccountQuery?variables=${encodeURIComponent(variables)}`;
  }

  /**
   * Parse API response
   */
  private static parseResponse(data: GraphQLResponse, username: string): LocationEntry | null {
    try {
      // Debug: analyze data path
      debugLog.dataPath(data);
      
      const profile = data?.data?.user_result_by_screen_name?.result?.about_profile;
      
      if (!profile) {
        // Debug: try to find alternative data paths
        if (DEBUG_MODE) {
          console.log('[DEBUG] Attempting to find alternative data paths...');
          const result = data?.data?.user_result_by_screen_name?.result;
          if (result) {
            console.log('[DEBUG] Result object exists with keys:', Object.keys(result));
            console.log('[DEBUG] Full result object:', JSON.stringify(result, null, 2).substring(0, 1000));
          }
        }
        
        return null;
      }

      const entry: LocationEntry = {
        location: profile.account_based_in || '',
        device: profile.source || '',
        isAccurate: profile.location_accurate !== false,
        timestamp: Date.now(),
        fromCloud: false,
        username: username.toLowerCase(),
      };
      
      debugLog.parseResult(profile, entry);
      
      return entry;
    } catch (error) {
      debugLog.error('parseResponse', error);
      return null;
    }
  }

  /**
   * Handle error responses
   */
  private static handleError(status: number, response?: Response): APIError {
    switch (status) {
      case 401:
      case 403:
        return {
          code: 'UNAUTHORIZED',
          message: 'Authentication failed. Please re-login.',
          statusCode: status,
        };
      case 404:
        return {
          code: 'NOT_FOUND',
          message: 'User not found',
          statusCode: status,
        };
      case 429:
        // Parse x-rate-limit-reset header (Unix timestamp in seconds)
        let retryAfter = Date.now() + 60000; // Default 60 seconds
        
        if (response) {
          const resetHeader = response.headers.get('x-rate-limit-reset');
          if (resetHeader) {
            // Header is Unix timestamp in seconds, convert to milliseconds
            const resetTimestamp = parseInt(resetHeader, 10) * 1000;
            if (!isNaN(resetTimestamp) && resetTimestamp > Date.now()) {
              retryAfter = resetTimestamp;
            }
          }
        }
        
        this.rateLimitReset = retryAfter;
        const waitMinutes = Math.ceil((retryAfter - Date.now()) / 60000);
        
        return {
          code: 'RATE_LIMITED',
          message: `Rate limit exceeded. Retry in ${waitMinutes} minute(s).`,
          statusCode: status,
          retryAfter,
        };
      default:
        return {
          code: 'UNKNOWN',
          message: `API error: ${status}`,
          statusCode: status,
        };
    }
  }

  /**
   * Fetch user info from X GraphQL API (single user)
   * @param username - X username without @
   * @param session - Authentication session
   * @returns LocationEntry or null
   */
  static async fetchUserInfo(
    username: string,
    session: Session
  ): Promise<LocationEntry | null> {
    // Validate session
    if (!session || !session.authToken || !session.csrfToken) {
      return null;
    }

    // Check rate limit
    if (this.isRateLimited()) {
      return null;
    }

    // Enforce rate limit
    await this.enforceRateLimit();

    try {
      const url = this.buildUrl(username);
      const headers = this.buildHeaders(session.authToken, session.csrfToken);

      // Debug: log request details
      debugLog.request(url, headers);

      // Create abort controller for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), API_CONFIG.TIMEOUT_MS);

      const response = await fetch(url, {
        method: 'GET',
        headers,
        credentials: 'include',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Debug: log response headers
      debugLog.response(response.status, response.statusText, response.headers);

      if (!response.ok) {
        const error = this.handleError(response.status, response);
        
        // Debug: try to get error response body
        if (DEBUG_MODE) {
          try {
            const errorText = await response.text();
            console.log('[DEBUG] Error response body:', errorText.substring(0, 500));
          } catch (e) {
            console.log('[DEBUG] Could not read error response body');
          }
        }
        
        if (error.code === 'RATE_LIMITED') {
          this.consecutiveFailures++;
        }
        
        return null;
      }

      // Reset failure count on success
      this.consecutiveFailures = 0;

      const data: GraphQLResponse = await response.json();
      
      // Debug: log full response body
      debugLog.responseBody(data, username);

      return this.parseResponse(data, username);
    } catch (error: any) {
      if (error.name === 'AbortError') {
        debugLog.error('Request timeout', error);
      } else {
        debugLog.error('Network error', error);
      }
      
      this.consecutiveFailures++;
      return null;
    }
  }

  /**
   * Fetch user info with Simple API (backward compatibility)
   */
  static async lookup(
    username: string,
    authToken: string,
    csrfToken: string
  ): Promise<LocationEntry | null> {
    const session: Session = {
      authToken,
      csrfToken,
      isAuthenticated: true,
    };
    return this.fetchUserInfo(username, session);
  }

  /**
   * Batch lookup multiple users
   * Note: X API doesn't support batch, so we query sequentially with rate limiting
   * @param usernames - Array of usernames
   * @param session - Authentication session
   * @param onProgress - Optional progress callback
   * @returns Map of username to LocationEntry
   */
  static async lookupBatch(
    usernames: string[],
    session: Session,
    onProgress?: (completed: number, total: number, current: string) => void
  ): Promise<Map<string, LocationEntry>> {
    const results = new Map<string, LocationEntry>();
    
    if (!usernames || usernames.length === 0) {
      return results;
    }

    // Validate session
    if (!session || !session.authToken || !session.csrfToken) {
      return results;
    }

    for (let i = 0; i < usernames.length; i++) {
      const username = usernames[i];
      
      // Report progress
      if (onProgress) {
        onProgress(i, usernames.length, username);
      }

      // Check rate limit before each request
      if (this.isRateLimited()) {
        break;
      }

      const result = await this.fetchUserInfo(username, session);
      
      if (result) {
        results.set(username.toLowerCase(), result);
      }

      // Add delay between requests to avoid rate limiting
      if (i < usernames.length - 1) {
        await new Promise<void>(resolve => setTimeout(resolve, API_CONFIG.MIN_INTERVAL_MS * 2));
      }
    }

    return results;
  }

  /**
   * Batch lookup with detailed results
   */
  static async lookupBatchWithDetails(
    usernames: string[],
    session: Session,
    onProgress?: (completed: number, total: number, current: string) => void
  ): Promise<BatchLookupResult[]> {
    const resultsMap = await this.lookupBatch(usernames, session, onProgress);
    
    return usernames.map(username => {
      const data = resultsMap.get(username.toLowerCase()) || null;
      return {
        username,
        data,
        error: data ? undefined : 'Not found or failed',
      };
    });
  }

  /**
   * Get rate limit status
   */
  static getRateLimitStatus(): { isRateLimited: boolean; resetTime: number | null; remainingMs: number | null } {
    const now = Date.now();
    const isRateLimited = this.rateLimitReset > now;
    
    return {
      isRateLimited,
      resetTime: isRateLimited ? this.rateLimitReset : null,
      remainingMs: isRateLimited ? this.rateLimitReset - now : null,
    };
  }

  /**
   * Clear rate limit (useful for testing)
   */
  static clearRateLimit(): void {
    this.rateLimitReset = 0;
    this.consecutiveFailures = 0;
  }
}

export default XGraphQLAPI;
