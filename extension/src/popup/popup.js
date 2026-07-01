/**
 * Popup Script
 * Handles popup UI interactions and communication with background
 */

import browserAPI from '../shared/browser-api.js';
import { MESSAGE_TYPES, VERSION, TIMING, STORAGE_KEYS } from '../shared/constants.js';

// DOM Elements
const elements = {
    toggleEnabled: document.getElementById('toggle-enabled'),
    toggleFlags: document.getElementById('toggle-flags'),
    toggleFlagDevice: document.getElementById('toggle-flag-device'),
    toggleDevices: document.getElementById('toggle-devices'),
    toggleVpn: document.getElementById('toggle-vpn'),
    toggleVpnUsers: document.getElementById('toggle-vpn-users'),
    toggleSidebarLink: document.getElementById('toggle-sidebar-link'),
    toggleCaptureButton: document.getElementById('toggle-capture-button'),
    statCommunity: document.getElementById('stat-community'),
    btnClearCache: document.getElementById('btn-clear-cache'),
    btnOptions: document.getElementById('btn-options'),
    rateLimitBanner: document.getElementById('rate-limit-banner'),
    rateLimitTime: document.getElementById('rate-limit-time')
};

// Rate limit update interval
let rateLimitInterval = null;

/**
 * Initialize popup
 */
async function initialize() {
    // Load and apply theme first
    await loadTheme();
    
    // Update version display
    const versionEl = document.querySelector('.version');
    if (versionEl) {
        versionEl.textContent = `v${VERSION}`;
    }

    // Load current settings
    await loadSettings();

    // Load statistics
    await loadStats();

    // Keep the community total fresh: the background writes updated cloud stats to storage
    // (stale-while-revalidate). The popup previously read that snapshot once and never
    // updated, so it lagged one refresh behind the Options page and looked low. Mirror the
    // Options listener so both surfaces converge on the same number.
    try {
        const onCloudStatsChanged = (changes, areaName) => {
            if (areaName !== 'local') return;
            const total = changes?.[STORAGE_KEYS.CLOUD_SERVER_STATS]?.newValue?.data?.totalEntries;
            if (typeof total === 'number' && total > 0 && elements.statCommunity) {
                elements.statCommunity.textContent = total.toLocaleString();
                setHero('Community Cache', 'profiles cached by the community', true);
            }
        };
        browserAPI.storage.onChanged.addListener(onCloudStatsChanged);
        window.addEventListener('beforeunload', () => {
            try { browserAPI.storage.onChanged.removeListener(onCloudStatsChanged); } catch { /* ignore */ }
        });
    } catch { /* storage.onChanged unavailable — non-fatal */ }

    // Load rate limit status
    await loadRateLimitStatus();
    
    // Start periodic rate limit check
    startRateLimitMonitor();

    // Set up event listeners
    setupEventListeners();
}

/**
 * Load rate limit status from background
 */
async function loadRateLimitStatus() {
    try {
        const response = await browserAPI.runtime.sendMessage({
            type: MESSAGE_TYPES.GET_RATE_LIMIT_STATUS
        });

        if (response?.success) {
            updateRateLimitBanner(response);
        }
    } catch (error) {
        console.error('Failed to load rate limit status:', error);
    }
}

/**
 * Update rate limit banner UI
 */
function updateRateLimitBanner({ isRateLimited, resetTime, remainingMs }) {
    if (!elements.rateLimitBanner) return;
    
    if (isRateLimited && remainingMs > 0) {
        elements.rateLimitBanner.style.display = 'flex';
        elements.rateLimitBanner.classList.remove('ok');
        
        // Format remaining time
        const resetDate = new Date(resetTime);
        const mins = Math.ceil(remainingMs / 60000);
        
        let timeStr;
        if (mins >= 60) {
            const hours = Math.floor(mins / 60);
            const remaining = mins % 60;
            timeStr = remaining > 0 ? `~${hours}h ${remaining}m remaining` : `~${hours}h remaining`;
        } else {
            timeStr = `~${mins} min${mins > 1 ? 's' : ''} remaining`;
        }
        
        elements.rateLimitTime.textContent = `Resets at ${resetDate.toLocaleTimeString()} (${timeStr})`;
        
        // Update title
        const title = elements.rateLimitBanner.querySelector('.rate-limit-title');
        if (title) title.textContent = 'Rate Limited';
    } else {
        // Healthy: hide the banner entirely (the master row already shows status).
        elements.rateLimitBanner.style.display = 'none';
        elements.rateLimitBanner.classList.remove('ok');
    }
}

/**
 * Start periodic rate limit status check
 */
function startRateLimitMonitor() {
    // Clear any existing interval
    if (rateLimitInterval) {
        clearInterval(rateLimitInterval);
    }
    
    // Check every 10 seconds
    rateLimitInterval = setInterval(loadRateLimitStatus, 10000);
}

/**
 * Load and apply theme from storage
 */
async function loadTheme() {
    try {
        const response = await browserAPI.runtime.sendMessage({
            type: MESSAGE_TYPES.GET_THEME
        });
        
        if (response?.theme) {
            applyTheme(response.theme);
        }
    } catch (error) {
        console.error('Failed to load theme:', error);
    }
}

/**
 * Apply theme to the popup's documentElement via data-x-theme.
 * Only two themes are supported now (light + dark); legacy "dim" maps to dark.
 */
function applyTheme(theme) {
    const normalized = theme === 'light' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-x-theme', normalized);
}

/**
 * Load settings from background
 */
async function loadSettings() {
    try {
        const response = await browserAPI.runtime.sendMessage({
            type: MESSAGE_TYPES.GET_SETTINGS
        });

        if (response?.success && response.data) {
            const settings = response.data;
            
            elements.toggleEnabled.checked = settings.enabled !== false;
            elements.toggleFlags.checked = settings.showFlags !== false;
            elements.toggleFlagDevice.checked = settings.flagFromDevice === true;
            elements.toggleDevices.checked = settings.showDevices !== false;
            elements.toggleVpn.checked = settings.showVpnIndicator !== false;
            elements.toggleVpnUsers.checked = settings.showVpnUsers !== false;
            elements.toggleSidebarLink.checked = settings.showSidebarBlockerLink !== false;
            elements.toggleCaptureButton.checked = settings.showCaptureButton !== false;
        }
    } catch (error) {
        console.error('Failed to load settings:', error);
    }
}

/**
 * Load statistics from background.
 * The hero shows the COMMUNITY cache total (the proud 2.5M+). If the cloud cache is
 * unavailable or disabled, it falls back to this device's local cache size.
 */
async function loadStats() {
    try {
        const serverResp = await browserAPI.runtime.sendMessage({
            type: MESSAGE_TYPES.GET_CLOUD_SERVER_STATS
        });
        const totalEntries = serverResp?.success ? (serverResp.serverStats?.totalEntries || 0) : 0;

        if (totalEntries > 0) {
            elements.statCommunity.textContent = totalEntries.toLocaleString();
            setHero('Community Cache', 'profiles cached by the community', true);
        } else {
            // Fallback: this device's local cache size
            const cacheResponse = await browserAPI.runtime.sendMessage({
                type: MESSAGE_TYPES.GET_CACHE,
                payload: {}
            });
            const localSize = cacheResponse?.success ? (cacheResponse.size || 0) : 0;
            elements.statCommunity.textContent = localSize.toLocaleString();
            setHero('Cached Users', 'cached on this device', false);
        }
    } catch (error) {
        console.error('Failed to load cache stats:', error);
        elements.statCommunity.textContent = '-';
    }
}

/**
 * Update the hero caption/subtitle and the COMMUNITY badge visibility.
 */
function setHero(cap, sub, isCommunity) {
    const capEl = document.getElementById('hero-cap');
    const subEl = document.getElementById('hero-sub');
    const badgeEl = document.getElementById('hero-badge');
    if (capEl) capEl.textContent = cap;
    if (subEl) subEl.textContent = sub;
    if (badgeEl) badgeEl.style.display = isCommunity ? '' : 'none';
}

/**
 * Save settings to background
 */
async function saveSettings(settings) {
    try {
        await browserAPI.runtime.sendMessage({
            type: MESSAGE_TYPES.SET_SETTINGS,
            payload: settings
        });
    } catch (error) {
        console.error('Failed to save settings:', error);
    }
}

/**
 * Set up event listeners
 */
function setupEventListeners() {
    // Main toggle
    elements.toggleEnabled.addEventListener('change', async e => {
        await saveSettings({ enabled: e.target.checked });
        updateDisabledState(!e.target.checked);
    });

    // Display toggles
    elements.toggleFlags.addEventListener('change', async e => {
        await saveSettings({ showFlags: e.target.checked });
    });

    elements.toggleFlagDevice.addEventListener('change', async e => {
        await saveSettings({ flagFromDevice: e.target.checked });
    });

    elements.toggleDevices.addEventListener('change', async e => {
        await saveSettings({ showDevices: e.target.checked });
    });

    elements.toggleVpn.addEventListener('change', async e => {
        await saveSettings({ showVpnIndicator: e.target.checked });
    });

    elements.toggleVpnUsers.addEventListener('change', async e => {
        await saveSettings({ showVpnUsers: e.target.checked });
    });

    elements.toggleSidebarLink.addEventListener('change', async e => {
        await saveSettings({ showSidebarBlockerLink: e.target.checked });
    });

    // Capture button toggle
    if (elements.toggleCaptureButton) {
        elements.toggleCaptureButton.addEventListener('change', async e => {
            await saveSettings({ showCaptureButton: e.target.checked });
        });
    }

    // Clear cache button with confirmation
    elements.btnClearCache.addEventListener('click', async () => {
        // The hero shows the COMMUNITY total, not this device — fetch the local size fresh.
        let localCount = 0;
        try {
            const r = await browserAPI.runtime.sendMessage({
                type: MESSAGE_TYPES.GET_CACHE,
                payload: {}
            });
            localCount = r?.size || 0;
        } catch { /* ignore — treat as 0 */ }

        // Confirm before clearing
        if (localCount > 0) {
            const confirmed = confirm(`Are you sure you want to clear ${localCount.toLocaleString()} locally cached users?\n\nThis will require re-fetching data for all users.`);
            if (!confirmed) return;
        }

        elements.btnClearCache.classList.add('loading');

        try {
            // Clear cache by setting empty
            await browserAPI.runtime.sendMessage({
                type: MESSAGE_TYPES.SET_CACHE,
                payload: { action: 'clear' }
            });

            // Refresh stats (community total is unaffected; local falls to 0)
            await loadStats();

            // Visual feedback - save original children
            const originalChildren = Array.from(elements.btnClearCache.childNodes).map(node => node.cloneNode(true));
            
            // Create success content safely
            elements.btnClearCache.textContent = '';
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('viewBox', '0 0 24 24');
            svg.setAttribute('width', '16');
            svg.setAttribute('height', '16');
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('fill', 'currentColor');
            path.setAttribute('d', 'M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z');
            svg.appendChild(path);
            elements.btnClearCache.appendChild(svg);
            elements.btnClearCache.appendChild(document.createTextNode(' Cleared!'));
            
            setTimeout(() => {
                elements.btnClearCache.textContent = '';
                for (const child of originalChildren) {
                    elements.btnClearCache.appendChild(child);
                }
            }, TIMING.CACHE_CLEAR_FEEDBACK_MS);
        } catch (error) {
            console.error('Failed to clear cache:', error);
        } finally {
            elements.btnClearCache.classList.remove('loading');
        }
    });

    // Options button
    elements.btnOptions.addEventListener('click', () => {
        const opened = browserAPI.runtime.openOptionsPage?.();
        if (!opened) {
            window.open(browserAPI.runtime.getURL('options/options.html'));
            return;
        }
        // DRAFT (needs on-device check — issue #17): Firefox for Android renders the
        // toolbar popup as a full page that lingers after the options tab opens, so
        // the user must hit Back. Closing it lands them on Options cleanly. On desktop
        // the popup is already dismissed when a tab opens, so this is a no-op there.
        Promise.resolve(opened).finally(() => {
            try { window.close(); } catch (_) { /* some platforms block popup self-close */ }
        });
    });

    // Privacy link
    document.getElementById('link-privacy')?.addEventListener('click', e => {
        e.preventDefault();
        window.open('https://github.com/xaitax/x-account-location-device/blob/main/PRIVACY.md');
    });
}

/**
 * Update disabled state for child settings
 */
function updateDisabledState(disabled) {
    const settingsGroup = document.querySelector('.settings-group');
    if (settingsGroup) {
        settingsGroup.style.opacity = disabled ? '0.5' : '1';
        settingsGroup.style.pointerEvents = disabled ? 'none' : 'auto';
    }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
} else {
    initialize();
}