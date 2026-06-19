/**
 * X API Client
 * Handles all API requests to X platform with rate limiting and retry logic
 */

import { API_CONFIG, BEARER_TOKEN } from '../shared/constants.js';
import { sleep } from '../shared/utils.js';

/**
 * API Error with typed error codes
 */
export class APIError extends Error {
    constructor(message, code, statusCode = null, retryAfter = null) {
        super(message);
        this.name = 'APIError';
        this.code = code;
        this.statusCode = statusCode;
        this.retryAfter = retryAfter;
    }
}

// Error codes
export const API_ERROR_CODES = {
    NO_HEADERS: 'NO_HEADERS',
    RATE_LIMITED: 'RATE_LIMITED',
    NETWORK_ERROR: 'NETWORK_ERROR',
    PARSE_ERROR: 'PARSE_ERROR',
    NOT_FOUND: 'NOT_FOUND',
    UNAUTHORIZED: 'UNAUTHORIZED',
    UNKNOWN: 'UNKNOWN'
};

// Case-insensitive header presence check (captured headers may be plain objects
// with varied casing).
function hasHeader(headers, name) {
    const wanted = name.toLowerCase();
    return Object.keys(headers || {}).some(key => key.toLowerCase() === wanted);
}

/**
 * Request queue for managing concurrent requests
 */
class RequestQueue {
    constructor(maxConcurrent = API_CONFIG.MAX_CONCURRENT, minInterval = API_CONFIG.MIN_INTERVAL_MS) {
        this.maxConcurrent = maxConcurrent;
        this.minInterval = minInterval;
        this.activeRequests = 0;
        this.lastRequestTime = 0;
        this.queue = [];
        this.rateLimitReset = 0;
        this.scheduled = false;
    }

    async add(request) {
        return new Promise((resolve, reject) => {
            this.queue.push({ request, resolve, reject });
            this.process();
        });
    }

    // Dispatcher: starts one queued request if concurrency + pacing allow, then
    // schedules the next start. Requests run concurrently (up to maxConcurrent); only
    // their START times are paced by minInterval, so we get real parallelism without
    // firing a burst that trips X's rate limits. (Previously a single `processing`
    // lock spanned each request's whole lifetime, so effective concurrency was 1.)
    process() {
        if (this.queue.length === 0) return;
        if (this.activeRequests >= this.maxConcurrent) return;

        const now = Date.now();

        // Global rate-limit cooldown.
        if (this.rateLimitReset > now) {
            this.scheduleProcess(Math.min(this.rateLimitReset - now, 60000));
            return;
        }

        // Pace request starts (not their lifetimes) by minInterval.
        const timeSinceLast = now - this.lastRequestTime;
        if (timeSinceLast < this.minInterval) {
            this.scheduleProcess(this.minInterval - timeSinceLast);
            return;
        }

        const item = this.queue.shift();
        if (!item) return;

        this.activeRequests++;
        this.lastRequestTime = Date.now();
        this.runItem(item); // intentionally not awaited, so more requests can start

        // Start the next queued request after the pacing interval, while this one runs.
        if (this.queue.length > 0) this.scheduleProcess(this.minInterval);
    }

    async runItem(item) {
        try {
            const result = await item.request();
            item.resolve(result);
        } catch (error) {
            if (error instanceof APIError && error.code === API_ERROR_CODES.RATE_LIMITED) {
                this.rateLimitReset = error.retryAfter || (Date.now() + 60000);
            }
            item.reject(error);
        } finally {
            this.activeRequests--;
            // A slot just freed — pump again (coalesced into the single pending timer).
            if (this.queue.length > 0) this.scheduleProcess(0);
        }
    }

    // Coalesce pumps into one pending timer so bursts of add()/completions don't
    // stack timers; pacing is still enforced by the checks in process().
    scheduleProcess(delay) {
        if (this.scheduled) return;
        this.scheduled = true;
        setTimeout(() => {
            this.scheduled = false;
            this.process();
        }, delay);
    }

    setRateLimit(resetTime) {
        this.rateLimitReset = resetTime;
    }

    get pendingCount() {
        return this.queue.length;
    }

    get activeCount() {
        return this.activeRequests;
    }

    clear() {
        const items = this.queue.splice(0);
        for (const item of items) {
            item.reject(new APIError('Queue cleared', API_ERROR_CODES.UNKNOWN));
        }
    }
}

/**
 * Active request deduplication with bounded size and timeout cleanup
 * Prevents unbounded memory growth from concurrent requests
 */
class RequestDeduplicator {
    constructor(maxSize = 200) {
        this.pending = new Map();
        this.maxSize = maxSize;
    }

    async dedupe(key, requestFn) {
        // Return existing promise if request is in flight
        if (this.pending.has(key)) {
            return this.pending.get(key);
        }

        // Evict oldest entries if at capacity
        // This shouldn't normally happen since requests complete quickly
        if (this.pending.size >= this.maxSize) {
            const firstKey = this.pending.keys().next().value;
            if (firstKey) {
                this._cleanup(firstKey);
                console.warn(`⚠️ RequestDeduplicator: Evicted oldest entry (${firstKey}), size was ${this.pending.size + 1}`);
            }
        }

        // Create new promise; clean up on settle. The maxSize eviction above is the
        // backstop against a never-settling request leaking its entry (and the MV3
        // worker is torn down on idle, clearing everything), so no per-request timer.
        const promise = requestFn()
            .finally(() => {
                this._cleanup(key);
            });

        this.pending.set(key, promise);
        return promise;
    }

    /**
     * Clean up a pending request and its timeout
     * @param {string} key - The request key to clean up
     */
    _cleanup(key) {
        this.pending.delete(key);
    }

    has(key) {
        return this.pending.has(key);
    }

    clear() {
        this.pending.clear();
    }
    
    get size() {
        return this.pending.size;
    }
}

/**
 * X API Client
 */
export class XAPIClient {
    constructor() {
        this.headers = null;
        this.queue = new RequestQueue();
        this.deduplicator = new RequestDeduplicator();
    }

    /**
     * Set API headers from captured request
     */
    setHeaders(headers) {
        // Require BOTH an auth token and a CSRF token — partial captures can't make
        // a valid X API call and only lead to 401 churn (issue #14 recovery work).
        if (hasHeader(headers, 'authorization') && hasHeader(headers, 'x-csrf-token')) {
            this.headers = { ...headers };
            console.log('✅ API headers configured');
            return true;
        }
        return false;
    }

    /**
     * Get current headers or generate fallback
     */
    getHeaders() {
        if (this.headers) {
            return { ...this.headers };
        }
        return null;
    }

    /**
     * Generate fallback headers using CSRF token from cookies (if available)
     */
    generateFallbackHeaders(csrfToken) {
        if (!csrfToken) return null;

        return {
            'authorization': BEARER_TOKEN,
            'x-csrf-token': csrfToken,
            'x-twitter-active-user': 'yes',
            'x-twitter-auth-type': 'OAuth2Session',
            'content-type': 'application/json'
        };
    }

    /**
     * Check if headers are available
     */
    hasHeaders() {
        return this.headers !== null;
    }

    /**
     * Fetch user info from X API
     */
    async fetchUserInfo(screenName, csrfToken = null) {
        // Use deduplicator to prevent duplicate requests
        return this.deduplicator.dedupe(screenName, async () => {
            return this.queue.add(async () => {
                return this.executeRequest(screenName, csrfToken);
            });
        });
    }

    /**
     * Execute the actual API request with retry logic for transient failures
     */
    async executeRequest(screenName, csrfToken = null, retryCount = 0) {
        let headers = this.getHeaders();

        // Try fallback headers if no captured headers
        if (!headers && csrfToken) {
            headers = this.generateFallbackHeaders(csrfToken);
            if (headers) {
                console.log('⚠️ Using fallback headers');
            }
        }

        if (!headers) {
            throw new APIError(
                'No API headers available',
                API_ERROR_CODES.NO_HEADERS
            );
        }

        const variables = encodeURIComponent(JSON.stringify({ screenName }));
        const url = `${API_CONFIG.BASE_URL}/${API_CONFIG.QUERY_ID}/AboutAccountQuery?variables=${variables}`;

        // Force English for consistent country names
        const requestHeaders = { ...headers };
        requestHeaders['accept-language'] = 'en-US,en;q=0.9';

        try {
            const response = await fetch(url, {
                headers: requestHeaders,
                method: 'GET',
                mode: 'cors',
                credentials: 'include'
            });

            if (!response.ok) {
                await this.handleErrorResponse(response);
                // handleErrorResponse always throws, so this line won't be reached
                return null;
            }

            const data = await response.json();
            return this.parseResponse(data);
        } catch (error) {
            if (error instanceof APIError) {
                // Don't retry rate limits, auth errors, or not found
                if (error.code === API_ERROR_CODES.RATE_LIMITED ||
                    error.code === API_ERROR_CODES.UNAUTHORIZED ||
                    error.code === API_ERROR_CODES.NOT_FOUND) {
                    throw error;
                }
            }
            
            // Retry network errors with exponential backoff
            if (retryCount < API_CONFIG.MAX_RETRIES) {
                const delay = API_CONFIG.RETRY_DELAY_MS * Math.pow(2, retryCount);
                console.warn(`⚠️ API request failed for @${screenName}, retrying in ${delay}ms (attempt ${retryCount + 1}/${API_CONFIG.MAX_RETRIES})`);
                await sleep(delay);
                return this.executeRequest(screenName, csrfToken, retryCount + 1);
            }
            
            // All retries exhausted
            if (error instanceof APIError) {
                throw error;
            }
            
            throw new APIError(
                error.message || 'Network error',
                API_ERROR_CODES.NETWORK_ERROR
            );
        }
    }

    /**
     * Handle error responses from API
     */
    async handleErrorResponse(response) {
        if (response.status === 429) {
            const reset = response.headers.get('x-rate-limit-reset');
            const retryAfter = reset ? parseInt(reset) * 1000 : Date.now() + 60000;
            const waitMinutes = Math.ceil((retryAfter - Date.now()) / 60000);
            
            console.warn(`⚠️ Rate limited. Retry in ${waitMinutes} minute(s)`);
            
            throw new APIError(
                'Rate limit exceeded',
                API_ERROR_CODES.RATE_LIMITED,
                429,
                retryAfter
            );
        }

        if (response.status === 401 || response.status === 403) {
            // Clear invalid headers
            this.headers = null;
            
            throw new APIError(
                'Authentication failed',
                API_ERROR_CODES.UNAUTHORIZED,
                response.status
            );
        }

        if (response.status === 404) {
            throw new APIError(
                'User not found',
                API_ERROR_CODES.NOT_FOUND,
                404
            );
        }

        throw new APIError(
            `API error: ${response.status}`,
            API_ERROR_CODES.UNKNOWN,
            response.status
        );
    }

    /**
     * Parse API response
     */
    parseResponse(data) {
        try {
            const user = data?.data?.user_result_by_screen_name?.result;
            const profile = user?.about_profile;

            // Core values used by the extension (existing behavior)
            const location = profile?.account_based_in || null;
            const device = profile?.source || null;
            const locationAccurate = profile?.location_accurate !== false;

            // Rich metadata (used for hovercard UI). All fields are optional.
            const createdAt = user?.core?.created_at || null;
            const name = user?.core?.name || null;
            const avatarUrl = user?.avatar?.image_url || null;
            const restId = user?.rest_id || null;

            const blueVerified = user?.is_blue_verified === true;
            const verified = user?.verification?.verified === true;
            const identityVerified = user?.verification_info?.is_identity_verified === true;
            const protectedAccount = user?.privacy?.protected === true;

            // Verification metadata (optional)
            let verifiedSinceMsec = null;
            const rawVerifiedSince = user?.verification_info?.reason?.verified_since_msec;
            if (rawVerifiedSince !== null && rawVerifiedSince !== undefined) {
                const parsed = Number.parseInt(String(rawVerifiedSince), 10);
                if (!Number.isNaN(parsed) && parsed > 0) {
                    verifiedSinceMsec = parsed;
                }
            }

            const profileImageShape = user?.profile_image_shape || null;

            // About-profile metadata
            const createdCountryAccurate = profile?.created_country_accurate === true;
            const learnMoreUrl = profile?.learn_more_url || null;
            const affiliateUsername = profile?.affiliate_username || null;

            // Username changes is usually a string count (e.g., "0")
            let usernameChanges = null;
            const rawChanges = profile?.username_changes?.count;
            if (rawChanges !== null && rawChanges !== undefined) {
                const parsed = Number.parseInt(String(rawChanges), 10);
                if (!Number.isNaN(parsed)) {
                    usernameChanges = parsed;
                }
            }

            // Prefer affiliates_highlighted_label, fallback to identity_profile_labels_highlighted_label
            const label = user?.affiliates_highlighted_label?.label || user?.identity_profile_labels_highlighted_label?.label || null;
            const affiliate = label?.description ? {
                name: label.description,
                badgeUrl: label?.badge?.url || null,
                url: label?.url?.url || null,
                type: label?.userLabelType || label?.userLabelDisplayType || null
            } : null;

            return {
                location,
                device,
                locationAccurate,
                meta: {
                    name,
                    avatarUrl,
                    createdAt,
                    restId,
                    profileImageShape,
                    blueVerified,
                    verified,
                    identityVerified,
                    verifiedSinceMsec,
                    protected: protectedAccount,
                    usernameChanges,
                    createdCountryAccurate,
                    learnMoreUrl,
                    affiliateUsername,
                    affiliate
                }
            };
        } catch (error) {
            throw new APIError(
                'Failed to parse response',
                API_ERROR_CODES.PARSE_ERROR
            );
        }
    }

    /**
     * Get rate limit status
     * @returns {{isRateLimited: boolean, resetTime: number|null, remainingMs: number|null}}
     */
    getRateLimitStatus() {
        const now = Date.now();
        const resetTime = this.queue.rateLimitReset;
        const isRateLimited = resetTime > now;
        
        return {
            isRateLimited,
            resetTime: isRateLimited ? resetTime : null,
            remainingMs: isRateLimited ? resetTime - now : null
        };
    }

}

// Export singleton instance
export const apiClient = new XAPIClient();