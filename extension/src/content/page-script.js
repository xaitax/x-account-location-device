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
    const EVENT_PROFILES_HARVESTED = 'x-posed-profiles';
    const EVENT_SET_ENRICHMENT = 'x-posed-set-enrichment';
    const API_PATTERN = /x\.com\/i\/api\/graphql/;
    const ABOUT_QUERY_ID = 'XRqGa7EeokUU5kppkh13EA';

    // Kept local rather than imported from shared/constants.js: this bundle is injected into
    // the page, and pulling that module in would drag the country tables along with it.
    // Mirrors PROFILE_CACHE_CONFIG.MAX_WALK_NODES.
    const MAX_WALK_NODES = 200000;
    const MAX_BIO_LENGTH = 200;
    // Bounded so the dedup set can't grow across a long session; cleared wholesale when it
    // fills, which also lets a changed bio or follower count refresh eventually.
    const RECENT_EMIT_LIMIT = 500;

    // Starts ON, matching the default setting, and is only ever turned OFF by an explicit
    // instruction from the content script. Starting OFF meant the very first HomeTimeline —
    // which fires before the content script can finish its ready round-trip — was always
    // missed, and a single dropped message disabled harvesting for the whole session.
    let enrichmentEnabled = true;
    const recentlyEmitted = new Set();

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

    function parseAboutAccount(data, requestedScreenName = null) {
        const user = data?.data?.user_result_by_screen_name?.result;
        const profile = user?.about_profile;

        // Same guard as parseResponse in background/api-client.js (issue #23): never accept a
        // response describing a DIFFERENT account than the one asked for. This path matters
        // just as much as the background's — the result is written straight into the shared
        // cache via SET_CACHE, so an unchecked mismatch would attach one account's country and
        // device to another and make every filter act on the wrong data. Only enforced when X
        // actually returns a handle, so it can never break a normal lookup.
        const returnedScreenName = user?.core?.screen_name || null;
        if (requestedScreenName && returnedScreenName &&
            returnedScreenName.toLowerCase() !== requestedScreenName.toLowerCase()) {
            throw new Error(`Returned @${returnedScreenName} does not match requested @${requestedScreenName}`);
        }

        // MUST stay in sync with parseAboutAccount in background/api-client.js. This is the
        // in-page fallback used when the background can't authenticate, so anything missing
        // here silently becomes missing everywhere. In particular the affiliation must be
        // parsed: `affiliateUsername` is the marker meaning "affiliation was checked" (see
        // affiliationWasChecked in shared/constants.js), so emitting the rest of `meta`
        // without it would cache the account as confirmed-unaffiliated.
        const label = user?.affiliates_highlighted_label?.label ||
            user?.identity_profile_labels_highlighted_label?.label || null;
        const affiliate = label?.description ? {
            name: label.description,
            badgeUrl: label?.badge?.url || null,
            url: label?.url?.url || null,
            type: label?.userLabelType || label?.userLabelDisplayType || null
        } : null;

        let usernameChanges = null;
        const rawChanges = profile?.username_changes?.count;
        if (rawChanges !== null && rawChanges !== undefined) {
            const parsed = Number.parseInt(String(rawChanges), 10);
            if (!Number.isNaN(parsed)) {
                usernameChanges = parsed;
            }
        }

        return {
            location: profile?.account_based_in || null,
            device: profile?.source || null,
            locationAccurate: profile?.location_accurate !== false,
            meta: {
                name: user?.core?.name || null,
                avatarUrl: user?.avatar?.image_url || null,
                createdAt: user?.core?.created_at || null,
                restId: user?.rest_id || null,
                affiliateUsername: profile?.affiliate_username || null,
                affiliate,
                usernameChanges
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
                detail: JSON.stringify({
                    id,
                    success: true,
                    data: parseAboutAccount(await response.json(), screenName)
                })
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
     * Pull the profile fields we care about out of one X `User` object.
     * Returns null for anything that isn't a usable user.
     *
     * Only primitives are copied out — nothing here keeps a reference into the response,
     * so X's payload stays collectable.
     */
    function projectUser(user) {
        const screenName = user?.core?.screen_name;
        if (!screenName || typeof screenName !== 'string') return null;

        const counts = user.relationship_counts || {};
        const tweets = user.tweet_counts || {};
        const bio = user.profile_bio?.description;

        return {
            u: screenName,
            b: typeof bio === 'string' && bio ? bio.slice(0, MAX_BIO_LENGTH) : undefined,
            p: typeof user.parody_commentary_fan_label === 'string'
                ? user.parody_commentary_fan_label
                : undefined,
            f: Number.isInteger(counts.followers) ? counts.followers : undefined,
            g: Number.isInteger(counts.following) ? counts.following : undefined,
            t: Number.isInteger(tweets.tweets) ? tweets.tweets : undefined,
            m: Number.isInteger(tweets.media_tweets) ? tweets.media_tweets : undefined
        };
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

        const found = [];
        const seenHere = new Set();
        const visited = new Set();
        const stack = [data];
        let nodes = 0;

        while (stack.length > 0) {
            if (++nodes > MAX_WALK_NODES) break;

            const node = stack.pop();
            if (!node || typeof node !== 'object') continue;
            if (visited.has(node)) continue;
            visited.add(node);

            if (node.__typename === 'User') {
                const projected = projectUser(node);
                if (projected && !seenHere.has(projected.u) && !recentlyEmitted.has(projected.u)) {
                    seenHere.add(projected.u);
                    found.push(projected);
                }
                // Deliberately no `continue`: a User can contain further nested results.
            }

            if (Array.isArray(node)) {
                for (let i = 0; i < node.length; i++) stack.push(node[i]);
            } else {
                for (const key in node) stack.push(node[key]);
            }
        }

        harvestStats.responses++;
        if (found.length === 0) return;

        if (recentlyEmitted.size > RECENT_EMIT_LIMIT) recentlyEmitted.clear();
        for (const entry of found) recentlyEmitted.add(entry.u);
        harvestStats.usersEmitted += found.length;

        window.dispatchEvent(new CustomEvent(EVENT_PROFILES_HARVESTED, {
            detail: JSON.stringify({ users: found })
        }));
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
                        if (tappedUrls.has(url)) return;
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
