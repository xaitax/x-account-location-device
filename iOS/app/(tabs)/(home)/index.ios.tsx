/**
 * X-Posed Mobile App - Main Home Screen (iOS)
 * Clean, modern, beautiful lookup experience
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Animated,
  Keyboard,
  Dimensions,
  Image,
  Share,
  Alert,
  Modal,
} from 'react-native';
import * as ExpoClipboard from 'expo-clipboard';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { Stack } from 'expo-router';
import ViewShot from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';

import { colors, glassShadow } from '@/styles/commonStyles';
import AppHaptics from '@/src/services/HapticService';
import { IconSymbol } from '@/components/IconSymbol';
import { useDeepLink } from '@/contexts/DeepLinkContext';

// Import our custom components
import { ResultCard } from '@/src/components/ResultCard';
import { HistoryCard } from '@/src/components/HistoryCard';
import { HistoryBrowser } from '@/src/components/HistoryBrowser';
import { LoginScreen } from '@/src/screens/LoginScreen';
import { SettingsSheet } from '@/src/components/SettingsSheet';
import { EvidenceCard } from '@/src/components/EvidenceCard';
import { ScanScreen } from '@/src/screens/ScanScreen';

// Import services and hooks
import { useAuth } from '@/src/hooks/useAuth';
import { useHistory } from '@/src/hooks/useHistory';
import { useCloudCache } from '@/src/hooks/useCloudCache';
import { useRateLimit } from '@/src/hooks/useRateLimit';
import { NetworkManager } from '@/src/services/NetworkManager';
import { XGraphQLAPI } from '@/src/services/XGraphQLAPI';
import { fetchUserProfile } from '@/src/services/ProfileAPI';
import profileImageCache from '@/src/services/ProfileImageCache';
import { LocationEntry, Session, HistoryEntry } from '@/src/types';
import { RateLimitBanner } from '@/src/components/RateLimitBanner';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export default function HomeScreen() {
  // Auth state
  const {
    authToken,
    csrfToken,
    username: loggedInUsername,
    isAuthenticated,
    loading: isLoadingAuth,
    login,
    logout,
    setUsername: setAuthUsername,
  } = useAuth();
  
  // History management
  const { history, addToHistory, clearHistory } = useHistory();
  
  // Cloud cache
  const {
    isEnabled: cloudEnabled,
    stats: cloudStats,
    serverStats,
    loadingServerStats,
    toggleEnabled: toggleCloudCache,
    fetchServerStats,
    contributeEntry,
    syncStats,
  } = useCloudCache();
  
  // Rate limit tracking
  const { isRateLimited, resetTime, dismiss: dismissRateLimit } = useRateLimit();
  
  // Deep link handling
  const { pendingUsername, clearPendingUsername } = useDeepLink();
  
  // Local state
  const [username, setUsername] = useState('');
  const [result, setResult] = useState<LocationEntry | null>(null);
  const [profileImageUrl, setProfileImageUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showLogin, setShowLogin] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [lookupSource, setLookupSource] = useState<'cache' | 'live' | null>(null);
  const [showShareOptions, setShowShareOptions] = useState(false);
  const [isCapturingImage, setIsCapturingImage] = useState(false);
  const [renderCaptureCard, setRenderCaptureCard] = useState(false);
  const [showScan, setShowScan] = useState(false);
  const [showHistoryBrowser, setShowHistoryBrowser] = useState(false);
  
  // Animation refs
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.9)).current;
  const evidenceCardRef = useRef<View>(null);

  /**
   * Clean username from input (remove @ and URL parts)
   */
  const cleanUsername = useCallback((input: string): string => {
    let clean = input.trim();
    
    // Handle URLs
    if (clean.includes('x.com/') || clean.includes('twitter.com/')) {
      const match = clean.match(/(?:x|twitter)\.com\/([a-zA-Z0-9_]+)/);
      if (match) {
        clean = match[1];
      }
    }
    
    // Remove @ prefix
    clean = clean.replace(/^@/, '');
    
    // Validate
    if (!/^[a-zA-Z0-9_]{1,15}$/.test(clean)) {
      return '';
    }
    
    return clean.toLowerCase();
  }, []);

  /**
   * Trigger lookup from deep link
   */
  const triggerLookupFromDeepLink = useCallback(async (targetUsername: string) => {
    const cleanedUsername = cleanUsername(targetUsername);
    if (!cleanedUsername) return;
    
    Keyboard.dismiss();
    setIsLoading(true);
    setError(null);
    setResult(null);
    setProfileImageUrl(null);
    setLookupSource(null);
    
    fadeAnim.setValue(0);
    scaleAnim.setValue(0.9);
    
    try {
      const session: Session | undefined = isAuthenticated
        ? { authToken, csrfToken, isAuthenticated }
        : undefined;
      
      const { data, source } = await NetworkManager.smartLookup(cleanedUsername, session);
      
      if (data && source !== 'none') {
      const resultWithUsername = { ...data, username: cleanedUsername };
      setResult(resultWithUsername);
      setLookupSource(source);
      addToHistory(cleanedUsername, resultWithUsername, source);
      
      // Haptic feedback for successful lookup
      AppHaptics.lookupSuccess();
        
        if (source === 'live' && cloudEnabled) {
          contributeEntry(cleanedUsername, data);
        }
        
        // Sync cloud stats to capture any lookups/hits from NetworkManager
        syncStats();
        
        // Fetch profile image - first check cache, then fetch if authenticated
        const cachedImageUrl = await profileImageCache.get(cleanedUsername);
        if (cachedImageUrl) {
          setProfileImageUrl(cachedImageUrl);
        } else if (isAuthenticated) {
          fetchUserProfile(cleanedUsername, { authToken, csrfToken, isAuthenticated })
            .then(profile => {
              if (profile?.profileImageUrl) {
                setProfileImageUrl(profile.profileImageUrl);
                profileImageCache.set(cleanedUsername, profile.profileImageUrl);
              }
            })
            .catch(() => {});
        }
        
        Animated.parallel([
          Animated.timing(fadeAnim, { toValue: 1, duration: 300, useNativeDriver: true }),
          Animated.spring(scaleAnim, { toValue: 1, friction: 8, tension: 40, useNativeDriver: true }),
        ]).start();
      } else {
        setError(`No data found for @${cleanedUsername}.`);
        AppHaptics.lookupFailed();
      }
    } catch (err) {
      setError(`Failed to look up user: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated, authToken, csrfToken, cleanUsername, addToHistory, cloudEnabled, contributeEntry, fadeAnim, scaleAnim]);
  
  // Handle deep link pending username
  useEffect(() => {
    if (pendingUsername && !isLoading) {
      setUsername(pendingUsername);
      clearPendingUsername();
      // Trigger lookup automatically
      setTimeout(() => {
        triggerLookupFromDeepLink(pendingUsername);
      }, 300);
    }
  }, [pendingUsername, isLoading, clearPendingUsername, triggerLookupFromDeepLink]);

  /**
   * Smart lookup - cache first, then live if authenticated
   */
  const handleLookup = useCallback(async () => {
    // Immediate haptic feedback when button is pressed
    AppHaptics.buttonPress();
    
    const cleanedUsername = cleanUsername(username);
    
    if (!cleanedUsername) {
      setError('Please enter a valid X username');
      AppHaptics.warning();
      return;
    }
    
    Keyboard.dismiss();
    setIsLoading(true);
    setError(null);
    setResult(null);
    setProfileImageUrl(null);
    setLookupSource(null);
    
    // Reset animation
    fadeAnim.setValue(0);
    scaleAnim.setValue(0.9);
    
    try {
      // Build session for live mode
      const session: Session | undefined = isAuthenticated
        ? { authToken, csrfToken, isAuthenticated }
        : undefined;
      
      // Use smart lookup - tries cloud cache first, then live if available
      const { data, source } = await NetworkManager.smartLookup(cleanedUsername, session);
      
      if (data && source !== 'none') {
      const resultWithUsername = { ...data, username: cleanedUsername };
      setResult(resultWithUsername);
      setLookupSource(source);
      
      // Add to history
      addToHistory(cleanedUsername, resultWithUsername, source);
      
      // Haptic feedback for successful lookup
      AppHaptics.lookupSuccess();
        
        // Auto-contribute to cloud if enabled and was a live lookup
        if (source === 'live' && cloudEnabled) {
          contributeEntry(cleanedUsername, data);
        }
        
        // Sync cloud stats to capture any lookups/hits from NetworkManager
        syncStats();
        
        // Fetch profile image - first check cache, then fetch if authenticated
        const cachedImageUrl = await profileImageCache.get(cleanedUsername);
        if (cachedImageUrl) {
          setProfileImageUrl(cachedImageUrl);
        } else if (isAuthenticated) {
          fetchUserProfile(cleanedUsername, { authToken, csrfToken, isAuthenticated })
            .then(profile => {
              if (profile?.profileImageUrl) {
                setProfileImageUrl(profile.profileImageUrl);
                profileImageCache.set(cleanedUsername, profile.profileImageUrl);
              }
            })
            .catch(() => {});
        }
        
        // Animate result in
        Animated.parallel([
          Animated.timing(fadeAnim, {
            toValue: 1,
            duration: 300,
            useNativeDriver: true,
          }),
          Animated.spring(scaleAnim, {
            toValue: 1,
            friction: 8,
            tension: 40,
            useNativeDriver: true,
          }),
        ]).start();
      } else {
        // Check if the failure was due to rate limiting
        const rateLimitStatus = XGraphQLAPI.getRateLimitStatus();
        if (rateLimitStatus.isRateLimited && isAuthenticated) {
          // Don't show "no data found" - the rate limit banner will be visible
          // Just show a shorter message
          setError('Rate limited - please wait for reset.');
          AppHaptics.rateLimited();
        } else {
          setError(`No data found for @${cleanedUsername}. ${!isAuthenticated ? 'Log in for live lookups.' : ''}`);
          AppHaptics.lookupFailed();
        }
      }
    } catch (err) {
      setError(`Failed to look up user: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setIsLoading(false);
    }
  }, [username, isAuthenticated, authToken, csrfToken, cleanUsername, addToHistory, cloudEnabled, contributeEntry, fadeAnim, scaleAnim, syncStats]);

  /**
   * Open share options modal
   */
  const handleShareResult = useCallback(() => {
    if (!result || !result.username) return;
    AppHaptics.share();
    setShowShareOptions(true);
  }, [result]);

  /**
   * Copy result to clipboard
   */
  const handleShareAsText = useCallback(async () => {
    if (!result || !result.username) return;
    setShowShareOptions(false);
    
    const deviceLabel = result.device || 'Unknown';
    const vpnStatus = result.isAccurate ? 'No VPN detected' : 'VPN/Proxy detected';
    
    const shareText = `🌍 X-Posed Location Intel

👤 @${result.username}
📍 Location: ${result.location}
📱 Device: ${deviceLabel}
🛡️ Status: ${vpnStatus}

Captured via X-Posed - Location Intelligence for X`;

    try {
      await ExpoClipboard.setStringAsync(shareText);
      AppHaptics.copy();
      Alert.alert('Copied!', 'Result copied to clipboard.');
    } catch (error) {
      AppHaptics.lookupFailed();
      Alert.alert('Copy Failed', 'Unable to copy to clipboard. Please try again.');
    }
  }, [result]);

  /**
   * Share as image (evidence screenshot)
   */
  const handleShareAsImage = useCallback(async () => {
    if (!result || !result.username) return;
    
    setShowShareOptions(false);
    
    // Show the capture UI immediately
    setIsCapturingImage(true);
    setRenderCaptureCard(true);
  }, [result]);

  /**
   * Called when ViewShot is ready and rendered
   */
  const handleCaptureReady = useCallback(async () => {
    if (!result || !evidenceCardRef.current) return;
    
    // Store captured URI for sharing
    let capturedUri: string | null = null;
    
    try {
      // Small delay to ensure rendering is complete
      await new Promise(resolve => setTimeout(resolve, 300));
      
      capturedUri = await (evidenceCardRef.current as any).capture();
      
      if (!capturedUri) {
        throw new Error('Capture returned null');
      }
      
    } catch (captureError) {
      setRenderCaptureCard(false);
      setIsCapturingImage(false);
      Alert.alert('Capture Failed', `Unable to capture image: ${captureError instanceof Error ? captureError.message : 'Unknown error'}`);
      return;
    }
    
    // Close capture UI
    setRenderCaptureCard(false);
    setIsCapturingImage(false);
    
    // Wait for state to update before sharing
    await new Promise(resolve => setTimeout(resolve, 200));
    
    // Now share the image
    try {
      const isAvailable = await Sharing.isAvailableAsync();
      
      if (isAvailable && capturedUri) {
        await Sharing.shareAsync(capturedUri, {
          mimeType: 'image/png',
          dialogTitle: `X-Posed: @${result.username}`,
          UTI: 'public.png',
        });
      } else {
        Alert.alert('Sharing Unavailable', 'Sharing is not available on this device.');
      }
    } catch (shareError) {
      // Don't show error alert - user may have just cancelled
    }
  }, [result]);

  /**
   * Handle user selection from history
   */
  const handleSelectFromHistory = useCallback(async (entry: HistoryEntry) => {
    // Haptic feedback for selection
    AppHaptics.itemSelected();
    
    // Reset animation
    fadeAnim.setValue(0);
    scaleAnim.setValue(0.9);
    
    // Set username in search input
    setUsername(entry.username);
    
    // Set result from history entry
    if (entry.data) {
      const resultWithUsername = { ...entry.data, username: entry.username };
      setResult(resultWithUsername);
      setLookupSource(entry.mode);
      setError(null);
      
      // Fetch profile image from cache
      try {
        const cachedImageUrl = await profileImageCache.get(entry.username);
        if (cachedImageUrl) {
          setProfileImageUrl(cachedImageUrl);
        } else {
          setProfileImageUrl(null);
        }
      } catch {
        setProfileImageUrl(null);
      }
      
      // Animate result in
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.spring(scaleAnim, {
          toValue: 1,
          friction: 8,
          tension: 40,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [fadeAnim, scaleAnim]);

  /**
   * Handle login success
   */
  const handleLoginSuccess = useCallback((newAuthToken: string, newCsrfToken: string, capturedUsername?: string) => {
    AppHaptics.loginSuccess();
    login(newAuthToken, newCsrfToken, capturedUsername);
    setShowLogin(false);
    setShowSettings(false);
  }, [login]);

  /**
   * Handle logout
   */
  const handleLogout = useCallback(() => {
    AppHaptics.logout();
    logout();
  }, [logout]);

  // If showing login screen
  if (showLogin) {
    return (
      <LoginScreen
        onLoginSuccess={handleLoginSuccess}
        onClose={() => setShowLogin(false)}
      />
    );
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView style={styles.container} edges={['top']}>
        <StatusBar style="light" />
        <LinearGradient
          colors={['rgba(10, 14, 20, 1)', 'rgba(5, 8, 12, 1)']}
          style={styles.backgroundGradient}
        />
        
        <KeyboardAvoidingView
          style={styles.keyboardAvoid}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Header */}
            <View style={styles.header}>
              <View style={styles.logoContainer}>
                <Image
                  source={require('@/assets/images/icon.png')}
                  style={styles.logoImage}
                  resizeMode="contain"
                />
                <View>
                  <Text style={styles.title}>X-Posed</Text>
                  <Text style={styles.subtitle}>Location Intelligence</Text>
                </View>
              </View>
              
              {/* Header Buttons */}
              <View style={styles.headerButtons}>
                {/* Scan Button */}
                {isAuthenticated && (
                  <TouchableOpacity
                    style={styles.settingsButton}
                    onPress={() => setShowScan(true)}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.settingsButtonInner, styles.scanButton]}>
                      <IconSymbol
                        ios_icon_name="person.3.fill"
                        android_material_icon_name="people"
                        size={20}
                        color={colors.primary}
                      />
                    </View>
                  </TouchableOpacity>
                )}
                {/* Settings Button */}
                <TouchableOpacity
                  style={styles.settingsButton}
                  onPress={() => setShowSettings(true)}
                  activeOpacity={0.7}
                >
                  <View style={styles.settingsButtonInner}>
                    <IconSymbol
                      ios_icon_name="gearshape.fill"
                      android_material_icon_name="settings"
                      size={20}
                      color={colors.textSecondary}
                    />
                  </View>
                </TouchableOpacity>
              </View>
            </View>

            {/* Status Bar */}
            <View style={styles.statusBar}>
              <View style={styles.statusItem}>
                <View style={[styles.statusDot, isAuthenticated ? styles.statusDotActive : styles.statusDotInactive]} />
                <Text style={styles.statusText}>
                  {isAuthenticated ? 'Live Mode' : 'Cache Only'}
                </Text>
              </View>
              {cloudEnabled && (
                <View style={styles.statusItem}>
                  <Text style={styles.statusEmoji}>☁️</Text>
                  <Text style={styles.statusText}>Cloud Active</Text>
                </View>
              )}
            </View>

            {/* Search Input */}
            <View style={styles.searchSection}>
              <View style={styles.inputContainer}>
                <View style={styles.inputWrapper}>
                  <Text style={styles.atSymbol}>@</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="Enter username or paste URL"
                    placeholderTextColor={colors.textMuted}
                    value={username}
                    onChangeText={setUsername}
                    autoCapitalize="none"
                    autoCorrect={false}
                    returnKeyType="search"
                    onSubmitEditing={handleLookup}
                    editable={!isLoading}
                  />
                  {username.length > 0 && (
                    <TouchableOpacity
                      style={styles.clearButton}
                      onPress={() => setUsername('')}
                    >
                      <IconSymbol
                        ios_icon_name="xmark.circle.fill"
                        android_material_icon_name="cancel"
                        size={18}
                        color={colors.textMuted}
                      />
                    </TouchableOpacity>
                  )}
                </View>
                
                <TouchableOpacity
                  style={styles.searchButton}
                  onPress={handleLookup}
                  disabled={isLoading}
                  activeOpacity={0.8}
                >
                  <LinearGradient
                    colors={[colors.primary, colors.primaryDark]}
                    style={styles.searchButtonGradient}
                  >
                    {isLoading ? (
                      <ActivityIndicator size="small" color={colors.text} />
                    ) : (
                      <IconSymbol
                        ios_icon_name="magnifyingglass"
                        android_material_icon_name="search"
                        size={24}
                        color={colors.text}
                      />
                    )}
                  </LinearGradient>
                </TouchableOpacity>
              </View>
            </View>

            {/* Error Message */}
            {error && (
              <View style={styles.errorContainer}>
                <IconSymbol
                  ios_icon_name="exclamationmark.triangle.fill"
                  android_material_icon_name="warning"
                  size={18}
                  color={colors.error}
                />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            {/* Loading State */}
            {isLoading && (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color={colors.primary} />
                <Text style={styles.loadingText}>Searching...</Text>
              </View>
            )}

            {/* Result Card */}
            {result && !isLoading && (
              <Animated.View
                style={[
                  styles.resultContainer,
                  {
                    opacity: fadeAnim,
                    transform: [{ scale: scaleAnim }],
                  },
                ]}
              >
                {/* Source Badge - prefer data.fromCloud flag if present */}
                <View style={styles.sourceBadge}>
                  <Text style={styles.sourceBadgeEmoji}>
                    {result.fromCloud === true || lookupSource === 'cache' ? '☁️' : '⚡'}
                  </Text>
                  <Text style={styles.sourceBadgeText}>
                    {result.fromCloud === true || lookupSource === 'cache' ? 'From Cache' : 'Live Lookup'}
                  </Text>
                </View>
                
                <ResultCard
                  data={result}
                  username={result.username}
                  showTimestamp={true}
                  onShare={handleShareResult}
                  profileImageUrl={profileImageUrl || undefined}
                />
              </Animated.View>
            )}

            {/* History Section */}
            {history.length > 0 && !isLoading && (
              <View style={styles.historySection}>
                <View style={styles.historySectionHeader}>
                  <HistoryCard
                    history={history}
                    onSelectUser={handleSelectFromHistory}
                    onClearHistory={clearHistory}
                  />
                  {history.length > 5 && (
                    <TouchableOpacity
                      style={styles.seeAllButton}
                      onPress={() => setShowHistoryBrowser(true)}
                    >
                      <Text style={styles.seeAllText}>
                        See All ({history.length})
                      </Text>
                      <IconSymbol
                        ios_icon_name="chevron.right"
                        android_material_icon_name="chevron-right"
                        size={16}
                        color={colors.primary}
                      />
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            )}

            {/* Welcome Card */}
            {!result && !isLoading && !error && history.length === 0 && (
              <View style={styles.welcomeContainer}>
                <View style={styles.welcomeCard}>
                  <View style={styles.welcomeIcon}>
                    <Text style={styles.welcomeEmoji}>🌍</Text>
                  </View>
                  <Text style={styles.welcomeTitle}>Welcome to X-Posed</Text>
                  <Text style={styles.welcomeTagline}>Location Intelligence for X</Text>
                  <Text style={styles.welcomeText}>
                    Discover where X users post from, what device they use, and if they're behind a VPN.
                  </Text>
                  
                  <View style={styles.welcomeFeatures}>
                    <View style={styles.welcomeFeature}>
                      <Text style={styles.welcomeFeatureEmoji}>🏳️</Text>
                      <Text style={styles.welcomeFeatureText}>190+ country flags</Text>
                    </View>
                    <View style={styles.welcomeFeature}>
                      <Text style={styles.welcomeFeatureEmoji}>🔒</Text>
                      <Text style={styles.welcomeFeatureText}>VPN detection</Text>
                    </View>
                    <View style={styles.welcomeFeature}>
                      <Text style={styles.welcomeFeatureEmoji}>📱</Text>
                      <Text style={styles.welcomeFeatureText}>Device identification</Text>
                    </View>
                    <View style={styles.welcomeFeature}>
                      <Text style={styles.welcomeFeatureEmoji}>👥</Text>
                      <Text style={styles.welcomeFeatureText}>Batch scan timelines</Text>
                    </View>
                  </View>
                  
                  <View style={styles.welcomeTip}>
                    <Text style={styles.welcomeTipText}>
                      💡 Log in via <Text style={styles.welcomeTipHighlight}>Settings</Text> for live lookups
                    </Text>
                  </View>
                </View>
              </View>
            )}
          </ScrollView>
        </KeyboardAvoidingView>

        {/* Settings Sheet */}
        <SettingsSheet
          visible={showSettings}
          onClose={() => setShowSettings(false)}
          isAuthenticated={isAuthenticated}
          username={loggedInUsername || null}
          onLogin={() => {
            setShowSettings(false);
            setShowLogin(true);
          }}
          onLogout={handleLogout}
          onSetUsername={setAuthUsername}
          cloudEnabled={cloudEnabled}
          onCloudToggle={toggleCloudCache}
          cloudStats={cloudStats}
          serverStats={serverStats}
          onRefreshServerStats={fetchServerStats}
          loadingServerStats={loadingServerStats}
        />

        {/* Share Options Modal */}
        <Modal
          visible={showShareOptions}
          transparent
          animationType="fade"
          onRequestClose={() => setShowShareOptions(false)}
        >
          <TouchableOpacity
            style={styles.shareModalOverlay}
            activeOpacity={1}
            onPress={() => setShowShareOptions(false)}
          >
            <View style={styles.shareModalContent}>
              <View style={styles.shareModalHeader}>
                <Text style={styles.shareModalTitle}>Share Result</Text>
                <TouchableOpacity onPress={() => setShowShareOptions(false)}>
                  <IconSymbol
                    ios_icon_name="xmark.circle.fill"
                    android_material_icon_name="cancel"
                    size={24}
                    color={colors.textMuted}
                  />
                </TouchableOpacity>
              </View>
              
              <View style={styles.shareOptions}>
                <TouchableOpacity style={styles.shareOption} onPress={handleShareAsText}>
                  <View style={[styles.shareOptionIcon, { backgroundColor: 'rgba(0, 212, 255, 0.15)' }]}>
                    <IconSymbol
                      ios_icon_name="doc.on.clipboard"
                      android_material_icon_name="content-copy"
                      size={28}
                      color={colors.primary}
                    />
                  </View>
                  <Text style={styles.shareOptionTitle}>Copy to Clipboard</Text>
                  <Text style={styles.shareOptionDesc}>Copy text to clipboard</Text>
                </TouchableOpacity>
                
                <TouchableOpacity style={styles.shareOption} onPress={handleShareAsImage}>
                  <View style={[styles.shareOptionIcon, { backgroundColor: 'rgba(187, 134, 252, 0.15)' }]}>
                    <IconSymbol
                      ios_icon_name="photo.fill"
                      android_material_icon_name="image"
                      size={28}
                      color="#BB86FC"
                    />
                  </View>
                  <Text style={styles.shareOptionTitle}>Share as Image</Text>
                  <Text style={styles.shareOptionDesc}>Beautiful evidence card</Text>
                </TouchableOpacity>
              </View>
            </View>
          </TouchableOpacity>
        </Modal>

        {/* Capturing Overlay - shows the card while capturing */}
        {isCapturingImage && renderCaptureCard && result && (
          <View style={styles.capturingOverlay}>
            <Text style={styles.capturingText}>Creating image...</Text>
            <View style={styles.captureCardWrapper}>
              <ViewShot
                ref={evidenceCardRef}
                options={{ format: 'png', quality: 1 }}
                style={styles.viewShotContainer}
                onLayout={handleCaptureReady}
              >
                <EvidenceCard
                  data={result}
                  username={result.username || ''}
                  profileImageUrl={profileImageUrl || undefined}
                />
              </ViewShot>
            </View>
          </View>
        )}
        
        {/* Loading Indicator for image capture */}
        {isCapturingImage && !renderCaptureCard && (
          <View style={styles.capturingOverlay}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.capturingText}>Preparing share...</Text>
          </View>
        )}

        {/* Scan Screen Modal */}
        {showScan && (
          <View style={styles.scanModal}>
            <ScanScreen
              session={{ authToken, csrfToken, isAuthenticated, username: loggedInUsername || undefined }}
              onClose={() => setShowScan(false)}
              addToHistory={addToHistory}
              defaultUsername={loggedInUsername || undefined}
              onShareUser={(user) => {
                // Set the selected user result for sharing
                if (user.locationData) {
                  setResult({ ...user.locationData, username: user.screenName });
                  setProfileImageUrl(user.profileImageUrl || null);
                  setShowScan(false);
                  // Show share options after closing scan
                  setTimeout(() => setShowShareOptions(true), 300);
                }
              }}
            />
          </View>
        )}

        {/* History Browser Modal */}
        {showHistoryBrowser && (
          <View style={styles.historyBrowserModal}>
            <SafeAreaView style={{ flex: 1 }} edges={['top']}>
              <HistoryBrowser
                history={history}
                onSelectUser={async (entry) => {
                  // Close browser first
                  setShowHistoryBrowser(false);
                  
                  // Reset animation
                  fadeAnim.setValue(0);
                  scaleAnim.setValue(0.9);
                  
                  // Set username in search input
                  setUsername(entry.username);
                  
                  // Set result from history entry
                  setResult({
                    ...entry.data,
                    username: entry.username,
                  });
                  setLookupSource(entry.mode);
                  
                  // Fetch profile image from cache
                  try {
                    const cachedImageUrl = await profileImageCache.get(entry.username);
                    if (cachedImageUrl) {
                      setProfileImageUrl(cachedImageUrl);
                    } else {
                      setProfileImageUrl(null);
                    }
                  } catch {
                    setProfileImageUrl(null);
                  }
                  
                  // Animate result in
                  Animated.parallel([
                    Animated.timing(fadeAnim, {
                      toValue: 1,
                      duration: 300,
                      useNativeDriver: true,
                    }),
                    Animated.spring(scaleAnim, {
                      toValue: 1,
                      friction: 8,
                      tension: 40,
                      useNativeDriver: true,
                    }),
                  ]).start();
                }}
                onClearHistory={() => {
                  clearHistory();
                  setShowHistoryBrowser(false);
                }}
                onClose={() => setShowHistoryBrowser(false)}
              />
            </SafeAreaView>
          </View>
        )}

        {/* Rate Limit Toast (floating at bottom) */}
        <RateLimitBanner
          isRateLimited={isRateLimited}
          resetTime={resetTime}
          onDismiss={dismissRateLimit}
        />
      </SafeAreaView>
    </>
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
  keyboardAvoid: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 40,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  logoContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  logoImage: {
    width: 44,
    height: 44,
    borderRadius: 12,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.text,
  },
  subtitle: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 1,
  },
  headerButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  settingsButton: {
    padding: 4,
  },
  settingsButtonInner: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  authDot: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.success,
  },
  statusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginBottom: 20,
    paddingHorizontal: 4,
  },
  statusItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusDotActive: {
    backgroundColor: colors.success,
  },
  statusDotInactive: {
    backgroundColor: colors.textMuted,
  },
  statusText: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  statusEmoji: {
    fontSize: 14,
  },
  searchSection: {
    marginBottom: 20,
  },
  inputContainer: {
    flexDirection: 'row',
    gap: 12,
  },
  inputWrapper: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    paddingHorizontal: 16,
  },
  atSymbol: {
    fontSize: 18,
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
  clearButton: {
    padding: 4,
  },
  searchButton: {
    borderRadius: 16,
    overflow: 'hidden',
    ...glassShadow,
  },
  searchButtonGradient: {
    width: 56,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: 'rgba(255, 107, 107, 0.1)',
    borderRadius: 12,
    padding: 14,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 107, 107, 0.2)',
    gap: 10,
  },
  errorText: {
    flex: 1,
    fontSize: 14,
    color: colors.error,
    lineHeight: 20,
  },
  loadingContainer: {
    alignItems: 'center',
    paddingVertical: 40,
    gap: 16,
  },
  loadingText: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  resultContainer: {
    marginBottom: 24,
  },
  sourceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    marginBottom: 8,
  },
  sourceBadgeEmoji: {
    fontSize: 14,
  },
  sourceBadgeText: {
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  historySection: {
    marginTop: 8,
  },
  welcomeContainer: {
    marginTop: 20,
  },
  welcomeCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: 20,
    padding: 24,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    alignItems: 'center',
  },
  welcomeIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(0, 212, 255, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  welcomeEmoji: {
    fontSize: 36,
  },
  welcomeTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 12,
  },
  welcomeText: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  welcomeFeatures: {
    width: '100%',
    gap: 10,
  },
  welcomeFeature: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: 10,
  },
  welcomeTagline: {
    fontSize: 13,
    color: colors.primary,
    fontWeight: '600',
    marginBottom: 8,
  },
  welcomeFeatureEmoji: {
    fontSize: 18,
  },
  welcomeFeatureText: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  welcomeTip: {
    marginTop: 20,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.06)',
    alignItems: 'center',
  },
  welcomeTipText: {
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
  },
  welcomeTipHighlight: {
    color: colors.primary,
    fontWeight: '600',
  },
  // Share Modal Styles
  shareModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'flex-end',
  },
  shareModalContent: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 40,
  },
  shareModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  shareModalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
  },
  shareOptions: {
    flexDirection: 'row',
    gap: 16,
  },
  shareOption: {
    flex: 1,
    alignItems: 'center',
    padding: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  shareOptionIcon: {
    width: 60,
    height: 60,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  shareOptionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 4,
  },
  shareOptionDesc: {
    fontSize: 11,
    color: colors.textMuted,
  },
  // Capture overlay - shows the evidence card while capturing
  capturingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#0A0E14',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    zIndex: 9999,
  },
  capturingText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 20,
  },
  captureCardWrapper: {
    width: '100%',
    maxWidth: 400,
  },
  viewShotContainer: {
    backgroundColor: '#0A0E14', // Solid background for capture
  },
  scanButton: {
    borderColor: 'rgba(0, 212, 255, 0.3)',
  },
  scanModal: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9999,
  },
  historyBrowserModal: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9998,
  },
  historySectionHeader: {
    width: '100%',
  },
  seeAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    marginTop: 12,
    backgroundColor: 'rgba(0, 212, 255, 0.08)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(0, 212, 255, 0.2)',
    gap: 6,
  },
  seeAllText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.primary,
  },
});

