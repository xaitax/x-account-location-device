/**
 * Content Script (ISOLATED World)
 * Main entry point - handles initialization, state management, and message coordination
 * Orchestrates UI and Observer modules
 */

import browserAPI from '../shared/browser-api.js';
import { MESSAGE_TYPES, CSS_CLASSES, SELECTORS, VERSION, affiliationWasChecked } from '../shared/constants.js';

// Import modules
import {
    detectAndApplyTheme,
    startThemeObserver,
    injectSidebarLink,
    removeSidebarLink,
    syncSidebarSettings,
    cleanupUI,
    showToast
} from './ui.js';

import {
    startObserver,
    scanPage,
    processElementsBatch,
    processElement,
    createProcessElementSafe,
    updateBlockedTweets,
    resetProcessedElements,
    setupQuoteReveal,
    setFilterStatisticsReporter,
    effectiveCountry,
    cleanupObservers,
    userInfoCache
} from './observer.js';

import { hovercard, hasNewerObservation } from './hovercard.js';
import { glyph } from './icons.js';
import { setProfile, getProfile, clearProfiles, profileCount } from './profile-cache.js';
import { PROFILE_LIMITS, profilePatchFromWire } from '../shared/profile-data.js';
import { FOLLOWING_LIMITS, readFollowingViewer } from '../shared/following-data.js';
import { configureFollowing, getFollowingContext, mergeFollowingBatch, clearFollowing } from './following-cache.js';
import { syncModalState, syncModalSettings, closeModal } from './modal.js';
import { cleanupEvidenceCapture } from './evidence-capture.js';
import { FILTER_SOURCES } from '../shared/filter-registry.js';
import { createLifecycle } from '../shared/lifecycle.js';
import { createSnapshotTracker } from '../shared/state-sync.js';
import { createFilterStatisticsReporter } from './filter-statistics.js';
import { ACCOUNT_COUNT_FILTERS, isAccountCountThreshold, matchesAccountCount } from '../shared/account-counts.js';

// ============================================
// STATE
// ============================================

// Do not start lookups until the persisted enabled preference is known.
let isEnabled = false;
const filterSets = Object.fromEntries(FILTER_SOURCES.map(source => [source.field, new Set()]));
let settings = {};
let settingsLoaded = false;
const stateSnapshots = createSnapshotTracker();
const STATE_MUTATION_UPDATES = {
    [MESSAGE_TYPES.SET_SETTINGS]: MESSAGE_TYPES.SETTINGS_UPDATED,
    ...Object.fromEntries(FILTER_SOURCES.map(source => [source.set, source.update]))
};
const FILTER_UPDATES = new Map(FILTER_SOURCES.map(source => [source.update, source]));
let csrfToken = null;
let debugMode = false;

// Cleanup tracking
let session = null;
let isCleanedUp = false;
let filterStatisticsReporter = null;
let syncFollowingMonitor = () => {};
const cancelledResponse = () => ({ success: false, code: 'CANCELLED', error: 'Page session ended' });

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

function fetchUserInfoViaPage(screenName) {
    const current = session;
    if (!current || current.disposed) return Promise.resolve(cancelledResponse());
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return new Promise(resolve => {
        let settled = false;
        let cancelTimer = () => {};
        let removeListener = () => {};
        let forget = () => {};
        const finish = result => {
            if (settled) return;
            settled = true;
            cancelTimer();
            removeListener();
            forget();
            resolve(result);
        };
        removeListener = current.listen(window, 'x-posed-fetch-user-info-result', event => {
            let result;
            try { result = JSON.parse(event.detail || '{}'); } catch { return; }
            if (result.id === id) finish(result);
        });
        cancelTimer = current.delay(() => finish({
            success: false, code: 'TIMEOUT', error: 'Timed out waiting for page fetch'
        }), 10000);
        forget = current.add(() => finish(cancelledResponse()));
        window.dispatchEvent(new CustomEvent('x-posed-fetch-user-info', {
            detail: JSON.stringify({ id, screenName })
        }));
    });
}

// ============================================
// MESSAGING
// ============================================

/**
 * Send message to background script
 */
async function sendMessage(message) {
    const current = session;
    if (!current || current.disposed) return cancelledResponse();
    try {
        const response = await browserAPI.runtime.sendMessage(message);
        if (current.disposed) return cancelledResponse();
        const updateType = STATE_MUTATION_UPDATES[message.type];
        if (response?.success && updateType) {
            await handleBackgroundMessage(updateType, response.data, response.revision);
        }
        return response;
    } catch (error) {
        console.error('Message send error:', error);
        return { success: false, error: error.message, code: 'NETWORK_ERROR' };
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
 * Fallback injection of the MAIN-world page script.
 *
 * The manifest registers page-script.js as a `world: "MAIN"` content script at
 * document_start, which is what normally installs it: the browser guarantees that runs
 * before any of X's own scripts. This appends it a second way, and matters because a
 * <script src> load is asynchronous — X's bundle keeps running while it fetches, so a
 * request issued in that window is missed. That is invisible on the timeline, where
 * HomeTimeline fires again on every scroll, but a profile issues UserByScreenName exactly
 * once, so losing that race means no bio, account type or counts for that profile at all.
 *
 * page-script.js short-circuits on window.__X_POSED_INJECTED__, so whichever path lands
 * first wins and the other is a no-op.
 */
function injectPageScript(current) {
    const scriptUrl = browserAPI.runtime.getURL('page-script.js');
    
    const script = document.createElement('script');
    script.src = scriptUrl;
    current.add(() => script.remove());
    script.onload = function() {
        this.remove();
    };
    
    (document.head || document.documentElement).appendChild(script);
}

/**
 * Listen for events from page script
 */
function setupPageScriptListener(current) {
    current.listen(window, 'x-posed-headers-captured', async event => {
        let headers;
        try {
            ({ headers } = JSON.parse(event.detail || '{}'));
        } catch {
            return;
        }

        if (!headers) return;
        debug('Headers captured from page script');
        
        const response = await sendMessage({
            type: MESSAGE_TYPES.CAPTURE_HEADERS,
            payload: { headers }
        });

        if (response?.success && memoizedScanPageFn) {
            current.delay(() => memoizedScanPageFn?.(), 250);
        }
    });
}

/**
 * Drop cached user info that was never checked for an affiliation, then re-process the
 * page so those rows are resolved again.
 *
 * Entries whose meta carries an `affiliateUsername` key were produced by a parser that
 * actually inspected the affiliation, so "no affiliate" on them is a real answer and they
 * are kept (same contract as wantsRicherRecord in the service worker). Everything
 * else is genuinely unknown and has to be refetched, otherwise adding an affiliation
 * appears to do nothing until the cache expires.
 */
function reprocessRowsMissingAffiliation() {
    let dropped = 0;
    for (const [screenName, info] of userInfoCache.entries()) {
        if (info && !affiliationWasChecked(info.meta)) {
            userInfoCache.delete(screenName);
            dropped++;
        }
    }
    debug(`Affiliation filter changed: dropped ${dropped} cache entries with no affiliation data`);

    // Same teardown the settings-change path uses: a hidden row has no layout box, so the
    // IntersectionObserver would never report it visible and it could never re-process.
    // Un-hide and un-mark everything first, then let the rescan re-derive each row.
    resetProcessedElements(currentFilters());

    if (memoizedScanPageFn) memoizedScanPageFn();
}

/**
 * Snapshot of every filter, passed as one object so a new filter can't be mis-ordered
 * into the wrong parameter slot.
 */
function currentFilters() {
    return { ...filterSets, settings };
}

/**
 * Tell the page script whether to read profile data out of X's own responses.
 * Sent on page-script ready and whenever the setting changes, so the kill switch takes
 * effect immediately rather than at the next reload.
 */
function syncEnrichmentSetting() {
    window.dispatchEvent(new CustomEvent('x-posed-set-enrichment', {
        detail: JSON.stringify({ enabled: settingsLoaded && isEnabled && settings.profileEnrichment !== false })
    }));
}

/** Follow relationships are a separate opt-in, never public profile enrichment. */
function syncFollowingSetting(force = false) {
    const enabled = settingsLoaded && isEnabled && !isCleanedUp && settings.alwaysShowFollowing === true;
    const previous = getFollowingContext();
    const context = configureFollowing(enabled, enabled ? readFollowingViewer() : null);
    const changed = previous.generation !== context.generation;
    syncFollowingMonitor(enabled);
    if (changed || force) {
        window.dispatchEvent(new CustomEvent('x-posed-set-following', { detail: JSON.stringify(context) }));
        // Clearing the old viewer must also remove any already-rendered exemptions.
        if (changed && isEnabled && !isCleanedUp) updateBlockedTweets(currentFilters());
    }
}

function setupFollowingListener(current) {
    current.listen(window, 'x-posed-page-ready', () => syncFollowingSetting(true));
    current.listen(window, 'x-posed-following-reset', () => {
        if (current.disposed || !settingsLoaded || !isEnabled || settings.alwaysShowFollowing !== true) return;
        clearFollowing();
        syncFollowingSetting(true);
        // Identity may now be unknown, leaving configureFollowing disabled. Even
        // then, clear exemptions already painted for the former viewer.
        updateBlockedTweets(currentFilters());
    });
    current.listen(window, 'x-posed-following', event => {
        if (current.disposed || !settingsLoaded || !isEnabled || settings.alwaysShowFollowing !== true) return;
        syncFollowingSetting();
        if (typeof event.detail !== 'string' || event.detail.length > FOLLOWING_LIMITS.MAX_RELAY_LENGTH) return;
        let batch;
        try { batch = JSON.parse(event.detail); } catch { return; }
        const changed = mergeFollowingBatch(batch);
        if (changed.size) updateBlockedTweets(currentFilters(), changed);
    });

    // Sidebar changes cover the DOM identity fallback. Cookie/account changes can
    // also happen in another tab, without changing this tab's sidebar at all.
    const checkViewer = () => {
        if (!current.disposed && settings.alwaysShowFollowing === true) syncFollowingSetting();
    };
    const watchSidebar = new MutationObserver(checkViewer);
    current.listen(window, 'focus', checkViewer);
    current.listen(document, 'visibilitychange', checkViewer);
    let monitoring = false;
    let cancelPoll = () => {};
    const pollViewer = () => {
        if (!monitoring || current.disposed) return;
        checkViewer();
        if (monitoring) cancelPoll = current.delay(pollViewer, 1000);
    };
    syncFollowingMonitor = enabled => {
        if (monitoring === enabled) return;
        monitoring = enabled;
        if (enabled) {
            watchSidebar.observe(document.documentElement || document, {
                subtree: true, childList: true, attributes: true, attributeFilter: ['href']
            });
            cancelPoll = current.delay(pollViewer, 1000);
        } else {
            watchSidebar.disconnect();
            cancelPoll();
        }
    };
    current.add(() => {
        syncFollowingMonitor(false);
        syncFollowingMonitor = () => {};
    });
    current.add(clearFollowing);
}

/** A fresh snapshot for UI consumers; never capture a Set at sidebar creation. */
function getBlockingState() {
    return {
        ...Object.fromEntries(FILTER_SOURCES.map(source => [source.field, [...filterSets[source.field]]])),
        settings: { ...settings },
        stateRevisions: stateSnapshots.snapshot()
    };
}

/**
 * Receive the profile data the page script harvested from X's timeline responses.
 *
 * This costs no API call — X already sent it. Everything lands in a bounded, session-only
 * cache (see profile-cache.js for the memory contract); nothing here is persisted or
 * contributed to the community cache, because bios are personal free text and follower
 * counts are stale within minutes.
 */
function setupProfileListener(current) {
    const onReady = () => syncEnrichmentSetting();

    const onProfiles = event => {
        if (!settingsLoaded || !isEnabled || settings.profileEnrichment === false || isCleanedUp) return;
        // The page relay is an untrusted boundary. Bound decoding and iteration,
        // then let the profile cache validate individual fields.
        if (typeof event.detail !== 'string' || event.detail.length > PROFILE_LIMITS.MAX_RELAY_LENGTH) return;
        let users;
        try {
            ({ users } = JSON.parse(event.detail || '{}'));
        } catch {
            return;
        }
        if (!Array.isArray(users) || users.length === 0) return;

        const changedUsers = new Set();
        const hasProfileTextFilters = filterSets.blockedBioTags.size > 0 ||
            filterSets.blockedPcf.size > 0 || filterSets.blockedLinks.size > 0;
        const activeCounts = ACCOUNT_COUNT_FILTERS.filter(rule =>
            rule.requiresProfile && isAccountCountThreshold(settings[rule.key], rule.max) && settings[rule.key] > 0);
        for (const entry of users.slice(0, PROFILE_LIMITS.MAX_BATCH_ENTRIES)) {
            const profile = profilePatchFromWire(entry);
            if (!profile) continue;
            const previous = activeCounts.length ? getProfile(entry.u) : null;
            const textChanged = setProfile(entry.u, profile);
            const next = activeCounts.length ? getProfile(entry.u) : null;
            const countChanged = activeCounts.some(rule => {
                const previousCount = previous?.[rule.profileField];
                const nextCount = next?.[rule.profileField];
                // A newly known value also clears stale verdicts after LRU eviction.
                return (!isAccountCountThreshold(previousCount) && isAccountCountThreshold(nextCount)) ||
                    matchesAccountCount(previousCount, settings[rule.key]) !==
                    matchesAccountCount(nextCount, settings[rule.key]);
            });
            if ((hasProfileTextFilters && textChanged) || countChanged) changedUsers.add(entry.u.toLowerCase());
        }
        debug(`Harvested ${users.length} profile(s) from X's own response`);

        // Re-derive only affected authors. Count-only updates need a pass when an
        // active count becomes known or changes its verdict, not for every increment.
        // Coalesced by updateBlockedTweets, so a burst of scroll responses costs one pass.
        if (changedUsers.size > 0) {
            updateBlockedTweets(currentFilters(), changedUsers);
        }
    };

    current.listen(window, 'x-posed-page-ready', onReady);
    current.listen(window, 'x-posed-profiles', onProfiles);
    current.add(clearProfiles);
}

/**
 * Listen for messages from background script
 */
function setupBackgroundListener(current) {
    const messageHandler = (message, sender, sendResponse) => {
        const { type, payload, revision } = message;

        // Use proper async handling with error boundary
        handleBackgroundMessage(type, payload, revision)
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

    current.add(() => browserAPI.runtime.onMessage.removeListener(messageHandler));
}

/**
 * Issue #23: a badge can render from a stale cloud-cache snapshot while the hovercard's
 * (authoritative) live fetch returns fresher location/device or accuracy, so the badge
 * disagrees with the popup until the row happens to re-process. The hovercard dispatches
 * this event when it sees a difference; we refresh the warm local cache and re-render the
 * affected badges so the two stay in sync.
 */
function setupAuthoritativeInfoListener(current) {
    const onAuthoritativeInfo = event => {
        const { screenName, info } = event.detail || {};
        if (!screenName || !info) return;
        if (hasNewerObservation(userInfoCache.get(screenName), info)) return;

        // Adopt the authoritative data so future (re)processing uses it, then rebuild the
        // badges that are showing this user. Clearing the processed markers + re-running
        // processElement rebuilds the badge from the now-fresh cache (no new API call).
        userInfoCache.set(screenName, info);

        // Defer the DOM rebuild one microtask: this event is dispatched synchronously from
        // the hovercard mid-update, so removing the anchored badge now would yank the
        // hovercard's reposition target out from under it. Letting the hovercard finish
        // first keeps the open card from jumping.
        queueMicrotask(() => {
            if (current.disposed) return;
            const key = screenName.toLowerCase();
            // The hovercard also carries this account marker. Only X's observed
            // author roots may be reprocessed, never our own account-details UI.
            document.querySelectorAll(`${SELECTORS.USERNAME}[data-x-screen-name], ${SELECTORS.USER_CELL}[data-x-screen-name]`).forEach(el => {
                if ((el.dataset.xScreenName || '').toLowerCase() !== key) return;
                const badge = el.querySelector(`.${CSS_CLASSES.INFO_BADGE}`);
                const focusedControl = badge?.contains(document.activeElement)
                    ? document.activeElement.closest('.x-capture-btn') ? '.x-capture-btn' : '.x-badge-details'
                    : null;
                if (badge) badge.remove();
                delete el.dataset.xProcessed;
                delete el.dataset.xScreenName;
                if (memoizedProcessElementSafe) memoizedProcessElementSafe(el);
                // Warm-cache processing rebuilds synchronously. Retarget the same
                // open view, or close it if filtering deliberately removed the row.
                const replacement = el.querySelector(`.${CSS_CLASSES.INFO_BADGE}`);
                hovercard.replaceAnchor(badge, replacement, focusedControl);
                if (focusedControl && replacement?.isConnected && hovercard.currentAnchor !== replacement &&
                    (el.dataset.xScreenName || '').toLowerCase() === key) {
                    replacement.querySelector(focusedControl)?.focus({ preventScroll: true });
                }
            });
        });
    };

    current.listen(document, 'xposed:authoritative-info', onAuthoritativeInfo);
}

/**
 * Handle background messages with proper async/await and error handling
 * @param {string} type - Message type
 * @param {any} payload - Message payload
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function handleBackgroundMessage(type, payload, revision) {
    if (isCleanedUp) return cancelledResponse();
    if (type === MESSAGE_TYPES.FILTER_STATISTICS_RESET) {
        filterStatisticsReporter?.reset(payload?.epoch, payload?.revision ?? revision);
        return { success: true };
    }
    if (type !== MESSAGE_TYPES.SETTINGS_UPDATED && !FILTER_UPDATES.has(type)) {
        return { success: false, error: 'Unknown message type' };
    }
    if (type === MESSAGE_TYPES.SETTINGS_UPDATED) {
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { success: false };
    } else if (Object.values(STATE_MUTATION_UPDATES).includes(type) && !Array.isArray(payload)) {
        return { success: false };
    }
    if (revision !== undefined && stateSnapshots.snapshot()[type] === revision) return { success: true };
    if (!stateSnapshots.accept(type, revision)) return { success: true };
    const source = FILTER_UPDATES.get(type);
    if (source) {
        filterSets[source.field] = new Set(payload);
        syncModalState(source.kind, payload, revision);
        // Affiliation filters must re-check unknown cached evidence, not treat it as empty.
        if (source.kind === 'affiliations' && filterSets[source.field].size > 0) {
            reprocessRowsMissingAffiliation();
        } else {
            updateBlockedTweets(currentFilters());
        }
        return { success: true };
    }
    switch (type) {
        case MESSAGE_TYPES.SETTINGS_UPDATED: {
            const prevSettings = { ...settings };
            settings = payload;
            settingsLoaded = true;
            isEnabled = settings.enabled !== false;
            debugMode = settings.debugMode === true;
            debug('Settings updated:', settings);
            syncSidebarSettings(settings, revision);
            syncModalSettings(settings, revision);
            syncFollowingSetting();
            
            if (!isEnabled) {
                resetProcessedElements(currentFilters());
            } else {
                // Apply display/blocking toggles live to already-processed tweets, not
                // only to newly-loaded ones. Clearing the processed markers + re-scanning
                // re-derives badges AND block/highlight/VPN state from the warm local cache
                // (so no new API calls). showVpnUsers and highlightBlockedTweets are in
                // here because flipping them must recover rows hidden under the old value —
                // otherwise a re-enabled "Show VPN/Proxy Users" never un-hides what it hid.
                // showInfoIcon and hovercardTrigger are in here because both are baked into
                // the badge at creation time (the circled-i is a child node; the trigger is
                // the listener bound in hovercard.attach), so they only take effect once the
                // badge is rebuilt.
                const reapplyKeys = ['showFlags', 'flagFromDevice', 'showDevices', 'showVpnIndicator',
                    'showCaptureButton', 'showVpnUsers', 'highlightBlockedTweets',
                    'showInfoIcon', 'hovercardTrigger', 'badgeSize', 'showBadgeBackground'];
                if (prevSettings.enabled !== settings.enabled || reapplyKeys.some(k => prevSettings[k] !== settings[k])) {
                    // Includes quote markers: their hidden username children cannot
                    // reach the lazy rescan until the old collapse is released.
                    resetProcessedElements(currentFilters());
                    if (memoizedScanPageFn) memoizedScanPageFn();
                }
            }
            
            if (prevSettings.profileEnrichment !== settings.profileEnrichment || prevSettings.enabled !== settings.enabled) {
                syncEnrichmentSetting();
                if (!isEnabled || settings.profileEnrichment === false) clearProfiles();
            }
            if (isEnabled && ['profileEnrichment', 'bioTagsMatchLocation', 'linksMatchLocation',
                ...ACCOUNT_COUNT_FILTERS.map(rule => rule.key)]
                .some(key => prevSettings[key] !== settings[key])) {
                updateBlockedTweets(currentFilters());
            }

            if (prevSettings.showSidebarBlockerLink !== settings.showSidebarBlockerLink) {
                if (settings.showSidebarBlockerLink === false) {
                    removeSidebarLink(debug);
                } else {
                    injectSidebarLink(settings, debug, filterSets.blockedCountries, filterSets.blockedRegions, sendMessage, MESSAGE_TYPES, getBlockingState);
                }
            }
            return { success: true };
        }

        default:
            return { success: false, error: 'Unknown message type' };
    }
}

// ============================================
// INITIALIZATION
// ============================================

/**
 * After a "Share evidence" action opens X's composer in a new tab, this tab's
 * content script reminds the user that their evidence image is on the clipboard.
 * The flag (a timestamp) is written by evidence-capture just before window.open;
 * the post-share toast would otherwise fire on the now-background origin tab.
 */
async function maybeShowPasteHint(current) {
    try {
        const res = await browserAPI.storage.local.get('xpPasteHint');
        if (current.disposed) return;
        const t = res?.xpPasteHint;
        if (!t || Date.now() - t > 15000) return;
        await browserAPI.storage.local.remove('xpPasteHint');
        current.delay(() => {
            showToast({
                title: 'Evidence is on your clipboard',
                message: 'Press Ctrl / ⌘ + V to attach it to your post, then post.',
                icon: glyph('copy', 20),
                iconType: 'info',
                duration: 12000
            });
        }, 1200);
    } catch (_) { /* hint is best-effort */ }
}

/**
 * Initialize the content script
 */
async function initialize() {
    if (session && !session.disposed) return;
    const current = session = createLifecycle();
    isCleanedUp = false;
    settingsLoaded = false;
    isEnabled = false;
    console.log(`🚀 X-Posed v${VERSION} initializing...`);
    filterStatisticsReporter = createFilterStatisticsReporter({
        sendMessage: message => browserAPI.runtime.sendMessage(message),
        isEnabled: () => !current.disposed && isEnabled,
        getInfo: name => {
            const info = userInfoCache.get(name);
            return { location: effectiveCountry(info, settings.flagFromDevice), device: info?.device };
        }
    });
    setFilterStatisticsReporter(filterStatisticsReporter);
    
    try {
        // Set up listeners BEFORE injecting page script
        setupPageScriptListener(current);
        setupProfileListener(current);
        setupFollowingListener(current);
        setupBackgroundListener(current);
        setupAuthoritativeInfoListener(current);
        // "Click to show" on a collapsed quote card (issue #32). Must be bound in the
        // capture phase before X's own handlers, so bind it here at document_start.
        setupQuoteReveal();

        // Extract CSRF token
        csrfToken = getCsrfToken();
        
        // Inject page script for header interception
        injectPageScript(current);

        // Load every registered filter without maintaining a second positional list.
        const [settingsResponse, ...responses] = await Promise.all([
            sendMessage({ type: MESSAGE_TYPES.GET_SETTINGS }),
            ...FILTER_SOURCES.map(source => sendMessage({ type: source.get }))
        ]);
        if (current.disposed) return;
        if (settingsResponse?.success && stateSnapshots.accept(MESSAGE_TYPES.SETTINGS_UPDATED, settingsResponse.revision)) {
            settings = settingsResponse.data;
            settingsLoaded = true;
            isEnabled = settings.enabled !== false;
            debugMode = settings.debugMode === true;
        }
        FILTER_SOURCES.forEach((source, index) => {
            const response = responses[index];
            if (response?.success && Array.isArray(response.data) &&
                stateSnapshots.accept(source.update, response.revision)) {
                filterSets[source.field] = new Set(response.data);
            }
        });
        console.log(`✅ X-Posed initialized (enabled: ${isEnabled}, debug: ${debugMode})`);
        maybeShowPasteHint(current);
        // Ready can precede storage loading or follow it. Sending on both events
        // makes the persisted preference authoritative in either ordering.
        syncEnrichmentSetting();
        syncFollowingSetting(true);

        createMemoizedFunctions(current);
        // The manifest is the sole production owner of content stylesheets.
        // A restored page still has DOM markers from its previous session.
        resetProcessedElements(currentFilters());

        let readyWorkStarted = false;
        const startReadyWork = () => {
            if (current.disposed || readyWorkStarted) return;
            if (!document.body) {
                current.delay(startReadyWork, 100);
                return;
            }

            readyWorkStarted = true;
            startObserver(memoizedIsEnabledFn, memoizedProcessElementSafe, memoizedScanPageFn, debug, currentFilters);

            try {
                detectAndApplyTheme(debug);
                startThemeObserver();
            } catch (error) {
                console.error('X-Posed theme failed:', error);
            }

            try {
                injectSidebarLink(settings, debug, filterSets.blockedCountries, filterSets.blockedRegions, sendMessage, MESSAGE_TYPES, getBlockingState);
            } catch (error) {
                console.error('X-Posed sidebar failed:', error);
            }
        };

        if (document.readyState !== 'loading') {
            startReadyWork();
        } else {
            current.listen(document, 'DOMContentLoaded', startReadyWork, { once: true });
        }
    } catch (error) {
        if (current.disposed) return;
        cleanup();
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
function createMemoizedFunctions(current) {
    const context = {
        get settings() { return settings; },
        get csrfToken() { return csrfToken; },
        sendMessage: message => current.disposed ? Promise.resolve(cancelledResponse()) : sendMessage(message),
        fetchUserInfoViaPage: name => current.disposed ? Promise.resolve(cancelledResponse()) : fetchUserInfoViaPage(name),
        debug,
        get debugMode() { return debugMode; }
    };
    for (const source of FILTER_SOURCES) {
        Object.defineProperty(context, source.field, { enumerable: true, get: () => filterSets[source.field] });
    }
    memoizedProcessElementWithContext = element =>
        current.disposed ? Promise.resolve() : processElement(element, context);
    const processSafe = createProcessElementSafe(memoizedProcessElementWithContext);
    const enabled = () => !current.disposed && isEnabled;
    memoizedProcessElementSafe = processSafe;
    memoizedIsEnabledFn = enabled;
    memoizedScanPageFn = () => {
        if (!current.disposed) scanPage(enabled, elements => processElementsBatch(elements, processSafe, debug), debug);
    };
}

// ============================================
// CLEANUP
// ============================================

/**
 * Cleanup all resources. Safe to invoke more than once for the same page session.
 */
function cleanup() {
    if (isCleanedUp) return;
    filterStatisticsReporter?.dispose();
    filterStatisticsReporter = null;
    isCleanedUp = true;
    isEnabled = false;
    settingsLoaded = false;
    syncEnrichmentSetting();
    syncFollowingSetting(true);
    session?.dispose();

    cleanupEvidenceCapture();
    closeModal({ restoreFocus: false });
    cleanupUI();
    cleanupObservers();
    hovercard.teardown();
    memoizedProcessElementWithContext = null;
    memoizedProcessElementSafe = null;
    memoizedIsEnabledFn = null;
    memoizedScanPageFn = null;
}

// pagehide also covers BFCache. A restored document needs a fresh session and
// current settings, but keeps the already-installed MAIN-world transport.
window.addEventListener('pagehide', cleanup);
window.addEventListener('pageshow', event => {
    if (event.persisted && isCleanedUp) initialize();
});

// ============================================
// BOOTSTRAP
// ============================================

// Initialize when script loads
initialize();

// Export for debugging (uses memoized functions when available)
window.__X_POSED_CONTENT__ = {
    version: VERSION,
    scanPage: () => {
        // Debugging must not resurrect a disposed or not-yet-ready session.
        memoizedScanPageFn?.();
    },
    // Harvest diagnostics: how many accounts we hold profile data for, and whether the
    // page script was told enrichment is on.
    profiles: () => ({ cached: profileCount(), enabled: settings.profileEnrichment !== false }),
    getState: () => ({ ...getBlockingState(), isEnabled })
};
