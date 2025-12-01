/**
 * X-Posed Mobile App - Evidence Card Component
 * A beautiful, capturable card for evidence screenshots
 * Similar to browser extension's evidence-capture functionality
 */

import React, { forwardRef } from 'react';
import { View, Text, StyleSheet, Image } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors } from '@/styles/commonStyles';
import { LocationEntry } from '../types';
import { getFlag, getDeviceEmoji, getDeviceLabel, formatCountryName } from '../utils/countryFlags';

interface EvidenceCardProps {
  data: LocationEntry;
  username: string;
  profileImageUrl?: string;
}

/**
 * Evidence Card - A beautiful card designed for screenshot capture
 * This component is optimized for image export/sharing
 */
export const EvidenceCard = forwardRef<View, EvidenceCardProps>(
  ({ data, username, profileImageUrl }, ref) => {
    const flag = getFlag(data.location);
    const deviceEmoji = getDeviceEmoji(data.device);
    const deviceLabel = getDeviceLabel(data.device);
    const formattedLocation = formatCountryName(data.location);
    const connectionLabel = data.isAccurate ? 'Residential / Cellular' : 'VPN / Proxy Detected';
    const connectionColor = data.isAccurate ? '#10B981' : '#F59E0B';
    
    const timestamp = new Date(data.timestamp).toLocaleString('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });

    return (
      <View ref={ref} style={styles.container} collapsable={false}>
        <LinearGradient
          colors={['#0A0E14', '#0F1722', '#141D2B']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.gradient}
        >
          {/* Header with branding */}
          <View style={styles.header}>
            <View style={styles.brandContainer}>
              <Text style={styles.brandIcon}>🌍</Text>
              <View>
                <Text style={styles.brandName}>X-Posed</Text>
                <Text style={styles.brandTagline}>Location Intelligence</Text>
              </View>
            </View>
            <Text style={styles.timestamp}>{timestamp}</Text>
          </View>

          {/* User Section */}
          <View style={styles.userSection}>
            {profileImageUrl ? (
              <Image
                source={{ uri: profileImageUrl }}
                style={styles.avatar}
              />
            ) : (
              <LinearGradient
                colors={[colors.primary, colors.primaryDark]}
                style={styles.avatarFallback}
              >
                <Text style={styles.avatarText}>{username.charAt(0).toUpperCase()}</Text>
              </LinearGradient>
            )}
            <View style={styles.userInfo}>
              <Text style={styles.username}>@{username}</Text>
              <Text style={styles.sourceLabel}>
                {data.fromCloud ? '☁️ Cloud Cache' : '🔴 Live Data'}
              </Text>
            </View>
          </View>

          {/* Divider */}
          <View style={styles.divider} />

          {/* Stats Grid */}
          <View style={styles.statsContainer}>
            {/* Location */}
            <View style={styles.statRow}>
              <View style={styles.statIconContainer}>
                <Text style={styles.statEmoji}>{flag}</Text>
              </View>
              <View style={styles.statContent}>
                <Text style={styles.statLabel}>LOCATION</Text>
                <Text style={styles.statValue}>{formattedLocation || 'Unknown'}</Text>
              </View>
            </View>

            {/* Device */}
            <View style={styles.statRow}>
              <View style={styles.statIconContainer}>
                <Text style={styles.statEmoji}>{deviceEmoji}</Text>
              </View>
              <View style={styles.statContent}>
                <Text style={styles.statLabel}>DEVICE</Text>
                <Text style={styles.statValue}>{deviceLabel}</Text>
              </View>
            </View>

            {/* Connection */}
            <View style={styles.statRow}>
              <View style={[styles.statIconContainer, { backgroundColor: `${connectionColor}20` }]}>
                <Text style={styles.statEmoji}>{data.isAccurate ? '✓' : '🔒'}</Text>
              </View>
              <View style={styles.statContent}>
                <Text style={styles.statLabel}>CONNECTION</Text>
                <View style={styles.connectionRow}>
                  <Text style={[styles.statValue, { color: connectionColor }]}>{connectionLabel}</Text>
                  <View style={[styles.badge, { backgroundColor: `${connectionColor}20`, borderColor: connectionColor }]}>
                    <Text style={[styles.badgeText, { color: connectionColor }]}>
                      {data.isAccurate ? 'VERIFIED' : 'PROXY'}
                    </Text>
                  </View>
                </View>
              </View>
            </View>
          </View>

          {/* Footer */}
          <View style={styles.footer}>
            <Text style={styles.footerText}>Generated by X-Posed • Location Intelligence for X</Text>
          </View>

          {/* Decorative glow */}
          <View style={styles.glowTopRight} pointerEvents="none" />
          <View style={styles.glowBottomLeft} pointerEvents="none" />
        </LinearGradient>
      </View>
    );
  }
);

const styles = StyleSheet.create({
  container: {
    borderRadius: 24,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 10,
  },
  gradient: {
    padding: 24,
    position: 'relative',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 24,
  },
  brandContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  brandIcon: {
    fontSize: 32,
  },
  brandName: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.text,
  },
  brandTagline: {
    fontSize: 11,
    color: colors.textSecondary,
    letterSpacing: 0.5,
  },
  timestamp: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 4,
  },
  userSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginBottom: 20,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 3,
    borderColor: colors.primary,
  },
  avatarFallback: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.text,
  },
  userInfo: {
    flex: 1,
  },
  username: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 4,
  },
  sourceLabel: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    marginBottom: 20,
  },
  statsContainer: {
    gap: 16,
    marginBottom: 20,
  },
  statRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  statIconContainer: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  statEmoji: {
    fontSize: 22,
  },
  statContent: {
    flex: 1,
  },
  statLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.textMuted,
    letterSpacing: 1,
    marginBottom: 4,
  },
  statValue: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  connectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
  },
  badgeText: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  footer: {
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.05)',
    alignItems: 'center',
  },
  footerText: {
    fontSize: 10,
    color: colors.textMuted,
    letterSpacing: 0.3,
  },
  glowTopRight: {
    position: 'absolute',
    top: -40,
    right: -40,
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: 'rgba(0, 212, 255, 0.12)',
  },
  glowBottomLeft: {
    position: 'absolute',
    bottom: -40,
    left: -40,
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: 'rgba(187, 134, 252, 0.08)',
  },
});

export default EvidenceCard;