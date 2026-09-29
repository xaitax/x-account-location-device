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
import { FOLLOWING_LIMITS, isFollowingHandle, projectFollowingUser, readFollowingViewer } from '../shared/following-data.js';

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
    const EVENT_SET_FOLLOWING = 'x-posed-set-following';
    const EVENT_FOLLOWING_HARVESTED = 'x-posed-following';
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
    // Viewer relationships are private session state, separate from public profile
    // enrichment. Capture identity and generation at REQUEST time, never at receipt.
    let followingContext = null;
    let followingSequence = 0;
    const followingMutations = new Map();

    window.addEventListener(EVENT_SET_FOLLOWING, event => {
        const previousContext = followingContext;
        followingContext = null;
        try {
            const setting = JSON.parse(event.detail || '{}');
            if (setting.enabled === true && typeof setting.viewer === 'string' &&
                Number.isSafeInteger(setting.generation) && setting.generation >= 0 &&
                setting.viewer === readFollowingViewer()) {
                followingContext = { viewer: setting.viewer, generation: setting.generation };
            }
        } catch { /* An invalid preference always disables relationship harvesting. */ }
        if (!followingContext || previousContext?.viewer !== followingContext.viewer ||
            previousContext?.generation !== followingContext.generation) followingMutations.clear();
    });

    function hasCurrentFollowingContext() {
        if (!followingContext) return false;
        if (followingContext.viewer === readFollowingViewer()) return true;
        // Remember that a switch was observed, even if the user switches back
        // before the content controller's next check. Its reply uses a new generation.
        followingContext = null;
        followingMutations.clear();
        window.dispatchEvent(new CustomEvent('x-posed-following-reset'));
        return false;
    }

    function followingRequestKind(url, method = 'GET') {
        try {
            const parsed = new URL(url, location.href);
            if (parsed.origin !== location.origin) return null;
            if (/^\/i\/api\/graphql\/[^/]+\/[^/]+$/.test(parsed.pathname)) {
                return { kind: 'graphql', path: parsed.pathname };
            }
            const mutation = /^\/i\/api\/1\.1\/friendships\/(create|destroy)\.json$/.exec(parsed.pathname);
            if (method.toUpperCase() === 'POST' && mutation) {
                return { kind: 'mutation', path: parsed.pathname, following: mutation[1] === 'create' };
            }
        } catch { /* Ignore non-X and malformed URLs. */ }
        return null;
    }

    function snapshotFollowingRequest(url, method) {
        if (!hasCurrentFollowingContext()) return null;
        const request = followingRequestKind(url, method);
        return request ? { ...followingContext, ...request, sequence: ++followingSequence } : null;
    }

    function isCurrentFollowingRequest(snapshot) {
        return Boolean(hasCurrentFollowingContext() && snapshot &&
            snapshot.viewer === followingContext.viewer && snapshot.generation === followingContext.generation);
    }

    function followingResponseMatches(snapshot, url, status) {
        if (!isCurrentFollowingRequest(snapshot) || status < 200 || status >= 300) return false;
        const response = followingRequestKind(url, snapshot.kind === 'mutation' ? 'POST' : 'GET');
        return response?.path === snapshot.path;
    }

    function relayFollowing(users, snapshot, authoritative = false) {
        if (!users.length || !isCurrentFollowingRequest(snapshot)) return;
        // Successful native mutations fence off every still-outstanding timeline
        // response, including requests started while the mutation was in flight.
        const sequence = authoritative ? ++followingSequence : snapshot.sequence;
        for (let index = 0; index < users.length; index += FOLLOWING_LIMITS.MAX_BATCH_ENTRIES) {
            const detail = JSON.stringify({
                viewer: snapshot.viewer, generation: snapshot.generation, sequence,
                users: users.slice(index, index + FOLLOWING_LIMITS.MAX_BATCH_ENTRIES),
                ...(authoritative ? { authoritative: true } : {})
            });
            if (detail.length <= FOLLOWING_LIMITS.MAX_RELAY_LENGTH && isCurrentFollowingRequest(snapshot)) {
                window.dispatchEvent(new CustomEvent(EVENT_FOLLOWING_HARVESTED, { detail }));
            }
        }
    }

    function harvestFollowingMutation(data, snapshot) {
        if (!isCurrentFollowingRequest(snapshot) || !data || typeof data !== 'object' ||
            Array.isArray(data) || data.errors || data.error || !isFollowingHandle(data.screen_name)) return;
        // A 2xx error envelope is not success. Native friendship responses return a
        // user object with its public account ID; do not infer from request bodies.
        if (!/^\d+$/.test(String(data.id_str ?? data.id ?? ''))) return;
        const flags = [data.relationship_perspectives?.following, data.following].filter(value => value !== undefined);
        if (flags.some(value => typeof value !== 'boolean')) return;
        const observed = flags.includes(false) ? false : flags.includes(true) ? true : undefined;
        // A successful create may only submit a request to a protected account.
        // Grant an exemption only with explicit confirmed-following evidence.
        const pending = data.follow_request_sent === true || data.relationship_perspectives?.follow_request_sent === true;
        if (snapshot.following && observed === undefined && !pending) return;
        if (!snapshot.following && observed === true) return;
        const following = snapshot.following && observed === true && !pending;
        const name = data.screen_name.toLowerCase();
        // An older native action completing late must not undo a newer confirmed
        // action. The completion fence separately handles outstanding read requests.
        if ((followingMutations.get(name) || 0) > snapshot.sequence) return;
        followingMutations.delete(name);
        followingMutations.set(name, snapshot.sequence);
        if (followingMutations.size > FOLLOWING_LIMITS.MAX_ENTRIES) followingMutations.delete(followingMutations.keys().next().value);
        relayFollowing([{ u: name, following }], snapshot, true);
    }

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
    function harvestProfiles(data, followingSnapshot = null) {
        const collectFollowing = isCurrentFollowingRequest(followingSnapshot);
        if ((!enrichmentEnabled && !collectFollowing) || !data || typeof data !== 'object') return;

        const found = new Map();
        const relationships = new Map();
        const visited = new Set();
        const stack = [data];
        let nodes = 0;
        const maxNodes = enrichmentEnabled ? PROFILE_LIMITS.MAX_WALK_NODES : FOLLOWING_LIMITS.MAX_WALK_NODES;

        while (stack.length > 0) {
            if (++nodes > maxNodes) break;

            const node = stack.pop();
            if (!node || typeof node !== 'object') continue;
            if (visited.has(node)) continue;
            visited.add(node);

            if (node.__typename === 'User') {
                const name = node.core?.screen_name;
                if (enrichmentEnabled && isProfileUsername(name) &&
                    (found.size < PROFILE_LIMITS.MAX_USERS_PER_RESPONSE || found.has(name.toLowerCase()))) {
                    const projected = projectProfileUser(node);
                    if (projected) {
                        // Multiple representations may each provide different fields.
                        // Missing fields must not overwrite earlier known values.
                        found.set(projected.u, mergeProjectedProfile(found.get(projected.u), projected));
                    }
                }
                if (collectFollowing) {
                    const relationship = projectFollowingUser(node);
                    if (relationship && (relationships.size < FOLLOWING_LIMITS.MAX_USERS_PER_RESPONSE || relationships.has(relationship.u))) {
                        if (relationships.get(relationship.u)?.following !== false) relationships.set(relationship.u, relationship);
                    }
                }
                // Deliberately no `continue`: a User can contain further nested results.
            }

            if (Array.isArray(node)) {
                const limit = Math.min(node.length, maxNodes - nodes - stack.length);
                for (let i = 0; i < limit; i++) stack.push(node[i]);
            } else {
                for (const key in node) {
                    if (nodes + stack.length >= maxNodes) break;
                    if (Object.hasOwn(node, key)) stack.push(node[key]);
                }
            }
        }

        if (collectFollowing) relayFollowing([...relationships.values()], followingSnapshot);
        if (!enrichmentEnabled) return;
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
    // Request context follows the response object, not its URL: concurrent requests
    // to the same timeline can belong to different viewers or preference generations.
    const responseContexts = new WeakMap();

    // via is one of 'json' | 'fetch' | 'xhr' — in practice always 'xhr', see the fetch wrapper.
    function tapPayload(url, data, via, followingSnapshot = null) {
        if (via === 'xhr') {
            harvestStats.xhrTaps++;
        } else if (via === 'json') {
            harvestStats.jsonTaps++;
        } else {
            harvestStats.fetchTaps++;
        }
        harvestStats.lastUrl = url;
        try {
            if (followingSnapshot?.kind === 'mutation') {
                harvestFollowingMutation(data, followingSnapshot);
            } else {
                harvestProfiles(data, followingSnapshot);
            }
        } catch (e) {
            logError('profile harvest', e);
        }
    }

    function tapResponsePayload(response, data, via, context) {
        if (context?.tapped) return;
        if (context) context.tapped = true;
        const url = response.url || '';
        const snapshot = followingResponseMatches(context?.following, url, response.status) ? context.following : null;
        // Never route a rejected friendship response through the profile walker.
        if (snapshot || (enrichmentEnabled && API_PATTERN.test(url))) tapPayload(url, data, via, snapshot);
    }

    const originalResponseJson = Response.prototype.json;
    Response.prototype.json = function () {
        const promise = originalResponseJson.apply(this, arguments);
        try {
            const url = this.url || '';
            const context = responseContexts.get(this);
            if ((enrichmentEnabled && API_PATTERN.test(url)) ||
                followingResponseMatches(context?.following, url, this.status)) {
                promise
                    .then(data => tapResponsePayload(this, data, 'json', context))
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
        let followingSnapshot = null;
        try {
            const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url;
            isGraphql = Boolean(url) && API_PATTERN.test(url);
            followingSnapshot = snapshotFollowingRequest(url, init?.method || input?.method || 'GET');

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
            if ((!enrichmentEnabled || !isGraphql) && !followingSnapshot) return result;

            return result.then(response => {
                try {
                    const context = { following: followingSnapshot, tapped: false };
                    responseContexts.set(response, context);
                    if ((!enrichmentEnabled || !isGraphql) &&
                        !followingResponseMatches(followingSnapshot, response.url, response.status)) return response;
                    const clone = response.clone();
                    // One tick, so the .json() tap gets first refusal on this response.
                    Promise.resolve().then(() => {
                        if (context.tapped || ((!enrichmentEnabled || !isGraphql) &&
                            !followingResponseMatches(followingSnapshot, response.url, response.status))) return;
                        // Use the original reader so the fallback cannot tap itself.
                        originalResponseJson.call(clone).then(data => {
                            tapResponsePayload(response, data, 'fetch', context);
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
    const xhrRequests = new WeakMap();

    XMLHttpRequest.prototype.open = function(method, url) {
        try {
            this._xPosedUrl = url;
            this._xPosedMethod = method;
            this._xPosedHeaders = {};
            xhrRequests.delete(this);
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
            const requestUrl = this._xPosedUrl;
            const isGraphql = requestUrl && API_PATTERN.test(requestUrl);
            const followingSnapshot = snapshotFollowingRequest(requestUrl, this._xPosedMethod);
            if (isGraphql) {
                harvestStats.graphqlXhrs++;
                if (this._xPosedHeaders) sendHeaders(this._xPosedHeaders);
            }

            // One listener per request, also removed on errors/aborts. Reused XHRs
            // cannot inherit an old viewer context or replay a previous response.
            if ((enrichmentEnabled && isGraphql) || followingSnapshot) {
                const request = { following: followingSnapshot };
                xhrRequests.set(this, request);
                this.addEventListener('loadend', function () {
                    try {
                        if (xhrRequests.get(this) !== request) return;
                        const snapshot = followingResponseMatches(followingSnapshot, this.responseURL, this.status) ? followingSnapshot : null;
                        if ((!enrichmentEnabled || !isGraphql) && !snapshot) return;
                        const type = this.responseType;
                        // JSON is already parsed; ignore blobs and cap relationship-only
                        // text parsing so a large response cannot pin the main thread.
                        const started = performance.now();
                        let data = null;
                        if (type === 'json') data = this.response;
                        else if (!type || type === 'text') {
                            if (!enrichmentEnabled && this.responseText.length > 8 * 1024 * 1024) return;
                            data = JSON.parse(this.responseText);
                        } else return;
                        if (!data) return;

                        tapPayload(requestUrl, data, 'xhr', snapshot);

                        harvestStats.xhrResponseType = type || '(default)';
                        harvestStats.lastHarvestMs = Math.round(performance.now() - started);
                    } catch (e) {
                        logError('xhr harvest', e);
                    }
                }, { once: true });
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
