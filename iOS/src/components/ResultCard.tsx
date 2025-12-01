/**
 * X-Posed Mobile App - Result Card Component
 * Beautiful glassmorphic card displaying location & device info
 */

import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, ActivityIndicator } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, glassShadow } from '@/styles/commonStyles';
import { IconSymbol } from '@/components/IconSymbol';
import { LocationEntry } from '../types';
import { getFlag, getDeviceEmoji, getDeviceLabel, getDeviceColor, formatCountryName } from '../utils/countryFlags';

interface ResultCardProps {
  data: LocationEntry;
  username?: string;
  showTimestamp?: boolean;
  onShare?: () => void;
  profileImageUrl?: string;
}

export function ResultCard({ data, username, showTimestamp = true, onShare, profileImageUrl }: ResultCardProps) {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const previousUrlRef = useRef<string | undefined>(undefined);

  // Reset image states when URL changes
  useEffect(() => {
    if (profileImageUrl !== previousUrlRef.current) {
      previousUrlRef.current = profileImageUrl;
      setImageLoaded(false);
      setImageError(false);
    }
  }, [profileImageUrl]);
  const flag = getFlag(data.location);
  const deviceEmoji = getDeviceEmoji(data.device);
  const deviceLabel = getDeviceLabel(data.device);
  const deviceColor = getDeviceColor(data.device);
  const formattedLocation = formatCountryName(data.location);

  // Determine connection status
  const connectionStatus = data.isAccurate
    ? { label: 'No VPN / Proxy Detected', color: colors.secondary, icon: 'checkmark.shield.fill' }
    : { label: 'VPN / Proxy Detected', color: colors.vpnColor, icon: 'lock.shield.fill' };

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={['rgba(15, 23, 32, 0.95)', 'rgba(10, 14, 20, 0.98)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.gradient}
      >
        {/* Header with username */}
        {username && (
          <View style={styles.header}>
            <View style={styles.avatarContainer}>
              {profileImageUrl && !imageError ? (
                <View style={styles.avatarImageWrapper}>
                  {!imageLoaded && (
                    <View style={styles.avatarLoadingOverlay}>
                      <ActivityIndicator size="small" color={colors.primary} />
                    </View>
                  )}
                  <Image
                    source={{ uri: profileImageUrl }}
                    style={[styles.avatarImage, !imageLoaded && styles.avatarImageHidden]}
                    onLoad={() => setImageLoaded(true)}
                    onError={() => {
                      setImageError(true);
                      setImageLoaded(false);
                    }}
                  />
                </View>
              ) : (
                <LinearGradient
                  colors={[colors.primary, colors.primaryDark]}
                  style={styles.avatar}
                >
                  <Text style={styles.avatarText}>
                    {username.charAt(0).toUpperCase()}
                  </Text>
                </LinearGradient>
              )}
            </View>
            <View style={styles.headerText}>
              <Text style={styles.username}>@{username}</Text>
              <Text style={styles.sourceLabel}>
                {data.fromCloud ? '☁️ Cloud Cache' : '🔴 Live Data'}
              </Text>
            </View>
            {onShare && (
              <TouchableOpacity style={styles.shareButton} onPress={onShare}>
                <IconSymbol
                  ios_icon_name="square.and.arrow.up"
                  android_material_icon_name="share"
                  size={20}
                  color={colors.textSecondary}
                />
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Stats Grid */}
        <View style={styles.statsGrid}>
          {/* Location */}
          <View style={styles.statCard}>
            <View style={styles.statHeader}>
              <Text style={styles.statEmoji}>{flag}</Text>
              <Text style={styles.statLabel}>LOCATION</Text>
            </View>
            <Text style={styles.statValue} numberOfLines={1}>
              {formattedLocation || 'Unknown'}
            </Text>
          </View>

          {/* Device */}
          <View style={styles.statCard}>
            <View style={styles.statHeader}>
              <Text style={styles.statEmoji}>{deviceEmoji}</Text>
              <Text style={styles.statLabel}>DEVICE</Text>
            </View>
            <View style={styles.deviceRow}>
              <Text style={[styles.statValue, { color: deviceColor }]}>
                {deviceLabel}
              </Text>
            </View>
          </View>

          {/* Connection Type - Full Width */}
          <View style={[styles.statCard, styles.fullWidth]}>
            <View style={styles.statHeader}>
              <IconSymbol
                ios_icon_name={connectionStatus.icon as any}
                android_material_icon_name="security"
                size={20}
                color={connectionStatus.color}
              />
              <Text style={styles.statLabel}>CONNECTION</Text>
            </View>
            <View style={styles.connectionRow}>
              <Text style={[styles.statValue, { color: connectionStatus.color }]}>
                {connectionStatus.label}
              </Text>
              <View style={[styles.statusBadge, { backgroundColor: connectionStatus.color + '20', borderColor: connectionStatus.color }]}>
                <Text style={[styles.statusBadgeText, { color: connectionStatus.color }]}>
                  {data.isAccurate ? 'VERIFIED' : 'PROXY'}
                </Text>
              </View>
            </View>
          </View>
        </View>

        {/* Timestamp */}
        {showTimestamp && data.timestamp && (
          <View style={styles.timestampContainer}>
            <IconSymbol
              ios_icon_name="clock"
              android_material_icon_name="schedule"
              size={12}
              color={colors.textMuted}
            />
            <Text style={styles.timestamp}>
              {formatTimestamp(data.timestamp)}
            </Text>
          </View>
        )}

        {/* Glow effect */}
        <View style={styles.glowEffect} pointerEvents="none" />
      </LinearGradient>
    </View>
  );
}

/**
 * Format timestamp for display
 */
function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  });
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 24,
    overflow: 'hidden',
    ...glassShadow,
  },
  gradient: {
    padding: 20,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    position: 'relative',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
  },
  avatarContainer: {
    marginRight: 12,
  },
  avatarImageWrapper: {
    width: 52,
    height: 52,
    borderRadius: 26,
    overflow: 'hidden',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 2,
    borderColor: colors.primary,
  },
  avatarImage: {
    width: '100%',
    height: '100%',
    borderRadius: 26,
  },
  avatarImageHidden: {
    opacity: 0,
  },
  avatarLoadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    borderRadius: 26,
    zIndex: 1,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
  },
  headerText: {
    flex: 1,
  },
  username: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 2,
  },
  sourceLabel: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  shareButton: {
    padding: 8,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -6,
  },
  statCard: {
    width: '50%',
    paddingHorizontal: 6,
    marginBottom: 12,
  },
  fullWidth: {
    width: '100%',
  },
  statHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    gap: 8,
  },
  statEmoji: {
    fontSize: 20,
  },
  statLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.textMuted,
    letterSpacing: 1,
  },
  statValue: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  deviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  connectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
  },
  statusBadgeText: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  timestampContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.05)',
    gap: 6,
  },
  timestamp: {
    fontSize: 11,
    color: colors.textMuted,
  },
  glowEffect: {
    position: 'absolute',
    top: -50,
    right: -50,
    width: 150,
    height: 150,
    borderRadius: 75,
    backgroundColor: 'rgba(0, 212, 255, 0.15)',
    opacity: 0.4,
  },
});

export default ResultCard;
