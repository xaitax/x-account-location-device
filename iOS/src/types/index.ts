/**
 * X-Posed Mobile App Types
 * Based on the browser extension architecture
 */

// Location data entry from API
export interface LocationEntry {
  location: string;
  device: string;
  isAccurate: boolean;
  timestamp: number;
  fromCloud?: boolean;
  username?: string;
  profileImageUrl?: string;  // User's profile image URL
}

// Alias for backward compatibility
export type LocationData = LocationEntry;

// Session management
export interface Session {
  authToken: string;
  csrfToken: string;
  isAuthenticated: boolean;
  username?: string;  // Captured during login
}

// Lookup mode types
export type LookupMode = 'cache' | 'live';

// Alias for backward compatibility
export type Mode = LookupMode;

// API Response from Cloud Cache
export interface CloudCacheResponse {
  results: {
    [username: string]: {
      l: string;  // location
      d: string;  // device
      a: boolean; // isAccurate
      t: number;  // timestamp (seconds)
    };
  };
  misses?: string[];
}

// GraphQL API Response
export interface GraphQLResponse {
  data?: {
    user_result_by_screen_name?: {
      result?: {
        about_profile?: {
          account_based_in?: string;
          source?: string;
          location_accurate?: boolean;
        };
      };
    };
  };
}

// History entry for recent lookups
export interface HistoryEntry {
  username: string;
  data: LocationEntry;
  lookupTime: number;
  mode: LookupMode;
}

// Batch lookup result
export interface BatchLookupResult {
  username: string;
  data: LocationEntry | null;
  error?: string;
}

// API Error
export interface APIError {
  code: 'RATE_LIMITED' | 'UNAUTHORIZED' | 'NOT_FOUND' | 'NETWORK_ERROR' | 'PARSE_ERROR' | 'UNKNOWN';
  message: string;
  statusCode?: number;
  retryAfter?: number;
}

// Device type for emoji mapping
export type DeviceType = 'ios' | 'android' | 'web' | 'unknown';

// Statistics
export interface UserStats {
  totalLookups: number;
  cacheLookups: number;
  liveLookups: number;
  uniqueUsers: number;
}
