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
 * Process items in batches using idle callback
 */
export async function processBatch(items, processor, batchSize = 10) {
    const results = [];
    
    for (let i = 0; i < items.length; i += batchSize) {
        const batch = items.slice(i, i + batchSize);
        
        await new Promise(resolve => {
            requestIdleCallback(async deadline => {
                for (const item of batch) {
                    if (deadline.timeRemaining() > 0 || deadline.didTimeout) {
                        try {
                            const result = await processor(item);
                            results.push(result);
                        } catch (error) {
                            console.error('Batch processing error:', error);
                        }
                    }
                }
                resolve();
            }, { timeout: 100 });
        });
    }
    
    return results;
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
 * Get device emoji based on device string.
 * Categories: iOS (🍎), Android (🤖), Web (🌐), Unknown (❓)
 * @param {string|null|undefined} deviceString - The device/client string from X API
 * @returns {string|null} - Device emoji or null if no device string
 */
export function getDeviceEmoji(deviceString) {
    if (!deviceString) return null;
    
    const d = deviceString.toLowerCase();
    
    // iOS devices (App Store = iPhone/iPad)
    if (d.includes('app store')) return '🍎';
    
    // Android devices
    if (d.includes('android')) return '🤖';
    
    // Web clients (could be desktop or mobile browser - we can't distinguish)
    if (d.includes('web') || d === 'x' || d === 'twitter') return '🌐';
    
    // Unknown device type
    return '❓';
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
 * Wait for an element to appear in the DOM using MutationObserver.
 * @param {string} selector - CSS selector for the element
 * @param {number} [timeout=10000] - Maximum time to wait in milliseconds
 * @param {Document|HTMLElement} [parent=document] - Parent element to search in
 * @returns {Promise<HTMLElement>} - Resolves with the element or rejects on timeout
 */
export function waitForElement(selector, timeout = 10000, parent = document) {
    return new Promise((resolve, reject) => {
        const element = parent.querySelector(selector);
        if (element) {
            resolve(element);
            return;
        }

        const observer = new MutationObserver((mutations, obs) => {
            const element = parent.querySelector(selector);
            if (element) {
                obs.disconnect();
                resolve(element);
            }
        });

        observer.observe(parent === document ? document.body : parent, {
            childList: true,
            subtree: true
        });

        setTimeout(() => {
            observer.disconnect();
            reject(new Error(`Element ${selector} not found within ${timeout}ms`));
        }, timeout);
    });
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
 * Retry a function with exponential backoff.
 * @template T
 * @param {() => Promise<T>} fn - The async function to retry
 * @param {number} [maxRetries=3] - Maximum number of retry attempts
 * @param {number} [baseDelay=1000] - Base delay in ms (doubles each retry)
 * @returns {Promise<T>} - The function result
 * @throws {Error} - The last error if all retries fail
 */
export async function retry(fn, maxRetries = 3, baseDelay = 1000) {
    let lastError;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            if (attempt < maxRetries - 1) {
                const delay = baseDelay * Math.pow(2, attempt);
                await sleep(delay);
            }
        }
    }
    
    throw lastError;
}

/**
 * Simple event emitter
 */
export class EventEmitter {
    constructor() {
        this.events = new Map();
    }

    on(event, listener) {
        if (!this.events.has(event)) {
            this.events.set(event, new Set());
        }
        this.events.get(event).add(listener);
        return () => this.off(event, listener);
    }

    off(event, listener) {
        if (this.events.has(event)) {
            this.events.get(event).delete(listener);
        }
    }

    emit(event, ...args) {
        if (this.events.has(event)) {
            for (const listener of this.events.get(event)) {
                try {
                    listener(...args);
                } catch (error) {
                    console.error(`Event listener error for ${event}:`, error);
                }
            }
        }
    }

    once(event, listener) {
        const onceWrapper = (...args) => {
            this.off(event, onceWrapper);
            listener(...args);
        };
        return this.on(event, onceWrapper);
    }
}

/**
 * Generate unique ID
 */
export function generateId() {
    return `x-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Safe JSON parse with fallback
 */
export function safeJsonParse(str, fallback = null) {
    try {
        return JSON.parse(str);
    } catch {
        return fallback;
    }
}

/**
 * Check if object is empty
 */
export function isEmpty(obj) {
    if (!obj) return true;
    if (Array.isArray(obj)) return obj.length === 0;
    if (typeof obj === 'object') return Object.keys(obj).length === 0;
    return false;
}

/**
 * Detect and apply X's current theme
 * X uses data-theme attribute on the <html> element: "dark", "dim", or "light"
 */
export function detectXTheme() {
    // First check if we're in a content script context with access to X's DOM
    if (typeof document !== 'undefined') {
        const htmlElement = document.documentElement;
        const xTheme = htmlElement.getAttribute('data-theme');
        
        if (xTheme) {
            return xTheme; // "dark", "dim", or "light"
        }
        
        // Fallback: check background color
        const bgColor = window.getComputedStyle(document.body).backgroundColor;
        if (bgColor) {
            // X dark: rgb(0, 0, 0), dim: rgb(21, 32, 43), light: rgb(255, 255, 255)
            if (bgColor === 'rgb(0, 0, 0)') return 'dark';
            if (bgColor === 'rgb(21, 32, 43)' || bgColor.includes('21, 32, 43')) return 'dim';
            if (bgColor === 'rgb(255, 255, 255)') return 'light';
        }
    }
    
    // Default to dark
    return 'dark';
}

/**
 * Apply theme to an HTML document
 */
export function applyTheme(theme, doc = document) {
    doc.documentElement.setAttribute('data-theme', theme);
}

/**
 * Set up theme sync observer (for content scripts)
 * Watches X's theme changes and notifies callback
 */
export function observeThemeChanges(callback) {
    if (typeof document === 'undefined') return null;
    
    const observer = new MutationObserver(mutations => {
        for (const mutation of mutations) {
            if (mutation.type === 'attributes' && mutation.attributeName === 'data-theme') {
                const newTheme = document.documentElement.getAttribute('data-theme');
                callback(newTheme);
            }
        }
    });
    
    observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-theme']
    });
    
    return observer;
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
    if (!deviceString) return 'Unknown';
    
    const d = deviceString.toLowerCase();
    
    // iOS devices (App Store = iPhone/iPad)
    if (d.includes('app store')) return 'iOS';
    
    // Android devices
    if (d.includes('android')) return 'Android';
    
    // Web clients (desktop or mobile browser)
    if (d.includes('web') || d === 'x' || d === 'twitter') return 'Web';
    
    return 'Unknown';
}