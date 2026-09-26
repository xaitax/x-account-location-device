# Changelog

All notable changes to X-Posed will be documented in this file.

## [4.0.0] - 2026-09-27

X-Posed's growing functionality needed a leaner, cleaner home. Version 4.0 introduces a new design, making existing controls easier to find and leaving room for what comes next. Existing settings and filters are preserved.

### Redesign

- **New design throughout:** coordinated light/dark styling for Settings, the popup, blocking, badges, account cards, Share and notifications, with bundled Lucide icons and consistent post/quote highlights.
- **Simpler blocking:** an Add filter flow, searchable Saved filters and country/region/language choices, plus dedicated Always Show and Behavior tabs. Settings and the on-X dialog share one editor.
- **Compact account cards and sharing:** stable display names, separate media counts, clearer warnings, an image preview, editable captions and organized Quote/Reply/New post choices. Sharing remains user-confirmed.

### Features

- **Domain and exact-URL filters:** match profile websites and bio links. Bare domains include subdomains; URLs keep their specific destination. Bio and link filters can optionally include self-written profile location text. Rules are included in backups.
- **Local filtering statistics and maps:** count identifiable hidden and highlighted posts once across tabs and restarts, with location/device breakdowns and a separate reset. Filtering and Cached accounts each get a country heatmap and exact-count lists; regions and unknowns remain separate. No history backfill or extra X/cloud requests.
- **Optional keyboard shortcut:** assign a browser extension shortcut to switch between Hide and Highlight. No shortcut is assigned by default.
- **Crypto donations, by request:** Bitcoin, Ethereum and USDC on Ethereum join Ko-fi, with network labels and copy-address controls in About, plus addresses in the README.

### Fixes and maintenance

- Your own posts are exempt from language filtering. Posts revealed by changed filters regain their badges. Hidden quotes have keyboard-accessible reveal controls and clearer multi-filter explanations.
- Evidence capture preserves the selected author, text, media and permalink through asynchronous work, without borrowing a surrounding post's identity. Clipboard and popup failures provide recovery options.
- Versioned settings/list updates prevent stale responses from overwriting newer edits across tabs. Failed saves preserve committed state; partial imports synchronize successful changes.
- Reduced unnecessary profile rescans, improved cleanup and page restoration, consolidated parsers and theme values, and removed obsolete CSS, icons, font files and spinner code. Cloud-client timeouts now include response-body processing.
- Rewritten README with new screenshots and consolidated usage/build instructions. Privacy documentation now describes the existing cache defaults, shared account data and local storage accurately.

### Thank you

- **@Blitzgeburt** for the features and fixes in [PR #66](https://github.com/xaitax/x-account-location-device/pull/66) and the linked-website request [#62](https://github.com/xaitax/x-account-location-device/issues/62), adapted into the shared filtering and settings code.
- **@tcryuvgbhjkl** for the country/region statistics request [#31](https://github.com/xaitax/x-account-location-device/issues/31), and **@TMCAtom** for the counter, statistics and quick-toggle ideas [#36](https://github.com/xaitax/x-account-location-device/issues/36), [#44](https://github.com/xaitax/x-account-location-device/issues/44), [#59](https://github.com/xaitax/x-account-location-device/issues/59). This release adds cumulative totals and a shortcut, not per-filter counters or an always-visible sidebar toggle.
- **@toys4us** for requesting crypto donation options in [#61](https://github.com/xaitax/x-account-location-device/issues/61), and everyone who tested, reported bugs or shared ideas.

A huge thank you to everyone who has donated. September's server bill is **US$273.32**, and your support helps keep the community cache running. There is absolutely no need to donate, but it helps tremendously.

## [3.6.0] - 2026-09-12

### New
- **See why a quoted post was hidden** ([#42](https://github.com/xaitax/x-account-location-device/issues/42), requested by **@BrotherSinz**): the collapsed placeholder now names the filter that caught it — Country, Region, Name tag, Bio tag, Account type or Affiliation — so you can tell which list to look at without revealing the post first. Only applies when blocked posts are hidden; with **Highlight blocked tweets** on, the quote card stays readable and is flagged in amber as before.
- **Always Show from the account card** ([#47](https://github.com/xaitax/x-account-location-device/issues/47)): add or remove the displayed account directly. The action waits for a successful save, reports errors with a retry, and cannot accidentally act on a different account when the card changes.
- **Optional government / multilateral filter** ([#48](https://github.com/xaitax/x-account-location-device/issues/48)): select **Government / multilateral — grey checkmark** under **Blocking → Tags → Account label**, in Settings or the sidebar. Off by default. Matches the author's rendered grey checkmark, including quoted authors, without additional lookups or inference from names, biographies or generic verification. Uses the usual highlight, Always Show and opened-post rules; badge changes are rechecked locally. Unknown or unbadged accounts are not classified.
- **Opened posts remain readable** ([PR #55](https://github.com/xaitax/x-account-location-device/pull/55), adapted): a main post identified by its own timestamp permalink is highlighted instead of hidden. Replies and quoted authors retain their normal filtering. Navigation, delayed timestamps and recycled articles are rechecked; a missing identity is never guessed from tabindex.

### Bug Fixes
- **Quoted name and bio filters** ([#57](https://github.com/xaitax/x-account-location-device/issues/57)): quoted authors use their own names and profile details, including X's linkless quoted-name markup. A handle-like display name cannot substitute the current page's author for the quoted account, and incomplete headers do not treat a handle or timestamp as a name. Available name, bio and account-label filters work even when account-location data is missing or its lookup fails.
- **Emoji name tags with empty image alt text**: recognize X emoji SVG filenames when X leaves the alt attribute blank; arbitrary images and image titles are not treated as emoji text.
- **Highlight mode keeps location-warning accounts visible** ([#50](https://github.com/xaitax/x-account-location-device/issues/50)): the former VPN/proxy-user toggle now follows the same hide/highlight mode as other filters. Its wording explains that X's location warning is not proof of VPN use.
- **Late lookups cannot restore outdated filters or the wrong author**: results are checked against the current row and latest country/tag/allowlist settings. Clearing a filter while a lookup is pending stays effective.
- **Quote visibility updates correctly when settings change**, including previously collapsed quotes; an explicitly revealed quote remains revealed until X recycles it.
- **Country aliases and territory coverage** ([#45](https://github.com/xaitax/x-account-location-device/issues/45), [#49](https://github.com/xaitax/x-account-location-device/issues/49), [#53](https://github.com/xaitax/x-account-location-device/issues/53), [#54](https://github.com/xaitax/x-account-location-device/issues/54)): Côte d'Ivoire, Syrian Arab Republic, Lao People's Democratic Republic and Bonaire now resolve consistently in flags, filtering and device-source countries. Accent/apostrophe variants and previously saved aliases normalize to the same selection.
- **Added Asia, Central Asia and Oceania** ([#46](https://github.com/xaitax/x-account-location-device/issues/46)). Region controls now explicitly describe matching X's regional labels, without implicitly selecting countries.
- **Cache expiry is enforced throughout a session**. Community records retain their source timestamp and remaining lifetime; expired records and recirculated cloud contributions are skipped.
- **List-save failures are reported accurately**: blocked lists and Always Show change in memory only after storage succeeds, and concurrent edits cannot overwrite one another through a failed save.

### Request Reliability
- Background rate-limit deadlines survive worker restarts and respect valid reset/Retry-After headers. Concurrent responses cannot shorten an existing cooldown.
- Page-session fallback lookups are paced and deduplicated, respect 429 cooldowns, and have a deadline covering queueing and the response body. Timeouts release their queue slots.
- Transient failures remain eligible for a later ordinary page scan after backoff; they no longer become permanent page-session misses. No new polling or autonomous retry loop is added.
- These safeguards do **not** establish the cause of the account restriction reported in [#52](https://github.com/xaitax/x-account-location-device/issues/52), which remains unresolved.

### Compatibility
- Existing local records with unknown source age keep their original expiry. Old backup cache entries without source timestamps are skipped on import; settings and filter lists still import.

## [3.5.0] - 2026-08-04

### New
- **Block parody, commentary and fan accounts** ([#41](https://github.com/xaitax/x-account-location-device/issues/41), requested by **@Kaltern75**): X labels accounts that present themselves as parody, commentary or fan accounts, and those labels can now be filtered with one click in **Blocking → Tags**. Read from X's own structured label rather than the display name, so it still works when the name gives nothing away.
- **Block by bio**: filter accounts by what their bio says, alongside the display name. Both live in **Blocking → Tags**, each with its own list, since they match against different text. Adding a term short enough to catch accounts you didn't mean now says so up front.
- **Follower, following and post counts in the account dossier**: hover any badge to see them.
- **All of the above costs no extra lookups.** X already sends this profile data with your timeline; the extension now reads what's there instead of asking for it again, so bios, account types and counts arrive for free and nothing is spent against your rate limit. Only the few values actually used are kept, capped at the 500 most recently seen accounts and dropped when the tab closes, so a long scrolling session can't grow without bound. It stays on your device — never written to disk, never shared with the community cache — and can be switched off in **Settings → Display**.
- **Hide the info icon** ([#38](https://github.com/xaitax/x-account-location-device/issues/38), requested by **@algorythmic**): the circled-i at the end of each badge can be turned off, freeing horizontal space on narrow screens where X truncates long names and handles. Account details still open from the badge itself.
- **Open account details on click**: prefer clicking a badge over hovering it. Touch devices already worked this way; this brings the same option to desktop. Both settings are in **Settings → Display**.
- **The blocking page was reworked**: Settings and the in-page sidebar blocker now share one look. Blocked tags are grouped by what they actually match, and adding a tag broad enough to catch accounts you didn't intend now says so up front.

### Bug Fixes
- **Profiles could show a completely different account** ([#40](https://github.com/xaitax/x-account-location-device/issues/40), reported by **@Martin-L-H**): when a display name was itself written like a handle, the profile header resolved to that account instead of the real one — showing its country and device, and applying every filter to the wrong person. Posts were unaffected, which is why it went unnoticed.
- **Backups containing blocked affiliations failed to import**, stopping partway and leaving the allowlist and cached accounts behind. Every filter, setting and list now imports and exports in full.
- **Added the missing "Caribbean" region**, which X reports but the Regions tab did not offer.
- Hardened the fallback lookup used when the extension can't authenticate, so it can no longer accept data belonging to a different account.

## [3.4.0] - 2026-07-27

### New
- **Block by affiliation**: X shows the parent organisation on affiliated accounts, so blocking one organisation hides every one of its staff accounts at once. Part of the name is enough. Find it in **Settings → Blocking → Affiliations**, and it's part of import/export.
- **Hovering an account now records more about it**: opening an info card reads its affiliation, when the account was created, its account ID and how often the handle has changed, and (with the community cache on) shares those so the next person gets them instantly. So if an account slips past the affiliation filter, hover it once and it stays known. Nothing is ever looked up in the background just to check, so none of this eats into your rate limit.
- **Followers, Verified followers and Following are flagged too**: accounts matching any of your filters now get an amber accent in those lists. They are only ever flagged there, never hidden, so the lists stay complete and the counts still add up.
- **Quoted posts are filtered too** ([#32](https://github.com/xaitax/x-account-location-device/issues/32), requested by **@jackvanwinkle**): a blocked country, region, or tag now collapses the quote card as well, with a "click to show" placeholder suggested by **@TMCAtom**. Only the quote is affected, and highlight mode flags it in amber instead.

### Bug Fixes
- **Quoting a proxied account no longer hides the whole post.** With VPN/proxy hiding on, the entire row disappeared. VPN hiding now only applies to a post's own author.
- **Countries X names differently are now blocked correctly.** Blocking compared names exactly, so picking "North Macedonia" never matched an account X reported as "Macedonia". Same for the UK, US, UAE, Bosnia, Czechia, Myanmar, Macao, Türkiye, Vietnam, Timor-Leste and Russia aliases.
- **Added 42 missing territories**, including Réunion, Jersey, Gibraltar, Guernsey, Isle of Man, Greenland, Martinique, Guadeloupe, Curaçao, Aruba, Bermuda and the Cayman Islands. They previously showed no flag and could not be blocked.
- **Added the missing "East Asia" and "Eastern Europe (Non-EU)" regions**, which X reports but the Regions tab did not offer.

## [3.3.0] - 2026-07-06

### New
- **Always-Show Accounts (allowlist)** ([#26](https://github.com/xaitax/x-account-location-device/issues/26), requested by **@JansthcirlU**): add accounts that should *never* be hidden or highlighted by any filter, whether by country, region, tag, language, or VPN, on the timeline and on their own profile. Ideal for people you follow from a blocked country or friends who post through a VPN. Manage them in the new **Settings → Always-Show** section (just type a handle, the @ is added for you); included in import/export.

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
