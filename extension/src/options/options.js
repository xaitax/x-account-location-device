/**
 * Options Page Script
 * Full settings interface for the extension
 */

import browserAPI from '../shared/browser-api.js';
import { MESSAGE_TYPES, VERSION, COUNTRY_FLAGS, COUNTRY_LIST, STORAGE_KEYS, TIMING } from '../shared/constants.js';
import { getFlagEmoji, formatCountryName, applyTheme, debounce } from '../shared/utils.js';

// DOM Elements
const elements = {
    // General
    optEnabled: document.getElementById('opt-enabled'),
    optDebug: document.getElementById('opt-debug'),
    // Display
    optFlags: document.getElementById('opt-flags'),
    optDevices: document.getElementById('opt-devices'),
    optVpn: document.getElementById('opt-vpn'),
    optSidebarLink: document.getElementById('opt-sidebar-link'),
    // Blocked
    blockedList: document.getElementById('blocked-list'),
    blockedCount: document.getElementById('blocked-count'),
    countrySearch: document.getElementById('country-search'),
    countryGrid: document.getElementById('country-grid'),
    btnClearBlocked: document.getElementById('btn-clear-blocked'),
    // Cloud cache
    optCloudCache: document.getElementById('opt-cloud-cache'),
    cloudStatus: document.getElementById('cloud-status'),
    cloudStatusIndicator: document.getElementById('cloud-status-indicator'),
    cloudStatusText: document.getElementById('cloud-status-text'),
    cloudStats: document.getElementById('cloud-stats'),
    cloudTotalEntries: document.getElementById('cloud-total-entries'),
    cloudLookups: document.getElementById('cloud-lookups'),
    cloudHits: document.getElementById('cloud-hits'),
    cloudContributions: document.getElementById('cloud-contributions'),
    cloudUnconfigured: document.getElementById('cloud-unconfigured'),
    cloudActions: document.getElementById('cloud-actions'),
    btnSyncToCloud: document.getElementById('btn-sync-to-cloud'),
    syncStatus: document.getElementById('sync-status'),
    // Cache
    cacheSize: document.getElementById('cache-size'),
    btnClearCache: document.getElementById('btn-clear-cache'),
    btnExportCache: document.getElementById('btn-export-cache'),
    // About
    version: document.getElementById('version'),
    // Status
    saveStatus: document.getElementById('save-status')
};

let currentSettings = {};
let blockedCountries = [];

/**
 * Initialize options page
 */
async function initialize() {
    // Load and apply theme first
    await loadTheme();
    
    // Set version
    if (elements.version) {
        elements.version.textContent = VERSION;
    }

    // Check for "What's New" parameter or flag
    await checkWhatsNew();

    // Load current settings
    await loadSettings();
    await loadBlockedCountries();
    await loadCacheStats();
    await loadStatistics();
    await loadCloudCacheStatus();

    // Setup event listeners
    setupEventListeners();
}

/**
 * Check if we should show the "What's New" banner
 */
async function checkWhatsNew() {
    const banner = document.getElementById('whats-new-banner');
    const closeBtn = document.getElementById('whats-new-close');
    
    if (!banner) return;
    
    // Check URL parameter
    const urlParams = new URLSearchParams(window.location.search);
    const showWhatsNew = urlParams.get('whats-new') === 'true';
    
    // Also check storage flag
    let storageShowWhatsNew = false;
    try {
        const result = await browserAPI.storage.local.get(STORAGE_KEYS.WHATS_NEW_SEEN);
        storageShowWhatsNew = result[STORAGE_KEYS.WHATS_NEW_SEEN] === false;
    } catch (e) {
        console.debug('Could not check whats-new storage flag');
    }
    
    if (showWhatsNew || storageShowWhatsNew) {
        banner.style.display = 'block';
        
        // Scroll to top to show banner
        window.scrollTo({ top: 0, behavior: 'smooth' });
        
        // Setup close button
        if (closeBtn) {
            closeBtn.addEventListener('click', async () => {
                banner.style.display = 'none';
                
                // Mark as seen
                try {
                    await browserAPI.storage.local.set({
                        [STORAGE_KEYS.WHATS_NEW_SEEN]: true
                    });
                } catch (e) {
                    console.debug('Could not save whats-new seen flag');
                }
                
                // Remove URL parameter if present
                if (showWhatsNew) {
                    const newUrl = window.location.pathname;
                    window.history.replaceState({}, document.title, newUrl);
                }
            });
        }
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
            currentSettings = response.data;
            
            elements.optEnabled.checked = currentSettings.enabled !== false;
            elements.optDebug.checked = currentSettings.debugMode === true;
            elements.optFlags.checked = currentSettings.showFlags !== false;
            elements.optDevices.checked = currentSettings.showDevices !== false;
            elements.optVpn.checked = currentSettings.showVpnIndicator !== false;
            if (elements.optSidebarLink) {
                elements.optSidebarLink.checked = currentSettings.showSidebarBlockerLink !== false;
            }
        }
    } catch (error) {
        console.error('Failed to load settings:', error);
    }
}

/**
 * Load blocked countries
 */
async function loadBlockedCountries() {
    try {
        const response = await browserAPI.runtime.sendMessage({
            type: MESSAGE_TYPES.GET_BLOCKED_COUNTRIES
        });

        if (response?.success) {
            blockedCountries = response.data || [];
            renderBlockedCountries();
            renderCountryGrid();
            updateBlockedCount();
        }
    } catch (error) {
        console.error('Failed to load blocked countries:', error);
    }
}

/**
 * Update blocked count badge
 */
function updateBlockedCount() {
    if (elements.blockedCount) {
        elements.blockedCount.textContent = blockedCountries.length;
        elements.blockedCount.style.display = blockedCountries.length > 0 ? 'inline-flex' : 'none';
    }
}

/**
 * Render the country grid for selection
 */
function renderCountryGrid(filter = '') {
    if (!elements.countryGrid) return;
    
    const filterLower = filter.toLowerCase();
    const filteredCountries = COUNTRY_LIST.filter(country =>
        country.toLowerCase().includes(filterLower)
    );
    
    // Show empty result message
    if (filteredCountries.length === 0) {
        elements.countryGrid.innerHTML = '<div class="empty-state">No countries match your search</div>';
        return;
    }
    
    elements.countryGrid.innerHTML = '';
    
    for (const country of filteredCountries) {
        const isBlocked = blockedCountries.includes(country);
        const item = document.createElement('div');
        item.className = `country-item${isBlocked ? ' blocked' : ''}`;
        item.dataset.country = country;
        
        const flag = getFlagEmoji(country);
        const flagHtml = typeof flag === 'string' && flag.startsWith('<img') ? flag : (flag || '🌍');
        
        item.innerHTML = `
            <span class="country-item-flag">${flagHtml}</span>
            <span class="country-item-name">${formatCountryName(country)}</span>
            ${isBlocked ? '<span class="country-item-blocked">✓</span>' : ''}
        `;
        
        item.addEventListener('click', () => toggleCountry(country));
        elements.countryGrid.appendChild(item);
    }
}

/**
 * Toggle a country's blocked status
 */
async function toggleCountry(country) {
    try {
        const response = await browserAPI.runtime.sendMessage({
            type: MESSAGE_TYPES.SET_BLOCKED_COUNTRIES,
            payload: { action: 'toggle', country }
        });

        if (response?.success) {
            blockedCountries = response.data || [];
            renderBlockedCountries();
            renderCountryGrid(elements.countrySearch?.value || '');
            updateBlockedCount();
            showSaveStatus();
        }
    } catch (error) {
        console.error('Failed to toggle country:', error);
    }
}

/**
 * Clear all blocked countries
 */
async function clearAllBlocked() {
    if (blockedCountries.length === 0) return;
    
    if (!confirm('Are you sure you want to unblock all countries?')) return;
    
    try {
        const response = await browserAPI.runtime.sendMessage({
            type: MESSAGE_TYPES.SET_BLOCKED_COUNTRIES,
            payload: { action: 'clear' }
        });

        if (response?.success) {
            blockedCountries = [];
            renderBlockedCountries();
            renderCountryGrid(elements.countrySearch?.value || '');
            updateBlockedCount();
            showSaveStatus();
        }
    } catch (error) {
        console.error('Failed to clear blocked countries:', error);
    }
}

/**
 * Load cache statistics
 */
async function loadCacheStats() {
    try {
        const response = await browserAPI.runtime.sendMessage({
            type: MESSAGE_TYPES.GET_CACHE,
            payload: {}
        });

        if (response?.success) {
            elements.cacheSize.textContent = response.size || 0;
        }
    } catch (error) {
        console.error('Failed to load cache stats:', error);
        elements.cacheSize.textContent = '-';
    }
}

/**
 * Load and apply theme
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
 * Load statistics data
 */
async function loadStatistics() {
    try {
        const response = await browserAPI.runtime.sendMessage({
            type: MESSAGE_TYPES.GET_STATISTICS
        });
        
        if (response?.success && response.data) {
            renderStatistics(response.data);
        }
    } catch (error) {
        console.error('Failed to load statistics:', error);
    }
}

/**
 * Load cloud cache status
 */
async function loadCloudCacheStatus() {
    try {
        const response = await browserAPI.runtime.sendMessage({
            type: MESSAGE_TYPES.GET_CLOUD_CACHE_STATUS
        });

        if (response?.success) {
            updateCloudCacheUI(response.enabled, response.configured, response.stats);
            
            // If enabled and configured, also fetch server stats
            if (response.enabled && response.configured) {
                fetchCloudServerStats();
            }
        }
    } catch (error) {
        console.error('Failed to load cloud cache status:', error);
    }
}

/**
 * Fetch cloud server statistics (total entries)
 */
async function fetchCloudServerStats() {
    try {
        const response = await browserAPI.runtime.sendMessage({
            type: MESSAGE_TYPES.GET_CLOUD_SERVER_STATS
        });

        if (response?.success && response.serverStats) {
            if (elements.cloudTotalEntries) {
                const total = response.serverStats.totalEntries || 0;
                elements.cloudTotalEntries.textContent = formatNumber(total);
            }
        }
    } catch (error) {
        console.error('Failed to fetch cloud server stats:', error);
        if (elements.cloudTotalEntries) {
            elements.cloudTotalEntries.textContent = '-';
        }
    }
}

/**
 * Format large numbers with K/M suffix
 */
function formatNumber(num) {
    if (num >= 1000000) {
        return (num / 1000000).toFixed(1) + 'M';
    } else if (num >= 1000) {
        return (num / 1000).toFixed(1) + 'K';
    }
    return num.toString();
}

/**
 * Handle sync local cache to cloud
 */
async function handleSyncToCloud() {
    const btn = elements.btnSyncToCloud;
    const status = elements.syncStatus;
    
    if (!btn || !status) return;
    
    // Disable button during sync
    btn.disabled = true;
    btn.textContent = 'Syncing...';
    status.textContent = '';
    status.className = 'sync-status';
    
    try {
        const response = await browserAPI.runtime.sendMessage({
            type: MESSAGE_TYPES.SYNC_LOCAL_TO_CLOUD
        });
        
        if (response?.success && response.result) {
            const { synced, skipped, errors } = response.result;
            status.textContent = `✓ Synced ${synced} entries${skipped > 0 ? `, ${skipped} skipped` : ''}${errors > 0 ? `, ${errors} errors` : ''}`;
            status.className = 'sync-status success';
            
            // Refresh cloud stats
            await loadCloudCacheStatus();
            await fetchCloudServerStats();
        } else {
            status.textContent = '✗ ' + (response?.error || 'Sync failed');
            status.className = 'sync-status error';
        }
    } catch (error) {
        status.textContent = '✗ ' + error.message;
        status.className = 'sync-status error';
    } finally {
        // Re-enable button
        btn.disabled = false;
        btn.innerHTML = `
            <svg viewBox="0 0 24 24" width="16" height="16">
                <path fill="currentColor" d="M19.35 10.04C18.67 6.59 15.64 4 12 4c-1.48 0-2.85.43-4.01 1.17l1.46 1.46C10.21 6.23 11.08 6 12 6c3.04 0 5.5 2.46 5.5 5.5v.5H19c1.66 0 3 1.34 3 3 0 1.13-.64 2.11-1.56 2.62l1.45 1.45C23.16 18.16 24 16.68 24 15c0-2.64-2.05-4.78-4.65-4.96zM3 5.27l2.75 2.74C2.56 8.15 0 10.77 0 14c0 3.31 2.69 6 6 6h11.73l2 2L21 20.73 4.27 4 3 5.27zM7.73 10l8 8H6c-2.21 0-4-1.79-4-4s1.79-4 4-4h1.73z"/>
            </svg>
            Sync Local Cache to Cloud
        `;
    }
}

/**
 * Update cloud cache UI
 */
function updateCloudCacheUI(enabled, configured, stats) {
    if (elements.optCloudCache) {
        elements.optCloudCache.checked = enabled;
    }
    
    // Update status indicator
    if (elements.cloudStatusIndicator) {
        elements.cloudStatusIndicator.className = 'status-indicator';
        if (!configured) {
            elements.cloudStatusIndicator.classList.add('status-unconfigured');
            elements.cloudStatusText.textContent = 'Not Configured';
        } else if (enabled) {
            elements.cloudStatusIndicator.classList.add('status-enabled');
            elements.cloudStatusText.textContent = 'Connected';
        } else {
            elements.cloudStatusIndicator.classList.add('status-disabled');
            elements.cloudStatusText.textContent = 'Disabled';
        }
    }
    
    // Show/hide unconfigured warning
    if (elements.cloudUnconfigured) {
        elements.cloudUnconfigured.style.display = configured ? 'none' : 'block';
    }
    
    // Show/hide stats
    if (elements.cloudStats) {
        elements.cloudStats.style.display = enabled && configured ? 'grid' : 'none';
    }
    
    // Show/hide actions
    if (elements.cloudActions) {
        elements.cloudActions.style.display = enabled && configured ? 'flex' : 'none';
    }
    
    // Reset cloud total if not enabled
    if (elements.cloudTotalEntries && (!enabled || !configured)) {
        elements.cloudTotalEntries.textContent = '-';
    }
    
    // Update stats values
    if (stats) {
        if (elements.cloudLookups) elements.cloudLookups.textContent = stats.lookups || 0;
        if (elements.cloudHits) elements.cloudHits.textContent = stats.hits || 0;
        if (elements.cloudContributions) elements.cloudContributions.textContent = stats.contributions || 0;
    }
}

/**
 * Render statistics in the UI
 */
function renderStatistics(stats) {
    // Get or create statistics container
    let statsSection = document.getElementById('stats-section');
    if (!statsSection) {
        // Create statistics section dynamically
        const cacheSection = document.querySelector('.options-section:has(#cache-size)');
        if (cacheSection) {
            statsSection = document.createElement('section');
            statsSection.id = 'stats-section';
            statsSection.className = 'options-section';
            cacheSection.parentNode.insertBefore(statsSection, cacheSection);
        }
    }
    
    if (!statsSection) return;
    
    // Build statistics HTML
    const topCountriesHtml = stats.topCountries.slice(0, 5).map(c => `
        <div class="stat-bar-item">
            <div class="stat-bar-label">
                <span>${COUNTRY_FLAGS[c.country] || '🌍'} ${formatCountryName(c.country)}</span>
                <span>${c.count} (${c.percentage}%)</span>
            </div>
            <div class="stat-bar">
                <div class="stat-bar-fill" style="width: ${c.percentage}%"></div>
            </div>
        </div>
    `).join('');
    
    const deviceColorsMap = {
        'iOS': '#1d9bf0',
        'Android': '#00ba7c',
        'Web': '#f4212e',
        'Unknown': '#71767b'
    };
    
    const deviceStatsHtml = stats.topDevices.map(d => `
        <div class="device-stat">
            <span class="device-icon">${d.device === 'iOS' ? '🍎' : d.device === 'Android' ? '🤖' : d.device === 'Web' ? '🌐' : '❓'}</span>
            <span class="device-name">${d.device}</span>
            <span class="device-count">${d.count} (${d.percentage}%)</span>
        </div>
    `).join('');
    
    statsSection.innerHTML = `
        <h2 class="section-title">
            <svg viewBox="0 0 24 24" width="20" height="20">
                <path fill="currentColor" d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4z"/>
            </svg>
            Statistics
        </h2>
        
        <div class="stats-overview">
            <div class="stats-overview-item">
                <span class="stats-overview-value">${stats.totalUsers}</span>
                <span class="stats-overview-label">Total Users</span>
            </div>
            <div class="stats-overview-item">
                <span class="stats-overview-value">${Object.keys(stats.countryCounts).length}</span>
                <span class="stats-overview-label">Countries</span>
            </div>
            <div class="stats-overview-item">
                <span class="stats-overview-value">${stats.vpnCount}</span>
                <span class="stats-overview-label">VPN Users</span>
            </div>
        </div>
        
        ${stats.topCountries.length > 0 ? `
        <div class="stats-subsection">
            <h3 class="stats-subtitle">Top Countries</h3>
            <div class="stat-bars">
                ${topCountriesHtml}
            </div>
        </div>
        ` : ''}
        
        ${stats.topDevices.length > 0 ? `
        <div class="stats-subsection">
            <h3 class="stats-subtitle">Device Distribution</h3>
            <div class="device-stats">
                ${deviceStatsHtml}
            </div>
        </div>
        ` : ''}
    `;
}

/**
 * Render blocked countries list
 */
function renderBlockedCountries() {
    const list = elements.blockedList;
    
    if (blockedCountries.length === 0) {
        list.innerHTML = '<p class="empty-state">No countries blocked</p>';
        return;
    }

    list.innerHTML = '';
    
    for (const country of blockedCountries.sort()) {
        const item = document.createElement('div');
        item.className = 'blocked-item';
        
        const flag = getFlagEmoji(country);
        
        item.innerHTML = `
            <div class="blocked-item-info">
                <span class="blocked-flag">${typeof flag === 'string' && flag.startsWith('<img') ? flag : (flag || '🌍')}</span>
                <span class="blocked-name">${formatCountryName(country)}</span>
            </div>
            <button class="blocked-remove" data-country="${country}" aria-label="Remove ${formatCountryName(country)}">
                <svg viewBox="0 0 24 24" width="16" height="16">
                    <path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                </svg>
            </button>
        `;
        
        list.appendChild(item);
    }

    // Add remove handlers
    list.querySelectorAll('.blocked-remove').forEach(btn => {
        btn.addEventListener('click', async () => {
            const country = btn.dataset.country;
            await removeBlockedCountry(country);
        });
    });
}

/**
 * Remove a blocked country
 */
async function removeBlockedCountry(country) {
    try {
        const response = await browserAPI.runtime.sendMessage({
            type: MESSAGE_TYPES.SET_BLOCKED_COUNTRIES,
            payload: { action: 'remove', country }
        });

        if (response?.success) {
            blockedCountries = response.data || [];
            renderBlockedCountries();
            showSaveStatus();
        }
    } catch (error) {
        console.error('Failed to remove blocked country:', error);
    }
}

/**
 * Save settings
 */
async function saveSettings(newSettings) {
    try {
        currentSettings = { ...currentSettings, ...newSettings };
        
        await browserAPI.runtime.sendMessage({
            type: MESSAGE_TYPES.SET_SETTINGS,
            payload: currentSettings
        });

        showSaveStatus();
    } catch (error) {
        console.error('Failed to save settings:', error);
    }
}

/**
 * Show save status indicator
 */
function showSaveStatus() {
    const status = elements.saveStatus;
    status.classList.add('visible');
    
    setTimeout(() => {
        status.classList.remove('visible');
    }, 2000);
}

/**
 * Setup event listeners
 */
function setupEventListeners() {
    // General settings
    elements.optEnabled.addEventListener('change', (e) => {
        saveSettings({ enabled: e.target.checked });
    });

    elements.optDebug.addEventListener('change', (e) => {
        saveSettings({ debugMode: e.target.checked });
    });

    // Display settings
    elements.optFlags.addEventListener('change', (e) => {
        saveSettings({ showFlags: e.target.checked });
    });

    elements.optDevices.addEventListener('change', (e) => {
        saveSettings({ showDevices: e.target.checked });
    });

    elements.optVpn.addEventListener('change', (e) => {
        saveSettings({ showVpnIndicator: e.target.checked });
    });

    // Sidebar link toggle
    if (elements.optSidebarLink) {
        elements.optSidebarLink.addEventListener('change', (e) => {
            saveSettings({ showSidebarBlockerLink: e.target.checked });
        });
    }

    // Country search with debouncing
    if (elements.countrySearch) {
        const debouncedSearch = debounce(value => {
            renderCountryGrid(value);
        }, TIMING.SEARCH_DEBOUNCE_MS);
        
        elements.countrySearch.addEventListener('input', e => {
            debouncedSearch(e.target.value);
        });
    }

    // Clear all blocked
    if (elements.btnClearBlocked) {
        elements.btnClearBlocked.addEventListener('click', clearAllBlocked);
    }

    // Cloud cache toggle
    if (elements.optCloudCache) {
        elements.optCloudCache.addEventListener('change', async (e) => {
            try {
                const response = await browserAPI.runtime.sendMessage({
                    type: MESSAGE_TYPES.SET_CLOUD_CACHE_ENABLED,
                    payload: { enabled: e.target.checked }
                });
                
                if (response?.success) {
                    // Reload status to update UI
                    await loadCloudCacheStatus();
                    showSaveStatus();
                }
            } catch (error) {
                console.error('Failed to toggle cloud cache:', error);
                e.target.checked = !e.target.checked; // Revert on error
            }
        });
    }

    // Clear cache with confirmation
    elements.btnClearCache.addEventListener('click', async () => {
        // Get current cache size for confirmation
        const cacheCount = elements.cacheSize.textContent;
        
        // Confirm before clearing
        if (cacheCount !== '0' && cacheCount !== '-') {
            const confirmed = confirm(`Are you sure you want to clear ${cacheCount} cached users?\n\nThis will require re-fetching data for all users.`);
            if (!confirmed) return;
        }
        
        try {
            // The actual cache clear is handled by background
            await browserAPI.runtime.sendMessage({
                type: MESSAGE_TYPES.SET_CACHE,
                payload: { action: 'clear' }
            });
            
            elements.cacheSize.textContent = '0';
            showSaveStatus();
        } catch (error) {
            console.error('Failed to clear cache:', error);
        }
    });

    // Sync to cloud
    if (elements.btnSyncToCloud) {
        elements.btnSyncToCloud.addEventListener('click', async () => {
            await handleSyncToCloud();
        });
    }

    // Export cache
    elements.btnExportCache.addEventListener('click', async () => {
        try {
            const response = await browserAPI.runtime.sendMessage({
                type: MESSAGE_TYPES.GET_CACHE,
                payload: {}
            });

            if (response?.success) {
                const data = {
                    exportedAt: new Date().toISOString(),
                    version: VERSION,
                    cache: response.data || [],
                    blockedCountries
                };

                const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                
                const a = document.createElement('a');
                a.href = url;
                a.download = `x-posed-data-${new Date().toISOString().split('T')[0]}.json`;
                a.click();
                
                URL.revokeObjectURL(url);
            }
        } catch (error) {
            console.error('Failed to export data:', error);
        }
    });
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
} else {
    initialize();
}