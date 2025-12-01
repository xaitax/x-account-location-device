/**
 * X-Posed Mobile App - History Hook
 * Manages lookup history with AsyncStorage persistence
 * Also syncs to iOS Home Screen Widget
 */

import { useState, useEffect, useCallback } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { HistoryEntry, LocationEntry, LookupMode } from '../types';
import { widgetService } from '../services/WidgetService';

// Storage key
const HISTORY_STORAGE_KEY = 'x_posed_lookup_history';

// Maximum history entries (increased for batch scans)
const MAX_HISTORY_ENTRIES = 2000;

// Sync to widget on iOS
const syncToWidget = async (entries: HistoryEntry[]) => {
  if (Platform.OS !== 'ios') return;
  
  try {
    // Convert history entries to widget format and sync
    const widgetEntries = entries.slice(0, 10).map(entry => ({
      username: entry.username,
      data: entry.data,
    }));
    
    await widgetService.syncEntries(widgetEntries);
  } catch (error) {
    // Silently fail widget sync - it's not critical
  }
};

interface UseHistoryReturn {
  history: HistoryEntry[];
  loading: boolean;
  addToHistory: (username: string, data: LocationEntry, mode: LookupMode) => Promise<void>;
  clearHistory: () => Promise<void>;
  removeFromHistory: (username: string) => Promise<void>;
  getRecentUsernames: (limit?: number) => string[];
}

/**
 * History Hook
 */
export function useHistory(): UseHistoryReturn {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  /**
   * Load history from storage on mount
   */
  useEffect(() => {
    loadHistory();
  }, []);

  /**
   * Load history from AsyncStorage
   */
  const loadHistory = useCallback(async () => {
    try {
      setLoading(true);

      const stored = await AsyncStorage.getItem(HISTORY_STORAGE_KEY);
      
      if (stored) {
        const parsed: HistoryEntry[] = JSON.parse(stored);
        // Sort by most recent first
        parsed.sort((a, b) => b.lookupTime - a.lookupTime);
        setHistory(parsed);
      }
    } catch (error) {
      // Silent fail
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Save history to AsyncStorage
   */
  const saveHistory = useCallback(async (entries: HistoryEntry[]) => {
    try {
      await AsyncStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(entries));
    } catch (error) {
      throw error;
    }
  }, []);

  /**
   * Add entry to history
   */
  const addToHistory = useCallback(async (
    username: string,
    data: LocationEntry,
    mode: LookupMode
  ) => {
    try {
      const entry: HistoryEntry = {
        username: username.toLowerCase(),
        data,
        lookupTime: Date.now(),
        mode,
      };

      // Update history (remove duplicates, add new entry at start)
      setHistory(prev => {
        // Filter out existing entry for this username
        const filtered = prev.filter(
          e => e.username.toLowerCase() !== username.toLowerCase()
        );
        
        // Add new entry at the beginning
        const updated = [entry, ...filtered];
        
        // Limit to max entries
        const limited = updated.slice(0, MAX_HISTORY_ENTRIES);
        
        // Save to storage (async, don't await)
        saveHistory(limited);
        
        // Sync to iOS widget
        syncToWidget(limited);
        
        return limited;
      });
    } catch (error) {
      // Silent fail
    }
  }, [saveHistory]);

  /**
   * Clear all history
   */
  const clearHistory = useCallback(async () => {
    try {
      await AsyncStorage.removeItem(HISTORY_STORAGE_KEY);
      setHistory([]);
      
      // Clear widget as well
      if (Platform.OS === 'ios') {
        widgetService.clear();
      }
    } catch (error) {
      throw error;
    }
  }, []);

  /**
   * Remove specific entry from history
   */
  const removeFromHistory = useCallback(async (username: string) => {
    try {
      setHistory(prev => {
        const filtered = prev.filter(
          e => e.username.toLowerCase() !== username.toLowerCase()
        );
        
        // Save to storage
        saveHistory(filtered);
        
        return filtered;
      });
    } catch (error) {
      throw error;
    }
  }, [saveHistory]);

  /**
   * Get recent usernames for suggestions
   */
  const getRecentUsernames = useCallback((limit: number = 10): string[] => {
    return history
      .slice(0, limit)
      .map(entry => entry.username);
  }, [history]);

  return {
    history,
    loading,
    addToHistory,
    clearHistory,
    removeFromHistory,
    getRecentUsernames,
  };
}

export default useHistory;