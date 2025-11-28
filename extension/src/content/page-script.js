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

    const EVENT_HEADERS_CAPTURED = 'x-posed-headers-captured';
    const API_PATTERN = /x\.com\/i\/api\/graphql/;

    let headersCaptured = false;

    /**
     * Send captured headers to content script
     */
    function sendHeaders(headers) {
        if (headersCaptured) return;
        
        // Validate we have auth headers
        if (!headers || (!headers.authorization && !headers['authorization'])) {
            return;
        }

        headersCaptured = true;

        // Convert Headers object to plain object if needed
        const headerObj = headers instanceof Headers 
            ? Object.fromEntries(headers.entries()) 
            : { ...headers };

        // Dispatch custom event for content script
        window.dispatchEvent(new CustomEvent(EVENT_HEADERS_CAPTURED, {
            detail: { headers: headerObj }
        }));

        console.log('✅ X-Posed: API headers captured');
    }

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
        // This version string is replaced at build time via @rollup/plugin-replace
        // See rollup.config.js for the replacement configuration
        version: '2.0.2',
        
        // Check if headers are captured
        hasHeaders: () => headersCaptured,
        
        // Force re-capture of headers (useful for debugging)
        resetHeaders: () => {
            headersCaptured = false;
            console.log('🔄 X-Posed: Headers reset - waiting for next API request');
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
                version: '2.0.2',
                headersCaptured,
                injected: true,
                debugMode: !!window.XPosedDebug
            });
        }
    };

    console.log('🚀 X-Posed: Page script loaded');
})();