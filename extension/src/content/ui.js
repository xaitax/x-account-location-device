/**
 * UI Module
 * Handles all visual/UI components: toasts, badges, theme, sidebar
 *
 * CHANGELOG v2.5.0:
 * - Theme detection throttle 200→500ms (less CPU during scroll)
 */

import browserAPI from '../shared/browser-api.js';
import { SELECTORS, CSS_CLASSES, TIMING } from '../shared/constants.js';
import { findInsertionPoint, getDeviceCountry, formatCountryName, debounce, throttle } from '../shared/utils.js';
import { deviceIcon, glyph, flagImage } from './icons.js';
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
let resizeHandler = null;
let sidebarModifying = false;
let sidebarCheckInterval = null;
let sidebarCheckTimeout = null;

// Cleanup functions registry - using Map with keys to prevent duplicates and memory leaks
const cleanupRegistry = new Map();

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

    // Issue #18: content scripts run at document_start, so on Edge/macOS (and
    // Firefox) <html>/<body> can still be null here. getComputedStyle(null) throws
    // a TypeError that the init try/catch swallows, silently disabling the whole
    // extension. Bail to the default theme until the DOM exists; startThemeObserver
    // re-runs detection once X mutates <html>/<body> during hydration.
    if (!document.documentElement || !document.body) return 'dark';

    // Check CSS variable first
    const bgColor = window.getComputedStyle(document.documentElement).getPropertyValue('--background-color').trim();
    
    if (bgColor) {
        if (bgColor.includes('255, 255, 255') || bgColor === '#ffffff' || bgColor === 'white') {
            return 'light';
        }
        if (bgColor.includes('21, 32, 43') || bgColor === '#15202b') {
            return 'dark'; // X removed the "dim" theme; treat any dim-era background as dark
        }
        if (bgColor.includes('0, 0, 0') || bgColor === '#000000' || bgColor === 'black') {
            return 'dark';
        }
    }
    
    // Fallback: check body background
    const bodyBg = window.getComputedStyle(document.body).backgroundColor;
    
    if (bodyBg) {
        if (bodyBg.includes('255, 255, 255')) return 'light';
        if (bodyBg.includes('21, 32, 43')) return 'dark'; // X removed the "dim" theme; treat any dim-era background as dark
        if (bodyBg.includes('0, 0, 0')) return 'dark';
    }
    
    // Check HTML background as last resort
    const htmlBg = window.getComputedStyle(document.documentElement).backgroundColor;
    if (htmlBg) {
        if (htmlBg.includes('255, 255, 255')) return 'light';
        if (htmlBg.includes('21, 32, 43')) return 'dark'; // X removed the "dim" theme; treat any dim-era background as dark
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

    // Throttle theme detection to run at most once every 500ms
    // Theme changes are rare and don't need immediate detection
    const throttledThemeDetection = throttle(() => {
        detectAndApplyTheme();
    }, 500);
    
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
 * Build the toast close button with safe DOM methods.
 * @param {HTMLElement} toast - The toast element to dismiss on click
 * @returns {HTMLButtonElement}
 */
function makeToastCloseButton(toast) {
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
    return closeBtn;
}

/**
 * Show a toast notification
 * @param {Object} options - Toast options
 * @param {string} options.title - Toast title
 * @param {string} options.message - Toast message (rendered as text)
 * @param {string} [options.timeBadge] - Optional styled time badge appended after
 *   the message (XSS-safe; rendered via textContent)
 * @param {SVGElement|string} [options.icon] - Drawn glyph element (preferred) or
 *   a plain string. Defaults to the hourglass glyph.
 * @param {string} options.iconType - Icon type for styling ('warning', 'error', 'success', 'info')
 * @param {number} options.duration - Auto-dismiss duration in ms (default 8000, 0 = no auto-dismiss)
 */
export function showToast({ title, message, timeBadge, icon, iconType = 'warning', duration = 8000 }) {
    const container = getToastContainer();

    const toast = document.createElement('div');
    toast.className = 'x-toast';

    // Icon — accepts a drawn SVG glyph (preferred) or a plain string
    const iconEl = document.createElement('div');
    iconEl.className = `x-toast-icon x-toast-icon-${iconType}`;
    const iconNode = (icon === undefined || icon === null) ? glyph('hourglass', 20) : icon;
    if (iconNode instanceof Node) iconEl.appendChild(iconNode);
    else iconEl.textContent = String(iconNode);
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
    if (timeBadge) {
        // Message text followed by a styled time badge (both XSS-safe)
        messageEl.appendChild(document.createTextNode(message + ' '));
        const timeBadgeEl = document.createElement('span');
        timeBadgeEl.className = 'x-toast-time';
        timeBadgeEl.textContent = timeBadge;
        messageEl.appendChild(timeBadgeEl);
    } else {
        // Use textContent for safety
        messageEl.textContent = message;
    }
    contentEl.appendChild(messageEl);

    toast.appendChild(contentEl);

    // Close button (built with safe DOM methods)
    toast.appendChild(makeToastCloseButton(toast));

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

    showToast({
        title: 'Rate Limit Reached',
        message: 'X API limit hit. Resets in',
        timeBadge: sanitizedTime,
        icon: glyph('warn', 20),
        iconType: 'warning',
        duration: 8000
    });
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
 * Hairline separator span used between badge items.
 */
function makeSep() {
    const sep = document.createElement('span');
    sep.className = 'x-sep';
    return sep;
}

/**
 * Create info badge for a user
 * @param {string|null} [effectiveCountry] - Flag/blocking country already computed
 *   by the observer (effectiveCountry()). Avoids recomputing getDeviceCountry here.
 */
export function createBadge(element, screenName, info, isUserCell, settings, debug, csrfToken = null, effectiveCountry = null) {
    if (element.querySelector(`.${CSS_CLASSES.INFO_BADGE}`)) {
        return;
    }

    const badge = document.createElement('span');
    badge.className = CSS_CLASSES.INFO_BADGE;

    let hasContent = false;

    // Add flag (plus the accompanying VPN lock).
    // Issue #17: optionally show the flag of the DEVICE's country instead of the
    // account location. Web/unknown device sources have no country, so we fall back
    // to the account location. The whole block stays gated on having a flag country,
    // so with the option OFF (default) and no location, behavior is unchanged — no
    // stray VPN lock appears for location-less users.
    if (settings.showFlags !== false) {
        // The observer already computed the effective (device-or-location) country;
        // reuse it instead of recomputing getDeviceCountry. Fall back to the same
        // computation only when it wasn't supplied (defensive).
        const deviceCountry = settings.flagFromDevice ? getDeviceCountry(info.device) : null;
        const flagCountry = effectiveCountry || deviceCountry || info.location;
        if (flagCountry) {
            const flagLabel = deviceCountry ? formatCountryName(deviceCountry) : (info.location || formatCountryName(flagCountry));
            const flagImg = flagImage(flagCountry);
            const flagSpan = document.createElement('span');
            flagSpan.className = 'x-flag';
            flagSpan.title = sanitizeText(flagLabel);

            if (flagImg) {
                flagSpan.appendChild(flagImg);
            } else {
                flagSpan.textContent = '🌍'; // Unknown country fallback (matches prior behavior)
            }
            badge.appendChild(flagSpan);
            hasContent = true;

            // VPN indicator — uses ground-truth locationAccurate regardless of flag source
            if (info.locationAccurate === false && settings.showVpnIndicator !== false) {
                badge.appendChild(makeSep());
                const vpnSpan = document.createElement('span');
                vpnSpan.className = 'x-vpn';
                vpnSpan.title = 'Location may not be accurate (VPN/Proxy detected)';
                vpnSpan.appendChild(glyph('vpn', 13));
                badge.appendChild(vpnSpan);
            }
        }
    }

    // Add device — clear platform icon (Apple / Android / Web / Unknown)
    if (info.device && settings.showDevices !== false) {
        if (hasContent) badge.appendChild(makeSep());
        const deviceSpan = document.createElement('span');
        deviceSpan.className = 'x-device';
        deviceSpan.title = 'Connected via: ' + sanitizeText(info.device);
        deviceSpan.appendChild(deviceIcon(info.device, 15));
        badge.appendChild(deviceSpan);
        hasContent = true;
    }

    if (!hasContent) return;

    // "More info" affordance: a static circled-i. (The hovercard shows full details on
    // hover; we intentionally do NOT expand any text here so the badge width stays fixed
    // and the capture button never shifts out from under the cursor.)
    const hint = document.createElement('span');
    hint.className = 'x-hover-hint';
    hint.appendChild(glyph('info', 14));

    // Share button — added before the circled-i so the (i) stays the last item.
    if (settings.showCaptureButton !== false) {
        const captureBtn = document.createElement('button');
        captureBtn.className = 'x-capture-btn';
        captureBtn.title = 'Share evidence';
        captureBtn.setAttribute('aria-label', 'Share evidence');

        captureBtn.appendChild(glyph('share', 14));
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
    }

    // Circled-i is always the last item in the badge.
    badge.appendChild(hint);

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
    // resizeHandler is module-scoped, so a re-run (e.g. after a settings change)
    // removes the previous listener instead of leaking it.
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
        // Transplant the shield glyph's paths into the cloned <svg> wrapper so we
        // keep X's existing sizing/classes on the wrapper (24-unit viewBox) while
        // reusing the shared icon set instead of a hand-built path.
        const shield = glyph('shield', 24);
        while (shield.firstChild) {
            svg.appendChild(shield.firstChild);
        }
        // The shield is an outline glyph, but this <svg> is cloned from X's fill-style
        // nav icon and X's own CSS sets the fill (which beats SVG presentation
        // attributes). The `.x-blocker-nav-link svg` rule in content.css forces stroke
        // mode with !important so it renders as an outline, not a filled blob.
    }
    
    const textDiv = link.querySelector('[dir="ltr"]');
    if (textDiv) {
        const spans = textDiv.querySelectorAll('span');
        if (spans.length > 0) {
            spans[0].textContent = 'Blocking';
        } else {
            textDiv.textContent = 'Blocking';
        }
    } else {
        const allSpans = link.querySelectorAll('span');
        for (const span of allSpans) {
            if (span.textContent.trim() === 'Profile') {
                span.textContent = 'Blocking';
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
    
    // Get blockedTags from the global state (window.__X_POSED_CONTENT__)
    const state = window.__X_POSED_CONTENT__?.getState?.() || {};
    const blockedTags = new Set(state.blockedTags || []);
    
    // Tag action handler
    const onTagAction = async (action, tag) => {
        const response = await sendMessage({
            type: MESSAGE_TYPES.SET_BLOCKED_TAGS,
            payload: { action, tag }
        });
        
        if (response?.success) {
            blockedTags.clear();
            for (const t of response.data) {
                blockedTags.add(t);
            }
        }
        
        return response;
    };
    
    showModal(blockedCountries, blockedRegions, onCountryAction, onRegionAction, blockedTags, onTagAction);
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
}
