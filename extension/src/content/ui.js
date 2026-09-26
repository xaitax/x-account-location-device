/**
 * UI Module
 * Handles all visual/UI components: toasts, badges, theme, sidebar
 *
 * CHANGELOG v2.5.0:
 * - Theme detection throttle 200→500ms (less CPU during scroll)
 */

import { SELECTORS, CSS_CLASSES, TIMING } from '../shared/constants.js';
import { findInsertionPoint, getDeviceCountry, formatCountryName, debounce, throttle } from '../shared/utils.js';
import { deviceIcon, glyph, flagImage } from './icons.js';
import { showModal } from './modal.js';
import { captureEvidence } from './evidence-capture.js';
import { hovercard } from './hovercard.js';
import { createSnapshotTracker } from '../shared/state-sync.js';
import { showToast, cleanupNotifications } from './notifications.js';
import { FILTER_SOURCES } from '../shared/filter-registry.js';
import { createLifecycle } from '../shared/lifecycle.js';

export { showToast, dismissToast } from './notifications.js';

// ============================================
// STATE (module-local)
// ============================================

let themeObserver = null;
let sidebarObserver = null;
let currentNav = null;
let resizeHandler = null;
let sidebarModifying = false;
let sidebarCheckInterval = null;
let sidebarCheckTimeout = null;
let sidebarGetState = null;
let sidebarSettings = {};
const sidebarSnapshots = createSnapshotTracker();

// Cleanup functions registry - using Map with keys to prevent duplicates and memory leaks
const cleanupRegistry = new Map();
let uiLifecycle = createLifecycle();

function currentUILifecycle() {
    if (uiLifecycle.disposed) uiLifecycle = createLifecycle();
    return uiLifecycle;
}

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
    currentUILifecycle();

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
        throttledThemeDetection.cancel();
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
 * Show rate limit toast notification
 * @param {string} timeUntilReset - Human-readable time until reset
 */
export function showRateLimitToast(timeUntilReset) {
    showToast({
        title: 'Rate Limit Reached',
        message: 'X API limit hit. Resets in',
        // The shared notification renders this as text, so HTML entity encoding is unnecessary.
        timeBadge: typeof timeUntilReset === 'string' ? timeUntilReset.substring(0, 100) : '',
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
 * @param {string} [displayName] - This author's visible name, extracted before badge insertion.
 */
export function createBadge(element, screenName, info, isUserCell, settings, debug, csrfToken = null, effectiveCountry = null, displayName = '') {
    if (element.querySelector(`.${CSS_CLASSES.INFO_BADGE}`)) {
        return;
    }

    const badge = document.createElement('span');
    badge.className = CSS_CLASSES.INFO_BADGE;
    const detailsButton = document.createElement('button');
    detailsButton.type = 'button';
    detailsButton.className = 'x-badge-details';
    detailsButton.setAttribute('aria-label', `Account details for @${sanitizeText(screenName)}`);
    detailsButton.setAttribute('aria-haspopup', 'dialog');
    detailsButton.setAttribute('aria-expanded', 'false');
    badge.appendChild(detailsButton);

    let hasContent = false;
    let vpnSpan = null;

    // Build the location signal; its warning is appended after the device below.
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
            detailsButton.appendChild(flagSpan);
            hasContent = true;

            // VPN indicator — uses ground-truth locationAccurate regardless of flag source
            if (info.locationAccurate === false && settings.showVpnIndicator !== false) {
                vpnSpan = document.createElement('span');
                vpnSpan.className = 'x-vpn';
                vpnSpan.title = 'X reports that this account’s location may not be accurate.';
                vpnSpan.appendChild(glyph('vpn', 13));
            }
        }
    }

    // Add device — clear platform icon (Apple / Android / Web / Unknown)
    if (info.device && settings.showDevices !== false) {
        const deviceSpan = document.createElement('span');
        deviceSpan.className = 'x-device';
        deviceSpan.title = 'Connected via: ' + sanitizeText(info.device);
        deviceSpan.appendChild(deviceIcon(info.device, 15));
        detailsButton.appendChild(deviceSpan);
        hasContent = true;
    }

    // Match the hovercard's order: location, device, then location warning.
    if (vpnSpan) detailsButton.appendChild(vpnSpan);

    if (!hasContent) return;

    // "More info" affordance: a static circled-i. (The hovercard shows full details on
    // hover; we intentionally do NOT expand any text here so the badge width stays fixed
    // and the capture button never shifts out from under the cursor.)
    //
    // Issue #38: optional, because on narrow/mobile layouts every pixel of the badge is
    // taken from the name and handle, which X then truncates (and can overlap). Purely an
    // affordance — the whole badge is the hover/click target, so hiding it removes no
    // functionality, only the hint that the dossier exists.
    const showInfoIcon = settings.showInfoIcon !== false;
    const hint = showInfoIcon ? document.createElement('span') : null;
    if (hint) {
        hint.className = 'x-hover-hint';
        hint.setAttribute('aria-hidden', 'true');
        hint.appendChild(glyph('info', 14));
    }

    // Share button — added before the circled-i so the (i) stays the last item.
    // Skipped on UserCell badges (follower/following lists, People search): the
    // capture flow needs an enclosing tweet article, which those rows don't have,
    // so the button would render but silently do nothing on click.
    if (settings.showCaptureButton !== false && !isUserCell) {
        badge.appendChild(makeSep());
        const captureBtn = document.createElement('button');
        captureBtn.type = 'button';
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
                // Dismiss account details before the share sheet takes focus.
                // Its Escape handler must not compete with the card behind it.
                hovercard.hide();
                captureEvidence(tweet, info, screenName, element);
            } else {
                console.warn('X-Posed: Could not find tweet to capture');
            }
        });
    }

    // Circled-i is always the last item in the badge (when shown).
    if (hint && (settings.showCaptureButton === false || isUserCell)) badge.appendChild(makeSep());
    if (hint) badge.appendChild(hint);

    let insertionPoint = isUserCell
        ? findUserCellInsertionPoint(element, screenName)
        : findInsertionPoint(element, screenName);

    // Keep our native controls outside X's profile links. Some UserCell layouts
    // return a handle span inside an anchor as their insertion point.
    const enclosingLink = insertionPoint?.target.closest('a[href]');
    if (enclosingLink && element.contains(enclosingLink) && enclosingLink.parentElement) {
        insertionPoint = { target: enclosingLink.parentElement, ref: enclosingLink.nextSibling };
    }
        
    if (insertionPoint) {
        insertionPoint.target.insertBefore(badge, insertionPoint.ref);
        if (debug) debug(`Badge inserted for @${screenName}${isUserCell ? ' (UserCell)' : ''}`);
    } else {
        if (debug) debug(`No insertion point found for @${screenName}${isUserCell ? ' (UserCell)' : ''}`);
    }

    // Attach hovercard; we fetch rich metadata only when it actually opens.
    hovercard.attach(badge, {
        screenName,
        displayName,
        info,
        csrfToken,
        clickToOpen: settings.hovercardTrigger === 'click'
    });
}

// ============================================
// SIDEBAR LINK
// ============================================

/**
 * Inject sidebar link for country blocker
 */
export function injectSidebarLink(settings, debug, blockedCountries, blockedRegions, sendMessage, MESSAGE_TYPES, getState = null) {
    currentUILifecycle();
    sidebarGetState = getState;
    sidebarSettings = { ...settings };
    if (settings.showSidebarBlockerLink === false) {
        removeSidebarLink(debug);
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
        
        if (!ourLink && profileLink && sidebarSettings.showSidebarBlockerLink !== false) {
            if (debug) debug('Sidebar link removed, re-injecting...');
            
            sidebarObserver.disconnect();
            addBlockerLink(nav, blockedCountries, blockedRegions, sendMessage, MESSAGE_TYPES);
            
            uiLifecycle.delay(() => {
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
        resizeHandler.cancel();
    }

    resizeHandler = debounce(() => {
        if (!currentNav || sidebarSettings.showSidebarBlockerLink === false) return;
        
        sidebarModifying = true;
        
        const existingLink = document.getElementById('x-country-blocker-link');
        if (existingLink) {
            existingLink.remove();
        }
        
        addBlockerLink(currentNav, blockedCountries, blockedRegions, sendMessage, MESSAGE_TYPES);
        if (debug) debug('Sidebar link refreshed after resize');
        
        uiLifecycle.delay(() => {
            sidebarModifying = false;
        }, 50);
    }, TIMING.RESIZE_DEBOUNCE_MS);
    
    window.addEventListener('resize', resizeHandler);
    
    // Use keyed cleanup to prevent duplicate registrations
    registerCleanup('resizeHandler', () => {
        if (resizeHandler) {
            window.removeEventListener('resize', resizeHandler);
            resizeHandler.cancel();
            resizeHandler = null;
        }
    });
}

/**
 * Remove sidebar blocker link
 */
export function removeSidebarLink(debug) {
    // A settings change can arrive before the initial navigation lookup runs.
    // Cancel it as well as removing any already-mounted link.
    if (sidebarCheckInterval) {
        clearInterval(sidebarCheckInterval);
        sidebarCheckInterval = null;
    }
    if (sidebarCheckTimeout) {
        clearTimeout(sidebarCheckTimeout);
        sidebarCheckTimeout = null;
    }
    const link = document.getElementById('x-country-blocker-link');
    if (link) {
        link.remove();
        if (debug) debug('Sidebar blocker link removed');
    }
}

export function syncSidebarSettings(settings, revision) {
    if (!sidebarSnapshots.accept('settings', revision)) return;
    sidebarSettings = { ...settings };
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
    link.removeAttribute('aria-current');
    link.removeAttribute('aria-labelledby');
    link.setAttribute('aria-label', 'Open blocking settings');
    
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
    
    uiLifecycle.delay(() => {
        sidebarModifying = false;
    }, 50);
}

/**
 * Show the country/region blocker modal
 */
async function showBlockerModal(blockedCountries, blockedRegions, sendMessage, MESSAGE_TYPES) {
    // Read every list at the moment of opening, rather than keeping the Sets captured
    // when X's sidebar was first injected. The getter is internal, not a page-global API.
    const state = sidebarGetState?.() || {};
    const makeSetHandler = (type, key) => (action, value) => sendMessage({
        type, payload: { action, [key]: value }
    });
    showModal({
        ...Object.fromEntries(FILTER_SOURCES.map(source => [source.field,
            new Set(state[source.field] || ({ blockedCountries, blockedRegions })[source.field] || [])])),
        settings: state.settings || sidebarSettings,
        stateRevisions: state.stateRevisions || {},
        ...Object.fromEntries(FILTER_SOURCES.map(source => [source.callback,
            makeSetHandler(source.set, source.valueKey)])),
        onSettingsChange: payload => sendMessage({ type: MESSAGE_TYPES.SET_SETTINGS, payload }),
        onOpenSettings: () => sendMessage({ type: MESSAGE_TYPES.OPEN_OPTIONS_PAGE })
    });
}

// ============================================
// CLEANUP
// ============================================

/**
 * Cleanup all UI resources
 */
export function cleanupUI() {
    uiLifecycle.dispose();
    cleanupNotifications();
    // Iterate over all registered cleanup functions
    for (const [key, cleanupFn] of cleanupRegistry.entries()) {
        try {
            cleanupFn();
        } catch (error) {
            console.error(`X-Posed: UI cleanup error for ${key}:`, error);
        }
    }
    cleanupRegistry.clear();
    removeSidebarLink();
    currentNav = null;
    sidebarModifying = false;
    sidebarGetState = null;
}
