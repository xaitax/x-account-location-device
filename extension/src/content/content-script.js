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
    uiCleanupFunctions
} from './ui.js';

import {
    startObserver,
    scanPage,
    processElementsBatch,
    processElement,
    createProcessElementSafe,
    updateBlockedTweets,
    userInfoCache,
    processingQueue,
    cleanupObservers,
    queueForVisibility
} from './observer.js';

// ============================================
// STATE
// ============================================

let isEnabled = true;
let blockedCountries = new Set();
let settings = {};
let csrfToken = null;
let debugMode = false;

// Cleanup tracking
let cleanupFunctions = [];

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
        const { headers } = event.detail;
        debug('Headers captured from page script');
        
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
            }
            
            if (prevSettings.showSidebarBlockerLink !== settings.showSidebarBlockerLink) {
                if (settings.showSidebarBlockerLink === false) {
                    removeSidebarLink(debug);
                } else {
                    injectSidebarLink(settings, debug, blockedCountries, sendMessage, MESSAGE_TYPES);
                }
            }
            return { success: true };
        }

        case MESSAGE_TYPES.BLOCKED_COUNTRIES_UPDATED:
            blockedCountries = new Set(payload);
            updateBlockedTweets(blockedCountries);
            return { success: true };

        default:
            return { success: false, error: 'Unknown message type' };
    }
}

// ============================================
// INITIALIZATION
// ============================================

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

        // Load initial settings and blocked countries
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
        detectAndApplyTheme(debug);
        startThemeObserver();

        // Create memoized functions once (not on every call)
        createMemoizedFunctions();
        
        // Start DOM observation when ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                startObserver(memoizedIsEnabledFn, memoizedProcessElementSafe, memoizedScanPageFn, debug);
                injectSidebarLink(settings, debug, blockedCountries, sendMessage, MESSAGE_TYPES);
            });
        } else {
            startObserver(memoizedIsEnabledFn, memoizedProcessElementSafe, memoizedScanPageFn, debug);
            injectSidebarLink(settings, debug, blockedCountries, sendMessage, MESSAGE_TYPES);
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
        get settings() { return settings; },
        get csrfToken() { return csrfToken; },
        sendMessage,
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
 * Cleanup all resources
 */
function cleanup() {
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
    
    debug('Cleanup complete');
}

// Handle page unload
window.addEventListener('beforeunload', cleanup);

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
    getState: () => ({ isEnabled, blockedCountries: Array.from(blockedCountries), settings })
};