/**
 * Observer Module
 * Handles DOM observation, user processing, and caching
 */

import { SELECTORS, CSS_CLASSES, MESSAGE_TYPES, TIMING } from '../shared/constants.js';
import { extractUsername, findInsertionPoint } from '../shared/utils.js';
import { createBadge, findUserCellInsertionPoint, showRateLimitToast } from './ui.js';
import { LRUCache } from '../shared/lru-cache.js';

// ============================================
// VALIDATION
// ============================================

/**
 * Validate a Twitter/X screen name
 * Valid screen names: 1-15 chars, alphanumeric + underscore only
 * @param {string} screenName - The screen name to validate
 * @returns {boolean} - True if valid
 */
function isValidScreenName(screenName) {
    if (!screenName || typeof screenName !== 'string') return false;
    return /^[a-zA-Z0-9_]{1,15}$/.test(screenName);
}

// ============================================
// LRU CACHE (using shared implementation from storage.js)
// ============================================

const USER_INFO_CACHE_MAX_SIZE = 1000;

// Cached combined selector for better performance (avoids repeated string creation)
const COMBINED_USER_SELECTOR = `${SELECTORS.USERNAME}, ${SELECTORS.USER_CELL}`;

// Use the shared LRU cache implementation to avoid code duplication
export const userInfoCache = new LRUCache(USER_INFO_CACHE_MAX_SIZE);

// ============================================
// STATE
// ============================================

let observer = null;
let intersectionObserver = null;
const pendingVisibility = new Map();
const PENDING_VISIBILITY_MAX_SIZE = 500;

// Processing queue with bounded size and timeout cleanup
// Map<screenName, Promise> for deduplication and waiting on in-flight requests
const PROCESSING_QUEUE_MAX_SIZE = 200;
export const processingQueue = new Map();

// Toast cooldown tracking
let lastRateLimitToastTime = 0;

// Cleanup functions registry
export const observerCleanupFunctions = [];

// ============================================
// USERNAME EXTRACTION
// ============================================

/**
 * Extract username from a UserCell element
 */
export function extractUsernameFromUserCell(userCell) {
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
        if (href.includes('/') && href.split('/').length === 2) {
            const screenName = href.slice(1);
            if (/^[a-zA-Z0-9_]+$/.test(screenName)) {
                return screenName;
            }
        }
    }
    
    return null;
}

// ============================================
// INTERSECTION OBSERVER
// ============================================

/**
 * Start Intersection Observer for lazy processing
 */
export function startIntersectionObserver(processElementSafe, _debug) {
    if (intersectionObserver) return;
    
    intersectionObserver = new IntersectionObserver(
        entries => {
            for (const entry of entries) {
                if (entry.isIntersecting) {
                    const element = entry.target;
                    
                    intersectionObserver.unobserve(element);
                    pendingVisibility.delete(element);
                    
                    processElementSafe(element);
                }
            }
        },
        {
            rootMargin: '200px',
            threshold: 0
        }
    );
    
    observerCleanupFunctions.push(() => {
        if (intersectionObserver) {
            intersectionObserver.disconnect();
            intersectionObserver = null;
        }
        pendingVisibility.clear();
    });
}

/**
 * Queue element for processing when visible
 */
export function queueForVisibility(element, processElementSafe, debug) {
    if (!intersectionObserver) {
        processElementSafe(element);
        return;
    }
    
    if (pendingVisibility.has(element) || element.dataset.xProcessed) {
        return;
    }
    
    if (pendingVisibility.size >= PENDING_VISIBILITY_MAX_SIZE) {
        const firstKey = pendingVisibility.keys().next().value;
        if (firstKey) {
            intersectionObserver.unobserve(firstKey);
            pendingVisibility.delete(firstKey);
            if (debug) debug(`Evicted oldest pending visibility entry, queue size: ${pendingVisibility.size}`);
        }
    }
    
    pendingVisibility.set(element, true);
    intersectionObserver.observe(element);
}

// ============================================
// MUTATION OBSERVER
// ============================================

/**
 * Start MutationObserver for DOM changes
 */
export function startObserver(isEnabled, processElementSafe, scanPage, debug) {
    if (observer) return;
    
    // Start Intersection Observer
    startIntersectionObserver(processElementSafe, debug);

    let pendingElements = new Set();
    let processTimeout = null;

    const processPending = () => {
        if (pendingElements.size === 0) return;
        
        const elements = Array.from(pendingElements);
        pendingElements = new Set();
        
        for (const element of elements) {
            queueForVisibility(element, processElementSafe, debug);
        }
    };

    const scheduleProcessing = () => {
        if (processTimeout) return;
        processTimeout = setTimeout(() => {
            processTimeout = null;
            processPending();
        }, 50);
    };

    observer = new MutationObserver(mutations => {
        if (!isEnabled()) return;

        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (node.nodeType !== Node.ELEMENT_NODE) continue;

                // Check if the node itself matches (single combined check)
                if (node.matches && node.matches(COMBINED_USER_SELECTOR)) {
                    if (!node.dataset.xProcessed) {
                        pendingElements.add(node);
                    }
                }

                // Query descendants with combined selector (single DOM query)
                if (node.querySelectorAll) {
                    const elements = node.querySelectorAll(COMBINED_USER_SELECTOR);
                    for (let i = 0; i < elements.length; i++) {
                        const el = elements[i];
                        if (!el.dataset.xProcessed) {
                            pendingElements.add(el);
                        }
                    }
                }
            }
        }

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
    
    // Delayed scan after X loads
    setTimeout(() => scanPage(), 2000);
    
    observerCleanupFunctions.push(() => {
        if (observer) {
            observer.disconnect();
            observer = null;
        }
    });
}

/**
 * Scan the current page for username elements
 */
export function scanPage(isEnabled, processElementsBatch, _debug) {
    if (!isEnabled()) return;

    // Use cached combined selector for single DOM query (better performance)
    const elements = document.querySelectorAll(COMBINED_USER_SELECTOR);
    
    if (elements.length > 0) {
        console.log(`🔍 X-Posed: Found ${elements.length} user elements to process`);
    }
    
    processElementsBatch(Array.from(elements));
}

/**
 * Process elements in batches
 */
export function processElementsBatch(elements, processElementSafe, debug) {
    if (elements.length === 0) return;

    for (const element of elements) {
        queueForVisibility(element, processElementSafe, debug);
    }
}

// ============================================
// USER ELEMENT PROCESSING
// ============================================

/**
 * Safe wrapper for processElement with error boundary
 */
export function createProcessElementSafe(processElement) {
    return function processElementSafe(element) {
        try {
            processElement(element).catch(error => {
                console.error('X-Posed: Error processing element:', error.message);
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
    };
}

/**
 * Process a single username element
 */
export async function processElement(element, {
    blockedCountries,
    settings,
    csrfToken,
    sendMessage,
    debug,
    debugMode
}) {
    const isUserCell = element.matches && element.matches(SELECTORS.USER_CELL);
    
    const screenName = isUserCell
        ? extractUsernameFromUserCell(element)
        : extractUsername(element);
        
    if (!screenName) {
        return;
    }
    
    // Validate screen name to prevent injection attacks
    if (!isValidScreenName(screenName)) {
        if (debug) debug(`Invalid screen name rejected: ${screenName.substring(0, 20)}...`);
        return;
    }
    
    // Handle element recycling
    if (element.dataset.xProcessed) {
        const previousScreenName = element.dataset.xScreenName;
        if (previousScreenName === screenName) {
            if (element.querySelector(`.${CSS_CLASSES.INFO_BADGE}`)) {
                return;
            }
        } else {
            if (debug) debug(`Element recycled: @${previousScreenName} → @${screenName}`);
            const oldBadge = element.querySelector(`.${CSS_CLASSES.INFO_BADGE}`);
            if (oldBadge) oldBadge.remove();
            delete element.dataset.xProcessed;
            delete element.dataset.xScreenName;
            delete element.dataset.xCountry;
        }
    }
    
    element.dataset.xProcessed = 'true';
    element.dataset.xScreenName = screenName;

    if (debug) debug(`Processing @${screenName}`);

    // Check local cache
    if (userInfoCache.has(screenName)) {
        if (debug) debug(`Using local cache for @${screenName}`);
        const info = userInfoCache.get(screenName);
        if (info) {
            element.dataset.xCountry = info.location || '';
            element.dataset.xVpn = info.locationAccurate === false ? 'true' : '';
                
            // Hide if country is blocked
            if (info.location && blockedCountries.has(info.location.toLowerCase())) {
                const tweet = element.closest(SELECTORS.TWEET);
                if (tweet) {
                    tweet.classList.add(CSS_CLASSES.TWEET_BLOCKED);
                }
                return;
            }
            
            // Hide if VPN detected and showVpnUsers is disabled
            if (info.locationAccurate === false && settings.showVpnUsers === false) {
                const tweet = element.closest(SELECTORS.TWEET);
                if (tweet) {
                    tweet.classList.add(CSS_CLASSES.TWEET_BLOCKED);
                    tweet.classList.add('x-tweet-vpn-blocked');
                }
                return;
            }
            
            if (info.location || info.device) {
                try {
                    createBadge(element, screenName, info, isUserCell, settings, debug);
                } catch (badgeError) {
                    if (debug) debug(`Badge creation error for @${screenName}: ${badgeError.message}`);
                }
            }
        }
        return;
    }

    // Check if request in flight - use promise-based waiting instead of arbitrary timeout
    if (processingQueue.has(screenName)) {
        // Wait for the in-flight request to complete using the stored promise
        const pendingPromise = processingQueue.get(screenName);
        if (pendingPromise && typeof pendingPromise.then === 'function') {
            try {
                await pendingPromise;
            } catch {
                // Ignore errors - we'll check cache below
            }
        }
        
        // Now check if cache was populated
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
                    createBadge(element, screenName, info, isUserCell, settings, debug);
                }
            }
        }
        return;
    }

    // Create the processing promise and store it for waiting
    let resolveProcessing;
    const processingPromise = new Promise(resolve => {
        resolveProcessing = resolve;
    });
    // Evict oldest entry if queue is at capacity
    if (processingQueue.size >= PROCESSING_QUEUE_MAX_SIZE) {
        const firstKey = processingQueue.keys().next().value;
        if (firstKey) {
            processingQueue.delete(firstKey);
            if (debug) debug(`Evicted oldest processing entry (${firstKey}), queue was full`);
        }
    }
    
    processingQueue.set(screenName, processingPromise);
    
    const processingTimeout = setTimeout(() => {
        if (processingQueue.has(screenName)) {
            if (debug) debug(`Cleaning up stale processing entry for @${screenName}`);
            processingQueue.delete(screenName);
            resolveProcessing();
        }
    }, 30000);
    
    // Show shimmer in debug mode
    let shimmer = null;
    if (debugMode) {
        shimmer = document.createElement('span');
        shimmer.className = CSS_CLASSES.FLAG_SHIMMER;
        const insertionPoint = isUserCell
            ? findUserCellInsertionPoint(element, screenName)
            : findInsertionPoint(element, screenName);
        if (insertionPoint) {
            insertionPoint.target.insertBefore(shimmer, insertionPoint.ref);
        }
    }

    try {
        const response = await sendMessage({
            type: MESSAGE_TYPES.FETCH_USER_INFO,
            payload: { screenName, csrfToken }
        });

        if (shimmer) shimmer.remove();

        if (!response?.success || !response.data) {
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
                            relativeStr = mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
                        } else {
                            relativeStr = `${diffMins} min${diffMins > 1 ? 's' : ''}`;
                        }
                    }
                }
                
                console.warn(`⚠️ X-Posed: Rate limited! Resets at ${resetStr}${relativeStr ? ` (in ${relativeStr})` : ''}`);
                
                const now = Date.now();
                if (now - lastRateLimitToastTime > TIMING.RATE_LIMIT_TOAST_COOLDOWN_MS) {
                    lastRateLimitToastTime = now;
                    showRateLimitToast(relativeStr || 'a few minutes');
                }
            } else if (response?.error) {
                if (debug) debug(`API error for @${screenName}: ${response.error}`);
            }
            userInfoCache.set(screenName, null);
            processingQueue.delete(screenName);
            return;
        }

        const info = response.data;
        if (debug) debug(`Received data for @${screenName}:`, { location: info.location, device: info.device });
        
        userInfoCache.set(screenName, info);
        
        element.dataset.xCountry = info.location || '';
        element.dataset.xVpn = info.locationAccurate === false ? 'true' : '';

        // Hide if country is blocked
        if (info.location && blockedCountries.has(info.location.toLowerCase())) {
            const tweet = element.closest(SELECTORS.TWEET);
            if (tweet) {
                tweet.classList.add(CSS_CLASSES.TWEET_BLOCKED);
            }
            processingQueue.delete(screenName);
            return;
        }

        // Hide if VPN detected and showVpnUsers is disabled
        if (info.locationAccurate === false && settings.showVpnUsers === false) {
            const tweet = element.closest(SELECTORS.TWEET);
            if (tweet) {
                tweet.classList.add(CSS_CLASSES.TWEET_BLOCKED);
                tweet.classList.add('x-tweet-vpn-blocked');
            }
            processingQueue.delete(screenName);
            return;
        }

        if (info.location || info.device) {
            try {
                createBadge(element, screenName, info, isUserCell, settings, debug);
            } catch (badgeError) {
                if (debug) debug(`Badge creation error for @${screenName}: ${badgeError.message}`);
            }
        }
    } catch (error) {
        userInfoCache.set(screenName, null);
    } finally {
        clearTimeout(processingTimeout);
        processingQueue.delete(screenName);
        resolveProcessing(); // Signal completion to waiting requests
    }
}

// ============================================
// BLOCKED TWEETS UPDATE
// ============================================

/**
 * Update visibility of tweets based on blocked countries
 */
export function updateBlockedTweets(blockedCountries) {
    document.querySelectorAll('[data-x-screen-name]').forEach(element => {
        const country = element.dataset.xCountry;
        
        if (!country) return;
        
        const tweet = element.closest(SELECTORS.TWEET);
        if (!tweet) return;
        
        const isBlocked = blockedCountries.has(country.toLowerCase());
        tweet.classList.toggle(CSS_CLASSES.TWEET_BLOCKED, isBlocked);
        
        const badge = element.querySelector(`.${CSS_CLASSES.INFO_BADGE}`);
        if (badge) {
            badge.style.display = isBlocked ? 'none' : '';
        }
    });
}

// ============================================
// CLEANUP
// ============================================

/**
 * Cleanup all observer resources
 */
export function cleanupObservers() {
    for (const cleanupFn of observerCleanupFunctions) {
        try {
            cleanupFn();
        } catch (error) {
            console.error('X-Posed: Observer cleanup error:', error);
        }
    }
    observerCleanupFunctions.length = 0;
    
    // Clear all processing queues properly
    processingQueue.clear();
    userInfoCache.clear();
    pendingVisibility.clear();
}