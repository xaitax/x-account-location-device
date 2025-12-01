/**
 * X-Posed Mobile App - History Browser Component
 * Full-screen view of all lookup history with search
 */

import React, { useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  FlatList,
  Image,
  Dimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, glassShadow } from '@/styles/commonStyles';
import { IconSymbol } from '@/components/IconSymbol';
import { HistoryEntry } from '../types';
import { getFlag, getDeviceEmoji, formatCountryName } from '../utils/countryFlags';
import profileImageCache from '../services/ProfileImageCache';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_WIDTH = (SCREEN_WIDTH - 60) / 3;

interface HistoryBrowserProps {
  history: HistoryEntry[];
  onSelectUser: (entry: HistoryEntry) => void;
  onClearHistory: () => void;
  onClose: () => void;
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
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

/**
 * Individual history card for grid view
 */
function HistoryGridItem({
  entry,
  onSelect
}: {
  entry: HistoryEntry;
  onSelect: (entry: HistoryEntry) => void;
}) {
  const [profileImageUrl, setProfileImageUrl] = useState<string | null>(null);
  const flag = entry.data?.location ? getFlag(entry.data.location) : '❓';
  const device = entry.data?.device ? getDeviceEmoji(entry.data.device) : '';
  const isVPN = entry.data?.isAccurate === false;

  // Load profile image from cache
  React.useEffect(() => {
    let mounted = true;
    const loadImage = async () => {
      try {
        const cachedUrl = await profileImageCache.get(entry.username);
        if (mounted && cachedUrl) {
          setProfileImageUrl(cachedUrl);
        }
      } catch (e) {
        // ignore
      }
    };
    loadImage();
    return () => { mounted = false; };
  }, [entry.username]);

  return (
    <TouchableOpacity
      style={styles.gridItem}
      onPress={() => onSelect(entry)}
      activeOpacity={0.7}
    >
      <LinearGradient
        colors={['rgba(15, 23, 32, 0.9)', 'rgba(10, 14, 20, 0.95)']}
        style={styles.gridItemGradient}
      >
        {/* Avatar */}
        <View style={styles.avatar}>
          {profileImageUrl ? (
            <Image
              source={{ uri: profileImageUrl }}
              style={styles.avatarImage}
            />
          ) : (
            <Text style={styles.avatarText}>
              {entry.username.charAt(0).toUpperCase()}
            </Text>
          )}
        </View>

        {/* Username */}
        <Text style={styles.username} numberOfLines={1}>
          @{entry.username}
        </Text>

        {/* Location & Device */}
        <View style={styles.infoRow}>
          <Text style={styles.flagEmoji}>{flag}</Text>
          {isVPN && <Text style={styles.vpnBadge}>🔒</Text>}
          {device && <Text style={styles.gridDeviceEmoji}>{device}</Text>}
        </View>

        {/* Time */}
        <Text style={styles.timeAgo}>{formatTimeAgo(entry.lookupTime)}</Text>

        {/* Source Badge */}
        <View style={[
          styles.sourceBadge,
          { backgroundColor: entry.mode === 'live' ? 'rgba(255, 165, 0, 0.2)' : 'rgba(0, 212, 255, 0.2)' }
        ]}>
          <Text style={styles.sourceText}>
            {entry.mode === 'live' ? '⚡' : '☁️'}
          </Text>
        </View>
      </LinearGradient>
    </TouchableOpacity>
  );
}

export function HistoryBrowser({
  history,
  onSelectUser,
  onClearHistory,
  onClose
}: HistoryBrowserProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'time' | 'name'>('time');

  // Filter and sort history
  const filteredHistory = useMemo(() => {
    let filtered = history;

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      filtered = history.filter(entry => {
        const username = entry.username.toLowerCase();
        const location = entry.data?.location?.toLowerCase() || '';
        return username.includes(query) || location.includes(query);
      });
    }

    // Sort
    const sorted = [...filtered].sort((a, b) => {
      switch (sortBy) {
        case 'time':
          return b.lookupTime - a.lookupTime;
        case 'name':
          return a.username.localeCompare(b.username);
        default:
          return 0;
      }
    });

    return sorted;
  }, [history, searchQuery, sortBy]);

  // Calculate stats
  const stats = useMemo(() => {
    const countries = new Map<string, number>();
    const devices = new Map<string, number>();
    let vpnCount = 0;

    history.forEach(entry => {
      if (entry.data?.location) {
        const loc = entry.data.location.toLowerCase();
        countries.set(loc, (countries.get(loc) || 0) + 1);
      }
      if (entry.data?.device) {
        const d = entry.data.device.toLowerCase();
        let type = 'Web';
        if (d.includes('ios') || d.includes('iphone') || d.includes('app store')) type = 'iOS';
        else if (d.includes('android')) type = 'Android';
        devices.set(type, (devices.get(type) || 0) + 1);
      }
      if (entry.data?.isAccurate === false) {
        vpnCount++;
      }
    });

    // ALL countries, sorted by count
    const allCountries = Array.from(countries.entries())
      .sort((a, b) => b[1] - a[1]);

    const deviceStats = Array.from(devices.entries())
      .sort((a, b) => b[1] - a[1]);

    return { allCountries, deviceStats, vpnCount, total: history.length };
  }, [history]);

  const renderItem = useCallback(({ item }: { item: HistoryEntry }) => (
    <HistoryGridItem entry={item} onSelect={onSelectUser} />
  ), [onSelectUser]);

  const keyExtractor = useCallback((item: HistoryEntry) => 
    `${item.username}-${item.lookupTime}`, []);

  const getDeviceEmoji = (type: string): string => {
    switch (type) {
      case 'iOS': return '🍎';
      case 'Android': return '🤖';
      default: return '🌐';
    }
  };

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={['rgba(10, 14, 20, 1)', 'rgba(5, 8, 12, 1)']}
        style={styles.backgroundGradient}
      />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={onClose}>
          <IconSymbol
            ios_icon_name="chevron.left"
            android_material_icon_name="arrow-back"
            size={24}
            color={colors.text}
          />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>📚 All Lookups</Text>
          <Text style={styles.headerSubtitle}>{stats.total} users in history</Text>
        </View>
        <TouchableOpacity style={styles.clearAllButton} onPress={onClearHistory}>
          <Text style={styles.clearAllText}>Clear All</Text>
        </TouchableOpacity>
      </View>

      {/* Search Bar */}
      <View style={styles.searchContainer}>
        <View style={styles.searchInputWrapper}>
          <IconSymbol
            ios_icon_name="magnifyingglass"
            android_material_icon_name="search"
            size={18}
            color={colors.textMuted}
          />
          <TextInput
            style={styles.searchInput}
            placeholder="Search by username or country..."
            placeholderTextColor={colors.textMuted}
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <IconSymbol
                ios_icon_name="xmark.circle.fill"
                android_material_icon_name="cancel"
                size={18}
                color={colors.textMuted}
              />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Sort Options */}
      <View style={styles.sortContainer}>
        <Text style={styles.sortLabel}>Sort:</Text>
        {(['time', 'name'] as const).map((option) => (
          <TouchableOpacity
            key={option}
            style={[styles.sortButton, sortBy === option && styles.sortButtonActive]}
            onPress={() => setSortBy(option)}
          >
            <Text style={[styles.sortButtonText, sortBy === option && styles.sortButtonTextActive]}>
              {option === 'time' ? '🕐 Recent' : '🔤 Name'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Stats Summary - Same as ScanScreen */}
      {stats.total > 0 && !searchQuery && (
        <View style={styles.statsContainer}>
          <LinearGradient
            colors={['rgba(0, 212, 255, 0.1)', 'rgba(0, 212, 255, 0.05)']}
            style={styles.statsGradient}
          >
            <Text style={styles.statsTitle}>📊 Statistics</Text>
            
            {/* Total / VPN row */}
            <View style={styles.statsRow}>
              <View style={styles.statItem}>
                <Text style={styles.statValue}>{stats.total}</Text>
                <Text style={styles.statLabel}>Total</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statItem}>
                <Text style={styles.statValue}>{stats.vpnCount}</Text>
                <Text style={styles.statLabel}>VPN 🔒</Text>
              </View>
            </View>

            {/* Countries - Top 5 only */}
            {stats.allCountries.length > 0 && (
              <View style={styles.countryList}>
                <Text style={styles.sectionLabel}>Top Countries</Text>
                <View style={styles.countryRow}>
                  {stats.allCountries.slice(0, 5).map(([country, count]) => (
                    <View key={country} style={styles.countryBadge}>
                      <Text style={styles.countryFlag}>{getFlag(country)}</Text>
                      <Text style={styles.countryCount}>{count}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {/* Devices */}
            {stats.deviceStats.length > 0 && (
              <View style={styles.deviceList}>
                <Text style={styles.sectionLabel}>Devices</Text>
                <View style={styles.deviceRow}>
                  {stats.deviceStats.map(([device, count]) => (
                    <View key={device} style={styles.deviceBadge}>
                      <Text style={styles.deviceEmoji}>{getDeviceEmoji(device)}</Text>
                      <Text style={styles.deviceCount}>{count}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}
          </LinearGradient>
        </View>
      )}

      {/* Results Count */}
      {searchQuery && (
        <Text style={styles.resultsCount}>
          {filteredHistory.length} result{filteredHistory.length !== 1 ? 's' : ''} found
        </Text>
      )}

      {/* History Grid */}
      <FlatList
        data={filteredHistory}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        numColumns={3}
        contentContainerStyle={styles.gridContent}
        columnWrapperStyle={styles.gridRow}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyEmoji}>🔍</Text>
            <Text style={styles.emptyText}>
              {searchQuery ? 'No users found' : 'No lookup history yet'}
            </Text>
            {searchQuery && (
              <TouchableOpacity onPress={() => setSearchQuery('')}>
                <Text style={styles.clearSearchText}>Clear search</Text>
              </TouchableOpacity>
            )}
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  backgroundGradient: {
    ...StyleSheet.absoluteFillObject,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: {
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
  },
  headerSubtitle: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  clearAllButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 107, 107, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255, 107, 107, 0.3)',
  },
  clearAllText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.error,
  },
  searchContainer: {
    padding: 16,
  },
  searchInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: colors.text,
    padding: 0,
  },
  sortContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 12,
    gap: 8,
  },
  sortLabel: {
    fontSize: 12,
    color: colors.textMuted,
    marginRight: 4,
  },
  sortButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  sortButtonActive: {
    backgroundColor: 'rgba(0, 212, 255, 0.1)',
    borderColor: colors.primary,
  },
  sortButtonText: {
    fontSize: 11,
    color: colors.textSecondary,
  },
  sortButtonTextActive: {
    color: colors.primary,
    fontWeight: '600',
  },
  statsContainer: {
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  statsGradient: {
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(0, 212, 255, 0.2)',
  },
  statsTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 12,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  statItem: {
    alignItems: 'center',
    flex: 1,
  },
  statValue: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.primary,
  },
  statLabel: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 2,
  },
  statDivider: {
    width: 1,
    height: 40,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  sectionLabel: {
    fontSize: 11,
    color: colors.textMuted,
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  countryList: {
    marginBottom: 12,
  },
  countryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  countryBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    gap: 4,
  },
  countryFlag: {
    fontSize: 16,
  },
  countryCount: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.text,
  },
  deviceList: {},
  deviceRow: {
    flexDirection: 'row',
    gap: 8,
  },
  deviceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    gap: 4,
  },
  deviceEmoji: {
    fontSize: 16,
  },
  deviceCount: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.text,
  },
  resultsCount: {
    fontSize: 12,
    color: colors.textMuted,
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  gridContent: {
    padding: 16,
    paddingTop: 8,
  },
  gridRow: {
    gap: 10,
    marginBottom: 10,
  },
  gridItem: {
    width: CARD_WIDTH,
    borderRadius: 12,
    overflow: 'hidden',
    ...glassShadow,
  },
  gridItemGradient: {
    padding: 10,
    alignItems: 'center',
    minHeight: 110,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0, 212, 255, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
    overflow: 'hidden',
  },
  avatarImage: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  avatarText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.primary,
  },
  username: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 4,
    maxWidth: '100%',
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginBottom: 2,
  },
  flagEmoji: {
    fontSize: 14,
  },
  vpnBadge: {
    fontSize: 9,
  },
  gridDeviceEmoji: {
    fontSize: 11,
  },
  timeAgo: {
    fontSize: 9,
    color: colors.textMuted,
  },
  sourceBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 4,
  },
  sourceText: {
    fontSize: 9,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyEmoji: {
    fontSize: 48,
    marginBottom: 16,
  },
  emptyText: {
    fontSize: 15,
    color: colors.textSecondary,
    marginBottom: 12,
  },
  clearSearchText: {
    fontSize: 14,
    color: colors.primary,
    fontWeight: '600',
  },
});

export default HistoryBrowser;