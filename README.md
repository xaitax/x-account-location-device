<div align="center">

# 🌍 X-Posed

### Account Location & Device Intelligence for X

**See where X users are really posting from — and what device they're using.**

If you find this research valuable, I’d appreciate a coffee:  
[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/M4M61EP5XL)

---

<img width="800" alt="X-Posed showing country flags and device icons on X timeline" src="https://github.com/user-attachments/assets/53c5c59f-a0f4-4cee-8582-275f9717c807" />

</div>

---

## ✨ Features

<table>
<tr>
<td width="50%">

### 🏳️ Country Flags
Real location data from X's official API displayed as flag emojis next to every username.

### 📱 Device Detection
See if users are on iOS (🍎), Android (🤖), or web (🌐) at a glance.

### 🔒 VPN Indicator
Know when X detects a VPN or proxy — the 🔒 icon appears when location might not be accurate.

</td>
<td width="50%">

### 🌐 Community Cloud Cache
**NEW!** Opt-in shared cache with instant lookups. Community-powered, privacy-first.

### 📸 Evidence Screenshot
**NEW!** Capture tweets with location metadata overlay. Perfect for researchers, journalists, and OSINT.

### 🚫 Country & Region Blocking
Filter your feed by hiding OR highlighting tweets from specific countries or entire regions. One-click setup with tabbed interface.

</td>
</tr>
</table>

---

## 🚀 Quick Start

### Install from Store (Recommended)

| Browser | Link |
|---------|------|
| **Chrome / Edge / Brave** | [![Chrome Web Store](https://img.shields.io/badge/Chrome-Install-4285F4?style=for-the-badge&logo=google-chrome&logoColor=white)](https://chromewebstore.google.com/detail/x-account-location-device/oodhljjldjdhcdopjpmfgbaoibpancfk)|
| **Firefox** (soon) | [Firefox Add-ons](https://addons.mozilla.org/en-GB/firefox/addon/x-posed-account-location-devic/) |

### Userscript (Alternative - and not updated anymore since v1.5.1)

1. Install [Tampermonkey](https://www.tampermonkey.net/)
2. [Click to install script](https://github.com/xaitax/x-account-location-device/raw/main/x-account-location-flag.user.js)
3. Visit [x.com](https://x.com) — you're done!

---

## ☁️ Community Cloud Cache

<div align="center">

### Share lookups. Save API calls. Everyone benefits.

</div>

| Feature | Description |
|---------|-------------|
| **🔄 Instant Lookups** | Sub-50ms responses via Cloudflare's global edge network |
| **👥 Community Powered** | One user's lookup benefits everyone |
| **🔒 Privacy First** | Only username → location/device mappings. No personal data. |
| **🏠 Self-Hostable** | Deploy your own Cloudflare Worker (free tier available) |

### Enable Cloud Cache

1. Open **Options** (right-click extension icon → Options)
2. Toggle **Enable Community Cache** → ON
3. Done! You're now part of the community

### Sync Your Local Cache

Already have hundreds of cached users? One click uploads them all:

1. Open **Options** page
2. Click **"Sync Local Cache to Cloud"**
3. Your existing cache is shared with the community

---

## 🛡️ Location Blocking

Hide tweets from specific countries or entire regions in real-time.

### Countries Tab
1. Click **Block Countries** in X's sidebar
2. Search or scroll to select countries
3. Click **Done**

### Regions Tab
Some X users show regional locations like "South Asia" or "Europe" instead of specific countries. Block entire regions:
- 🌍 Africa, Europe, North Africa, West Asia
- 🌎 North America, South America
- 🌏 Australasia, East Asia & Pacific, South Asia

### Hide vs Highlight Mode
Choose how to handle blocked tweets in Options:
- **Hide** (default) — Blocked tweets vanish instantly
- **Highlight** — Blocked tweets shown with subtle amber left border (useful for researchers)

Settings persist across sessions.

---

## ⚙️ Settings

### Popup (Quick Access)

Click the extension icon for quick toggles:

- ✅ Enable/disable extension
- 🏳️ Show/hide country flags
- 📱 Show/hide device icons
- 🔒 Show/hide VPN indicator
- 👁️ Show/hide VPN users (filter tweets from VPN users)
- 🐛 Debug mode
- 🗑️ Clear cache

### Options Page

Right-click → **Options** for the full experience:

- 📊 **Statistics Dashboard** — Top countries, device breakdown, cache analytics
- ☁️ **Cloud Cache** — Enable community sharing, sync local cache
- 🚫 **Blocked Locations** — Manage your country and region block lists
- 💾 **Export/Import** — Backup and restore all settings, blocked countries, and cache

---

## 📈 Statistics Dashboard

<table>
<tr>
<td>

**See your data at a glance:**
- 🌍 Top 5 countries in your cache
- 📱 Device distribution (mobile/desktop/web)
- 🔒 VPN user count
- ☁️ Cloud cache statistics

</td>
</tr>
</table>

---

## 🔧 Development

```bash
# Clone the repo
git clone https://github.com/xaitax/x-account-location-device.git
cd x-account-location-device/extension

# Install dependencies
npm install

# Development (watch mode)
npm run dev:chrome
npm run dev:firefox

# Production build
npm run build

# Output
# → dist/chrome/   (Chrome/Edge/Brave)
# → dist/firefox/  (Firefox)
```

### Architecture

```
extension/
├── src/
│   ├── background/      # Service worker, API client, cloud cache
│   ├── content/         # DOM observer, badge injection
│   ├── popup/           # Quick settings popup
│   ├── options/         # Full settings page
│   └── shared/          # Constants, utils, storage
├── dist/
│   ├── chrome/          # Chrome MV3 build
│   └── firefox/         # Firefox MV3 build
└── rollup.config.js     # Build configuration
```

---

## 🌐 Deploy Your Own Cloud Server

Want to run your own community cache? It's easy with Cloudflare Workers.

```bash
cd cloud-server
npm install -g wrangler
wrangler login

# Create KV namespace
wrangler kv namespace create "CACHE_KV"
# Update wrangler.toml with the ID

# Deploy
wrangler deploy
```

**Cost:** Free for up to 100,000 requests/day. See [cloud-server/README.md](cloud-server/README.md) for details.

---

## 🔐 Privacy

<table>
<tr>
<td width="50%">

### Default Mode
- ✅ All data stored locally
- ✅ Direct API calls to X only
- ✅ No external servers
- ✅ No analytics or tracking

</td>
<td width="50%">

### With Cloud Cache (Opt-In)
- ✅ Only username → location/device shared
- ✅ No personal information
- ✅ No IP logging
- ✅ Self-hostable

</td>
</tr>
</table>

Read the full [Privacy Policy](PRIVACY.md).

---

## 📝 Changelog

<table>
<tr>
<td>

### Latest: v2.2.0

🗺️ **Region Block** — Region blocking with tabbed interface (Countries | Regions)
⚠️ **Highlight Mode** — Show blocked tweets with amber border instead of hiding
🌍 **Geographic Globe Emojis** — Africa, Americas, Asia/Oceania regions supported

</td>
<td width="200" align="center">

[![Changelog](https://img.shields.io/badge/Full_Changelog-View-blue?style=for-the-badge)](CHANGELOG.md)

</td>
</tr>
</table>

---

## 🤝 Contributing

Issues and PRs welcome! Please read the existing code style before contributing.

---

## 👤 Author

<table>
<tr>
<td>

**Alexander Hagenah**

[![X](https://img.shields.io/badge/@xaitax-000000?style=flat&logo=x&logoColor=white)](https://x.com/xaitax)
[![LinkedIn](https://img.shields.io/badge/alexhagenah-0A66C2?style=flat&logo=linkedin&logoColor=white)](https://www.linkedin.com/in/alexhagenah/)
[![Website](https://img.shields.io/badge/primepage.de-FF6B6B?style=flat&logo=safari&logoColor=white)](https://primepage.de)

</td>
</tr>
</table>

---

<div align="center">

### ⭐ Star this repo if X-Posed helps you!

**X-Posed** — Know who you're talking to.

</div>
