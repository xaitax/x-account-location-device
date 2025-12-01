import "react-native-reanimated";
import React, { useEffect, useCallback } from "react";
import { useFonts } from "expo-font";
import { Stack, router, useRootNavigationState } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { SystemBars } from "react-native-edge-to-edge";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { useColorScheme, Alert, Platform } from "react-native";
import { useNetworkState } from "expo-network";
import * as Linking from "expo-linking";
import {
  DarkTheme,
  DefaultTheme,
  Theme,
  ThemeProvider,
} from "@react-navigation/native";
import { StatusBar } from "expo-status-bar";
import { DeepLinkProvider } from "@/contexts/DeepLinkContext";

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

export const unstable_settings = {
  initialRouteName: "(tabs)", // Ensure any route can link back to `/`
};

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const networkState = useNetworkState();
  const navigationState = useRootNavigationState();
  const [loaded] = useFonts({
    SpaceMono: require("../assets/fonts/SpaceMono-Regular.ttf"),
  });

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  // Handle deep links
  const handleDeepLink = useCallback((event: { url: string }) => {
    const url = event.url;
    console.log('[DeepLink] Received URL:', url);
    
    // Parse the URL
    // Supported formats:
    // - xposed://lookup/username
    // - X-Pose://lookup/username
    // - https://x.com/username
    // - https://twitter.com/username
    
    if (!url) return;
    
    try {
      let username: string | null = null;
      
      // Check for xposed:// scheme
      if (url.toLowerCase().startsWith('xposed://') || url.toLowerCase().startsWith('x-pose://')) {
        const path = url.split('://')[1];
        if (path.startsWith('lookup/')) {
          username = path.replace('lookup/', '').split('/')[0].split('?')[0];
        }
      }
      
      // Check for x.com or twitter.com URLs
      if (url.includes('x.com/') || url.includes('twitter.com/')) {
        const match = url.match(/(?:x|twitter)\.com\/([a-zA-Z0-9_]+)/);
        if (match && match[1] && !['home', 'explore', 'search', 'messages', 'notifications', 'i', 'settings'].includes(match[1].toLowerCase())) {
          username = match[1];
        }
      }
      
      if (username) {
        // Clean the username
        username = username.replace(/^@/, '').toLowerCase();
        if (/^[a-zA-Z0-9_]{1,15}$/.test(username)) {
          console.log('[DeepLink] Parsed username:', username);
          // Store in global context or navigate with params
          (global as { pendingLookupUsername?: string }).pendingLookupUsername = username;
        }
      }
    } catch (error) {
      console.error('[DeepLink] Error parsing URL:', error);
    }
  }, []);

  // Set up deep link listener
  useEffect(() => {
    // Handle initial URL (app opened via deep link)
    const getInitialURL = async () => {
      const url = await Linking.getInitialURL();
      if (url) {
        handleDeepLink({ url });
      }
    };
    
    if (loaded && navigationState?.key) {
      getInitialURL();
    }
    
    // Listen for deep links while app is running
    const subscription = Linking.addEventListener('url', handleDeepLink);
    
    return () => {
      subscription.remove();
    };
  }, [loaded, navigationState?.key, handleDeepLink]);

  React.useEffect(() => {
    if (
      !networkState.isConnected &&
      networkState.isInternetReachable === false
    ) {
      Alert.alert(
        "🔌 You are offline",
        "You can keep using the app! Your changes will be saved locally and synced when you are back online."
      );
    }
  }, [networkState.isConnected, networkState.isInternetReachable]);

  if (!loaded) {
    return null;
  }

  const CustomDefaultTheme: Theme = {
    ...DefaultTheme,
    dark: false,
    colors: {
      primary: "rgb(0, 122, 255)", // System Blue
      background: "rgb(242, 242, 247)", // Light mode background
      card: "rgb(255, 255, 255)", // White cards/surfaces
      text: "rgb(0, 0, 0)", // Black text for light mode
      border: "rgb(216, 216, 220)", // Light gray for separators/borders
      notification: "rgb(255, 59, 48)", // System Red
    },
  };

  const CustomDarkTheme: Theme = {
    ...DarkTheme,
    colors: {
      primary: "rgb(10, 132, 255)", // System Blue (Dark Mode)
      background: "rgb(1, 1, 1)", // True black background for OLED displays
      card: "rgb(28, 28, 30)", // Dark card/surface color
      text: "rgb(255, 255, 255)", // White text for dark mode
      border: "rgb(44, 44, 46)", // Dark gray for separators/borders
      notification: "rgb(255, 69, 58)", // System Red (Dark Mode)
    },
  };
  return (
    <>
      <StatusBar style="light" animated />
      <ThemeProvider
        value={colorScheme === "dark" ? CustomDarkTheme : CustomDefaultTheme}
      >
        <DeepLinkProvider>
          <GestureHandlerRootView>
            <Stack>
              {/* Main app with tabs */}
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            </Stack>
            <SystemBars style={"auto"} />
          </GestureHandlerRootView>
        </DeepLinkProvider>
      </ThemeProvider>
    </>
  );
}
