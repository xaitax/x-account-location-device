/**
 * Country/Region Blocker Modal Component
 * Provides UI for blocking/unblocking countries and regions
 * Uses tabbed interface for switching between countries and regions
 */

import { COUNTRY_LIST, REGION_LIST, CSS_CLASSES, TIMING } from '../shared/constants.js';
import { formatCountryName, createElement, debounce, COMMON_PROFILE_TAGS } from '../shared/utils.js';
import { glyph, flagImage } from './icons.js';

// Track blocked sets globally for proper syncing
let localBlockedCountries = null;
let localBlockedRegions = null;
let localBlockedTags = null;

let currentModal = null;

// Memoized filtering for performance
let cachedFilteredCountries = null;
let cachedCountryFilter = '';
let cachedFilteredRegions = null;
let cachedRegionFilter = '';

// Current tab state
let activeTab = 'countries';

// Track custom tags added by user
let cachedFilteredTags = null;
let cachedTagFilter = '';

/**
 * Show the blocker modal
 * @param {Set} blockedCountries - Set of currently blocked countries
 * @param {Set} blockedRegions - Set of currently blocked regions
 * @param {Function} onCountryAction - Callback for country actions
 * @param {Function} onRegionAction - Callback for region actions
 * @param {Set} blockedTags - Set of currently blocked tags (optional)
 * @param {Function} onTagAction - Callback for tag actions (optional)
 */
export function showModal(blockedCountries, blockedRegions, onCountryAction, onRegionAction, blockedTags = null, onTagAction = null) {
    // Remove existing modal if present
    if (currentModal) {
        currentModal.remove();
        currentModal = null;
    }

    // Store references for syncing
    localBlockedCountries = blockedCountries;
    localBlockedRegions = blockedRegions;
    localBlockedTags = blockedTags || new Set();

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
    const { tabBar, switchTab, updateTabCounts } = createTabBar();
    
    // Initial tab counts
    updateTabCounts(blockedCountries.size, blockedRegions.size, localBlockedTags.size);

    // Create bodies for all tabs
    const { body: countryBody, renderCountries, searchInput: countrySearch } = createCountryBody(blockedCountries, onCountryAction);
    const { body: regionBody, renderRegions, searchInput: regionSearch } = createRegionBody(blockedRegions, onRegionAction);
    const { body: tagBody, renderTags, searchInput: tagSearch } = createTagBody(localBlockedTags, onTagAction);

    // Tab content container
    const tabContent = createElement('div', { className: 'x-blocker-tab-content' });
    tabContent.appendChild(countryBody);
    tabContent.appendChild(regionBody);
    tabContent.appendChild(tagBody);

    // Initially show countries tab
    countryBody.style.display = 'block';
    regionBody.style.display = 'none';
    tagBody.style.display = 'none';

    // Tab switching logic
    const handleTabSwitch = tab => {
        activeTab = tab;
        switchTab(tab);
        
        if (tab === 'countries') {
            countryBody.style.display = 'block';
            regionBody.style.display = 'none';
            tagBody.style.display = 'none';
            updateStats(blockedCountries.size, 'countries');
            setTimeout(() => countrySearch.focus(), 50);
        } else if (tab === 'regions') {
            countryBody.style.display = 'none';
            regionBody.style.display = 'block';
            tagBody.style.display = 'none';
            updateStats(blockedRegions.size, 'regions');
            setTimeout(() => regionSearch.focus(), 50);
        } else if (tab === 'tags') {
            countryBody.style.display = 'none';
            regionBody.style.display = 'none';
            tagBody.style.display = 'block';
            updateStats(localBlockedTags.size, 'tags');
            setTimeout(() => tagSearch.focus(), 50);
        }
    };

    // Wire up tab click handlers
    tabBar.querySelector('[data-tab="countries"]').addEventListener('click', () => handleTabSwitch('countries'));
    tabBar.querySelector('[data-tab="regions"]').addEventListener('click', () => handleTabSwitch('regions'));
    tabBar.querySelector('[data-tab="tags"]').addEventListener('click', () => handleTabSwitch('tags'));

    // Create footer
    const footer = createFooter(
        blockedCountries, 
        blockedRegions, 
        localBlockedTags,
        onCountryAction, 
        onRegionAction,
        onTagAction,
        renderCountries, 
        renderRegions,
        renderTags,
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
    renderTags();
}

/**
 * Create modal header using safe DOM methods
 */
function createHeader(onClose) {
    const header = createElement('div', { className: 'x-blocker-header' });

    // Create title with shield icon
    const title = createElement('h2', { className: 'x-blocker-title' });

    // Shield glyph from the shared icon set (XSS-safe, currentColor)
    const titleSvg = glyph('shield', 24);
    titleSvg.style.cssText = 'display: inline-block; vertical-align: middle; margin-right: 8px;';

    title.appendChild(titleSvg);
    title.appendChild(document.createTextNode('Blocking'));

    // Create close button
    const closeBtn = createElement('button', {
        className: 'x-blocker-close',
        'aria-label': 'Close'
    });

    closeBtn.appendChild(glyph('close', 20));

    closeBtn.addEventListener('click', onClose);

    header.appendChild(title);
    header.appendChild(closeBtn);

    return header;
}

/**
 * Create tab bar for switching between countries, regions, and tags
 */
function createTabBar() {
    const tabBar = createElement('div', { className: 'x-blocker-tabs' });

    const tabIcon = name => {
        const g = glyph(name, 15);
        g.style.verticalAlign = '-2px';
        g.style.marginRight = '5px';
        return g;
    };

    const countriesTab = createElement('button', {
        className: 'x-blocker-tab active',
        'data-tab': 'countries'
    });
    countriesTab.appendChild(tabIcon('globe'));
    countriesTab.appendChild(document.createTextNode('Countries '));
    const countriesCount = createElement('span', { 
        className: 'x-blocker-tab-count', 
        id: 'modal-countries-count',
        textContent: '0'
    });
    countriesTab.appendChild(countriesCount);

    const regionsTab = createElement('button', {
        className: 'x-blocker-tab',
        'data-tab': 'regions'
    });
    regionsTab.appendChild(tabIcon('map'));
    regionsTab.appendChild(document.createTextNode('Regions '));
    const regionsCount = createElement('span', { 
        className: 'x-blocker-tab-count', 
        id: 'modal-regions-count',
        textContent: '0'
    });
    regionsTab.appendChild(regionsCount);

    const tagsTab = createElement('button', {
        className: 'x-blocker-tab',
        'data-tab': 'tags'
    });
    tagsTab.appendChild(tabIcon('tag'));
    tagsTab.appendChild(document.createTextNode('Tags '));
    const tagsCount = createElement('span', { 
        className: 'x-blocker-tab-count', 
        id: 'modal-tags-count',
        textContent: '0'
    });
    tagsTab.appendChild(tagsCount);

    tabBar.appendChild(countriesTab);
    tabBar.appendChild(regionsTab);
    tabBar.appendChild(tagsTab);

    // Update count function
    const updateTabCounts = (countries, regions, tags) => {
        countriesCount.textContent = countries;
        countriesCount.style.display = countries > 0 ? 'inline-flex' : 'none';
        regionsCount.textContent = regions;
        regionsCount.style.display = regions > 0 ? 'inline-flex' : 'none';
        tagsCount.textContent = tags;
        tagsCount.style.display = tags > 0 ? 'inline-flex' : 'none';
    };

    const switchTab = tab => {
        countriesTab.classList.toggle('active', tab === 'countries');
        regionsTab.classList.toggle('active', tab === 'regions');
        tagsTab.classList.toggle('active', tab === 'tags');
    };

    return { tabBar, switchTab, updateTabCounts };
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
 * Create tag body with search, common tags, and custom tag input
 */
function createTagBody(blockedTags, onAction) {
    const body = createElement('div', { className: 'x-blocker-body x-blocker-tab-panel', 'data-panel': 'tags' });

    const info = createElement('div', {
        className: 'x-blocker-info',
        textContent: 'Block users based on emojis, flags, or tags in their display names. Click to toggle blocking.'
    });

    // Custom tag input section
    const inputSection = createElement('div', { className: 'x-blocker-tag-input-section' });
    
    const tagInput = createElement('input', {
        type: 'text',
        className: 'x-blocker-search x-blocker-tag-input',
        placeholder: 'Enter emoji or tag (e.g., 🇷🇺 or [BOT])...'
    });

    const addBtn = createElement('button', {
        className: 'x-blocker-btn x-blocker-btn-add',
        textContent: '+ Add'
    });

    inputSection.appendChild(tagInput);
    inputSection.appendChild(addBtn);

    // Search for filtering existing tags
    const search = createElement('input', {
        type: 'text',
        className: 'x-blocker-search',
        placeholder: 'Search tags...'
    });

    // Common tags section
    const commonSection = createElement('div', { className: 'x-blocker-common-tags-section' });
    const commonLabel = createElement('div', { 
        className: 'x-blocker-section-label',
        textContent: 'Common Tags (click to block)'
    });
    const commonTagsContainer = createElement('div', { className: 'x-blocker-common-tags' });
    commonSection.appendChild(commonLabel);
    commonSection.appendChild(commonTagsContainer);

    // Blocked tags section
    const blockedSection = createElement('div', { className: 'x-blocker-blocked-tags-section' });
    const blockedLabel = createElement('div', { 
        className: 'x-blocker-section-label',
        textContent: 'Blocked Tags'
    });
    const tagsContainer = createElement('div', { className: 'x-blocker-tags-list' });
    blockedSection.appendChild(blockedLabel);
    blockedSection.appendChild(tagsContainer);

    body.appendChild(info);
    body.appendChild(inputSection);
    body.appendChild(search);
    body.appendChild(blockedSection);

    let currentFilter = '';

    // Render common tags
    const renderCommonTags = () => {
        commonTagsContainer.replaceChildren();
        const fragment = document.createDocumentFragment();

        for (const tag of COMMON_PROFILE_TAGS) {
            const isBlocked = blockedTags && blockedTags.has(tag);
            const tagEl = createElement('span', {
                className: `x-blocker-common-tag${isBlocked ? ' blocked' : ''}`,
                textContent: tag,
                title: isBlocked ? 'Click to unblock' : 'Click to block'
            });

            tagEl.addEventListener('click', async () => {
                if (onAction) {
                    const response = await onAction('toggle', tag);
                    if (response?.success && response.data) {
                        localBlockedTags.clear();
                        for (const t of response.data) {
                            localBlockedTags.add(t);
                        }
                        // Invalidate cache to force re-render (blockedTags mutated)
                        cachedFilteredTags = null;
                        cachedTagFilter = '';
                        renderCommonTags();
                        renderTags();
                        updateStats(localBlockedTags.size, 'tags');
                    }
                }
            });

            fragment.appendChild(tagEl);
        }

        commonTagsContainer.appendChild(fragment);
    };

    // Render blocked tags list
    const renderTags = (filter = currentFilter) => {
        currentFilter = filter;
        tagsContainer.replaceChildren();

        if (!blockedTags || blockedTags.size === 0) {
            const emptyMsg = createElement('div', {
                className: 'x-blocker-empty',
                textContent: 'No tags blocked yet. Add tags above or click common tags.'
            });
            tagsContainer.appendChild(emptyMsg);
            return;
        }

        const filterLower = filter.toLowerCase();
        const allTags = Array.from(blockedTags);
        
        let filteredTags;
        if (cachedTagFilter === filterLower && cachedFilteredTags) {
            filteredTags = cachedFilteredTags;
        } else {
            filteredTags = filterLower 
                ? allTags.filter(tag => tag.toLowerCase().includes(filterLower))
                : allTags;
            cachedTagFilter = filterLower;
            cachedFilteredTags = filteredTags;
        }

        const fragment = document.createDocumentFragment();

        for (const tag of filteredTags) {
            const item = createTagItem(tag, blockedTags, onAction, () => {
                renderCommonTags();
                renderTags();
            });
            fragment.appendChild(item);
        }

        tagsContainer.appendChild(fragment);
    };

    // Add tag handler
    const addTag = async () => {
        const tag = tagInput.value.trim();
        if (!tag) return;

        if (onAction) {
            const response = await onAction('add', tag);
            if (response?.success && response.data) {
                localBlockedTags.clear();
                for (const t of response.data) {
                    localBlockedTags.add(t);
                }
                tagInput.value = '';
                // Invalidate cache to force re-render
                cachedFilteredTags = null;
                cachedTagFilter = '';
                renderCommonTags();
                renderTags();
                updateStats(localBlockedTags.size, 'tags');
            }
        }
    };

    addBtn.addEventListener('click', addTag);
    tagInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
            e.preventDefault();
            addTag();
        }
    });

    // Search functionality with debouncing
    const debouncedRender = debounce(value => {
        renderTags(value);
    }, TIMING.SEARCH_DEBOUNCE_MS);
    
    search.addEventListener('input', e => {
        debouncedRender(e.target.value);
    });

    // Combined render function
    const renderAll = () => {
        renderCommonTags();
        renderTags();
    };

    return { body, renderTags: renderAll, searchInput: tagInput };
}

/**
 * Create a single tag item for the blocked tags list
 */
function createTagItem(tag, blockedTags, onAction, onUpdate) {
    const item = createElement('div', { className: 'x-blocker-tag-item' });

    const tagText = createElement('span', {
        className: 'x-blocker-tag-text',
        textContent: tag
    });

    const removeBtn = createElement('button', {
        className: 'x-blocker-tag-remove',
        textContent: '×',
        title: 'Remove tag'
    });

    item.appendChild(tagText);
    item.appendChild(removeBtn);

    removeBtn.addEventListener('click', async e => {
        e.stopPropagation();
        if (onAction) {
            const response = await onAction('remove', tag);
            if (response?.success && response.data) {
                localBlockedTags.clear();
                for (const t of response.data) {
                    localBlockedTags.add(t);
                }
                // Invalidate cache to force re-render
                cachedFilteredTags = null;
                cachedTagFilter = '';
                updateStats(localBlockedTags.size, 'tags');
                // Update tab count by directly accessing the DOM element
                const tagsCountEl = document.getElementById('modal-tags-count');
                if (tagsCountEl) {
                    tagsCountEl.textContent = localBlockedTags.size;
                    tagsCountEl.style.display = localBlockedTags.size > 0 ? 'inline-flex' : 'none';
                }
                if (onUpdate) onUpdate();
            }
        }
    });

    return item;
}

/**
 * Create a single country item using safe DOM methods
 */
function createCountryItem(country, blockedCountries, onAction) {
    const isBlocked = blockedCountries.has(country);
    
    const item = createElement('div', {
        className: `x-country-item${isBlocked ? ' blocked' : ''}`
    });

    // Flag - using safe DOM methods (Twemoji <img> via the shared icon set)
    const flagSpan = createElement('span', { className: 'x-country-flag' });
    const flagImg = flagImage(country);
    if (flagImg) {
        flagImg.alt = country;
        flagImg.style.cssText = 'height: 1.2em; vertical-align: -0.2em;';
        flagSpan.appendChild(flagImg);
    } else {
        flagSpan.textContent = '🌍';
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
function createFooter(blockedCountries, blockedRegions, blockedTags, onCountryAction, onRegionAction, onTagAction, renderCountries, renderRegions, renderTags, onClose) {
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
            } else if (activeTab === 'regions') {
                const response = await onRegionAction('clear');
                if (response?.success) {
                    blockedRegions.clear();
                    renderRegions();
                    updateStats(0, 'regions');
                }
            } else if (activeTab === 'tags' && onTagAction) {
                const response = await onTagAction('clear');
                if (response?.success) {
                    blockedTags.clear();
                    // Invalidate cache to force re-render (blockedTags mutated)
                    cachedFilteredTags = null;
                    cachedTagFilter = '';
                    renderTags();
                    updateStats(0, 'tags');
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
        let label;
        if (type === 'countries') label = 'countries';
        else if (type === 'regions') label = 'regions';
        else label = 'tags';
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
