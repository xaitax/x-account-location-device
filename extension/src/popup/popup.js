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
    statCached: document.getElementById('stat-cached'),
    statBlocked: document.getElementById('stat-blocked'),
    btnClearCache: document.getElementById('btn-clear-cache'),
    btnOptions: document.getElementById('btn-options')
};

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

    // Set up event listeners
    setupEventListeners();
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
    elements.toggleEnabled.addEventListener('change', async (e) => {
        await saveSettings({ enabled: e.target.checked });
        updateDisabledState(!e.target.checked);
    });

    // Display toggles
    elements.toggleFlags.addEventListener('change', async (e) => {
        await saveSettings({ showFlags: e.target.checked });
    });

    elements.toggleDevices.addEventListener('change', async (e) => {
        await saveSettings({ showDevices: e.target.checked });
    });

    elements.toggleVpn.addEventListener('change', async (e) => {
        await saveSettings({ showVpnIndicator: e.target.checked });
    });

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
            
            // Visual feedback
            const originalText = elements.btnClearCache.innerHTML;
            elements.btnClearCache.innerHTML = `
                <svg viewBox="0 0 24 24" width="16" height="16">
                    <path fill="currentColor" d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                </svg>
                Cleared!
            `;
            
            setTimeout(() => {
                elements.btnClearCache.innerHTML = originalText;
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
    document.getElementById('link-privacy')?.addEventListener('click', (e) => {
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