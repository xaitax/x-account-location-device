<h1 align="center">🌍 X-Posed</h1>

<p align="center">
<strong>See where X users are really posting from.</strong><br>
Country flags, device info, VPN detection, and powerful filtering — all in one extension.
</p>

<p align="center">
<a href="https://chromewebstore.google.com/detail/x-account-location-device/oodhljjldjdhcdopjpmfgbaoibpancfk"><img src="https://img.shields.io/badge/Chrome-Install-4285F4?style=for-the-badge&logo=google-chrome&logoColor=white" alt="Chrome Web Store"></a>
<a href="https://addons.mozilla.org/en-GB/firefox/addon/x-posed-account-location-devic/"><img src="https://img.shields.io/badge/Firefox-Install-FF7139?style=for-the-badge&logo=firefox-browser&logoColor=white" alt="Firefox Add-ons"></a>
</p>

<p align="center">
<a href="https://ko-fi.com/M4M61EP5XL"><img src="https://ko-fi.com/img/githubbutton_sm.svg" alt="Support on Ko-fi"></a>
</p>

<p align="center">
<img width="800" alt="X-Posed showing country flags and device icons on X timeline" src="https://github.com/user-attachments/assets/53c5c59f-a0f4-4cee-8582-275f9717c807">
</p>

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

<img width="603" height="1059" alt="image" src="https://github.com/user-attachments/assets/6501f487-9e7f-4aeb-b9c2-69b0e470c949" />

---

### 🚫 Location Blocking

Filter your timeline by hiding or highlighting tweets from specific locations.

**Countries** — Block individual countries with one-click selection  
**Regions** — Block entire geographic areas (Europe, South Asia, Africa, etc.)

**Two blocking modes:**
- **Hide** (default) — Blocked tweets vanish from your feed
- **Highlight** — Blocked tweets stay visible with a subtle amber border

<img width="485" height="737" alt="image" src="https://github.com/user-attachments/assets/5a79a134-dba5-4699-8087-df4c2dd6f878" />

---

### 📸 Evidence Screenshot

Capture any tweet with a forensic metadata overlay showing location, device, VPN status, and timestamp.

Perfect for researchers, journalists, and OSINT professionals who need to document social media evidence.

<img width="690" height="735" alt="image" src="https://github.com/user-attachments/assets/03b80339-cc54-40f6-a8ba-4b65abf673d4" />

---

### 📊 Statistics Dashboard

See your cached data at a glance:
- 🌍 **Top countries** — Most common locations in your cache
- 📱 **Device breakdown** — iOS vs Android vs Web distribution
- 🔒 **VPN users** — Percentage of users detected with VPN/proxy
- ☁️ **Cloud stats** — Community cache contribution metrics

<img width="631" height="663" alt="image" src="https://github.com/user-attachments/assets/3c159157-c60e-4bf7-8426-fabbf78d41ca" />

---

### 💾 Export & Import

Full backup and restore of your configuration:
- All settings and preferences
- Blocked countries and regions
- Cached user data

Move between browsers or share configurations across devices.

---

## 🚀 Installation

| Browser | Link |
|---------|------|
| **Chrome / Edge / Brave** | [Chrome Web Store](https://chromewebstore.google.com/detail/x-account-location-device/oodhljjldjdhcdopjpmfgbaoibpancfk) |
| **Firefox** | [Firefox Add-ons](https://addons.mozilla.org/en-GB/firefox/addon/x-posed-account-location-devic/) |

**Manual installation:**

```bash
git clone https://github.com/xaitax/x-account-location-device.git
cd x-account-location-device/extension
npm install
npm run build
```

Load `dist/chrome` or `dist/firefox` as an unpacked extension.

---

## ⚙️ Configuration

**Quick Settings (Popup)** — Click the extension icon for instant toggles:
- ✅ Enable/disable extension
- 🏳️ Show/hide country flags
- 📱 Show/hide device icons
- 🔒 Show/hide VPN indicator
- 👁️ Filter VPN user tweets
- 🗑️ Clear local cache

**Full Options Page** — Right-click the extension icon → Options:
- **Statistics** — View cached data analytics
- **Cloud Cache** — Enable community sharing (opt-in)
- **Location Blocking** — Manage blocked countries and regions
- **Export/Import** — Backup and restore configuration

---

## ☁️ Community Cloud Cache

Optional feature — Share anonymous lookups with other users.

| Benefit | Description |
|---------|-------------|
| ⚡ Faster lookups | Instant responses from cached community data |
| 🛡️ Avoid rate limits | Reduce direct API calls to X |
| 👥 Community powered | One user's lookup helps everyone |

**Privacy:** Only username → location/device mappings are shared. No personal data, no IP logging.

Enable in **Options → Cloud Cache → Enable Community Cache**.

<img width="489" height="531" alt="image" src="https://github.com/user-attachments/assets/49680ef9-0743-44a3-a1a3-9de0b80761a4" />

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
npm run dev:chrome    # Watch mode for Chrome
npm run dev:firefox   # Watch mode for Firefox
npm run build         # Production build
npm run package       # Create distribution zips
```

**Project Structure:**
```
extension/src/
├── background/   # Service worker, API client
├── content/      # DOM observer, badge injection
├── popup/        # Quick settings popup
├── options/      # Full settings page
└── shared/       # Constants, utilities, storage
```

---

## 📝 Changelog

**v2.2.0** — Latest
- 🌍 Region blocking (block entire geographic areas)
- ⚠️ Highlight mode (amber border instead of hiding)
- 🔒 VPN user filter
- 💾 Full export/import

[View full changelog →](CHANGELOG.md)

---

## 👤 Author

**Alexander Hagenah**

[![X](https://img.shields.io/badge/@xaitax-000000?style=flat&logo=x&logoColor=white)](https://x.com/xaitax)
[![LinkedIn](https://img.shields.io/badge/alexhagenah-0A66C2?style=flat&logo=linkedin&logoColor=white)](https://www.linkedin.com/in/alexhagenah/)
[![Website](https://img.shields.io/badge/primepage.de-FF6B6B?style=flat&logo=safari&logoColor=white)](https://primepage.de)

---

⭐ **Star this repo if X-Posed helps you!**

**X-Posed** — Know who you're talking to.
