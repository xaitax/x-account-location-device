/**
 * Content Script (ISOLATED World)
 * Main entry point - handles initialization, state management, and message coordination
 * Orchestrates UI and Observer modules
 */

import browserAPI from '../shared/browser-api.js';
import { MESSAGE_TYPES, CSS_CLASSES, VERSION } from '../shared/constants.js';

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
    cleanupObservers
} from './observer.js';

import { hovercard } from './hovercard.js';
import { glyph } from './icons.js';

// ============================================
// STATE
// ============================================

let isEnabled = true;
let blockedCountries = new Set();
let blockedRegions = new Set();
let blockedTags = new Set();
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
 * Inject page script into MAIN world for header interception
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
                // Apply badge-display toggles (e.g. "Flag from Device", "Show Flags")
                // live to already-processed tweets, not only to newly-loaded ones.
                // Clearing the processed markers + re-scanning rebuilds badges from the
                // warm local cache, so this triggers no new API calls.
                const badgeKeys = ['showFlags', 'flagFromDevice', 'showDevices', 'showVpnIndicator', 'showCaptureButton'];
                if (badgeKeys.some(k => prevSettings[k] !== settings[k])) {
                    document.querySelectorAll(`.${CSS_CLASSES.INFO_BADGE}`).forEach(el => el.remove());
                    document.querySelectorAll('[data-x-processed]').forEach(el => {
                        delete el.dataset.xProcessed;
                        delete el.dataset.xScreenName;
                    });
                    if (memoizedScanPageFn) memoizedScanPageFn();
                }
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
            updateBlockedTweets(blockedCountries, blockedRegions, blockedTags, settings);
            return { success: true };

        case MESSAGE_TYPES.BLOCKED_REGIONS_UPDATED:
            blockedRegions = new Set(payload);
            updateBlockedTweets(blockedCountries, blockedRegions, blockedTags, settings);
            return { success: true };

        case MESSAGE_TYPES.BLOCKED_TAGS_UPDATED:
            blockedTags = new Set(payload);
            updateBlockedTweets(blockedCountries, blockedRegions, blockedTags, settings);
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
        if (!t || Date.now() - t > 20000) return;
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
        setupBackgroundListener();

        // Extract CSRF token
        csrfToken = getCsrfToken();
        
        // Inject page script for header interception
        injectPageScript();

        // Load initial settings, blocked countries, blocked regions, and blocked tags
        const [settingsResponse, blockedResponse, blockedRegionsResponse, blockedTagsResponse] = await Promise.all([
            sendMessage({ type: MESSAGE_TYPES.GET_SETTINGS }),
            sendMessage({ type: MESSAGE_TYPES.GET_BLOCKED_COUNTRIES }),
            sendMessage({ type: MESSAGE_TYPES.GET_BLOCKED_REGIONS }),
            sendMessage({ type: MESSAGE_TYPES.GET_BLOCKED_TAGS })
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
    getState: () => ({
        isEnabled,
        blockedCountries: Array.from(blockedCountries),
        blockedRegions: Array.from(blockedRegions),
        blockedTags: Array.from(blockedTags),
        settings
    })
};
