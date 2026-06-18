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
    BATCH_DELAY_MS: 200,         // Reduced from 500ms for faster UX
    CONTRIBUTE_BATCH_SIZE: 200,  // Max entries per contribute request
    CONTRIBUTE_DELAY_MS: 10000,  // Delay before contributing; kept under the ~30s MV3 idle window so queued contributions upload before the background suspends

    // Timeouts
    LOOKUP_TIMEOUT_MS: 5000,     // Max time to wait for cloud lookup
    CONTRIBUTE_TIMEOUT_MS: 10000, // Max time for contribute request

    // Retry settings
    MAX_RETRIES: 1,              // Reduced retries to save costs
    RETRY_DELAY_MS: 2000,

    // Rate limiting (client-side)
    MAX_REQUESTS_PER_MINUTE: 30,

    // Feature flags
    ENABLED_BY_DEFAULT: false    // Opt-in only
};

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
    MAX_ENTRIES: 50000, // LRU cache limit (each entry is ~100-200 bytes)
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
    USER_INFO_RESULT: 'USER_INFO_RESULT',
    SETTINGS_UPDATED: 'SETTINGS_UPDATED',
    BLOCKED_COUNTRIES_UPDATED: 'BLOCKED_COUNTRIES_UPDATED',
    BLOCKED_REGIONS_UPDATED: 'BLOCKED_REGIONS_UPDATED',
    BLOCKED_TAGS_UPDATED: 'BLOCKED_TAGS_UPDATED',
    THEME_UPDATED: 'THEME_UPDATED',

    // Page script to content script (via custom events)
    HEADERS_CAPTURED: 'X_HEADERS_CAPTURED',
    API_REQUEST: 'X_API_REQUEST'
};

// Default settings
export const DEFAULT_SETTINGS = {
    enabled: true,
    showFlags: true,
    flagFromDevice: false,  // Use the device's country for the flag instead of the account location (issue #17); falls back to location for web/unknown
    showDevices: true,
    showVpnIndicator: true,
    showVpnUsers: true,  // Show tweets from users with VPN/proxy detected
    showCaptureButton: true,  // The badge "Share" button (capture + quote/reply/post to X)
    showSidebarBlockerLink: true,
    debugMode: false,
    cloudCacheEnabled: false,  // Opt-in only
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
    'vietnam': '🇻🇳', 'viet nam': '🇻🇳', 'wales': '🏴󠁧󠁢󠁷󠁬󠁳󠁿', 'yemen': '🇾🇪', 'zambia': '🇿🇲', 'zimbabwe': '🇿🇼'
};

// Get sorted country list for UI
export const COUNTRY_LIST = Object.keys(COUNTRY_FLAGS)
    .filter(name => {
        // Remove duplicates (keep canonical names)
        const duplicates = ['bosnia', 'czechia', 'macedonia', 'burma', 'macau', 'uk', 'usa', 'us', 'uae', 'britain', 'great britain'];
        return !duplicates.includes(name);
    })
    .sort();

// Region display names (for UI) with geographic globe emojis
// 🌍 = Africa, Europe, Middle East (Europe/Africa visible)
// 🌎 = Americas (Americas visible)
// 🌏 = Asia, Oceania (Asia/Australia visible)
export const REGION_DATA = [
    { name: 'Africa', key: 'africa', flag: '🌍' },
    { name: 'Australasia', key: 'australasia', flag: '🌏' },
    { name: 'East Asia & Pacific', key: 'east asia & pacific', flag: '🌏' },
    { name: 'Europe', key: 'europe', flag: '🌍' },
    { name: 'North Africa', key: 'north africa', flag: '🌍' },
    { name: 'North America', key: 'north america', flag: '🌎' },
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
    if (!location) return false;
    return Object.hasOwn(REGION_FLAGS, location.toLowerCase());
}

