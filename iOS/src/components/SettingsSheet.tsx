/**
 * X-Posed Mobile App - Settings Sheet
 * Beautiful iOS-style bottom sheet with settings
 */

import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Linking,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Animated,
  Dimensions,
  Switch,
  ScrollView,
  ActivityIndicator,
  Alert,
  PanResponder,
  TextInput,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { BlurView } from "expo-blur";
import { colors, glassShadow } from "@/styles/commonStyles";
import { IconSymbol } from "@/components/IconSymbol";
import AppHaptics from "../services/HapticService";

const { height: SCREEN_HEIGHT, width: SCREEN_WIDTH } = Dimensions.get("window");
const SHEET_HEIGHT = SCREEN_HEIGHT * 0.85;

interface SettingsSheetProps {
  visible: boolean;
  onClose: () => void;
  // Auth
  isAuthenticated: boolean;
  username: string | null;
  onLogin: () => void;
  onLogout: () => void;
  onSetUsername?: (username: string) => void;  // Manual username setting fallback
  // Cloud
  cloudEnabled: boolean;
  onCloudToggle: () => void;
  cloudStats: {
    contributions: number;
    lookups: number;
    hits: number;
    misses?: number;
    errors?: number;
  };
  serverStats: {
    totalEntries: number;
    totalContributions: number;
    lastUpdated?: string;
  } | null;
  onRefreshServerStats: () => void;
  loadingServerStats: boolean;
}

export function SettingsSheet({
  visible,
  onClose,
  isAuthenticated,
  username,
  onLogin,
  onLogout,
  onSetUsername,
  cloudEnabled,
  onCloudToggle,
  cloudStats,
  serverStats,
  onRefreshServerStats,
  loadingServerStats,
}: SettingsSheetProps) {
  const slideAnim = useRef(new Animated.Value(SHEET_HEIGHT)).current;
  const backdropAnim = useRef(new Animated.Value(0)).current;
  const [showUsernameInput, setShowUsernameInput] = useState(false);
  const [tempUsername, setTempUsername] = useState("");

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(slideAnim, {
          toValue: 0,
          damping: 25,
          stiffness: 300,
          useNativeDriver: true,
        }),
        Animated.timing(backdropAnim, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
      // Fetch server stats when sheet opens
      onRefreshServerStats();
    } else {
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: SHEET_HEIGHT,
          duration: 250,
          useNativeDriver: true,
        }),
        Animated.timing(backdropAnim, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gestureState) => {
        return gestureState.dy > 10;
      },
      onPanResponderMove: (_, gestureState) => {
        if (gestureState.dy > 0) {
          slideAnim.setValue(gestureState.dy);
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dy > 100 || gestureState.vy > 0.5) {
          onClose();
        } else {
          Animated.spring(slideAnim, {
            toValue: 0,
            damping: 25,
            stiffness: 300,
            useNativeDriver: true,
          }).start();
        }
      },
    })
  ).current;

  const handleLogout = () => {
    AppHaptics.buttonPress();
    Alert.alert("Logout", "Are you sure you want to log out of X?", [
      { text: "Cancel", style: "cancel" },
      { text: "Logout", style: "destructive", onPress: () => {
        AppHaptics.logout();
        onLogout();
      }},
    ]);
  };

  const handleSetUsername = () => {
    const cleaned = tempUsername.trim().replace(/^@/, "").toLowerCase();
    if (cleaned && /^[a-zA-Z0-9_]{1,15}$/.test(cleaned)) {
      AppHaptics.success();
      onSetUsername?.(cleaned);
      setShowUsernameInput(false);
      setTempUsername("");
    } else {
      AppHaptics.warning();
      Alert.alert("Invalid Username", "Please enter a valid X username (1-15 characters, letters, numbers, and underscores only).");
    }
  };

  if (!visible) return null;

  return (
    <Modal transparent visible={visible} animationType="none">
      {/* Backdrop */}
      <Animated.View style={[styles.backdrop, { opacity: backdropAnim }]}>
        <TouchableOpacity style={styles.backdropTouch} onPress={onClose} />
      </Animated.View>

      {/* Sheet */}
      <Animated.View
        style={[styles.sheet, { transform: [{ translateY: slideAnim }] }]}
      >
        <BlurView intensity={80} tint="dark" style={styles.blurView}>
          {/* Handle */}
          <View {...panResponder.panHandlers} style={styles.handleContainer}>
            <View style={styles.handle} />
          </View>

          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Settings</Text>
            <TouchableOpacity style={styles.closeButton} onPress={onClose}>
              <View style={styles.closeButtonInner}>
                <IconSymbol
                  ios_icon_name="xmark"
                  android_material_icon_name="close"
                  size={16}
                  color={colors.textSecondary}
                />
              </View>
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {/* X Account Section */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>X ACCOUNT</Text>
              <View style={styles.card}>
                <View style={styles.cardRow}>
                  <View style={styles.cardRowLeft}>
                    <View
                      style={[
                        styles.iconContainer,
                        { backgroundColor: "rgba(0, 0, 0, 0.8)" },
                      ]}
                    >
                      <Text style={styles.iconText}>𝕏</Text>
                    </View>
                    <View style={styles.cardRowTextContainer}>
                      <Text style={styles.cardRowTitle}>
                        {isAuthenticated
                          ? username
                            ? `@${username}`
                            : "Connected"
                          : "Not Connected"}
                      </Text>
                      <Text style={styles.cardRowSubtitle}>
                        {isAuthenticated
                          ? username
                            ? "Live lookups enabled"
                            : "Tap to set your username"
                          : "Log in for live lookups"}
                      </Text>
                    </View>
                  </View>
                  <View
                    style={[
                      styles.statusBadge,
                      isAuthenticated
                        ? styles.statusBadgeActive
                        : styles.statusBadgeInactive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.statusBadgeText,
                        isAuthenticated
                          ? styles.statusBadgeTextActive
                          : styles.statusBadgeTextInactive,
                      ]}
                    >
                      {isAuthenticated ? "ACTIVE" : "OFFLINE"}
                    </Text>
                  </View>
                </View>

                {/* Username input section - show when authenticated but no username */}
                {isAuthenticated && !username && onSetUsername && (
                  <View style={styles.usernameSection}>
                    {showUsernameInput ? (
                      <View style={styles.usernameInputRow}>
                        <View style={styles.usernameInputWrapper}>
                          <Text style={styles.usernameAtSymbol}>@</Text>
                          <TextInput
                            style={styles.usernameInput}
                            placeholder="your_username"
                            placeholderTextColor={colors.textMuted}
                            value={tempUsername}
                            onChangeText={setTempUsername}
                            autoCapitalize="none"
                            autoCorrect={false}
                            autoFocus
                          />
                        </View>
                        <TouchableOpacity
                          style={styles.usernameSubmitButton}
                          onPress={handleSetUsername}
                        >
                          <IconSymbol
                            ios_icon_name="checkmark"
                            android_material_icon_name="check"
                            size={18}
                            color={colors.text}
                          />
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.usernameCancelButton}
                          onPress={() => {
                            setShowUsernameInput(false);
                            setTempUsername("");
                          }}
                        >
                          <IconSymbol
                            ios_icon_name="xmark"
                            android_material_icon_name="close"
                            size={18}
                            color={colors.textMuted}
                          />
                        </TouchableOpacity>
                      </View>
                    ) : (
                      <TouchableOpacity
                        style={styles.setUsernameButton}
                        onPress={() => setShowUsernameInput(true)}
                      >
                        <IconSymbol
                          ios_icon_name="person.crop.circle.badge.plus"
                          android_material_icon_name="person-add"
                          size={16}
                          color={colors.primary}
                        />
                        <Text style={styles.setUsernameText}>Set Your Username</Text>
                      </TouchableOpacity>
                    )}
                    <Text style={styles.usernameHint}>
                      Username enables auto-fill in batch scan
                    </Text>
                  </View>
                )}

                <TouchableOpacity
                  style={[
                    styles.actionButton,
                    isAuthenticated
                      ? styles.actionButtonDanger
                      : styles.actionButtonPrimary,
                  ]}
                  onPress={isAuthenticated ? handleLogout : onLogin}
                >
                  <LinearGradient
                    colors={
                      isAuthenticated
                        ? [
                            "rgba(255, 107, 107, 0.2)",
                            "rgba(255, 107, 107, 0.1)",
                          ]
                        : [colors.primary, colors.primaryDark]
                    }
                    style={styles.actionButtonGradient}
                  >
                    <IconSymbol
                      ios_icon_name={
                        isAuthenticated
                          ? "rectangle.portrait.and.arrow.right"
                          : "person.badge.key"
                      }
                      android_material_icon_name={
                        isAuthenticated ? "logout" : "login"
                      }
                      size={18}
                      color={isAuthenticated ? colors.error : colors.text}
                    />
                    <Text
                      style={[
                        styles.actionButtonText,
                        isAuthenticated && styles.actionButtonTextDanger,
                      ]}
                    >
                      {isAuthenticated ? "Log Out" : "Log In to X"}
                    </Text>
                  </LinearGradient>
                </TouchableOpacity>
              </View>
            </View>

            {/* Cloud Cache Section */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>COMMUNITY CLOUD</Text>
              <View style={styles.card}>
                <View style={styles.cardRow}>
                  <View style={styles.cardRowLeft}>
                    <View
                      style={[
                        styles.iconContainer,
                        { backgroundColor: "rgba(0, 212, 255, 0.15)" },
                      ]}
                    >
                      <Text style={styles.iconEmoji}>☁️</Text>
                    </View>
                    <View>
                      <Text style={styles.cardRowTitle}>
                        Cloud Contribution
                      </Text>
                      <Text style={styles.cardRowSubtitle}>
                        Share lookups with community
                      </Text>
                    </View>
                  </View>
                  <Switch
                    value={cloudEnabled}
                    onValueChange={(value) => {
                      AppHaptics.toggleChange();
                      onCloudToggle();
                    }}
                    trackColor={{
                      false: "rgba(255, 255, 255, 0.1)",
                      true: colors.primary,
                    }}
                    thumbColor={cloudEnabled ? colors.text : colors.textMuted}
                    ios_backgroundColor="rgba(255, 255, 255, 0.1)"
                  />
                </View>

                {cloudEnabled && (
                  <View style={styles.statsGrid}>
                    <View style={styles.statItem}>
                      <Text style={styles.statValue}>
                        {cloudStats.contributions}
                      </Text>
                      <Text style={styles.statLabel}>Contributed</Text>
                    </View>
                    <View style={styles.statDivider} />
                    <View style={styles.statItem}>
                      <Text style={styles.statValue}>{cloudStats.lookups}</Text>
                      <Text style={styles.statLabel}>Lookups</Text>
                    </View>
                    <View style={styles.statDivider} />
                    <View style={styles.statItem}>
                      <Text style={styles.statValue}>{cloudStats.hits}</Text>
                      <Text style={styles.statLabel}>Cache Hits</Text>
                    </View>
                  </View>
                )}
              </View>
            </View>

            {/* Cloud Dashboard Section */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>CLOUD DASHBOARD</Text>
              <View style={styles.card}>
                <View style={styles.dashboardHeader}>
                  <View style={styles.cardRowLeft}>
                    <View
                      style={[
                        styles.iconContainer,
                        { backgroundColor: "rgba(0, 255, 179, 0.15)" },
                      ]}
                    >
                      <Text style={styles.iconEmoji}>🌐</Text>
                    </View>
                    <View>
                      <Text style={styles.cardRowTitle}>Global Statistics</Text>
                      <Text style={styles.cardRowSubtitle}>
                        Community cache status
                      </Text>
                    </View>
                  </View>
                  <TouchableOpacity
                    style={styles.refreshButton}
                    onPress={onRefreshServerStats}
                    disabled={loadingServerStats}
                  >
                    {loadingServerStats ? (
                      <ActivityIndicator size="small" color={colors.primary} />
                    ) : (
                      <IconSymbol
                        ios_icon_name="arrow.clockwise"
                        android_material_icon_name="refresh"
                        size={18}
                        color={colors.primary}
                      />
                    )}
                  </TouchableOpacity>
                </View>

                <View style={styles.dashboardGrid}>
                  <View style={styles.dashboardCard}>
                    <LinearGradient
                      colors={[
                        "rgba(0, 212, 255, 0.1)",
                        "rgba(0, 212, 255, 0.05)",
                      ]}
                      style={styles.dashboardCardGradient}
                    >
                      <Text style={styles.dashboardCardEmoji}>👥</Text>
                      <Text style={styles.dashboardCardValue}>
                        {serverStats
                          ? serverStats.totalEntries.toLocaleString()
                          : "—"}
                      </Text>
                      <Text style={styles.dashboardCardLabel}>
                        Cached Users
                      </Text>
                    </LinearGradient>
                  </View>
                  <View style={styles.dashboardCard}>
                    <LinearGradient
                      colors={[
                        "rgba(187, 134, 252, 0.1)",
                        "rgba(187, 134, 252, 0.05)",
                      ]}
                      style={styles.dashboardCardGradient}
                    >
                      <Text style={styles.dashboardCardEmoji}>📤</Text>
                      <Text style={styles.dashboardCardValue}>
                        {cloudStats.contributions.toLocaleString()}
                      </Text>
                      <Text style={styles.dashboardCardLabel}>
                        Contributions
                      </Text>
                    </LinearGradient>
                  </View>
                </View>

                {/* Second Row */}
                <View style={[styles.dashboardGrid, { marginTop: 12 }]}>
                  <View style={styles.dashboardCard}>
                    <LinearGradient
                      colors={[
                        "rgba(0, 255, 179, 0.1)",
                        "rgba(0, 255, 179, 0.05)",
                      ]}
                      style={styles.dashboardCardGradient}
                    >
                      <Text style={styles.dashboardCardEmoji}>⚡</Text>
                      <Text style={styles.dashboardCardValue}>
                        {cloudEnabled ? "Active" : "Inactive"}
                      </Text>
                      <Text style={styles.dashboardCardLabel}>Your Status</Text>
                    </LinearGradient>
                  </View>
                  <View style={styles.dashboardCard}>
                    <LinearGradient
                      colors={[
                        "rgba(255, 215, 64, 0.1)",
                        "rgba(255, 215, 64, 0.05)",
                      ]}
                      style={styles.dashboardCardGradient}
                    >
                      <Text style={styles.dashboardCardEmoji}>🎯</Text>
                      <Text style={styles.dashboardCardValue}>
                        {cloudStats.hits > 0 && cloudStats.lookups > 0
                          ? `${Math.round(
                              (cloudStats.hits / cloudStats.lookups) * 100
                            )}%`
                          : "—"}
                      </Text>
                      <Text style={styles.dashboardCardLabel}>
                        Cache Hit Rate
                      </Text>
                    </LinearGradient>
                  </View>
                </View>

                <View style={styles.infoBox}>
                  <View style={styles.infoBoxIcon}>
                    <Text style={styles.infoBoxEmoji}>💡</Text>
                  </View>
                  <Text style={styles.infoBoxText}>
                    The community cache allows instant lookups for known users.
                    Enable cloud contribution to help grow the database!
                  </Text>
                </View>
              </View>
            </View>

            {/* Features Section */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>FEATURES</Text>
              <View style={styles.card}>
                <View style={styles.featureRow}>
                  <Text style={styles.featureEmoji}>🏳️</Text>
                  <View style={styles.featureContent}>
                    <Text style={styles.featureTitle}>Country Flags</Text>
                    <Text style={styles.featureDescription}>
                      Real location data from X's official API
                    </Text>
                  </View>
                </View>
                <View style={styles.featureDivider} />
                <View style={styles.featureRow}>
                  <Text style={styles.featureEmoji}>📱</Text>
                  <View style={styles.featureContent}>
                    <Text style={styles.featureTitle}>Device Detection</Text>
                    <Text style={styles.featureDescription}>
                      Mobile or Web at a glance
                    </Text>
                  </View>
                </View>
                <View style={styles.featureDivider} />
                <View style={styles.featureRow}>
                  <Text style={styles.featureEmoji}>🔒</Text>
                  <View style={styles.featureContent}>
                    <Text style={styles.featureTitle}>VPN Indicator</Text>
                    <Text style={styles.featureDescription}>
                      Know when location might not be accurate
                    </Text>
                  </View>
                </View>
                <View style={styles.featureDivider} />
                <View style={styles.featureRow}>
                  <Text style={styles.featureEmoji}>☁️</Text>
                  <View style={styles.featureContent}>
                    <Text style={styles.featureTitle}>Community Cache</Text>
                    <Text style={styles.featureDescription}>
                      Instant lookups, privacy-first
                    </Text>
                  </View>
                </View>
              </View>
            </View>

            {/* Privacy Section */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>PRIVACY</Text>
              <View style={styles.card}>
                <View style={styles.privacyGrid}>
                  <View style={styles.privacyItem}>
                    <LinearGradient
                      colors={[
                        "rgba(0, 255, 179, 0.1)",
                        "rgba(0, 255, 179, 0.05)",
                      ]}
                      style={styles.privacyItemGradient}
                    >
                      <Text style={styles.privacyEmoji}>✅</Text>
                      <Text style={styles.privacyText}>Local Storage</Text>
                    </LinearGradient>
                  </View>
                  <View style={styles.privacyItem}>
                    <LinearGradient
                      colors={[
                        "rgba(0, 255, 179, 0.1)",
                        "rgba(0, 255, 179, 0.05)",
                      ]}
                      style={styles.privacyItemGradient}
                    >
                      <Text style={styles.privacyEmoji}>✅</Text>
                      <Text style={styles.privacyText}>No Tracking</Text>
                    </LinearGradient>
                  </View>
                  <View style={styles.privacyItem}>
                    <LinearGradient
                      colors={[
                        "rgba(0, 255, 179, 0.1)",
                        "rgba(0, 255, 179, 0.05)",
                      ]}
                      style={styles.privacyItemGradient}
                    >
                      <Text style={styles.privacyEmoji}>✅</Text>
                      <Text style={styles.privacyText}>No IP Logging</Text>
                    </LinearGradient>
                  </View>
                  <View style={styles.privacyItem}>
                    <LinearGradient
                      colors={[
                        "rgba(0, 255, 179, 0.1)",
                        "rgba(0, 255, 179, 0.05)",
                      ]}
                      style={styles.privacyItemGradient}
                    >
                      <Text style={styles.privacyEmoji}>✅</Text>
                      <Text style={styles.privacyText}>Open Source</Text>
                    </LinearGradient>
                  </View>
                </View>
              </View>
            </View>

            {/* About Section */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>ABOUT</Text>
              <View style={styles.card}>
                {/* App Header */}
                <View style={styles.aboutHeader}>
                  <View style={styles.aboutIconContainer}>
                    <Text style={styles.aboutIcon}>🌍</Text>
                  </View>
                  <View style={styles.aboutHeaderText}>
                    <Text style={styles.aboutAppName}>X-Posed</Text>
                    <Text style={styles.aboutTagline}>
                      Know who you're talking to.
                    </Text>
                  </View>
                </View>

                <View style={styles.aboutDivider} />

                {/* Version Info */}
                <View style={styles.aboutRow}>
                  <Text style={styles.aboutLabel}>Version</Text>
                  <View style={styles.versionBadge}>
                    <Text style={styles.versionText}>1.1.0</Text>
                  </View>
                </View>
                <View style={styles.aboutDivider} />

                {/* Author Info */}
                <View style={styles.authorSection}>
                  <Text style={styles.authorLabel}>Created by</Text>
                  <View style={styles.authorInfo}>
                    <Text style={styles.authorName}>Alexander Hagenah</Text>
                    <View style={styles.authorLinks}>
                      <View style={styles.authorLink}>
                        <Text style={styles.authorLinkIcon}>𝕏</Text>
                        <TouchableOpacity
                          onPress={() =>
                            Linking.openURL("https://x.com/xaitax")
                          }
                        >
                          <Text style={styles.authorLinkText}>@xaitax</Text>
                        </TouchableOpacity>
                      </View>
                      <View style={styles.authorLink}>
                        <Text style={styles.authorLinkIcon}>🔗</Text>
                        <TouchableOpacity
                          onPress={() =>
                            Linking.openURL("https://primepage.de")
                          }
                        >
                          <Text style={styles.authorLinkText}>
                            primepage.de
                          </Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  </View>
                </View>

                <View style={styles.aboutDivider} />

                {/* Support */}
                <View style={styles.supportSection}>
                  <Text style={styles.supportText}>
                    ☕ Support this project
                  </Text>
                  <View style={styles.supportBadge}>
                    <TouchableOpacity
                      onPress={() =>
                        Linking.openURL("https://ko-fi.com/xaitax")
                      }
                    >
                      <Text style={styles.supportBadgeText}>
                        ko-fi.com/xaitax
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            </View>

            <View style={styles.bottomPadding} />
          </ScrollView>
        </BlurView>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0, 0, 0, 0.6)",
  },
  backdropTouch: {
    flex: 1,
  },
  sheet: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: SHEET_HEIGHT,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: "hidden",
  },
  blurView: {
    flex: 1,
    backgroundColor: "rgba(20, 25, 35, 0.95)",
  },
  handleContainer: {
    alignItems: "center",
    paddingVertical: 12,
  },
  handle: {
    width: 36,
    height: 5,
    backgroundColor: "rgba(255, 255, 255, 0.3)",
    borderRadius: 3,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255, 255, 255, 0.08)",
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: colors.text,
  },
  closeButton: {
    padding: 4,
  },
  closeButtonInner: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(255, 255, 255, 0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.textMuted,
    letterSpacing: 1,
    marginBottom: 12,
    marginLeft: 4,
  },
  card: {
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
  },
  cardRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  cardRowLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flex: 1,
  },
  cardRowTextContainer: {
    flex: 1,
  },
  iconContainer: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  iconText: {
    fontSize: 22,
    fontWeight: "900",
    color: colors.text,
  },
  iconEmoji: {
    fontSize: 22,
  },
  cardRowTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.text,
    marginBottom: 2,
  },
  cardRowSubtitle: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  statusBadgeActive: {
    backgroundColor: "rgba(0, 255, 179, 0.15)",
  },
  statusBadgeInactive: {
    backgroundColor: "rgba(255, 255, 255, 0.1)",
  },
  statusBadgeText: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  statusBadgeTextActive: {
    color: colors.success,
  },
  statusBadgeTextInactive: {
    color: colors.textMuted,
  },
  actionButton: {
    marginTop: 16,
    borderRadius: 12,
    overflow: "hidden",
  },
  actionButtonPrimary: {},
  actionButtonDanger: {},
  actionButtonGradient: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 20,
  },
  actionButtonText: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.text,
  },
  actionButtonTextDanger: {
    color: colors.error,
  },
  statsGrid: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: "rgba(255, 255, 255, 0.08)",
  },
  statItem: {
    alignItems: "center",
    flex: 1,
  },
  statValue: {
    fontSize: 22,
    fontWeight: "700",
    color: colors.primary,
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 11,
    color: colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  statDivider: {
    width: 1,
    height: 36,
    backgroundColor: "rgba(255, 255, 255, 0.1)",
  },
  dashboardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  refreshButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    alignItems: "center",
    justifyContent: "center",
  },
  dashboardGrid: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 16,
  },
  dashboardCard: {
    flex: 1,
    borderRadius: 12,
    overflow: "hidden",
  },
  dashboardCardGradient: {
    alignItems: "center",
    paddingVertical: 20,
    paddingHorizontal: 12,
  },
  dashboardCardEmoji: {
    fontSize: 28,
    marginBottom: 8,
  },
  dashboardCardValue: {
    fontSize: 20,
    fontWeight: "700",
    color: colors.text,
    marginBottom: 4,
  },
  dashboardCardLabel: {
    fontSize: 11,
    color: colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  infoBox: {
    flexDirection: "row",
    backgroundColor: "rgba(0, 212, 255, 0.08)",
    borderRadius: 12,
    padding: 14,
    gap: 12,
    borderWidth: 1,
    borderColor: "rgba(0, 212, 255, 0.15)",
  },
  infoBoxIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: "rgba(0, 212, 255, 0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  infoBoxEmoji: {
    fontSize: 16,
  },
  infoBoxText: {
    flex: 1,
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  // Features section
  featureRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: 14,
    gap: 14,
  },
  featureEmoji: {
    fontSize: 24,
    width: 32,
    textAlign: "center",
  },
  featureContent: {
    flex: 1,
  },
  featureTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.text,
    marginBottom: 2,
  },
  featureDescription: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  featureDivider: {
    height: 1,
    backgroundColor: "rgba(255, 255, 255, 0.06)",
  },
  // Privacy section
  privacyGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginHorizontal: -4,
  },
  privacyItem: {
    width: "50%",
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  privacyItemGradient: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 10,
    gap: 8,
  },
  privacyEmoji: {
    fontSize: 14,
  },
  privacyText: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.text,
  },
  // About section
  aboutHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 16,
    gap: 14,
  },
  aboutIconContainer: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: "rgba(0, 212, 255, 0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  aboutIcon: {
    fontSize: 28,
  },
  aboutHeaderText: {
    flex: 1,
  },
  aboutAppName: {
    fontSize: 22,
    fontWeight: "800",
    color: colors.text,
    marginBottom: 2,
  },
  aboutTagline: {
    fontSize: 14,
    color: colors.textSecondary,
    fontStyle: "italic",
  },
  aboutRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
  },
  aboutDivider: {
    height: 1,
    backgroundColor: "rgba(255, 255, 255, 0.06)",
  },
  aboutLabel: {
    fontSize: 15,
    color: colors.text,
  },
  aboutValue: {
    fontSize: 15,
    color: colors.textSecondary,
  },
  versionBadge: {
    backgroundColor: "rgba(0, 212, 255, 0.15)",
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 8,
  },
  versionText: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.primary,
  },
  authorSection: {
    paddingVertical: 14,
  },
  authorLabel: {
    fontSize: 12,
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  authorInfo: {
    gap: 6,
  },
  authorName: {
    fontSize: 17,
    fontWeight: "600",
    color: colors.text,
    marginBottom: 4,
  },
  authorLinks: {
    flexDirection: "row",
    gap: 16,
  },
  authorLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  authorLinkIcon: {
    fontSize: 14,
    color: colors.primary,
  },
  authorLinkText: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  supportSection: {
    paddingVertical: 14,
    alignItems: "center",
    gap: 10,
  },
  supportText: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  supportBadge: {
    backgroundColor: "rgba(255, 107, 107, 0.15)",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  supportBadgeText: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.error,
  },
  bottomPadding: {
    height: 40,
  },
  // Username input section
  usernameSection: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: "rgba(255, 255, 255, 0.08)",
  },
  usernameInputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  usernameInputWrapper: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    borderRadius: 10,
    paddingHorizontal: 12,
  },
  usernameAtSymbol: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.primary,
    marginRight: 4,
  },
  usernameInput: {
    flex: 1,
    fontSize: 15,
    color: colors.text,
    paddingVertical: 10,
  },
  usernameSubmitButton: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  usernameCancelButton: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    alignItems: "center",
    justifyContent: "center",
  },
  setUsernameButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    backgroundColor: "rgba(0, 212, 255, 0.1)",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(0, 212, 255, 0.2)",
  },
  setUsernameText: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.primary,
  },
  usernameHint: {
    fontSize: 11,
    color: colors.textMuted,
    textAlign: "center",
    marginTop: 8,
  },
});

export default SettingsSheet;
