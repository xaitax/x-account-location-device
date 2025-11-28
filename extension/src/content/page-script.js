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
            // Silently ignore errors to avoid breaking page functionality
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
        this._xPosedUrl = url;
        this._xPosedHeaders = {};
        return originalXHROpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.setRequestHeader = function(name, value) {
        if (this._xPosedHeaders) {
            this._xPosedHeaders[name] = value;
        }
        return originalXHRSetHeader.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function() {
        try {
            if (this._xPosedUrl && API_PATTERN.test(this._xPosedUrl) && this._xPosedHeaders) {
                sendHeaders(this._xPosedHeaders);
            }
        } catch (e) {
            // Silently ignore errors
        }
        return originalXHRSend.apply(this, arguments);
    };

    /**
     * Expose public API for debugging
     */
    window.XPosed = {
        version: '2.0.2',
        
        // Check if headers are captured
        hasHeaders: () => headersCaptured,
        
        // Force re-capture of headers (useful for debugging)
        resetHeaders: () => {
            headersCaptured = false;
            console.log('🔄 X-Posed: Headers reset - waiting for next API request');
        },
        
        // Debug info
        debug: () => {
            console.log('X-Posed Debug Info:', {
                version: '2.0.2',
                headersCaptured,
                injected: true
            });
        }
    };

    console.log('🚀 X-Posed: Page script loaded');
})();