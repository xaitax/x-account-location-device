# X-Posed Mobile App - Development Guide

A complete reference for developing, building, and deploying the X-Posed iOS app.

---

## 📋 Table of Contents

1. [Quick Reference Commands](#-quick-reference-commands)
2. [Development Workflow](#-development-workflow)
3. [Building for Production](#-building-for-production)
4. [App Store Submission](#-app-store-submission)
5. [Version Management](#-version-management)
6. [Troubleshooting](#-troubleshooting)

---

## 🚀 Quick Reference Commands

```bash
# ============================================
# DEVELOPMENT
# ============================================

# Start development server (Expo Go on iPhone)
pnpm start                  # Main command you use

# Alternative start commands
pnpm dev                    # Same as above with tunnel
npx expo start              # Direct expo command

# Run on specific platform
pnpm ios                    # iOS Simulator (requires Mac)
pnpm web                    # Web browser

# ============================================
# BUILDING
# ============================================

# Build for iOS App Store
eas build --platform ios --profile production

# Build and auto-submit to App Store
eas build --platform ios --profile production --auto-submit

# Build for internal testing (TestFlight)
eas build --platform ios --profile preview

# ============================================
# SUBMITTING
# ============================================

# Submit latest build to App Store
eas submit --platform ios

# Submit specific build
eas submit --platform ios --id BUILD_ID

# ============================================
# OTHER USEFUL COMMANDS
# ============================================

# Check build status
eas build:list

# View credentials
eas credentials

# Update EAS configuration
eas build:configure

# Clear cache and reinstall
rm -rf node_modules && pnpm install

# Clear Metro bundler cache
npx expo start --clear
```

---

## 💻 Development Workflow

### 1. Start Development Server

```bash
cd x-pose-mobile-app-hggsal
pnpm start
```

This starts the Expo dev server. Scan the QR code with Expo Go on your iPhone.

### 2. Test on Physical Device

1. Install **Expo Go** from App Store
2. Scan the QR code shown in terminal
3. App loads on your phone

### 3. Hot Reload

- Save any file → App automatically refreshes
- Press `r` in terminal → Force reload
- Shake device → Open Expo developer menu

### 4. Debug Mode

- Console logs appear in terminal
- Press `j` in terminal → Open Chrome DevTools
- Use `console.log()` statements for debugging

---

## 🔨 Building for Production

### Prerequisites

1. **EAS CLI installed:**
   ```bash
   npm install -g eas-cli
   ```

2. **Logged into EAS:**
   ```bash
   eas login
   ```

3. **Apple Developer account linked:**
   ```bash
   eas credentials
   ```

### Build Commands

#### iOS Production Build
```bash
eas build --platform ios --profile production
```

This will:
- Build the app in the cloud (~15-30 min)
- Generate/use Apple certificates automatically
- Output: `.ipa` file download link

#### iOS Test Build (Internal Distribution)
```bash
eas build --platform ios --profile preview
```
For TestFlight or internal testing without App Store review.

---

## 📱 App Store Submission

### Method 1: EAS Submit (Recommended)

After building, submit directly:
```bash
eas submit --platform ios
```

This automatically uploads your latest build to App Store Connect.

### Method 2: One-Command Build + Submit

```bash
eas build --platform ios --profile production --auto-submit
```

### Method 3: Manual Upload

1. Download `.ipa` from build link
2. Use **Transporter** app on Mac
3. Drag & drop → Click "Deliver"

### After Submission

1. Go to [App Store Connect](https://appstoreconnect.apple.com)
2. Select your app → Version
3. Complete all required fields
4. Click **Submit for Review**

---

## 🔢 Version Management

### Version Numbers

Edit `app.json`:
```json
{
  "expo": {
    "version": "1.0.0",        // User-facing version
    "ios": {
      "buildNumber": "1"       // Auto-incremented by EAS
    }
  }
}
```

### Auto-Increment

EAS automatically increments `buildNumber` with each build.

Configured in `eas.json`:
```json
{
  "build": {
    "production": {
      "autoIncrement": true
    }
  },
  "cli": {
    "appVersionSource": "remote"
  }
}
```

### Manual Version Bump

When releasing a new user-facing version:

1. Update `app.json`:
   ```json
   "version": "1.1.0"
   ```

2. Build normally - buildNumber auto-increments

---

## 🐛 Troubleshooting

### Common Issues

#### "Invalid UUID appId"
```bash
# Remove old projectId and reinitialize
# Edit app.json - remove "extra.eas.projectId"
eas init
```

#### Build Fails
```bash
# Check build logs
eas build:list

# Clear cache and rebuild
rm -rf node_modules
pnpm install
eas build --platform ios --profile production --clear-cache
```

#### Metro Bundler Issues
```bash
# Clear Metro cache
npx expo start --clear

# Or delete cache directly
rm -rf node_modules/.cache
```

#### Credentials Issues
```bash
# Re-sync credentials
eas credentials
# Follow prompts to fix/regenerate certificates
```

#### "Module not found" errors
```bash
# Reinstall dependencies
rm -rf node_modules
pnpm install
```

### Useful Debug Commands

```bash
# Check EAS project status
eas project:info

# View all builds
eas build:list

# View credentials
eas credentials

# Check Expo Doctor
npx expo-doctor
```

---

## 📁 Project Structure

```
x-pose-mobile-app-hggsal/
├── app/                    # Expo Router pages
│   ├── _layout.tsx        # Root layout
│   └── (tabs)/            # Tab navigation
│       └── (home)/        # Home screen
│           └── index.ios.tsx  # iOS main screen
├── src/
│   ├── components/        # UI Components
│   │   ├── ResultCard.tsx
│   │   ├── HistoryCard.tsx
│   │   ├── EvidenceCard.tsx
│   │   └── SettingsSheet.tsx
│   ├── services/          # API & Data Services
│   │   ├── CacheAPI.ts
│   │   ├── XGraphQLAPI.ts
│   │   ├── NetworkManager.ts
│   │   ├── CloudCache.ts
│   │   └── ProfileImageCache.ts
│   ├── hooks/             # Custom React Hooks
│   │   ├── useAuth.ts
│   │   ├── useHistory.ts
│   │   └── useCloudCache.ts
│   ├── screens/           # Screen Components
│   │   └── LoginScreen.tsx
│   ├── utils/             # Utilities
│   │   └── countryFlags.ts
│   └── types/             # TypeScript Types
│       └── index.ts
├── assets/                # Images & Fonts
├── contexts/             # React Contexts
├── styles/               # Shared Styles
├── app.json              # Expo Configuration
├── eas.json              # EAS Build Configuration
└── package.json          # Dependencies
```

---

## 🔗 Important Links

| Resource | URL |
|----------|-----|
| Expo Dashboard | https://expo.dev/@xaitax |
| App Store Connect | https://appstoreconnect.apple.com |
| EAS Build Docs | https://docs.expo.dev/build/introduction |
| EAS Submit Docs | https://docs.expo.dev/submit/introduction |
| Expo Status | https://status.expo.dev |

---

## 📝 Checklist: New Version Release

- [ ] Update `version` in `app.json` if major/minor release
- [ ] Test locally with `pnpm start`
- [ ] Run `eas build --platform ios --profile production`
- [ ] Wait for build to complete (~15-30 min)
- [ ] Run `eas submit --platform ios`
- [ ] Go to App Store Connect → Complete version info
- [ ] Add "What's New" release notes
- [ ] Submit for Review

---

## ☕ Support

Created by Alexander Hagenah
- X: [@xaitax](https://x.com/xaitax)
- Website: [primepage.de](https://primepage.de)
- Ko-fi: [ko-fi.com/xaitax](https://ko-fi.com/xaitax)