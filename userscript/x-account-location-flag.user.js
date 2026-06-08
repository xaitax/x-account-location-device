// ==UserScript==
// @name         X-Posed: Account Location & Device Info
// @namespace    http://tampermonkey.net/
// @version      1.5.1
// @description  See where X users are located and what devices they use. Country flags & device icons next to every username. Optional geo-blocking.
// @author       Alexander Hagenah (@xaitax)
// @homepage     https://github.com/xaitax/x-account-location-device
// @supportURL   https://primepage.de
// @supportURL   https://www.linkedin.com/in/alexhagenah/
// @match        *://*x.com/*
// @match        *://*twitter.com/*
// @grant        unsafeWindow
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    /**
     * Configuration & Constants
     */
    const CONFIG = {
        VERSION: '1.5.1',
        CACHE_KEY: 'x_location_cache_v3', // v3 includes locationAccurate field
        BLOCKED_COUNTRIES_KEY: 'x_blocked_countries',
        CACHE_EXPIRY: 48 * 60 * 60 * 1000, // 48 hours (extended from 24)
        API: {
            QUERY_ID: 'XRqGa7EeokUU5kppkh13EA', // AboutAccountQuery
            MIN_INTERVAL: 2000,
            MAX_CONCURRENT: 2,
            RETRY_DELAY: 5000
        },
        SELECTORS: {
            USERNAME: '[data-testid="UserName"], [data-testid="User-Name"]',
            TWEET: 'article[data-testid="tweet"]',
            USER_CELL: '[data-testid="UserCell"]',
            LINKS: 'a[href^="/"]'
        },
        STYLES: {
            SHIMMER_ID: 'x-flag-shimmer-style',
            FLAG_CLASS: 'x-location-flag',
            DEVICE_CLASS: 'x-device-indicator'
        }
    };

    /**
     * Country & Flag Data
     * Optimized for O(1) lookup
     */
    const COUNTRY_FLAGS = {
        "afghanistan": "🇦🇫", "albania": "🇦🇱", "algeria": "🇩🇿", "andorra": "🇦🇩", "angola": "🇦🇴",
        "antigua and barbuda": "🇦🇬", "argentina": "🇦🇷", "armenia": "🇦🇲", "australia": "🇦🇺", "austria": "🇦🇹",
        "azerbaijan": "🇦🇿", "bahamas": "🇧🇸", "bahrain": "🇧🇭", "bangladesh": "🇧🇩", "barbados": "🇧🇧",
        "belarus": "🇧🇾", "belgium": "🇧🇪", "belize": "🇧🇿", "benin": "🇧🇯", "bhutan": "🇧🇹",
        "bolivia": "🇧🇴", "bosnia and herzegovina": "🇧🇦", "bosnia": "🇧🇦", "botswana": "🇧🇼", "brazil": "🇧🇷",
        "brunei": "🇧🇳", "bulgaria": "🇧🇬", "burkina faso": "🇧🇫", "burundi": "🇧🇮", "cambodia": "🇰🇭",
        "cameroon": "🇨🇲", "canada": "🇨🇦", "cape verde": "🇨🇻", "central african republic": "🇨🇫", "chad": "🇹🇩",
        "chile": "🇨🇱", "china": "🇨🇳", "colombia": "🇨🇴", "comoros": "🇰🇲", "congo": "🇨🇬",
        "costa rica": "🇨🇷", "croatia": "🇭🇷", "cuba": "🇨🇺", "cyprus": "🇨🇾", "czech republic": "🇨🇿",
        "czechia": "🇨🇿", "democratic republic of the congo": "🇨🇩", "denmark": "🇩🇰", "djibouti": "🇩🇯", "dominica": "🇩🇲",
        "dominican republic": "🇩🇴", "east timor": "🇹🇱", "ecuador": "🇪🇨", "egypt": "🇪🇬", "el salvador": "🇸🇻",
        "england": "🏴󠁧󠁢󠁥󠁮󠁧󠁿", "equatorial guinea": "🇬🇶", "eritrea": "🇪🇷", "estonia": "🇪🇪", "eswatini": "🇸🇿",
        "ethiopia": "🇪🇹", "europe": "🇪🇺", "european union": "🇪🇺", "fiji": "🇫🇯", "finland": "🇫🇮",
        "france": "🇫🇷", "gabon": "🇬🇦", "gambia": "🇬🇲", "georgia": "🇬🇪", "germany": "🇩🇪",
        "ghana": "🇬🇭", "greece": "🇬🇷", "grenada": "🇬🇩", "guatemala": "🇬🇹", "guinea": "🇬🇳",
        "guinea-bissau": "🇬🇼", "guyana": "🇬🇾", "haiti": "🇭🇹", "honduras": "🇭🇳", "hong kong": "🇭🇰",
        "hungary": "🇭🇺", "iceland": "🇮🇸", "india": "🇮🇳", "indonesia": "🇮🇩", "iran": "🇮🇷",
        "iraq": "🇮🇶", "ireland": "🇮🇪", "israel": "🇮🇱", "italy": "🇮🇹", "ivory coast": "🇨🇮",
        "jamaica": "🇯🇲", "japan": "🇯🇵", "jordan": "🇯🇴", "kazakhstan": "🇰🇿", "kenya": "🇰🇪",
        "kiribati": "🇰🇮", "korea": "🇰🇷", "kosovo": "🇽🇰", "kuwait": "🇰🇼", "kyrgyzstan": "🇰🇬",
        "laos": "🇱🇦", "latvia": "🇱🇻", "lebanon": "🇱🇧", "lesotho": "🇱🇸", "liberia": "🇱🇷",
        "libya": "🇱🇾", "liechtenstein": "🇱🇮", "lithuania": "🇱🇹", "luxembourg": "🇱🇺", "macao": "🇲🇴",
        "macau": "🇲🇴", "madagascar": "🇲🇬", "malawi": "🇲🇼", "malaysia": "🇲🇾", "maldives": "🇲🇻",
        "mali": "🇲🇱", "malta": "🇲🇹", "marshall islands": "🇲🇭", "mauritania": "🇲🇷", "mauritius": "🇲🇺",
        "mexico": "🇲🇽", "micronesia": "🇫🇲", "moldova": "🇲🇩", "monaco": "🇲🇨", "mongolia": "🇲🇳",
        "montenegro": "🇲🇪", "morocco": "🇲🇦", "mozambique": "🇲🇿", "myanmar": "🇲🇲", "burma": "🇲🇲",
        "namibia": "🇳🇦", "nauru": "🇳🇷", "nepal": "🇳🇵", "netherlands": "🇳🇱", "new zealand": "🇳🇿",
        "nicaragua": "🇳🇮", "niger": "🇳🇪", "nigeria": "🇳🇬", "north korea": "🇰🇵", "north macedonia": "🇲🇰",
        "macedonia": "🇲🇰", "norway": "🇳🇴", "oman": "🇴🇲", "pakistan": "🇵🇰", "palau": "🇵🇼",
        "palestine": "🇵🇸", "panama": "🇵🇦", "papua new guinea": "🇵🇬", "paraguay": "🇵🇾", "peru": "🇵🇪",
        "philippines": "🇵🇭", "poland": "🇵🇱", "portugal": "🇵🇹", "puerto rico": "🇵🇷", "qatar": "🇶🇦",
        "romania": "🇷🇴", "russia": "🇷🇺", "russian federation": "🇷🇺", "rwanda": "🇷🇼", "saint kitts and nevis": "🇰🇳",
        "saint lucia": "🇱🇨", "saint vincent and the grenadines": "🇻🇨", "samoa": "🇼🇸", "san marino": "🇸🇲", "sao tome and principe": "🇸🇹",
        "saudi arabia": "🇸🇦", "scotland": "🏴󠁧󠁢󠁳󠁣󠁴󠁿", "senegal": "🇸🇳", "serbia": "🇷🇸", "seychelles": "🇸🇨",
        "sierra leone": "🇸🇱", "singapore": "🇸🇬", "slovakia": "🇸🇰", "slovenia": "🇸🇮", "solomon islands": "🇸🇧",
        "somalia": "🇸🇴", "south africa": "🇿🇦", "south korea": "🇰🇷", "south sudan": "🇸🇸", "spain": "🇪🇸",
        "sri lanka": "🇱🇰", "sudan": "🇸🇩", "suriname": "🇸🇷", "sweden": "🇸🇪", "switzerland": "🇨🇭",
        "syria": "🇸🇾", "taiwan": "🇹🇼", "tajikistan": "🇹🇯", "tanzania": "🇹🇿", "thailand": "🇹🇭",
        "timor-leste": "🇹🇱", "togo": "🇹🇬", "tonga": "🇹🇴", "trinidad and tobago": "🇹🇹", "tunisia": "🇹🇳",
        "turkey": "🇹🇷", "türkiye": "🇹🇷", "turkmenistan": "🇹🇲", "tuvalu": "🇹🇻", "uganda": "🇺🇬",
        "ukraine": "🇺🇦", "united arab emirates": "🇦🇪", "uae": "🇦🇪", "united kingdom": "🇬🇧", "uk": "🇬🇧",
        "great britain": "🇬🇧", "britain": "🇬🇧", "united states": "🇺🇸", "usa": "🇺🇸", "us": "🇺🇸",
        "uruguay": "🇺🇾", "uzbekistan": "🇺🇿", "vanuatu": "🇻🇺", "vatican city": "🇻🇦", "venezuela": "🇻🇪",
        "vietnam": "🇻🇳", "wales": "🏴󠁧󠁢󠁷󠁬󠁳󠁿", "yemen": "🇾🇪", "zambia": "🇿🇲", "zimbabwe": "🇿🇼"
    };

    /**
     * Core Application Class
     */
    class XLocationPatcher {
        constructor() {
            this.cache = new Map();
            this.requestQueue = [];
            this.activeRequests = 0;
            this.lastRequestTime = 0;
            this.rateLimitReset = 0;
            this.headers = null;
            this.processingSet = new Set();
            this.fetchPromises = new Map(); // Track active promises
            this.observer = null;
            this.isEnabled = true;
            this.flagFromDevice = false;
            this.blockedCountries = new Set();

            this.init();
        }

        init() {
            console.log(`🚀 X Account Location v${CONFIG.VERSION} initializing...`);
            console.log(`📦 Cache expiry: ${CONFIG.CACHE_EXPIRY / 1000 / 60 / 60} hours`);
            this.loadSettings();
            this.loadCache();
            this.loadBlockedCountries();
            this.setupInterceptors();
            this.exposeAPI();

            // Inject styles and start observing when DOM is ready
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', () => {
                    this.injectStyles();
                    this.injectSidebarLink();
                    this.startObserver();
                });
            } else {
                this.injectStyles();
                this.injectSidebarLink();
                this.startObserver();
            }

            // Periodic cache save
            setInterval(() => this.saveCache(), 30000);
        }

        /**
         * Network Interception & Header Capture
         */
        setupInterceptors() {
            const self = this;

            // Intercept Fetch
            const originalFetch = window.fetch;
            window.fetch = function (url, options) {
                if (typeof url === 'string' && url.includes('x.com/i/api/graphql') && options?.headers) {
                    self.captureHeaders(options.headers);
                }
                return originalFetch.apply(this, arguments);
            };

            // Intercept XHR
            const originalOpen = XMLHttpRequest.prototype.open;
            const originalSend = XMLHttpRequest.prototype.send;
            const originalSetHeader = XMLHttpRequest.prototype.setRequestHeader;

            XMLHttpRequest.prototype.open = function (method, url) {
                this._url = url;
                return originalOpen.apply(this, arguments);
            };

            XMLHttpRequest.prototype.setRequestHeader = function (header, value) {
                if (!this._headers) this._headers = {};
                this._headers[header] = value;
                return originalSetHeader.apply(this, arguments);
            };

            XMLHttpRequest.prototype.send = function () {
                if (this._url?.includes('x.com/i/api/graphql') && this._headers) {
                    self.captureHeaders(this._headers);
                }
                return originalSend.apply(this, arguments);
            };
        }

        captureHeaders(headers) {
            if (this.headers) return; // Already captured

            const headerObj = headers instanceof Headers ? Object.fromEntries(headers.entries()) : headers;

            // Validate we have auth headers
            if (headerObj.authorization || headerObj['authorization']) {
                this.headers = headerObj;
                console.log('✅ X API Headers captured successfully');
            }
        }

        getFallbackHeaders() {
            const cookies = document.cookie.split('; ').reduce((acc, cookie) => {
                const [key, value] = cookie.split('=');
                acc[key] = value;
                return acc;
            }, {});

            if (!cookies.ct0) return null;

            return {
                'authorization': 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA',
                'x-csrf-token': cookies.ct0,
                'x-twitter-active-user': 'yes',
                'x-twitter-auth-type': 'OAuthSession',
                'content-type': 'application/json'
            };
        }

        /**
         * Data Management
         */
        loadSettings() {
            try {
                const stored = localStorage.getItem('x_location_enabled');
                this.isEnabled = stored !== null ? JSON.parse(stored) : true;

                const flagSource = localStorage.getItem('x_flag_from_device');
                this.flagFromDevice = flagSource !== null ? JSON.parse(flagSource) : false;
            } catch (e) {
                console.error('Failed to load settings', e);
            }
        }

        loadBlockedCountries() {
            try {
                const stored = localStorage.getItem(CONFIG.BLOCKED_COUNTRIES_KEY);
                if (stored) {
                    this.blockedCountries = new Set(JSON.parse(stored));
                    console.log(`🚫 Loaded ${this.blockedCountries.size} blocked countries`);
                }
            } catch (e) {
                console.error('Failed to load blocked countries', e);
                this.blockedCountries = new Set();
            }
        }

        saveBlockedCountries() {
            try {
                const array = Array.from(this.blockedCountries);
                localStorage.setItem(CONFIG.BLOCKED_COUNTRIES_KEY, JSON.stringify(array));
                console.log(`💾 Saved ${array.length} blocked countries`);
            } catch (e) {
                console.error('Failed to save blocked countries', e);
            }
        }

        loadCache() {
            try {
                const raw = localStorage.getItem(CONFIG.CACHE_KEY);
                if (!raw) return;

                const parsed = JSON.parse(raw);
                const now = Date.now();
                let count = 0;

                Object.entries(parsed).forEach(([key, data]) => {
                    if (data.expiry > now) {
                        this.cache.set(key, data.value);
                        count++;
                    }
                });
                console.log(`📦 Loaded ${count} cached entries`);
            } catch (e) {
                console.error('Cache load failed', e);
                localStorage.removeItem(CONFIG.CACHE_KEY);
            }
        }

        saveCache() {
            try {
                const now = Date.now();
                const expiry = now + CONFIG.CACHE_EXPIRY;
                const exportData = {};

                this.cache.forEach((value, key) => {
                    exportData[key] = { value, expiry };
                });

                localStorage.setItem(CONFIG.CACHE_KEY, JSON.stringify(exportData));
            } catch (e) {
                console.error('Cache save failed', e);
            }
        }

        /**
         * API Interaction
         */
        async fetchUserInfo(screenName) {
            // 1. Check cache
            if (this.cache.has(screenName)) {
                return this.cache.get(screenName);
            }

            // 2. Check active promises (deduplication)
            if (this.fetchPromises.has(screenName)) {
                return this.fetchPromises.get(screenName);
            }

            // 3. Create new promise and queue request
            const promise = new Promise((resolve, reject) => {
                this.requestQueue.push({ screenName, resolve, reject });
                this.processQueue();
            }).then(result => {
                this.fetchPromises.delete(screenName);
                return result;
            }).catch(error => {
                this.fetchPromises.delete(screenName);
                throw error;
            });

            this.fetchPromises.set(screenName, promise);
            return promise;
        }

        async processQueue() {
            if (this.activeRequests >= CONFIG.API.MAX_CONCURRENT || this.requestQueue.length === 0) return;

            // Rate limit check
            const now = Date.now();
            if (this.rateLimitReset > now) {
                const wait = this.rateLimitReset - now;
                setTimeout(() => this.processQueue(), Math.min(wait, 60000));
                return;
            }

            const timeSinceLast = now - this.lastRequestTime;
            if (timeSinceLast < CONFIG.API.MIN_INTERVAL) {
                setTimeout(() => this.processQueue(), CONFIG.API.MIN_INTERVAL - timeSinceLast);
                return;
            }

            // Execute request
            const request = this.requestQueue.shift();
            this.activeRequests++;
            this.lastRequestTime = Date.now();

            try {
                console.debug(`📡 API Request for: ${request.screenName}`);
                const result = await this.executeApiCall(request.screenName);
                this.cache.set(request.screenName, result);
                request.resolve(result);
            } catch (error) {
                console.warn(`❌ API Error for ${request.screenName}:`, error.message);
                request.reject(error);
            } finally {
                this.activeRequests--;
                this.processQueue();
            }
        }

        async executeApiCall(screenName) {
            let headers = this.headers;

            if (!headers) {
                // Try fallback
                headers = this.getFallbackHeaders();

                if (!headers) {
                    // Wait for headers
                    await new Promise(r => setTimeout(r, 2000));
                    headers = this.headers || this.getFallbackHeaders();
                    if (!headers) throw new Error('No API headers captured');
                } else {
                    console.log('⚠️ Using fallback headers');
                }
            }

            const variables = encodeURIComponent(JSON.stringify({ screenName }));
            const url = `https://x.com/i/api/graphql/${CONFIG.API.QUERY_ID}/AboutAccountQuery?variables=${variables}`;

            const requestHeaders = { ...headers };
            // Force English for consistent country names
            requestHeaders['accept-language'] = 'en-US,en;q=0.9';

            const response = await fetch(url, {
                headers: requestHeaders,
                method: 'GET',
                mode: 'cors',
                credentials: 'include'
            });

            if (!response.ok) {
                if (response.status === 429) {
                    const reset = response.headers.get('x-rate-limit-reset');
                    this.rateLimitReset = reset ? parseInt(reset) * 1000 : Date.now() + 60000;
                    const waitMinutes = Math.ceil((this.rateLimitReset - Date.now()) / 60000);
                    console.warn(`⚠️ X API rate limit reached. Waiting ${waitMinutes} minute(s) before retrying...`);
                    throw new Error('Rate limited');
                }
                throw new Error(`API Error: ${response.status}`);
            }

            const data = await response.json();
            const profile = data?.data?.user_result_by_screen_name?.result?.about_profile;

            return {
                location: profile?.account_based_in || null,
                device: profile?.source || null,
                locationAccurate: profile?.location_accurate !== false // Default to true if not present
            };
        }

        /**
         * UI & DOM Manipulation
         */
        injectStyles() {
            if (document.getElementById(CONFIG.STYLES.SHIMMER_ID)) return;

            const style = document.createElement('style');
            style.id = CONFIG.STYLES.SHIMMER_ID;
            style.textContent = `
                @keyframes x-shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
                .x-flag-shimmer {
                    display: inline-block; width: 20px; height: 16px; margin: 0 4px; vertical-align: middle;
                    border-radius: 2px;
                    background: linear-gradient(90deg, rgba(113,118,123,0.2) 25%, rgba(113,118,123,0.4) 50%, rgba(113,118,123,0.2) 75%);
                    background-size: 200% 100%;
                    animation: x-shimmer 1.5s infinite;
                }
                .x-info-badge {
                    margin: 0 4px 0 8px; display: inline-flex; align-items: center; vertical-align: middle; gap: 4px;
                    font-family: "Twemoji Mozilla", "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji", "EmojiOne Color", "Android Emoji", sans-serif;
                    font-size: 14px; opacity: 0.8; transition: all 0.2s; cursor: help;
                }
                .x-info-badge:hover { opacity: 1; transform: scale(1.1); }
                
                /* Country Blocker Modal Styles */
                .x-blocker-modal-overlay {
                    position: fixed; top: 0; left: 0; right: 0; bottom: 0;
                    background: rgba(0, 0, 0, 0.4); z-index: 999999;
                    display: flex; align-items: center; justify-content: center;
                }
                .x-blocker-modal {
                    background: rgb(0, 0, 0); border-radius: 16px;
                    max-width: 600px; width: 90%; max-height: 90vh;
                    overflow: hidden; display: flex; flex-direction: column;
                    box-shadow: 0 0 40px rgba(255,255,255,0.1);
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                }
                .x-blocker-header {
                    padding: 16px 20px; border-bottom: 1px solid rgb(47, 51, 54);
                    display: flex; align-items: center; justify-content: space-between;
                }
                .x-blocker-title {
                    font-size: 20px; font-weight: 700; color: rgb(231, 233, 234);
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                }
                .x-blocker-close {
                    background: none; border: none; color: rgb(231, 233, 234);
                    cursor: pointer; padding: 8px; border-radius: 50%;
                    display: flex; align-items: center; justify-content: center;
                    transition: background 0.2s;
                }
                .x-blocker-close:hover { background: rgba(231, 233, 234, 0.1); }
                .x-blocker-body {
                    padding: 20px; overflow-y: auto; flex: 1;
                }
                .x-blocker-info {
                    color: rgb(113, 118, 123); font-size: 14px; margin-bottom: 16px;
                    line-height: 1.5;
                }
                .x-blocker-search {
                    width: 100%; padding: 12px 16px; border-radius: 24px;
                    background: rgb(32, 35, 39); border: 1px solid rgb(47, 51, 54);
                    color: rgb(231, 233, 234); font-size: 15px; margin-bottom: 16px;
                    outline: none; box-sizing: border-box;
                }
                .x-blocker-search:focus { border-color: rgb(29, 155, 240); }
                .x-blocker-countries {
                    display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
                    gap: 8px;
                }
                .x-country-item {
                    padding: 12px 16px; border-radius: 8px;
                    background: rgb(22, 24, 28); border: 1px solid rgb(47, 51, 54);
                    cursor: pointer; display: flex; align-items: center; gap: 12px;
                    transition: all 0.2s;
                }
                .x-country-item:hover { background: rgb(32, 35, 39); border-color: rgb(113, 118, 123); }
                .x-country-item.blocked {
                    background: rgba(244, 33, 46, 0.1); border-color: rgb(244, 33, 46);
                }
                .x-country-flag {
                    font-size: 24px; line-height: 1;
                    font-family: "Twemoji Mozilla", "Apple Color Emoji", "Segoe UI Emoji", sans-serif;
                }
                .x-country-name {
                    flex: 1; color: rgb(231, 233, 234); font-size: 15px;
                }
                .x-country-status {
                    font-size: 12px; color: rgb(244, 33, 46); font-weight: 600;
                }
                .x-blocker-footer {
                    padding: 16px 20px; border-top: 1px solid rgb(47, 51, 54);
                    display: flex; gap: 12px; justify-content: space-between;
                    align-items: center;
                }
                .x-blocker-stats {
                    color: rgb(113, 118, 123); font-size: 14px;
                }
                .x-blocker-btn {
                    padding: 10px 20px; border-radius: 24px; font-size: 15px;
                    font-weight: 600; cursor: pointer; transition: all 0.2s;
                    border: none;
                }
                .x-blocker-btn-primary {
                    background: rgb(29, 155, 240); color: white;
                }
                .x-blocker-btn-primary:hover { background: rgb(26, 140, 216); }
                .x-blocker-btn-secondary {
                    background: transparent; color: rgb(239, 243, 244);
                    border: 1px solid rgb(83, 100, 113);
                }
                .x-blocker-btn-secondary:hover { background: rgba(239, 243, 244, 0.1); }
                .x-tweet-blocked {
                    display: none !important;
                }
            `;
            document.head.appendChild(style);
        }

        getFlagEmoji(countryName) {
            if (!countryName) return null;
            const emoji = COUNTRY_FLAGS[countryName.trim().toLowerCase()] || '🌍';

            // Check if we are on Windows (which doesn't support flag emojis)
            const isWindows = navigator.platform.indexOf('Win') > -1;

            if (isWindows && emoji !== '🌍') {
                // Convert emoji to Twemoji URL
                const codePoints = Array.from(emoji)
                    .map(c => c.codePointAt(0).toString(16))
                    .join('-');

                return `<img src="https://abs-0.twimg.com/emoji/v2/svg/${codePoints}.svg"
                        class="x-flag-emoji"
                        alt="${emoji}"
                        style="height: 1.2em; vertical-align: -0.2em;">`;
            }

            return emoji;
        }

        getDeviceEmoji(deviceString) {
            if (!deviceString) return null;
            const d = deviceString.toLowerCase();
            // App stores are always mobile
            if (d.includes('app store')) return '📱';
            // Explicit mobile devices
            if (d.includes('android') || d.includes('iphone') || d.includes('mobile')) return '📱';
            // Tablets treated as computers
            if (d.includes('ipad')) return '💻';
            // Desktop OS
            if (d.includes('mac') || d.includes('linux') || d.includes('windows')) return '💻';
            // Web clients
            if (d.includes('web')) return '🌐';
            // Unknown = assume mobile (more common than desktop for unknown strings)
            return '📱';
        }

        getDeviceCountry(deviceString) {
            if (!deviceString) return null;

            // Peel words off the end
            // until the prefix matches a known country. Web/unknown sources have
            // none, so we return null and let the caller fall back to location.
            const words = deviceString.trim().toLowerCase().split(/\s+/);
            for (let i = words.length; i > 0; i--) {
                const candidate = words.slice(0, i).join(' ');
                if (COUNTRY_FLAGS[candidate]) return candidate;
            }

            return null;
        }

        formatCountryName(country) {
            if (!country) return '';
            return country.split(' ')
                .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                .join(' ');
        }

        async processElement(element) {
            // Skip if already processed
            if (element.dataset.xProcessed) return;

            const screenName = this.extractUsername(element);
            if (!screenName) return;

            // Mark as processed immediately to prevent duplicates
            element.dataset.xProcessed = 'true';

            // Store username for later reference
            element.dataset.xScreenName = screenName;

            try {
                const info = await this.fetchUserInfo(screenName);

                // Check if country is blocked FIRST before adding any UI.
                // When flagFromDevice is on, the device country drives the
                // block (falling back to location for web/unknown sources)
                // so blocking matches the displayed flag.
                const effCountry = (this.flagFromDevice && info.device ? this.getDeviceCountry(info.device) : null) || info.location;
                if (effCountry) {
                    const countryLower = effCountry.trim().toLowerCase();
                    if (this.blockedCountries.has(countryLower)) {
                        this.hideTweet(element);
                        return; // Exit early - don't add any badges/shimmers
                    }
                }

                // Only add UI elements if NOT blocked
                const shimmer = document.createElement('span');
                shimmer.className = 'x-flag-shimmer';
                const insertionPoint = this.findInsertionPoint(element, screenName);
                if (insertionPoint) insertionPoint.target.insertBefore(shimmer, insertionPoint.ref);

                // Small delay for shimmer effect
                await new Promise(resolve => setTimeout(resolve, 100));
                shimmer.remove();

                if (info && (info.location || info.device)) {
                    const badge = document.createElement('span');
                    badge.className = 'x-info-badge';

                    let content = '';
                    // Optionally use the device's country for the flag, falling
                    // back to location for web/unknown sources.
                    const deviceCountry = this.flagFromDevice ? this.getDeviceCountry(info.device) : null;
                    const flagCountry = deviceCountry || info.location;
                    if (flagCountry) {
                        const flag = this.getFlagEmoji(flagCountry);
                        const flagLabel = deviceCountry ? this.formatCountryName(deviceCountry) : info.location;
                        if (flag) content += `<span title="${flagLabel}">${flag}</span>`;

                        // Add VPN/Proxy indicator if location is not accurate
                        if (info.locationAccurate === false) {
                            content += `<span title="Location may not be accurate (VPN/Proxy detected)">🔒</span>`;
                        }
                    }

                    const device = info.device;
                    if (device) {
                        const emoji = this.getDeviceEmoji(device);
                        content += `<span title="Connected via: ${device}">${emoji}</span>`;
                    }

                    badge.innerHTML = content;

                    // Re-find insertion point as DOM might have changed
                    const finalPoint = this.findInsertionPoint(element, screenName);
                    if (finalPoint) finalPoint.target.insertBefore(badge, finalPoint.ref);
                }
            } catch (e) {
                console.debug(`Failed to process ${screenName}`, e);
            }
        }

        hideTweet(element) {
            // Find the tweet article container
            const tweet = element.closest('article[data-testid="tweet"]');
            if (tweet) {
                tweet.classList.add('x-tweet-blocked');
            }
        }

        extractUsername(element) {
            // 1. Try to find the username link (Timeline/Feed)
            const link = element.querySelector('a[href^="/"]');
            if (link) {
                const href = link.getAttribute('href');
                const match = href.match(/^\/([^/]+)$/);
                if (match) {
                    const username = match[1];
                    const invalid = ['home', 'explore', 'notifications', 'messages', 'search', 'settings'];
                    if (!invalid.includes(username)) return username;
                }
            }

            // 2. Profile Header Case (Username is text, not a link)
            // Look for text starting with @
            const textNodes = Array.from(element.querySelectorAll('span, div[dir="ltr"]'));
            for (const node of textNodes) {
                const text = node.textContent.trim();
                if (text.startsWith('@') && text.length > 1) {
                    const username = text.substring(1);
                    // Basic validation to ensure it's a username and not just random text
                    if (/^[a-zA-Z0-9_]+$/.test(username)) {
                        return username;
                    }
                }
            }

            return null;
        }

        findInsertionPoint(container, screenName) {
            // 1. Profile Header Specific Logic
            // The profile header has a specific structure where the name and handle are in separate rows
            // We want to target the first row (Display Name)

            // Check if this is likely a profile header (no timestamp link, large text)
            const isProfileHeader = !container.querySelector('time') && container.querySelector('[data-testid="userFollowIndicator"]') !== null ||
                (container.getAttribute('data-testid') === 'UserName' && container.className.includes('r-14gqq1x'));

            if (isProfileHeader) {
                // Find the display name container (first div[dir="ltr"])
                const nameContainer = container.querySelector('div[dir="ltr"]');
                if (nameContainer) {
                    // We want to append to this container, so the flag sits inline with the name/badge
                    // But we need to be careful not to break the flex layout if it exists
                    // The name container usually has spans inside. We want to insert after the last span.
                    const lastSpan = nameContainer.querySelector('span:last-child');
                    if (lastSpan) {
                        return { target: lastSpan.parentNode, ref: null }; // Append to end of name container
                    }
                    return { target: nameContainer, ref: null };
                }
            }

            // 2. Timeline/Feed Case
            // Look for the handle (@username)
            const links = Array.from(container.querySelectorAll('a'));
            const handleLink = links.find(l => l.textContent.trim().toLowerCase() === `@${screenName.toLowerCase()}`);

            if (handleLink) {
                // Insert after the handle
                return { target: handleLink.parentNode.parentNode, ref: handleLink.parentNode.nextSibling };
            }

            // 3. Fallback: Try to find the name container via href
            const nameLink = container.querySelector(`a[href="/${screenName}"]`);
            if (nameLink) {
                return { target: nameLink.parentNode, ref: nameLink.nextSibling };
            }

            return null;
        }

        startObserver() {
            this.observer = new MutationObserver((mutations) => {
                if (!this.isEnabled) return;

                for (const m of mutations) {
                    m.addedNodes.forEach(node => {
                        if (node.nodeType === 1) { // Element
                            // Check if the node itself is a username
                            if (node.matches && node.matches(CONFIG.SELECTORS.USERNAME)) {
                                this.processElement(node);
                            }
                            // Check descendants
                            const elements = node.querySelectorAll(CONFIG.SELECTORS.USERNAME);
                            elements.forEach(el => this.processElement(el));
                        }
                    });
                }
            });

            this.observer.observe(document.body, { childList: true, subtree: true });
            this.scanPage(); // Initial scan
        }

        scanPage() {
            const elements = document.querySelectorAll(CONFIG.SELECTORS.USERNAME);
            elements.forEach(el => this.processElement(el));
        }

        /**
         * Sidebar & Modal UI
         */
        injectSidebarLink() {
            // Wait for sidebar to load
            const checkSidebar = setInterval(() => {
                // Try multiple selectors to be language-agnostic
                let nav = document.querySelector('nav[aria-label="Primary"]'); // English

                // Fallback: look for nav with role="navigation" that contains profile link
                if (!nav) {
                    const allNavs = document.querySelectorAll('nav[role="navigation"]');
                    for (const n of allNavs) {
                        if (n.querySelector('[data-testid="AppTabBar_Profile_Link"]')) {
                            nav = n;
                            break;
                        }
                    }
                }

                // Additional fallback: look for header > div > nav structure
                if (!nav) {
                    const headers = document.querySelectorAll('header');
                    for (const header of headers) {
                        const n = header.querySelector('nav');
                        if (n && n.querySelector('[data-testid="AppTabBar_Profile_Link"]')) {
                            nav = n;
                            break;
                        }
                    }
                }

                if (nav) {
                    clearInterval(checkSidebar);
                    console.log('✅ Sidebar navigation found, adding Block Countries link');
                    this.addBlockerLink(nav);
                } else {
                    console.debug('⏳ Waiting for sidebar navigation...');
                }
            }, 500);

            // Stop after 10 seconds if not found
            setTimeout(() => {
                clearInterval(checkSidebar);
                console.warn('⚠️ Sidebar navigation not found after 10 seconds');
            }, 10000);
        }

        addBlockerLink(nav) {
            // Check if already added
            if (document.getElementById('x-country-blocker-link')) return;

            // Find the Profile link to insert after it
            const profileLink = nav.querySelector('[data-testid="AppTabBar_Profile_Link"]');
            if (!profileLink) return;

            const link = document.createElement('a');
            link.id = 'x-country-blocker-link';
            link.href = '#';
            link.setAttribute('role', 'link');
            link.className = profileLink.className;
            link.setAttribute('aria-label', 'Block Countries');

            link.innerHTML = `
                <div class="css-175oi2r r-sdzlij r-dnmrzs r-1awozwy r-18u37iz r-1777fci r-xyw6el r-o7ynqc r-6416eg">
                    <div class="css-175oi2r">
                        <svg viewBox="0 0 24 24" aria-hidden="true" class="r-4qtqp9 r-yyyyoo r-dnmrzs r-bnwqim r-lrvibr r-m6rgpd r-1nao33i r-lwhw9o r-cnnz9e">
                            <g><path d="M12 2L4 5v6.09c0 5.05 3.41 9.76 8 10.91 4.59-1.15 8-5.86 8-10.91V5l-8-3zm6 9.09c0 4-2.55 7.7-6 8.83-3.45-1.13-6-4.82-6-8.83V6.31l6-2.12 6 2.12v4.78z"></path></g>
                        </svg>
                    </div>
                    <div dir="ltr" class="css-146c3p1 r-dnmrzs r-1udh08x r-1udbk01 r-3s2u2q r-bcqeeo r-1ttztb7 r-qvutc0 r-37j5jr r-adyw6z r-135wba7 r-16dba41 r-dlybji r-nazi8o" style="color: rgb(231, 233, 234);">
                        <span class="css-1jxf684 r-bcqeeo r-1ttztb7 r-qvutc0 r-poiln3">Block Countries</span>
                        <span class="css-1jxf684 r-bcqeeo r-1ttztb7 r-qvutc0 r-poiln3"> </span>
                    </div>
                </div>
            `;

            link.addEventListener('click', (e) => {
                e.preventDefault();
                this.showBlockerModal();
            });

            // Insert after profile link
            profileLink.parentElement.insertBefore(link, profileLink.nextSibling);
        }

        showBlockerModal() {
            // Create overlay
            const overlay = document.createElement('div');
            overlay.className = 'x-blocker-modal-overlay';

            // Create modal
            const modal = document.createElement('div');
            modal.className = 'x-blocker-modal';

            // Create header
            const header = document.createElement('div');
            header.className = 'x-blocker-header';
            header.innerHTML = `
                <h2 class="x-blocker-title">
                    <svg viewBox="0 0 24 24" width="24" height="24" style="display: inline-block; vertical-align: middle; margin-right: 8px;">
                        <g><path fill="currentColor" d="M12 2L4 5v6.09c0 5.05 3.41 9.76 8 10.91 4.59-1.15 8-5.86 8-10.91V5l-8-3zm6 9.09c0 4-2.55 7.7-6 8.83-3.45-1.13-6-4.82-6-8.83V6.31l6-2.12 6 2.12v4.78zm-9-1.04l-1.41 1.41L10.5 14.5l6-6-1.41-1.41-4.59 4.58z"></path></g>
                    </svg>
                    Block Countries
                </h2>
                <button class="x-blocker-close" aria-label="Close">
                    <svg viewBox="0 0 24 24" width="20" height="20">
                        <g><path fill="currentColor" d="M10.59 12L4.54 5.96l1.42-1.42L12 10.59l6.04-6.05 1.42 1.42L13.41 12l6.05 6.04-1.42 1.42L12 13.41l-6.04 6.05-1.42-1.42L10.59 12z"></path></g>
                    </svg>
                </button>
            `;

            // Create body
            const body = document.createElement('div');
            body.className = 'x-blocker-body';

            const info = document.createElement('div');
            info.className = 'x-blocker-info';
            info.textContent = 'Select countries to block. Tweets from users in these countries will be hidden from your feed.';

            const search = document.createElement('input');
            search.type = 'text';
            search.className = 'x-blocker-search';
            search.placeholder = 'Search countries...';

            const countriesContainer = document.createElement('div');
            countriesContainer.className = 'x-blocker-countries';

            body.appendChild(info);
            body.appendChild(search);
            body.appendChild(countriesContainer);

            // Create footer
            const footer = document.createElement('div');
            footer.className = 'x-blocker-footer';

            const stats = document.createElement('div');
            stats.className = 'x-blocker-stats';
            const updateStats = () => {
                stats.textContent = `${this.blockedCountries.size} countries blocked`;
            };
            updateStats();

            const btnContainer = document.createElement('div');
            btnContainer.style.display = 'flex';
            btnContainer.style.gap = '12px';

            const clearBtn = document.createElement('button');
            clearBtn.className = 'x-blocker-btn x-blocker-btn-secondary';
            clearBtn.textContent = 'Clear All';
            clearBtn.addEventListener('click', () => {
                this.blockedCountries.clear();
                this.saveBlockedCountries();
                renderCountries();
                updateStats();

                // Smart clear: only update already-processed tweets (no new API calls)
                document.querySelectorAll('[data-x-processed][data-x-screen-name]').forEach(el => {
                    const screenName = el.dataset.xScreenName;
                    const cachedInfo = this.cache.get(screenName);
                    if (!cachedInfo) return;

                    const tweet = el.closest('article[data-testid="tweet"]');

                    // Unhide tweet if it was blocked
                    if (tweet && tweet.classList.contains('x-tweet-blocked')) {
                        tweet.classList.remove('x-tweet-blocked');
                    }

                    // Re-add badge if it's missing and user has location/device
                    if (!el.querySelector('.x-info-badge') && (cachedInfo.location || cachedInfo.device)) {
                        const badge = document.createElement('span');
                        badge.className = 'x-info-badge';

                        let content = '';
                        const deviceCountry = this.flagFromDevice ? this.getDeviceCountry(cachedInfo.device) : null;
                        const flagCountry = deviceCountry || cachedInfo.location;
                        if (flagCountry) {
                            const flag = this.getFlagEmoji(flagCountry);
                            const flagLabel = deviceCountry ? this.formatCountryName(deviceCountry) : cachedInfo.location;
                            if (flag) content += `<span title="${flagLabel}">${flag}</span>`;

                            // Add VPN/Proxy indicator if location is not accurate
                            if (cachedInfo.locationAccurate === false) {
                                content += `<span title="Location may not be accurate (VPN/Proxy detected)">🔒</span>`;
                            }
                        }
                        if (cachedInfo.device) {
                            const emoji = this.getDeviceEmoji(cachedInfo.device);
                            content += `<span title="Connected via: ${cachedInfo.device}">${emoji}</span>`;
                        }

                        badge.innerHTML = content;
                        const insertionPoint = this.findInsertionPoint(el, screenName);
                        if (insertionPoint) insertionPoint.target.insertBefore(badge, insertionPoint.ref);
                    }
                });
            });

            const doneBtn = document.createElement('button');
            doneBtn.className = 'x-blocker-btn x-blocker-btn-primary';
            doneBtn.textContent = 'Done';
            doneBtn.addEventListener('click', () => {
                overlay.remove();
            });

            btnContainer.appendChild(clearBtn);
            btnContainer.appendChild(doneBtn);
            footer.appendChild(stats);
            footer.appendChild(btnContainer);

            // Assemble modal
            modal.appendChild(header);
            modal.appendChild(body);
            modal.appendChild(footer);
            overlay.appendChild(modal);

            // Render countries list
            const renderCountries = (filter = '') => {
                countriesContainer.innerHTML = '';

                const countries = Object.keys(COUNTRY_FLAGS)
                    .filter(country => country.includes(filter.toLowerCase()))
                    .sort();

                countries.forEach(country => {
                    const item = document.createElement('div');
                    item.className = 'x-country-item';
                    const isBlocked = this.blockedCountries.has(country);
                    if (isBlocked) item.classList.add('blocked');

                    const flag = this.getFlagEmoji(country);
                    const flagSpan = document.createElement('span');
                    flagSpan.className = 'x-country-flag';
                    if (typeof flag === 'string' && flag.startsWith('<img')) {
                        flagSpan.innerHTML = flag;
                    } else {
                        flagSpan.textContent = flag || '🌍';
                    }

                    const name = document.createElement('span');
                    name.className = 'x-country-name';
                    // Proper title case: capitalize each word
                    name.textContent = country.split(' ').map(word =>
                        word.charAt(0).toUpperCase() + word.slice(1)
                    ).join(' ');

                    const status = document.createElement('span');
                    status.className = 'x-country-status';
                    status.textContent = isBlocked ? 'BLOCKED' : '';

                    item.appendChild(flagSpan);
                    item.appendChild(name);
                    item.appendChild(status);

                    item.addEventListener('click', () => {
                        const wasBlocked = this.blockedCountries.has(country);

                        if (wasBlocked) {
                            this.blockedCountries.delete(country);
                        } else {
                            this.blockedCountries.add(country);
                        }
                        this.saveBlockedCountries();
                        renderCountries(filter);
                        updateStats();

                        // Smart update: only process cached tweets (NO API CALLS)
                        document.querySelectorAll('[data-x-processed][data-x-screen-name]').forEach(el => {
                            const screenName = el.dataset.xScreenName;
                            const cachedInfo = this.cache.get(screenName);
                            if (!cachedInfo || !cachedInfo.location) return;

                            const countryLower = cachedInfo.location.trim().toLowerCase();
                            const tweet = el.closest('article[data-testid="tweet"]');

                            if (countryLower === country) {
                                // This tweet's country was toggled
                                if (wasBlocked) {
                                    // Unblocking: show tweet and add badge
                                    if (tweet) tweet.classList.remove('x-tweet-blocked');

                                    // Add badge if not present (using cached data only)
                                    if (!el.querySelector('.x-info-badge')) {
                                        const badge = document.createElement('span');
                                        badge.className = 'x-info-badge';

                                        let content = '';
                                        const deviceCountry = this.flagFromDevice ? this.getDeviceCountry(cachedInfo.device) : null;
                                        const flagCountry = deviceCountry || cachedInfo.location;
                                        if (flagCountry) {
                                            const flag = this.getFlagEmoji(flagCountry);
                                            const flagLabel = deviceCountry ? this.formatCountryName(deviceCountry) : cachedInfo.location;
                                            if (flag) content += `<span title="${flagLabel}">${flag}</span>`;

                                            // Add VPN/Proxy indicator if location is not accurate
                                            if (cachedInfo.locationAccurate === false) {
                                                content += `<span title="Location may not be accurate (VPN/Proxy detected)">🔒</span>`;
                                            }
                                        }
                                        if (cachedInfo.device) {
                                            const emoji = this.getDeviceEmoji(cachedInfo.device);
                                            content += `<span title="Connected via: ${cachedInfo.device}">${emoji}</span>`;
                                        }

                                        badge.innerHTML = content;
                                        const insertionPoint = this.findInsertionPoint(el, screenName);
                                        if (insertionPoint) insertionPoint.target.insertBefore(badge, insertionPoint.ref);
                                    }
                                } else {
                                    // Blocking: hide tweet and remove badge
                                    if (tweet) tweet.classList.add('x-tweet-blocked');
                                    const badge = el.querySelector('.x-info-badge');
                                    if (badge) badge.remove();
                                }
                            }
                        });
                    });

                    countriesContainer.appendChild(item);
                });
            };

            renderCountries();

            // Search functionality
            search.addEventListener('input', (e) => {
                renderCountries(e.target.value);
            });

            // Close button
            header.querySelector('.x-blocker-close').addEventListener('click', () => {
                overlay.remove();
            });

            // Close on overlay click
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) {
                    overlay.remove();
                }
            });

            // Add to page
            document.body.appendChild(overlay);
        }

        /**
         * Public API
         */
        getCacheInfo() {
            const entries = Array.from(this.cache.entries()).map(([key, value]) => ({
                key,
                value
            }));
            return { size: this.cache.size, entries };
        }

        exposeAPI() {
            const api = {
                clearCache: () => {
                    this.cache.clear();
                    localStorage.removeItem(CONFIG.CACHE_KEY);
                    console.log('🧹 Cache cleared');
                },
                getCacheInfo: () => {
                    const info = this.getCacheInfo();
                    console.log('Cache info:', info);
                    return info;
                },
                toggle: () => {
                    this.isEnabled = !this.isEnabled;
                    localStorage.setItem('x_location_enabled', this.isEnabled);
                    console.log(`Extension ${this.isEnabled ? 'enabled' : 'disabled'}`);
                },
                toggleFlagFromDevice: () => {
                    this.flagFromDevice = !this.flagFromDevice;
                    localStorage.setItem('x_flag_from_device', this.flagFromDevice);
                    console.log(`Flag source: ${this.flagFromDevice ? 'device (fallback to location)' : 'location'}`);
                },
                debug: () => {
                    console.log('Cache Size:', this.cache.size);
                    console.log('Queue Length:', this.requestQueue.length);
                    console.log('Active Requests:', this.activeRequests);
                    console.log('Blocked Countries:', Array.from(this.blockedCountries));
                },
                openBlocker: () => {
                    this.showBlockerModal();
                },
                getBlockedCountries: () => {
                    return Array.from(this.blockedCountries);
                }
            };

            if (typeof cloneInto === 'function') {
                unsafeWindow.XFlagScript = cloneInto(api, unsafeWindow, { cloneFunctions: true });
            } else {
                unsafeWindow.XFlagScript = api;
            }
        }
    }

    // Instantiate
    new XLocationPatcher();

})();