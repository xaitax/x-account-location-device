/**
 * X-Posed Mobile App - Mode Toggle Component
 * Beautiful segmented control for Cache vs Live mode
 */

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors } from '@/styles/commonStyles';
import { IconSymbol } from '@/components/IconSymbol';
import { LookupMode } from '../types';

interface ModeToggleProps {
  mode: LookupMode;
  onModeChange: (mode: LookupMode) => void;
  disabled?: boolean;
}

export function ModeToggle({ mode, onModeChange, disabled = false }: ModeToggleProps) {
  const modes: { key: LookupMode; label: string; icon: string; emoji: string; description: string }[] = [
    {
      key: 'cache',
      label: 'Cache',
      icon: 'cloud',
      emoji: '☁️',
      description: 'Fast, anonymous lookups',
    },
    {
      key: 'live',
      label: 'Live',
      icon: 'bolt.fill',
      emoji: '⚡',
      description: 'Real-time data, login required',
    },
  ];

  return (
    <View style={[styles.container, disabled && styles.disabled]}>
      <View style={styles.toggleContainer}>
        {modes.map((m) => {
          const isActive = mode === m.key;
          return (
            <TouchableOpacity
              key={m.key}
              style={[styles.toggleButton, isActive && styles.toggleButtonActive]}
              onPress={() => !disabled && onModeChange(m.key)}
              activeOpacity={0.7}
              disabled={disabled}
            >
              {isActive && (
                <LinearGradient
                  colors={[colors.primary, colors.primaryDark]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.activeBackground}
                />
              )}
              <View style={styles.buttonContent}>
                <Text style={styles.emoji}>{m.emoji}</Text>
                <Text style={[styles.label, isActive && styles.labelActive]}>
                  {m.label}
                </Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>
      
      {/* Mode Description */}
      <Text style={styles.description}>
        {modes.find(m => m.key === mode)?.description}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 16,
  },
  disabled: {
    opacity: 0.5,
  },
  toggleContainer: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 16,
    padding: 4,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  toggleButton: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    position: 'relative',
    overflow: 'hidden',
  },
  toggleButtonActive: {
    backgroundColor: 'transparent',
  },
  activeBackground: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 12,
  },
  buttonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  emoji: {
    fontSize: 18,
  },
  label: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  labelActive: {
    color: colors.text,
  },
  description: {
    fontSize: 12,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: 8,
  },
});

export default ModeToggle;
