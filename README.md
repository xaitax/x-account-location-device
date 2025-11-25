# X-Posed: Account Location & Device Info

**See where X users are from and what devices they use.**

A Browser Extension and Userscript that displays country flags 🇺🇸 and device icons 📱 next to every X (~~Twitter~~) username. Know who you're interacting with—their location and platform—at a glance. Bonus: optional geo-blocking to filter your feed by country.

## 📰 Background

This script leverages X's official "Country Labels" feature announced on November 16, 2025. X now displays account locations derived from signals like IP addresses, app store regions, and posting behavior. This feature helps identify authentic accounts and combat foreign interference, though it raises privacy concerns for users in repressive regions.

The script extracts this official location and device data from X's GraphQL API, presenting it in a user-friendly format with flags and device emojis.

## ✨ Features

### 🌍 Core Features: Location & Device Intelligence
- **Country Flags**: Flag emojis (🇺🇸🇩🇪🇯🇵) appear next to every username based on X's official API
- **VPN/Proxy Detection**: Lock icon 🔒 appears when location may not be accurate (VPN/Proxy detected)
- **Device Indicators**: Instantly see if users are on mobile 📱, desktop 💻, or web 🌐
- **Hover Tooltips**: Detailed info on hover (e.g., "Connected via: United States Android App")
- **Real API Data**: Pulls actual location and device info directly from X's GraphQL API
- **Universal Coverage**: Works on timelines, profiles, replies, and search results
- **Country Filtering**: Block tweets from specific countries if desired
- **Multi-Select**: Block multiple countries simultaneously
- **Persistent Settings**: Blocked countries saved locally in your browser

### ⚡ Performance & Privacy
- **Smart Caching**: 48-hour cache respects X's rate limits—zero unnecessary API calls
- **No Data Collection**: Everything stays in your browser, no external servers
- **Cross-Platform**: Works on Firefox, Chrome, Edge, and other browsers
- **Language Agnostic**: Functions regardless of your X interface language

[x-account-location-device-blocked-country.webm](https://github.com/user-attachments/assets/b0ff82f9-e6d7-4282-bb9e-6b29630c7c09)


> [!NOTE]
> **Windows Support Added:** Windows 10/11 doesn't natively support flag emojis. This extension now automatically detects Windows and replaces the broken characters with high-quality Twemoji images (the same ones Twitter uses), so flags look perfect on all platforms! 🎨

## 🚀 Installation

### Option 1: Browser Extension Stores (Recommended)

**Chrome, Edge, Brave:**

[![Chrome Web Store](https://img.shields.io/badge/Chrome%20Web%20Store-Install-blue?style=for-the-badge&logo=google-chrome)](https://chromewebstore.google.com/detail/x-account-location-device/oodhljjldjdhcdopjpmfgbaoibpancfk)

Install from the [Chrome Web Store](https://chromewebstore.google.com/detail/x-account-location-device/oodhljjldjdhcdopjpmfgbaoibpancfk)

**Firefox:**

[![Firefox Add-ons](https://img.shields.io/badge/Firefox%20Add--ons-Install-orange?style=for-the-badge&logo=firefox)](https://addons.mozilla.org/en-GB/firefox/addon/x-posed-account-location-devic/)

Install from Firefox Add-ons *(Coming Soon)*

### Option 2: Tampermonkey Userscript
**Alternative installation method for all browsers:**

1. Install [Tampermonkey](https://www.tampermonkey.net/) browser extension
2. Click here to install the script: [X-Posed Userscript](https://github.com/xaitax/x-account-location-device/raw/main/x-account-location-flag.user.js)
3. Tampermonkey will prompt you to install - click "Install"
4. Visit [x.com](https://x.com) and you'll see flags and device indicators next to usernames!

### Option 3: Manual Installation (Developer Mode / latest update)
**For development or testing:**

**Chrome / Edge / Brave:**
1. Download or clone this repository
2. Go to `chrome://extensions`
3. Enable **Developer mode** (top right)
4. Click **Load unpacked**
5. Select the `extension` folder from this repository

**Firefox (Temporary):**
1. Download or clone this repository
2. Go to `about:debugging#/runtime/this-firefox`
3. Click **Load Temporary Add-on...**
4. Select the `manifest.json` file inside the `extension` folder

*Note: Temporary add-ons are removed when you close Firefox. For permanent installation, use the Tampermonkey userscript instead.*

## 📱 Usage

### 1️⃣ Automatic Location & Device Display
Once installed, X-Posed runs automatically:
- **🇺🇸 📱** United States users on mobile
- **🇯🇵 💻** Japanese users on desktop
- **🇬🇧 🔒 🌐** UK users on web (VPN/Proxy detected)
- **🇩🇪 💻** German users on iPad (treated as desktop)

**VPN/Proxy Indicator:**
- 🔒 appears when X detects the user may be using a VPN or proxy
- Tooltip explains: "Location may not be accurate (VPN/Proxy detected)"
- Helps identify users masking their location

Hover over any flag, lock, or device icon for detailed information.

### 2️⃣ Block Countries in 3 Clicks
1. Click **"Block Countries"** in the X sidebar (between Profile and More)
2. Select countries you want to block
3. Click "Done" → tweets from those countries disappear instantly

**Features:**
- 🔍 Search bar to quickly find countries
- 🌍 All 190+ countries with flags
- 📊 Counter showing blocked countries
- 💾 Settings persist across sessions
- ⚡ Instant filtering using cached data (no API rate limits)

### 3️⃣ Manage Your Blocks
- **Clear All**: Remove all country blocks at once
- **Toggle Individual**: Click any country to block/unblock
- **Visual Feedback**: Blocked countries highlighted in red

All operations are instant and use zero additional API calls.

### Cache Management
The script caches data for 48 hours. To manage cache and blocking:

**In Browser Console (F12):**
```javascript
// View cache statistics
XFlagScript.getCacheInfo()

// Clear all cached data
XFlagScript.clearCache()

// Toggle extension on/off
XFlagScript.toggle()

// Open country blocker modal
XFlagScript.openBlocker()

// Get list of blocked countries
XFlagScript.getBlockedCountries()

// Debug info
XFlagScript.debug()
```

## 📜 Changelog

### v1.5.0 - VPN/Proxy Detection & Performance
- **NEW: VPN/Proxy Indicator** 🔒: See when users may be masking their location
- **Smart Detection**: Uses X's `location_accurate` field to identify VPN/proxy usage
- **Extended Cache**: Increased from 24 to 48 hours to reduce API calls
- **Better Debugging**: Enhanced debug() function shows cache stats, rate limits, and active requests
- **API Request Logging**: See exactly when API calls are made in console
- **Cache Persistence**: Cache survives extension reloads (stored in localStorage)

### v1.4.0 - Geo-Blocking Feature
- **Geo-Blocking**: Block tweets from specific countries if desired
- **Native UI**: Beautiful modal matching X's design system (dark theme, animations, search)
- **Better Device Detection**: iPad now correctly shows as desktop 💻; improved fallback logic
- **Shield Icon**: Professional shield icon for the blocker feature
- **Performance**: Optimized to prevent duplicate API calls and respect rate limits
- **Zero Rate Limits**: Cache-only operations when toggling blocks

### v1.3.0
- **Windows Support**: Added automatic Twemoji image replacement for Windows users, fixing the "missing flag" issue on Chrome/Edge/Brave.
- **Profile Header Support**: Now correctly displays flags in user profile headers (even for unverified accounts).
- **Bug Fixes**: Fixed an issue where flags would only appear on the first tweet of a user and not subsequent ones.
- **Performance**: Optimized DOM scanning to be much lighter on CPU by only processing new nodes.
- **Accuracy**: Removed misleading fallback that showed your own device type when data was missing.

### v1.2.0
- **Dual Mode**: Now available as both a standalone Browser Extension (Chrome/Firefox) and a Userscript.

### v1.1.0
- **Instant Speed**: Rewrote the country lookup engine to be O(1) (instant), removing lag on busy timelines.
- **Language Fix**: Now forces X to return English country names, so flags work even if your interface is in German, French, etc.
- **Firefox & Windows Fix**: Updated font stacks to properly render flag emojis on Windows and Firefox.
- **Smart Fallbacks**: If X's API doesn't return a device, we now intelligently guess based on your browser to show *something* useful.
- **Robustness**: Added a fallback authentication mechanism so the script works even if it misses the initial API handshake.

## 🔧 How It Works

### API Integration
- Intercepts X's own API calls to capture authentication headers
- Queries X's GraphQL API for user profile data
- Extracts `account_based_in` (location) and `source` (device) fields
- Maps locations to country flag emojis
- Maps device info to platform emojis

## 🛠️ Technical Details

### API Endpoints
- Uses X's public GraphQL API
- Only queries public profile information
- Rate limited to ~50 requests per timeframe (automatically handled with queuing and caching)

### Privacy
- No data collection or transmission to third parties
- All API calls go directly to X's servers
- Data is cached locally in your browser only

## 🤝 Contributing

Found a bug or have a feature request? Feel free to:
1. Open an issue on GitHub
2. Submit a pull request
3. Suggest improvements

## 👤 Author

**Alexander Hagenah (@xaitax)**

- 𝕏: [@xaitax](https://x.com/xaitax)
- LinkedIn: [alexhagenah](https://www.linkedin.com/in/alexhagenah/)
- Website: [primepage.de](https://primepage.de)

---

<div align="center">

**X-Posed** • Know who you're talking to.

Made with ❤️ for transparency on X

</div>
