/**
 * iOS Share Extension Target Configuration
 * 
 * This extension appears in the iOS share sheet when users share content.
 * When a user shares an X/Twitter profile URL, it extracts the username
 * and opens the main app to perform a lookup.
 */

module.exports = {
  type: "share-extension",
  name: "X-Posed Lookup",
  bundleIdentifier: ".share-extension",
  deploymentTarget: "15.0",
  entitlements: {
    "com.apple.security.application-groups": ["group.com.xposed.mobile.shared"],
  },
};