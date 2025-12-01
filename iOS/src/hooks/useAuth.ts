/**
 * X-Posed Mobile App - Authentication Hook
 * Manages X authentication state with AsyncStorage persistence
 */

import { useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Session } from '../types';

// Storage keys
const STORAGE_KEYS = {
  AUTH_TOKEN: 'x_posed_auth_token',
  CSRF_TOKEN: 'x_posed_csrf_token',
  SESSION_TIME: 'x_posed_session_time',
  USERNAME: 'x_posed_username',
};

// Session timeout (7 days)
const SESSION_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1000;

interface UseAuthReturn {
  authToken: string;
  csrfToken: string;
  username: string | null;
  isAuthenticated: boolean;
  loading: boolean;
  session: Session;
  login: (authToken: string, csrfToken: string, username?: string) => Promise<void>;
  logout: () => Promise<void>;
  saveSession: (authToken: string, csrfToken: string, username?: string) => Promise<void>;
  clearSession: () => Promise<void>;
  checkSession: () => Promise<boolean>;
  setUsername: (username: string) => Promise<void>;
}

/**
 * Authentication Hook
 */
export function useAuth(): UseAuthReturn {
  const [authToken, setAuthToken] = useState<string>('');
  const [csrfToken, setCsrfToken] = useState<string>('');
  const [username, setUsername] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);

  // Session object (for convenience)
  const session: Session = {
    authToken,
    csrfToken,
    isAuthenticated,
    username: username || undefined,
  };

  /**
   * Load session from storage on mount
   */
  useEffect(() => {
    loadSession();
  }, []);

  /**
   * Load session from AsyncStorage
   */
  const loadSession = useCallback(async () => {
    try {
      setLoading(true);

      const [storedAuthToken, storedCsrfToken, storedSessionTime, storedUsername] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEYS.AUTH_TOKEN),
        AsyncStorage.getItem(STORAGE_KEYS.CSRF_TOKEN),
        AsyncStorage.getItem(STORAGE_KEYS.SESSION_TIME),
        AsyncStorage.getItem(STORAGE_KEYS.USERNAME),
      ]);

      if (storedAuthToken && storedCsrfToken) {
        // Check if session has expired
        const sessionTime = storedSessionTime ? parseInt(storedSessionTime, 10) : 0;
        const now = Date.now();
        
        if (sessionTime > 0 && now - sessionTime > SESSION_TIMEOUT_MS) {
          await clearSession();
          return;
        }

        setAuthToken(storedAuthToken);
        setCsrfToken(storedCsrfToken);
        setUsername(storedUsername);
        setIsAuthenticated(true);
      }
    } catch (error) {
      // Silent fail
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Save session to AsyncStorage
   */
  const saveSession = useCallback(async (newAuthToken: string, newCsrfToken: string, newUsername?: string) => {
    try {
      // Validate tokens
      if (!newAuthToken || !newCsrfToken) {
        throw new Error('Invalid tokens');
      }

      const savePromises = [
        AsyncStorage.setItem(STORAGE_KEYS.AUTH_TOKEN, newAuthToken),
        AsyncStorage.setItem(STORAGE_KEYS.CSRF_TOKEN, newCsrfToken),
        AsyncStorage.setItem(STORAGE_KEYS.SESSION_TIME, Date.now().toString()),
      ];
      
      // Only save username if provided
      if (newUsername) {
        savePromises.push(AsyncStorage.setItem(STORAGE_KEYS.USERNAME, newUsername));
      }
      
      await Promise.all(savePromises);

      setAuthToken(newAuthToken);
      setCsrfToken(newCsrfToken);
      setUsername(newUsername || null);
      setIsAuthenticated(true);
    } catch (error) {
      throw error;
    }
  }, []);

  /**
   * Clear session from AsyncStorage
   */
  const clearSession = useCallback(async () => {
    try {
      await Promise.all([
        AsyncStorage.removeItem(STORAGE_KEYS.AUTH_TOKEN),
        AsyncStorage.removeItem(STORAGE_KEYS.CSRF_TOKEN),
        AsyncStorage.removeItem(STORAGE_KEYS.SESSION_TIME),
        AsyncStorage.removeItem(STORAGE_KEYS.USERNAME),
      ]);

      setAuthToken('');
      setCsrfToken('');
      setUsername(null);
      setIsAuthenticated(false);
    } catch (error) {
      throw error;
    }
  }, []);

  /**
   * Check if session is still valid
   */
  const checkSession = useCallback(async (): Promise<boolean> => {
    try {
      const storedSessionTime = await AsyncStorage.getItem(STORAGE_KEYS.SESSION_TIME);
      
      if (!storedSessionTime) {
        return false;
      }

      const sessionTime = parseInt(storedSessionTime, 10);
      const now = Date.now();
      
      if (now - sessionTime > SESSION_TIMEOUT_MS) {
        await clearSession();
        return false;
      }

      return isAuthenticated;
    } catch (error) {
      return false;
    }
  }, [isAuthenticated, clearSession]);

  /**
   * Alias for saveSession (login)
   */
  const login = useCallback(async (newAuthToken: string, newCsrfToken: string, newUsername?: string) => {
    return saveSession(newAuthToken, newCsrfToken, newUsername);
  }, [saveSession]);

  /**
   * Alias for clearSession (logout)
   */
  const logout = useCallback(async () => {
    return clearSession();
  }, [clearSession]);

  /**
   * Set username manually (fallback when auto-capture fails)
   */
  const setUsernameManually = useCallback(async (newUsername: string) => {
    try {
      const cleanUsername = newUsername.trim().replace(/^@/, '').toLowerCase();
      if (!cleanUsername || cleanUsername.length > 15) {
        throw new Error('Invalid username');
      }

      await AsyncStorage.setItem(STORAGE_KEYS.USERNAME, cleanUsername);
      setUsername(cleanUsername);
    } catch (error) {
      throw error;
    }
  }, []);

  return {
    authToken,
    csrfToken,
    username,
    isAuthenticated,
    loading,
    session,
    login,
    logout,
    saveSession,
    clearSession,
    checkSession,
    setUsername: setUsernameManually,
  };
}

export default useAuth;
