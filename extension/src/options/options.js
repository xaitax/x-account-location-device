/**
 * Options Page Script
 * Full settings interface for the extension
 */

import browserAPI from '../shared/browser-api.js';
import { MESSAGE_TYPES, VERSION, COUNTRY_FLAGS, COUNTRY_LIST, REGION_LIST, REGION_FLAGS, REGION_NAMES, STORAGE_KEYS, TIMING } from '../shared/constants.js';
import { getFlagEmoji, formatCountryName, applyTheme, debounce } from '../shared/utils.js';

// Region storage uses lowercase keys, but we display proper names

// DOM Elements
const elements = {
    // General
    optEnabled: document.getElementById('opt-enabled'),
    optDebug: document.getElementById('opt-debug'),
    // Display
    optFlags: document.getElementById('opt-flags'),
    optDevices: document.getElementById('opt-devices'),
    optVpn: document.getElementById('opt-vpn'),
    optCaptureButton: document.getElementById('opt-capture-button'),
    optShowVpnUsers: document.getElementById('opt-show-vpn-users'),
    optSidebarLink: document.getElementById('opt-sidebar-link'),
    // Blocking Mode
    optHideBlocked: document.getElementById('opt-hide-blocked'),
    optHighlightBlocked: document.getElementById('opt-highlight-blocked'),
    // Blocked Countries
    blockedList: document.getElementById('blocked-list'),
    blockedCount: document.getElementById('blocked-count'),
    countrySearch: document.getElementById('country-search'),
    countryGrid: document.getElementById('country-grid'),
    btnClearBlocked: document.getElementById('btn-clear-blocked'),
    // Blocked Regions
    blockedRegionsList: document.getElementById('blocked-regions-list'),
    blockedRegionsCount: document.getElementById('blocked-regions-count'),
    regionSearch: document.getElementById('region-search'),
    regionGrid: document.getElementById('region-grid'),
    btnClearBlockedRegions: document.getElementById('btn-clear-blocked-regions'),
    // Tabs
    tabCountries: document.getElementById('tab-countries'),
    tabRegions: document.getElementById('tab-regions'),
    tabTags: document.getElementById('tab-tags'),
    panelCountries: document.getElementById('panel-countries'),
    panelRegions: document.getElementById('panel-regions'),
    panelTags: document.getElementById('panel-tags'),
    // Blocked Tags
    blockedTagsList: document.getElementById('blocked-tags-list'),
    blockedTagsCount: document.getElementById('blocked-tags-count'),
    tagInput: document.getElementById('tag-input'),
    btnAddTag: document.getElementById('btn-add-tag'),
    btnClearBlockedTags: document.getElementById('btn-clear-blocked-tags'),
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
    // Rate limit
    rateLimitBanner: document.getElementById('rate-limit-banner'),
    rateLimitTime: document.getElementById('rate-limit-time'),
    // Cache
    cacheSize: document.getElementById('cache-size'),
    btnClearCache: document.getElementById('btn-clear-cache'),
    btnExportCache: document.getElementById('btn-export-cache'),
    btnImportData: document.getElementById('btn-import-data'),
    importFileInput: document.getElementById('import-file-input'),
    importStatus: document.getElementById('import-status'),
    // About
    version: document.getElementById('version'),
    // Status
    saveStatus: document.getElementById('save-status')
};

let currentSettings = {};
let blockedCountries = [];
let blockedRegions = [];
let blockedTags = [];
let rateLimitMonitorInterval = null;

/**
 * Initialize options page
 */
async function initialize() {
    // Load and apply theme first
    await loadTheme();

    // Keep cloud total updated even if the initial /stats call is slow.
    // Background writes cached stats to storage (stale-while-revalidate).
    try {
        const onChanged = (changes, areaName) => {
            if (areaName !== 'local') return;
            const change = changes?.[STORAGE_KEYS.CLOUD_SERVER_STATS];
            if (!change?.newValue) return;

            const total = change.newValue?.data?.totalEntries;
            if (typeof total === 'number' && elements.cloudTotalEntries) {
                elements.cloudTotalEntries.textContent = total.toLocaleString();
            }
        };

        browserAPI.storage.onChanged.addListener(onChanged);
        window.addEventListener('beforeunload', () => {
            try {
                browserAPI.storage.onChanged.removeListener(onChanged);
            } catch {
                // ignore
            }
        });

        // Also show whatever we already have cached immediately (no network wait).
        const initial = await browserAPI.storage.local.get(STORAGE_KEYS.CLOUD_SERVER_STATS);
        const initialTotal = initial?.[STORAGE_KEYS.CLOUD_SERVER_STATS]?.data?.totalEntries;
        if (typeof initialTotal === 'number' && elements.cloudTotalEntries) {
            elements.cloudTotalEntries.textContent = initialTotal.toLocaleString();
        }
    } catch {
        // ignore
    }
    
    // Set version
    if (elements.version) {
        elements.version.textContent = VERSION;
    }

    // Check for "What's New" parameter or flag
    await checkWhatsNew();

    // Load current settings
    await loadSettings();
    await loadBlockedCountries();
    await loadBlockedRegions();
    await loadBlockedTags();
    await loadCacheStats();
    await loadStatistics();
    await loadCloudCacheStatus();
    await loadRateLimitStatus();

    // Setup event listeners
    setupEventListeners();
    
    // Start rate limit monitor
    startRateLimitMonitor();
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
            if (elements.optCaptureButton) {
                elements.optCaptureButton.checked = currentSettings.showCaptureButton !== false;
            }
            if (elements.optSidebarLink) {
                elements.optSidebarLink.checked = currentSettings.showSidebarBlockerLink !== false;
            }
            if (elements.optShowVpnUsers) {
                elements.optShowVpnUsers.checked = currentSettings.showVpnUsers !== false;
            }
            
            // Blocking mode toggles - mutually exclusive
            const highlightMode = currentSettings.highlightBlockedTweets === true;
            if (elements.optHideBlocked) {
                elements.optHideBlocked.checked = !highlightMode;
            }
            if (elements.optHighlightBlocked) {
                elements.optHighlightBlocked.checked = highlightMode;
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
 * Load blocked regions
 */
async function loadBlockedRegions() {
    try {
        const response = await browserAPI.runtime.sendMessage({
            type: MESSAGE_TYPES.GET_BLOCKED_REGIONS
        });

        if (response?.success) {
            blockedRegions = response.data || [];
            renderBlockedRegions();
            renderRegionGrid();
            updateBlockedRegionsCount();
        }
    } catch (error) {
        console.error('Failed to load blocked regions:', error);
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
 * Update blocked regions count badge
 */
function updateBlockedRegionsCount() {
    if (elements.blockedRegionsCount) {
        elements.blockedRegionsCount.textContent = blockedRegions.length;
        elements.blockedRegionsCount.style.display = blockedRegions.length > 0 ? 'inline-flex' : 'none';
    }
}

/**
 * Load blocked tags
 */
async function loadBlockedTags() {
    try {
        const response = await browserAPI.runtime.sendMessage({
            type: MESSAGE_TYPES.GET_BLOCKED_TAGS
        });

        if (response?.success) {
            blockedTags = response.data || [];
            renderBlockedTags();
            updateBlockedTagsCount();
        }
    } catch (error) {
        console.error('Failed to load blocked tags:', error);
    }
}

/**
 * Update blocked tags count badge
 */
function updateBlockedTagsCount() {
    if (elements.blockedTagsCount) {
        elements.blockedTagsCount.textContent = blockedTags.length;
        elements.blockedTagsCount.style.display = blockedTags.length > 0 ? 'inline-flex' : 'none';
    }
}

/**
 * Render blocked tags list
 */
function renderBlockedTags() {
    const list = elements.blockedTagsList;
    if (!list) return;
    
    // Clear list safely
    list.replaceChildren();
    
    if (blockedTags.length === 0) {
        const emptyState = document.createElement('p');
        emptyState.className = 'empty-state';
        emptyState.textContent = 'No tags blocked';
        list.appendChild(emptyState);
        return;
    }
    
    for (const tag of blockedTags.sort()) {
        const item = document.createElement('div');
        item.className = 'blocked-item';
        
        // Build blocked-item-info
        const itemInfo = document.createElement('div');
        itemInfo.className = 'blocked-item-info';
        
        // Tag display
        const tagSpan = document.createElement('span');
        tagSpan.className = 'blocked-tag-text';
        tagSpan.textContent = tag;
        itemInfo.appendChild(tagSpan);
        
        item.appendChild(itemInfo);
        
        // Remove button
        const removeBtn = document.createElement('button');
        removeBtn.className = 'blocked-remove';
        removeBtn.dataset.tag = tag;
        removeBtn.setAttribute('aria-label', `Remove ${tag}`);
        
        const removeSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        removeSvg.setAttribute('viewBox', '0 0 24 24');
        removeSvg.setAttribute('width', '16');
        removeSvg.setAttribute('height', '16');
        const removePath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        removePath.setAttribute('fill', 'currentColor');
        removePath.setAttribute('d', 'M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z');
        removeSvg.appendChild(removePath);
        removeBtn.appendChild(removeSvg);
        
        // Add event handler directly
        removeBtn.addEventListener('click', async () => {
            await removeBlockedTag(tag);
        });
        
        item.appendChild(removeBtn);
        list.appendChild(item);
    }
}

/**
 * Add a new blocked tag
 */
async function addBlockedTag(tag) {
    if (!tag || tag.trim() === '') return;
    
    try {
        const response = await browserAPI.runtime.sendMessage({
            type: MESSAGE_TYPES.SET_BLOCKED_TAGS,
            payload: { action: 'add', tag: tag.trim() }
        });

        if (response?.success) {
            blockedTags = response.data || [];
            renderBlockedTags();
            updateBlockedTagsCount();
            showSaveStatus();
        }
    } catch (error) {
        console.error('Failed to add blocked tag:', error);
    }
}

/**
 * Remove a blocked tag
 */
async function removeBlockedTag(tag) {
    try {
        const response = await browserAPI.runtime.sendMessage({
            type: MESSAGE_TYPES.SET_BLOCKED_TAGS,
            payload: { action: 'remove', tag }
        });

        if (response?.success) {
            blockedTags = response.data || [];
            renderBlockedTags();
            updateBlockedTagsCount();
            showSaveStatus();
        }
    } catch (error) {
        console.error('Failed to remove blocked tag:', error);
    }
}

/**
 * Clear all blocked tags
 */
async function clearAllBlockedTags() {
    if (blockedTags.length === 0) return;
    
    if (!confirm('Are you sure you want to unblock all tags?')) return;
    
    try {
        const response = await browserAPI.runtime.sendMessage({
            type: MESSAGE_TYPES.SET_BLOCKED_TAGS,
            payload: { action: 'clear' }
        });

        if (response?.success) {
            blockedTags = [];
            renderBlockedTags();
            updateBlockedTagsCount();
            showSaveStatus();
        }
    } catch (error) {
        console.error('Failed to clear blocked tags:', error);
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
    
    // Clear container safely
    elements.countryGrid.replaceChildren();
    
    // Show empty result message
    if (filteredCountries.length === 0) {
        const emptyState = document.createElement('div');
        emptyState.className = 'empty-state';
        emptyState.textContent = 'No countries match your search';
        elements.countryGrid.appendChild(emptyState);
        return;
    }
    
    for (const country of filteredCountries) {
        const isBlocked = blockedCountries.includes(country);
        const item = document.createElement('div');
        item.className = `country-item${isBlocked ? ' blocked' : ''}`;
        item.dataset.country = country;
        
        // Build flag span safely
        const flagSpan = document.createElement('span');
        flagSpan.className = 'country-item-flag';
        const flag = getFlagEmoji(country);
        if (typeof flag === 'string' && flag.startsWith('<img')) {
            // Parse Twemoji img tag safely - only allow trusted CDN
            const srcMatch = flag.match(/src="(https:\/\/abs-0\.twimg\.com\/emoji\/v2\/svg\/[^"]+\.svg)"/);
            if (srcMatch && srcMatch[1]) {
                const imgEl = document.createElement('img');
                imgEl.src = srcMatch[1];
                imgEl.className = 'x-flag-emoji';
                imgEl.alt = country;
                imgEl.style.cssText = 'height: 1.2em; vertical-align: -0.2em;';
                flagSpan.appendChild(imgEl);
            } else {
                flagSpan.textContent = '🌍';
            }
        } else {
            flagSpan.textContent = flag || '🌍';
        }
        
        // Build name span
        const nameSpan = document.createElement('span');
        nameSpan.className = 'country-item-name';
        nameSpan.textContent = formatCountryName(country);
        
        // Assemble item
        item.appendChild(flagSpan);
        item.appendChild(nameSpan);
        
        // Add blocked indicator if needed
        if (isBlocked) {
            const blockedSpan = document.createElement('span');
            blockedSpan.className = 'country-item-blocked';
            blockedSpan.textContent = '✓';
            item.appendChild(blockedSpan);
        }
        
        item.addEventListener('click', () => toggleCountry(country));
        elements.countryGrid.appendChild(item);
    }
}

/**
 * Render the region grid for selection
 * REGION_LIST is now array of {name, key, flag} objects
 */
function renderRegionGrid(filter = '') {
    if (!elements.regionGrid) return;
    
    const filterLower = filter.toLowerCase();
    const filteredRegions = REGION_LIST.filter(region =>
        region.name.toLowerCase().includes(filterLower) ||
        region.key.toLowerCase().includes(filterLower)
    );
    
    // Clear container safely
    elements.regionGrid.replaceChildren();
    
    // Show empty result message
    if (filteredRegions.length === 0) {
        const emptyState = document.createElement('div');
        emptyState.className = 'empty-state';
        emptyState.textContent = 'No regions match your search';
        elements.regionGrid.appendChild(emptyState);
        return;
    }
    
    for (const region of filteredRegions) {
        const isBlocked = blockedRegions.includes(region.key);
        const item = document.createElement('div');
        item.className = `country-item region-item${isBlocked ? ' blocked' : ''}`;
        item.dataset.region = region.key;
        
        // Build flag span
        const flagSpan = document.createElement('span');
        flagSpan.className = 'country-item-flag region-item-flag';
        flagSpan.textContent = region.flag;
        
        // Build name span - use proper display name
        const nameSpan = document.createElement('span');
        nameSpan.className = 'country-item-name';
        nameSpan.textContent = region.name;
        
        // Assemble item
        item.appendChild(flagSpan);
        item.appendChild(nameSpan);
        
        // Add blocked indicator if needed
        if (isBlocked) {
            const blockedSpan = document.createElement('span');
            blockedSpan.className = 'country-item-blocked';
            blockedSpan.textContent = '✓';
            item.appendChild(blockedSpan);
        }
        
        item.addEventListener('click', () => toggleRegion(region.key));
        elements.regionGrid.appendChild(item);
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
 * Toggle a region's blocked status
 */
async function toggleRegion(region) {
    try {
        const response = await browserAPI.runtime.sendMessage({
            type: MESSAGE_TYPES.SET_BLOCKED_REGIONS,
            payload: { action: 'toggle', region }
        });

        if (response?.success) {
            blockedRegions = response.data || [];
            renderBlockedRegions();
            renderRegionGrid(elements.regionSearch?.value || '');
            updateBlockedRegionsCount();
            showSaveStatus();
        }
    } catch (error) {
        console.error('Failed to toggle region:', error);
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
 * Clear all blocked regions
 */
async function clearAllBlockedRegions() {
    if (blockedRegions.length === 0) return;
    
    if (!confirm('Are you sure you want to unblock all regions?')) return;
    
    try {
        const response = await browserAPI.runtime.sendMessage({
            type: MESSAGE_TYPES.SET_BLOCKED_REGIONS,
            payload: { action: 'clear' }
        });

        if (response?.success) {
            blockedRegions = [];
            renderBlockedRegions();
            renderRegionGrid(elements.regionSearch?.value || '');
            updateBlockedRegionsCount();
            showSaveStatus();
        }
    } catch (error) {
        console.error('Failed to clear blocked regions:', error);
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
                // Exact number (no K/M abbreviation)
                elements.cloudTotalEntries.textContent = Number(total).toLocaleString();
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
        // Rebuild button content safely without innerHTML
        btn.replaceChildren();
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('width', '16');
        svg.setAttribute('height', '16');
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('fill', 'currentColor');
        path.setAttribute('d', 'M19.35 10.04C18.67 6.59 15.64 4 12 4c-1.48 0-2.85.43-4.01 1.17l1.46 1.46C10.21 6.23 11.08 6 12 6c3.04 0 5.5 2.46 5.5 5.5v.5H19c1.66 0 3 1.34 3 3 0 1.13-.64 2.11-1.56 2.62l1.45 1.45C23.16 18.16 24 16.68 24 15c0-2.64-2.05-4.78-4.65-4.96zM3 5.27l2.75 2.74C2.56 8.15 0 10.77 0 14c0 3.31 2.69 6 6 6h11.73l2 2L21 20.73 4.27 4 3 5.27zM7.73 10l8 8H6c-2.21 0-4-1.79-4-4s1.79-4 4-4h1.73z');
        svg.appendChild(path);
        btn.appendChild(svg);
        btn.appendChild(document.createTextNode(' Sync Local Cache to Cloud'));
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
    
    // Clear existing content safely
    statsSection.replaceChildren();
    
    const vpnPercentage = stats.totalUsers > 0 ? Math.round((stats.vpnCount / stats.totalUsers) * 100) : 0;
    
    // Build section title
    const sectionTitle = document.createElement('h2');
    sectionTitle.className = 'section-title';
    
    const titleSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    titleSvg.setAttribute('viewBox', '0 0 24 24');
    titleSvg.setAttribute('width', '20');
    titleSvg.setAttribute('height', '20');
    const titlePath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    titlePath.setAttribute('fill', 'currentColor');
    titlePath.setAttribute('d', 'M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4z');
    titleSvg.appendChild(titlePath);
    sectionTitle.appendChild(titleSvg);
    sectionTitle.appendChild(document.createTextNode(' Statistics'));
    statsSection.appendChild(sectionTitle);
    
    // Build stats overview
    const statsOverview = document.createElement('div');
    statsOverview.className = 'stats-overview';
    
    // Total Users item
    const totalUsersItem = createStatsOverviewItem(String(stats.totalUsers), 'Total Users');
    statsOverview.appendChild(totalUsersItem);
    
    // Countries item
    const countriesItem = createStatsOverviewItem(String(Object.keys(stats.countryCounts).length), 'Countries');
    statsOverview.appendChild(countriesItem);
    
    // VPN item
    const vpnItem = createStatsOverviewItem(String(stats.vpnCount), `🔒 VPN/Proxy (${vpnPercentage}%)`);
    statsOverview.appendChild(vpnItem);
    
    statsSection.appendChild(statsOverview);
    
    // Top Countries subsection
    if (stats.topCountries.length > 0) {
        const countriesSubsection = document.createElement('div');
        countriesSubsection.className = 'stats-subsection';
        
        const countriesSubtitle = document.createElement('h3');
        countriesSubtitle.className = 'stats-subtitle';
        countriesSubtitle.textContent = 'Top Countries';
        countriesSubsection.appendChild(countriesSubtitle);
        
        const statBars = document.createElement('div');
        statBars.className = 'stat-bars';
        
        for (const c of stats.topCountries.slice(0, 5)) {
            const barItem = document.createElement('div');
            barItem.className = 'stat-bar-item';
            
            const barLabel = document.createElement('div');
            barLabel.className = 'stat-bar-label';
            
            const countrySpan = document.createElement('span');
            countrySpan.textContent = `${COUNTRY_FLAGS[c.country] || '🌍'} ${formatCountryName(c.country)}`;
            barLabel.appendChild(countrySpan);
            
            const countSpan = document.createElement('span');
            countSpan.textContent = `${c.count} (${c.percentage}%)`;
            barLabel.appendChild(countSpan);
            
            barItem.appendChild(barLabel);
            
            const bar = document.createElement('div');
            bar.className = 'stat-bar';
            const barFill = document.createElement('div');
            barFill.className = 'stat-bar-fill';
            barFill.style.width = `${c.percentage}%`;
            bar.appendChild(barFill);
            barItem.appendChild(bar);
            
            statBars.appendChild(barItem);
        }
        
        countriesSubsection.appendChild(statBars);
        statsSection.appendChild(countriesSubsection);
    }
    
    // Device Distribution subsection
    if (stats.topDevices.length > 0) {
        const devicesSubsection = document.createElement('div');
        devicesSubsection.className = 'stats-subsection';
        
        const devicesSubtitle = document.createElement('h3');
        devicesSubtitle.className = 'stats-subtitle';
        devicesSubtitle.textContent = 'Device Distribution';
        devicesSubsection.appendChild(devicesSubtitle);
        
        const deviceStats = document.createElement('div');
        deviceStats.className = 'device-stats';
        
        for (const d of stats.topDevices) {
            const deviceStat = document.createElement('div');
            deviceStat.className = 'device-stat';
            
            const iconSpan = document.createElement('span');
            iconSpan.className = 'device-icon';
            iconSpan.textContent = d.device === 'iOS' ? '🍎' : d.device === 'Android' ? '🤖' : d.device === 'Web' ? '🌐' : '❓';
            deviceStat.appendChild(iconSpan);
            
            const nameSpan = document.createElement('span');
            nameSpan.className = 'device-name';
            nameSpan.textContent = d.device;
            deviceStat.appendChild(nameSpan);
            
            const countSpan = document.createElement('span');
            countSpan.className = 'device-count';
            countSpan.textContent = `${d.count} (${d.percentage}%)`;
            deviceStat.appendChild(countSpan);
            
            deviceStats.appendChild(deviceStat);
        }
        
        devicesSubsection.appendChild(deviceStats);
        statsSection.appendChild(devicesSubsection);
    }
}

/**
 * Helper to create stats overview item
 */
function createStatsOverviewItem(value, label) {
    const item = document.createElement('div');
    item.className = 'stats-overview-item';
    
    const valueSpan = document.createElement('span');
    valueSpan.className = 'stats-overview-value';
    valueSpan.textContent = value;
    item.appendChild(valueSpan);
    
    const labelSpan = document.createElement('span');
    labelSpan.className = 'stats-overview-label';
    labelSpan.textContent = label;
    item.appendChild(labelSpan);
    
    return item;
}

/**
 * Render blocked countries list
 */
function renderBlockedCountries() {
    const list = elements.blockedList;
    
    // Clear list safely
    list.replaceChildren();
    
    if (blockedCountries.length === 0) {
        const emptyState = document.createElement('p');
        emptyState.className = 'empty-state';
        emptyState.textContent = 'No countries blocked';
        list.appendChild(emptyState);
        return;
    }
    
    for (const country of blockedCountries.sort()) {
        const item = document.createElement('div');
        item.className = 'blocked-item';
        
        // Build blocked-item-info
        const itemInfo = document.createElement('div');
        itemInfo.className = 'blocked-item-info';
        
        // Flag span
        const flagSpan = document.createElement('span');
        flagSpan.className = 'blocked-flag';
        const flag = getFlagEmoji(country);
        if (typeof flag === 'string' && flag.startsWith('<img')) {
            // Parse Twemoji img tag safely
            const srcMatch = flag.match(/src="(https:\/\/abs-0\.twimg\.com\/emoji\/v2\/svg\/[^"]+\.svg)"/);
            if (srcMatch && srcMatch[1]) {
                const imgEl = document.createElement('img');
                imgEl.src = srcMatch[1];
                imgEl.className = 'x-flag-emoji';
                imgEl.alt = country;
                imgEl.style.cssText = 'height: 1.2em; vertical-align: -0.2em;';
                flagSpan.appendChild(imgEl);
            } else {
                flagSpan.textContent = '🌍';
            }
        } else {
            flagSpan.textContent = flag || '🌍';
        }
        itemInfo.appendChild(flagSpan);
        
        // Name span
        const nameSpan = document.createElement('span');
        nameSpan.className = 'blocked-name';
        nameSpan.textContent = formatCountryName(country);
        itemInfo.appendChild(nameSpan);
        
        item.appendChild(itemInfo);
        
        // Remove button
        const removeBtn = document.createElement('button');
        removeBtn.className = 'blocked-remove';
        removeBtn.dataset.country = country;
        removeBtn.setAttribute('aria-label', `Remove ${formatCountryName(country)}`);
        
        const removeSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        removeSvg.setAttribute('viewBox', '0 0 24 24');
        removeSvg.setAttribute('width', '16');
        removeSvg.setAttribute('height', '16');
        const removePath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        removePath.setAttribute('fill', 'currentColor');
        removePath.setAttribute('d', 'M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z');
        removeSvg.appendChild(removePath);
        removeBtn.appendChild(removeSvg);
        
        // Add event handler directly
        removeBtn.addEventListener('click', async () => {
            await removeBlockedCountry(country);
        });
        
        item.appendChild(removeBtn);
        list.appendChild(item);
    }
}

/**
 * Render blocked regions list
 */
function renderBlockedRegions() {
    const list = elements.blockedRegionsList;
    if (!list) return;
    
    // Clear list safely
    list.replaceChildren();
    
    if (blockedRegions.length === 0) {
        const emptyState = document.createElement('p');
        emptyState.className = 'empty-state';
        emptyState.textContent = 'No regions blocked';
        list.appendChild(emptyState);
        return;
    }
    
    for (const region of blockedRegions.sort()) {
        const item = document.createElement('div');
        item.className = 'blocked-item';
        
        // Build blocked-item-info
        const itemInfo = document.createElement('div');
        itemInfo.className = 'blocked-item-info';
        
        // Flag span
        const flagSpan = document.createElement('span');
        flagSpan.className = 'blocked-flag';
        flagSpan.textContent = REGION_FLAGS[region] || '🌐';
        itemInfo.appendChild(flagSpan);
        
        // Name span - use proper display name from REGION_NAMES
        const nameSpan = document.createElement('span');
        nameSpan.className = 'blocked-name';
        nameSpan.textContent = REGION_NAMES[region] || region;
        itemInfo.appendChild(nameSpan);
        
        item.appendChild(itemInfo);
        
        // Remove button
        const removeBtn = document.createElement('button');
        removeBtn.className = 'blocked-remove';
        removeBtn.dataset.region = region;
        removeBtn.setAttribute('aria-label', `Remove ${region}`);
        
        const removeSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        removeSvg.setAttribute('viewBox', '0 0 24 24');
        removeSvg.setAttribute('width', '16');
        removeSvg.setAttribute('height', '16');
        const removePath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        removePath.setAttribute('fill', 'currentColor');
        removePath.setAttribute('d', 'M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z');
        removeSvg.appendChild(removePath);
        removeBtn.appendChild(removeSvg);
        
        // Add event handler directly
        removeBtn.addEventListener('click', async () => {
            await removeBlockedRegion(region);
        });
        
        item.appendChild(removeBtn);
        list.appendChild(item);
    }
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
            renderCountryGrid(elements.countrySearch?.value || '');
            updateBlockedCount();
            showSaveStatus();
        }
    } catch (error) {
        console.error('Failed to remove blocked country:', error);
    }
}

/**
 * Remove a blocked region
 */
async function removeBlockedRegion(region) {
    try {
        const response = await browserAPI.runtime.sendMessage({
            type: MESSAGE_TYPES.SET_BLOCKED_REGIONS,
            payload: { action: 'remove', region }
        });

        if (response?.success) {
            blockedRegions = response.data || [];
            renderBlockedRegions();
            renderRegionGrid(elements.regionSearch?.value || '');
            updateBlockedRegionsCount();
            showSaveStatus();
        }
    } catch (error) {
        console.error('Failed to remove blocked region:', error);
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
    elements.optEnabled.addEventListener('change', e => {
        saveSettings({ enabled: e.target.checked });
    });

    elements.optDebug.addEventListener('change', e => {
        saveSettings({ debugMode: e.target.checked });
    });

    // Display settings
    elements.optFlags.addEventListener('change', e => {
        saveSettings({ showFlags: e.target.checked });
    });

    elements.optDevices.addEventListener('change', e => {
        saveSettings({ showDevices: e.target.checked });
    });

    elements.optVpn.addEventListener('change', e => {
        saveSettings({ showVpnIndicator: e.target.checked });
    });

    // Capture button toggle
    if (elements.optCaptureButton) {
        elements.optCaptureButton.addEventListener('change', e => {
            saveSettings({ showCaptureButton: e.target.checked });
        });
    }

    // Sidebar link toggle
    if (elements.optSidebarLink) {
        elements.optSidebarLink.addEventListener('change', e => {
            saveSettings({ showSidebarBlockerLink: e.target.checked });
        });
    }

    // Show VPN users toggle
    if (elements.optShowVpnUsers) {
        elements.optShowVpnUsers.addEventListener('change', e => {
            saveSettings({ showVpnUsers: e.target.checked });
        });
    }

    // Blocking mode toggles - mutually exclusive
    if (elements.optHideBlocked && elements.optHighlightBlocked) {
        elements.optHideBlocked.addEventListener('change', e => {
            if (e.target.checked) {
                elements.optHighlightBlocked.checked = false;
                saveSettings({ highlightBlockedTweets: false });
            } else {
                // At least one must be selected - turn on highlight
                elements.optHighlightBlocked.checked = true;
                saveSettings({ highlightBlockedTweets: true });
            }
        });

        elements.optHighlightBlocked.addEventListener('change', e => {
            if (e.target.checked) {
                elements.optHideBlocked.checked = false;
                saveSettings({ highlightBlockedTweets: true });
            } else {
                // At least one must be selected - turn on hide
                elements.optHideBlocked.checked = true;
                saveSettings({ highlightBlockedTweets: false });
            }
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

    // Clear all blocked regions
    if (elements.btnClearBlockedRegions) {
        elements.btnClearBlockedRegions.addEventListener('click', clearAllBlockedRegions);
    }

    // Region search with debouncing
    if (elements.regionSearch) {
        const debouncedRegionSearch = debounce(value => {
            renderRegionGrid(value);
        }, TIMING.SEARCH_DEBOUNCE_MS);
        
        elements.regionSearch.addEventListener('input', e => {
            debouncedRegionSearch(e.target.value);
        });
    }

    // Tab switching for blocked locations (Countries, Regions, Tags)
    if (elements.tabCountries && elements.tabRegions && elements.tabTags) {
        const switchBlockedTab = tab => {
            // Update tab active states
            elements.tabCountries.classList.toggle('active', tab === 'countries');
            elements.tabRegions.classList.toggle('active', tab === 'regions');
            elements.tabTags.classList.toggle('active', tab === 'tags');
            
            // Show/hide panels
            if (elements.panelCountries) {
                elements.panelCountries.style.display = tab === 'countries' ? 'block' : 'none';
            }
            if (elements.panelRegions) {
                elements.panelRegions.style.display = tab === 'regions' ? 'block' : 'none';
            }
            if (elements.panelTags) {
                elements.panelTags.style.display = tab === 'tags' ? 'block' : 'none';
            }
        };
        
        elements.tabCountries.addEventListener('click', () => switchBlockedTab('countries'));
        elements.tabRegions.addEventListener('click', () => switchBlockedTab('regions'));
        elements.tabTags.addEventListener('click', () => switchBlockedTab('tags'));
    }

    // Tags: Add tag button
    if (elements.btnAddTag && elements.tagInput) {
        elements.btnAddTag.addEventListener('click', async () => {
            const tag = elements.tagInput.value.trim();
            if (tag) {
                await addBlockedTag(tag);
                elements.tagInput.value = '';
            }
        });
        
        // Also allow Enter key to add tag
        elements.tagInput.addEventListener('keydown', e => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const tag = elements.tagInput.value.trim();
                if (tag) {
                    addBlockedTag(tag);
                    elements.tagInput.value = '';
                }
            }
        });
    }

    // Clear all blocked tags
    if (elements.btnClearBlockedTags) {
        elements.btnClearBlockedTags.addEventListener('click', clearAllBlockedTags);
    }

    // Cloud cache toggle
    if (elements.optCloudCache) {
        elements.optCloudCache.addEventListener('change', async e => {
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

    // Export data (enhanced with settings)
    elements.btnExportCache.addEventListener('click', async () => {
        try {
            // Get cache
            const cacheResponse = await browserAPI.runtime.sendMessage({
                type: MESSAGE_TYPES.GET_CACHE,
                payload: {}
            });

            // Get settings
            const settingsResponse = await browserAPI.runtime.sendMessage({
                type: MESSAGE_TYPES.GET_SETTINGS
            });

            const data = {
                // Metadata
                exportedAt: new Date().toISOString(),
                version: VERSION,
                exportFormat: '2.2',
                
                // Configuration
                settings: settingsResponse?.data || currentSettings,
                blockedCountries,
                blockedRegions,
                blockedTags,
                
                // User data
                cache: cacheResponse?.data || []
            };

            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            
            const a = document.createElement('a');
            a.href = url;
            a.download = `x-posed-backup-${new Date().toISOString().split('T')[0]}.json`;
            a.click();
            
            URL.revokeObjectURL(url);
            
            showSaveStatus();
        } catch (error) {
            console.error('Failed to export data:', error);
            alert('Failed to export data. Please try again.');
        }
    });

    // Import data button click
    if (elements.btnImportData && elements.importFileInput) {
        elements.btnImportData.addEventListener('click', () => {
            elements.importFileInput.click();
        });

        elements.importFileInput.addEventListener('change', async e => {
            const file = e.target.files?.[0];
            if (!file) return;

            try {
                await handleImportFile(file);
            } finally {
                // Reset file input so same file can be selected again
                elements.importFileInput.value = '';
            }
        });
    }
}

/**
 * Handle importing data from a file
 */
async function handleImportFile(file) {
    const statusEl = elements.importStatus;
    
    const showStatus = (message, isError = false) => {
        if (statusEl) {
            statusEl.textContent = message;
            statusEl.className = `import-status ${isError ? 'error' : 'success'}`;
            statusEl.style.display = 'block';
            
            // Auto-hide after 5 seconds
            setTimeout(() => {
                statusEl.style.display = 'none';
            }, 5000);
        }
    };

    try {
        // Read file
        const text = await file.text();
        let data;
        
        try {
            data = JSON.parse(text);
        } catch (parseError) {
            showStatus('Invalid JSON file. Please select a valid X-Posed backup file.', true);
            return;
        }

        // Validate structure
        if (!data || typeof data !== 'object') {
            showStatus('Invalid file format. Please select a valid X-Posed backup file.', true);
            return;
        }

        // Check for required fields (at least version or exportFormat)
        if (!data.version && !data.exportFormat) {
            showStatus('This doesn\'t appear to be an X-Posed backup file.', true);
            return;
        }

        // Confirm import
        const cacheCount = Array.isArray(data.cache) ? data.cache.length : 0;
        const blockedCount = Array.isArray(data.blockedCountries) ? data.blockedCountries.length : 0;
        const blockedRegionsCount = Array.isArray(data.blockedRegions) ? data.blockedRegions.length : 0;
        const blockedTagsCount = Array.isArray(data.blockedTags) ? data.blockedTags.length : 0;
        const hasSettings = data.settings && typeof data.settings === 'object';
        
        const confirmMessage = [
            `Import data from ${data.version ? `v${data.version}` : 'X-Posed'}?`,
            '',
            'This will import:',
            hasSettings ? '• Settings (display options, etc.)' : '',
            blockedCount > 0 ? `• ${blockedCount} blocked countries` : '',
            blockedRegionsCount > 0 ? `• ${blockedRegionsCount} blocked regions` : '',
            blockedTagsCount > 0 ? `• ${blockedTagsCount} blocked tags` : '',
            cacheCount > 0 ? `• ${cacheCount} cached users` : '',
            '',
            `Exported on: ${data.exportedAt ? new Date(data.exportedAt).toLocaleString() : 'Unknown'}`,
            '',
            'This will replace your current configuration. Continue?'
        ].filter(Boolean).join('\n');

        if (!confirm(confirmMessage)) {
            return;
        }

        // Perform import
        const response = await browserAPI.runtime.sendMessage({
            type: MESSAGE_TYPES.IMPORT_DATA,
            payload: {
                settings: data.settings,
                blockedCountries: data.blockedCountries,
                blockedRegions: data.blockedRegions,
                blockedTags: data.blockedTags,
                cache: data.cache
            }
        });

        if (response?.success) {
            const results = [];
            if (response.importedSettings) results.push('settings');
            if (response.importedBlockedCountries) results.push(`${response.importedBlockedCountries} blocked countries`);
            if (response.importedBlockedRegions) results.push(`${response.importedBlockedRegions} blocked regions`);
            if (response.importedBlockedTags) results.push(`${response.importedBlockedTags} blocked tags`);
            if (response.importedCache) results.push(`${response.importedCache} cached users`);
            
            showStatus(`✓ Successfully imported: ${results.join(', ')}`);
            
            // Reload the page data to reflect imported settings
            await loadSettings();
            await loadBlockedCountries();
            await loadBlockedRegions();
            await loadBlockedTags();
            await loadCacheStats();
            await loadStatistics();
        } else {
            showStatus(`Import failed: ${response?.error || 'Unknown error'}`, true);
        }
    } catch (error) {
        console.error('Import error:', error);
        showStatus(`Import failed: ${error.message}`, true);
    }
}

/**
 * Load rate limit status from background
 */
async function loadRateLimitStatus() {
    try {
        const response = await browserAPI.runtime.sendMessage({
            type: MESSAGE_TYPES.GET_RATE_LIMIT_STATUS
        });
        
        if (response) {
            updateRateLimitBanner(response);
        }
    } catch (error) {
        console.debug('Failed to load rate limit status:', error);
    }
}

/**
 * Update rate limit banner UI
 */
function updateRateLimitBanner(status) {
    const banner = elements.rateLimitBanner;
    const timeEl = elements.rateLimitTime;
    
    if (!banner) return;
    
    if (status.isRateLimited) {
        banner.style.display = 'flex';
        banner.className = 'rate-limit-banner rate-limited';
        banner.querySelector('.rate-limit-icon').textContent = '⚠️';
        banner.querySelector('.rate-limit-title').textContent = 'Rate Limited';
        
        if (timeEl && status.resetTime) {
            const resetDate = new Date(status.resetTime);
            const now = new Date();
            const diffMs = resetDate - now;
            
            if (diffMs > 0) {
                const minutes = Math.ceil(diffMs / 60000);
                timeEl.textContent = `Resets in ~${minutes} minute${minutes !== 1 ? 's' : ''}`;
            } else {
                timeEl.textContent = 'Resetting soon...';
            }
        }
    } else {
        // Show OK status
        banner.style.display = 'flex';
        banner.className = 'rate-limit-banner rate-ok';
        banner.querySelector('.rate-limit-icon').textContent = '✅';
        banner.querySelector('.rate-limit-title').textContent = 'API Status: OK';
        if (timeEl) {
            timeEl.textContent = 'No rate limits active';
        }
    }
}

/**
 * Start periodic rate limit status monitoring
 */
function startRateLimitMonitor() {
    // Update every 10 seconds
    rateLimitMonitorInterval = setInterval(loadRateLimitStatus, TIMING.RATE_LIMIT_CHECK_MS);
    
    // Cleanup on page unload
    window.addEventListener('beforeunload', () => {
        if (rateLimitMonitorInterval) {
            clearInterval(rateLimitMonitorInterval);
        }
    });
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
} else {
    initialize();
}
