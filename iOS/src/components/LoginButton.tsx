/**
 * X-Posed Mobile App - Login Button Component
 * Stylish button for initiating X authentication
 */

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, glassShadow } from '@/styles/commonStyles';
import { IconSymbol } from '@/components/IconSymbol';

interface LoginButtonProps {
  onPress: () => void;
  isLoading?: boolean;
  disabled?: boolean;
  isLoggedIn?: boolean;
  onLogout?: () => void;
}

export function LoginButton({
  onPress,
  isLoading = false,
  disabled = false,
  isLoggedIn = false,
  onLogout,
}: LoginButtonProps) {
  if (isLoggedIn) {
    return (
      <View style={styles.loggedInContainer}>
        <View style={styles.statusContainer}>
          <View style={styles.checkmark}>
            <IconSymbol
              ios_icon_name="checkmark.circle.fill"
              android_material_icon_name="check-circle"
              size={20}
              color={colors.secondary}
            />
          </View>
          <Text style={styles.loggedInText}>Logged in to X</Text>
        </View>
        
        {onLogout && (
          <TouchableOpacity style={styles.logoutButton} onPress={onLogout}>
            <Text style={styles.logoutText}>Logout</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  return (
    <TouchableOpacity
      style={[styles.container, disabled && styles.disabled]}
      onPress={onPress}
      disabled={disabled || isLoading}
      activeOpacity={0.8}
    >
      <LinearGradient
        colors={['rgba(0, 212, 255, 0.9)', 'rgba(0, 180, 220, 0.95)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.gradient}
      >
        {isLoading ? (
          <ActivityIndicator color={colors.text} size="small" />
        ) : (
          <>
            <View style={styles.xLogo}>
              <Text style={styles.xLogoText}>𝕏</Text>
            </View>
            <Text style={styles.buttonText}>Log in to X</Text>
          </>
        )}
      </LinearGradient>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 16,
    overflow: 'hidden',
    ...glassShadow,
  },
  disabled: {
    opacity: 0.5,
  },
  gradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 16,
    gap: 10,
  },
  xLogo: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.text,
    alignItems: 'center',
    justifyContent: 'center',
  },
  xLogoText: {
    fontSize: 14,
    fontWeight: '900',
    color: colors.background,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  loggedInContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(0, 255, 179, 0.3)',
  },
  statusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  checkmark: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0, 255, 179, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loggedInText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.secondary,
  },
  logoutButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 107, 53, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(255, 107, 53, 0.3)',
  },
  logoutText: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.accent,
  },
});

export default LoginButton;
