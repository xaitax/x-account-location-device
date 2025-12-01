/** @type {import('@bacons/apple-targets').Config} */
module.exports = {
  type: "widget",
  name: "X-Posed Widget",
  bundleIdentifier: ".widget",
  deploymentTarget: "17.0",
  entitlements: {
    "com.apple.security.application-groups": ["group.com.xposed.mobile.shared"],
  },
  frameworks: ["SwiftUI", "WidgetKit"],
};