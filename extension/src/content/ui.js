/**
 * UI Module
 * Handles all visual/UI components: toasts, badges, theme, sidebar
 */

import browserAPI from '../shared/browser-api.js';
import { SELECTORS, CSS_CLASSES, TIMING } from '../shared/constants.js';
import { findInsertionPoint, getFlagEmoji, getDeviceEmoji, debounce, throttle } from '../shared/utils.js';
import { showModal } from './modal.js';
import { captureEvidence } from './evidence-capture.js';
import { hovercard } from './hovercard.js';

// ============================================
// STATE (module-local)
// ============================================

let themeObserver = null;
let toastContainer = null;
let sidebarObserver = null;
let currentNav = null;
let resizeTimeout = null;
let sidebarModifying = false;
let sidebarCheckInterval = null;
let sidebarCheckTimeout = null;

// Cleanup functions registry - using Map with keys to prevent duplicates and memory leaks
const cleanupRegistry = new Map();

// Export array-like interface for backward compatibility
export const uiCleanupFunctions = {
    push(fn, key = null) {
        const cleanupKey = key || `cleanup_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
        cleanupRegistry.set(cleanupKey, fn);
    },
    get length() {
        return cleanupRegistry.size;
    },
    set length(val) {
        if (val === 0) {
            cleanupRegistry.clear();
        }
    }
};

/**
 * Register a cleanup function with a unique key (prevents duplicate registrations)
 * @param {string} key - Unique identifier for this cleanup function
 * @param {Function} fn - Cleanup function to register
 */
function registerCleanup(key, fn) {
    cleanupRegistry.set(key, fn);
}

// ============================================
// THEME DETECTION
// ============================================

/**
 * Detect X's current theme from the page
 */
export function detectXTheme() {
    if (typeof document === 'undefined') return 'dark';

    // Check CSS variable first
    const bgColor = window.getComputedStyle(document.documentElement).getPropertyValue('--background-color').trim();
    
    if (bgColor) {
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
        if (bodyBg.includes('255, 255, 255')) return 'light';
        if (bodyBg.includes('21, 32, 43')) return 'dim';
        if (bodyBg.includes('0, 0, 0')) return 'dark';
    }
    
    // Check HTML background as last resort
    const htmlBg = window.getComputedStyle(document.documentElement).backgroundColor;
    if (htmlBg) {
        if (htmlBg.includes('255, 255, 255')) return 'light';
        if (htmlBg.includes('21, 32, 43')) return 'dim';
    }
    
    return 'dark'; // Default
}

/**
 * Detect current X theme and apply data attribute
 */
export function detectAndApplyTheme(debug) {
    const theme = detectXTheme();
    document.documentElement.setAttribute('data-x-theme', theme);
    if (debug) debug(`Theme detected: ${theme}`);
}

/**
 * Start observer for theme changes with throttling to prevent excessive calls
 */
export function startThemeObserver() {
    if (themeObserver) return;
    
    // Throttle theme detection to run at most once every 200ms
    const throttledThemeDetection = throttle(() => {
        detectAndApplyTheme();
    }, 200);
    
    themeObserver = new MutationObserver(() => {
        throttledThemeDetection();
    });
    
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
    
    // Use keyed cleanup to prevent duplicate registrations
    registerCleanup('themeObserver', () => {
        if (themeObserver) {
            themeObserver.disconnect();
            themeObserver = null;
        }
    });
}

// ============================================
// TOAST NOTIFICATIONS
// ============================================

/**
 * Get or create the toast container
 */
function getToastContainer() {
    if (!toastContainer || !toastContainer.isConnected) {
        toastContainer = document.createElement('div');
        toastContainer.className = 'x-toast-container';
        document.body.appendChild(toastContainer);
    }
    return toastContainer;
}

/**
 * Show a toast notification
 * @param {Object} options - Toast options
 * @param {string} options.title - Toast title
 * @param {string} options.message - Toast message (can include HTML)
 * @param {string} options.icon - Emoji icon to display
 * @param {string} options.iconType - Icon type for styling ('warning', 'error', 'success', 'info')
 * @param {number} options.duration - Auto-dismiss duration in ms (default 8000, 0 = no auto-dismiss)
 */
export function showToast({ title, message, icon = '⏳', iconType = 'warning', duration = 8000 }) {
    const container = getToastContainer();
    
    const toast = document.createElement('div');
    toast.className = 'x-toast';
    
    // Icon
    const iconEl = document.createElement('div');
    iconEl.className = `x-toast-icon x-toast-icon-${iconType}`;
    iconEl.textContent = icon;
    toast.appendChild(iconEl);
    
    // Content
    const contentEl = document.createElement('div');
    contentEl.className = 'x-toast-content';
    
    const titleEl = document.createElement('div');
    titleEl.className = 'x-toast-title';
    titleEl.textContent = title;
    contentEl.appendChild(titleEl);
    
    const messageEl = document.createElement('div');
    messageEl.className = 'x-toast-message';
    // Use textContent for safety, construct time badge safely if needed
    messageEl.textContent = message;
    contentEl.appendChild(messageEl);
    
    toast.appendChild(contentEl);
    
    // Close button (built with safe DOM methods)
    const closeBtn = document.createElement('button');
    closeBtn.className = 'x-toast-close';
    closeBtn.setAttribute('aria-label', 'Dismiss');
    
    const closeSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    closeSvg.setAttribute('viewBox', '0 0 24 24');
    closeSvg.setAttribute('fill', 'none');
    closeSvg.setAttribute('stroke', 'currentColor');
    closeSvg.setAttribute('stroke-width', '2');
    
    const closePath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    closePath.setAttribute('d', 'M18 6L6 18M6 6l12 12');
    closeSvg.appendChild(closePath);
    closeBtn.appendChild(closeSvg);
    
    closeBtn.addEventListener('click', () => dismissToast(toast));
    toast.appendChild(closeBtn);
    
    // Progress bar for auto-dismiss
    if (duration > 0) {
        const progress = document.createElement('div');
        progress.className = 'x-toast-progress';
        progress.style.animationDuration = `${duration}ms`;
        toast.appendChild(progress);
    }
    
    container.appendChild(toast);
    
    // Auto-dismiss
    if (duration > 0) {
        setTimeout(() => dismissToast(toast), duration);
    }
    
    return toast;
}

/**
 * Dismiss a toast with animation
 */
export function dismissToast(toast) {
    if (!toast || !toast.isConnected) return;
    
    toast.classList.add('x-toast-hiding');
    
    setTimeout(() => {
        if (toast.isConnected) {
            toast.remove();
        }
    }, 300);
}

/**
 * Show rate limit toast notification
 * @param {string} timeUntilReset - Human-readable time until reset
 */
export function showRateLimitToast(timeUntilReset) {
    // Sanitize the time string to prevent XSS
    const sanitizedTime = sanitizeText(timeUntilReset);
    
    showToastWithTimeBadge({
        title: 'Rate Limit Reached',
        message: 'X API limit hit. Resets in',
        timeBadge: `⏱️ ${sanitizedTime}`,
        icon: '⚠️',
        iconType: 'warning',
        duration: 8000
    });
}

/**
 * Show a toast notification with a styled time badge (XSS-safe)
 * @param {Object} options - Toast options with timeBadge for styled time display
 */
function showToastWithTimeBadge({ title, message, timeBadge, icon = '⏳', iconType = 'warning', duration = 8000 }) {
    const container = getToastContainer();
    
    const toast = document.createElement('div');
    toast.className = 'x-toast';
    
    // Icon
    const iconEl = document.createElement('div');
    iconEl.className = `x-toast-icon x-toast-icon-${iconType}`;
    iconEl.textContent = icon;
    toast.appendChild(iconEl);
    
    // Content
    const contentEl = document.createElement('div');
    contentEl.className = 'x-toast-content';
    
    const titleEl = document.createElement('div');
    titleEl.className = 'x-toast-title';
    titleEl.textContent = title;
    contentEl.appendChild(titleEl);
    
    const messageEl = document.createElement('div');
    messageEl.className = 'x-toast-message';
    
    // Add message text
    messageEl.appendChild(document.createTextNode(message + ' '));
    
    // Add time badge safely using DOM methods
    if (timeBadge) {
        const timeBadgeEl = document.createElement('span');
        timeBadgeEl.className = 'x-toast-time';
        timeBadgeEl.textContent = timeBadge;
        messageEl.appendChild(timeBadgeEl);
    }
    
    contentEl.appendChild(messageEl);
    toast.appendChild(contentEl);
    
    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.className = 'x-toast-close';
    closeBtn.setAttribute('aria-label', 'Dismiss');
    
    const closeSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    closeSvg.setAttribute('viewBox', '0 0 24 24');
    closeSvg.setAttribute('fill', 'none');
    closeSvg.setAttribute('stroke', 'currentColor');
    closeSvg.setAttribute('stroke-width', '2');
    
    const closePath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    closePath.setAttribute('d', 'M18 6L6 18M6 6l12 12');
    closeSvg.appendChild(closePath);
    closeBtn.appendChild(closeSvg);
    
    closeBtn.addEventListener('click', () => dismissToast(toast));
    toast.appendChild(closeBtn);
    
    // Progress bar for auto-dismiss
    if (duration > 0) {
        const progress = document.createElement('div');
        progress.className = 'x-toast-progress';
        progress.style.animationDuration = `${duration}ms`;
        toast.appendChild(progress);
    }
    
    container.appendChild(toast);
    
    // Auto-dismiss
    if (duration > 0) {
        setTimeout(() => dismissToast(toast), duration);
    }
    
    return toast;
}

// ============================================
// BADGE CREATION
// ============================================

/**
 * Sanitize text for safe display (prevents XSS)
 * @param {string} text - Text to sanitize
 * @returns {string} - Sanitized text, max 100 characters
 */
export function sanitizeText(text) {
    if (!text || typeof text !== 'string') return '';
    return text.replace(/[<>&"']/g, char => {
        const entities = { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' };
        return entities[char] || char;
    }).substring(0, 100);
}

/**
 * Create a Twemoji image element safely from the getFlagEmoji output
 * Only allows images from trusted Twemoji CDN
 * @param {string} imgTag - HTML img tag string from getFlagEmoji
 * @param {string} altText - Alt text for the image
 * @returns {HTMLImageElement|null} - Safe img element or null
 */
function createTwemojiImage(imgTag, altText) {
    // Extract src attribute safely using regex
    const srcMatch = imgTag.match(/src="(https:\/\/abs-0\.twimg\.com\/emoji\/v2\/svg\/[^"]+\.svg)"/);
    if (!srcMatch || !srcMatch[1]) {
        return null;
    }
    
    const src = srcMatch[1];
    
    // Validate URL is from trusted Twemoji CDN
    if (!src.startsWith('https://abs-0.twimg.com/emoji/v2/svg/')) {
        return null;
    }
    
    // Create image element safely
    const img = document.createElement('img');
    img.src = src;
    img.className = 'x-flag-emoji';
    img.alt = sanitizeText(altText) || 'flag';
    img.style.cssText = 'height: 1.2em; vertical-align: -0.2em;';
    
    return img;
}

/**
 * Find the insertion point for badge in UserCell
 */
export function findUserCellInsertionPoint(userCell, screenName) {
    const allSpans = userCell.querySelectorAll('span');
    for (const span of allSpans) {
        if (span.textContent === `@${screenName}`) {
            return { target: span.parentElement, ref: span.nextSibling };
        }
    }
    
    const nameLinks = userCell.querySelectorAll('a[href="/' + screenName + '"]');
    for (const link of nameLinks) {
        const nameSpan = link.querySelector('span span');
        if (nameSpan && !nameSpan.textContent.startsWith('@')) {
            return { target: link, ref: null };
        }
    }
    
    return null;
}

/**
 * Create info badge for a user
 */
export function createBadge(element, screenName, info, isUserCell, settings, debug, csrfToken = null) {
    if (element.querySelector(`.${CSS_CLASSES.INFO_BADGE}`)) {
        return;
    }

    const badge = document.createElement('span');
    badge.className = CSS_CLASSES.INFO_BADGE;
    
    let hasContent = false;

    // Add flag
    if (info.location && settings.showFlags !== false) {
        const flag = getFlagEmoji(info.location);
        if (flag) {
            const flagSpan = document.createElement('span');
            flagSpan.className = 'x-flag';
            flagSpan.title = sanitizeText(info.location);
            
            // Handle Twemoji img tags safely using DOM methods
            if (typeof flag === 'string' && flag.startsWith('<img')) {
                // Parse the trusted Twemoji img tag safely
                const imgEl = createTwemojiImage(flag, info.location);
                if (imgEl) {
                    flagSpan.appendChild(imgEl);
                } else {
                    flagSpan.textContent = '🌍'; // Fallback
                }
            } else {
                flagSpan.textContent = flag;
            }
            badge.appendChild(flagSpan);
            hasContent = true;
        }

        // VPN indicator
        if (info.locationAccurate === false && settings.showVpnIndicator !== false) {
            const vpnSpan = document.createElement('span');
            vpnSpan.className = 'x-vpn';
            vpnSpan.title = 'Location may not be accurate (VPN/Proxy detected)';
            vpnSpan.textContent = '🔒';
            badge.appendChild(vpnSpan);
        }
    }

    // Add device
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

    // Hover hint icon (hidden until badge hover) – indicates there’s a hovercard.
    const hint = document.createElement('span');
    hint.className = 'x-hover-hint';
    hint.title = 'Hover for details';
    hint.textContent = 'i';
    badge.appendChild(hint);

    // Capture button
    const captureBtn = document.createElement('button');
    captureBtn.className = 'x-capture-btn';
    captureBtn.title = 'Capture evidence screenshot';
    captureBtn.setAttribute('aria-label', 'Capture evidence');
    
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

    captureBtn.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        
        const tweet = element.closest(SELECTORS.TWEET);
        if (tweet) {
            captureEvidence(tweet, info, screenName);
        } else {
            console.warn('X-Posed: Could not find tweet to capture');
        }
    });

    const insertionPoint = isUserCell
        ? findUserCellInsertionPoint(element, screenName)
        : findInsertionPoint(element, screenName);
        
    if (insertionPoint) {
        insertionPoint.target.insertBefore(badge, insertionPoint.ref);
        if (debug) debug(`Badge inserted for @${screenName}${isUserCell ? ' (UserCell)' : ''}`);
    } else {
        if (debug) debug(`No insertion point found for @${screenName}${isUserCell ? ' (UserCell)' : ''}`);
    }

    // Attach hovercard; we fetch rich metadata only on hover
    hovercard.attach(badge, { screenName, info, csrfToken });
}

// ============================================
// SIDEBAR LINK
// ============================================

/**
 * Inject sidebar link for country blocker
 */
export function injectSidebarLink(settings, debug, blockedCountries, blockedRegions, sendMessage, MESSAGE_TYPES) {
    if (settings.showSidebarBlockerLink === false) {
        if (debug) debug('Sidebar blocker link disabled in settings');
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
            clearInterval(sidebarCheckInterval);
            sidebarCheckInterval = null;
            if (sidebarCheckTimeout) {
                clearTimeout(sidebarCheckTimeout);
                sidebarCheckTimeout = null;
            }
            
            currentNav = nav;
            addBlockerLink(nav, blockedCountries, blockedRegions, sendMessage, MESSAGE_TYPES);
            observeSidebarChanges(nav, settings, debug, blockedCountries, blockedRegions, sendMessage, MESSAGE_TYPES);
            setupResizeHandler(settings, debug, blockedCountries, blockedRegions, sendMessage, MESSAGE_TYPES);
        }
    }, TIMING.SIDEBAR_CHECK_MS);

    sidebarCheckTimeout = setTimeout(() => {
        if (sidebarCheckInterval) {
            clearInterval(sidebarCheckInterval);
            sidebarCheckInterval = null;
            if (debug) debug('Sidebar check timed out');
        }
    }, TIMING.SIDEBAR_TIMEOUT_MS);
    
    // Use keyed cleanup to prevent duplicate registrations
    registerCleanup('sidebarCheck', () => {
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
 * Observe sidebar for changes
 */
function observeSidebarChanges(nav, settings, debug, blockedCountries, blockedRegions, sendMessage, MESSAGE_TYPES) {
    if (sidebarObserver) {
        sidebarObserver.disconnect();
    }

    sidebarObserver = new MutationObserver(() => {
        if (sidebarModifying) return;
        
        const ourLink = document.getElementById('x-country-blocker-link');
        const profileLink = nav.querySelector(SELECTORS.PROFILE_LINK);
        
        if (!ourLink && profileLink && settings.showSidebarBlockerLink !== false) {
            if (debug) debug('Sidebar link removed, re-injecting...');
            
            sidebarObserver.disconnect();
            addBlockerLink(nav, blockedCountries, blockedRegions, sendMessage, MESSAGE_TYPES);
            
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
    
    // Use keyed cleanup to prevent duplicate registrations
    registerCleanup('sidebarObserver', () => {
        if (sidebarObserver) {
            sidebarObserver.disconnect();
            sidebarObserver = null;
        }
    });
}

/**
 * Handle window resize
 */
function setupResizeHandler(settings, debug, blockedCountries, blockedRegions, sendMessage, MESSAGE_TYPES) {
    let resizeHandler = null;
    
    if (resizeHandler) {
        window.removeEventListener('resize', resizeHandler);
    }
    
    resizeHandler = debounce(() => {
        if (!currentNav || settings.showSidebarBlockerLink === false) return;
        
        sidebarModifying = true;
        
        const existingLink = document.getElementById('x-country-blocker-link');
        if (existingLink) {
            existingLink.remove();
        }
        
        addBlockerLink(currentNav, blockedCountries, blockedRegions, sendMessage, MESSAGE_TYPES);
        if (debug) debug('Sidebar link refreshed after resize');
        
        setTimeout(() => {
            sidebarModifying = false;
        }, 50);
    }, TIMING.RESIZE_DEBOUNCE_MS);
    
    window.addEventListener('resize', resizeHandler);
    
    // Use keyed cleanup to prevent duplicate registrations
    registerCleanup('resizeHandler', () => {
        if (resizeHandler) {
            window.removeEventListener('resize', resizeHandler);
            resizeHandler = null;
        }
    });
}

/**
 * Remove sidebar blocker link
 */
export function removeSidebarLink(debug) {
    const link = document.getElementById('x-country-blocker-link');
    if (link) {
        link.remove();
        if (debug) debug('Sidebar blocker link removed');
    }
}

/**
 * Add blocker link to sidebar
 */
function addBlockerLink(nav, blockedCountries, blockedRegions, sendMessage, MESSAGE_TYPES) {
    if (document.getElementById('x-country-blocker-link')) return;

    const profileLink = nav.querySelector(SELECTORS.PROFILE_LINK);
    if (!profileLink) return;
    
    sidebarModifying = true;

    const link = profileLink.cloneNode(true);
    
    link.id = 'x-country-blocker-link';
    link.classList.add('x-blocker-nav-link');
    link.href = '#';
    link.removeAttribute('data-testid');
    link.setAttribute('aria-label', 'Block Countries & Regions');
    
    const svg = link.querySelector('svg');
    if (svg) {
        // Clear existing content safely
        while (svg.firstChild) {
            svg.removeChild(svg.firstChild);
        }
        // Build SVG content with safe DOM methods
        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', 'M12 2L4 5v6.09c0 5.05 3.41 9.76 8 10.91 4.59-1.15 8-5.86 8-10.91V5l-8-3zm6 9.09c0 4-2.55 7.7-6 8.83-3.45-1.13-6-4.82-6-8.83V6.31l6-2.12 6 2.12v4.78z');
        g.appendChild(path);
        svg.appendChild(g);
    }
    
    const textDiv = link.querySelector('[dir="ltr"]');
    if (textDiv) {
        const spans = textDiv.querySelectorAll('span');
        if (spans.length > 0) {
            spans[0].textContent = 'Block Locations';
        } else {
            textDiv.textContent = 'Block Locations';
        }
    } else {
        const allSpans = link.querySelectorAll('span');
        for (const span of allSpans) {
            if (span.textContent.trim() === 'Profile') {
                span.textContent = 'Block Locations';
                break;
            }
        }
    }

    link.onclick = e => {
        e.preventDefault();
        e.stopPropagation();
        showBlockerModal(blockedCountries, blockedRegions, sendMessage, MESSAGE_TYPES);
    };

    profileLink.parentElement.insertBefore(link, profileLink.nextSibling);
    
    setTimeout(() => {
        sidebarModifying = false;
    }, 50);
}

/**
 * Show the country/region blocker modal
 */
function showBlockerModal(blockedCountries, blockedRegions, sendMessage, MESSAGE_TYPES) {
    // Country action handler
    const onCountryAction = async (action, country) => {
        const response = await sendMessage({
            type: MESSAGE_TYPES.SET_BLOCKED_COUNTRIES,
            payload: { action, country }
        });
        
        if (response?.success) {
            // Update the reference (caller needs to handle this)
            blockedCountries.clear();
            for (const c of response.data) {
                blockedCountries.add(c);
            }
        }
        
        return response;
    };
    
    // Region action handler
    const onRegionAction = async (action, region) => {
        const response = await sendMessage({
            type: MESSAGE_TYPES.SET_BLOCKED_REGIONS,
            payload: { action, region }
        });
        
        if (response?.success) {
            // Update the reference (caller needs to handle this)
            blockedRegions.clear();
            for (const r of response.data) {
                blockedRegions.add(r);
            }
        }
        
        return response;
    };
    
    showModal(blockedCountries, blockedRegions, onCountryAction, onRegionAction);
}

// ============================================
// STYLES INJECTION
// ============================================

let stylesInjected = false;

/**
 * Inject CSS styles
 *
 * Note: content scripts can run at `document_start` and Firefox can briefly have
 * `document.head === null`. We fall back to `document.documentElement` to avoid
 * aborting initialization.
 */
export function injectStyles() {
    if (stylesInjected) return;

    const styleUrl = browserAPI.runtime.getURL('styles/content.css');
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = styleUrl;

    const mount = document.head || document.documentElement;
    if (mount) {
        mount.appendChild(link);
        stylesInjected = true;
    } else {
        console.error('X-Posed: Could not find mount point for styles');
    }
}

// ============================================
// CLEANUP
// ============================================

/**
 * Cleanup all UI resources
 */
export function cleanupUI() {
    // Iterate over all registered cleanup functions
    for (const [key, cleanupFn] of cleanupRegistry.entries()) {
        try {
            cleanupFn();
        } catch (error) {
            console.error(`X-Posed: UI cleanup error for ${key}:`, error);
        }
    }
    cleanupRegistry.clear();
    
    if (resizeTimeout) {
        clearTimeout(resizeTimeout);
        resizeTimeout = null;
    }
}