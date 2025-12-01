/**
 * X-Posed Mobile App - Scan Screen
 * Batch analysis of followers/following/timeline
 */

import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  Dimensions,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';

import { colors, glassShadow } from '@/styles/commonStyles';
import { IconSymbol } from '@/components/IconSymbol';
import { Session, LocationEntry, LookupMode } from '../types';
import {
  fetchVerifiedFollowers,
  fetchFollowing,
  fetchTimeline,
  getUserId,
  ExtractedUser
} from '../services/FollowersAPI';
import { NetworkManager } from '../services/NetworkManager';
import profileImageCache from '../services/ProfileImageCache';
import { ResultCard } from '../components/ResultCard';
import { RateLimitBanner } from '../components/RateLimitBanner';
import { useRateLimit } from '../hooks/useRateLimit';
import { getFlag, getDeviceEmoji, formatCountryName } from '../utils/countryFlags';
import AppHaptics from '../services/HapticService';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_WIDTH = (SCREEN_WIDTH - 60) / 3;

type ScanSource = 'verified_followers' | 'following' | 'timeline';

interface ScannedUser extends ExtractedUser {
  locationData?: LocationEntry | null;
  lookupStatus: 'pending' | 'loading' | 'done' | 'error';
}

interface ScanStats {
  total: number;
  scanned: number;
  byCountry: Record<string, number>;
  byDevice: Record<string, number>;
  vpnCount: number;
}

interface ScanScreenProps {
  session: Session;
  onClose: () => void;
  addToHistory?: (username: string, data: LocationEntry, mode: LookupMode) => Promise<void>;
  onShareUser?: (user: ScannedUser) => void;
  defaultUsername?: string;  // Pre-fill username from login
}

export function ScanScreen({ session, onClose, addToHistory, onShareUser, defaultUsername }: ScanScreenProps) {
  // Rate limit tracking
  const { isRateLimited, resetTime, dismiss: dismissRateLimit } = useRateLimit();

  // State
  const [source, setSource] = useState<ScanSource>('timeline');
  const [targetUsername, setTargetUsername] = useState(defaultUsername || '');
  const [users, setUsers] = useState<ScannedUser[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [selectedUser, setSelectedUser] = useState<ScannedUser | null>(null);
  const [rateLimitWarning, setRateLimitWarning] = useState<string | null>(null);
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<ScanStats | null>(null);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [hasMore, setHasMore] = useState(false);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [hasFetched, setHasFetched] = useState(false);
  
  // Refs
  const abortRef = useRef(false);

  /**
   * Fetch users from selected source
   */
  const handleFetch = useCallback(async (loadMore = false) => {
    if (!session.isAuthenticated) {
      Alert.alert('Login Required', 'Please log in to X to use this feature.');
      return;
    }

    // For followers/following modes, we need a username
    if ((source === 'verified_followers' || source === 'following') && !targetUsername.trim()) {
      Alert.alert('Username Required', 'Please enter a username to scan their verified followers or following.');
      return;
    }

    // Use different loading states for initial load vs load more
    if (loadMore) {
      setIsLoadingMore(true);
    } else {
      setIsLoading(true);
    }
    setError(null);
    abortRef.current = false;

    if (!loadMore) {
      setUsers([]);
      setCursor(undefined);
      setStats(null);
      setHasFetched(false);
    }

    try {
      let result;

      if (source === 'timeline') {
        result = await fetchTimeline(session, loadMore ? cursor : undefined);
      } else {
        // Get user ID from username
        const cleanUsername = targetUsername.trim().replace(/^@/, '').toLowerCase();
        const userId = await getUserId(cleanUsername, session);
        
        if (!userId) {
          setError(`Could not find user @${cleanUsername}`);
          setIsLoading(false);
          return;
        }

        if (source === 'verified_followers') {
          result = await fetchVerifiedFollowers(userId, session, loadMore ? cursor : undefined);
        } else {
          result = await fetchFollowing(userId, session, loadMore ? cursor : undefined);
        }
      }

      if (result.error) {
        setError(result.error);
        setIsLoading(false);
        return;
      }

      // Convert to ScannedUser format and cache profile images
      const scannedUsers: ScannedUser[] = result.users.map(u => {
        // Cache profile image if available
        if (u.profileImageUrl && u.screenName) {
          profileImageCache.set(u.screenName.toLowerCase(), u.profileImageUrl);
        }
        return {
          ...u,
          lookupStatus: 'pending' as const,
        };
      });

      if (loadMore) {
        setUsers(prev => {
          // Deduplicate by userId
          const existingIds = new Set(prev.map(u => u.userId));
          const newUsers = scannedUsers.filter(u => !existingIds.has(u.userId));
          return [...prev, ...newUsers];
        });
      } else {
        setUsers(scannedUsers);
      }

      setHasMore(result.hasMore);
      setCursor(result.nextCursor);
      setHasFetched(true);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch users');
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  }, [session, source, targetUsername, cursor]);

  /**
   * Perform location lookups for all users
   * Uses smartLookup which checks cloud cache FIRST (never rate limited),
   * then falls back to live API only if not in cache
   */
  const handleLookupAll = useCallback(async () => {
    if (users.length === 0) return;

    setIsLookingUp(true);
    abortRef.current = false;
    setProgress({ current: 0, total: users.length });

    const newStats: ScanStats = {
      total: users.length,
      scanned: 0,
      byCountry: {},
      byDevice: {},
      vpnCount: 0,
    };

    // Process in small batches to show progress
    const batchSize = 5;
    
    for (let i = 0; i < users.length; i += batchSize) {
      if (abortRef.current) break;

      const batch = users.slice(i, i + batchSize);
      
      // Mark batch as loading (unless they already have data from previous lookup)
      setUsers(prev => prev.map((u, idx) => {
        if (idx >= i && idx < i + batchSize && !u.locationData) {
          return { ...u, lookupStatus: 'loading' as const };
        }
        return u;
      }));

      // Process batch
      await Promise.all(batch.map(async (user, batchIdx) => {
        const idx = i + batchIdx;
        if (abortRef.current) return;

        // Skip if we already have data from a previous lookup
        if (user.locationData) {
          // Still update stats for existing data
          if (user.locationData.location) {
            const country = user.locationData.location.toLowerCase();
            newStats.byCountry[country] = (newStats.byCountry[country] || 0) + 1;
          }
          if (user.locationData.device) {
            const device = getDeviceCategory(user.locationData.device);
            newStats.byDevice[device] = (newStats.byDevice[device] || 0) + 1;
          }
          if (user.locationData.isAccurate === false) {
            newStats.vpnCount++;
          }
          newStats.scanned++;
          return;
        }

        try {
          // smartLookup: Cloud cache first (never rate limited!), then live API
          const { data, source: lookupSource } = await NetworkManager.smartLookup(user.screenName, session);
          
          setUsers(prev => prev.map((u, uidx) => {
            if (uidx === idx) {
              return { ...u, locationData: data, lookupStatus: 'done' as const };
            }
            return u;
          }));

          // Add to history if we have the function
          if (addToHistory && data) {
            // Merge profile image URL into data for history
            const dataWithProfile = {
              ...data,
              profileImageUrl: user.profileImageUrl,
            };
            addToHistory(user.screenName, dataWithProfile, lookupSource === 'cache' ? 'cache' : 'live');
          }

          // Update stats
          if (data) {
            newStats.scanned++;
            if (data.location) {
              const country = data.location.toLowerCase();
              newStats.byCountry[country] = (newStats.byCountry[country] || 0) + 1;
            }
            if (data.device) {
              const device = getDeviceCategory(data.device);
              newStats.byDevice[device] = (newStats.byDevice[device] || 0) + 1;
            }
            if (data.isAccurate === false) {
              newStats.vpnCount++;
            }
          }
        } catch (err: any) {
          // Check if it's a rate limit error
          if (err?.message?.includes('Rate limit') || err?.message?.includes('429')) {
            AppHaptics.rateLimited();
            setRateLimitWarning('Rate limited - some lookups skipped. Cached results still shown.');
            // Don't mark as error if rate limited - just skip
            setUsers(prev => prev.map((u, uidx) => {
              if (uidx === idx && u.lookupStatus === 'loading') {
                return { ...u, lookupStatus: 'pending' as const };
              }
              return u;
            }));
          } else {
            setUsers(prev => prev.map((u, uidx) => {
              if (uidx === idx) {
                return { ...u, lookupStatus: 'error' as const };
              }
              return u;
            }));
          }
        }
      }));

      setProgress({ current: Math.min(i + batchSize, users.length), total: users.length });
      setStats({ ...newStats });

      // Small delay between batches to avoid rate limiting
      if (i + batchSize < users.length && !abortRef.current) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    // Haptic feedback for batch completion
    AppHaptics.batchComplete();
    setIsLookingUp(false);
  }, [users, session, addToHistory]);

  /**
   * Stop ongoing lookup
   */
  const handleStopLookup = useCallback(() => {
    abortRef.current = true;
    setIsLookingUp(false);
  }, []);


  /**
   * Get device category from device string
   */
  const getDeviceCategory = (device: string): string => {
    const d = device.toLowerCase();
    if (d.includes('iphone') || d.includes('ipad') || d.includes('ios') || d.includes('app store')) {
      return 'iOS';
    }
    if (d.includes('android')) {
      return 'Android';
    }
    return 'Web';
  };

  /**
   * Render source selector
   */
  /**
   * Get icon/label for scan source
   */
  const getSourceLabel = (s: ScanSource): { label: string; isTimeline: boolean; isVerified: boolean } => {
    switch (s) {
      case 'timeline':
        return { label: 'Timeline', isTimeline: true, isVerified: false };
      case 'verified_followers':
        return { label: 'Verified', isTimeline: false, isVerified: true };
      case 'following':
        return { label: 'Following', isTimeline: false, isVerified: false };
      default:
        return { label: s, isTimeline: false, isVerified: false };
    }
  };

  /**
   * Render source selector
   */
  const renderSourceSelector = () => (
    <View style={styles.sourceSelector}>
      {(['timeline', 'verified_followers', 'following'] as ScanSource[]).map((s) => {
        const { label, isTimeline, isVerified } = getSourceLabel(s);
        return (
          <TouchableOpacity
            key={s}
            style={[
              styles.sourceButton,
              source === s && styles.sourceButtonActive,
              isVerified && styles.sourceButtonVerified,
              isVerified && source === s && styles.sourceButtonVerifiedActive,
            ]}
            onPress={() => {
                AppHaptics.tabChanged();
                setSource(s);
                setUsers([]);
                setStats(null);
                setError(null);
                setHasFetched(false);
              }}
          >
            {isVerified ? (
              <View style={styles.verifiedLabelContainer}>
                <View style={[styles.verifiedBadge, source === s && styles.verifiedBadgeActive]}>
                  <Text style={styles.verifiedCheck}>✓</Text>
                </View>
                <Text style={[
                  styles.sourceButtonText,
                  source === s && styles.sourceButtonTextActive,
                  styles.sourceButtonTextVerified,
                ]}>
                  {label}
                </Text>
              </View>
            ) : (
              <Text style={[styles.sourceButtonText, source === s && styles.sourceButtonTextActive]}>
                {label}
              </Text>
            )}
          </TouchableOpacity>
        );
      })}
    </View>
  );

  /**
   * Render user card
   */
  const renderUserCard = (user: ScannedUser, index: number) => {
    const flag = user.locationData?.location ? getFlag(user.locationData.location) : '❓';
    const device = user.locationData?.device ? getDeviceEmoji(user.locationData.device) : '';
    const isVPN = user.locationData?.isAccurate === false;

    return (
      <TouchableOpacity
        key={user.userId || index}
        style={styles.userCard}
        onPress={() => {
          if (user.locationData) {
            AppHaptics.itemSelected();
            setSelectedUser(user);
          }
        }}
        activeOpacity={user.locationData ? 0.7 : 1}
      >
        <LinearGradient
          colors={['rgba(15, 23, 32, 0.9)', 'rgba(10, 14, 20, 0.95)']}
          style={[styles.userCardGradient, user.locationData && styles.userCardClickable]}
        >
          {/* Status indicator */}
          {user.lookupStatus === 'loading' && (
            <View style={styles.loadingOverlay}>
              <ActivityIndicator size="small" color={colors.primary} />
            </View>
          )}

          {/* Profile Image */}
          <View style={styles.userAvatar}>
            {user.profileImageUrl ? (
              <Image source={{ uri: user.profileImageUrl }} style={styles.avatarImage} />
            ) : (
              <Text style={styles.avatarText}>{user.screenName.charAt(0).toUpperCase()}</Text>
            )}
          </View>

          {/* Username */}
          <Text style={styles.userName} numberOfLines={1}>
            @{user.screenName}
          </Text>

          {/* Location */}
          {user.lookupStatus === 'done' && (
            <View style={styles.locationRow}>
              <Text style={styles.flagEmoji}>{flag}</Text>
              {isVPN && <Text style={styles.vpnBadge}>🔒</Text>}
              {device && <Text style={styles.cardDeviceEmoji}>{device}</Text>}
            </View>
          )}

          {user.lookupStatus === 'pending' && (
            <Text style={styles.pendingText}>Pending</Text>
          )}

          {user.lookupStatus === 'error' && (
            <Text style={styles.errorText}>Error</Text>
          )}
        </LinearGradient>
      </TouchableOpacity>
    );
  };

  /**
   * Render user detail modal using the same ResultCard from main screen
   */
  const renderUserDetailModal = () => {
    if (!selectedUser || !selectedUser.locationData) return null;

    return (
      <TouchableOpacity
        style={styles.modalOverlay}
        activeOpacity={1}
        onPress={() => setSelectedUser(null)}
      >
        <View style={styles.modalContent}>
          <TouchableOpacity
            style={styles.modalCloseButton}
            onPress={() => setSelectedUser(null)}
          >
            <View style={styles.modalCloseCircle}>
              <Text style={styles.modalCloseText}>✕</Text>
            </View>
          </TouchableOpacity>
          
          <TouchableOpacity activeOpacity={1}>
            <ResultCard
              data={selectedUser.locationData}
              username={selectedUser.screenName}
              profileImageUrl={selectedUser.profileImageUrl}
              showTimestamp={true}
              onShare={onShareUser ? () => onShareUser(selectedUser) : undefined}
            />
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    );
  };

  /**
   * Get device label from category
   */
  const getDeviceLabel = (category: string): string => {
    switch (category) {
      case 'iOS': return 'iOS';
      case 'Android': return 'Android';
      case 'Web': return 'Web';
      default: return '?';
    }
  };

  /**
   * Get device emoji from category
   */
  const getDeviceCategoryEmoji = (category: string): string => {
    switch (category) {
      case 'iOS': return '🍎';
      case 'Android': return '🤖';
      case 'Web': return '🌐';
      default: return '❓';
    }
  };

  /**
   * Render stats summary
   */
  const renderStats = () => {
    if (!stats) return null;

    // Sort countries by count (descending)
    const topCountries = Object.entries(stats.byCountry)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    // Sort devices by count (descending)
    const sortedDevices = Object.entries(stats.byDevice)
      .sort((a, b) => b[1] - a[1]);

    const totalDevices = Object.values(stats.byDevice).reduce((a, b) => a + b, 0);

    return (
      <View style={styles.statsContainer}>
        <LinearGradient
          colors={['rgba(0, 212, 255, 0.1)', 'rgba(0, 212, 255, 0.05)']}
          style={styles.statsGradient}
        >
          <Text style={styles.statsTitle}>📊 Statistics</Text>
          
          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{stats.scanned}</Text>
              <Text style={styles.statLabel}>Scanned</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{stats.vpnCount}</Text>
              <Text style={styles.statLabel}>VPN 🔒</Text>
            </View>
          </View>

          {topCountries.length > 0 && (
            <View style={styles.countryList}>
              <Text style={styles.sectionLabel}>Top Countries</Text>
              <View style={styles.countryRow}>
                {topCountries.map(([country, count]) => (
                  <View key={country} style={styles.countryBadge}>
                    <Text style={styles.countryFlag}>{getFlag(country)}</Text>
                    <Text style={styles.countryCount}>{count}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {totalDevices > 0 && (
            <View style={styles.deviceList}>
              <Text style={styles.sectionLabel}>Devices</Text>
              <View style={styles.deviceRow}>
                {sortedDevices.map(([device, count]) => (
                  <View key={device} style={styles.deviceBadge}>
                    <Text style={styles.deviceEmoji}>{getDeviceCategoryEmoji(device)}</Text>
                    <Text style={styles.deviceCount}>{count}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}
        </LinearGradient>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar style="light" />
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
        <View>
          <Text style={styles.headerTitle}>Batch Scan</Text>
          <Text style={styles.headerSubtitle}>Analyze user locations</Text>
        </View>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Source Selector */}
        {renderSourceSelector()}

        {/* Username Input (for followers/following) */}
        {(source === 'verified_followers' || source === 'following') && (
          <View style={styles.inputContainer}>
            <Text style={styles.inputLabel}>
              Enter a username to scan their {source === 'following' ? 'following list' : 'verified followers'}
            </Text>
            <View style={styles.inputWrapper}>
              <Text style={styles.atSymbol}>@</Text>
              <TextInput
                style={styles.input}
                placeholder="your_username"
                placeholderTextColor={colors.textMuted}
                value={targetUsername}
                onChangeText={setTargetUsername}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
          </View>
        )}

        {/* Fetch Button - only show if no users loaded yet */}
        {!hasFetched && (
          <TouchableOpacity
            style={styles.fetchButton}
            onPress={() => handleFetch(false)}
            disabled={isLoading}
          >
            <LinearGradient
              colors={[colors.primary, colors.primaryDark]}
              style={styles.fetchButtonGradient}
            >
              {isLoading ? (
                <ActivityIndicator size="small" color={colors.text} />
              ) : (
                <>
                  <IconSymbol
                    ios_icon_name="arrow.down.circle.fill"
                    android_material_icon_name="download"
                    size={20}
                    color={colors.text}
                  />
                  <Text style={styles.fetchButtonText}>
                    Fetch {source === 'timeline' ? 'Timeline' :
                     source === 'verified_followers' ? 'Verified Followers' :
                     source.charAt(0).toUpperCase() + source.slice(1)}
                  </Text>
                </>
              )}
            </LinearGradient>
          </TouchableOpacity>
        )}

        {/* Error */}
        {error && (
          <View style={styles.errorContainer}>
            <Text style={styles.errorMessage}>{error}</Text>
          </View>
        )}

        {/* Users Found */}
        {users.length > 0 && (
          <View style={styles.resultsSection}>
            <View style={styles.resultsHeader}>
              <Text style={styles.resultsTitle}>
                Found {users.length} users {hasMore && '(more available)'}
              </Text>
              
              {/* Lookup Button */}
              {!isLookingUp ? (
                <TouchableOpacity
                  style={styles.lookupButton}
                  onPress={handleLookupAll}
                >
                  <Text style={styles.lookupButtonText}>Lookup All</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={[styles.lookupButton, styles.stopButton]}
                  onPress={handleStopLookup}
                >
                  <Text style={styles.lookupButtonText}>Stop</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Progress */}
            {isLookingUp && (
              <View style={styles.progressContainer}>
                <View style={styles.progressBar}>
                  <View 
                    style={[
                      styles.progressFill, 
                      { width: `${(progress.current / progress.total) * 100}%` }
                    ]} 
                  />
                </View>
                <Text style={styles.progressText}>
                  {progress.current} / {progress.total}
                </Text>
              </View>
            )}

            {/* Stats */}
            {renderStats()}

            {/* Load More */}
            {hasMore && (
              <TouchableOpacity
                style={[styles.loadMoreButton, isLoadingMore && styles.loadMoreButtonLoading]}
                onPress={() => handleFetch(true)}
                disabled={isLoadingMore}
              >
                {isLoadingMore ? (
                  <View style={styles.loadMoreContent}>
                    <ActivityIndicator size="small" color={colors.primary} />
                    <Text style={styles.loadMoreText}>Loading more...</Text>
                  </View>
                ) : (
                  <View style={styles.loadMoreContent}>
                    <IconSymbol
                      ios_icon_name="plus.circle.fill"
                      android_material_icon_name="add-circle"
                      size={18}
                      color={colors.primary}
                    />
                    <Text style={styles.loadMoreTextActive}>Load More</Text>
                    <Text style={styles.loadMoreCount}>({users.length} loaded)</Text>
                  </View>
                )}
              </TouchableOpacity>
            )}

            {/* Refresh/Reset Button - allows starting over */}
            {hasFetched && !hasMore && users.length > 0 && (
              <TouchableOpacity
                style={styles.refreshButton}
                onPress={() => handleFetch(false)}
                disabled={isLoading}
              >
                <IconSymbol
                  ios_icon_name="arrow.clockwise"
                  android_material_icon_name="refresh"
                  size={16}
                  color={colors.textSecondary}
                />
                <Text style={styles.refreshButtonText}>Refresh</Text>
              </TouchableOpacity>
            )}

            {/* User Grid */}
            <View style={styles.userGrid}>
              {users.map((user, index) => renderUserCard(user, index))}
            </View>
          </View>
        )}

        {/* Rate Limit Warning Banner */}
        {rateLimitWarning && (
          <View style={styles.rateLimitBanner}>
            <Text style={styles.rateLimitText}>⚠️ {rateLimitWarning}</Text>
            <TouchableOpacity onPress={() => setRateLimitWarning(null)}>
              <Text style={styles.rateLimitDismiss}>✕</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>

      {/* User Detail Modal */}
      {renderUserDetailModal()}

      {/* Rate Limit Toast (floating at bottom) */}
      <RateLimitBanner
        isRateLimited={isRateLimited}
        resetTime={resetTime}
        onDismiss={dismissRateLimit}
      />
    </SafeAreaView>
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
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
  },
  headerSubtitle: {
    fontSize: 12,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 40,
  },
  sourceSelector: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  sourceButton: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    alignItems: 'center',
  },
  sourceButtonActive: {
    backgroundColor: 'rgba(0, 212, 255, 0.1)',
    borderColor: colors.primary,
  },
  sourceButtonVerified: {
    borderColor: 'rgba(29, 161, 242, 0.3)',
  },
  sourceButtonVerifiedActive: {
    backgroundColor: 'rgba(29, 161, 242, 0.15)',
    borderColor: '#1DA1F2',
  },
  verifiedLabelContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  verifiedBadge: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: 'rgba(29, 161, 242, 0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  verifiedBadgeActive: {
    backgroundColor: '#1DA1F2',
  },
  verifiedCheck: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.text,
  },
  sourceButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  sourceButtonTextActive: {
    color: colors.primary,
  },
  sourceButtonTextVerified: {
    color: '#1DA1F2',
  },
  inputContainer: {
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: 8,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    paddingHorizontal: 16,
  },
  atSymbol: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.primary,
    marginRight: 4,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: colors.text,
    paddingVertical: 14,
  },
  fetchButton: {
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 16,
    ...glassShadow,
  },
  fetchButtonGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    gap: 8,
  },
  fetchButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  errorContainer: {
    backgroundColor: 'rgba(255, 107, 107, 0.1)',
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 107, 107, 0.2)',
  },
  errorMessage: {
    fontSize: 14,
    color: colors.error,
  },
  resultsSection: {
    marginTop: 8,
  },
  resultsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  resultsTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
    flex: 1,
  },
  lookupButton: {
    backgroundColor: 'rgba(0, 212, 255, 0.15)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  stopButton: {
    backgroundColor: 'rgba(255, 107, 107, 0.15)',
    borderColor: colors.error,
  },
  lookupButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
  },
  progressContainer: {
    marginBottom: 16,
  },
  progressBar: {
    height: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: 3,
  },
  progressText: {
    fontSize: 12,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: 6,
  },
  statsContainer: {
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
    fontSize: 14,
  },
  deviceLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  deviceCount: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.text,
  },
  userGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  userCard: {
    width: CARD_WIDTH,
    borderRadius: 12,
    overflow: 'hidden',
    ...glassShadow,
  },
  userCardGradient: {
    padding: 10,
    alignItems: 'center',
    minHeight: 100,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  userCardClickable: {
    borderColor: 'rgba(0, 212, 255, 0.2)',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    zIndex: 1,
  },
  userAvatar: {
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
  userName: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 4,
    maxWidth: '100%',
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  flagEmoji: {
    fontSize: 16,
  },
  vpnBadge: {
    fontSize: 10,
  },
  cardDeviceEmoji: {
    fontSize: 12,
  },
  pendingText: {
    fontSize: 9,
    color: colors.textMuted,
  },
  errorText: {
    fontSize: 9,
    color: colors.error,
  },
  loadMoreButton: {
    marginBottom: 16,
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: 'rgba(0, 212, 255, 0.08)',
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(0, 212, 255, 0.25)',
  },
  loadMoreButtonLoading: {
    opacity: 0.7,
  },
  loadMoreContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  loadMoreText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  loadMoreTextActive: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.primary,
  },
  loadMoreCount: {
    fontSize: 12,
    color: colors.textMuted,
  },
  refreshButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginBottom: 16,
    paddingVertical: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  refreshButtonText: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  // Rate limit banner
  rateLimitBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255, 193, 7, 0.15)',
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginHorizontal: 20,
    marginBottom: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 193, 7, 0.3)',
  },
  rateLimitText: {
    fontSize: 13,
    color: '#FFC107',
    flex: 1,
  },
  rateLimitDismiss: {
    fontSize: 16,
    color: '#FFC107',
    marginLeft: 8,
    padding: 4,
  },
  // Modal styles
  modalOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },
  modalContent: {
    width: SCREEN_WIDTH - 32,
    position: 'relative',
  },
  modalCloseButton: {
    position: 'absolute',
    top: -16,
    right: -8,
    zIndex: 10,
  },
  modalCloseCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCloseText: {
    fontSize: 18,
    color: colors.text,
    fontWeight: '600',
  },
  modalButton: {
    backgroundColor: 'rgba(0, 212, 255, 0.15)',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(0, 212, 255, 0.3)',
  },
  modalButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.primary,
  },
});

export default ScanScreen;