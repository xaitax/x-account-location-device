/**
 * Page Script (MAIN World)
 * Runs in the page's JavaScript context to intercept network requests
 * and capture authentication headers for the X API
 * 
 * This script is injected into the page and communicates with the
 * content script via CustomEvents.
 */

(function() {
    'use strict';

    // Prevent multiple injections
    if (window.__X_POSED_INJECTED__) return;
    window.__X_POSED_INJECTED__ = true;

    // Gate informational logging. Off by default so we don't spam the page
    // console in production; flip via window.XPosed.enableDebug() (sets
    // window.XPosedDebug) or by setting DEBUG = true here during development.
    const DEBUG = false;
    function debugLog(...args) {
        if (DEBUG || window.XPosedDebug) {
            console.log(...args);
        }
    }

    const EVENT_HEADERS_CAPTURED = 'x-posed-headers-captured';
    const EVENT_RESET_HEADERS = 'x-posed-reset-headers';
    const EVENT_FETCH_USER_INFO = 'x-posed-fetch-user-info';
    const EVENT_FETCH_USER_INFO_RESULT = 'x-posed-fetch-user-info-result';
    const API_PATTERN = /x\.com\/i\/api\/graphql/;
    const ABOUT_QUERY_ID = 'XRqGa7EeokUU5kppkh13EA';

    let headersCaptured = false;
    let capturedHeaders = null;

    function hasHeader(headers, name) {
        if (headers instanceof Headers) return headers.has(name);
        const wanted = name.toLowerCase();
        return Object.keys(headers || {}).some(key => key.toLowerCase() === wanted);
    }

    /**
     * Send captured headers to content script
     */
    function sendHeaders(headers) {
        if (headersCaptured) return;
        
        if (!hasHeader(headers, 'authorization') || !hasHeader(headers, 'x-csrf-token')) {
            return;
        }

        headersCaptured = true;

        // Convert Headers object to plain object if needed
        const headerObj = headers instanceof Headers 
            ? Object.fromEntries(headers.entries()) 
            : { ...headers };
        capturedHeaders = headerObj;

        // Dispatch custom event for content script
        window.dispatchEvent(new CustomEvent(EVENT_HEADERS_CAPTURED, {
            detail: JSON.stringify({ headers: headerObj })
        }));

        debugLog('✅ X-Posed: API headers captured');
    }

    window.addEventListener(EVENT_RESET_HEADERS, () => {
        headersCaptured = false;
        capturedHeaders = null;
        debugLog('🔄 X-Posed: Headers reset - waiting for next API request');
    });

    function parseAboutAccount(data) {
        const user = data?.data?.user_result_by_screen_name?.result;
        const profile = user?.about_profile;

        return {
            location: profile?.account_based_in || null,
            device: profile?.source || null,
            locationAccurate: profile?.location_accurate !== false,
            meta: {
                name: user?.core?.name || null,
                avatarUrl: user?.avatar?.image_url || null,
                createdAt: user?.core?.created_at || null,
                restId: user?.rest_id || null
            }
        };
    }

    window.addEventListener(EVENT_FETCH_USER_INFO, async event => {
        let request = {};
        try {
            request = JSON.parse(event.detail || '{}');
        } catch {
            request = {};
        }

        const { id, screenName } = request;

        try {
            if (!id || !screenName || !capturedHeaders) {
                throw new Error('No captured page headers available');
            }

            const variables = encodeURIComponent(JSON.stringify({ screenName }));
            const url = `/i/api/graphql/${ABOUT_QUERY_ID}/AboutAccountQuery?variables=${variables}`;
            const response = await fetch(url, {
                headers: {
                    ...capturedHeaders,
                    'accept-language': 'en-US,en;q=0.9'
                },
                method: 'GET',
                credentials: 'include'
            });

            if (!response.ok) {
                if (response.status === 401 || response.status === 403) {
                    headersCaptured = false;
                    capturedHeaders = null;
                    window.dispatchEvent(new CustomEvent(EVENT_FETCH_USER_INFO_RESULT, {
                        detail: JSON.stringify({
                            id,
                            success: false,
                            error: 'Authentication failed',
                            code: 'UNAUTHORIZED'
                        })
                    }));
                    return;
                }

                throw new Error(`Page API error: ${response.status}`);
            }

            window.dispatchEvent(new CustomEvent(EVENT_FETCH_USER_INFO_RESULT, {
                detail: JSON.stringify({ id, success: true, data: parseAboutAccount(await response.json()) })
            }));
        } catch (error) {
            window.dispatchEvent(new CustomEvent(EVENT_FETCH_USER_INFO_RESULT, {
                detail: JSON.stringify({ id, success: false, error: error?.message || String(error) })
            }));
        }
    });

    /**
     * Safe error logger - only logs in debug scenarios, never throws
     * @param {string} context - Where the error occurred
     * @param {Error} error - The error object
     */
    function logError(context, error) {
        // In production, we don't want to spam the console
        // But during development, this helps debugging
        if (window.XPosedDebug) {
            console.debug('X-Posed page script error:', context, error?.message || error);
        }
    }

    /**
     * Intercept Fetch API
     */
    const originalFetch = window.fetch;
    window.fetch = function(input, init) {
        try {
            const url = typeof input === 'string' ? input : input?.url;
            
            if (url && API_PATTERN.test(url) && init?.headers) {
                sendHeaders(init.headers);
            }
        } catch (e) {
            // Log errors in debug mode for troubleshooting
            logError('fetch intercept', e);
        }
        
        return originalFetch.apply(this, arguments);
    };

    /**
     * Intercept XMLHttpRequest
     */
    const originalXHROpen = XMLHttpRequest.prototype.open;
    const originalXHRSetHeader = XMLHttpRequest.prototype.setRequestHeader;
    const originalXHRSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function(method, url) {
        try {
            this._xPosedUrl = url;
            this._xPosedHeaders = {};
        } catch (e) {
            logError('XHR open', e);
        }
        return originalXHROpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.setRequestHeader = function(name, value) {
        try {
            if (this._xPosedHeaders) {
                this._xPosedHeaders[name] = value;
            }
        } catch (e) {
            logError('XHR setRequestHeader', e);
        }
        return originalXHRSetHeader.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function() {
        try {
            if (this._xPosedUrl && API_PATTERN.test(this._xPosedUrl) && this._xPosedHeaders) {
                sendHeaders(this._xPosedHeaders);
            }
        } catch (e) {
            logError('XHR send', e);
        }
        return originalXHRSend.apply(this, arguments);
    };

    /**
     * Expose public API for debugging
     * NOTE: Version strings are replaced at build time by rollup.config.js
     * to ensure consistency with constants.js
     */
    window.XPosed = {
        // This placeholder is replaced at build time via @rollup/plugin-replace
        // (rollup.config.js maps __BUILD_VERSION__ -> package.json version),
        // matching how constants.js sources VERSION.
        version: '__BUILD_VERSION__',
        
        // Check if headers are captured
        hasHeaders: () => headersCaptured,
        
        // Force re-capture of headers (useful for debugging)
        resetHeaders: () => {
            window.dispatchEvent(new CustomEvent(EVENT_RESET_HEADERS));
        },
        
        // Enable debug mode for error logging
        enableDebug: () => {
            window.XPosedDebug = true;
            console.log('🔍 X-Posed: Debug mode enabled');
        },
        
        // Disable debug mode
        disableDebug: () => {
            window.XPosedDebug = false;
            console.log('🔍 X-Posed: Debug mode disabled');
        },
        
        // Debug info
        debug: () => {
            console.log('X-Posed Debug Info:', {
                version: '__BUILD_VERSION__',
                headersCaptured,
                injected: true,
                debugMode: !!window.XPosedDebug
            });
        }
    };

    debugLog('🚀 X-Posed: Page script loaded');
})();
