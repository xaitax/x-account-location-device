/**
 * Popup Script
 * Handles popup UI interactions and communication with background
 */

import browserAPI from '../shared/browser-api.js';
import { MESSAGE_TYPES, VERSION, TIMING } from '../shared/constants.js';
import { applyTheme } from '../shared/utils.js';

// DOM Elements
const elements = {
    toggleEnabled: document.getElementById('toggle-enabled'),
    toggleFlags: document.getElementById('toggle-flags'),
    toggleDevices: document.getElementById('toggle-devices'),
    toggleVpn: document.getElementById('toggle-vpn'),
    toggleCaptureButton: document.getElementById('toggle-capture-button'),
    statCached: document.getElementById('stat-cached'),
    statBlocked: document.getElementById('stat-blocked'),
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
        
        // Update icon
        const icon = elements.rateLimitBanner.querySelector('.rate-limit-icon');
        if (icon) icon.textContent = '⚠️';
        
        // Update title
        const title = elements.rateLimitBanner.querySelector('.rate-limit-title');
        if (title) title.textContent = 'Rate Limited';
    } else {
        // Show "OK" status
        elements.rateLimitBanner.style.display = 'flex';
        elements.rateLimitBanner.classList.add('ok');
        
        const icon = elements.rateLimitBanner.querySelector('.rate-limit-icon');
        if (icon) icon.textContent = '✅';
        
        const title = elements.rateLimitBanner.querySelector('.rate-limit-title');
        if (title) title.textContent = 'API Status: OK';
        
        elements.rateLimitTime.textContent = 'No rate limits active';
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
            elements.toggleDevices.checked = settings.showDevices !== false;
            elements.toggleVpn.checked = settings.showVpnIndicator !== false;
            elements.toggleCaptureButton.checked = settings.showCaptureButton !== false;
        }
    } catch (error) {
        console.error('Failed to load settings:', error);
    }
}

/**
 * Load statistics from background
 */
async function loadStats() {
    try {
        // Get cache info
        const cacheResponse = await browserAPI.runtime.sendMessage({
            type: MESSAGE_TYPES.GET_CACHE,
            payload: {}
        });

        if (cacheResponse?.success) {
            elements.statCached.textContent = cacheResponse.size || 0;
        }

        // Get blocked countries
        const blockedResponse = await browserAPI.runtime.sendMessage({
            type: MESSAGE_TYPES.GET_BLOCKED_COUNTRIES
        });

        if (blockedResponse?.success) {
            elements.statBlocked.textContent = blockedResponse.size || 0;
        }
    } catch (error) {
        console.error('Failed to load stats:', error);
        elements.statCached.textContent = '-';
        elements.statBlocked.textContent = '-';
    }
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

    elements.toggleDevices.addEventListener('change', async e => {
        await saveSettings({ showDevices: e.target.checked });
    });

    elements.toggleVpn.addEventListener('change', async e => {
        await saveSettings({ showVpnIndicator: e.target.checked });
    });

    // Capture button toggle
    if (elements.toggleCaptureButton) {
        elements.toggleCaptureButton.addEventListener('change', async e => {
            await saveSettings({ showCaptureButton: e.target.checked });
        });
    }

    // Clear cache button with confirmation
    elements.btnClearCache.addEventListener('click', async () => {
        // Get current cache size for confirmation message
        const cachedCount = elements.statCached.textContent;
        
        // Confirm before clearing
        if (cachedCount !== '0' && cachedCount !== '-') {
            const confirmed = confirm(`Are you sure you want to clear ${cachedCount} cached users?\n\nThis will require re-fetching data for all users.`);
            if (!confirmed) return;
        }
        
        elements.btnClearCache.classList.add('loading');
        
        try {
            // Clear cache by setting empty
            await browserAPI.runtime.sendMessage({
                type: MESSAGE_TYPES.SET_CACHE,
                payload: { action: 'clear' }
            });
            
            elements.statCached.textContent = '0';
            
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
        browserAPI.runtime.openOptionsPage?.() || 
        window.open(browserAPI.runtime.getURL('options/options.html'));
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