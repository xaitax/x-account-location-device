/**
 * X-Posed Mobile App - History Card Component
 * Displays recent lookup history with quick actions
 */

import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Image } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, glassShadow } from '@/styles/commonStyles';
import { IconSymbol } from '@/components/IconSymbol';
import { HistoryEntry } from '../types';
import { getFlag, getDeviceEmoji } from '../utils/countryFlags';
import profileImageCache from '../services/ProfileImageCache';
import AppHaptics from '../services/HapticService';

interface HistoryCardProps {
  history: HistoryEntry[];
  onSelectUser: (entry: HistoryEntry) => void;
  onClearHistory: () => void;
  maxItems?: number;
}

/**
 * Individual history item with profile image support
 */
function HistoryItem({ entry, onSelect }: { entry: HistoryEntry; onSelect: (entry: HistoryEntry) => void }) {
  const [profileImageUrl, setProfileImageUrl] = useState<string | null>(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);

  // Load profile image from cache
  useEffect(() => {
    let mounted = true;
    
    const loadProfileImage = async () => {
      try {
        const cachedUrl = await profileImageCache.get(entry.username);
        if (mounted && cachedUrl) {
          setProfileImageUrl(cachedUrl);
        }
      } catch (error) {
        console.warn(`[HistoryItem] Failed to load profile image for @${entry.username}:`, error);
      }
    };
    
    loadProfileImage();
    
    return () => {
      mounted = false;
    };
  }, [entry.username]);

  return (
    <TouchableOpacity
      style={styles.historyItem}
      onPress={() => {
        AppHaptics.itemSelected();
        onSelect(entry);
      }}
      activeOpacity={0.7}
    >
      <LinearGradient
        colors={['rgba(15, 23, 32, 0.9)', 'rgba(10, 14, 20, 0.95)']}
        style={styles.itemGradient}
      >
        {/* Avatar with Profile Image */}
        <View style={styles.avatar}>
          {profileImageUrl && !imageError ? (
            <>
              {!imageLoaded && (
                <Text style={styles.avatarText}>
                  {entry.username.charAt(0).toUpperCase()}
                </Text>
              )}
              <Image
                source={{ uri: profileImageUrl }}
                style={[
                  styles.avatarImage,
                  !imageLoaded && styles.avatarImageHidden
                ]}
                onLoad={() => setImageLoaded(true)}
                onError={() => {
                  setImageError(true);
                  setImageLoaded(false);
                }}
              />
            </>
          ) : (
            <Text style={styles.avatarText}>
              {entry.username.charAt(0).toUpperCase()}
            </Text>
          )}
        </View>

        {/* Info */}
        <Text style={styles.username} numberOfLines={1}>
          @{entry.username}
        </Text>

        {/* Location & Device */}
        {entry.data && (
          <View style={styles.infoRow}>
            <Text style={styles.infoText}>
              {getFlag(entry.data.location)}
            </Text>
            <Text style={styles.infoText}>
              {getDeviceEmoji(entry.data.device)}
            </Text>
          </View>
        )}

        {/* Time ago */}
        <Text style={styles.timeAgo}>
          {formatTimeAgo(entry.lookupTime)}
        </Text>

        {/* Source indicator */}
        <View style={[
          styles.sourceBadge,
          { backgroundColor: entry.mode === 'live' ? colors.accent + '20' : colors.secondary + '20' }
        ]}>
          <Text style={[
            styles.sourceText,
            { color: entry.mode === 'live' ? colors.accent : colors.secondary }
          ]}>
            {entry.mode === 'live' ? '⚡' : '☁️'}
          </Text>
        </View>
      </LinearGradient>
    </TouchableOpacity>
  );
}

export function HistoryCard({ history, onSelectUser, onClearHistory, maxItems = 5 }: HistoryCardProps) {
  if (history.length === 0) {
    return null;
  }

  const displayHistory = history.slice(0, maxItems);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <IconSymbol
            ios_icon_name="clock.arrow.circlepath"
            android_material_icon_name="history"
            size={18}
            color={colors.textSecondary}
          />
          <Text style={styles.title}>Recent Lookups</Text>
        </View>
        
        <TouchableOpacity style={styles.clearButton} onPress={() => {
          AppHaptics.historyClear();
          onClearHistory();
        }}>
          <Text style={styles.clearText}>Clear</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {displayHistory.map((entry) => (
          <HistoryItem
            key={`${entry.username}-${entry.lookupTime}`}
            entry={entry}
            onSelect={onSelectUser}
          />
        ))}
      </ScrollView>
    </View>
  );
}

/**
 * Format timestamp to relative time
 */
function formatTimeAgo(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  if (hours < 24) return `${hours}h`;
  return `${days}d`;
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  clearButton: {
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  clearText: {
    fontSize: 12,
    color: colors.accent,
    fontWeight: '500',
  },
  scrollContent: {
    paddingRight: 20,
    gap: 10,
  },
  historyItem: {
    width: 100,
    borderRadius: 16,
    overflow: 'hidden',
    ...glassShadow,
  },
  itemGradient: {
    padding: 12,
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primary + '40',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
    overflow: 'hidden',
  },
  avatarText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.primary,
    position: 'absolute',
  },
  avatarImage: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  avatarImageHidden: {
    opacity: 0,
    position: 'absolute',
  },
  username: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 4,
    maxWidth: '100%',
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 4,
  },
  infoText: {
    fontSize: 14,
  },
  timeAgo: {
    fontSize: 10,
    color: colors.textMuted,
  },
  sourceBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
  },
  sourceText: {
    fontSize: 10,
  },
});

export default HistoryCard;