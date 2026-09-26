/**
 * Graphite toolbar popup. Quick controls use the same revisioned settings API
 * as the full settings page; optional status requests never block interaction.
 */
import browserAPI from '../shared/browser-api.js';
import { MESSAGE_TYPES, VERSION, TIMING, STORAGE_KEYS } from '../shared/constants.js';
import { createSnapshotTracker } from '../shared/state-sync.js';
import { dialogIcon } from '../content/dialog-icons.js';

const TOGGLES = [
    ['toggle-enabled', 'enabled', true],
    ['toggle-flags', 'showFlags', true],
    ['toggle-devices', 'showDevices', true],
    ['toggle-flag-device', 'flagFromDevice', false],
    ['toggle-vpn', 'showVpnIndicator', true],
    ['toggle-vpn-users', 'showVpnUsers', true],
    ['toggle-sidebar-link', 'showSidebarBlockerLink', true],
    ['toggle-info-icon', 'showInfoIcon', true],
    ['toggle-click-details', 'hovercardTrigger', 'hover'],
    ['toggle-capture-button', 'showCaptureButton', true]
];
const byId = id => document.getElementById(id);
const snapshots = createSnapshotTracker();
const pending = new Set();
let settings = {};
let settingsLoaded = false;
let settingsFailed = false;
let settingsRequest = 0;
let rateStatus = null;
let rateLimitInterval = null;
let closed = false;
let statsGeneration = 0;
let cloudAllowed = false;
let communityTotal = null;
let communityVersion = 0;
let clearingCache = false;

function initialize() {
    for (const slot of document.querySelectorAll('[data-popup-icon]')) {
        slot.replaceChildren(dialogIcon(slot.dataset.popupIcon, 18));
    }
    document.querySelector('.version').textContent = `v${VERSION}`;
    setupEventListeners();
    browserAPI.runtime.onMessage.addListener(handleMessage);
    browserAPI.storage.onChanged.addListener(handleStorageChange);
    window.addEventListener('pagehide', cleanup, { once: true });
    renderSettings();
    void loadTheme();
    void loadSettings();
    void loadStats();
    void loadRateLimitStatus();
    rateLimitInterval = setInterval(loadRateLimitStatus, TIMING.RATE_LIMIT_CHECK_MS);
}

function cleanup() {
    closed = true;
    statsGeneration++;
    clearInterval(rateLimitInterval);
    browserAPI.runtime.onMessage.removeListener(handleMessage);
    browserAPI.storage.onChanged.removeListener(handleStorageChange);
}

function setStatus(message, error = false) {
    if (closed) return;
    const status = byId('popup-status');
    status.textContent = message;
    status.classList.toggle('error', error);
    status.hidden = !message;
}

function renderSettings() {
    if (closed) return;
    const enabled = settings.enabled !== false;
    for (const [id, key, fallback] of TOGGLES) {
        const input = byId(id);
        input.checked = settingsLoaded && (key === 'hovercardTrigger'
            ? settings[key] === 'click' : (settings[key] ?? fallback) === true);
        input.disabled = !settingsLoaded || pending.has(id) || pending.has('toggle-enabled')
            || (id !== 'toggle-enabled' && !enabled);
    }
    const state = byId('extension-state');
    state.dataset.state = settingsLoaded ? (enabled ? 'on' : 'off') : (settingsFailed ? 'error' : 'loading');
    byId('extension-status').textContent = settingsLoaded ? (enabled ? 'X-Posed is on' : 'X-Posed is paused')
        : (settingsFailed ? 'Settings unavailable' : 'Loading settings');
    byId('extension-status-description').textContent = settingsLoaded
        ? (enabled ? 'Your saved preferences apply on X.' : 'Your saved preferences are kept.')
        : (settingsFailed ? 'Try again to load your saved preferences.' : 'Checking your saved preferences.');
    byId('btn-retry-settings').hidden = !settingsFailed;
    renderRateLimit();
}

function acceptSettings(data, revision) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
    if (!snapshots.accept(MESSAGE_TYPES.SETTINGS_UPDATED, revision)) return false;
    settings = data;
    settingsLoaded = true;
    settingsFailed = false;
    renderSettings();
    return true;
}

async function loadSettings() {
    const request = ++settingsRequest;
    const retry = byId('btn-retry-settings');
    retry.disabled = true;
    try {
        const response = await browserAPI.runtime.sendMessage({ type: MESSAGE_TYPES.GET_SETTINGS });
        if (closed || request !== settingsRequest) return;
        if (!response?.success || !response.data || typeof response.data !== 'object' || Array.isArray(response.data)) {
            throw new Error('Could not read settings');
        }
        acceptSettings(response.data, response.revision);
    } catch {
        if (closed || request !== settingsRequest) return;
        settingsFailed = !settingsLoaded;
        if (settingsLoaded) setStatus('Could not refresh settings. Please try again.', true);
    } finally {
        if (!closed && request === settingsRequest) {
            retry.disabled = false;
            renderSettings();
        }
    }
}

async function saveToggle(id, key, value) {
    if (!settingsLoaded || pending.has(id)) return;
    pending.add(id);
    renderSettings();
    setStatus('Saving...');
    try {
        const response = await browserAPI.runtime.sendMessage({
            type: MESSAGE_TYPES.SET_SETTINGS, payload: { [key]: value }
        });
        if (closed) return;
        if (!response?.success || !response.data || typeof response.data !== 'object' || Array.isArray(response.data)) {
            throw new Error('Save failed');
        }
        // A newer broadcast wins over an older acknowledgement.
        acceptSettings(response.data, response.revision);
        setStatus('Changes saved');
    } catch {
        setStatus('Could not save this change. Your previous setting is unchanged.', true);
    } finally {
        pending.delete(id);
        renderSettings();
    }
}

function handleMessage(message) {
    if (message?.type === MESSAGE_TYPES.SETTINGS_UPDATED) {
        acceptSettings(message.payload, message.revision);
    } else if (message?.type === MESSAGE_TYPES.THEME_UPDATED && typeof message.payload === 'string') {
        applyTheme(message.payload);
    }
}

function handleStorageChange(changes, area) {
    if (closed || area !== 'local') return;
    if (changes[STORAGE_KEYS.THEME]?.newValue) applyTheme(changes[STORAGE_KEYS.THEME].newValue);
    const total = changes[STORAGE_KEYS.CLOUD_SERVER_STATS]?.newValue?.data?.totalEntries;
    if (validCount(total)) {
        communityVersion++;
        communityTotal = total;
        if (cloudAllowed) renderCache(total, true);
    }
    // Opting out elsewhere must also stop this popup displaying a community total.
    if (changes[STORAGE_KEYS.CLOUD_CACHE_ENABLED]) void loadStats();
}

function applyTheme(theme) {
    if (!closed) document.documentElement.dataset.xTheme = theme === 'light' ? 'light' : 'dark';
}

async function loadTheme() {
    try {
        const response = await browserAPI.runtime.sendMessage({ type: MESSAGE_TYPES.GET_THEME });
        if (response?.theme) applyTheme(response.theme);
    } catch { /* The default Graphite dark theme remains usable. */ }
}

function validCount(value) {
    return Number.isSafeInteger(value) && value >= 0;
}

function renderCache(total, community) {
    if (closed) return;
    byId('cache-summary').dataset.mode = community ? 'community' : 'local';
    byId('hero-cap').textContent = community ? 'Community cache' : 'Local cache';
    byId('stat-community').textContent = validCount(total) ? total.toLocaleString() : 'Unavailable';
    byId('hero-sub').textContent = community ? 'accounts shared by the community' : 'accounts cached on this device';
    byId('cache-kind').replaceChildren(dialogIcon(community ? 'cloud' : 'database', 18));
}

async function loadLocalStats(generation) {
    try {
        const response = await browserAPI.runtime.sendMessage({ type: MESSAGE_TYPES.GET_CACHE, payload: {} });
        if (closed || generation !== statsGeneration) return;
        // A fresh community snapshot may have arrived while the local fallback loaded.
        if (cloudAllowed && validCount(communityTotal)) { renderCache(communityTotal, true); return; }
        renderCache(response?.success && validCount(response.size) ? response.size : null, false);
    } catch {
        if (!closed && generation === statsGeneration && !(cloudAllowed && validCount(communityTotal))) renderCache(null, false);
    }
}

async function loadStats() {
    const generation = ++statsGeneration;
    const version = communityVersion;
    cloudAllowed = false;
    try {
        const [status, cached] = await Promise.all([
            browserAPI.runtime.sendMessage({ type: MESSAGE_TYPES.GET_CLOUD_CACHE_STATUS }),
            browserAPI.storage.local.get(STORAGE_KEYS.CLOUD_SERVER_STATS).catch(() => ({}))
        ]);
        if (closed || generation !== statsGeneration) return;
        cloudAllowed = status?.success === true && status.enabled === true && status.configured === true;
        if (!cloudAllowed) { await loadLocalStats(generation); return; }
        const total = cached?.[STORAGE_KEYS.CLOUD_SERVER_STATS]?.data?.totalEntries;
        if (version === communityVersion && validCount(total)) communityTotal = total;
        if (validCount(communityTotal)) renderCache(communityTotal, true);

        // One stale-while-revalidate request per opening, not recurring cloud polling.
        const beforeRefresh = communityVersion;
        const response = await browserAPI.runtime.sendMessage({ type: MESSAGE_TYPES.GET_CLOUD_SERVER_STATS });
        if (closed || generation !== statsGeneration) return;
        const updated = response?.success ? response.serverStats?.totalEntries : null;
        if (beforeRefresh === communityVersion && validCount(updated)) communityTotal = updated;
        if (validCount(communityTotal)) renderCache(communityTotal, true);
        else await loadLocalStats(generation);
    } catch {
        if (closed || generation !== statsGeneration) return;
        if (cloudAllowed && validCount(communityTotal)) renderCache(communityTotal, true);
        else await loadLocalStats(generation);
    }
}

async function loadRateLimitStatus() {
    try {
        const response = await browserAPI.runtime.sendMessage({ type: MESSAGE_TYPES.GET_RATE_LIMIT_STATUS });
        if (closed || typeof response?.isRateLimited !== 'boolean') return;
        rateStatus = response;
        renderRateLimit();
    } catch { /* A failed status read must not claim the API is healthy. */ }
}

function renderRateLimit() {
    const banner = byId('rate-limit-banner');
    banner.hidden = settingsLoaded && settings.enabled === false || !rateStatus?.isRateLimited;
    if (banner.hidden) return;
    const reset = new Date(rateStatus.resetTime).getTime();
    const remaining = Number.isFinite(rateStatus.remainingMs) ? rateStatus.remainingMs
        : (Number.isFinite(reset) ? reset - Date.now() : 0);
    const minutes = Math.ceil(remaining / 60000);
    banner.querySelector('.rate-limit-title').textContent = 'X is limiting lookups';
    byId('rate-limit-time').textContent = minutes > 0
        ? `Try again in about ${minutes} minute${minutes === 1 ? '' : 's'}.`
        : 'Waiting for X to allow requests again.';
}

async function clearLocalCache() {
    if (clearingCache) return;
    clearingCache = true;
    byId('btn-confirm-clear').disabled = true;
    byId('btn-cancel-clear').disabled = true;
    byId('btn-clear-cache').disabled = true;
    setStatus('Clearing local cache...');
    try {
        const response = await browserAPI.runtime.sendMessage({ type: MESSAGE_TYPES.SET_CACHE, payload: { action: 'clear' } });
        if (closed) return;
        if (!response?.success) throw new Error('Clear failed');
        byId('cache-clear-confirm').hidden = true;
        byId('btn-clear-cache').setAttribute('aria-expanded', 'false');
        // Clearing local entries never changes the community count or refetches it.
        if (byId('cache-summary').dataset.mode === 'local') await loadLocalStats(statsGeneration);
        setStatus('Local cache cleared. Your settings and filters are unchanged.');
        byId('btn-clear-cache').focus();
    } catch {
        setStatus('Could not clear the local cache. Please try again.', true);
    } finally {
        clearingCache = false;
        if (!closed) {
            byId('btn-confirm-clear').disabled = false;
            byId('btn-cancel-clear').disabled = false;
            byId('btn-clear-cache').disabled = false;
        }
    }
}

async function openSettings(blocking = false) {
    const button = byId(blocking ? 'btn-blocking' : 'btn-options');
    button.disabled = true;
    try {
        if (blocking) {
            await browserAPI.tabs.create({ url: browserAPI.runtime.getURL('options/options.html#panel-blocking') });
        } else if (typeof browserAPI.runtime.openOptionsPage === 'function') {
            try { await browserAPI.runtime.openOptionsPage(); }
            catch { await browserAPI.tabs.create({ url: browserAPI.runtime.getURL('options/options.html') }); }
        } else {
            await browserAPI.tabs.create({ url: browserAPI.runtime.getURL('options/options.html') });
        }
        // Firefox mobile leaves the toolbar surface open after the new tab appears.
        try { window.close(); } catch { /* Some hosts do not allow self-close. */ }
    } catch {
        setStatus('Could not open settings. Please try again.', true);
    } finally {
        if (!closed) button.disabled = false;
    }
}

function setupEventListeners() {
    for (const [id, key] of TOGGLES) {
        byId(id).addEventListener('change', event => {
            const checked = event.target.checked;
            void saveToggle(id, key, key === 'hovercardTrigger' ? (checked ? 'click' : 'hover') : checked);
        });
    }
    byId('btn-retry-settings').addEventListener('click', () => { void loadSettings(); });
    byId('btn-options').addEventListener('click', () => { void openSettings(); });
    byId('btn-blocking').addEventListener('click', () => { void openSettings(true); });
    byId('btn-clear-cache').addEventListener('click', () => {
        byId('cache-clear-confirm').hidden = false;
        byId('btn-clear-cache').setAttribute('aria-expanded', 'true');
        byId('btn-cancel-clear').focus();
    });
    byId('btn-cancel-clear').addEventListener('click', () => {
        byId('cache-clear-confirm').hidden = true;
        byId('btn-clear-cache').setAttribute('aria-expanded', 'false');
        byId('btn-clear-cache').focus();
    });
    byId('btn-confirm-clear').addEventListener('click', () => { void clearLocalCache(); });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize);
else initialize();
