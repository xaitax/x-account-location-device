/**
 * X-Posed Mobile App - Widget Service
 * Manages data sharing between the app and iOS Home Screen Widget
 */

import { Platform, NativeModules } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LocationEntry } from '../types';

// App Group identifier - must match the widget's entitlements
const APP_GROUP = 'group.com.xposed.mobile.shared';
const WIDGET_DATA_KEY = 'widgetData';
const MAX_WIDGET_ENTRIES = 10;

interface WidgetEntry {
  username: string;
  location: string;
  device: string | null;
  timestamp: number;
  isAccurate: boolean;
}

interface WidgetData {
  entries: WidgetEntry[];
  lastUpdated: number;
}

/**
 * Widget Service for iOS Home Screen Widget
 * Syncs lookup history to the widget via App Groups (SharedUserDefaults)
 */
export class WidgetService {
  private static instance: WidgetService;
  private isNativeModuleAvailable: boolean = false;

  private constructor() {
    // Check if running on iOS with native modules (not Expo Go)
    this.isNativeModuleAvailable = 
      Platform.OS === 'ios' && 
      !!NativeModules.SharedUserDefaults;
  }

  static getInstance(): WidgetService {
    if (!WidgetService.instance) {
      WidgetService.instance = new WidgetService();
    }
    return WidgetService.instance;
  }

  /**
   * Check if widget sync is available
   * (Only works on native builds, not Expo Go)
   */
  isAvailable(): boolean {
    return this.isNativeModuleAvailable;
  }

  /**
   * Update widget with new lookup entry
   */
  async addEntry(username: string, data: LocationEntry): Promise<void> {
    try {
      // Get existing data
      const currentData = await this.getData();
      
      // Create new entry
      const newEntry: WidgetEntry = {
        username: username.toLowerCase(),
        location: data.location || 'Unknown',
        device: data.device || null,
        timestamp: data.timestamp || Date.now(),
        isAccurate: data.isAccurate !== false,
      };

      // Remove duplicate if exists
      const filteredEntries = currentData.entries.filter(
        e => e.username !== newEntry.username
      );

      // Add new entry at the beginning
      const updatedEntries = [newEntry, ...filteredEntries].slice(0, MAX_WIDGET_ENTRIES);

      // Save updated data
      const updatedData: WidgetData = {
        entries: updatedEntries,
        lastUpdated: Date.now(),
      };

      await this.setData(updatedData);
      await this.reloadWidget();
    } catch (error) {
      console.warn('WidgetService: Failed to add entry', error);
    }
  }

  /**
   * Sync multiple entries (e.g., from batch scan)
   */
  async syncEntries(entries: Array<{ username: string; data: LocationEntry }>): Promise<void> {
    try {
      const currentData = await this.getData();
      
      // Create new entries
      const newEntries: WidgetEntry[] = entries.map(({ username, data }) => ({
        username: username.toLowerCase(),
        location: data.location || 'Unknown',
        device: data.device || null,
        timestamp: data.timestamp || Date.now(),
        isAccurate: data.isAccurate !== false,
      }));

      // Merge with existing (new entries take precedence)
      const usernameSet = new Set(newEntries.map(e => e.username));
      const existingFiltered = currentData.entries.filter(e => !usernameSet.has(e.username));
      
      // Sort by timestamp (newest first) and limit
      const allEntries = [...newEntries, ...existingFiltered]
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, MAX_WIDGET_ENTRIES);

      const updatedData: WidgetData = {
        entries: allEntries,
        lastUpdated: Date.now(),
      };

      await this.setData(updatedData);
      await this.reloadWidget();
    } catch (error) {
      console.warn('WidgetService: Failed to sync entries', error);
    }
  }

  /**
   * Clear widget data
   */
  async clear(): Promise<void> {
    try {
      const emptyData: WidgetData = {
        entries: [],
        lastUpdated: Date.now(),
      };
      await this.setData(emptyData);
      await this.reloadWidget();
    } catch (error) {
      console.warn('WidgetService: Failed to clear data', error);
    }
  }

  /**
   * Get current widget data
   */
  private async getData(): Promise<WidgetData> {
    try {
      if (this.isNativeModuleAvailable) {
        // Use native SharedUserDefaults
        const jsonString = await NativeModules.SharedUserDefaults.get(WIDGET_DATA_KEY, APP_GROUP);
        if (jsonString) {
          return JSON.parse(jsonString);
        }
      } else {
        // Fallback to AsyncStorage (for development/Expo Go)
        const jsonString = await AsyncStorage.getItem(`widget:${WIDGET_DATA_KEY}`);
        if (jsonString) {
          return JSON.parse(jsonString);
        }
      }
    } catch (error) {
      console.warn('WidgetService: Failed to get data', error);
    }

    return { entries: [], lastUpdated: Date.now() };
  }

  /**
   * Set widget data
   */
  private async setData(data: WidgetData): Promise<void> {
    const jsonString = JSON.stringify(data);

    if (this.isNativeModuleAvailable) {
      // Use native SharedUserDefaults
      await NativeModules.SharedUserDefaults.set(WIDGET_DATA_KEY, jsonString, APP_GROUP);
    } else {
      // Fallback to AsyncStorage (for development/Expo Go)
      await AsyncStorage.setItem(`widget:${WIDGET_DATA_KEY}`, jsonString);
    }
  }

  /**
   * Request widget to reload its timeline
   */
  private async reloadWidget(): Promise<void> {
    if (this.isNativeModuleAvailable && NativeModules.WidgetCenter) {
      try {
        await NativeModules.WidgetCenter.reloadAllTimelines();
      } catch (error) {
        // Widget reload might fail if widget isn't added yet
      }
    }
  }
}

// Export singleton instance
export const widgetService = WidgetService.getInstance();
export default widgetService;