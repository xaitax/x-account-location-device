/**
 * Content Script (ISOLATED World)
 * Main entry point - handles initialization, state management, and message coordination
 * Orchestrates UI and Observer modules
 */

import browserAPI from '../shared/browser-api.js';
import { MESSAGE_TYPES, CSS_CLASSES, VERSION, affiliationWasChecked } from '../shared/constants.js';

// Import modules
import {
    injectStyles,
    detectAndApplyTheme,
    startThemeObserver,
    injectSidebarLink,
    removeSidebarLink,
    cleanupUI,
    showToast
} from './ui.js';

import {
    startObserver,
    scanPage,
    processElementsBatch,
    processElement,
    createProcessElementSafe,
    updateBlockedTweets,
    setupQuoteReveal,
    cleanupObservers,
    userInfoCache
} from './observer.js';

import { hovercard } from './hovercard.js';
import { glyph } from './icons.js';
import { setProfile, clearProfiles, profileCount } from './profile-cache.js';

// ============================================
// STATE
// ============================================

let isEnabled = true;
let blockedCountries = new Set();
let blockedRegions = new Set();
let blockedTags = new Set();
let blockedBioTags = new Set();
let blockedPcf = new Set();
let blockedLanguages = new Set();
let allowedUsers = new Set();
let blockedAffiliations = new Set();
let settings = {};
let csrfToken = null;
let debugMode = false;

// Cleanup tracking
let cleanupFunctions = [];
let isCleanedUp = false;

// Memoized functions (created once, reused)
let memoizedProcessElementWithContext = null;
let memoizedProcessElementSafe = null;
let memoizedIsEnabledFn = null;
let memoizedScanPageFn = null;

// ============================================
// DEBUG LOGGER
// ============================================

/**
 * Debug logger - only logs when debugMode is enabled
 */
function debug(...args) {
    if (debugMode) {
        console.log('🔍 X-Posed:', ...args);
    }
}

function fetchUserInfoViaPage(screenName) {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    return new Promise(resolve => {
        const timeout = setTimeout(() => {
            window.removeEventListener('x-posed-fetch-user-info-result', onResult);
            resolve({ success: false, error: 'Timed out waiting for page fetch' });
        }, 10000);

        function onResult(event) {
            let result;
            try {
                result = JSON.parse(event.detail || '{}');
            } catch {
                return;
            }

            if (result.id !== id) return;
            clearTimeout(timeout);
            window.removeEventListener('x-posed-fetch-user-info-result', onResult);
            resolve(result);
        }

        window.addEventListener('x-posed-fetch-user-info-result', onResult);
        window.dispatchEvent(new CustomEvent('x-posed-fetch-user-info', {
            detail: JSON.stringify({ id, screenName })
        }));
    });
}

// ============================================
// MESSAGING
// ============================================

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
 * Fallback injection of the MAIN-world page script.
 *
 * The manifest registers page-script.js as a `world: "MAIN"` content script at
 * document_start, which is what normally installs it: the browser guarantees that runs
 * before any of X's own scripts. This appends it a second way, and matters because a
 * <script src> load is asynchronous — X's bundle keeps running while it fetches, so a
 * request issued in that window is missed. That is invisible on the timeline, where
 * HomeTimeline fires again on every scroll, but a profile issues UserByScreenName exactly
 * once, so losing that race means no bio, account type or counts for that profile at all.
 *
 * page-script.js short-circuits on window.__X_POSED_INJECTED__, so whichever path lands
 * first wins and the other is a no-op.
 */
function injectPageScript() {
    const scriptUrl = browserAPI.runtime.getURL('page-script.js');
    
    const script = document.createElement('script');
    script.src = scriptUrl;
    script.onload = function() {
        this.remove();
    };
    
    (document.head || document.documentElement).appendChild(script);
}

/**
 * Listen for events from page script
 */
function setupPageScriptListener() {
    window.addEventListener('x-posed-headers-captured', async event => {
        let headers;
        try {
            ({ headers } = JSON.parse(event.detail || '{}'));
        } catch {
            return;
        }

        if (!headers) return;
        debug('Headers captured from page script');
        
        const response = await sendMessage({
            type: MESSAGE_TYPES.CAPTURE_HEADERS,
            payload: { headers }
        });

        if (response?.success && memoizedScanPageFn) {
            setTimeout(() => memoizedScanPageFn(), 250);
        }
    });
}

/**
 * Drop cached user info that was never checked for an affiliation, then re-process the
 * page so those rows are resolved again.
 *
 * Entries whose meta carries an `affiliateUsername` key were produced by a parser that
 * actually inspected the affiliation, so "no affiliate" on them is a real answer and they
 * are kept (same contract as wantsRicherRecord in the service worker). Everything
 * else is genuinely unknown and has to be refetched, otherwise adding an affiliation
 * appears to do nothing until the cache expires.
 */
function reprocessRowsMissingAffiliation() {
    let dropped = 0;
    for (const [screenName, info] of userInfoCache.entries()) {
        if (info && !affiliationWasChecked(info.meta)) {
            userInfoCache.delete(screenName);
            dropped++;
        }
    }
    debug(`Affiliation filter changed: dropped ${dropped} cache entries with no affiliation data`);

    // Same teardown the settings-change path uses: a hidden row has no layout box, so the
    // IntersectionObserver would never report it visible and it could never re-process.
    // Un-hide and un-mark everything first, then let the rescan re-derive each row.
    document.querySelectorAll(`.${CSS_CLASSES.INFO_BADGE}`).forEach(el => el.remove());
    document.querySelectorAll('[data-x-processed]').forEach(el => {
        delete el.dataset.xProcessed;
        delete el.dataset.xScreenName;
    });
    document.querySelectorAll('.x-tweet-blocked, .x-tweet-vpn-blocked, .x-tweet-highlighted')
        .forEach(el => el.classList.remove('x-tweet-blocked', 'x-tweet-vpn-blocked', 'x-tweet-highlighted'));
    document.querySelectorAll('[data-x-block]').forEach(el => { delete el.dataset.xBlock; });
    document.querySelectorAll('[data-x-quote-block]').forEach(el => { delete el.dataset.xQuoteBlock; });

    if (memoizedScanPageFn) memoizedScanPageFn();
}

/**
 * Snapshot of every filter, passed as one object so a new filter can't be mis-ordered
 * into the wrong parameter slot.
 */
function currentFilters() {
    return {
        blockedCountries,
        blockedRegions,
        blockedTags,
        blockedBioTags,
        blockedPcf,
        blockedLanguages,
        blockedAffiliations,
        allowedUsers,
        settings
    };
}

/**
 * Tell the page script whether to read profile data out of X's own responses.
 * Sent on page-script ready and whenever the setting changes, so the kill switch takes
 * effect immediately rather than at the next reload.
 */
function syncEnrichmentSetting() {
    window.dispatchEvent(new CustomEvent('x-posed-set-enrichment', {
        detail: JSON.stringify({ enabled: settings.profileEnrichment !== false })
    }));
}

/**
 * Receive the profile data the page script harvested from X's timeline responses.
 *
 * This costs no API call — X already sent it. Everything lands in a bounded, session-only
 * cache (see profile-cache.js for the memory contract); nothing here is persisted or
 * contributed to the community cache, because bios are personal free text and follower
 * counts are stale within minutes.
 */
function setupProfileListener() {
    const onReady = () => syncEnrichmentSetting();

    const onProfiles = event => {
        let users;
        try {
            ({ users } = JSON.parse(event.detail || '{}'));
        } catch {
            return;
        }
        if (!Array.isArray(users) || users.length === 0) return;

        for (const entry of users) {
            setProfile(entry.u, {
                bio: entry.b,
                pcf: entry.p,
                followers: entry.f,
                following: entry.g,
                tweets: entry.t,
                media: entry.m
            });
        }
        debug(`Harvested ${users.length} profile(s) from X's own response`);

        // Newly known bios/labels can change a row's verdict, so re-derive what's on screen.
        // Coalesced by updateBlockedTweets, so a burst of scroll responses costs one pass.
        if (blockedBioTags.size > 0 || blockedPcf.size > 0) {
            updateBlockedTweets(currentFilters());
        }
    };

    window.addEventListener('x-posed-page-ready', onReady);
    window.addEventListener('x-posed-profiles', onProfiles);

    cleanupFunctions.push(() => {
        window.removeEventListener('x-posed-page-ready', onReady);
        window.removeEventListener('x-posed-profiles', onProfiles);
        clearProfiles();
    });
}

/**
 * Listen for messages from background script
 */
function setupBackgroundListener() {
    const messageHandler = (message, sender, sendResponse) => {
        const { type, payload } = message;

        // Use proper async handling with error boundary
        handleBackgroundMessage(type, payload)
            .then(result => {
                sendResponse(result);
            })
            .catch(error => {
                console.error('X-Posed: Message handler error:', error);
                sendResponse({ success: false, error: error.message });
            });

        return true; // Indicates async response
    };

    browserAPI.runtime.onMessage.addListener(messageHandler);

    cleanupFunctions.push(() => {
        browserAPI.runtime.onMessage.removeListener(messageHandler);
    });
}

/**
 * Issue #23: a badge can render from a stale cloud-cache snapshot while the hovercard's
 * (authoritative) live fetch returns fresher location/device — so the flag by the name
 * disagrees with the popup until the row happens to re-process. The hovercard dispatches
 * this event when it sees a difference; we refresh the warm local cache and re-render the
 * affected badges so the two stay in sync.
 */
function setupAuthoritativeInfoListener() {
    const onAuthoritativeInfo = event => {
        const { screenName, info } = event.detail || {};
        if (!screenName || !info) return;

        // Adopt the authoritative data so future (re)processing uses it, then rebuild the
        // badges that are showing this user. Clearing the processed markers + re-running
        // processElement rebuilds the badge from the now-fresh cache (no new API call).
        userInfoCache.set(screenName, info);

        // Defer the DOM rebuild one microtask: this event is dispatched synchronously from
        // the hovercard mid-update, so removing the anchored badge now would yank the
        // hovercard's reposition target out from under it. Letting the hovercard finish
        // first keeps the open card from jumping.
        queueMicrotask(() => {
            const key = screenName.toLowerCase();
            document.querySelectorAll('[data-x-screen-name]').forEach(el => {
                if ((el.dataset.xScreenName || '').toLowerCase() !== key) return;
                const badge = el.querySelector(`.${CSS_CLASSES.INFO_BADGE}`);
                if (badge) badge.remove();
                delete el.dataset.xProcessed;
                delete el.dataset.xScreenName;
                if (memoizedProcessElementSafe) memoizedProcessElementSafe(el);
            });
        });
    };

    document.addEventListener('xposed:authoritative-info', onAuthoritativeInfo);
    cleanupFunctions.push(() => {
        document.removeEventListener('xposed:authoritative-info', onAuthoritativeInfo);
    });
}

/**
 * Handle background messages with proper async/await and error handling
 * @param {string} type - Message type
 * @param {any} payload - Message payload
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function handleBackgroundMessage(type, payload) {
    switch (type) {
        case MESSAGE_TYPES.SETTINGS_UPDATED: {
            const prevSettings = { ...settings };
            settings = payload;
            isEnabled = settings.enabled !== false;
            debugMode = settings.debugMode === true;
            debug('Settings updated:', settings);
            
            if (!isEnabled) {
                document.querySelectorAll(`.${CSS_CLASSES.INFO_BADGE}`).forEach(el => el.remove());
            } else {
                // Apply display/blocking toggles live to already-processed tweets, not
                // only to newly-loaded ones. Clearing the processed markers + re-scanning
                // re-derives badges AND block/highlight/VPN state from the warm local cache
                // (so no new API calls). showVpnUsers and highlightBlockedTweets are in
                // here because flipping them must recover rows hidden under the old value —
                // otherwise a re-enabled "Show VPN/Proxy Users" never un-hides what it hid.
                // showInfoIcon and hovercardTrigger are in here because both are baked into
                // the badge at creation time (the circled-i is a child node; the trigger is
                // the listener bound in hovercard.attach), so they only take effect once the
                // badge is rebuilt.
                const reapplyKeys = ['showFlags', 'flagFromDevice', 'showDevices', 'showVpnIndicator',
                    'showCaptureButton', 'showVpnUsers', 'highlightBlockedTweets',
                    'showInfoIcon', 'hovercardTrigger'];
                if (reapplyKeys.some(k => prevSettings[k] !== settings[k])) {
                    document.querySelectorAll(`.${CSS_CLASSES.INFO_BADGE}`).forEach(el => el.remove());
                    document.querySelectorAll('[data-x-processed]').forEach(el => {
                        delete el.dataset.xProcessed;
                        delete el.dataset.xScreenName;
                    });
                    // Drop our block/highlight markers before the rescan. A display:none row
                    // has no layout box, so the IntersectionObserver never reports it visible
                    // and it would never re-process — un-hiding first lets the rescan re-derive
                    // each row's state from scratch (and re-hide it if it's still blocked).
                    document.querySelectorAll('.x-tweet-blocked, .x-tweet-vpn-blocked, .x-tweet-highlighted')
                        .forEach(el => el.classList.remove('x-tweet-blocked', 'x-tweet-vpn-blocked', 'x-tweet-highlighted'));
                    document.querySelectorAll('[data-x-block]').forEach(el => { delete el.dataset.xBlock; });
                    // Same reasoning for the language marker: a lang-hidden article is
                    // display:none, so it must be un-hidden here or the rescan can't re-derive
                    // it (e.g. when highlightBlockedTweets flips hide↔highlight).
                    document.querySelectorAll('[data-x-lang-block]').forEach(el => { delete el.dataset.xLangBlock; });
                    if (memoizedScanPageFn) memoizedScanPageFn();
                }
            }
            
            if (prevSettings.profileEnrichment !== settings.profileEnrichment) {
                syncEnrichmentSetting();
            }

            if (prevSettings.showSidebarBlockerLink !== settings.showSidebarBlockerLink) {
                if (settings.showSidebarBlockerLink === false) {
                    removeSidebarLink(debug);
                } else {
                    injectSidebarLink(settings, debug, blockedCountries, blockedRegions, sendMessage, MESSAGE_TYPES);
                }
            }
            return { success: true };
        }

        case MESSAGE_TYPES.BLOCKED_COUNTRIES_UPDATED:
            blockedCountries = new Set(payload);
            updateBlockedTweets(currentFilters());
            return { success: true };

        case MESSAGE_TYPES.BLOCKED_REGIONS_UPDATED:
            blockedRegions = new Set(payload);
            updateBlockedTweets(currentFilters());
            return { success: true };

        case MESSAGE_TYPES.BLOCKED_TAGS_UPDATED:
            blockedTags = new Set(payload);
            updateBlockedTweets(currentFilters());
            return { success: true };

        case MESSAGE_TYPES.BLOCKED_BIO_TAGS_UPDATED:
            blockedBioTags = new Set(payload);
            updateBlockedTweets(currentFilters());
            return { success: true };

        case MESSAGE_TYPES.BLOCKED_PCF_UPDATED:
            blockedPcf = new Set(payload);
            updateBlockedTweets(currentFilters());
            return { success: true };

        case MESSAGE_TYPES.BLOCKED_LANGUAGES_UPDATED:
            blockedLanguages = new Set(payload);
            updateBlockedTweets(currentFilters());
            return { success: true };

        case MESSAGE_TYPES.BLOCKED_AFFILIATIONS_UPDATED:
            blockedAffiliations = new Set(payload);
            if (blockedAffiliations.size > 0) {
                // Rows already on screen were resolved before this filter existed, and a
                // community-cache hit carries no affiliation at all. Re-deriving from that
                // cache would silently conclude "not affiliated" and block nothing, so
                // drop the unchecked entries and re-process instead. The background then
                // re-checks the CLOUD for a richer record (see wantsRicherRecord); it
                // never spends an X API call, so this can't trip the rate limit.
                reprocessRowsMissingAffiliation();
            } else {
                updateBlockedTweets(currentFilters());
            }
            return { success: true };

        case MESSAGE_TYPES.ALLOWED_USERS_UPDATED:
            allowedUsers = new Set(payload);
            updateBlockedTweets(currentFilters());
            return { success: true };

        default:
            return { success: false, error: 'Unknown message type' };
    }
}

// ============================================
// INITIALIZATION
// ============================================

/**
 * After a "Share evidence" action opens X's composer in a new tab, this tab's
 * content script reminds the user that their evidence image is on the clipboard.
 * The flag (a timestamp) is written by evidence-capture just before window.open;
 * the post-share toast would otherwise fire on the now-background origin tab.
 */
async function maybeShowPasteHint() {
    try {
        const res = await browserAPI.storage.local.get('xpPasteHint');
        const t = res?.xpPasteHint;
        if (!t || Date.now() - t > 15000) return;
        await browserAPI.storage.local.remove('xpPasteHint');
        setTimeout(() => {
            showToast({
                title: 'Evidence is on your clipboard',
                message: 'Press Ctrl / ⌘ + V to attach it to your post, then post.',
                icon: glyph('copy', 20),
                iconType: 'info',
                duration: 12000
            });
        }, 1200);
    } catch (_) { /* hint is best-effort */ }
}

/**
 * Initialize the content script
 */
async function initialize() {
    console.log(`🚀 X-Posed v${VERSION} initializing...`);
    
    try {
        // Set up listeners BEFORE injecting page script
        setupPageScriptListener();
        setupProfileListener();
        setupBackgroundListener();
        setupAuthoritativeInfoListener();
        // "Click to show" on a collapsed quote card (issue #32). Must be bound in the
        // capture phase before X's own handlers, so bind it here at document_start.
        setupQuoteReveal();

        // Extract CSRF token
        csrfToken = getCsrfToken();
        
        // Inject page script for header interception
        injectPageScript();

        // Load initial settings, blocked countries/regions/tags/languages, and allowlisted accounts
        const [settingsResponse, blockedResponse, blockedRegionsResponse, blockedTagsResponse, blockedBioTagsResponse, blockedPcfResponse, blockedLanguagesResponse, allowedUsersResponse, blockedAffiliationsResponse] = await Promise.all([
            sendMessage({ type: MESSAGE_TYPES.GET_SETTINGS }),
            sendMessage({ type: MESSAGE_TYPES.GET_BLOCKED_COUNTRIES }),
            sendMessage({ type: MESSAGE_TYPES.GET_BLOCKED_REGIONS }),
            sendMessage({ type: MESSAGE_TYPES.GET_BLOCKED_TAGS }),
            sendMessage({ type: MESSAGE_TYPES.GET_BLOCKED_BIO_TAGS }),
            sendMessage({ type: MESSAGE_TYPES.GET_BLOCKED_PCF }),
            sendMessage({ type: MESSAGE_TYPES.GET_BLOCKED_LANGUAGES }),
            sendMessage({ type: MESSAGE_TYPES.GET_ALLOWED_USERS }),
            sendMessage({ type: MESSAGE_TYPES.GET_BLOCKED_AFFILIATIONS })
        ]);

        if (settingsResponse?.success) {
            settings = settingsResponse.data;
            isEnabled = settings.enabled !== false;
            debugMode = settings.debugMode === true;
        }
        
        console.log(`✅ X-Posed initialized (enabled: ${isEnabled}, debug: ${debugMode})`);

        // If we arrived here from a "Share evidence" action, remind the user to paste.
        maybeShowPasteHint();

        if (blockedResponse?.success) {
            blockedCountries = new Set(blockedResponse.data);
        }

        if (blockedRegionsResponse?.success) {
            blockedRegions = new Set(blockedRegionsResponse.data);
        }

        if (blockedTagsResponse?.success) {
            blockedTags = new Set(blockedTagsResponse.data);
        }

        if (blockedBioTagsResponse?.success) {
            blockedBioTags = new Set(blockedBioTagsResponse.data);
        }

        if (blockedPcfResponse?.success) {
            blockedPcf = new Set(blockedPcfResponse.data);
        }

        if (blockedLanguagesResponse?.success) {
            blockedLanguages = new Set(blockedLanguagesResponse.data);
        }

        if (allowedUsersResponse?.success) {
            allowedUsers = new Set(allowedUsersResponse.data);
        }

        if (blockedAffiliationsResponse?.success) {
            blockedAffiliations = new Set(blockedAffiliationsResponse.data);
        }

        createMemoizedFunctions();

        // Inject styles
        injectStyles();

        let readyWorkStarted = false;
        const startReadyWork = () => {
            if (readyWorkStarted) return;
            if (!document.body) {
                setTimeout(startReadyWork, 100);
                return;
            }

            readyWorkStarted = true;
            startObserver(memoizedIsEnabledFn, memoizedProcessElementSafe, memoizedScanPageFn, debug);

            try {
                detectAndApplyTheme(debug);
                startThemeObserver();
            } catch (error) {
                console.error('X-Posed theme failed:', error);
            }

            try {
                injectSidebarLink(settings, debug, blockedCountries, blockedRegions, sendMessage, MESSAGE_TYPES);
            } catch (error) {
                console.error('X-Posed sidebar failed:', error);
            }
        };

        if (document.readyState !== 'loading') {
            startReadyWork();
        } else {
            document.addEventListener('DOMContentLoaded', startReadyWork, { once: true });
        }
    } catch (error) {
        console.error('X-Posed initialization failed:', error);
    }
}

// ============================================
// MEMOIZED FUNCTIONS
// ============================================

/**
 * Create memoized functions once during initialization
 * These functions close over the module state and are reused
 */
function createMemoizedFunctions() {
    // Only create once
    if (memoizedProcessElementWithContext) return;
    
    // Process element function that closes over current state
    // Note: This references the module-level variables, so it always uses current values
    memoizedProcessElementWithContext = element => processElement(element, {
        get blockedCountries() { return blockedCountries; },
        get blockedRegions() { return blockedRegions; },
        get blockedTags() { return blockedTags; },
        get blockedBioTags() { return blockedBioTags; },
        get blockedPcf() { return blockedPcf; },
        get blockedLanguages() { return blockedLanguages; },
        get allowedUsers() { return allowedUsers; },
        get blockedAffiliations() { return blockedAffiliations; },
        get settings() { return settings; },
        get csrfToken() { return csrfToken; },
        sendMessage,
        fetchUserInfoViaPage,
        debug,
        get debugMode() { return debugMode; }
    });
    
    memoizedProcessElementSafe = createProcessElementSafe(memoizedProcessElementWithContext);
    
    // These use getters to always return current state values
    memoizedIsEnabledFn = () => isEnabled;
    memoizedScanPageFn = () => scanPage(
        memoizedIsEnabledFn,
        elements => processElementsBatch(elements, memoizedProcessElementSafe, debug),
        debug
    );
}

// ============================================
// CLEANUP
// ============================================

/**
 * Cleanup all resources. Idempotent — safe to invoke more than once
 * (e.g. both 'pagehide' and 'beforeunload' firing).
 */
function cleanup() {
    if (isCleanedUp) return;
    isCleanedUp = true;

    debug('Cleaning up X-Posed resources...');

    // Run local cleanup functions
    for (const cleanupFn of cleanupFunctions) {
        try {
            cleanupFn();
        } catch (error) {
            console.error('X-Posed: Cleanup error:', error);
        }
    }
    cleanupFunctions = [];

    // Cleanup modules
    cleanupUI();
    cleanupObservers();

    // Tear down the hovercard (removes global scroll/resize listeners + cache)
    try {
        hovercard.teardown();
    } catch (error) {
        console.error('X-Posed: Cleanup error:', error);
    }

    debug('Cleanup complete');
}

// Handle page unload. 'pagehide' fires reliably on the x.com SPA (and on
// bfcache navigations) where 'beforeunload' often does not; cleanup() is
// idempotent so both firing is harmless.
window.addEventListener('beforeunload', cleanup);
window.addEventListener('pagehide', cleanup);

// ============================================
// BOOTSTRAP
// ============================================

// Initialize when script loads
initialize();

// Export for debugging (uses memoized functions when available)
window.__X_POSED_CONTENT__ = {
    version: VERSION,
    scanPage: () => {
        // Use memoized functions if available, create on-demand otherwise
        if (memoizedScanPageFn) {
            memoizedScanPageFn();
        } else {
            // Fallback for debugging before initialization
            createMemoizedFunctions();
            memoizedScanPageFn();
        }
    },
    // Harvest diagnostics: how many accounts we hold profile data for, and whether the
    // page script was told enrichment is on.
    profiles: () => ({ cached: profileCount(), enabled: settings.profileEnrichment !== false }),
    getState: () => ({
        isEnabled,
        blockedCountries: Array.from(blockedCountries),
        blockedRegions: Array.from(blockedRegions),
        blockedTags: Array.from(blockedTags),
        blockedBioTags: Array.from(blockedBioTags),
        blockedPcf: Array.from(blockedPcf),
        blockedLanguages: Array.from(blockedLanguages),
        allowedUsers: Array.from(allowedUsers),
        blockedAffiliations: Array.from(blockedAffiliations),
        settings
    })
};
