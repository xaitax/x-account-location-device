/**
 * X-Posed Mobile App - Login Screen
 * WebView-based X authentication with cookie capture
 *
 * Note: auth_token is HttpOnly, so in Expo Go we verify login by checking
 * if the user reaches the home page and can extract ct0 from document.cookie.
 * The auth_token will be automatically used by subsequent fetch requests.
 */

import React, { useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { WebView, WebViewNavigation } from 'react-native-webview';
import { LinearGradient } from 'expo-linear-gradient';
import { colors } from '@/styles/commonStyles';
import { IconSymbol } from '@/components/IconSymbol';
import { useRouter } from 'expo-router';

interface LoginScreenProps {
  onLoginSuccess: (authToken: string, csrfToken: string, username?: string) => void;
  onClose?: () => void;
}

// Script to detect successful login by monitoring URL changes and extracting username
const LOGIN_DETECTION_SCRIPT = `
(function() {
  let usernameFoundAndSent = false;
  
  // Extract user ID from twid cookie
  function extractUserIdFromCookie() {
    try {
      const cookies = document.cookie;
      const twidMatch = cookies.match(/twid=u%3[AD]([0-9]+)/i);
      if (twidMatch && twidMatch[1]) {
        return twidMatch[1];
      }
      // Try decoded version
      const twidMatch2 = cookies.match(/twid=u:([0-9]+)/i);
      if (twidMatch2 && twidMatch2[1]) {
        return twidMatch2[1];
      }
      return null;
    } catch (e) {
      return null;
    }
  }
  
  // Extract username from login flow URL (base64 encoded in input_flow_data)
  function extractUsernameFromLoginUrl() {
    try {
      const url = window.location.href;
      const match = url.match(/input_flow_data=([^&]+)/);
      if (match && match[1]) {
        const flowDataStr = decodeURIComponent(match[1]);
        const flowData = JSON.parse(flowDataStr);
        if (flowData.requested_variant) {
          // The variant is base64 encoded JSON
          const decoded = atob(flowData.requested_variant);
          const variantData = JSON.parse(decoded);
          if (variantData.user_identifier) {
            return variantData.user_identifier;
          }
        }
      }
      return null;
    } catch (e) {
      return null;
    }
  }
  
  // Extract username from page DOM - more aggressive approach for mobile web view
  function extractUsernameFromDOM() {
    try {
      // Excluded pages/routes that are NOT usernames
      const excluded = ['home', 'explore', 'search', 'notifications', 'messages', 'i', 'settings', 'compose', 'login', 'logout', 'tos', 'privacy'];
      
      // Method 1: Profile link in sidebar nav (desktop)
          const profileLink = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]');
          if (profileLink && profileLink.href) {
            const match = profileLink.href.match(/\\.com\\/([a-zA-Z0-9_]{1,15})(?:[?\\/]|$)/);
            if (match && match[1] && !excluded.includes(match[1].toLowerCase())) {
              return match[1];
            }
          }
          
          // Method 2: Account switcher (desktop)
          const accountSwitcher = document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]');
          if (accountSwitcher) {
            const text = accountSwitcher.innerText || accountSwitcher.textContent;
            const usernameMatch = text?.match(/@([a-zA-Z0-9_]{1,15})/);
            if (usernameMatch && usernameMatch[1]) {
              return usernameMatch[1];
            }
          }
          
          // Method 3: Mobile bottom navigation - profile icon/link
          const bottomNav = document.querySelector('[role="tablist"]');
          if (bottomNav) {
            const links = bottomNav.querySelectorAll('a[href^="/"]');
            for (const link of links) {
              const href = link.getAttribute('href');
              if (href) {
                const match = href.match(/^\\/([a-zA-Z0-9_]{1,15})$/);
                if (match && match[1] && !excluded.includes(match[1].toLowerCase())) {
                  return match[1];
                }
              }
            }
          }
          
          // Method 4: Look for @username pattern in any visible text
          const bodyText = document.body?.innerText || '';
          // Find @username at the start of a line or after whitespace
          const userMatches = bodyText.match(/(?:^|\\s)@([a-zA-Z0-9_]{1,15})\\b/g);
          if (userMatches && userMatches.length > 0) {
            // Filter and take the first valid one
            for (const match of userMatches) {
              const username = match.trim().substring(1); // Remove @ and trim
              if (username && !excluded.includes(username.toLowerCase())) {
                return username;
              }
            }
          }
          
          // Method 5: Look for any profile-related links
          const allProfileLinks = document.querySelectorAll('a[href^="/"][aria-label*="rofile"], a[href^="/"][aria-label*="ccount"]');
          for (const link of allProfileLinks) {
            const href = link.getAttribute('href');
            if (href) {
              const match = href.match(/^\\/([a-zA-Z0-9_]{1,15})$/);
              if (match && match[1] && !excluded.includes(match[1].toLowerCase())) {
                return match[1];
              }
            }
          }
          
          // Method 6: Find profile link by looking at all links with valid username patterns
          const allLinks = document.querySelectorAll('a[href^="/"]');
          for (const link of allLinks) {
            const href = link.getAttribute('href');
            if (href && href.match(/^\\/[a-zA-Z0-9_]{1,15}$/)) {
              const username = href.substring(1);
              if (!excluded.includes(username.toLowerCase())) {
                // Check context - profile links often have a profile image nearby
                if (link.querySelector('img[src*="profile"]') || link.querySelector('img[src*="pbs.twimg"]')) {
                  return username;
                }
                // Also check parent for profile-related classes
                const parent = link.closest('[data-testid]');
                if (parent) {
                  const testid = parent.getAttribute('data-testid') || '';
                  if (testid.toLowerCase().includes('profile') || testid.toLowerCase().includes('account') || testid.toLowerCase().includes('sidenav') || testid.toLowerCase().includes('user')) {
                    return username;
                  }
                }
              }
            }
          }
          
          // Method 7: Look in local storage (X sometimes stores user info there)
          try {
            const lsKeys = Object.keys(localStorage);
            for (const key of lsKeys) {
              if (key.includes('user') || key.includes('account')) {
                const value = localStorage.getItem(key);
                if (value) {
                  const usernameMatch = value.match(/"screen_name":"([^"]+)"/);
                  if (usernameMatch && usernameMatch[1]) {
                    return usernameMatch[1];
                  }
                }
              }
            }
          } catch (e) {}
      
      return null;
    } catch (e) {
      return null;
    }
  }
  
  // Send current URL and any accessible cookies
  function sendLoginStatus(forceUsername) {
    try {
      // First try to get username from URL, then from DOM
      let username = forceUsername || extractUsernameFromLoginUrl() || extractUsernameFromDOM();
      const userId = extractUserIdFromCookie();
      
      // Track if we've found and sent the username
      if (username && !usernameFoundAndSent) {
        usernameFoundAndSent = true;
      }
      
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'LOGIN_STATUS',
        url: window.location.href,
        cookies: document.cookie,
        username: username,
        userId: userId
      }));
    } catch (e) {
      // Silent fail
    }
  }
  
  // Delayed check with multiple retries for DOM extraction
  function checkForUsernameWithRetry(attempt) {
    if (usernameFoundAndSent || attempt > 10) return;
    
    const username = extractUsernameFromDOM();
    if (username) {
      sendLoginStatus(username);
    } else {
      // Retry with exponential backoff
      setTimeout(() => checkForUsernameWithRetry(attempt + 1), 500 * attempt);
    }
  }
  
  // Check on load
  sendLoginStatus();
  
  // If we're on the home page, start aggressive username search
  if (window.location.href.includes('/home') || window.location.pathname === '/') {
    // Wait for page to load, then check with retries
    setTimeout(() => checkForUsernameWithRetry(1), 1000);
  }
  
  // Monitor for navigation changes (SPA navigation)
  let lastUrl = window.location.href;
  setInterval(() => {
    const currentUrl = window.location.href;
    if (currentUrl !== lastUrl) {
      lastUrl = currentUrl;
      sendLoginStatus();
      
      // If we just navigated to home, start aggressive username search
      if ((currentUrl.includes('/home') || currentUrl.endsWith('x.com/')) && !usernameFoundAndSent) {
        setTimeout(() => checkForUsernameWithRetry(1), 1000);
      }
    }
  }, 1000);
  
  // Periodically check if we haven't found username yet
  const periodicCheck = setInterval(() => {
    if (usernameFoundAndSent) {
      clearInterval(periodicCheck);
      return;
    }
    sendLoginStatus();
  }, 2000);
  
  true;
})();
`;

export function LoginScreen({ onLoginSuccess, onClose }: LoginScreenProps) {
  const webViewRef = useRef<WebView>(null);
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [currentUrl, setCurrentUrl] = useState('');
  const [loginProgress, setLoginProgress] = useState<'initial' | 'loading' | 'entering_creds' | 'verifying' | 'success'>('initial');
  const hasCapturedRef = useRef(false);

  // Store captured username and userId
  const capturedUsernameRef = useRef<string | null>(null);
  const capturedUserIdRef = useRef<string | null>(null);

  /**
   * Handle successful login - extract ct0 and use a placeholder for auth_token
   * since auth_token is HttpOnly and inaccessible via JavaScript.
   * The native WebView cookie store will automatically send auth_token with requests.
   */
  const handleLoginComplete = useCallback(async (ct0Cookie: string, username?: string, userId?: string) => {
    if (hasCapturedRef.current) return;
    
    hasCapturedRef.current = true;
    setLoginProgress('success');
    
    // Store username if we got it
    if (username) {
      capturedUsernameRef.current = username;
    }
    if (userId) {
      capturedUserIdRef.current = userId;
    }
    
    const finalUsername = username || capturedUsernameRef.current;
    
    // Login successful
    
    // Use a special marker for auth_token since it's HttpOnly
    const authTokenMarker = 'HTTPONLY_IN_WEBVIEW_COOKIE_STORE';
    
    // Short delay to show success state, then finalize
    setTimeout(() => {
      onLoginSuccess(authTokenMarker, ct0Cookie, finalUsername || undefined);
    }, 1000);
  }, [onLoginSuccess]);

  /**
   * Handle messages from WebView
   */
  const handleMessage = useCallback((event: { nativeEvent: { data: string } }) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      
      if (data.type === 'LOGIN_STATUS') {
        // Store username if found (even if we haven't completed login yet)
        // This now captures from the login URL where X stores it as base64 JSON
        if (data.username && !capturedUsernameRef.current) {
          capturedUsernameRef.current = data.username;
        }
        
        // Store userId if found (even if we haven't completed login yet)
        if (data.userId && !capturedUserIdRef.current) {
          capturedUserIdRef.current = data.userId;
        }
        
        // Check if we've reached the home page (successful login)
        if (data.url.includes('/home') || data.url === 'https://x.com/' || data.url === 'https://twitter.com/') {
          // Extract ct0 (CSRF token) from document.cookie - it's NOT HttpOnly
          const cookies = data.cookies || '';
          const ct0Match = cookies.match(/ct0=([^;]+)/);
          
          if (ct0Match && ct0Match[1]) {
            const currentUsername = data.username || capturedUsernameRef.current;
            const currentUserId = data.userId || capturedUserIdRef.current;
            
            // If we have username, complete immediately
            if (currentUsername) {
              handleLoginComplete(ct0Match[1], currentUsername, currentUserId);
            } else {
              // No username yet - wait longer for DOM extraction
              // Set a timeout to complete login after 6 seconds even without username
              setTimeout(() => {
                if (!hasCapturedRef.current) {
                  // Check one more time if we captured the username
                  const finalUsername = capturedUsernameRef.current;
                  handleLoginComplete(ct0Match[1], finalUsername || undefined, currentUserId);
                }
              }, 6000);
            }
          } else {
            // Try again in a moment - the cookie might be set asynchronously
            setTimeout(() => {
              webViewRef.current?.injectJavaScript(`
                (function() {
                  window.ReactNativeWebView.postMessage(JSON.stringify({
                    type: 'LOGIN_STATUS',
                    url: window.location.href,
                    cookies: document.cookie
                  }));
                })();
                true;
              `);
            }, 1000);
          }
        }
      }
    } catch (error) {
      // Silent fail for message parsing
    }
  }, [handleLoginComplete]);

  /**
   * Handle navigation state changes
   */
  const handleNavigationStateChange = useCallback((navState: WebViewNavigation) => {
    setCurrentUrl(navState.url);
    
    // Update progress based on URL
    if (navState.url.includes('/login')) {
      setLoginProgress('entering_creds');
    } else if (navState.url.includes('/i/flow/') || navState.url.includes('/oauth')) {
      setLoginProgress('verifying');
    } else if (navState.url === 'https://x.com/home' || navState.url === 'https://twitter.com/home') {
      // Reached home - likely logged in
      setLoginProgress('success');
    }
  }, []);

  /**
   * Handle close button press
   */
  const handleClose = useCallback(() => {
    if (onClose) {
      onClose();
    } else {
      router.back();
    }
  }, [onClose, router]);

  /**
   * Get progress indicator text
   */
  const getProgressText = () => {
    switch (loginProgress) {
      case 'loading': return 'Loading X...';
      case 'entering_creds': return 'Enter your credentials';
      case 'verifying': return 'Verifying...';
      case 'success': return '✓ Login successful!';
      default: return 'Log in to X';
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.closeButton} onPress={handleClose}>
          <IconSymbol
            ios_icon_name="xmark"
            android_material_icon_name="close"
            size={24}
            color={colors.text}
          />
        </TouchableOpacity>
        
        <View style={styles.headerCenter}>
          <View style={styles.xLogo}>
            <Text style={styles.xLogoText}>𝕏</Text>
          </View>
          <Text style={styles.headerTitle}>{getProgressText()}</Text>
        </View>
        
        <View style={styles.headerRight}>
          {isLoading && <ActivityIndicator size="small" color={colors.primary} />}
        </View>
      </View>

      {/* Progress indicator */}
      {loginProgress === 'success' && (
        <LinearGradient
          colors={[colors.secondary + '20', 'transparent']}
          style={styles.successBanner}
        >
          <IconSymbol
            ios_icon_name="checkmark.circle.fill"
            android_material_icon_name="check-circle"
            size={20}
            color={colors.secondary}
          />
          <Text style={styles.successText}>Authentication successful!</Text>
        </LinearGradient>
      )}

      {/* WebView */}
      <View style={styles.webViewContainer}>
        <WebView
          ref={webViewRef}
          source={{ uri: 'https://x.com/i/flow/login' }}
          style={styles.webView}
          onLoadStart={() => setIsLoading(true)}
          onLoadEnd={() => {
            setIsLoading(false);
            setLoginProgress('entering_creds');
          }}
          onNavigationStateChange={handleNavigationStateChange}
          onMessage={handleMessage}
          injectedJavaScript={LOGIN_DETECTION_SCRIPT}
          javaScriptEnabled={true}
          domStorageEnabled={true}
          thirdPartyCookiesEnabled={true}
          sharedCookiesEnabled={true}
          cacheEnabled={true}
          startInLoadingState={true}
          renderLoading={() => (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={colors.primary} />
              <Text style={styles.loadingText}>Loading X...</Text>
            </View>
          )}
          // Allow all certificates in dev (for debugging)
          originWhitelist={['*']}
          // User agent to ensure proper rendering
          userAgent={Platform.select({
            ios: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
            android: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36',
          })}
        />
      </View>

      {/* Footer notice */}
      <View style={styles.footer}>
        <IconSymbol
          ios_icon_name="lock.fill"
          android_material_icon_name="lock"
          size={14}
          color={colors.textMuted}
        />
        <Text style={styles.footerText}>
          Your credentials are sent directly to X. We only store session cookies locally.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  xLogo: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.text,
    alignItems: 'center',
    justifyContent: 'center',
  },
  xLogoText: {
    fontSize: 16,
    fontWeight: '900',
    color: colors.background,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  headerRight: {
    width: 40,
    alignItems: 'center',
  },
  successBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    gap: 8,
  },
  successText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.secondary,
  },
  webViewContainer: {
    flex: 1,
    backgroundColor: colors.background,
  },
  webView: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  loadingContainer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  loadingText: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.1)',
  },
  footerText: {
    fontSize: 11,
    color: colors.textMuted,
    textAlign: 'center',
    flex: 1,
  },
});

export default LoginScreen;
