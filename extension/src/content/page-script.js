/**
 * Page Script (MAIN World)
 * Runs in the page's JavaScript context to intercept network requests
 * and capture authentication headers for the X API
 * 
 * This script is injected into the page and communicates with the
 * content script via CustomEvents.
 */

import { PacedLookupQueue, readRateLimitReset } from '../shared/request-policy.js';
import { PROFILE_LIMITS, isProfileUsername, projectProfileUser, mergeProjectedProfile, profileSignature } from '../shared/profile-data.js';
import { parseAccountResponse } from '../shared/account-response.js';

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
    const EVENT_PROFILES_HARVESTED = 'x-posed-profiles';
    const EVENT_SET_ENRICHMENT = 'x-posed-set-enrichment';
    const API_PATTERN = /x\.com\/i\/api\/graphql/;
    const ABOUT_QUERY_ID = 'XRqGa7EeokUU5kppkh13EA';
    const lookupQueue = new PacedLookupQueue();
    const pendingLookups = new Map();

    // Never collect profile text before the content script has loaded the user's
    // preference. Its ready/settings handshake enables passive harvesting explicitly.
    let enrichmentEnabled = false;
    // Bounded, primitive-only snapshots. A short dedup window permits recipient-cache
    // recovery; changed or newly available fields are always relayed immediately.
    const recentlyEmitted = new Map();

    // Counters for window.XPosed.enrichmentStatus(), so a "nothing shows up" report can be
    // diagnosed without guessing which link in the chain broke.
    const harvestStats = {
        // Which transport X actually uses for GraphQL. If both of these stay 0 while the
        // timeline loads, our interceptors are not in the request path at all — which is a
        // completely different problem from "we see the request but can't read the body".
        graphqlFetches: 0,
        graphqlXhrs: 0,
        // Which tap succeeded in reading a body.
        jsonTaps: 0,
        fetchTaps: 0,
        xhrTaps: 0,
        responses: 0,
        usersEmitted: 0,
        lastUrl: null
    };

    window.addEventListener(EVENT_SET_ENRICHMENT, event => {
        try {
            enrichmentEnabled = JSON.parse(event.detail || '{}').enabled === true;
        } catch {
            enrichmentEnabled = false;
        }
        if (!enrichmentEnabled) recentlyEmitted.clear();
    });

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
                throw Object.assign(new Error('No captured page headers available'), { code: 'NO_HEADERS' });
            }

            const key = screenName.toLowerCase();
            if (!pendingLookups.has(key)) {
                const pending = lookupQueue.add(async signal => {
                    if (!capturedHeaders) {
                        throw Object.assign(new Error('No captured page headers available'), { code: 'NO_HEADERS' });
                    }
                    const variables = encodeURIComponent(JSON.stringify({ screenName }));
                    const url = `/i/api/graphql/${ABOUT_QUERY_ID}/AboutAccountQuery?variables=${variables}`;
                    const response = await fetch(url, {
                        headers: { ...capturedHeaders, 'accept-language': 'en-US,en;q=0.9' },
                        method: 'GET', credentials: 'include', signal
                    });
                    if (response.status === 429) {
                        lookupQueue.setRateLimit(readRateLimitReset(response.headers));
                        throw lookupQueue.rateLimitError();
                    }
                    if (response.status === 401 || response.status === 403) {
                        headersCaptured = false;
                        capturedHeaders = null;
                        throw Object.assign(new Error('Authentication failed'), { code: 'UNAUTHORIZED' });
                    }
                    if (!response.ok) {
                        throw Object.assign(new Error(`Page API error: ${response.status}`), {
                            code: response.status === 404 ? 'NOT_FOUND' : 'NETWORK_ERROR'
                        });
                    }
                    return parseAccountResponse(await response.json(), screenName, { fullMetadata: false });
                }).finally(() => { pendingLookups.delete(key); });
                pendingLookups.set(key, pending);
            }
            const data = await pendingLookups.get(key);

            window.dispatchEvent(new CustomEvent(EVENT_FETCH_USER_INFO_RESULT, {
                detail: JSON.stringify({
                    id,
                    success: true,
                    data
                })
            }));
        } catch (error) {
            window.dispatchEvent(new CustomEvent(EVENT_FETCH_USER_INFO_RESULT, {
                detail: JSON.stringify({
                    id, success: false, error: error?.message || String(error),
                    code: error?.code || 'NETWORK_ERROR', retryAfter: error?.retryAfter || null
                })
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
     * Walk a parsed X GraphQL response for embedded `User` objects and relay what we find.
     *
     * Iterative rather than recursive: these payloads nest deeply enough (tweet → quoted
     * tweet → retweeted status → card → user refs) that recursion is a real stack risk. The
     * visited set stops the same object being re-walked — X repeats the same user many times
     * per response — and the node cap is a backstop so a pathological payload can't pin the
     * main thread.
     */
    function harvestProfiles(data) {
        if (!enrichmentEnabled || !data || typeof data !== 'object') return;

        const found = new Map();
        const visited = new Set();
        const stack = [data];
        let nodes = 0;

        while (stack.length > 0) {
            if (++nodes > PROFILE_LIMITS.MAX_WALK_NODES) break;

            const node = stack.pop();
            if (!node || typeof node !== 'object') continue;
            if (visited.has(node)) continue;
            visited.add(node);

            if (node.__typename === 'User') {
                const name = node.core?.screen_name;
                if (isProfileUsername(name) &&
                    (found.size < PROFILE_LIMITS.MAX_USERS_PER_RESPONSE || found.has(name.toLowerCase()))) {
                    const projected = projectProfileUser(node);
                    if (projected) {
                        // Multiple representations may each provide different fields.
                        // Missing fields must not overwrite earlier known values.
                        found.set(projected.u, mergeProjectedProfile(found.get(projected.u), projected));
                    }
                }
                // Deliberately no `continue`: a User can contain further nested results.
            }

            if (Array.isArray(node)) {
                const limit = Math.min(node.length, PROFILE_LIMITS.MAX_WALK_NODES - nodes - stack.length);
                for (let i = 0; i < limit; i++) stack.push(node[i]);
            } else {
                for (const key in node) {
                    if (nodes + stack.length >= PROFILE_LIMITS.MAX_WALK_NODES) break;
                    if (Object.hasOwn(node, key)) stack.push(node[key]);
                }
            }
        }

        harvestStats.responses++;
        const now = Date.now();
        const pending = [];
        for (const patch of found.values()) {
            const previous = recentlyEmitted.get(patch.u);
            const record = mergeProjectedProfile(previous?.record, patch);
            const signature = profileSignature(record);
            const emit = !previous || signature !== previous.signature ||
                now - previous.emittedAt >= PROFILE_LIMITS.EMIT_TTL_MS;
            recentlyEmitted.delete(patch.u);
            recentlyEmitted.set(patch.u, {
                record, signature, emittedAt: emit ? now : previous.emittedAt
            });
            if (recentlyEmitted.size > PROFILE_LIMITS.MAX_ENTRIES) {
                recentlyEmitted.delete(recentlyEmitted.keys().next().value);
            }
            if (emit) pending.push(record);
        }

        let batch = [];
        let batchLength = '{"users":[]}'.length;
        const flush = () => {
            if (batch.length === 0) return;
            const detail = `{"users":[${batch.join(',')}]}`;
            harvestStats.usersEmitted += batch.length;
            window.dispatchEvent(new CustomEvent(EVENT_PROFILES_HARVESTED, { detail }));
            batch = [];
            batchLength = '{"users":[]}'.length;
        };
        for (const record of pending) {
            const serialized = JSON.stringify(record);
            if (serialized.length + '{"users":[]}'.length > PROFILE_LIMITS.MAX_RELAY_LENGTH) continue;
            const extraLength = serialized.length + (batch.length > 0 ? 1 : 0);
            if (batch.length >= PROFILE_LIMITS.MAX_BATCH_ENTRIES || batchLength + extraLength > PROFILE_LIMITS.MAX_RELAY_LENGTH) flush();
            batchLength += serialized.length + (batch.length > 0 ? 1 : 0);
            batch.push(serialized);
        }
        flush();
    }

    /**
     * Read X's OWN responses for the profile data it already ships with the timeline.
     *
     * Hooks Response.prototype.json rather than cloning and re-parsing: a HomeTimeline page
     * is megabytes of JSON, and parsing it a second time on every scroll is exactly how you
     * get jank. This taps the object X has already built, so the extra cost is the walk only.
     */
    // Responses whose body we already read via the .json() tap, so the fetch fallback below
    // doesn't parse the same payload twice. Bounded — it only needs to bridge one tick.
    const tappedUrls = new Set();

    // via is one of 'json' | 'fetch' | 'xhr' — in practice always 'xhr', see the fetch wrapper.
    function tapPayload(url, data, via) {
        if (via === 'xhr') {
            harvestStats.xhrTaps++;
        } else if (via === 'json') {
            harvestStats.jsonTaps++;
            tappedUrls.add(url);
            if (tappedUrls.size > 50) {
                // Cheap reset; the set only guards against an immediate double-parse.
                const keep = [...tappedUrls].slice(-10);
                tappedUrls.clear();
                for (const u of keep) tappedUrls.add(u);
            }
        } else {
            harvestStats.fetchTaps++;
        }
        harvestStats.lastUrl = url;
        try {
            harvestProfiles(data);
        } catch (e) {
            logError('profile harvest', e);
        }
    }

    const originalResponseJson = Response.prototype.json;
    Response.prototype.json = function () {
        const promise = originalResponseJson.apply(this, arguments);
        try {
            const url = this.url || '';
            if (enrichmentEnabled && API_PATTERN.test(url)) {
                promise
                    .then(data => tapPayload(url, data, 'json'))
                    // X owns the real error handling for this response; we must not turn our
                    // tap into an unhandled rejection.
                    .catch(() => {});
            }
        } catch (e) {
            logError('response tap', e);
        }
        return promise;
    };

    /**
     * Intercept Fetch API
     */
    const originalFetch = window.fetch;
    window.fetch = function(input, init) {
        let isGraphql = false;
        try {
            const url = typeof input === 'string' ? input : input?.url;
            isGraphql = Boolean(url) && API_PATTERN.test(url);

            if (isGraphql) {
                harvestStats.graphqlFetches++;
                if (init?.headers) sendHeaders(init.headers);
            }
        } catch (e) {
            // Log errors in debug mode for troubleshooting
            logError('fetch intercept', e);
        }

        const result = originalFetch.apply(this, arguments);

        // Profile-harvest fallback. MEASURED: X delivers GraphQL over XHR, not fetch — this
        // path and the Response.prototype.json tap have both recorded zero hits against a
        // real timeline, and the XHR handler below is what actually does the work. Kept only
        // as insurance in case X switches transports.
        //
        // Gated on the REQUEST url so the common case (every non-GraphQL fetch X makes, of
        // which there are many) doesn't pay for an extra promise link it can never use.
        try {
            if (!enrichmentEnabled || !isGraphql) return result;

            return result.then(response => {
                try {
                    const url = response.url || '';

                    const clone = response.clone();
                    // One tick, so the .json() tap gets first refusal on this response.
                    Promise.resolve().then(() => {
                        if (!enrichmentEnabled || tappedUrls.has(url)) return;
                        clone.json().then(data => {
                            if (tappedUrls.has(url)) return;
                            tapPayload(url, data, 'fetch');
                        }).catch(() => {});
                    });
                } catch (e) {
                    logError('fetch harvest', e);
                }
                return response;
            });
        } catch (e) {
            logError('fetch harvest wrap', e);
            return result;
        }
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
            if (this._xPosedUrl && API_PATTERN.test(this._xPosedUrl)) {
                harvestStats.graphqlXhrs++;
                if (this._xPosedHeaders) sendHeaders(this._xPosedHeaders);

                // Harvest profiles from XHR too. Response.prototype.json and the fetch
                // wrapper both only see fetch — an XHR-delivered timeline is invisible to
                // them, which is exactly how every counter can read zero while the page
                // loads normally.
                if (enrichmentEnabled) {
                    const requestUrl = this._xPosedUrl;
                    this.addEventListener('load', function () {
                        try {
                            if (!enrichmentEnabled) return;
                            const type = this.responseType;
                            // responseType 'json' hands back an already-parsed object (free);
                            // '' / 'text' needs one parse. Anything else (blob, arraybuffer)
                            // is not ours to touch.
                            const started = performance.now();
                            let data = null;
                            if (type === 'json') data = this.response;
                            else if (!type || type === 'text') data = JSON.parse(this.responseText);
                            else return;
                            if (!data) return;

                            tapPayload(requestUrl, data, 'xhr');

                            // Surfaced so the cost of this work is measurable rather than
                            // assumed: responseType 'json' is free, 'text' means we parse a
                            // multi-megabyte payload on the main thread during scroll.
                            harvestStats.xhrResponseType = type || '(default)';
                            harvestStats.lastHarvestMs = Math.round(performance.now() - started);
                        } catch (e) {
                            logError('xhr harvest', e);
                        }
                    });
                }
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
        
        // Why is nothing showing up? Reports every link in the harvest chain at once.
        enrichmentStatus: () => ({
            enabled: enrichmentEnabled,
            hooked: Response.prototype.json !== originalResponseJson,
            ...harvestStats,
            recentlyEmitted: recentlyEmitted.size
        }),

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

    // Tell the content script we're listening. The enrichment setting is pushed in
    // response — dispatching it blindly at injection time would race this script's own
    // load and the first setting would be lost.
    window.dispatchEvent(new CustomEvent('x-posed-page-ready'));

    debugLog('🚀 X-Posed: Page script loaded');
})();
