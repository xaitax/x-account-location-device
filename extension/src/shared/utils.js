/**
 * Utility Functions
 * Common helpers used across the extension
 * @module utils
 */

import { COUNTRY_FLAGS } from './constants.js';

/**
 * Unified logging utility with consistent formatting.
 * Provides debug, info, warn, error levels with extension prefix.
 * @type {{
 *   debug: (...args: any[]) => void,
 *   info: (...args: any[]) => void,
 *   warn: (...args: any[]) => void,
 *   error: (...args: any[]) => void,
 *   setDebugMode: (enabled: boolean) => void
 * }}
 */
export const logger = (() => {
    let debugEnabled = false;
    const PREFIX = 'X-Posed:';
    
    return {
        setDebugMode: enabled => { debugEnabled = enabled; },
        debug: (...args) => { if (debugEnabled) console.log('🔍', PREFIX, ...args); },
        info: (...args) => { console.log('ℹ️', PREFIX, ...args); },
        warn: (...args) => { console.warn('⚠️', PREFIX, ...args); },
        error: (...args) => { console.error('❌', PREFIX, ...args); }
    };
})();

/**
 * Debounce function - delays execution until after wait milliseconds have elapsed
 * since the last time the debounced function was invoked.
 * @template {Function} T
 * @param {T} func - The function to debounce
 * @param {number} wait - The number of milliseconds to delay
 * @param {boolean} [immediate=false] - If true, trigger the function on the leading edge instead of trailing
 * @returns {T & {cancel: () => void}} - The debounced function with a cancel method
 */
export function debounce(func, wait, immediate = false) {
    let timeout;
    return function executedFunction(...args) {
        const context = this;
        const later = function() {
            timeout = null;
            if (!immediate) func.apply(context, args);
        };
        const callNow = immediate && !timeout;
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
        if (callNow) func.apply(context, args);
    };
}

/**
 * Throttle function - ensures function is called at most once per wait period.
 * @template {Function} T
 * @param {T} func - The function to throttle
 * @param {number} wait - The minimum time between function calls in milliseconds
 * @returns {T} - The throttled function
 */
export function throttle(func, wait) {
    let lastCall = 0;
    let timeout = null;
    
    return function executedFunction(...args) {
        const now = Date.now();
        const remaining = wait - (now - lastCall);
        
        if (remaining <= 0) {
            if (timeout) {
                clearTimeout(timeout);
                timeout = null;
            }
            lastCall = now;
            func.apply(this, args);
        } else if (!timeout) {
            timeout = setTimeout(() => {
                lastCall = Date.now();
                timeout = null;
                func.apply(this, args);
            }, remaining);
        }
    };
}

/**
 * Request idle callback with fallback
 * @param {IdleRequestCallback} callback - Function to call when idle
 * @param {{timeout?: number}} [options] - Options with optional timeout
 * @returns {number} - Handle for cancellation
 */
export function requestIdleCallback(callback, options = {}) {
    if (typeof window !== 'undefined' && window.requestIdleCallback) {
        return window.requestIdleCallback(callback, options);
    }
    // Fallback for browsers without requestIdleCallback (Safari, older Firefox)
    const timeout = options.timeout || 50;
    const start = Date.now();
    return setTimeout(() => {
        callback({
            didTimeout: Date.now() - start >= timeout,
            timeRemaining: () => Math.max(0, timeout - (Date.now() - start))
        });
    }, 1);
}

/**
 * Cancel idle callback with fallback
 */
export function cancelIdleCallback(id) {
    if (typeof window !== 'undefined' && window.cancelIdleCallback) {
        return window.cancelIdleCallback(id);
    }
    return clearTimeout(id);
}

/**
 * Detect if the current platform is Windows
 * Uses modern userAgentData API with fallback to userAgent parsing
 * @returns {boolean}
 */
function isWindowsPlatform() {
    if (typeof navigator === 'undefined') return false;
    
    // Modern API (Chrome 90+, Edge 90+)
    if (navigator.userAgentData?.platform) {
        return navigator.userAgentData.platform === 'Windows';
    }
    
    // Fallback to userAgent parsing
    return /Windows|Win32|Win64|WOW64/.test(navigator.userAgent);
}

/**
 * Get flag emoji for a country name
 * Returns HTML img tag for Windows (which doesn't render flag emojis well)
 * @param {string} countryName - The country name to get flag for
 * @returns {string|null} - Flag emoji, HTML img tag, or null
 */
export function getFlagEmoji(countryName) {
    if (!countryName) return null;
    
    const normalized = countryName.trim().toLowerCase();
    const emoji = COUNTRY_FLAGS[normalized] || '🌍';
    
    // Check if we are on Windows (which doesn't support flag emojis well)
    if (isWindowsPlatform() && emoji !== '🌍') {
        // Convert emoji to Twemoji URL
        const codePoints = Array.from(emoji)
            .map(c => c.codePointAt(0).toString(16))
            .join('-');
        
        return `<img src="https://abs-0.twimg.com/emoji/v2/svg/${codePoints}.svg"
                class="x-flag-emoji"
                alt="${emoji}"
                style="height: 1.2em; vertical-align: -0.2em;">`;
    }
    
    return emoji;
}

// Country code mappings for evidence capture and display
const COUNTRY_CODES = {
    'united states': 'US', 'usa': 'US', 'us': 'US',
    'united kingdom': 'UK', 'uk': 'UK', 'britain': 'UK', 'great britain': 'UK', 'england': 'UK',
    'germany': 'DE', 'france': 'FR', 'spain': 'ES', 'italy': 'IT',
    'russia': 'RU', 'russian federation': 'RU',
    'china': 'CN', 'japan': 'JP', 'india': 'IN', 'brazil': 'BR',
    'canada': 'CA', 'australia': 'AU', 'mexico': 'MX',
    'netherlands': 'NL', 'belgium': 'BE', 'switzerland': 'CH',
    'sweden': 'SE', 'norway': 'NO', 'denmark': 'DK', 'finland': 'FI',
    'poland': 'PL', 'ukraine': 'UA', 'turkey': 'TR', 'türkiye': 'TR',
    'south korea': 'KR', 'korea': 'KR', 'north korea': 'KP',
    'israel': 'IL', 'iran': 'IR', 'iraq': 'IQ', 'saudi arabia': 'SA',
    'egypt': 'EG', 'south africa': 'ZA', 'nigeria': 'NG',
    'argentina': 'AR', 'chile': 'CL', 'colombia': 'CO', 'peru': 'PE',
    'indonesia': 'ID', 'thailand': 'TH', 'vietnam': 'VN', 'viet nam': 'VN',
    'philippines': 'PH', 'malaysia': 'MY', 'singapore': 'SG',
    'pakistan': 'PK', 'bangladesh': 'BD', 'sri lanka': 'LK',
    'portugal': 'PT', 'greece': 'GR', 'ireland': 'IE', 'austria': 'AT',
    'czech republic': 'CZ', 'czechia': 'CZ', 'romania': 'RO', 'hungary': 'HU',
    'africa': 'AF', 'europe': 'EU', 'asia': 'AS'
};

/**
 * Get ISO country code from country name.
 * Used for evidence capture and compact display.
 * @param {string|null|undefined} location - The country/location name
 * @returns {string} - 2-letter country code or first 2 chars of location
 */
export function getCountryCode(location) {
    if (!location) return '';
    const key = location.trim().toLowerCase();
    return COUNTRY_CODES[key] || location.substring(0, 2).toUpperCase();
}

/**
 * Classify a device/source string into a normalized platform category.
 * Unifies the device-classification ladders duplicated across the codebase.
 * @param {string|null|undefined} deviceString - The device/client string from X API
 * @returns {'ios'|'android'|'web'|'unknown'} - Normalized device category
 */
export function classifyDevice(deviceString) {
    const d = (deviceString || '').toLowerCase();

    if (d.includes('android')) return 'android';
    if (['app store', 'iphone', 'ipad', 'ios', 'mac', 'os x'].some(t => d.includes(t))) return 'ios';
    if (d.includes('web')) return 'web';
    return 'unknown';
}

/**
 * Extract the country name from a device/source string.
 * X's "source" string is formatted "<Country> <Platform> App"
 * (e.g. "Russian Federation Android App"), so the country is the longest
 * leading prefix that matches a known COUNTRY_FLAGS key. Web/unknown sources
 * (e.g. "Web", or legacy "Twitter for iPhone") have no country prefix, so we
 * return null and let callers fall back to the account location.
 * @param {string|null|undefined} deviceString - The device/client string from X API
 * @returns {string|null} - Country name (a COUNTRY_FLAGS key) or null
 */
export function getDeviceCountry(deviceString) {
    if (!deviceString) return null;

    // Peel platform words off the end until the remaining prefix is a known
    // country (e.g. "russian federation android app" -> "russian federation").
    // Iterating from the full length down returns the LONGEST matching prefix,
    // so multi-word countries ("united states") win over shorter coincidences.
    const words = deviceString.trim().toLowerCase().split(/\s+/);
    for (let i = words.length; i > 0; i--) {
        const candidate = words.slice(0, i).join(' ');
        if (COUNTRY_FLAGS[candidate]) return candidate;
    }

    return null;
}

/**
 * Format country name for display (title case).
 * @param {string|null|undefined} country - The country name to format
 * @returns {string} - Formatted country name with first letter of each word capitalized
 */
export function formatCountryName(country) {
    if (!country) return '';
    return country.split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');
}

/**
 * Extract username from various X DOM element structures.
 * Handles both timeline/feed elements and profile header elements.
 * @param {HTMLElement} element - The DOM element containing username info
 * @returns {string|null} - The extracted username (without @) or null if not found
 */
export function extractUsername(element) {
    // 1. Try to find the username link (Timeline/Feed)
    const link = element.querySelector('a[href^="/"]');
    if (link) {
        const href = link.getAttribute('href');
        const match = href.match(/^\/([^/]+)$/);
        if (match) {
            const username = match[1];
            const invalid = ['home', 'explore', 'notifications', 'messages', 'search', 'settings', 'i', 'compose'];
            if (!invalid.includes(username.toLowerCase())) return username;
        }
    }

    // 2. Profile Header Case (Username is text, not a link)
    const textNodes = Array.from(element.querySelectorAll('span, div[dir="ltr"]'));
    for (const node of textNodes) {
        const text = node.textContent.trim();
        if (text.startsWith('@') && text.length > 1) {
            const username = text.substring(1);
            // Basic validation to ensure it's a username
            if (/^[a-zA-Z0-9_]+$/.test(username)) {
                return username;
            }
        }
    }

    return null;
}

/**
 * Get the logged-in username from the DOM
 * @returns {string|null} - The username (without @) or null
 */
export function getLoggedInUsername() {
    // Try to find the profile link in the sidebar
    const profileLink = document.querySelector('[data-testid="AppTabBar_Profile_Link"]');
    if (profileLink) {
        const href = profileLink.getAttribute('href');
        if (href && href.startsWith('/')) {
            return href.substring(1);
        }
    }
    return null;
}

/**
 * Find the best insertion point for badge in a username element.
 * Handles various X DOM structures including profile headers and timeline items.
 * @param {HTMLElement} container - The container element to search in
 * @param {string} screenName - The username to look for (without @)
 * @returns {{target: HTMLElement, ref: Node|null}|null} - Insertion point or null if not found
 */
export function findInsertionPoint(container, screenName) {
    // 1. Profile Header Specific Logic
    const isProfileHeader = !container.querySelector('time') &&
        (container.querySelector('[data-testid="userFollowIndicator"]') !== null ||
        (container.getAttribute('data-testid') === 'UserName' && container.className.includes('r-14gqq1x')));

    if (isProfileHeader) {
        const nameContainer = container.querySelector('div[dir="ltr"]');
        if (nameContainer) {
            const lastSpan = nameContainer.querySelector('span:last-child');
            if (lastSpan) {
                return { target: lastSpan.parentNode, ref: null };
            }
            return { target: nameContainer, ref: null };
        }
    }

    // 2. Timeline/Feed Case - Look for the handle (@username)
    const links = Array.from(container.querySelectorAll('a'));
    const handleLink = links.find(l =>
        l.textContent.trim().toLowerCase() === `@${screenName.toLowerCase()}`
    );
    
    if (handleLink) {
        // Navigate up to find a suitable container
        const parent = handleLink.parentNode;
        // The structure is usually: <div><a>@handle</a></div> - we want to insert after the parent div
        if (parent && parent.parentNode) {
            return { target: parent.parentNode, ref: parent.nextSibling };
        }
        return { target: parent, ref: null };
    }

    // 3. Fallback: Try to find the name container via href
    const nameLink = container.querySelector(`a[href="/${screenName}"]`);
    if (nameLink) {
        return { target: nameLink.parentNode, ref: nameLink.nextSibling };
    }

    // 4. Last resort: Find any span containing the @ handle
    const spans = container.querySelectorAll('span');
    for (const span of spans) {
        if (span.textContent.trim().toLowerCase() === `@${screenName.toLowerCase()}`) {
            let parent = span.parentNode;
            while (parent && parent !== container) {
                if (parent.parentNode && parent.nextSibling) {
                    return { target: parent.parentNode, ref: parent.nextSibling };
                }
                parent = parent.parentNode;
            }
            // If we couldn't find a good parent, just append to the span's parent
            return { target: span.parentNode, ref: null };
        }
    }

    // 5. Absolute fallback - just append to the container
    const firstDiv = container.querySelector('div[dir="ltr"]');
    if (firstDiv) {
        return { target: firstDiv, ref: null };
    }

    return null;
}

/**
 * Create DOM element with attributes and children.
 * Supports className, style objects, dataset, event handlers, and nested children.
 * @param {string} tag - HTML tag name
 * @param {Object} [attributes={}] - Attributes to apply (className, style, dataset, on*, innerHTML, textContent, or standard attributes)
 * @param {Array<string|Node>} [children=[]] - Child nodes or text content
 * @returns {HTMLElement} - The created element
 */
export function createElement(tag, attributes = {}, children = []) {
    const element = document.createElement(tag);
    
    for (const [key, value] of Object.entries(attributes)) {
        if (key === 'className') {
            element.className = value;
        } else if (key === 'style' && typeof value === 'object') {
            Object.assign(element.style, value);
        } else if (key === 'dataset') {
            Object.assign(element.dataset, value);
        } else if (key.startsWith('on') && typeof value === 'function') {
            const event = key.slice(2).toLowerCase();
            element.addEventListener(event, value);
        } else if (key === 'textContent') {
            element.textContent = value;
        } else {
            element.setAttribute(key, value);
        }
    }
    
    for (const child of children) {
        if (typeof child === 'string') {
            element.appendChild(document.createTextNode(child));
        } else if (child instanceof Node) {
            element.appendChild(child);
        }
    }
    
    return element;
}

/**
 * Sleep helper - returns a Promise that resolves after the specified time.
 * @param {number} ms - Time to sleep in milliseconds
 * @returns {Promise<void>}
 */
export function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Calculate statistics from cache data.
 * @param {Array<{location?: string, device?: string, locationAccurate?: boolean}>} cacheEntries - Array of cache entries
 * @returns {{
 *   totalUsers: number,
 *   countryCounts: Object<string, number>,
 *   deviceCounts: Object<string, number>,
 *   vpnCount: number,
 *   topCountries: Array<{country: string, count: number, percentage: number}>,
 *   topDevices: Array<{device: string, count: number, percentage: number}>
 * }} - Statistics object
 */
export function calculateStatistics(cacheEntries) {
    const stats = {
        totalUsers: 0,
        countryCounts: {},
        deviceCounts: {},
        vpnCount: 0,
        topCountries: [],
        topDevices: []
    };
    
    if (!cacheEntries || !Array.isArray(cacheEntries)) {
        return stats;
    }
    
    stats.totalUsers = cacheEntries.length;
    
    for (const entry of cacheEntries) {
        // Count by country
        if (entry.location) {
            const country = entry.location.toLowerCase();
            stats.countryCounts[country] = (stats.countryCounts[country] || 0) + 1;
        }
        
        // Count by device
        if (entry.device) {
            const deviceType = getDeviceCategory(entry.device);
            stats.deviceCounts[deviceType] = (stats.deviceCounts[deviceType] || 0) + 1;
        }
        
        // Count VPN users
        if (entry.locationAccurate === false) {
            stats.vpnCount++;
        }
    }
    
    // Sort and get top countries
    stats.topCountries = Object.entries(stats.countryCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([country, count]) => ({
            country,
            count,
            percentage: Math.round((count / stats.totalUsers) * 100)
        }));
    
    // Sort and get device distribution
    stats.topDevices = Object.entries(stats.deviceCounts)
        .sort((a, b) => b[1] - a[1])
        .map(([device, count]) => ({
            device,
            count,
            percentage: Math.round((count / stats.totalUsers) * 100)
        }));
    
    return stats;
}

/**
 * Get device category from device string.
 * Categories: iOS, Android, Web, Unknown
 * @param {string|null|undefined} deviceString - The device/client string from X API
 * @returns {string} - Device category name
 */
function getDeviceCategory(deviceString) {
    const labels = { ios: 'iOS', android: 'Android', web: 'Web', unknown: 'Unknown' };
    return labels[classifyDevice(deviceString)];
}

/**
 * Extract emojis and special tags from a display name or bio.
 * This extracts:
 * - All emoji characters (including flag emojis, compound emojis)
 * - Common symbolic patterns users put in their names
 * 
 * @param {string|null|undefined} text - The text to extract tags from (display name, bio, etc.)
 * @returns {string[]} - Array of unique tags/emojis found
 */
// Hoisted to module scope so these (especially the heavy Unicode-property emoji
// regex) compile once, not on every call — extractTagsFromText runs per username when
// blocked tags are configured. Used only via String.prototype.match, which neither
// reads nor advances lastIndex, so sharing these /g instances across calls is safe.
const EMOJI_TAG_RE = /(?:\p{Emoji_Presentation}|\p{Emoji}️|\p{Emoji_Modifier_Base}\p{Emoji_Modifier}?|\p{Emoji_Component})+(?:‍(?:\p{Emoji_Presentation}|\p{Emoji}️|\p{Emoji_Modifier_Base}\p{Emoji_Modifier}?|\p{Emoji_Component})+)*/gu;
const BRACKET_TAG_RE = /\[([^\]]{1,20})\]|\(([^)]{1,20})\)/g;
const HASHTAG_TAG_RE = /#(\w{2,20})/g;

export function extractTagsFromText(text) {
    if (!text || typeof text !== 'string') return [];
    
    const tags = new Set();
    
    // Comprehensive emoji regex pattern
    // Matches most emoji including:
    // - Basic emoji (😀-🙏)
    // - Flag emojis (🇦🇫-🇿🇼)
    // - Skin tone modifiers
    // - Compound emojis with ZWJ (👨‍👩‍👧)
    // - Emoji with variation selectors
    // (emoji pattern hoisted to EMOJI_TAG_RE at module scope)
    
    // Extract all emojis
    const emojiMatches = text.match(EMOJI_TAG_RE);
    if (emojiMatches) {
        for (const emoji of emojiMatches) {
            // Skip common punctuation that might match as emoji components
            if (emoji === '#' || emoji === '*' || emoji === '0' || emoji === '1' || 
                emoji === '2' || emoji === '3' || emoji === '4' || emoji === '5' || 
                emoji === '6' || emoji === '7' || emoji === '8' || emoji === '9') {
                continue;
            }
            tags.add(emoji);
        }
    }
    
    // Also extract common symbolic patterns users put in names
    // These are patterns like: ⭐, ✨, 🔥, 💀, etc. that might not be caught above
    // And text-based tags in brackets/parentheses like: [BOT], (parody), etc.
    const bracketPatterns = text.match(BRACKET_TAG_RE);
    if (bracketPatterns) {
        for (const pattern of bracketPatterns) {
            tags.add(pattern);
        }
    }
    
    // Extract hashtag-like patterns without the #
    // E.g., in "John #MAGA Smith" we extract "MAGA"
    const hashtagMatches = text.match(HASHTAG_TAG_RE);
    if (hashtagMatches) {
        for (const hashtag of hashtagMatches) {
            tags.add(hashtag);
        }
    }
    
    return Array.from(tags);
}

/**
 * Common/popular tags that users frequently use for identification
 * This list can be used to populate a quick-select UI
 */
export const COMMON_PROFILE_TAGS = [
    // Country flags (most common)
    '🇺🇸', '🇬🇧', '🇷🇺', '🇺🇦', '🇨🇳', '🇮🇳', '🇮🇱', '🇵🇸', '🇮🇷', '🇹🇷',
    '🇩🇪', '🇫🇷', '🇯🇵', '🇰🇷', '🇧🇷', '🇲🇽', '🇨🇦', '🇦🇺', '🇪🇺',
    // Political/identity symbols
    '🏳️‍🌈', '🏳️‍⚧️', '✡️', '☪️', '✝️', '🕉️', '☸️', '✊', '✊🏿', '✊🏻',
    // Common decorative
    '⭐', '🌟', '✨', '💫', '🔥', '💀', '👻', '🎭', '🎪', '🎯',
    '💎', '👑', '🏆', '🎖️', '🏅', '🎗️',
    // Status/role indicators
    '🤖', '🔵', '✅', '❌', '⚠️', '🔒', '🔓',
    '📢', '📣', '🎙️', '📰', '🗞️',
    // Common bracket tags
    '[BOT]', '[PARODY]', '[FAN]', '[RP]', '[18+]', '[NSFW]',
    '(parody)', '(fan account)', '(satire)', '(not affiliated)'
];
