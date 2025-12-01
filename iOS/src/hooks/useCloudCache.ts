/**
 * X-Posed Mobile App - Cloud Cache Hook
 * Manage cloud contribution settings
 */

import { useState, useEffect, useCallback } from 'react';
import cloudCache from '../services/CloudCache';

interface CloudStats {
  contributions: number;
  lookups: number;
  hits: number;
  misses?: number;
  errors?: number;
  lastContribution?: number;
}

interface ServerStats {
  totalEntries: number;
  totalContributions: number;
  lastUpdated?: string;
}

export function useCloudCache() {
  const [isEnabled, setIsEnabled] = useState(false);
  const [stats, setStats] = useState<CloudStats>({
    contributions: 0,
    lookups: 0,
    hits: 0,
  });
  const [serverStats, setServerStats] = useState<ServerStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingServerStats, setLoadingServerStats] = useState(false);

  // Load initial state
  useEffect(() => {
    const loadState = async () => {
      await cloudCache.loadSettings();
      setIsEnabled(cloudCache.isEnabled());
      setStats(cloudCache.getStats());
      setLoading(false);
    };

    loadState();
  }, []);

  // Toggle enabled state
  const toggleEnabled = useCallback(async () => {
    const newState = !isEnabled;
    await cloudCache.setEnabled(newState);
    setIsEnabled(newState);
  }, [isEnabled]);

  // Set enabled state directly
  const setEnabled = useCallback(async (enabled: boolean) => {
    await cloudCache.setEnabled(enabled);
    setIsEnabled(enabled);
  }, []);

  // Refresh stats - also saves any pending changes
  const refreshStats = useCallback(async () => {
    await cloudCache.loadSettings(); // Make sure we have latest from storage
    const currentStats = cloudCache.getStats();
    setStats(currentStats);
    return currentStats;
  }, []);

  // Update local stats from cloud service (call this after lookups)
  const syncStats = useCallback(() => {
    const currentStats = cloudCache.getStats();
    setStats(currentStats);
  }, []);

  // Fetch server stats
  const fetchServerStats = useCallback(async () => {
    setLoadingServerStats(true);
    try {
      const stats = await cloudCache.fetchServerStats();
      setServerStats(stats);
      return stats;
    } finally {
      setLoadingServerStats(false);
    }
  }, []);

  // Contribute entry to cloud
  const contributeEntry = useCallback(async (username: string, data: {
    location: string;
    device: string;
    isAccurate: boolean;
    timestamp: number;
  }) => {
    if (!isEnabled) return;
    
    try {
      await cloudCache.contribute(username, data);
      // Refresh stats after contribution
      setStats(cloudCache.getStats());
    } catch (e) {
      // Silent fail
    }
  }, [isEnabled]);

  return {
    isEnabled,
    stats,
    serverStats,
    loading,
    loadingServerStats,
    toggleEnabled,
    setEnabled,
    refreshStats,
    syncStats,
    fetchServerStats,
    contributeEntry,
  };
}

export default useCloudCache;