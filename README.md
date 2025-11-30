<div align="center">

# 🌍 X-Posed

### See where X users are really posting from.

**Country flags, device info, VPN detection, and powerful filtering — all in one extension.**

[![Chrome Web Store](https://img.shields.io/badge/Chrome-Install-4285F4?style=for-the-badge&logo=google-chrome&logoColor=white)](https://chromewebstore.google.com/detail/x-account-location-device/oodhljjldjdhcdopjpmfgbaoibpancfk)
[![Firefox Add-ons](https://img.shields.io/badge/Firefox-Install-FF7139?style=for-the-badge&logo=firefox-browser&logoColor=white)](https://addons.mozilla.org/en-GB/firefox/addon/x-posed-account-location-devic/)

<br>

If you find this useful, I'd appreciate a coffee:  
[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/M4M61EP5XL)

---

<img width="800" alt="X-Posed showing country flags and device icons on X timeline" src="https://github.com/user-attachments/assets/53c5c59f-a0f4-4cee-8582-275f9717c807" />

</div>

---

## ✨ Key Features

### 🏳️ Country Flags & Device Detection

Every tweet shows the author's real location and device at a glance.

| Indicator | Meaning |
|-----------|---------|
| 🇺🇸 🇬🇧 🇯🇵 | Country flag from X's location data |
| 🍎 | iOS (iPhone/iPad) |
| 🤖 | Android |
| 🌐 | Web browser |
| 🔒 | VPN/Proxy detected — location may not be accurate |

<!-- Screenshot: Timeline showing flags and device icons -->

---

### 🚫 Location Blocking

Filter your timeline by hiding or highlighting tweets from specific locations.

**Countries** — Block individual countries with one-click selection  
**Regions** — Block entire geographic areas (Europe, South Asia, Africa, etc.)

**Two blocking modes:**
- **Hide** (default) — Blocked tweets vanish from your feed
- **Highlight** — Blocked tweets stay visible with a subtle amber border

<!-- Screenshot: Country/Region blocker modal with tabs -->

---

### 📸 Evidence Screenshot

Capture any tweet with a forensic metadata overlay showing location, device, VPN status, and timestamp.

Perfect for researchers, journalists, and OSINT professionals who need to document social media evidence.

<!-- Screenshot: Evidence capture overlay on a tweet -->

---

### 📊 Statistics Dashboard

See your cached data at a glance:
- 🌍 **Top countries** — Most common locations in your cache
- 📱 **Device breakdown** — iOS vs Android vs Web distribution
- 🔒 **VPN users** — Percentage of users detected with VPN/proxy
- ☁️ **Cloud stats** — Community cache contribution metrics

<!-- Screenshot: Statistics dashboard in options page -->

---

### 💾 Export & Import

Full backup and restore of your configuration:
- All settings and preferences
- Blocked countries and regions
- Cached user data

Move between browsers or share configurations across devices.

---

## 🚀 Installation

### From Store (Recommended)

| Browser | Link |
|---------|------|
| **Chrome / Edge / Brave** | [Chrome Web Store](https://chromewebstore.google.com/detail/x-account-location-device/oodhljjldjdhcdopjpmfgbaoibpancfk) |
| **Firefox** | [Firefox Add-ons](https://addons.mozilla.org/en-GB/firefox/addon/x-posed-account-location-devic/) |

### Manual Installation

```bash
git clone https://github.com/xaitax/x-account-location-device.git
cd x-account-location-device/extension
npm install
npm run build
```

Load `dist/chrome` or `dist/firefox` as an unpacked extension in your browser.

---

## ⚙️ Configuration

### Quick Settings (Popup)

Click the extension icon for instant toggles:

- ✅ Enable/disable extension
- 🏳️ Show/hide country flags
- 📱 Show/hide device icons
- 🔒 Show/hide VPN indicator
- 👁️ Filter VPN user tweets
- 🗑️ Clear local cache

### Full Options Page

Right-click the extension icon → **Options** for complete control:

- **Statistics** — View cached data analytics
- **Cloud Cache** — Enable community sharing (opt-in)
- **Location Blocking** — Manage blocked countries and regions
- **Export/Import** — Backup and restore configuration

---

## ☁️ Community Cloud Cache

**Optional feature** — Share anonymous lookups with other users.

| Benefit | Description |
|---------|-------------|
| ⚡ **Faster lookups** | Instant responses from cached community data |
| 🛡️ **Avoid rate limits** | Reduce direct API calls to X |
| 👥 **Community powered** | One user's lookup helps everyone |

**Privacy:** Only username → location/device mappings are shared. No personal data, no IP logging.

Enable in **Options → Cloud Cache → Enable Community Cache**.

---

## 🔐 Privacy

| Mode | What happens |
|------|--------------|
| **Default** | All data stored locally. API calls go directly to X. No external servers. |
| **With Cloud Cache** | Username → location mappings shared anonymously. Self-hostable. |

Read the full [Privacy Policy](PRIVACY.md).

---

## 🔧 Development

```bash
cd extension

# Development (watch mode)
npm run dev:chrome
npm run dev:firefox

# Production build
npm run build

# Package for distribution
npm run package
```

### Project Structure

```
extension/
├── src/
│   ├── background/      # Service worker, API client
│   ├── content/         # DOM observer, badge injection
│   ├── popup/           # Quick settings popup
│   ├── options/         # Full settings page
│   └── shared/          # Constants, utilities, storage
└── dist/
    ├── chrome/          # Chrome MV3 build
    └── firefox/         # Firefox MV3 build
```

---

## 📝 Changelog

### v2.2.0 — Latest

- 🌍 **Region Blocking** — Block entire geographic areas
- ⚠️ **Highlight Mode** — Show blocked tweets with amber border instead of hiding
- 🔒 **VPN Filter** — Hide/show tweets from VPN users
- 💾 **Full Export/Import** — Complete configuration backup

[View full changelog →](CHANGELOG.md)

---

## 🤝 Contributing

Issues and pull requests welcome. Please review the existing code style before contributing.

---

## 👤 Author

**Alexander Hagenah**

[![X](https://img.shields.io/badge/@xaitax-000000?style=flat&logo=x&logoColor=white)](https://x.com/xaitax)
[![LinkedIn](https://img.shields.io/badge/alexhagenah-0A66C2?style=flat&logo=linkedin&logoColor=white)](https://www.linkedin.com/in/alexhagenah/)
[![Website](https://img.shields.io/badge/primepage.de-FF6B6B?style=flat&logo=safari&logoColor=white)](https://primepage.de)

---

<div align="center">

### ⭐ Star this repo if X-Posed helps you!

**X-Posed** — Know who you're talking to.

</div>
