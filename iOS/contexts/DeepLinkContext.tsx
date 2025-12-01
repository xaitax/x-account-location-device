/**
 * X-Posed Mobile App - Deep Link Context
 * Handles incoming deep links and URL schemes
 * Supports:
 * - xposed://lookup, xposed://lookup/{username}
 * - Share Extension via SharedUserDefaults
 */

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import * as Linking from 'expo-linking';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, AppStateStatus } from 'react-native';

// Key used by Share Extension to store pending username
const SHARED_PENDING_USERNAME_KEY = '@xposed/shared_pending_username';

interface DeepLinkContextType {
  pendingUsername: string | null;
  clearPendingUsername: () => void;
  setPendingUsername: (username: string | null) => void;
}

const DeepLinkContext = createContext<DeepLinkContextType>({
  pendingUsername: null,
  clearPendingUsername: () => {},
  setPendingUsername: () => {},
});

/**
 * Parse a deep link URL to extract username
 * Handles:
 * - xposed://lookup (just opens app)
 * - xposed://lookup/username (opens app with pending lookup)
 */
function parseDeepLinkUrl(url: string): string | null {
  try {
    const parsed = Linking.parse(url);
    
    // Handle xposed://lookup/username format
    if (parsed.path?.startsWith('lookup')) {
      // Extract username from path after "lookup/"
      const pathParts = parsed.path.split('/');
      if (pathParts.length >= 2 && pathParts[1]) {
        const username = pathParts[1].replace(/^@/, '').toLowerCase();
        // Validate username format
        if (/^[a-zA-Z0-9_]{1,15}$/.test(username)) {
          return username;
        }
      }
    }
    
    // Also check query params (xposed://lookup?username=xyz)
    if (parsed.queryParams?.username) {
      const username = String(parsed.queryParams.username).replace(/^@/, '').toLowerCase();
      if (/^[a-zA-Z0-9_]{1,15}$/.test(username)) {
        return username;
      }
    }
    
    return null;
  } catch {
    return null;
  }
}

export function DeepLinkProvider({ children }: { children: React.ReactNode }) {
  const [pendingUsername, setPendingUsernameState] = useState<string | null>(null);

  const clearPendingUsername = useCallback(() => {
    setPendingUsernameState(null);
  }, []);

  const setPendingUsername = useCallback((username: string | null) => {
    setPendingUsernameState(username);
  }, []);

  // Handle incoming deep links
  useEffect(() => {
    // Check initial URL (app opened via deep link)
    const checkInitialUrl = async () => {
      const initialUrl = await Linking.getInitialURL();
      if (initialUrl) {
        const username = parseDeepLinkUrl(initialUrl);
        if (username) {
          setPendingUsernameState(username);
        }
      }
    };
    
    checkInitialUrl();
    
    // Listen for deep links while app is running
    const subscription = Linking.addEventListener('url', (event) => {
      const username = parseDeepLinkUrl(event.url);
      if (username) {
        setPendingUsernameState(username);
      }
    });
    
    return () => {
      subscription.remove();
    };
  }, []);

  // Also check for pending username from global (fallback)
  useEffect(() => {
    const checkPending = () => {
      const globalPending = (global as { pendingLookupUsername?: string }).pendingLookupUsername;
      if (globalPending) {
        setPendingUsernameState(globalPending);
        delete (global as { pendingLookupUsername?: string }).pendingLookupUsername;
      }
    };
    
    checkPending();
    
    // Check periodically in case deep link comes after mount
    const interval = setInterval(checkPending, 500);
    return () => clearInterval(interval);
  }, []);

  // Check for pending username from Share Extension when app becomes active
  const appState = useRef(AppState.currentState);
  
  useEffect(() => {
    const checkShareExtensionPending = async () => {
      try {
        // Check AsyncStorage for pending username (synced from Share Extension)
        const pending = await AsyncStorage.getItem(SHARED_PENDING_USERNAME_KEY);
        if (pending) {
          // Clear it immediately to prevent double-processing
          await AsyncStorage.removeItem(SHARED_PENDING_USERNAME_KEY);
          // Validate username format
          if (/^[a-zA-Z0-9_]{1,15}$/.test(pending)) {
            setPendingUsernameState(pending.toLowerCase());
          }
        }
      } catch {
        // Ignore errors
      }
    };
    
    // Check on mount
    checkShareExtensionPending();
    
    // Also check when app comes to foreground (after Share Extension runs)
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      if (appState.current.match(/inactive|background/) && nextAppState === 'active') {
        // App has come to the foreground - check for share extension data
        checkShareExtensionPending();
      }
      appState.current = nextAppState;
    };
    
    const subscription = AppState.addEventListener('change', handleAppStateChange);
    
    return () => {
      subscription.remove();
    };
  }, []);

  return (
    <DeepLinkContext.Provider
      value={{
        pendingUsername,
        clearPendingUsername,
        setPendingUsername,
      }}
    >
      {children}
    </DeepLinkContext.Provider>
  );
}

export function useDeepLink() {
  return useContext(DeepLinkContext);
}

export default DeepLinkContext;