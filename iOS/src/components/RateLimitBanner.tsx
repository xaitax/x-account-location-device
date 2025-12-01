/**
 * X-Posed Mobile App - Rate Limit Banner
 * Floating toast at bottom of screen with countdown timer
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '@/styles/commonStyles';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface RateLimitBannerProps {
  isRateLimited: boolean;
  resetTime: number | null;
  onDismiss?: () => void;
}

/**
 * Format remaining time as human-readable string
 */
function formatRemainingTime(ms: number): string {
  if (ms <= 0) return '0s';
  
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  
  if (hours > 0) {
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
  }
  
  if (minutes > 0) {
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  }
  
  return `${seconds}s`;
}

export function RateLimitBanner({ isRateLimited, resetTime, onDismiss }: RateLimitBannerProps) {
  const insets = useSafeAreaInsets();
  const [remainingMs, setRemainingMs] = useState<number>(0);
  const [visible, setVisible] = useState(false);
  const slideAnim = useRef(new Animated.Value(100)).current; // Start off-screen

  // Update countdown timer
  useEffect(() => {
    if (isRateLimited && resetTime) {
      const updateRemaining = () => {
        const remaining = Math.max(0, resetTime - Date.now());
        setRemainingMs(remaining);
        
        // Auto-hide when reset time passes
        if (remaining <= 0) {
          setVisible(false);
        }
      };

      // Initial update
      updateRemaining();
      setVisible(true);

      // Update every second
      const interval = setInterval(updateRemaining, 1000);
      
      return () => clearInterval(interval);
    } else {
      setRemainingMs(0);
      setVisible(false);
    }
  }, [isRateLimited, resetTime]);

  // Animate slide in/out
  useEffect(() => {
    Animated.spring(slideAnim, {
      toValue: visible ? 0 : 100,
      friction: 8,
      tension: 50,
      useNativeDriver: true,
    }).start();
  }, [visible, slideAnim]);

  const handleDismiss = useCallback(() => {
    setVisible(false);
    onDismiss?.();
  }, [onDismiss]);

  if (!visible && !isRateLimited) {
    return null;
  }

  // Calculate progress (based on 15 minute window max)
  const maxDuration = 15 * 60 * 1000; // 15 minutes in ms
  const progressPercent = resetTime
    ? Math.min(100, (remainingMs / maxDuration) * 100)
    : 0;

  return (
    <Animated.View
      style={[
        styles.container,
        {
          bottom: insets.bottom + 16,
          transform: [{ translateY: slideAnim }],
        }
      ]}
      pointerEvents={visible ? 'auto' : 'none'}
    >
      <View style={styles.toast}>
        <Text style={styles.icon}>⏳</Text>
        
        <View style={styles.content}>
          <Text style={styles.message}>
            Rate limited • <Text style={styles.countdown}>{formatRemainingTime(remainingMs)}</Text>
          </Text>
        </View>
        
        {/* Progress indicator */}
        <View style={styles.progressRing}>
          <Text style={styles.progressText}>
            {Math.ceil(remainingMs / 60000)}m
          </Text>
        </View>
        
        <TouchableOpacity style={styles.dismissButton} onPress={handleDismiss}>
          <Text style={styles.dismissText}>✕</Text>
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 9999,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(20, 24, 30, 0.95)',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 152, 0, 0.4)',
    gap: 12,
    // Shadow
    shadowColor: '#FF9800',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  icon: {
    fontSize: 20,
  },
  content: {
    flex: 1,
  },
  message: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  countdown: {
    fontWeight: '700',
    color: '#FF9800',
  },
  progressRing: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 152, 0, 0.2)',
    borderWidth: 2,
    borderColor: '#FF9800',
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FF9800',
  },
  dismissButton: {
    padding: 4,
  },
  dismissText: {
    fontSize: 18,
    color: colors.textMuted,
  },
});

export default RateLimitBanner;