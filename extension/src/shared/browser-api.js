/**
 * Cross-Browser API Abstraction
 * Provides unified API for Chrome and Firefox extensions
 */

// Detect browser environment
const isFirefox = typeof browser !== 'undefined';
const isChrome = typeof chrome !== 'undefined' && !isFirefox;

/**
 * Unified browser API
 * In Firefox, 'browser' is available with Promise-based APIs
 * In Chrome, 'chrome' uses callbacks but we wrap them in Promises
 */
const browserAPI = (() => {
    // If Firefox's browser API is available, use it directly
    if (isFirefox && typeof browser !== 'undefined') {
        return browser;
    }
    
    // For Chrome, we need to promisify the callback-based APIs
    if (isChrome && typeof chrome !== 'undefined') {
        return {
            runtime: {
                sendMessage: message => {
                    return new Promise((resolve, reject) => {
                        chrome.runtime.sendMessage(message, response => {
                            if (chrome.runtime.lastError) {
                                reject(new Error(chrome.runtime.lastError.message));
                            } else {
                                resolve(response);
                            }
                        });
                    });
                },
                onMessage: chrome.runtime.onMessage,
                getURL: chrome.runtime.getURL.bind(chrome.runtime),
                id: chrome.runtime.id,
                getManifest: chrome.runtime.getManifest.bind(chrome.runtime)
            },
            storage: {
                local: {
                    get: keys => {
                        return new Promise((resolve, reject) => {
                            chrome.storage.local.get(keys, result => {
                                if (chrome.runtime.lastError) {
                                    reject(new Error(chrome.runtime.lastError.message));
                                } else {
                                    resolve(result);
                                }
                            });
                        });
                    },
                    set: items => {
                        return new Promise((resolve, reject) => {
                            chrome.storage.local.set(items, () => {
                                if (chrome.runtime.lastError) {
                                    reject(new Error(chrome.runtime.lastError.message));
                                } else {
                                    resolve();
                                }
                            });
                        });
                    },
                    remove: keys => {
                        return new Promise((resolve, reject) => {
                            chrome.storage.local.remove(keys, () => {
                                if (chrome.runtime.lastError) {
                                    reject(new Error(chrome.runtime.lastError.message));
                                } else {
                                    resolve();
                                }
                            });
                        });
                    },
                    clear: () => {
                        return new Promise((resolve, reject) => {
                            chrome.storage.local.clear(() => {
                                if (chrome.runtime.lastError) {
                                    reject(new Error(chrome.runtime.lastError.message));
                                } else {
                                    resolve();
                                }
                            });
                        });
                    }
                },
                onChanged: chrome.storage.onChanged
            },
            tabs: {
                query: queryInfo => {
                    return new Promise((resolve, reject) => {
                        chrome.tabs.query(queryInfo, tabs => {
                            if (chrome.runtime.lastError) {
                                reject(new Error(chrome.runtime.lastError.message));
                            } else {
                                resolve(tabs);
                            }
                        });
                    });
                },
                sendMessage: (tabId, message) => {
                    return new Promise((resolve, reject) => {
                        chrome.tabs.sendMessage(tabId, message, response => {
                            if (chrome.runtime.lastError) {
                                reject(new Error(chrome.runtime.lastError.message));
                            } else {
                                resolve(response);
                            }
                        });
                    });
                }
            },
            scripting: chrome.scripting ? {
                executeScript: details => {
                    return new Promise((resolve, reject) => {
                        chrome.scripting.executeScript(details, results => {
                            if (chrome.runtime.lastError) {
                                reject(new Error(chrome.runtime.lastError.message));
                            } else {
                                resolve(results);
                            }
                        });
                    });
                }
            } : undefined
        };
    }
    
    // Fallback: return empty object (for non-extension contexts)
    console.warn('No browser extension API detected');
    return {
        runtime: {
            sendMessage: () => Promise.reject(new Error('Not in extension context')),
            onMessage: { addListener: () => {} },
            getURL: () => '',
            id: '',
            getManifest: () => ({})
        },
        storage: {
            local: {
                get: () => Promise.resolve({}),
                set: () => Promise.resolve(),
                remove: () => Promise.resolve(),
                clear: () => Promise.resolve()
            },
            onChanged: { addListener: () => {} }
        },
        tabs: {
            query: () => Promise.resolve([]),
            sendMessage: () => Promise.resolve()
        }
    };
})();

/**
 * Check if we're running in an extension context
 */
export const isExtensionContext = () => {
    try {
        return !!(browserAPI.runtime && browserAPI.runtime.id);
    } catch {
        return false;
    }
};

/**
 * Check if we're in a background/service worker context
 */
export const isBackgroundContext = () => {
    return typeof ServiceWorkerGlobalScope !== 'undefined' || 
           (typeof window === 'undefined' && isExtensionContext());
};

/**
 * Check if we're in a content script context
 */
export const isContentScriptContext = () => {
    return typeof window !== 'undefined' && 
           isExtensionContext() && 
           !isBackgroundContext();
};

/**
 * Get browser type
 */
export const getBrowserType = () => {
    if (isFirefox) return 'firefox';
    if (isChrome) return 'chrome';
    return 'unknown';
};

export { browserAPI, isFirefox, isChrome };
export default browserAPI;