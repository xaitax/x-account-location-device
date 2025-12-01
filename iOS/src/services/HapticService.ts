/**
 * Haptic Feedback Service
 *
 * Provides subtle tactile feedback for various UI interactions
 * using expo-haptics for cross-platform haptic support.
 *
 * Uses direct calls to Haptics functions (fire-and-forget) for immediate response.
 */

import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

// Check if we're on a supported platform
const isSupported = Platform.OS === 'ios' || Platform.OS === 'android';

/**
 * Different haptic feedback types for various interactions
 * These functions call haptics immediately (fire-and-forget)
 */
export const HapticFeedback = {
  /**
   * Light impact - for button presses, toggles, selections
   */
  light: (): void => {
    if (isSupported) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  },

  /**
   * Medium impact - for significant actions like confirming
   */
  medium: (): void => {
    if (isSupported) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
  },

  /**
   * Heavy impact - for major actions like deleting, search
   */
  heavy: (): void => {
    if (isSupported) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    }
  },

  /**
   * Success notification - for successful lookups, completions
   */
  success: (): void => {
    if (isSupported) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  },

  /**
   * Warning notification - for rate limits, warnings
   */
  warning: (): void => {
    if (isSupported) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    }
  },

  /**
   * Error notification - for errors, failures
   */
  error: (): void => {
    if (isSupported) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  },

  /**
   * Selection changed - for list selections, tab changes
   */
  selection: (): void => {
    if (isSupported) {
      Haptics.selectionAsync();
    }
  },

  /**
   * Soft feedback - using soft impact
   * Use for subtle UI feedback
   */
  soft: (): void => {
    if (isSupported) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft);
    }
  },

  /**
   * Rigid feedback - using rigid impact
   * Use for more pronounced feedback
   */
  rigid: (): void => {
    if (isSupported) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid);
    }
  },
};

/**
 * Common haptic patterns for specific app actions
 * All functions fire immediately (synchronous call, async execution)
 */
export const AppHaptics = {
  /**
   * Generic success feedback
   */
  success: (): void => {
    HapticFeedback.success();
  },

  /**
   * Generic warning feedback
   */
  warning: (): void => {
    HapticFeedback.warning();
  },

  /**
   * Generic error feedback
   */
  error: (): void => {
    HapticFeedback.error();
  },

  /**
   * Lookup successful - data found (strong feedback)
   */
  lookupSuccess: (): void => {
    HapticFeedback.success();
  },

  /**
   * Lookup failed or no data found
   */
  lookupFailed: (): void => {
    HapticFeedback.error();
  },

  /**
   * Rate limited by API
   */
  rateLimited: (): void => {
    HapticFeedback.warning();
  },

  /**
   * Batch scan completed
   */
  batchComplete: (): void => {
    HapticFeedback.success();
  },

  /**
   * User tapped a button (noticeable feedback)
   */
  buttonPress: (): void => {
    HapticFeedback.medium();
  },

  /**
   * User selected an item from a list
   */
  itemSelected: (): void => {
    HapticFeedback.selection();
  },

  /**
   * Tab or mode changed
   */
  tabChanged: (): void => {
    HapticFeedback.selection();
  },

  /**
   * Login successful
   */
  loginSuccess: (): void => {
    HapticFeedback.success();
  },

  /**
   * Logout performed
   */
  logout: (): void => {
    HapticFeedback.medium();
  },

  /**
   * Share action initiated
   */
  share: (): void => {
    HapticFeedback.medium();
  },

  /**
   * Copy to clipboard
   */
  copy: (): void => {
    HapticFeedback.medium();
  },

  /**
   * History cleared
   */
  historyClear: (): void => {
    HapticFeedback.heavy();
  },

  /**
   * Settings toggle changed
   */
  toggleChange: (): void => {
    HapticFeedback.light();
  },

  /**
   * Pull to refresh triggered
   */
  refresh: (): void => {
    HapticFeedback.soft();
  },

  /**
   * Modal opened
   */
  modalOpen: (): void => {
    HapticFeedback.soft();
  },

  /**
   * Modal closed
   */
  modalClose: (): void => {
    HapticFeedback.soft();
  },
  
  /**
   * Search button pressed (heavy feedback for main action)
   */
  searchPress: (): void => {
    HapticFeedback.heavy();
  },
};

export default AppHaptics;