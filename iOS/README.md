<div align="center">

# 📱 X-Posed Mobile

### Location & Device Intelligence for X

**See where X users are posting from — right from your phone.**

Built with React Native + Expo • TypeScript • Beautiful Dark UI

---

<img width="300" alt="X-Posed Mobile App Screenshot" src="./assets/images/app-preview.png" />

</div>

---

## ✨ Features

<table>
<tr>
<td width="50%">

### 🌍 Dual Lookup Modes

**Cache Mode** — Fast, anonymous lookups from community cloud cache. No login required.

**Live Mode** — Real-time data from X's GraphQL API. Works for ANY user, requires X login.

### 📍 Location Intelligence

See the real location X detects for any user, displayed with beautiful country flags.

</td>
<td width="50%">

### 📱 Device Detection

Know if users are on:
- 🍎 iOS (iPhone/iPad)
- 🤖 Android
- 🌐 Web browser

### 🔒 VPN/Proxy Detection

Instantly see if X detects the user is behind a VPN or proxy with connection accuracy badges.

</td>
</tr>
</table>

---

## 🚀 Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [pnpm](https://pnpm.io/) (recommended) or npm
- [Expo CLI](https://docs.expo.dev/get-started/installation/)

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/x-pose-mobile-app.git
cd x-pose-mobile-app

# Install dependencies
pnpm install

# Start the development server
pnpm dev
```

### Running on Device

1. Download **Expo Go** from App Store
2. Scan the QR code from the terminal
3. The app opens on your iPhone!

---

## 📚 Architecture

```
x-pose-mobile-app/
├── app/                      # Expo Router pages
│   ├── (tabs)/              # Tab navigation
│   │   └── (home)/          # Home tab
│   │       └── index.tsx    # Main screen
│   └── login.tsx            # Login modal
├── src/
│   ├── components/          # UI components
│   │   ├── ModeToggle.tsx   # Cache/Live mode switch
│   │   ├── LoginButton.tsx  # X authentication button
│   │   ├── ResultCard.tsx   # Location result display
│   │   └── HistoryCard.tsx  # Recent lookups
│   ├── services/            # API clients
│   │   ├── CacheAPI.ts      # Cloud cache queries
│   │   ├── XGraphQLAPI.ts   # Live X API queries
│   │   └── NetworkManager.ts # Request routing
│   ├── hooks/               # React hooks
│   │   ├── useAuth.ts       # Authentication state
│   │   └── useHistory.ts    # Lookup history
│   ├── screens/             # Full-screen views
│   │   └── LoginScreen.tsx  # WebView X login
│   ├── types/               # TypeScript definitions
│   └── utils/               # Helpers
│       └── countryFlags.ts  # 200+ country flag mappings
├── styles/
│   └── commonStyles.ts      # Theme & design tokens
└── components/              # Shared components
    └── IconSymbol.tsx       # Platform icons
```

---

## 🔧 Technical Details

### Dual-Mode System

| Mode | Speed | Coverage | Auth Required |
|------|-------|----------|---------------|
| **Cache** | ⚡ Fast (~50ms) | Limited to cached users | ❌ No |
| **Live** | 🔄 Moderate (~1s) | Any X user | ✅ Yes |

### API Endpoints

**Cloud Cache API:**
```
GET https://x-posed-cache.xaitax.workers.dev/lookup?users={username}
```

**X GraphQL API:**
```
GET https://x.com/i/api/graphql/.../AboutAccountQuery
Headers: authorization, x-csrf-token, cookie
```

### Authentication Flow

1. User taps "Log in to X"
2. WebView opens X's login page
3. App captures `auth_token` and `ct0` cookies
4. Cookies stored securely in AsyncStorage
5. Session persists for 7 days

### Cookie Capture

The app uses injected JavaScript in the WebView to capture authentication cookies:

```javascript
const cookies = document.cookie;
window.ReactNativeWebView.postMessage(JSON.stringify({
  type: 'COOKIES',
  cookies: cookies
}));
```

---

## 🎨 Design System

### Colors

| Token | Hex | Usage |
|-------|-----|-------|
| `background` | `#121212` | App background |
| `primary` | `#BB86FC` | Primary actions, highlights |
| `secondary` | `#03DAC5` | Success states, verified badges |
| `accent` | `#FF4081` | Live mode, logout |
| `error` | `#FF6B6B` | Error messages |
| `highlight` | `#FFD740` | VPN indicator |

### Typography

- **Title:** 24px, weight 800
- **Body:** 16px, weight 400
- **Caption:** 12px, weight 500

### Components

All components feature:
- Glassmorphic dark theme
- Smooth animations
- Platform-adaptive icons (SF Symbols / Material)
- Responsive layouts

---

## 🔐 Privacy

**Your data stays on your device.**

- ✅ Login credentials only sent to X.com
- ✅ Session cookies stored locally (AsyncStorage)
- ✅ No analytics or tracking
- ✅ No data collection

### With Cloud Cache

When using Cache mode:
- Only queries username → location mappings
- No personal data transmitted
- Anonymous, no user identification

---

## 📝 Usage Guide

### Cache Mode (Default)

1. Enter any X username (e.g., `elonmusk`)
2. Tap the search button
3. View results instantly if user is in cache

### Live Mode

1. Switch to "Live" mode using the toggle
2. Tap "Log in to X"
3. Complete X login in the WebView
4. Enter any username
5. Get real-time location & device data

### Tips

- Paste full profile URLs like `x.com/username`
- Use Cache mode for quick lookups
- Use Live mode for users not in cache
- Check history for recent lookups

---

## 🛠 Development

### Scripts

```bash
# Development server with tunnel
pnpm dev

# iOS simulator
pnpm ios

# Web preview
pnpm web

# Lint code
pnpm lint

# Build for production
pnpm build:ios
```

### Environment

- **Framework:** React Native 0.81 + Expo 54
- **Navigation:** Expo Router
- **State:** React hooks + AsyncStorage
- **Styling:** StyleSheet + LinearGradient
- **Icons:** expo-symbols (SF Symbols)

---

## 🤝 Contributing

Contributions welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

---

## 📜 License

MIT License — See [LICENSE](LICENSE) for details.

---

## 👤 Credits

Based on the [X-Posed Browser Extension](https://github.com/xaitax/x-account-location-device) by **Alexander Hagenah** ([@xaitax](https://x.com/xaitax)).

Mobile app implementation follows the extension's architecture:
- Cloud cache integration
- X GraphQL API patterns
- Country flag mappings
- VPN detection logic

---

<div align="center">

### ⭐ Star this repo if X-Posed Mobile helps you!

**X-Posed Mobile** — Location intelligence, anywhere.

</div>
