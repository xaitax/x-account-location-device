# Changelog

All notable changes to X-Posed will be documented in this file.

## [2.3.2] - 2025-12-22

### 🐛 Bug Fixes
- Fixed issue where the logged-in user's own tweets were being hidden/blocked (causing infinite scroll loops on profile pages)
- Resolved Firefox initialization crash by ensuring safe DOM injection (fixing the incomplete patch in v2.3.1)
- Fixed intermittent Firefox initialization crash when `document.head` is temporarily unavailable at `document_start`

### 🎨 UI/UX
- **New Hovercard (on badge hover)** with rich account metadata:
  - Location, device, VPN/proxy signal
  - Verification signals (Blue / Verified / ID / Protected)
  - Account created date, “Verified since”, handle-change count
  - Stable X internal account identifier labeled as **User ID**
  - Affiliation label (if present)
- Info badge actions are always visible (info hint + evidence camera)
- Hovercard cleaned up by removing non-actionable rows (avatar shape + learn-more link)

---

## [2.2.0] - 2024-11-30

### ✨ New Features
- **Region Blocking** — Block entire geographic regions (Africa, Europe, South Asia, etc.)
  - Some X users show regional locations like "South Asia" or "Europe" instead of specific countries
  - New tabbed interface in sidebar modal and options page (Countries | Regions)
  - Geographic globe emojis: 🌍 Africa/Europe/West Asia, 🌎 Americas, 🌏 Asia/Oceania
  - Blocked regions can be managed separately from blocked countries
  - Export/Import now includes blocked regions
- **Highlight Mode** — NEW alternative to hiding blocked tweets
  - Toggle in Options page: "Hide blocked tweets" vs "Highlight blocked tweets"
  - Highlighted tweets shown with subtle amber left border instead of being hidden
  - Useful for users who want to see content but be warned about location
  - Setting syncs with Export/Import

---

## [2.1.0] - 2024-11-29

### ✨ New Features
- **Show VPN Users Toggle** — New option (default ON) to show/hide tweets from users detected as using VPN/proxy
  - Available in both popup and options page
  - Instantly hides/shows VPN user tweets without reload
- **Enhanced Export/Import** — Full configuration backup and restore
  - Export now includes: settings, blocked countries, cache with metadata (version, timestamp)
  - New Import function to restore configurations across devices or browsers
  - JSON format with validation and confirmation dialog
- **Enhanced VPN/Proxy Statistics** — Statistics now show VPN user count with percentage (e.g., `🔒 VPN/Proxy (17%)`)
- **Rate Limit Status Indicator** — Real-time display in popup and options page showing API rate limit status

### 🔧 Code Quality
- Fixed all ESLint warnings (13 → 0)
- Removed unused imports and variables across codebase
- Improved code consistency with underscore-prefixed unused parameters

## [2.0.3] - 2024-11-28

### 🔒 Security
- XSS prevention: All dynamic content now uses safe DOM methods instead of innerHTML
- Fixed unsafe innerHTML in popup.js clear cache feedback
- Fixed innerHTML SVG injection in sidebar "Block Countries" link
- Fixed innerHTML SVG in toast close button
- Input validation: Screen names validated (1-15 chars, alphanumeric + underscore)
- Sanitized toast/modal content with strict character escaping

### ⚡ Performance
- Smart version management: Single source of truth in package.json, injected at build time
- Throttled theme observer prevents excessive re-renders on theme changes
- Combined DOM selectors reduce query overhead in MutationObserver
- Cached combined selector at module level (avoids repeated string creation)
- Memoized function creation in content script initialization
- Removed keep-alive console spam in service worker

### 🧠 Memory & Stability
- New shared `lru-cache.js` module eliminates code duplication
- Fixed memory leak in UI cleanup function registry (bounded Map with 1000 max entries)
- Bounded processingQueue (200 max entries with LRU eviction)
- Added 30-second cleanup timeout for stale RequestDeduplicator entries
- Proper async error boundaries prevent cascade failures
- Added error boundary for badge creation to prevent observer crashes
- Fixed race conditions in processingQueue with deferred promise pattern
- Fixed inconsistent async in storage clear() method

### 🔧 Code Quality
- Replaced deprecated `substr()` with `substring()` throughout codebase
- ESLint auto-fix applied for consistent quote style
- Removed unused function parameters in constants.js
- Consolidated LRU cache: storage.js and observer.js now import from shared module
- Magic numbers moved to TIMING constants (rate limit cooldown, keep-alive interval, etc.)

### 🔧 Build System
- Version now auto-syncs from package.json to manifest.json and all JS bundles
- Added `@rollup/plugin-replace` for build-time constant injection
- Separate CHANGELOG.md with nice README integration

---

## [2.0.2] - 2024-11-28

### 🎨 Device Detection Overhaul
- New distinct device emojis: 🍎 iOS, 🤖 Android, 🌐 Web, ❓ Unknown
- Removed misleading "Desktop" category (X API doesn't distinguish desktop from mobile web)
- Statistics now show accurate platform breakdown

### 🔒 Security Hardening
- Fixed XSS vulnerability in badge creation (now uses safe DOM methods)
- Replaced remaining innerHTML with safe DOM methods in modal and evidence capture
- Safe flag emoji handling with validated Twemoji images
- Added input sanitization for cloud cache data

### ⚡ Performance
- Intersection Observer for lazy element processing (only visible elements)
- Reduced unnecessary API calls for off-screen content
- Memoized country list filtering for improved rendering performance

### 🧠 Memory Management
- Bounded pendingVisibility Map (500 max entries with LRU eviction)
- Bounded RequestDeduplicator Map (200 max entries)
- Periodic cleanup of expired notFoundCache entries

### 🔄 Stability
- Service Worker keep-alive prevents Chrome MV3 termination
- Cache negative results (not found users) to avoid repeat API calls
- Error boundary for element processing prevents cascade failures
- Fixed memory leaks and async handling issues
- Added retry logic with exponential backoff for transient failures

### 🔧 Code Quality
- Modernized APIs, centralized constants, improved accessibility
- Added unified logging and JSDoc documentation

---

## [2.0.1] - 2024-11-28

### 🐛 Bug Fixes
- Fixed `getComputedStyle` → `window.getComputedStyle` for Zen/Firefox compatibility ([#4](https://github.com/xaitax/x-account-location-device/issues/4))
- Fixed sidebar "Block Countries" breaking compact layout ([#3](https://github.com/xaitax/x-account-location-device/issues/3))

### ✨ Enhancements
- Toggle-able sidebar "Block Countries" link — can be hidden via Options ([#2](https://github.com/xaitax/x-account-location-device/issues/2))
- Full country blocker UI in Options page — manage blocked countries without visiting X
- Support for followers/following/verified followers pages
- Sidebar link adapts automatically on window resize (compact ↔ normal mode)

---

## [2.0.0] - 2024-11-27

### 🏗️ Architecture
- Modular TypeScript-ready codebase with Rollup
- Cross-browser: Chrome MV3 + Firefox MV3
- LRU cache with 50,000 entry limit

### ✨ New Features
- Community Cloud Cache with Cloudflare Workers
- Evidence Screenshot Generator — capture tweets with metadata overlay (location, device, VPN status, timestamp)
- Statistics dashboard with analytics
- Theme sync (Light/Dim/Dark)
- Options page with full configuration
- Bulk sync local cache to cloud

### 🎨 UI/UX
- Popup with quick toggles
- Camera icon on badges for instant evidence capture
- Light mode fully supported
- Real-time theme detection

---

## [1.5.1]
- Fixed sidebar navigation for all languages

## [1.5.0]
- VPN/proxy indicator
- Extended cache to 48 hours

## [1.4.0]
- Country blocking feature
- iPad detection

## [1.3.0]
- Windows Twemoji support
- Profile header support
