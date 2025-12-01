/**
 * X-Posed Mobile App - Stunning Theme & Styles
 * Sleek dark theme with cyan/teal accents
 */

import { StyleSheet, Platform } from 'react-native';

// Premium dark color palette - Cyber/Tech aesthetic
export const colors = {
  // Backgrounds - Deep dark
  background: '#0A0E14',
  backgroundAlt: '#0D1117',
  backgroundElevated: '#161B22',
  
  // Cards with glassmorphic effect - dark glass
  card: 'rgba(22, 27, 34, 0.8)',
  cardBorder: 'rgba(48, 54, 61, 0.8)',
  cardGlow: 'rgba(0, 212, 255, 0.15)',
  
  // Text - bright for contrast
  text: '#E6EDF3',
  textSecondary: '#8B949E',
  textMuted: '#484F58',
  
  // Primary - Vibrant Cyan
  primary: '#00D4FF',
  primaryDark: '#00A8CC',
  primaryLight: '#7DF9FF',
  primaryGlow: 'rgba(0, 212, 255, 0.4)',
  
  // Secondary - Electric Teal  
  secondary: '#00FFB3',
  secondaryDark: '#00CC8F',
  secondaryLight: '#7FFFD4',
  secondaryGlow: 'rgba(0, 255, 179, 0.4)',
  
  // Accent - Hot Orange/Red
  accent: '#FF6B35',
  accentDark: '#E55A2B',
  accentLight: '#FF8F66',
  accentGlow: 'rgba(255, 107, 53, 0.4)',
  
  // Highlight - Gold
  highlight: '#FFD93D',
  highlightDark: '#F5C800',
  highlightLight: '#FFE566',
  
  // Status colors
  success: '#00FFB3',
  warning: '#FFD93D',
  error: '#FF4757',
  info: '#00D4FF',
  
  // VPN/Proxy indicator - warning orange
  vpnColor: '#FF9F43',
  
  // Device colors
  deviceIOS: '#00D4FF',
  deviceAndroid: '#00FFB3',
  deviceWeb: '#58A6FF',
  
  // Gradients (for LinearGradient arrays)
  gradientPrimary: ['#00D4FF', '#0099CC'] as [string, string],
  gradientSecondary: ['#00FFB3', '#00CC8F'] as [string, string],
  gradientDark: ['#161B22', '#0D1117'] as [string, string],
  gradientCard: ['rgba(22, 27, 34, 0.95)', 'rgba(13, 17, 23, 0.95)'] as [string, string],
  gradientGlass: ['rgba(0, 212, 255, 0.1)', 'rgba(0, 255, 179, 0.05)'] as [string, string],
  gradientAccent: ['#FF6B35', '#E55A2B'] as [string, string],
  
  // Legacy support
  grey: '#8B949E',
};

// Glassmorphic shadow for iOS
export const glassShadow = Platform.select({
  ios: {
    shadowColor: '#00D4FF',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
  },
  android: {
    elevation: 8,
  },
  default: {
    shadowColor: '#00D4FF',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
  },
});

// Premium glow effect
export const glowShadow = (color: string) => Platform.select({
  ios: {
    shadowColor: color,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 12,
  },
  android: {
    elevation: 6,
  },
  default: {
    shadowColor: color,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 12,
  },
});

// Button styles
export const buttonStyles = StyleSheet.create({
  primary: {
    backgroundColor: colors.primary,
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    ...glassShadow,
  },
  secondary: {
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderColor: colors.primary,
    paddingVertical: 14,
    paddingHorizontal: 30,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glass: {
    backgroundColor: 'rgba(0, 212, 255, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(0, 212, 255, 0.3)',
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    // Note: backdropFilter is web-only, use expo-blur's BlurView for native blur effects
  },
  text: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  instructionsButton: {
    backgroundColor: colors.primary,
    alignSelf: 'center',
    width: '100%',
  },
  backButton: {
    backgroundColor: colors.backgroundAlt,
    alignSelf: 'center',
    width: '100%',
  },
});

// Common styles
export const commonStyles = StyleSheet.create({
  wrapper: {
    backgroundColor: colors.background,
    width: '100%',
    height: '100%',
  },
  container: {
    flex: 1,
    backgroundColor: colors.background,
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    maxWidth: 800,
    width: '100%',
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    textAlign: 'center',
    color: colors.text,
    marginBottom: 10,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 15,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 22,
  },
  text: {
    fontSize: 16,
    fontWeight: '500',
    color: colors.text,
    marginBottom: 8,
    lineHeight: 24,
    textAlign: 'center',
  },
  section: {
    width: '100%',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  buttonContainer: {
    width: '100%',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  card: {
    backgroundColor: colors.card,
    borderColor: colors.cardBorder,
    borderWidth: 1,
    borderRadius: 20,
    padding: 20,
    marginVertical: 8,
    width: '100%',
    ...glassShadow,
  },
  glassCard: {
    backgroundColor: 'rgba(22, 27, 34, 0.6)',
    borderColor: 'rgba(0, 212, 255, 0.2)',
    borderWidth: 1,
    borderRadius: 24,
    padding: 20,
    // Note: backdropFilter is web-only, use expo-blur's BlurView for native blur effects
    ...glassShadow,
  },
  icon: {
    width: 60,
    height: 60,
    tintColor: 'white',
  },
  divider: {
    height: 1,
    backgroundColor: colors.cardBorder,
    marginVertical: 16,
    width: '100%',
  },
  badge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: colors.primary,
    alignSelf: 'flex-start',
  },
  badgeText: {
    color: colors.background,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
});

// Input styles
export const inputStyles = StyleSheet.create({
  container: {
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
  },
  input: {
    flex: 1,
    color: colors.text,
    fontSize: 16,
    paddingVertical: 16,
    fontWeight: '500',
  },
  placeholder: {
    color: colors.textSecondary,
  },
  focused: {
    borderColor: colors.primary,
    backgroundColor: 'rgba(0, 212, 255, 0.05)',
  },
});

// Animation durations
export const animations = {
  fast: 150,
  normal: 300,
  slow: 500,
  spring: {
    damping: 15,
    stiffness: 150,
  },
};

// Border radiuses
export const borderRadius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  full: 9999,
};

// Spacing scale
export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

// Typography scale
export const typography = {
  h1: {
    fontSize: 36,
    fontWeight: '800' as const,
    letterSpacing: -1,
    color: colors.text,
  },
  h2: {
    fontSize: 28,
    fontWeight: '700' as const,
    letterSpacing: -0.5,
    color: colors.text,
  },
  h3: {
    fontSize: 22,
    fontWeight: '700' as const,
    color: colors.text,
  },
  body: {
    fontSize: 16,
    fontWeight: '500' as const,
    lineHeight: 24,
    color: colors.text,
  },
  bodySmall: {
    fontSize: 14,
    fontWeight: '500' as const,
    lineHeight: 20,
    color: colors.textSecondary,
  },
  caption: {
    fontSize: 12,
    fontWeight: '500' as const,
    color: colors.textSecondary,
    letterSpacing: 0.5,
  },
  label: {
    fontSize: 11,
    fontWeight: '600' as const,
    color: colors.textMuted,
    textTransform: 'uppercase' as const,
    letterSpacing: 1,
  },
};
