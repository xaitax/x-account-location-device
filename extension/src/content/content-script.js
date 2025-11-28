/**
 * Content Script (ISOLATED World)
 * Main content script that handles DOM processing, UI injection,
 * and communication between page script and background worker
 */

import browserAPI from '../shared/browser-api.js';
import { MESSAGE_TYPES, SELECTORS, CSS_CLASSES, VERSION, TIMING } from '../shared/constants.js';
import { extractUsername, findInsertionPoint, getFlagEmoji, getDeviceEmoji, debounce } from '../shared/utils.js';
import { showModal } from './modal.js';
import { captureEvidence } from './evidence-capture.js';

// State
let isEnabled = true;
let blockedCountries = new Set();
let settings = {};
let csrfToken = null;
let observer = null;
let themeObserver = null;
const processingQueue = new Set();
let stylesInjected = false;
let debugMode = false;

// Cleanup tracking for proper teardown
let resizeHandler = null;
let cleanupFunctions = [];

// Intersection Observer for processing only visible elements
let intersectionObserver = null;
const pendingVisibility = new Map(); // element -> screenName
const PENDING_VISIBILITY_MAX_SIZE = 500; // Prevent unbounded growth

/**
 * Debug logger - only logs when debugMode is enabled
 */
function debug(...args) {
    if (debugMode) {
        console.log('🔍 X-Posed:', ...args);
    }
}

/**
 * Initialize the content script
 */
async function initialize() {
    console.log(`🚀 X-Posed v${VERSION} initializing...`);
    
    try {
        // IMPORTANT: Set up event listener BEFORE injecting page script
        // This ensures we don't miss any header capture events
        setupPageScriptListener();
        
        // Listen for messages from background
        setupBackgroundListener();

        // Extract CSRF token from cookies
        csrfToken = getCsrfToken();
        
        // Inject page script for header interception AFTER listener is ready
        injectPageScript();

        // Load initial settings and blocked countries from background
        const [settingsResponse, blockedResponse] = await Promise.all([
            sendMessage({ type: MESSAGE_TYPES.GET_SETTINGS }),
            sendMessage({ type: MESSAGE_TYPES.GET_BLOCKED_COUNTRIES })
        ]);

        if (settingsResponse?.success) {
            settings = settingsResponse.data;
            isEnabled = settings.enabled !== false;
            debugMode = settings.debugMode === true;
        }
        
        console.log(`✅ X-Posed initialized (enabled: ${isEnabled}, debug: ${debugMode})`);

        if (blockedResponse?.success) {
            blockedCountries = new Set(blockedResponse.data);
        }

        // Inject styles
        injectStyles();

        // Detect and apply theme
        detectAndApplyTheme();
        startThemeObserver();

        // Start DOM observation when ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                startObserver();
                injectSidebarLink();
            });
        } else {
            startObserver();
            injectSidebarLink();
        }

    } catch (error) {
        console.error('X-Posed initialization failed:', error);
    }
}

/**
 * Send message to background script
 */
async function sendMessage(message) {
    try {
        return await browserAPI.runtime.sendMessage(message);
    } catch (error) {
        console.error('Message send error:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Get CSRF token from cookies
 */
function getCsrfToken() {
    const cookies = document.cookie.split('; ');
    for (const cookie of cookies) {
        const [key, value] = cookie.split('=');
        if (key === 'ct0') {
            return value;
        }
    }
    return null;
}

/**
 * Inject page script into MAIN world
 */
function injectPageScript() {
    // Get the script URL from extension
    const scriptUrl = browserAPI.runtime.getURL('page-script.js');
    
    const script = document.createElement('script');
    script.src = scriptUrl;
    script.onload = function() {
        this.remove();
    };
    
    // Inject at document_start
    (document.head || document.documentElement).appendChild(script);
}

/**
 * Listen for events from page script
 */
function setupPageScriptListener() {
    window.addEventListener('x-posed-headers-captured', async event => {
        const { headers } = event.detail;
        debug('Headers captured from page script');
        
        // Send captured headers to background
        await sendMessage({
            type: MESSAGE_TYPES.CAPTURE_HEADERS,
            payload: { headers }
        });
    });
}

/**
 * Listen for messages from background script
 */
function setupBackgroundListener() {
    const messageHandler = (message, sender, sendResponse) => {
        const { type, payload } = message;

        // Handle messages asynchronously
        (async () => {
            try {
                switch (type) {
                    case MESSAGE_TYPES.SETTINGS_UPDATED: {
                        const prevSettings = { ...settings };
                        settings = payload;
                        isEnabled = settings.enabled !== false;
                        debugMode = settings.debugMode === true;
                        debug('Settings updated:', settings);
                        if (!isEnabled) {
                            // Remove existing badges if disabled
                            document.querySelectorAll(`.${CSS_CLASSES.INFO_BADGE}`).forEach(el => el.remove());
                        }
                        // Handle sidebar link toggle
                        if (prevSettings.showSidebarBlockerLink !== settings.showSidebarBlockerLink) {
                            if (settings.showSidebarBlockerLink === false) {
                                removeSidebarLink();
                            } else {
                                injectSidebarLink();
                            }
                        }
                        sendResponse({ success: true });
                        break;
                    }

                    case MESSAGE_TYPES.BLOCKED_COUNTRIES_UPDATED:
                        blockedCountries = new Set(payload);
                        updateBlockedTweets();
                        sendResponse({ success: true });
                        break;

                    default:
                        sendResponse({ success: false, error: 'Unknown message type' });
                }
            } catch (error) {
                console.error('X-Posed: Message handler error:', error);
                sendResponse({ success: false, error: error.message });
            }
        })();

        return true; // Keep message channel open for async response
    };

    browserAPI.runtime.onMessage.addListener(messageHandler);
    
    // Track for cleanup
    cleanupFunctions.push(() => {
        browserAPI.runtime.onMessage.removeListener(messageHandler);
    });
}

/**
 * Update visibility of tweets based on blocked countries
 */
function updateBlockedTweets() {
    document.querySelectorAll('[data-x-screen-name]').forEach(element => {
        const screenName = element.dataset.xScreenName;
        const country = element.dataset.xCountry;
        
        if (!country) return;
        
        const tweet = element.closest(SELECTORS.TWEET);
        if (!tweet) return;
        
        const isBlocked = blockedCountries.has(country.toLowerCase());
        tweet.classList.toggle(CSS_CLASSES.TWEET_BLOCKED, isBlocked);
        
        // Toggle badge visibility
        const badge = element.querySelector(`.${CSS_CLASSES.INFO_BADGE}`);
        if (badge) {
            badge.style.display = isBlocked ? 'none' : '';
        }
    });
}

/**
 * Inject CSS styles
 */
function injectStyles() {
    if (stylesInjected) return;
    
    const styleUrl = browserAPI.runtime.getURL('styles/content.css');
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = styleUrl;
    document.head.appendChild(link);
    
    stylesInjected = true;
}

/**
 * Detect current X theme and apply data attribute
 */
function detectAndApplyTheme() {
    const theme = detectXTheme();
    document.documentElement.setAttribute('data-x-theme', theme);
    debug(`Theme detected: ${theme}`);
}

/**
 * Detect X's current theme from the page
 */
function detectXTheme() {
    if (typeof document === 'undefined') return 'dark';

    // Check CSS variable first
    const bgColor = window.getComputedStyle(document.documentElement).getPropertyValue('--background-color').trim();
    
    if (bgColor) {
        // Parse the color
        if (bgColor.includes('255, 255, 255') || bgColor === '#ffffff' || bgColor === 'white') {
            return 'light';
        }
        if (bgColor.includes('21, 32, 43') || bgColor === '#15202b') {
            return 'dim';
        }
        if (bgColor.includes('0, 0, 0') || bgColor === '#000000' || bgColor === 'black') {
            return 'dark';
        }
    }
    
    // Fallback: check body background
    const bodyBg = window.getComputedStyle(document.body).backgroundColor;
    
    if (bodyBg) {
        if (bodyBg.includes('255, 255, 255')) {
            return 'light';
        }
        if (bodyBg.includes('21, 32, 43')) {
            return 'dim';
        }
        if (bodyBg.includes('0, 0, 0')) {
            return 'dark';
        }
    }
    
    // Check HTML background as last resort
    const htmlBg = window.getComputedStyle(document.documentElement).backgroundColor;
    if (htmlBg) {
        if (htmlBg.includes('255, 255, 255')) {
            return 'light';
        }
        if (htmlBg.includes('21, 32, 43')) {
            return 'dim';
        }
    }
    
    return 'dark'; // Default
}

/**
 * Start observer for theme changes
 */
function startThemeObserver() {
    if (themeObserver) return;
    
    themeObserver = new MutationObserver(() => {
        detectAndApplyTheme();
    });
    
    // Observe style changes on documentElement and body
    themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['style', 'class']
    });
    
    if (document.body) {
        themeObserver.observe(document.body, {
            attributes: true,
            attributeFilter: ['style', 'class']
        });
    }
}

/**
 * Start Intersection Observer for lazy processing of visible elements
 */
function startIntersectionObserver() {
    if (intersectionObserver) return;
    
    intersectionObserver = new IntersectionObserver(
        entries => {
            for (const entry of entries) {
                if (entry.isIntersecting) {
                    const element = entry.target;
                    
                    // Stop observing this element
                    intersectionObserver.unobserve(element);
                    pendingVisibility.delete(element);
                    
                    // Process the element now that it's visible (with error boundary)
                    processElementSafe(element);
                }
            }
        },
        {
            // Start processing when element is within 200px of viewport
            rootMargin: '200px',
            threshold: 0
        }
    );
    
    // Track for cleanup
    cleanupFunctions.push(() => {
        if (intersectionObserver) {
            intersectionObserver.disconnect();
            intersectionObserver = null;
        }
        pendingVisibility.clear();
    });
}

/**
 * Queue element for processing when visible
 * Implements bounds checking to prevent unbounded memory growth
 */
function queueForVisibility(element) {
    if (!intersectionObserver) {
        // Fallback: process immediately if Intersection Observer not available
        processElementSafe(element);
        return;
    }
    
    // Don't queue if already queued or processed
    if (pendingVisibility.has(element) || element.dataset.xProcessed) {
        return;
    }
    
    // Evict oldest entries if at capacity (LRU-style)
    if (pendingVisibility.size >= PENDING_VISIBILITY_MAX_SIZE) {
        const firstKey = pendingVisibility.keys().next().value;
        if (firstKey) {
            intersectionObserver.unobserve(firstKey);
            pendingVisibility.delete(firstKey);
            debug(`Evicted oldest pending visibility entry, queue size: ${pendingVisibility.size}`);
        }
    }
    
    pendingVisibility.set(element, true);
    intersectionObserver.observe(element);
}

/**
 * Start MutationObserver for DOM changes
 */
function startObserver() {
    if (observer) return;
    
    // Start Intersection Observer for visibility-based processing
    startIntersectionObserver();

    // Collect elements without debounce to not lose mutations
    let pendingElements = new Set();
    let processTimeout = null;

    const processPending = () => {
        if (pendingElements.size === 0) return;
        
        const elements = Array.from(pendingElements);
        pendingElements = new Set();
        
        // Queue elements for visibility-based processing
        for (const element of elements) {
            queueForVisibility(element);
        }
    };

    const scheduleProcessing = () => {
        if (processTimeout) return;
        processTimeout = setTimeout(() => {
            processTimeout = null;
            processPending();
        }, 50); // Reduced from 100ms for faster processing
    };

    observer = new MutationObserver(mutations => {
        if (!isEnabled) return;

        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (node.nodeType !== Node.ELEMENT_NODE) continue;

                // Check if node matches our username selector (tweets, etc.)
                if (node.matches && node.matches(SELECTORS.USERNAME)) {
                    if (!node.dataset.xProcessed) {
                        pendingElements.add(node);
                    }
                }
                
                // Check if node matches UserCell (followers/following pages)
                if (node.matches && node.matches(SELECTORS.USER_CELL)) {
                    if (!node.dataset.xProcessed) {
                        pendingElements.add(node);
                    }
                }

                // Check descendants for both selectors
                if (node.querySelectorAll) {
                    node.querySelectorAll(SELECTORS.USERNAME).forEach(el => {
                        if (!el.dataset.xProcessed) {
                            pendingElements.add(el);
                        }
                    });
                    
                    node.querySelectorAll(SELECTORS.USER_CELL).forEach(el => {
                        if (!el.dataset.xProcessed) {
                            pendingElements.add(el);
                        }
                    });
                }
            }
        }

        // Schedule processing if we have new elements
        if (pendingElements.size > 0) {
            scheduleProcessing();
        }
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

    // Initial scan
    scanPage();
    
    // Also do a delayed scan after X has time to load
    setTimeout(() => scanPage(), 2000);
}

/**
 * Scan the current page for username elements
 */
function scanPage() {
    if (!isEnabled) return;

    // Scan for regular username elements (tweets, etc.)
    const usernameElements = document.querySelectorAll(SELECTORS.USERNAME);
    
    // Scan for UserCell elements (followers/following pages)
    const userCellElements = document.querySelectorAll(SELECTORS.USER_CELL);
    
    const totalElements = usernameElements.length + userCellElements.length;
    
    // Always log scan results so user can see activity
    if (totalElements > 0) {
        console.log(`🔍 X-Posed: Found ${usernameElements.length} username elements + ${userCellElements.length} user cells to process`);
    }
    
    // Process both types
    processElementsBatch([...Array.from(usernameElements), ...Array.from(userCellElements)]);
}

/**
 * Process elements in batches using requestIdleCallback
 * Note: With Intersection Observer, this is now primarily used for initial scan
 */
function processElementsBatch(elements) {
    if (elements.length === 0) return;

    // Queue all elements for visibility-based processing
    for (const element of elements) {
        queueForVisibility(element);
    }
}

/**
 * LRU Cache for user info to avoid repeated API calls.
 * Limited size to prevent unbounded memory growth on pages with many users.
 */
const USER_INFO_CACHE_MAX_SIZE = 1000;

class LRUUserInfoCache {
    constructor(maxSize) {
        this.maxSize = maxSize;
        this.cache = new Map();
    }
    
    get(key) {
        if (!this.cache.has(key)) {
            return undefined;
        }
        // Move to end (most recently used)
        const value = this.cache.get(key);
        this.cache.delete(key);
        this.cache.set(key, value);
        return value;
    }
    
    set(key, value) {
        // Delete if exists to update position
        if (this.cache.has(key)) {
            this.cache.delete(key);
        }
        // Evict oldest if at capacity
        if (this.cache.size >= this.maxSize) {
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
            debug(`LRU eviction: removed oldest entry, cache size: ${this.cache.size}`);
        }
        this.cache.set(key, value);
    }
    
    has(key) {
        return this.cache.has(key);
    }
    
    clear() {
        this.cache.clear();
    }
    
    get size() {
        return this.cache.size;
    }
}

const userInfoCache = new LRUUserInfoCache(USER_INFO_CACHE_MAX_SIZE);

/**
 * Extract username from a UserCell element
 */
function extractUsernameFromUserCell(userCell) {
    // Method 1: Look for UserAvatar-Container-{username} testid
    const avatarContainer = userCell.querySelector('[data-testid^="UserAvatar-Container-"]');
    if (avatarContainer) {
        const testId = avatarContainer.getAttribute('data-testid');
        const match = testId.match(/UserAvatar-Container-(.+)/);
        if (match) {
            return match[1];
        }
    }
    
    // Method 2: Look for profile links
    const profileLinks = userCell.querySelectorAll('a[href^="/"]');
    for (const link of profileLinks) {
        const href = link.getAttribute('href');
        // Skip non-profile links
        if (href.includes('/') && href.split('/').length === 2) {
            const screenName = href.slice(1); // Remove leading /
            // Validate it looks like a username (no special chars except _)
            if (/^[a-zA-Z0-9_]+$/.test(screenName)) {
                return screenName;
            }
        }
    }
    
    return null;
}

/**
 * Find the insertion point for badge in UserCell
 */
function findUserCellInsertionPoint(userCell, screenName) {
    // Look for the @username span
    const allSpans = userCell.querySelectorAll('span');
    for (const span of allSpans) {
        if (span.textContent === `@${screenName}`) {
            return { target: span.parentElement, ref: span.nextSibling };
        }
    }
    
    // Fallback: look for the display name element and insert after it
    const nameLinks = userCell.querySelectorAll('a[href="/' + screenName + '"]');
    for (const link of nameLinks) {
        // Find the inner span with the display name
        const nameSpan = link.querySelector('span span');
        if (nameSpan && !nameSpan.textContent.startsWith('@')) {
            return { target: link, ref: null };
        }
    }
    
    return null;
}

/**
 * Safe wrapper for processElement with error boundary
 * Prevents a single element error from breaking the entire processing loop
 */
function processElementSafe(element) {
    try {
        processElement(element).catch(error => {
            console.error('X-Posed: Error processing element:', error.message);
            // Mark as processed to prevent retry loops
            if (element && element.dataset) {
                element.dataset.xProcessed = 'error';
            }
        });
    } catch (error) {
        console.error('X-Posed: Sync error processing element:', error.message);
        if (element && element.dataset) {
            element.dataset.xProcessed = 'error';
        }
    }
}

/**
 * Process a single username element (can be UserName element or UserCell)
 */
async function processElement(element) {
    // Check if this is a UserCell element
    const isUserCell = element.matches && element.matches(SELECTORS.USER_CELL);
    
    // Extract username based on element type
    const screenName = isUserCell
        ? extractUsernameFromUserCell(element)
        : extractUsername(element);
        
    if (!screenName) {
        return;
    }
    
    // Check if element was recycled (X's virtual scrolling)
    // If the username changed, we need to re-process
    if (element.dataset.xProcessed) {
        const previousScreenName = element.dataset.xScreenName;
        if (previousScreenName === screenName) {
            // Same user, already processed - check if badge exists
            if (element.querySelector(`.${CSS_CLASSES.INFO_BADGE}`)) {
                return;
            }
            // Badge missing, fall through to re-add it
        } else {
            // Different user - remove old badge and markers
            debug(`Element recycled: @${previousScreenName} → @${screenName}`);
            const oldBadge = element.querySelector(`.${CSS_CLASSES.INFO_BADGE}`);
            if (oldBadge) oldBadge.remove();
            delete element.dataset.xProcessed;
            delete element.dataset.xScreenName;
            delete element.dataset.xCountry;
        }
    }
    
    // Mark as processed
    element.dataset.xProcessed = 'true';
    element.dataset.xScreenName = screenName;

    debug(`Processing @${screenName}`);

    // Check if we already have cached info for this user
    if (userInfoCache.has(screenName)) {
        debug(`Using local cache for @${screenName}`);
        const info = userInfoCache.get(screenName);
        if (info) {
            element.dataset.xCountry = info.location || '';
            
            // Check if blocked
            if (info.location && blockedCountries.has(info.location.toLowerCase())) {
                const tweet = element.closest(SELECTORS.TWEET);
                if (tweet) {
                    tweet.classList.add(CSS_CLASSES.TWEET_BLOCKED);
                }
                return;
            }
            
            // Create badge from cache
            if (info.location || info.device) {
                createBadge(element, screenName, info, isUserCell);
            }
        }
        return;
    }

    // Check if another request is in flight for this user
    if (processingQueue.has(screenName)) {
        // Wait a bit and retry - the cache should be populated
        setTimeout(() => {
            if (userInfoCache.has(screenName)) {
                const info = userInfoCache.get(screenName);
                if (info) {
                    element.dataset.xCountry = info.location || '';
                    if (info.location && blockedCountries.has(info.location.toLowerCase())) {
                        const tweet = element.closest(SELECTORS.TWEET);
                        if (tweet) {
                            tweet.classList.add(CSS_CLASSES.TWEET_BLOCKED);
                        }
                        return;
                    }
                    if (info.location || info.device) {
                        createBadge(element, screenName, info, isUserCell);
                    }
                }
            }
        }, 150); // Reduced from 500ms for faster display
        return;
    }

    processingQueue.add(screenName);
    
    // Set a timeout to clean up stale processing entries (in case of network failure)
    const processingTimeout = setTimeout(() => {
        if (processingQueue.has(screenName)) {
            debug(`Cleaning up stale processing entry for @${screenName}`);
            processingQueue.delete(screenName);
        }
    }, 30000); // 30 second timeout for stale entries
    
    // Only show shimmer in debug mode to reduce DOM overhead
    let shimmer = null;
    if (debugMode) {
        shimmer = document.createElement('span');
        shimmer.className = CSS_CLASSES.FLAG_SHIMMER;
        // Use appropriate insertion point finder
        const insertionPoint = isUserCell
            ? findUserCellInsertionPoint(element, screenName)
            : findInsertionPoint(element, screenName);
        if (insertionPoint) {
            insertionPoint.target.insertBefore(shimmer, insertionPoint.ref);
        }
    }

    try {
        // Fetch user info from background
        const response = await sendMessage({
            type: MESSAGE_TYPES.FETCH_USER_INFO,
            payload: { screenName, csrfToken }
        });

        // Remove shimmer if present
        if (shimmer) shimmer.remove();

        if (!response?.success || !response.data) {
            // Always log errors (not just in debug mode)
            if (response?.code === 'RATE_LIMITED') {
                const resetDate = response.retryAfter ? new Date(response.retryAfter) : null;
                let resetStr = 'unknown';
                let relativeStr = '';
                
                if (resetDate) {
                    resetStr = resetDate.toLocaleTimeString();
                    const now = Date.now();
                    const diffMs = resetDate.getTime() - now;
                    
                    if (diffMs > 0) {
                        const diffMins = Math.ceil(diffMs / 60000);
                        if (diffMins >= 60) {
                            const hours = Math.floor(diffMins / 60);
                            const mins = diffMins % 60;
                            relativeStr = mins > 0 ? ` (in ${hours}h ${mins}m)` : ` (in ${hours}h)`;
                        } else {
                            relativeStr = ` (in ${diffMins} min${diffMins > 1 ? 's' : ''})`;
                        }
                    }
                }
                
                console.warn(`⚠️ X-Posed: Rate limited! Resets at ${resetStr}${relativeStr}`);
            } else if (response?.error) {
                debug(`API error for @${screenName}: ${response.error}`);
            }
            userInfoCache.set(screenName, null);
            processingQueue.delete(screenName);
            return;
        }

        const info = response.data;
        debug(`Received data for @${screenName}:`, { location: info.location, device: info.device });
        
        // Store in local cache for subsequent elements
        userInfoCache.set(screenName, info);
        
        element.dataset.xCountry = info.location || '';

        // Check if blocked
        if (info.location && blockedCountries.has(info.location.toLowerCase())) {
            const tweet = element.closest(SELECTORS.TWEET);
            if (tweet) {
                tweet.classList.add(CSS_CLASSES.TWEET_BLOCKED);
            }
            processingQueue.delete(screenName);
            return;
        }

        // Create and insert badge
        if (info.location || info.device) {
            createBadge(element, screenName, info, isUserCell);
        }
    } catch (error) {
        userInfoCache.set(screenName, null);
    } finally {
        clearTimeout(processingTimeout);
        processingQueue.delete(screenName);
    }
}

/**
 * Sanitize text for safe display (prevents XSS)
 * @param {string} text - Text to sanitize
 * @returns {string} - Sanitized text
 */
function sanitizeText(text) {
    if (!text || typeof text !== 'string') return '';
    // Remove any HTML tags and limit length
    return text.replace(/[<>&"']/g, char => {
        const entities = { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' };
        return entities[char] || char;
    }).substring(0, 100); // Limit to 100 chars for safety
}

/**
 * Create info badge for a user
 * Uses safe DOM methods to prevent XSS attacks
 */
function createBadge(element, screenName, info, isUserCell = false) {
    // Check if badge already exists
    if (element.querySelector(`.${CSS_CLASSES.INFO_BADGE}`)) {
        return;
    }

    const badge = document.createElement('span');
    badge.className = CSS_CLASSES.INFO_BADGE;
    
    let hasContent = false;

    // Add flag (using safe DOM methods)
    if (info.location && settings.showFlags !== false) {
        const flag = getFlagEmoji(info.location);
        if (flag) {
            const flagSpan = document.createElement('span');
            flagSpan.className = 'x-flag';
            flagSpan.title = sanitizeText(info.location);
            // Flag emoji could be an img tag (Twemoji) or text emoji
            if (typeof flag === 'string' && flag.startsWith('<img')) {
                flagSpan.innerHTML = flag; // Twemoji img is safe (generated internally)
            } else {
                flagSpan.textContent = flag;
            }
            badge.appendChild(flagSpan);
            hasContent = true;
        }

        // Add VPN indicator
        if (info.locationAccurate === false && settings.showVpnIndicator !== false) {
            const vpnSpan = document.createElement('span');
            vpnSpan.className = 'x-vpn';
            vpnSpan.title = 'Location may not be accurate (VPN/Proxy detected)';
            vpnSpan.textContent = '🔒';
            badge.appendChild(vpnSpan);
        }
    }

    // Add device (using safe DOM methods)
    if (info.device && settings.showDevices !== false) {
        const emoji = getDeviceEmoji(info.device);
        const deviceSpan = document.createElement('span');
        deviceSpan.className = 'x-device';
        deviceSpan.title = 'Connected via: ' + sanitizeText(info.device);
        deviceSpan.textContent = emoji;
        badge.appendChild(deviceSpan);
        hasContent = true;
    }

    if (!hasContent) return;

    // Add camera capture button (using safe DOM methods)
    const captureBtn = document.createElement('button');
    captureBtn.className = 'x-capture-btn';
    captureBtn.title = 'Capture evidence screenshot';
    captureBtn.setAttribute('aria-label', 'Capture evidence');
    
    // Create SVG safely
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '14');
    svg.setAttribute('height', '14');
    
    const path1 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path1.setAttribute('fill', 'currentColor');
    path1.setAttribute('d', 'M12 9a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm0 6a2 2 0 1 1 0-4 2 2 0 0 1 0 4z');
    
    const path2 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path2.setAttribute('fill', 'currentColor');
    path2.setAttribute('d', 'M20 4h-3.17L15 2H9L7.17 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 14H4V6h4.05l1.83-2h4.24l1.83 2H20v12z');
    
    svg.appendChild(path1);
    svg.appendChild(path2);
    captureBtn.appendChild(svg);
    badge.appendChild(captureBtn);

    // Add click handler for capture button
    captureBtn.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        
        // Find the tweet article
        const tweet = element.closest(SELECTORS.TWEET);
        if (tweet) {
            captureEvidence(tweet, info, screenName);
        } else {
            console.warn('X-Posed: Could not find tweet to capture');
        }
    });

    // Find insertion point based on element type and insert
    const insertionPoint = isUserCell
        ? findUserCellInsertionPoint(element, screenName)
        : findInsertionPoint(element, screenName);
        
    if (insertionPoint) {
        insertionPoint.target.insertBefore(badge, insertionPoint.ref);
        debug(`Badge inserted for @${screenName}${isUserCell ? ' (UserCell)' : ''}`);
    } else {
        debug(`No insertion point found for @${screenName}${isUserCell ? ' (UserCell)' : ''}`);
    }
}

/**
 * Sidebar link observer to handle re-injection on resize/mode change
 */
let sidebarObserver = null;
let currentNav = null;
let resizeTimeout = null;
let sidebarModifying = false; // Flag to prevent infinite loop

// Track sidebar check interval for cleanup
let sidebarCheckInterval = null;
let sidebarCheckTimeout = null;

/**
 * Inject sidebar link for country blocker
 */
function injectSidebarLink() {
    // Check if sidebar link is enabled in settings
    if (settings.showSidebarBlockerLink === false) {
        debug('Sidebar blocker link disabled in settings');
        return;
    }
    
    // Clear any existing interval/timeout
    if (sidebarCheckInterval) {
        clearInterval(sidebarCheckInterval);
        sidebarCheckInterval = null;
    }
    if (sidebarCheckTimeout) {
        clearTimeout(sidebarCheckTimeout);
        sidebarCheckTimeout = null;
    }
    
    // Wait for sidebar to load
    sidebarCheckInterval = setInterval(() => {
        let nav = document.querySelector(SELECTORS.PRIMARY_NAV);

        if (!nav) {
            const allNavs = document.querySelectorAll(SELECTORS.NAV_ROLE);
            for (const n of allNavs) {
                if (n.querySelector(SELECTORS.PROFILE_LINK)) {
                    nav = n;
                    break;
                }
            }
        }

        if (!nav) {
            const headers = document.querySelectorAll('header');
            for (const header of headers) {
                const n = header.querySelector('nav');
                if (n && n.querySelector(SELECTORS.PROFILE_LINK)) {
                    nav = n;
                    break;
                }
            }
        }

        if (nav) {
            // Found nav - clear interval immediately
            clearInterval(sidebarCheckInterval);
            sidebarCheckInterval = null;
            if (sidebarCheckTimeout) {
                clearTimeout(sidebarCheckTimeout);
                sidebarCheckTimeout = null;
            }
            
            currentNav = nav;
            addBlockerLink(nav);
            observeSidebarChanges(nav);
            setupResizeHandler();
        }
    }, TIMING.SIDEBAR_CHECK_MS);

    // Stop after timeout and clear interval
    sidebarCheckTimeout = setTimeout(() => {
        if (sidebarCheckInterval) {
            clearInterval(sidebarCheckInterval);
            sidebarCheckInterval = null;
            debug('Sidebar check timed out');
        }
    }, TIMING.SIDEBAR_TIMEOUT_MS);
    
    // Track for cleanup
    cleanupFunctions.push(() => {
        if (sidebarCheckInterval) {
            clearInterval(sidebarCheckInterval);
            sidebarCheckInterval = null;
        }
        if (sidebarCheckTimeout) {
            clearTimeout(sidebarCheckTimeout);
            sidebarCheckTimeout = null;
        }
    });
}

/**
 * Observe sidebar for changes (mode switches on resize)
 */
function observeSidebarChanges(nav) {
    if (sidebarObserver) {
        sidebarObserver.disconnect();
    }

    sidebarObserver = new MutationObserver(() => {
        // Skip if we're currently modifying the sidebar (prevents infinite loop)
        if (sidebarModifying) return;
        
        // Check if our link still exists
        const ourLink = document.getElementById('x-country-blocker-link');
        const profileLink = nav.querySelector(SELECTORS.PROFILE_LINK);
        
        if (!ourLink && profileLink && settings.showSidebarBlockerLink !== false) {
            // Our link was removed (React re-render), re-inject it
            debug('Sidebar link removed, re-injecting...');
            
            // Temporarily disconnect observer to prevent infinite loop
            sidebarObserver.disconnect();
            addBlockerLink(nav);
            
            // Re-observe after a short delay
            setTimeout(() => {
                if (sidebarObserver && nav.isConnected) {
                    sidebarObserver.observe(nav, {
                        childList: true,
                        subtree: true
                    });
                }
            }, 100);
        }
    });

    sidebarObserver.observe(nav, {
        childList: true,
        subtree: true
    });
    
    // Track for cleanup
    cleanupFunctions.push(() => {
        if (sidebarObserver) {
            sidebarObserver.disconnect();
            sidebarObserver = null;
        }
    });
}

/**
 * Handle window resize to refresh sidebar link for mode changes
 */
function setupResizeHandler() {
    // Remove previous handler if it exists
    if (resizeHandler) {
        window.removeEventListener('resize', resizeHandler);
    }
    
    // Create debounced resize handler
    resizeHandler = debounce(() => {
        if (!currentNav || settings.showSidebarBlockerLink === false) return;
        
        // Set flag to prevent observer from triggering
        sidebarModifying = true;
        
        // Remove existing link and re-add with fresh clone
        const existingLink = document.getElementById('x-country-blocker-link');
        if (existingLink) {
            existingLink.remove();
        }
        
        // Re-inject with fresh clone from current Profile link state
        addBlockerLink(currentNav);
        debug('Sidebar link refreshed after resize');
        
        // Clear flag after a short delay
        setTimeout(() => {
            sidebarModifying = false;
        }, 50);
    }, TIMING.RESIZE_DEBOUNCE_MS);
    
    window.addEventListener('resize', resizeHandler);
    
    // Track for cleanup
    cleanupFunctions.push(() => {
        if (resizeHandler) {
            window.removeEventListener('resize', resizeHandler);
            resizeHandler = null;
        }
    });
}

/**
 * Remove sidebar blocker link if it exists
 */
function removeSidebarLink() {
    const link = document.getElementById('x-country-blocker-link');
    if (link) {
        link.remove();
        debug('Sidebar blocker link removed');
    }
}

/**
 * Add blocker link to sidebar
 */
function addBlockerLink(nav) {
    if (document.getElementById('x-country-blocker-link')) return;

    const profileLink = nav.querySelector(SELECTORS.PROFILE_LINK);
    if (!profileLink) return;
    
    // Set modifying flag
    sidebarModifying = true;

    // Deep clone the profile link to get exact same structure and classes
    const link = profileLink.cloneNode(true);
    
    // Update the cloned link's attributes - use both ID and class
    link.id = 'x-country-blocker-link';
    link.classList.add('x-blocker-nav-link');
    link.href = '#';
    link.removeAttribute('data-testid');
    link.setAttribute('aria-label', 'Block Countries');
    
    // Find and replace the SVG icon with our shield icon
    const svg = link.querySelector('svg');
    if (svg) {
        svg.innerHTML = '<g><path d="M12 2L4 5v6.09c0 5.05 3.41 9.76 8 10.91 4.59-1.15 8-5.86 8-10.91V5l-8-3zm6 9.09c0 4-2.55 7.7-6 8.83-3.45-1.13-6-4.82-6-8.83V6.31l6-2.12 6 2.12v4.78z"></path></g>';
    }
    
    // Find and replace the text content - try multiple methods
    // Method 1: Direct span search within [dir="ltr"]
    const textDiv = link.querySelector('[dir="ltr"]');
    if (textDiv) {
        const spans = textDiv.querySelectorAll('span');
        if (spans.length > 0) {
            // First span should be the text, keep structure
            spans[0].textContent = 'Block Countries';
            // Second span is usually just a space, keep it
        } else {
            // Fallback: set text directly
            textDiv.textContent = 'Block Countries';
        }
    } else {
        // Method 2: Find any container that might have text "Profile"
        const allSpans = link.querySelectorAll('span');
        for (const span of allSpans) {
            if (span.textContent.trim() === 'Profile') {
                span.textContent = 'Block Countries';
                break;
            }
        }
    }

    // Remove any event listeners from clone by replacing onclick
    link.onclick = e => {
        e.preventDefault();
        e.stopPropagation();
        showBlockerModal();
    };

    profileLink.parentElement.insertBefore(link, profileLink.nextSibling);
    
    // Clear modifying flag after insertion
    setTimeout(() => {
        sidebarModifying = false;
    }, 50);
}

/**
 * Cleanup all resources (for extension unload/reload)
 */
function cleanup() {
    debug('Cleaning up X-Posed resources...');
    
    // Run all cleanup functions
    for (const cleanupFn of cleanupFunctions) {
        try {
            cleanupFn();
        } catch (error) {
            console.error('X-Posed: Cleanup error:', error);
        }
    }
    cleanupFunctions = [];
    
    // Clear observers
    if (observer) {
        observer.disconnect();
        observer = null;
    }
    if (themeObserver) {
        themeObserver.disconnect();
        themeObserver = null;
    }
    
    // Clear timeouts
    if (resizeTimeout) {
        clearTimeout(resizeTimeout);
        resizeTimeout = null;
    }
    
    // Clear processing queue and cache
    processingQueue.clear();
    userInfoCache.clear();
    
    debug('Cleanup complete');
}

// Handle page unload for cleanup
window.addEventListener('beforeunload', cleanup);

/**
 * Show the country blocker modal
 */
function showBlockerModal() {
    showModal(blockedCountries, async (action, country) => {
        const response = await sendMessage({
            type: MESSAGE_TYPES.SET_BLOCKED_COUNTRIES,
            payload: { action, country }
        });
        
        if (response?.success) {
            blockedCountries = new Set(response.data);
        }
        
        return response;
    });
}

// Initialize when script loads
initialize();

// Export for potential debugging
window.__X_POSED_CONTENT__ = {
    version: VERSION,
    scanPage,
    getState: () => ({ isEnabled, blockedCountries: Array.from(blockedCountries), settings })
};