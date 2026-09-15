/**
 * X-Posed Extension Constants
 * Centralized configuration for cross-browser compatibility
 *
 * CHANGELOG v2.5.0:
 * - API: MIN_INTERVAL 300→150ms, MAX_CONCURRENT 5→8 (faster lookups)
 * - Cloud: BATCH_DELAY 500→200ms (faster cloud response)
 * - Timing: Reduced delays for snappier UX
 * - Cache: Save interval 30→60s (less I/O)
 */

// Version is injected at build time from package.json
export const VERSION = '__BUILD_VERSION__';

// Storage keys
export const STORAGE_KEYS = {
    CACHE: 'x_location_cache_v4',
    BLOCKED_COUNTRIES: 'x_blocked_countries',
    BLOCKED_REGIONS: 'x_blocked_regions',
    BLOCKED_TAGS: 'x_blocked_tags',
    BLOCKED_BIO_TAGS: 'x_blocked_bio_tags',
    BLOCKED_PCF: 'x_blocked_pcf',
    BLOCKED_LANGUAGES: 'x_blocked_languages',
    BLOCKED_AFFILIATIONS: 'x_blocked_affiliations',
    BLOCKED_LINKS: 'x_blocked_links',
    ALLOWED_USERS: 'x_allowed_users',
    SETTINGS: 'x_location_settings',
    HEADERS: 'x_api_headers',
    THEME: 'x_theme_preference',
    CLOUD_CACHE_ENABLED: 'x_cloud_cache_enabled',
    CLOUD_STATS: 'x_cloud_stats',
    CLOUD_SERVER_STATS: 'x_cloud_server_stats',
    LAST_VERSION: 'x_last_version',
    WHATS_NEW_SEEN: 'x_whats_new_seen'
};

// Cloud Community Cache configuration
// COST + SPEED OPTIMIZATION: Balance between costs and user experience
export const CLOUD_CACHE_CONFIG = {
    // Cloudflare Worker URL
    API_URL: 'https://x-posed-cache.xaitax.workers.dev',

    // Batch settings - balanced for cost and speed
    BATCH_SIZE: 100,             // Max usernames per lookup request
    BATCH_DELAY_MS: 200,         // Idle debounce before a lookup batch flushes
    LOOKUP_MAX_WAIT_MS: 500,     // Hard cap: flush even if lookups keep arriving, so continuous scroll can't starve the batch
    CONTRIBUTE_BATCH_SIZE: 200,  // Max entries per contribute request
    CONTRIBUTE_DELAY_MS: 10000,  // Delay before contributing; kept under the ~30s MV3 idle window so queued contributions upload before the background suspends

    // Timeouts
    LOOKUP_TIMEOUT_MS: 5000,     // Max time to wait for cloud lookup
    CONTRIBUTE_TIMEOUT_MS: 10000, // Max time for contribute request

    // Retry settings
    MAX_RETRIES: 1,              // Reduced retries to save costs
    RETRY_DELAY_MS: 2000,

    // Rate limiting (client-side)
    MAX_REQUESTS_PER_MINUTE: 30
};
// NOTE: there is deliberately no ENABLED_BY_DEFAULT here. Since v3.0.0 the cache is
// turned on for NEW installs only, by handleInstalled() in background/service-worker.js,
// and the live state is read straight from STORAGE_KEYS.CLOUD_CACHE_ENABLED. A constant
// mirroring that would be a second source of truth that nothing reads and everything
// misquotes — the old one claimed "opt-in only" long after it had stopped being true.

// Z-index layering (ensures consistent stacking order)
export const Z_INDEX = {
    BADGE: 1,                    // Info badges on tweets
    MODAL_OVERLAY: 999999,       // Country blocker modal backdrop
    MODAL: 1000000,              // Modal dialog
    EVIDENCE_MODAL: 1000000,     // Evidence capture modal
    TOAST: 1000001               // Toast notifications (always on top)
};

// Timing configuration (in milliseconds)
// PERFORMANCE: Optimized intervals for better responsiveness
export const TIMING = {
    BATCH_PROCESS_MS: 50,           // Delay for batching element processing
    RETRY_DELAY_MS: 100,            // Reduced from 150ms for faster retries
    RESIZE_DEBOUNCE_MS: 300,        // Debounce for window resize events
    SEARCH_DEBOUNCE_MS: 150,        // Reduced from 200ms for snappier search
    SIDEBAR_CHECK_MS: 500,          // Interval for sidebar check
    SIDEBAR_TIMEOUT_MS: 10000,      // Max time to wait for sidebar
    DELAYED_SCAN_MS: 1500,          // Reduced from 2000ms for faster initial load
    OBSERVER_RECONNECT_MS: 100,     // Delay before reconnecting observers
    SAVE_STATUS_DISPLAY_MS: 2000,   // How long to show save status
    CACHE_CLEAR_FEEDBACK_MS: 2000,  // How long to show cache cleared feedback
    RATE_LIMIT_TOAST_COOLDOWN_MS: 60000,  // Cooldown between rate limit toasts
    RATE_LIMIT_CHECK_MS: 10000,     // Interval for rate limit status check
    KEEP_ALIVE_INTERVAL_MS: 20000,  // Service worker keep-alive interval
    NOT_FOUND_CACHE_EXPIRY_MS: 300000, // 5 minutes for not-found cache entries
    NOT_FOUND_CLEANUP_INTERVAL_MS: 30000 // Reduced from 60s for faster memory cleanup
};

// Cache configuration
// PERFORMANCE: Optimized save intervals
export const CACHE_CONFIG = {
    EXPIRY_MS: 60 * 24 * 60 * 60 * 1000, // 60 days (location data rarely changes)
    MAX_ENTRIES: 50000, // LRU cache limit; compact records include source timestamp/provenance
    SAVE_INTERVAL_MS: 60000 // Increased from 30s to reduce I/O overhead
};

// API configuration
// PERFORMANCE: Optimized for faster lookups while respecting rate limits
export const API_CONFIG = {
    QUERY_ID: 'XRqGa7EeokUU5kppkh13EA', // AboutAccountQuery
    BASE_URL: 'https://x.com/i/api/graphql',
    MIN_INTERVAL_MS: 150,    // Reduced from 300ms for faster lookups
    MAX_CONCURRENT: 8,       // Increased from 5 for more parallel requests
    RETRY_DELAY_MS: 1000,    // Reduced from 3000ms, uses exponential backoff
    MAX_RETRIES: 2,
    RATE_LIMIT_WINDOW_MS: 60000
};

// DOM selectors for X platform
export const SELECTORS = {
    USERNAME: '[data-testid="UserName"], [data-testid="User-Name"]',
    TWEET: 'article[data-testid="tweet"]',
    USER_CELL: '[data-testid="UserCell"]',
    PROFILE_LINK: '[data-testid="AppTabBar_Profile_Link"]',
    PRIMARY_NAV: 'nav[aria-label="Primary"]',
    NAV_ROLE: 'nav[role="navigation"]'
};

// CSS class names
export const CSS_CLASSES = {
    FLAG_SHIMMER: 'x-flag-shimmer',
    INFO_BADGE: 'x-info-badge',
    TWEET_BLOCKED: 'x-tweet-blocked',
    MODAL_OVERLAY: 'x-blocker-modal-overlay',
    MODAL: 'x-blocker-modal',
    PROCESSED: 'x-processed'
};

// Message types for cross-context communication
export const MESSAGE_TYPES = {
    // Content script to background
    FETCH_USER_INFO: 'FETCH_USER_INFO',
    FETCH_HOVERCARD_INFO: 'FETCH_HOVERCARD_INFO',
    CAPTURE_HEADERS: 'CAPTURE_HEADERS',
    GET_CACHE: 'GET_CACHE',
    SET_CACHE: 'SET_CACHE',
    GET_SETTINGS: 'GET_SETTINGS',
    SET_SETTINGS: 'SET_SETTINGS',
    GET_BLOCKED_COUNTRIES: 'GET_BLOCKED_COUNTRIES',
    SET_BLOCKED_COUNTRIES: 'SET_BLOCKED_COUNTRIES',
    GET_BLOCKED_REGIONS: 'GET_BLOCKED_REGIONS',
    SET_BLOCKED_REGIONS: 'SET_BLOCKED_REGIONS',
    GET_BLOCKED_TAGS: 'GET_BLOCKED_TAGS',
    SET_BLOCKED_TAGS: 'SET_BLOCKED_TAGS',
    GET_BLOCKED_BIO_TAGS: 'GET_BLOCKED_BIO_TAGS',
    SET_BLOCKED_BIO_TAGS: 'SET_BLOCKED_BIO_TAGS',
    GET_BLOCKED_PCF: 'GET_BLOCKED_PCF',
    SET_BLOCKED_PCF: 'SET_BLOCKED_PCF',
    GET_BLOCKED_LANGUAGES: 'GET_BLOCKED_LANGUAGES',
    SET_BLOCKED_LANGUAGES: 'SET_BLOCKED_LANGUAGES',
    GET_BLOCKED_AFFILIATIONS: 'GET_BLOCKED_AFFILIATIONS',
    SET_BLOCKED_AFFILIATIONS: 'SET_BLOCKED_AFFILIATIONS',
    GET_BLOCKED_LINKS: 'GET_BLOCKED_LINKS',
    SET_BLOCKED_LINKS: 'SET_BLOCKED_LINKS',
    GET_ALLOWED_USERS: 'GET_ALLOWED_USERS',
    SET_ALLOWED_USERS: 'SET_ALLOWED_USERS',
    GET_STATISTICS: 'GET_STATISTICS',
    GET_THEME: 'GET_THEME',
    SET_THEME: 'SET_THEME',
    GET_RATE_LIMIT_STATUS: 'GET_RATE_LIMIT_STATUS',
    
    // Import/Export
    IMPORT_DATA: 'IMPORT_DATA',
    
    // Cloud cache
    GET_CLOUD_CACHE_STATUS: 'GET_CLOUD_CACHE_STATUS',
    SET_CLOUD_CACHE_ENABLED: 'SET_CLOUD_CACHE_ENABLED',
    GET_CLOUD_STATS: 'GET_CLOUD_STATS',
    GET_CLOUD_SERVER_STATS: 'GET_CLOUD_SERVER_STATS',
    SYNC_LOCAL_TO_CLOUD: 'SYNC_LOCAL_TO_CLOUD',
    
    // Background to content script
    SETTINGS_UPDATED: 'SETTINGS_UPDATED',
    BLOCKED_COUNTRIES_UPDATED: 'BLOCKED_COUNTRIES_UPDATED',
    BLOCKED_REGIONS_UPDATED: 'BLOCKED_REGIONS_UPDATED',
    BLOCKED_TAGS_UPDATED: 'BLOCKED_TAGS_UPDATED',
    BLOCKED_BIO_TAGS_UPDATED: 'BLOCKED_BIO_TAGS_UPDATED',
    BLOCKED_PCF_UPDATED: 'BLOCKED_PCF_UPDATED',
    BLOCKED_LANGUAGES_UPDATED: 'BLOCKED_LANGUAGES_UPDATED',
    BLOCKED_AFFILIATIONS_UPDATED: 'BLOCKED_AFFILIATIONS_UPDATED',
    BLOCKED_LINKS_UPDATED: 'BLOCKED_LINKS_UPDATED',
    ALLOWED_USERS_UPDATED: 'ALLOWED_USERS_UPDATED',
    THEME_UPDATED: 'THEME_UPDATED'

    // NOTE: page script ↔ content script does NOT go through MESSAGE_TYPES. It uses
    // CustomEvents named 'x-posed-headers-captured', 'x-posed-fetch-user-info' and
    // 'x-posed-fetch-user-info-result', declared locally in page-script.js — the page
    // script runs in the MAIN world and cannot import from here.
};

// Default settings
export const DEFAULT_SETTINGS = {
    enabled: true,
    showFlags: true,
    flagFromDevice: false,  // Use the device's country for the flag instead of the account location (issue #17); falls back to location for web/unknown
    showDevices: true,
    showVpnIndicator: true,
    showVpnUsers: true,  // Show tweets from users with VPN/proxy detected
    showInfoIcon: true,  // The circled-i at the end of the badge (issue #38). Hiding it frees
    // horizontal space on narrow/mobile layouts, where X truncates the name and handle to fit.
    // The badge stays hoverable/clickable either way, so nothing becomes unreachable.
    hovercardTrigger: 'hover',  // 'hover' | 'click' — how the account dossier opens on
    // pointer devices. Touch devices are always click-to-toggle (they have no hover).
    showCaptureButton: true,  // The badge "Share" button (capture + quote/reply/post to X)
    showSidebarBlockerLink: true,
    openChangelogOnUpdate: true,  // Open the "What's New"/changelog tab after a major/minor update (issue #24)
    debugMode: false,
    // Read the profile data X already sends with the timeline (bio, account label, follower
    // counts) instead of requesting it. Costs no extra API calls and never leaves the device.
    // Exposed as a kill switch because X can change these response shapes without notice.
    profileEnrichment: true,
    // NOTE: the community cache is NOT a setting here. It lives in its own storage key
    // (STORAGE_KEYS.CLOUD_CACHE_ENABLED) because the background reads it before settings
    // load. A `cloudCacheEnabled: false` used to sit here, read by nothing, riding along
    // in every settings export saying "false" even for users who had the cache on.
    highlightBlockedTweets: false  // If true, highlight instead of hide blocked tweets
};

// Bearer token for X API (public, embedded in X's own code)
export const BEARER_TOKEN = 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';

// Country flags mapping (optimized for O(1) lookup)
export const COUNTRY_FLAGS = {
    'afghanistan': '🇦🇫', 'albania': '🇦🇱', 'algeria': '🇩🇿', 'andorra': '🇦🇩', 'angola': '🇦🇴',
    'antigua and barbuda': '🇦🇬', 'argentina': '🇦🇷', 'armenia': '🇦🇲', 'australia': '🇦🇺', 'austria': '🇦🇹',
    'azerbaijan': '🇦🇿', 'bahamas': '🇧🇸', 'bahrain': '🇧🇭', 'bangladesh': '🇧🇩', 'barbados': '🇧🇧',
    'belarus': '🇧🇾', 'belgium': '🇧🇪', 'belize': '🇧🇿', 'benin': '🇧🇯', 'bhutan': '🇧🇹',
    'bolivia': '🇧🇴', 'bosnia and herzegovina': '🇧🇦', 'bosnia': '🇧🇦', 'botswana': '🇧🇼', 'brazil': '🇧🇷',
    'brunei': '🇧🇳', 'bulgaria': '🇧🇬', 'burkina faso': '🇧🇫', 'burundi': '🇧🇮', 'cambodia': '🇰🇭',
    'cameroon': '🇨🇲', 'canada': '🇨🇦', 'cape verde': '🇨🇻', 'central african republic': '🇨🇫', 'chad': '🇹🇩',
    'chile': '🇨🇱', 'china': '🇨🇳', 'colombia': '🇨🇴', 'comoros': '🇰🇲', 'congo': '🇨🇬',
    'costa rica': '🇨🇷', 'croatia': '🇭🇷', 'cuba': '🇨🇺', 'cyprus': '🇨🇾', 'czech republic': '🇨🇿',
    'czechia': '🇨🇿', 'democratic republic of the congo': '🇨🇩', 'denmark': '🇩🇰', 'djibouti': '🇩🇯', 'dominica': '🇩🇲',
    'dominican republic': '🇩🇴', 'east timor': '🇹🇱', 'ecuador': '🇪🇨', 'egypt': '🇪🇬', 'el salvador': '🇸🇻',
    'england': '🏴󠁧󠁢󠁥󠁮󠁧󠁿', 'equatorial guinea': '🇬🇶', 'eritrea': '🇪🇷', 'estonia': '🇪🇪', 'eswatini': '🇸🇿',
    'ethiopia': '🇪🇹', 'europe': '🇪🇺', 'european union': '🇪🇺', 'fiji': '🇫🇯', 'finland': '🇫🇮',
    'france': '🇫🇷', 'gabon': '🇬🇦', 'gambia': '🇬🇲', 'georgia': '🇬🇪', 'germany': '🇩🇪',
    'ghana': '🇬🇭', 'greece': '🇬🇷', 'grenada': '🇬🇩', 'guatemala': '🇬🇹', 'guinea': '🇬🇳',
    'guinea-bissau': '🇬🇼', 'guyana': '🇬🇾', 'haiti': '🇭🇹', 'honduras': '🇭🇳', 'hong kong': '🇭🇰',
    'hungary': '🇭🇺', 'iceland': '🇮🇸', 'india': '🇮🇳', 'indonesia': '🇮🇩', 'iran': '🇮🇷',
    'iraq': '🇮🇶', 'ireland': '🇮🇪', 'israel': '🇮🇱', 'italy': '🇮🇹', 'ivory coast': '🇨🇮',
    'jamaica': '🇯🇲', 'japan': '🇯🇵', 'jordan': '🇯🇴', 'kazakhstan': '🇰🇿', 'kenya': '🇰🇪',
    'kiribati': '🇰🇮', 'korea': '🇰🇷', 'kosovo': '🇽🇰', 'kuwait': '🇰🇼', 'kyrgyzstan': '🇰🇬',
    'laos': '🇱🇦', 'latvia': '🇱🇻', 'lebanon': '🇱🇧', 'lesotho': '🇱🇸', 'liberia': '🇱🇷',
    'libya': '🇱🇾', 'liechtenstein': '🇱🇮', 'lithuania': '🇱🇹', 'luxembourg': '🇱🇺', 'macao': '🇲🇴',
    'macau': '🇲🇴', 'madagascar': '🇲🇬', 'malawi': '🇲🇼', 'malaysia': '🇲🇾', 'maldives': '🇲🇻',
    'mali': '🇲🇱', 'malta': '🇲🇹', 'marshall islands': '🇲🇭', 'mauritania': '🇲🇷', 'mauritius': '🇲🇺',
    'mexico': '🇲🇽', 'micronesia': '🇫🇲', 'moldova': '🇲🇩', 'monaco': '🇲🇨', 'mongolia': '🇲🇳',
    'montenegro': '🇲🇪', 'morocco': '🇲🇦', 'mozambique': '🇲🇿', 'myanmar': '🇲🇲', 'burma': '🇲🇲',
    'namibia': '🇳🇦', 'nauru': '🇳🇷', 'nepal': '🇳🇵', 'netherlands': '🇳🇱', 'new zealand': '🇳🇿',
    'nicaragua': '🇳🇮', 'niger': '🇳🇪', 'nigeria': '🇳🇬', 'north korea': '🇰🇵', 'north macedonia': '🇲🇰',
    'macedonia': '🇲🇰', 'norway': '🇳🇴', 'oman': '🇴🇲', 'pakistan': '🇵🇰', 'palau': '🇵🇼',
    'palestine': '🇵🇸', 'panama': '🇵🇦', 'papua new guinea': '🇵🇬', 'paraguay': '🇵🇾', 'peru': '🇵🇪',
    'philippines': '🇵🇭', 'poland': '🇵🇱', 'portugal': '🇵🇹', 'puerto rico': '🇵🇷', 'qatar': '🇶🇦',
    'romania': '🇷🇴', 'russia': '🇷🇺', 'russian federation': '🇷🇺', 'rwanda': '🇷🇼', 'saint kitts and nevis': '🇰🇳',
    'saint lucia': '🇱🇨', 'saint vincent and the grenadines': '🇻🇨', 'samoa': '🇼🇸', 'san marino': '🇸🇲', 'sao tome and principe': '🇸🇹',
    'saudi arabia': '🇸🇦', 'scotland': '🏴󠁧󠁢󠁳󠁣󠁴󠁿', 'senegal': '🇸🇳', 'serbia': '🇷🇸', 'seychelles': '🇸🇨',
    'sierra leone': '🇸🇱', 'singapore': '🇸🇬', 'slovakia': '🇸🇰', 'slovenia': '🇸🇮', 'solomon islands': '🇸🇧',
    'somalia': '🇸🇴', 'south africa': '🇿🇦', 'south korea': '🇰🇷', 'south sudan': '🇸🇸', 'spain': '🇪🇸',
    'sri lanka': '🇱🇰', 'sudan': '🇸🇩', 'suriname': '🇸🇷', 'sweden': '🇸🇪', 'switzerland': '🇨🇭',
    'syria': '🇸🇾', 'taiwan': '🇹🇼', 'tajikistan': '🇹🇯', 'tanzania': '🇹🇿', 'thailand': '🇹🇭',
    'timor-leste': '🇹🇱', 'togo': '🇹🇬', 'tonga': '🇹🇴', 'trinidad and tobago': '🇹🇹', 'tunisia': '🇹🇳',
    'turkey': '🇹🇷', 'türkiye': '🇹🇷', 'turkmenistan': '🇹🇲', 'tuvalu': '🇹🇻', 'uganda': '🇺🇬',
    'ukraine': '🇺🇦', 'united arab emirates': '🇦🇪', 'uae': '🇦🇪', 'united kingdom': '🇬🇧', 'uk': '🇬🇧',
    'great britain': '🇬🇧', 'britain': '🇬🇧', 'united states': '🇺🇸', 'usa': '🇺🇸', 'us': '🇺🇸',
    'uruguay': '🇺🇾', 'uzbekistan': '🇺🇿', 'vanuatu': '🇻🇺', 'vatican city': '🇻🇦', 'venezuela': '🇻🇪',
    'vietnam': '🇻🇳', 'viet nam': '🇻🇳', 'wales': '🏴󠁧󠁢󠁷󠁬󠁳󠁿', 'yemen': '🇾🇪', 'zambia': '🇿🇲', 'zimbabwe': '🇿🇼',

    // Territories, dependencies and overseas regions. X reports these as the account
    // location in their own right, so without them the badge showed no flag and the
    // country could not be blocked at all (reported for Réunion, Jersey, Gibraltar).
    'aland islands': '🇦🇽', 'american samoa': '🇦🇸', 'anguilla': '🇦🇮', 'aruba': '🇦🇼', 'bermuda': '🇧🇲',
    'bonaire': '🇧🇶', // ISO BQ: Bonaire, Sint Eustatius and Saba (issue #53).
    'british virgin islands': '🇻🇬', 'cayman islands': '🇰🇾', 'christmas island': '🇨🇽', 'cook islands': '🇨🇰', 'curaçao': '🇨🇼',
    'curacao': '🇨🇼', 'falkland islands': '🇫🇰', 'faroe islands': '🇫🇴', 'french guiana': '🇬🇫', 'french polynesia': '🇵🇫',
    'gibraltar': '🇬🇮', 'greenland': '🇬🇱', 'guadeloupe': '🇬🇵', 'guam': '🇬🇺', 'guernsey': '🇬🇬',
    'isle of man': '🇮🇲', 'jersey': '🇯🇪', 'martinique': '🇲🇶', 'mayotte': '🇾🇹', 'montserrat': '🇲🇸',
    'new caledonia': '🇳🇨', 'norfolk island': '🇳🇫', 'northern mariana islands': '🇲🇵', 'niue': '🇳🇺', 'réunion': '🇷🇪',
    'reunion': '🇷🇪', 'saint barthelemy': '🇧🇱', 'saint helena': '🇸🇭', 'saint martin': '🇲🇫', 'saint pierre and miquelon': '🇵🇲',
    'sint maarten': '🇸🇽', 'svalbard': '🇸🇯', 'tokelau': '🇹🇰', 'turks and caicos islands': '🇹🇨', 'us virgin islands': '🇻🇮',
    'wallis and futuna': '🇼🇫', 'western sahara': '🇪🇭'
};

/**
 * Alternative names X may report for a country, mapped to the single name the UI
 * offers. Blocking compares exact strings, so without this a user who blocked
 * "North Macedonia" was never matched against an account X reported as "Macedonia"
 * (and the same for the UK/US/UAE aliases). Keys and values are lowercase.
 */
export const COUNTRY_ALIASES = {
    'bonaire, sint eustatius and saba': 'bonaire',
    'bosnia': 'bosnia and herzegovina',
    'britain': 'united kingdom',
    'burma': 'myanmar',
    "cote d'ivoire": 'ivory coast',
    'curacao': 'curaçao',
    'czechia': 'czech republic',
    'east timor': 'timor-leste',
    'great britain': 'united kingdom',
    'korea': 'south korea',
    "lao people's democratic republic": 'laos',
    'macau': 'macao',
    'macedonia': 'north macedonia',
    'reunion': 'réunion',
    'russian federation': 'russia',
    'syrian arab republic': 'syria',
    'türkiye': 'turkey',
    'uae': 'united arab emirates',
    'uk': 'united kingdom',
    'us': 'united states',
    'usa': 'united states',
    'viet nam': 'vietnam'
};

/**
 * Was this record actually inspected for an affiliation?
 *
 * SINGLE SOURCE OF TRUTH for the affiliation contract — the background, the content
 * script and the cloud client all decide the same question and must not drift.
 *
 * The marker is the EXISTENCE of `affiliateUsername`, not its value. Both full parsers
 * always emit it (null when the account has none); records written by older code paths,
 * and the shared community-cache subset, omit it entirely. Absence therefore means
 * "nobody has looked", which is different from "looked, found none" — collapsing the two
 * is what makes an affiliation filter quietly under-block.
 *
 * Deliberately NOT keyed on restId: the in-page fallback used to emit restId without ever
 * reading the affiliation, so those records would masquerade as confirmed-unaffiliated.
 * @param {{affiliate?: object|null, affiliateUsername?: string|null}|null|undefined} meta
 * @returns {boolean}
 */
export function affiliationWasChecked(meta) {
    if (!meta) return false;
    return meta.affiliateUsername !== undefined || !!meta.affiliate;
}

// Normalize spelling only for lookups. Canonical names retain their existing accents
// so stored selections such as "réunion" remain compatible. X uses both straight and
// typographic apostrophes in names such as Côte d'Ivoire and Lao People's Democratic
// Republic; decomposed accents must resolve to the same selection too (#45, #54).
function countryLookupKey(name) {
    return name.normalize('NFKD')
        .replace(/\p{M}/gu, '')
        .replace(/[\u2018\u2019\u02bc]/g, "'");
}

const COUNTRY_NAME_LOOKUP = new Map(
    Object.keys(COUNTRY_FLAGS).map(name => [countryLookupKey(name), name])
);
for (const [alias, canonical] of Object.entries(COUNTRY_ALIASES)) {
    COUNTRY_NAME_LOOKUP.set(countryLookupKey(alias), canonical);
}

/**
 * Hosts that appear on a large share of all profiles. Blocking one is almost never what
 * was meant, so the input warns first — the same courtesy describeTagRisk() extends to a
 * display-name tag short enough to over-match.
 */
export const OVERBROAD_HOSTS = new Set([
    'bit.ly', 'facebook.com', 'github.com', 'google.com', 'instagram.com',
    'linktr.ee', 'reddit.com', 'substack.com', 'tiktok.com', 'twitch.tv',
    'twitter.com', 'x.com', 'youtu.be', 'youtube.com'
]);

const HOST_PATTERN =
    /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

/**
 * Reduce a typed domain OR a full URL to the bare lowercase host used for storage and
 * comparison. Accepts what people actually paste; returns '' for anything that cannot be
 * a host, so it can be used directly as a BlockedSetStorage normalizer.
 *
 *   'https://www.Throne.com/abc?x=1' → 'throne.com'
 *   'throne.com/'                    → 'throne.com'
 *   'not a domain'                   → ''
 *
 * @param {string|null|undefined} input
 * @returns {string}
 */
export function normalizeHost(input) {
    if (!input || typeof input !== 'string') return '';

    let value = input.trim().toLowerCase();
    if (value === '') return '';

    value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');  // scheme
    value = value.replace(/^[^/@]*@/, '');                  // userinfo
    value = value.split(/[/?#]/)[0];                        // path, query, fragment
    value = value.replace(/:\d+$/, '');                     // port
    value = value.replace(/\.+$/, '');                      // trailing dots
    value = value.replace(/^www\./, '');                    // www prefix

    if (value === '' || value.length > 253) return '';
    return HOST_PATTERN.test(value) ? value : '';
}

/**
 * Exact host or a subdomain of it — never a bare substring.
 *
 * A substring test would make 'throne.com' match 'not-throne.com' (a false positive) and,
 * worse, 'throne.com.example.net' (a one-line evasion for anyone who noticed).
 * @param {string} host
 * @param {string} domain
 * @returns {boolean}
 */
export function hostMatchesDomain(host, domain) {
    if (!host || !domain) return false;
    return host === domain || host.endsWith(`.${domain}`);
}

/**
 * First blocked domain an account's profile hosts match.
 *
 * Returns the domain rather than a boolean so the block marker can name the reason, the
 * way the country and tag filters already do. `blocked` may be a Set (content script) or
 * an array (anywhere else).
 * @param {string[]|null|undefined} hosts
 * @param {Set<string>|string[]|null|undefined} blocked
 * @returns {string|null}
 */
export function findBlockedLink(hosts, blocked) {
    if (!hosts?.length || !blocked) return null;
    const size = blocked.size ?? blocked.length;
    if (!size) return null;

    for (const host of hosts) {
        for (const domain of blocked) {
            if (hostMatchesDomain(host, domain)) return domain;
        }
    }
    return null;
}


/**
 * Resolve X's location spelling to the lowercase country name used by the picker
 * and stored filters. Unknown names retain their spelling apart from case and
 * whitespace. This never infers a region or expands one into member countries.
 * @param {string|null|undefined} name
 * @returns {string} canonical lowercase name, or '' when there is nothing to resolve
 */
export function canonicalCountry(name) {
    if (!name || typeof name !== 'string') return '';
    const key = name.trim().toLowerCase().replace(/\s+/g, ' ');
    if (key === '') return '';
    return COUNTRY_NAME_LOOKUP.get(countryLookupKey(key)) || key;
}

// Get sorted country list for UI
export const COUNTRY_LIST = [...new Set(Object.keys(COUNTRY_FLAGS).map(canonicalCountry))]
    // Show each country once, under the canonical name. Derived from COUNTRY_ALIASES so
    // the picker and the block comparison can never disagree about which name wins.
    .sort();

// Region display names (for UI) with geographic globe emojis
// 🌍 = Africa, Europe, Middle East (Europe/Africa visible)
// 🌎 = Americas (Americas visible)
// 🌏 = Asia, Oceania (Asia/Australia visible)
export const REGION_DATA = [
    { name: 'Africa', key: 'africa', flag: '🌍' },
    { name: 'Asia', key: 'asia', flag: '🌏' },
    { name: 'Australasia', key: 'australasia', flag: '🌏' },
    { name: 'Caribbean', key: 'caribbean', flag: '🌎' },
    { name: 'Central Asia', key: 'central asia', flag: '🌏' },
    { name: 'East Asia', key: 'east asia', flag: '🌏' },
    { name: 'East Asia & Pacific', key: 'east asia & pacific', flag: '🌏' },
    { name: 'Eastern Europe (Non-EU)', key: 'eastern europe (non-eu)', flag: '🌍' },
    { name: 'Europe', key: 'europe', flag: '🌍' },
    { name: 'North Africa', key: 'north africa', flag: '🌍' },
    { name: 'North America', key: 'north america', flag: '🌎' },
    { name: 'Oceania', key: 'oceania', flag: '🌏' },
    { name: 'South America', key: 'south america', flag: '🌎' },
    { name: 'South Asia', key: 'south asia', flag: '🌏' },
    { name: 'Southeast Asia', key: 'southeast asia', flag: '🌏' },
    { name: 'West Asia', key: 'west asia', flag: '🌍' }
];

// Region flags lookup by lowercase key
export const REGION_FLAGS = Object.fromEntries(
    REGION_DATA.map(r => [r.key, r.flag])
);

// Region display name lookup by lowercase key
export const REGION_NAMES = Object.fromEntries(
    REGION_DATA.map(r => [r.key, r.name])
);

// Get sorted region list for UI (returns array of {name, key, flag} objects)
export const REGION_LIST = REGION_DATA;

/**
 * Check if a location is a region (not a country)
 * @param {string} location - Location string to check
 * @returns {boolean} - True if location is a region
 */
export function isRegion(location) {
    return Object.hasOwn(REGION_FLAGS, canonicalCountry(location));
}

/**
 * X's Parody / Commentary / Fan labels (issue #41).
 *
 * X exposes this as a structured `parody_commentary_fan_label` enum on the user object in
 * its own timeline responses, so it is read exactly rather than scraped — no locale
 * dependence and no guessing at icon asset names. "None" means the account carries no label.
 */
export const PCF_LABELS = [
    { value: 'parody', name: 'Parody' },
    { value: 'commentary', name: 'Commentary' },
    { value: 'fan', name: 'Fan' }
];

export const PCF_LABEL_NAMES = Object.fromEntries(PCF_LABELS.map(l => [l.value, l.name]));

// Account-label filtering also supports X's rendered grey verification badge. Keep
// this separate from the PCF enum: a government badge is not an authenticity label.
export const GOVERNMENT_LABEL = 'government';
export const ACCOUNT_LABELS = [
    ...PCF_LABELS,
    { value: GOVERNMENT_LABEL, name: 'Government / multilateral — grey checkmark' }
];

/**
 * Normalise X's raw label to our stored value, or '' when the account has none.
 * @param {string|null|undefined} raw
 * @returns {string}
 */
export function normalizePcfLabel(raw) {
    if (!raw || typeof raw !== 'string') return '';
    const value = raw.trim().toLowerCase();
    if (value === '' || value === 'none') return '';
    return value;
}

/**
 * Memory budget for the profile data harvested from X's own timeline responses.
 *
 * This data is SESSION-ONLY and never written to storage: bios are personal free text and
 * follower counts go stale within minutes, so persisting either would be both a privacy
 * problem and wrong. The cache is a bounded LRU, so a long scrolling session evicts rather
 * than grows — at these limits the worst case is roughly 500 × ~550 B ≈ 270 KB.
 */
export const PROFILE_CACHE_CONFIG = {
    MAX_ENTRIES: 500,
    MAX_BIO_LENGTH: 200,
    // Hard ceiling on nodes visited while walking one response, so a pathological payload
    // can't pin the main thread. X sends ~20 tweets per page; this is orders of magnitude
    // above what that needs. Capped so a bio stuffed with links can't inflate one record; a real profile has one or two.
    MAX_LINKS: 12,
    MAX_WALK_NODES: 200000
};

// Curated list of languages that can be blocked by post language (issue #25).
// X tags each tweet's text with its own ML-detected BCP-47 language on the
// `<div data-testid="tweetText" lang="…">` node; we block on the primary subtag
// (so "zh" also catches "zh-Hant"/"zh-Hans"). `code` is the lowercase primary
// subtag we match against; `native` is the endonym shown next to the English name.
export const LANGUAGE_DATA = [
    { code: 'ar', name: 'Arabic', native: 'العربية' },
    { code: 'bn', name: 'Bengali', native: 'বাংলা' },
    { code: 'bg', name: 'Bulgarian', native: 'Български' },
    { code: 'ca', name: 'Catalan', native: 'Català' },
    { code: 'zh', name: 'Chinese', native: '中文' },
    { code: 'hr', name: 'Croatian', native: 'Hrvatski' },
    { code: 'cs', name: 'Czech', native: 'Čeština' },
    { code: 'da', name: 'Danish', native: 'Dansk' },
    { code: 'nl', name: 'Dutch', native: 'Nederlands' },
    { code: 'en', name: 'English', native: 'English' },
    { code: 'et', name: 'Estonian', native: 'Eesti' },
    { code: 'fi', name: 'Finnish', native: 'Suomi' },
    { code: 'fr', name: 'French', native: 'Français' },
    { code: 'de', name: 'German', native: 'Deutsch' },
    { code: 'el', name: 'Greek', native: 'Ελληνικά' },
    { code: 'gu', name: 'Gujarati', native: 'ગુજરાતી' },
    { code: 'he', name: 'Hebrew', native: 'עברית' },
    { code: 'hi', name: 'Hindi', native: 'हिन्दी' },
    { code: 'hu', name: 'Hungarian', native: 'Magyar' },
    { code: 'id', name: 'Indonesian', native: 'Bahasa Indonesia' },
    { code: 'it', name: 'Italian', native: 'Italiano' },
    { code: 'ja', name: 'Japanese', native: '日本語' },
    { code: 'kn', name: 'Kannada', native: 'ಕನ್ನಡ' },
    { code: 'ko', name: 'Korean', native: '한국어' },
    { code: 'lv', name: 'Latvian', native: 'Latviešu' },
    { code: 'lt', name: 'Lithuanian', native: 'Lietuvių' },
    { code: 'ms', name: 'Malay', native: 'Bahasa Melayu' },
    { code: 'mr', name: 'Marathi', native: 'मराठी' },
    { code: 'no', name: 'Norwegian', native: 'Norsk' },
    { code: 'fa', name: 'Persian', native: 'فارسی' },
    { code: 'pl', name: 'Polish', native: 'Polski' },
    { code: 'pt', name: 'Portuguese', native: 'Português' },
    { code: 'pa', name: 'Punjabi', native: 'ਪੰਜਾਬੀ' },
    { code: 'ro', name: 'Romanian', native: 'Română' },
    { code: 'ru', name: 'Russian', native: 'Русский' },
    { code: 'sr', name: 'Serbian', native: 'Српски' },
    { code: 'sk', name: 'Slovak', native: 'Slovenčina' },
    { code: 'sl', name: 'Slovenian', native: 'Slovenščina' },
    { code: 'es', name: 'Spanish', native: 'Español' },
    { code: 'sv', name: 'Swedish', native: 'Svenska' },
    { code: 'ta', name: 'Tamil', native: 'தமிழ்' },
    { code: 'te', name: 'Telugu', native: 'తెలుగు' },
    { code: 'th', name: 'Thai', native: 'ไทย' },
    { code: 'tl', name: 'Filipino', native: 'Filipino' },
    { code: 'tr', name: 'Turkish', native: 'Türkçe' },
    { code: 'uk', name: 'Ukrainian', native: 'Українська' },
    { code: 'ur', name: 'Urdu', native: 'اردو' },
    { code: 'vi', name: 'Vietnamese', native: 'Tiếng Việt' }
];

// Sorted language list for UI (array of {code, name, native} objects)
export const LANGUAGE_LIST = [...LANGUAGE_DATA].sort((a, b) => a.name.localeCompare(b.name));

// Language display-name lookup by lowercase code (for rendering blocked codes)
export const LANGUAGE_NAMES = Object.fromEntries(
    LANGUAGE_DATA.map(l => [l.code, l.name])
);
