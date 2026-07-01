# Changelog

All notable changes to X-Posed will be documented in this file.

## [3.2.0] - 2026-07-01

### Bug Fixes
- **VPN/proxy tweets no longer stay hidden after you re-enable "Show VPN/Proxy Users."** Block, highlight and VPN-hide state is now re-derived authoritatively on every pass, so flipping the setting (or X recycling a timeline row) can't leave a tweet stuck hidden — and re-enabling the toggle now un-hides them live. Also stops a per-scan reprocessing loop on hidden rows.
- **Name flag vs. hovercard mismatch** ([#23](https://github.com/xaitax/x-account-location-device/issues/23), reported by **@MV10**): when a badge was served a stale community-cache country, hovering now reconciles the badge to the live value so the two agree. Hardened the API parser to reject — and never cache or contribute — a response whose handle doesn't match the requested user, closing a cloud cache-poisoning path. Added diagnostics to pin down the remaining (server-side) cause.
- **Popup community-cache total** now updates live from the same source as the settings dashboard, so the two no longer show different numbers.

### New
- **Language filter** ([#25](https://github.com/xaitax/x-account-location-device/issues/25), requested by **@nightkall**): block or highlight posts by the language they're written in, using X's own per-post language detection (so it works for every language, not just non-Latin scripts). Manage it from the blocking modal's new **Languages** tab, from **Settings → Blocking → Languages**, and it's included in import/export. Honors your hide-vs-highlight preference; quoted-tweet and media/emoji-only posts are never mis-blocked.
- **"Open Changelog on Update" toggle** ([#24](https://github.com/xaitax/x-account-location-device/issues/24)): turn off the automatic "What's New" tab that opens after an update (Settings → General Settings). On by default; opted-out users still see the in-page "What's New" banner next time they open Options.

## [3.1.0] - 2026-06-19

### New Feature
- **Share evidence to X.** Turn any account into a one-click evidence card (country flag, device, VPN/proxy signal, account age, and handle changes) and quote it, reply with it, or post it to your own timeline. The card is copied to your clipboard (or shared natively on mobile) and X's composer opens prefilled; you review and post. Click the card to enlarge it. Every share is opt-in and human-confirmed; nothing is posted automatically. The badge's capture button is now a share button.

### Fixes & Improvements
- Assorted bug fixes, polish, and performance improvements.

## [3.0.1] - 2026-06-17

### Bug Fixes
- **Highlighted (and blocked) tweets no longer revert when you hover them.** X re-renders a tweet's container on hover and was stripping our styling; the highlight, hide, and VPN-hide states now persist via a marker X can't wipe.
- **Blocking modal tag filter** no longer shows stale results after a tag is added or removed.
- **Chrome:** the welcome page (on install) and the "What's New" tab (on update) now open correctly; the cross-browser API shim was missing two methods.

### Firefox for Android
- Now supported on Firefox for Android. The account dossier opens on tap (no hover needed) and slides up as a bottom sheet, the popup fills the screen, and Android compatibility is declared in the manifest.

### Polish
- Replaced the last interface emojis (toasts, hovercard, popup and options banners, blocking and settings tabs, evidence-capture buttons) with the drawn glyph set, so every surface renders identically across operating systems.

### Performance & Internals
- Removed a large amount of duplicated and dead code
- The local cache now persists only what changed and no longer leaks expiry entries
- Freshly cached users and queued community-cache contributions now flush before the background suspends, so less is lost on idle
- Raised the minimum Chrome version to 111 to match the CSS features in use

---

## [3.0.0] - 2026-06-15

A complete visual redesign, plus all the features and fixes from the 2.6 line, shipped as one major release.

### Redesign
- Rebuilt every surface on one cohesive "glass" design system: timeline badges, the account hovercard, the blocking modal, the popup, and the options dashboard. Light and dark only (X dropped Dim).
- New "Mission Control" popup: a compact deck with the live community-cache total, all display toggles, and one-click support.
- Options reorganized behind a left sidebar.
- Crisp new device and metadata icons; evidence-capture cards redrawn with vector icons instead of emoji.
- Bundled typography (Chakra Petch + Martian Mono).

### New Features
- **Flag from Device**: flag a user by their *device* country (from the X "source" string) instead of their account location, so VPN users are flagged by where the device actually is. Off by default. When on, country/region blocking follows the device country too. Implements [#17](https://github.com/xaitax/x-account-location-device/issues/17), based on PR [#19](https://github.com/xaitax/x-account-location-device/pull/19) by **@AndroidMaster25**.
- **Community Cloud Cache on by default for new installs**, so flags keep showing through X rate limits. Existing users are unchanged; opt out anytime. Only the usernames you look up are sent, never your identity.
- The popup now shows the live community-cache total (2.5M+ profiles and counting).

### Bug Fixes
- **Edge/macOS startup crash**: `detectXTheme()` no longer throws at `document_start` (which silently disabled the extension). Reported by **@ikeyoshy** ([#18](https://github.com/xaitax/x-account-location-device/issues/18)).
- **Flags vanishing while rate-limited**: transient lookups are no longer negatively cached, so flags return once the limit resets. Reported by **@JoaquinSuez** ([#16](https://github.com/xaitax/x-account-location-device/issues/16)).
- **Missing "Southeast Asia" region** added. Reported by **@Tapemaster21** ([#20](https://github.com/xaitax/x-account-location-device/issues/20)).
- **Hovercard off-screen on narrow widths**: it now clamps fully into the viewport. PR [#21](https://github.com/xaitax/x-account-location-device/pull/21) by **@AndroidMaster25**.

### Reliability
- **Firefox container auth** ([#14](https://github.com/xaitax/x-account-location-device/issues/14)): a single failing lookup no longer breaks *every* hovercard, and lookups now recover inside Firefox containers by retrying from the page's own session. In-page recovery in PR [#22](https://github.com/xaitax/x-account-location-device/pull/22) by **@screwys**; reported by **@Fred-Vatin**.
- **Hardened startup**: badge injection runs independently of theme/sidebar setup, so one edge case can't stop flags from rendering. PR [#22](https://github.com/xaitax/x-account-location-device/pull/22) by **@screwys**.

---

## [2.5.0] - 2025-01-28

### ✨ New Features
- **Toggle Capture Button**: New option to show/hide the camera button on info badges (PR #11 by @ystolzenburg)

### ⚡ Performance
- **Faster API lookups**: Reduced throttle (300→150ms) and increased concurrency (5→8 parallel requests)
- **Faster cloud cache**: Reduced batch delay (500→200ms) for quicker responses
- **Parallelized broadcasts**: Settings updates now 5-10x faster across tabs
- **Optimized timings**: Snappier search, faster initial page load, reduced theme detection overhead

### 💰 Cloud Cost Optimization
- **Stats endpoint**: No longer lists all KV keys (~70% cost reduction)
- **Edge caching**: Lookups cached at Cloudflare edge for 1 hour (80% fewer KV reads)
- **Contribution deduplication**: Skip re-uploads within 24 hours (90% fewer writes)
- **Server-side rate limiting**: 60 requests/min/IP to prevent abuse

---

## [2.4.0] - 2025-12-28

### ✨ New Features
- **Tag-Based Blocking**: Block users based on emojis, symbols, or text patterns in their display names
  - Tags are matched against the user's display name (not username)
  - New "Tags" tab in the blocking modal and options page
  - Works alongside existing country and region blocking
  - Tags included in Export/Import for backup and restore

### 🎨 UI/UX
- Added count badges to blocking modal tabs showing number of blocked items
- Streamlined tag management interface in sidebar modal and options page
- "Blocked Locations" section renamed to "Blocking" for clarity

---

## [2.3.2] - 2025-12-22

### 🐛 Bug Fixes
- Fixed issue where the logged-in user's own tweets were being hidden/blocked (causing infinite scroll loops on profile pages)
- Resolved Firefox initialization crash by ensuring safe DOM injection (fixing the incomplete patch in v2.3.1)
- Fixed intermittent Firefox initialization crash when `document.head` is temporarily unavailable at `document_start`

### 🎨 UI/UX
- **New Hovercard (on badge hover)** with rich account metadata:
  - Location, device, VPN/proxy signal
  - Verification signals (Blue / Verified / ID / Protected)
  - Account created date, "Verified since", handle-change count
  - Stable X internal account identifier labeled as **User ID**
  - Affiliation label (if present)
- Info badge actions are always visible (info hint + evidence camera)

---

## [2.2.0] - 2024-11-30

### ✨ New Features
- **Region Blocking**: Block entire geographic regions (Africa, Europe, South Asia, etc.)
  - Some X users show regional locations like "South Asia" or "Europe" instead of specific countries
  - New tabbed interface in sidebar modal and options page (Countries | Regions)
  - Geographic globe emojis: 🌍 Africa/Europe/West Asia, 🌎 Americas, 🌏 Asia/Oceania
  - Blocked regions can be managed separately from blocked countries
  - Export/Import now includes blocked regions
- **Highlight Mode**: NEW alternative to hiding blocked tweets
  - Toggle in Options page: "Hide blocked tweets" vs "Highlight blocked tweets"
  - Highlighted tweets shown with subtle amber left border instead of being hidden
  - Useful for users who want to see content but be warned about location
  - Setting syncs with Export/Import

---

## [2.1.0] - 2024-11-29

### ✨ New Features
- **Show VPN Users Toggle**: New option (default ON) to show/hide tweets from users detected as using VPN/proxy
  - Available in both popup and options page
  - Instantly hides/shows VPN user tweets without reload
- **Enhanced Export/Import**: Full configuration backup and restore
  - Export now includes: settings, blocked countries, cache with metadata (version, timestamp)
  - New Import function to restore configurations across devices or browsers
  - JSON format with validation and confirmation dialog
- **Enhanced VPN/Proxy Statistics**: Statistics now show VPN user count with percentage (e.g., `🔒 VPN/Proxy (17%)`)
- **Rate Limit Status Indicator**: Real-time display in popup and options page showing API rate limit status

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
- Toggle-able sidebar "Block Countries" link: can be hidden via Options ([#2](https://github.com/xaitax/x-account-location-device/issues/2))
- Full country blocker UI in Options page: manage blocked countries without visiting X
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
- Evidence Screenshot Generator: capture tweets with metadata overlay (location, device, VPN status, timestamp)
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
