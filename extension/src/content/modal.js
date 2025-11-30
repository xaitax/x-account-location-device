/**
 * Country/Region Blocker Modal Component
 * Provides UI for blocking/unblocking countries and regions
 * Uses tabbed interface for switching between countries and regions
 */

import { COUNTRY_LIST, REGION_LIST, CSS_CLASSES, TIMING } from '../shared/constants.js';
import { getFlagEmoji, formatCountryName, createElement, debounce } from '../shared/utils.js';

// Track blocked sets globally for proper syncing
let localBlockedCountries = null;
let localBlockedRegions = null;

let currentModal = null;

// Memoized filtering for performance
let cachedFilteredCountries = null;
let cachedCountryFilter = '';
let cachedFilteredRegions = null;
let cachedRegionFilter = '';

// Current tab state
let activeTab = 'countries';

/**
 * Show the blocker modal
 * @param {Set} blockedCountries - Set of currently blocked countries
 * @param {Set} blockedRegions - Set of currently blocked regions
 * @param {Function} onCountryAction - Callback for country actions
 * @param {Function} onRegionAction - Callback for region actions
 */
export function showModal(blockedCountries, blockedRegions, onCountryAction, onRegionAction) {
    // Remove existing modal if present
    if (currentModal) {
        currentModal.remove();
        currentModal = null;
    }

    // Store references for syncing
    localBlockedCountries = blockedCountries;
    localBlockedRegions = blockedRegions;

    // Reset active tab
    activeTab = 'countries';

    const overlay = createElement('div', {
        className: CSS_CLASSES.MODAL_OVERLAY
    });

    const modal = createElement('div', {
        className: CSS_CLASSES.MODAL
    });

    // Create header
    const header = createHeader(() => {
        overlay.remove();
        currentModal = null;
    });

    // Create tab bar
    const { tabBar, switchTab } = createTabBar();

    // Create bodies for both tabs
    const { body: countryBody, renderCountries, searchInput: countrySearch } = createCountryBody(blockedCountries, onCountryAction);
    const { body: regionBody, renderRegions, searchInput: regionSearch } = createRegionBody(blockedRegions, onRegionAction);

    // Tab content container
    const tabContent = createElement('div', { className: 'x-blocker-tab-content' });
    tabContent.appendChild(countryBody);
    tabContent.appendChild(regionBody);

    // Initially show countries tab
    countryBody.style.display = 'block';
    regionBody.style.display = 'none';

    // Tab switching logic
    const handleTabSwitch = tab => {
        activeTab = tab;
        switchTab(tab);
        
        if (tab === 'countries') {
            countryBody.style.display = 'block';
            regionBody.style.display = 'none';
            updateStats(blockedCountries.size, 'countries');
            setTimeout(() => countrySearch.focus(), 50);
        } else {
            countryBody.style.display = 'none';
            regionBody.style.display = 'block';
            updateStats(blockedRegions.size, 'regions');
            setTimeout(() => regionSearch.focus(), 50);
        }
    };

    // Wire up tab click handlers
    tabBar.querySelector('[data-tab="countries"]').addEventListener('click', () => handleTabSwitch('countries'));
    tabBar.querySelector('[data-tab="regions"]').addEventListener('click', () => handleTabSwitch('regions'));

    // Create footer
    const footer = createFooter(
        blockedCountries, 
        blockedRegions, 
        onCountryAction, 
        onRegionAction,
        renderCountries, 
        renderRegions,
        () => {
            overlay.remove();
            currentModal = null;
        }
    );

    // Assemble modal
    modal.appendChild(header);
    modal.appendChild(tabBar);
    modal.appendChild(tabContent);
    modal.appendChild(footer);
    overlay.appendChild(modal);

    // Close on overlay click
    overlay.addEventListener('click', e => {
        if (e.target === overlay) {
            overlay.remove();
            currentModal = null;
        }
    });

    // Close on Escape key
    const handleKeydown = e => {
        if (e.key === 'Escape') {
            closeModal();
        }
    };
    
    const closeModal = () => {
        document.removeEventListener('keydown', handleKeydown);
        overlay.remove();
        currentModal = null;
    };
    
    document.addEventListener('keydown', handleKeydown);

    // Add to page
    document.body.appendChild(overlay);
    currentModal = overlay;

    // Focus search input
    setTimeout(() => countrySearch.focus(), 100);

    // Initial render
    renderCountries();
    renderRegions();
}

/**
 * Create modal header using safe DOM methods
 */
function createHeader(onClose) {
    const header = createElement('div', { className: 'x-blocker-header' });

    // Create title with shield icon
    const title = createElement('h2', { className: 'x-blocker-title' });
    
    // Create SVG using DOM methods (safe)
    const titleSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    titleSvg.setAttribute('viewBox', '0 0 24 24');
    titleSvg.setAttribute('width', '24');
    titleSvg.setAttribute('height', '24');
    titleSvg.style.cssText = 'display: inline-block; vertical-align: middle; margin-right: 8px;';
    
    const titleG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    const titlePath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    titlePath.setAttribute('fill', 'currentColor');
    titlePath.setAttribute('d', 'M12 2L4 5v6.09c0 5.05 3.41 9.76 8 10.91 4.59-1.15 8-5.86 8-10.91V5l-8-3zm6 9.09c0 4-2.55 7.7-6 8.83-3.45-1.13-6-4.82-6-8.83V6.31l6-2.12 6 2.12v4.78zm-9-1.04l-1.41 1.41L10.5 14.5l6-6-1.41-1.41-4.59 4.58z');
    titleG.appendChild(titlePath);
    titleSvg.appendChild(titleG);
    
    title.appendChild(titleSvg);
    title.appendChild(document.createTextNode('Block Locations'));

    // Create close button
    const closeBtn = createElement('button', {
        className: 'x-blocker-close',
        'aria-label': 'Close'
    });
    
    const closeSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    closeSvg.setAttribute('viewBox', '0 0 24 24');
    closeSvg.setAttribute('width', '20');
    closeSvg.setAttribute('height', '20');
    
    const closeG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    const closePath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    closePath.setAttribute('fill', 'currentColor');
    closePath.setAttribute('d', 'M10.59 12L4.54 5.96l1.42-1.42L12 10.59l6.04-6.05 1.42 1.42L13.41 12l6.05 6.04-1.42 1.42L12 13.41l-6.04 6.05-1.42-1.42L10.59 12z');
    closeG.appendChild(closePath);
    closeSvg.appendChild(closeG);
    closeBtn.appendChild(closeSvg);
    
    closeBtn.addEventListener('click', onClose);

    header.appendChild(title);
    header.appendChild(closeBtn);

    return header;
}

/**
 * Create tab bar for switching between countries and regions
 */
function createTabBar() {
    const tabBar = createElement('div', { className: 'x-blocker-tabs' });

    const countriesTab = createElement('button', {
        className: 'x-blocker-tab active',
        textContent: '🌍 Countries',
        'data-tab': 'countries'
    });

    const regionsTab = createElement('button', {
        className: 'x-blocker-tab',
        textContent: '🗺️ Regions',
        'data-tab': 'regions'
    });

    tabBar.appendChild(countriesTab);
    tabBar.appendChild(regionsTab);

    const switchTab = tab => {
        countriesTab.classList.toggle('active', tab === 'countries');
        regionsTab.classList.toggle('active', tab === 'regions');
    };

    return { tabBar, switchTab };
}

/**
 * Create country body with search and country list
 */
function createCountryBody(blockedCountries, onAction) {
    const body = createElement('div', { className: 'x-blocker-body x-blocker-tab-panel', 'data-panel': 'countries' });

    const info = createElement('div', {
        className: 'x-blocker-info',
        textContent: 'Select countries to block. Tweets from users in these countries will be hidden from your feed.'
    });

    const search = createElement('input', {
        type: 'text',
        className: 'x-blocker-search',
        placeholder: 'Search countries...'
    });

    const countriesContainer = createElement('div', {
        className: 'x-blocker-countries'
    });

    body.appendChild(info);
    body.appendChild(search);
    body.appendChild(countriesContainer);

    let currentFilter = '';

    // Render countries function with memoized filtering
    const renderCountries = (filter = currentFilter) => {
        currentFilter = filter;
        countriesContainer.replaceChildren();

        const filterLower = filter.toLowerCase();
        let filteredCountries;
        
        if (cachedCountryFilter === filterLower && cachedFilteredCountries) {
            filteredCountries = cachedFilteredCountries;
        } else {
            filteredCountries = COUNTRY_LIST.filter(country =>
                country.includes(filterLower)
            );
            cachedCountryFilter = filterLower;
            cachedFilteredCountries = filteredCountries;
        }

        const fragment = document.createDocumentFragment();

        for (const country of filteredCountries) {
            const item = createCountryItem(country, blockedCountries, onAction, renderCountries);
            fragment.appendChild(item);
        }

        countriesContainer.appendChild(fragment);
    };

    // Search functionality with debouncing
    const debouncedRender = debounce(value => {
        renderCountries(value);
    }, TIMING.SEARCH_DEBOUNCE_MS);
    
    search.addEventListener('input', e => {
        debouncedRender(e.target.value);
    });

    return { body, renderCountries, searchInput: search };
}

/**
 * Create region body with search and region list
 */
function createRegionBody(blockedRegions, onAction) {
    const body = createElement('div', { className: 'x-blocker-body x-blocker-tab-panel', 'data-panel': 'regions' });

    const info = createElement('div', {
        className: 'x-blocker-info',
        textContent: 'Block entire regions. Some users show regional locations like "South Asia" or "Europe" instead of specific countries.'
    });

    const search = createElement('input', {
        type: 'text',
        className: 'x-blocker-search',
        placeholder: 'Search regions...'
    });

    const regionsContainer = createElement('div', {
        className: 'x-blocker-countries x-blocker-regions'
    });

    body.appendChild(info);
    body.appendChild(search);
    body.appendChild(regionsContainer);

    let currentFilter = '';

    // Render regions function with memoized filtering
    const renderRegions = (filter = currentFilter) => {
        currentFilter = filter;
        regionsContainer.replaceChildren();

        const filterLower = filter.toLowerCase();
        let filteredRegions;
        
        if (cachedRegionFilter === filterLower && cachedFilteredRegions) {
            filteredRegions = cachedFilteredRegions;
        } else {
            // REGION_LIST is now array of {name, key, flag} objects
            filteredRegions = REGION_LIST.filter(region =>
                region.name.toLowerCase().includes(filterLower) ||
                region.key.toLowerCase().includes(filterLower)
            );
            cachedRegionFilter = filterLower;
            cachedFilteredRegions = filteredRegions;
        }

        const fragment = document.createDocumentFragment();

        for (const region of filteredRegions) {
            const item = createRegionItem(region, blockedRegions, onAction);
            fragment.appendChild(item);
        }

        regionsContainer.appendChild(fragment);
    };

    // Search functionality with debouncing
    const debouncedRender = debounce(value => {
        renderRegions(value);
    }, TIMING.SEARCH_DEBOUNCE_MS);
    
    search.addEventListener('input', e => {
        debouncedRender(e.target.value);
    });

    return { body, renderRegions, searchInput: search };
}

/**
 * Create a single country item using safe DOM methods
 */
function createCountryItem(country, blockedCountries, onAction) {
    const isBlocked = blockedCountries.has(country);
    
    const item = createElement('div', {
        className: `x-country-item${isBlocked ? ' blocked' : ''}`
    });

    // Flag - using safe DOM methods
    const flagSpan = createElement('span', { className: 'x-country-flag' });
    const flag = getFlagEmoji(country);
    if (typeof flag === 'string' && flag.startsWith('<img')) {
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

    // Name
    const name = createElement('span', {
        className: 'x-country-name',
        textContent: formatCountryName(country)
    });

    // Status
    const status = createElement('span', {
        className: 'x-country-status',
        textContent: isBlocked ? 'BLOCKED' : ''
    });

    item.appendChild(flagSpan);
    item.appendChild(name);
    item.appendChild(status);

    // Click handler - sync from response data
    item.addEventListener('click', async () => {
        const response = await onAction('toggle', country);
        
        if (response?.success && response.data) {
            // Sync local set from server response
            localBlockedCountries.clear();
            for (const c of response.data) {
                localBlockedCountries.add(c);
            }
            
            // Update UI based on new state
            const nowBlocked = localBlockedCountries.has(country);
            item.classList.toggle('blocked', nowBlocked);
            status.textContent = nowBlocked ? 'BLOCKED' : '';
            
            updateStats(localBlockedCountries.size, 'countries');
        }
    });

    return item;
}

/**
 * Create a single region item using safe DOM methods
 * @param {Object} region - Region object with {name, key, flag}
 */
function createRegionItem(region, blockedRegions, onAction) {
    const regionKey = region.key;
    const isBlocked = blockedRegions.has(regionKey);
    
    const item = createElement('div', {
        className: `x-country-item x-region-item${isBlocked ? ' blocked' : ''}`
    });

    // Globe emoji based on region
    const flagSpan = createElement('span', { className: 'x-country-flag x-region-flag' });
    flagSpan.textContent = region.flag;

    // Name - use proper display name
    const name = createElement('span', {
        className: 'x-country-name x-region-name',
        textContent: region.name
    });

    // Status
    const status = createElement('span', {
        className: 'x-country-status',
        textContent: isBlocked ? 'BLOCKED' : ''
    });

    item.appendChild(flagSpan);
    item.appendChild(name);
    item.appendChild(status);

    // Click handler - sync from response data
    item.addEventListener('click', async () => {
        const response = await onAction('toggle', regionKey);
        
        if (response?.success && response.data) {
            // Sync local set from server response
            localBlockedRegions.clear();
            for (const r of response.data) {
                localBlockedRegions.add(r);
            }
            
            // Update UI based on new state
            const nowBlocked = localBlockedRegions.has(regionKey);
            item.classList.toggle('blocked', nowBlocked);
            status.textContent = nowBlocked ? 'BLOCKED' : '';
            
            updateStats(localBlockedRegions.size, 'regions');
        }
    });

    return item;
}

/**
 * Create modal footer
 */
function createFooter(blockedCountries, blockedRegions, onCountryAction, onRegionAction, renderCountries, renderRegions, onClose) {
    const footer = createElement('div', { className: 'x-blocker-footer' });

    const stats = createElement('div', {
        className: 'x-blocker-stats',
        id: 'x-blocker-stats',
        textContent: `${blockedCountries.size} countries blocked`
    });

    const btnContainer = createElement('div', {
        style: { display: 'flex', gap: '12px' }
    });

    // Clear button
    const clearBtn = createElement('button', {
        className: 'x-blocker-btn x-blocker-btn-secondary',
        textContent: 'Clear All',
        onClick: async () => {
            if (activeTab === 'countries') {
                const response = await onCountryAction('clear');
                if (response?.success) {
                    blockedCountries.clear();
                    renderCountries();
                    updateStats(0, 'countries');
                }
            } else {
                const response = await onRegionAction('clear');
                if (response?.success) {
                    blockedRegions.clear();
                    renderRegions();
                    updateStats(0, 'regions');
                }
            }
        }
    });

    // Done button
    const doneBtn = createElement('button', {
        className: 'x-blocker-btn x-blocker-btn-primary',
        textContent: 'Done',
        onClick: onClose
    });

    btnContainer.appendChild(clearBtn);
    btnContainer.appendChild(doneBtn);
    footer.appendChild(stats);
    footer.appendChild(btnContainer);

    return footer;
}

/**
 * Update stats display
 */
function updateStats(count, type = 'countries') {
    const stats = document.getElementById('x-blocker-stats');
    if (stats) {
        const label = type === 'countries' ? 'countries' : 'regions';
        stats.textContent = `${count} ${label} blocked`;
    }
}

/**
 * Hide modal
 */
export function hideModal() {
    if (currentModal) {
        currentModal.remove();
        currentModal = null;
    }
}

/**
 * Check if modal is currently visible
 */
export function isModalVisible() {
    return currentModal !== null;
}