# X Account Location & Device Info

A Tampermonkey userscript that displays country flags and device/platform information next to X (formerly Twitter) usernames. Shows where users are located and what device they're using, all in a clean, unobtrusive way.

## 📰 Background

This script leverages X's official "Country Labels" feature announced on November 16, 2025. X now displays account locations derived from signals like IP addresses, app store regions, and posting behavior. This feature helps identify authentic accounts and combat foreign interference, though it raises privacy concerns for users in repressive regions.

The script extracts this official location and device data from X's GraphQL API, presenting it in a user-friendly format with flags and device emojis.

## ✨ Features

- **Country Flags**: Displays flag emojis next to usernames based on account location from X's API
- **Device Indicators**: Shows device/platform emojis (📱💻🖥️🌐) indicating how users are connected
- **Real API Data**: Extracts actual location and device info directly from X's GraphQL API
- **Hover Tooltips**: Detailed information on hover (e.g., "Connected via: Android App")
- **Smart Caching**: 24-hour cache optimized for X's rate limits with manual clearing options
- **Cross-Platform**: Works on Firefox, Chrome, Edge, and other browsers with Tampermonkey

<hr>
<img width="866" height="109" alt="image" src="https://github.com/user-attachments/assets/22b2e25c-8095-4dea-9bc6-3583740442cf" />
<hr>
<img width="866" height="106" alt="image" src="https://github.com/user-attachments/assets/3ce0434a-4ba8-423c-8388-f722e6f9aad5" />
<hr>
<img width="866" height="125" alt="image" src="https://github.com/user-attachments/assets/60bc8fcb-c167-43b2-8bb1-f5593ccbb484" />
<hr>
<img width="866" height="100" alt="image" src="https://github.com/user-attachments/assets/7ab9f87a-ef6b-4c78-9fca-38d98a34cba5" />
<hr>

> [!NOTE]  
> On Windows, Chromium-based browsers (Chrome, Edge, Brave) don’t display emoji flags by default. Firefox does.

## 🚀 Installation

### Prerequisites
- [Tampermonkey](https://www.tampermonkey.net/) browser extension
- Modern web browser (Chrome, Brave, Firefox, Edge, etc.)

### Install Steps
1. Install Tampermonkey from the link above
2. Click here to install the script: [X Account Location & Device Info](https://github.com/xaitax/x-account-location-device/raw/main/x-account-location-flag.user.js)
3. Tampermonkey will prompt you to install - click "Install"
4. Visit [x.com](https://x.com) and you'll see flags and device indicators next to usernames!

## 📱 Usage

### Basic Usage
Once installed, the script runs automatically on X.com. You'll see:
- `🇺🇸 📱` next to usernames from the United States using mobile devices
- `🇯🇵 💻` next to usernames from Japan using computers
- `🇬🇧 🌐` next to usernames from the UK using web browsers

### Hover for Details
Hover over the device emoji to see detailed information like:
- "Connected via: United States Android App"
- "Connected via: Web"
- "Connected via: iPhone"

### Cache Management
The script caches data for 24 hours. To manage cache:

**In Browser Console (F12):**
```javascript
// View cache statistics
XFlagScript.getCacheInfo()

// Clear all cached data
XFlagScript.clearCache()

// Remove displayed flags
XFlagScript.removeAllFlags()

// Re-process all usernames
XFlagScript.processUsernames()
```

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

**Alexander Hagenah**

- X/Twitter: [@xaitax](https://x.com/xaitax)
- LinkedIn: [https://www.linkedin.com/in/alexhagenah/](https://www.linkedin.com/in/alexhagenah/)
- Website: [https://primepage.de](https://primepage.de)

---

**Made with ❤️ for the X community**
