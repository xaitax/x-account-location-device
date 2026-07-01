/**
 * Observer Module
 * Handles DOM observation, user processing, and caching
 */

import { SELECTORS, CSS_CLASSES, MESSAGE_TYPES, TIMING } from '../shared/constants.js';
import { extractUsername, findInsertionPoint, getLoggedInUsername, extractTagsFromText, getDeviceCountry } from '../shared/utils.js';
import { createBadge, findUserCellInsertionPoint, showRateLimitToast } from './ui.js';
import { LRUCache } from '../shared/lru-cache.js';

/**
 * Resolve the country used for the flag, the xCountry dataset, and country/region
 * blocking. When the "flag from device" option is on (issue #17) and the device
 * source string carries a country, that country wins; otherwise we use the
 * account location. Web/unknown device sources have no country, so we fall back
 * to location. Returns null when neither is known.
 * @param {{location?: string, device?: string}|null|undefined} info
 * @param {boolean} flagFromDevice
 * @returns {string|null}
 */
function effectiveCountry(info, flagFromDevice) {
    if (flagFromDevice && info?.device) {
        const deviceCountry = getDeviceCountry(info.device);
        if (deviceCountry) return deviceCountry;
    }
    return info?.location || null;
}

/**
 * Apply a row's block/highlight/VPN state to the username element and its tweet
 * article AUTHORITATIVELY: every reason re-sets the marker it owns and clears the
 * ones that no longer apply. This is what lets the timeline recover when a setting
 * flips (e.g. re-enabling "Show VPN/Proxy Users") or when X recycles a row that was
 * hidden under a previous setting — the old code only ever ADDED markers, so a hidden
 * row stayed hidden until a hard reload.
 *
 * VPN-hide is a hard filter (always hides when on); country/region/tag blocks honor
 * the hide-vs-highlight preference. The persistent data-x-block marker lets CSS :has()
 * keep the article styled even after X re-renders it and wipes our class.
 *
 * Shared by the per-element resolution path (applyInfoToElement) and the bulk
 * re-derive pass (runUpdateBlockedTweets) so the two can never disagree about a row.
 * @param {HTMLElement} element
 * @param {HTMLElement|null} tweet
 * @param {{isListBlocked: boolean, isVpnHidden: boolean, highlightMode: boolean}} state
 * @returns {{hide: boolean, highlight: boolean}}
 */
function applyBlockState(element, tweet, { isListBlocked, isVpnHidden, highlightMode }) {
    const hide = isVpnHidden || (isListBlocked && !highlightMode);
    const highlight = !hide && isListBlocked && highlightMode;

    if (tweet) {
        tweet.classList.toggle(CSS_CLASSES.TWEET_BLOCKED, hide);
        tweet.classList.toggle('x-tweet-vpn-blocked', isVpnHidden);
        tweet.classList.toggle('x-tweet-highlighted', highlight);
    }
    element.dataset.xBlock = hide ? 'hide' : (highlight ? 'highlight' : '');

    return { hide, highlight };
}

/**
 * Apply resolved user info to an element: write the data-* attributes, run the
 * blocked-country/region/tag + VPN handling, and create the badge. This is the single
 * source of truth shared by all three processElement resolution paths (local-cache
 * hit, in-flight resolved, fresh API response) so they behave identically.
 * @param {HTMLElement} element
 * @param {string} screenName
 * @param {{location?: string, device?: string, locationAccurate?: boolean}} info
 * @param {Object} opts
 * @param {Set} opts.blockedCountries - lowercase blocked country names
 * @param {Set} [opts.blockedRegions] - lowercase blocked region names
 * @param {Object} opts.settings
 * @param {boolean} opts.isUserCell
 * @param {HTMLElement|null} opts.tweet - the already-resolved tweet article
 * @param {boolean} [opts.tagBlocked] - display-name tag verdict computed in processElement
 * @param {Function} [opts.debug]
 * @param {string|null} [opts.csrfToken]
 */
function applyInfoToElement(element, screenName, info, opts) {
    const { blockedCountries, blockedRegions, settings, isUserCell, tweet, debug, csrfToken, tagBlocked } = opts;

    const effCountry = effectiveCountry(info, settings.flagFromDevice);
    element.dataset.xCountry = effCountry || '';

    const loggedInUser = getLoggedInUsername();
    const isSelf = loggedInUser && screenName.toLowerCase() === loggedInUser.toLowerCase();

    // Resolve the full block decision from every reason at once, then apply it in one
    // authoritative pass (set what applies, clear what doesn't). Country/region/tag only
    // block the MAIN author, not a quoted user; VPN-hide is a hard filter.
    const locationLower = effCountry ? effCountry.toLowerCase() : '';
    const isQuote = isInsideQuoteTweet(element, tweet);
    const isListBlocked =
        ((locationLower !== '' &&
            (blockedCountries.has(locationLower) || (blockedRegions && blockedRegions.has(locationLower)))) ||
            tagBlocked) &&
        !isQuote && !isSelf;
    const isVpnHidden = info.locationAccurate === false && settings.showVpnUsers === false && !isSelf;

    const { hide } = applyBlockState(element, tweet, {
        isListBlocked,
        isVpnHidden,
        highlightMode: settings.highlightBlockedTweets === true
    });

    if (hide) return; // hidden row → don't build a badge

    if (info.location || info.device) {
        try {
            createBadge(element, screenName, info, isUserCell, settings, debug, csrfToken, effCountry);
        } catch (badgeError) {
            if (debug) debug(`Badge creation error for @${screenName}: ${badgeError.message}`);
        }
    }
}

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

/**
 * Check if element is inside a quoted tweet (not the main tweet author)
 * Quote tweets on X are inside clickable card containers with role="link" and tabindex="0"
 * @param {HTMLElement} element - The element to check
 * @param {HTMLElement|null} [tweet] - The already-resolved tweet article (avoids a
 *   redundant closest() call). Falls back to element.closest(TWEET) when omitted.
 * @returns {boolean} - True if inside a quote tweet
 */
function isInsideQuoteTweet(element, tweet = element.closest(SELECTORS.TWEET)) {
    // Get the tweet article
    if (!tweet) return false;

    // Walk up from the element to the tweet article
    // If we encounter a quote card container, this is a quoted user
    let current = element.parentElement;
    while (current && current !== tweet) {
        // Quote tweet cards are clickable containers with role="link" and tabindex="0"
        // They contain the quoted tweet's content including the username
        if (current.getAttribute('role') === 'link' &&
            current.getAttribute('tabindex') === '0') {
            return true;
        }
        current = current.parentElement;
    }

    return false;
}

/**
 * Read the language X assigned to the MAIN tweet's text (issue #25). X tags every
 * text tweet with its own ML-detected BCP-47 language on the tweetText node
 * (`<div data-testid="tweetText" lang="ja">`). We use the FIRST tweetText that is
 * NOT inside a quoted-tweet card, so a quote's language can't stand in for the
 * author's own post. Returns the lowercase primary subtag ("zh" from "zh-Hant"),
 * or null when the main tweet has no text (media/link/emoji-only rows have no
 * tweetText, or carry lang="und").
 * @param {HTMLElement} tweet - the article element
 * @returns {string|null}
 */
function getMainTweetLanguage(tweet) {
    const texts = tweet.querySelectorAll('[data-testid="tweetText"]');
    for (const node of texts) {
        if (!isInsideQuoteTweet(node, tweet)) {
            const lang = node.getAttribute('lang');
            if (!lang) return null;
            return lang.split('-')[0].toLowerCase();
        }
    }
    return null;
}

/**
 * Mark (or unmark) a tweet article for language blocking. Uses a SEPARATE
 * article-level marker (data-x-lang-block) from the per-author data-x-block, so
 * the two filters compose in CSS instead of clobbering each other's state. The
 * marker honors the hide-vs-highlight preference; 'und' (undetermined —
 * emoji/link-only) is never blocked.
 * @param {HTMLElement|null} tweet - the article element
 * @param {Set<string>} blockedLanguages - lowercase primary subtags
 * @param {Object} settings
 */
function applyLanguageBlock(tweet, blockedLanguages, settings) {
    if (!tweet) return;

    let blocked = false;
    if (blockedLanguages && blockedLanguages.size > 0) {
        const lang = getMainTweetLanguage(tweet);
        if (lang && lang !== 'und' && blockedLanguages.has(lang)) {
            blocked = true;
        }
    }

    if (blocked) {
        tweet.dataset.xLangBlock = settings.highlightBlockedTweets === true ? 'highlight' : 'hide';
    } else if (tweet.dataset.xLangBlock) {
        delete tweet.dataset.xLangBlock;
    }
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
// DISPLAY NAME EXTRACTION
// ============================================

/**
 * Extract display name including emojis from an element
 * X renders emojis as <img alt="emoji"> tags, so we need to reconstruct the full text
 * @param {HTMLElement} element - The username element
 * @returns {string} - Display name with emojis
 */
function extractDisplayName(element) {
    // Find the tweet or user cell
    const tweet = element.closest(SELECTORS.TWEET);
    const userCell = element.closest(SELECTORS.USER_CELL);
    const container = tweet || userCell;
    if (!container) return '';
    
    // Method 1: Look for User-Name testid which contains display name and @handle
    const userNameContainer = container.querySelector('[data-testid="User-Name"]');
    if (userNameContainer) {
        // The first link usually contains the display name
        const displayNameLink = userNameContainer.querySelector('a[href^="/"]');
        if (displayNameLink) {
            const displayName = extractTextWithEmojis(displayNameLink);
            if (displayName && !displayName.startsWith('@')) {
                return displayName;
            }
        }
    }
    
    // Method 2: Look for profile links with role="link"
    const profileLinks = container.querySelectorAll('a[href^="/"][role="link"]');
    for (const link of profileLinks) {
        const displayName = extractTextWithEmojis(link);
        // Skip if it looks like a @username or if it's empty
        if (displayName && !displayName.startsWith('@') && displayName.length > 0) {
            return displayName;
        }
    }
    
    // Method 3: Check the element itself if it contains the display name
    const parentSpan = element.closest('span');
    if (parentSpan) {
        const displayName = extractTextWithEmojis(parentSpan);
        if (displayName && !displayName.startsWith('@')) {
            return displayName;
        }
    }
    
    return '';
}

/**
 * Extract text content including emoji alt text from an element
 * @param {HTMLElement} element - Element to extract text from
 * @returns {string} - Text with emojis
 */
function extractTextWithEmojis(element) {
    let result = '';
    
    const walker = document.createTreeWalker(
        element,
        NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
        {
            acceptNode: node => {
                if (node.nodeType === Node.TEXT_NODE) return NodeFilter.FILTER_ACCEPT;
                if (node.nodeName === 'IMG' && node.alt) return NodeFilter.FILTER_ACCEPT;
                return NodeFilter.FILTER_SKIP;
            }
        }
    );
    
    let node;
    while ((node = walker.nextNode())) {
        if (node.nodeType === Node.TEXT_NODE) {
            result += node.textContent;
        } else if (node.nodeName === 'IMG' && node.alt) {
            result += node.alt;
        }
    }
    
    return result.trim();
}

/**
 * Check if a display name contains any blocked tags
 * @param {string} displayName - The display name to check
 * @param {Set} blockedTags - Set of blocked tags
 * @returns {boolean} - True if any blocked tag is found
 */
function hasBlockedTag(displayName, blockedTags) {
    if (!displayName || !blockedTags || blockedTags.size === 0) return false;
    
    // Extract tags from display name
    const nameTags = extractTagsFromText(displayName);
    
    // Check each tag against blocked set
    for (const tag of nameTags) {
        if (blockedTags.has(tag)) {
            return true;
        }
    }
    
    // Also check if the display name contains any blocked tag as a substring
    const displayLower = displayName.toLowerCase();
    for (const blockedTag of blockedTags) {
        const tagLower = blockedTag.toLowerCase();
        if (displayLower.includes(tagLower)) {
            return true;
        }
    }
    
    return false;
}

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

                // Query descendants with combined selector (single DOM query).
                // Skip leaf nodes (no element children): they can't contain a match, and
                // X emits constant churn of such nodes (icons, text spans, animation
                // layers) during scroll. The self-check above already covers the node itself.
                if (node.querySelectorAll && node.firstElementChild) {
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
export function scanPage(isEnabled, processElementsBatch, debug) {
    if (!isEnabled()) return;

    // Use cached combined selector for single DOM query (better performance)
    const elements = document.querySelectorAll(COMBINED_USER_SELECTOR);

    if (elements.length > 0 && debug) {
        debug(`Found ${elements.length} user elements to process`);
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
    blockedRegions,
    blockedTags,
    blockedLanguages,
    settings,
    csrfToken,
    sendMessage,
    fetchUserInfoViaPage,
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
            // Already resolved for this user, and the outcome is terminal: a badge means a
            // visible row; data-x-block="hide" means we deliberately hid it (VPN or a list
            // block). Either way, don't reprocess on every scan — that was a per-scan busy
            // loop on badge-less hidden rows. Recovery still happens because a settings
            // change clears xProcessed (see content-script SETTINGS_UPDATED) and a
            // blocked-list change re-derives directly via runUpdateBlockedTweets.
            if (element.querySelector(`.${CSS_CLASSES.INFO_BADGE}`) || element.dataset.xBlock === 'hide') {
                return;
            }
        } else {
            if (debug) debug(`Element recycled: @${previousScreenName} → @${screenName}`);
            const oldBadge = element.querySelector(`.${CSS_CLASSES.INFO_BADGE}`);
            if (oldBadge) oldBadge.remove();
            delete element.dataset.xProcessed;
            delete element.dataset.xScreenName;
            delete element.dataset.xCountry;
            delete element.dataset.xBlock;
        }
    }
    
    element.dataset.xProcessed = 'true';
    element.dataset.xScreenName = screenName;

    if (debug) debug(`Processing @${screenName}`);

    // Resolve the enclosing tweet article ONCE and reuse it everywhere below
    // (including inside isInsideQuoteTweet) to avoid repeated closest() walks.
    const tweet = element.closest(SELECTORS.TWEET);

    // Language blocking is a per-tweet signal (X's own lang tag), independent of the
    // author lookup — apply it eagerly here, before any early return below, so
    // media/API state can't gate it. Marks the article via a separate data-x-lang-block.
    applyLanguageBlock(tweet, blockedLanguages, settings);

    // In HIDE mode a language-blocked article is fully hidden by CSS, so skip the badge
    // AND the user-info lookup entirely — otherwise blocking a common language would fire
    // a lookup per hidden tweet (mirrors the blocked-tag short-circuit). xScreenName is
    // already set above, so unblocking the language re-derives the row via the article
    // pass in runUpdateBlockedTweets. HIGHLIGHT mode keeps the badge (row stays visible).
    if (tweet && tweet.dataset.xLangBlock === 'hide') {
        return;
    }

    // Detect a blocked tag in the display name up front. In HIDE mode we can short-circuit
    // here (no badge needed) and skip the API call entirely; in HIGHLIGHT mode we still
    // need the badge, so we only remember the verdict and let applyInfoToElement apply it
    // together with the country/region/VPN checks (one authoritative pass).
    let tagBlocked = false;
    if (blockedTags && blockedTags.size > 0) {
        const displayName = extractDisplayName(element);
        if (displayName && hasBlockedTag(displayName, blockedTags)) {
            const isQuote = isInsideQuoteTweet(element, tweet);
            const loggedInUser = getLoggedInUsername();
            const isSelf = loggedInUser && screenName.toLowerCase() === loggedInUser.toLowerCase();

            if (!isQuote && !isSelf) {
                tagBlocked = true;
                if (debug) debug(`Blocked @${screenName} due to tag in display name: "${displayName}"`);

                if (tweet && settings.highlightBlockedTweets !== true) {
                    applyBlockState(element, tweet, { isListBlocked: true, isVpnHidden: false, highlightMode: false });
                    return;
                }
            }
        }
    }

    // Shared opts for applyInfoToElement across all three resolution paths
    const applyOpts = {
        blockedCountries,
        blockedRegions,
        settings,
        isUserCell,
        tweet,
        debug,
        csrfToken,
        tagBlocked
    };

    // Check local cache
    if (userInfoCache.has(screenName)) {
        if (debug) debug(`Using local cache for @${screenName}`);
        const info = userInfoCache.get(screenName);
        if (info) {
            applyInfoToElement(element, screenName, info, applyOpts);
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
                applyInfoToElement(element, screenName, info, applyOpts);
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
        let response = await sendMessage({
            type: MESSAGE_TYPES.FETCH_USER_INFO,
            payload: { screenName, csrfToken }
        });

        // Issue #14: if the background can't authenticate (e.g. a Firefox container
        // cookie mismatch), retry the lookup from the PAGE context — which uses the
        // page's own correct session — then cache the result via the background.
        if ((response?.code === 'UNAUTHORIZED' || response?.code === 'NO_HEADERS') && fetchUserInfoViaPage) {
            const pageResponse = await fetchUserInfoViaPage(screenName);
            if (pageResponse?.success) {
                response = { ...pageResponse, source: 'page' };
                await sendMessage({
                    type: MESSAGE_TYPES.SET_CACHE,
                    payload: { screenName, data: pageResponse.data }
                });
            }
        }

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

            // Issue #14: on auth failure (the in-page fetch fallback above also failed),
            // clear the processed markers so the element is retried once fresh headers
            // are captured — rather than being negative-cached for the session.
            if (response?.code === 'UNAUTHORIZED' || response?.code === 'NO_HEADERS') {
                delete element.dataset.xProcessed;
                delete element.dataset.xScreenName;
                processingQueue.delete(screenName);
                return;
            }

            // Issue #16: do NOT negative-cache other TRANSIENT failures (rate-limit,
            // network) for the session — caching null used to blank the user until LRU
            // eviction or a reload, even after the condition cleared. Only genuine
            // misses (not-found/unknown) are negative-cached.
            const code = response?.code;
            const isTransient = code === 'RATE_LIMITED' || code === 'NETWORK_ERROR';
            if (!isTransient) {
                userInfoCache.set(screenName, null);
            }
            processingQueue.delete(screenName);
            return;
        }

        const info = response.data;
        if (debug) debug(`Received data for @${screenName}:`, { location: info.location, device: info.device });

        userInfoCache.set(screenName, info);

        applyInfoToElement(element, screenName, info, applyOpts);
    } catch (error) {
        // Issue #16: a thrown error (e.g. messaging/network blip) is transient, so we
        // do NOT negative-cache it — the user is retried on a later scan rather than
        // being blanked for the session.
        if (debug) debug(`Processing error for @${screenName}: ${error?.message || error}`);
    } finally {
        clearTimeout(processingTimeout);
        processingQueue.delete(screenName);
        resolveProcessing(); // Signal completion to waiting requests
    }
}

// ============================================
// BLOCKED TWEETS UPDATE
// ============================================

// Coalesce rapid BLOCKED_COUNTRIES/REGIONS/TAGS updates into a single rAF pass.
// Each trigger fires updateBlockedTweets separately; without batching that means
// one full-document querySelectorAll (+ closest()/querySelector per match) per
// trigger. We keep only the LATEST args and run a single scan on the next frame.
let pendingBlockedTweetsUpdate = null;
let pendingBlockedTweetsArgs = null;

/**
 * Update visibility of tweets based on blocked countries and regions.
 * Coalesced: multiple calls within the same frame collapse into one DOM pass
 * using the most recent arguments.
 * @param {Set} blockedCountries - Set of blocked country names (lowercase)
 * @param {Set} blockedRegions - Set of blocked region names (lowercase)
 * @param {Set} blockedTags - Set of blocked tags (lowercase)
 * @param {Object} settings - Settings object with highlightBlockedTweets flag
 */
export function updateBlockedTweets(blockedCountries, blockedRegions, blockedTags, settings = {}, blockedLanguages = null) {
    pendingBlockedTweetsArgs = { blockedCountries, blockedRegions, blockedTags, settings, blockedLanguages };
    if (pendingBlockedTweetsUpdate !== null) return;

    pendingBlockedTweetsUpdate = requestAnimationFrame(() => {
        pendingBlockedTweetsUpdate = null;
        const args = pendingBlockedTweetsArgs;
        pendingBlockedTweetsArgs = null;
        if (args) {
            runUpdateBlockedTweets(args.blockedCountries, args.blockedRegions, args.blockedTags, args.settings, args.blockedLanguages);
        }
    });
}

/**
 * Perform the actual single-pass tweet visibility update. See updateBlockedTweets.
 */
function runUpdateBlockedTweets(blockedCountries, blockedRegions, blockedTags, settings = {}, blockedLanguages = null) {
    const highlightMode = settings.highlightBlockedTweets === true;
    const hasTags = blockedTags && blockedTags.size > 0;
    const loggedInUser = getLoggedInUsername();

    document.querySelectorAll('[data-x-screen-name]').forEach(element => {
        const tweet = element.closest(SELECTORS.TWEET);
        if (!tweet) return;

        const screenName = element.dataset.xScreenName;
        const isSelf = !!loggedInUser && !!screenName && screenName.toLowerCase() === loggedInUser.toLowerCase();
        const isQuote = isInsideQuoteTweet(element, tweet);

        const locationLower = element.dataset.xCountry ? element.dataset.xCountry.toLowerCase() : '';
        const isBlockedCountry = locationLower !== '' && blockedCountries.has(locationLower);
        const isBlockedRegion = locationLower !== '' && blockedRegions && blockedRegions.has(locationLower);

        // Re-derive tag-blocking from the CURRENT blocked-tags set against the live
        // display name (the row is still on screen). This is what makes adding OR
        // removing a tag re-apply to already-rendered tweets — and, because we never
        // trust a cached flag, a recycled row can't inherit a previous occupant's block.
        const isTagBlocked = hasTags && hasBlockedTag(extractDisplayName(element), blockedTags);

        const isListBlocked = (isBlockedCountry || isBlockedRegion || isTagBlocked) && !isQuote && !isSelf;

        // VPN-hide is a setting, not a blocked-list entry, so it isn't what changed here —
        // but we must still honor it, or a blocked-list edit would wrongly un-hide a VPN
        // row in highlight mode. locationAccurate lives on the cached info, keyed by name.
        const info = screenName ? userInfoCache.get(screenName) : null;
        const isVpnHidden = !!info && info.locationAccurate === false && settings.showVpnUsers === false && !isSelf;

        const { hide } = applyBlockState(element, tweet, { isListBlocked, isVpnHidden, highlightMode });

        const badge = element.querySelector(`.${CSS_CLASSES.INFO_BADGE}`);
        if (badge) badge.style.display = hide ? 'none' : '';
    });

    // Language blocking is per-tweet (not per-author), so re-derive it across ALL
    // articles — this is what makes adding OR removing a language re-apply to
    // already-rendered tweets. applyLanguageBlock authoritatively sets or clears the
    // marker, so a removed language un-hides its tweets. Runs only on config/setting
    // changes (this pass is rAF-coalesced), not per scroll.
    document.querySelectorAll(SELECTORS.TWEET).forEach(tweet => {
        applyLanguageBlock(tweet, blockedLanguages, settings);
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

    // Cancel any pending coalesced blocked-tweets update
    if (pendingBlockedTweetsUpdate !== null) {
        cancelAnimationFrame(pendingBlockedTweetsUpdate);
        pendingBlockedTweetsUpdate = null;
        pendingBlockedTweetsArgs = null;
    }

    // Clear all processing queues properly
    processingQueue.clear();
    userInfoCache.clear();
    pendingVisibility.clear();
}
