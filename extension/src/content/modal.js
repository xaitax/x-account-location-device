/**
 * Country/Region Blocker Modal Component
 * Provides UI for blocking/unblocking countries and regions
 * Uses tabbed interface for switching between countries and regions
 */

import { COUNTRY_LIST, REGION_LIST, LANGUAGE_LIST, PCF_LABELS, CSS_CLASSES, TIMING } from '../shared/constants.js';
import { formatCountryName, createElement, debounce, describeTagRisk } from '../shared/utils.js';
import { glyph, flagImage } from './icons.js';

// Track blocked sets globally for proper syncing
let localBlockedCountries = null;
let localBlockedRegions = null;
let localBlockedTags = null;
let localBlockedBioTags = null;
let localBlockedPcf = null;
let localBlockedLanguages = null;
let localBlockedAffiliations = null;

let currentModal = null;

// Memoized filtering for performance
let cachedFilteredCountries = null;
let cachedCountryFilter = '';
let cachedFilteredRegions = null;
let cachedRegionFilter = '';
let cachedFilteredLanguages = null;
let cachedLanguageFilter = '';

// Current tab state
let activeTab = 'countries';

/**
 * Show the blocker modal
 * @param {Set} blockedCountries - Set of currently blocked countries
 * @param {Set} blockedRegions - Set of currently blocked regions
 * @param {Function} onCountryAction - Callback for country actions
 * @param {Function} onRegionAction - Callback for region actions
 * @param {Set} blockedTags - Set of currently blocked tags (optional)
 * @param {Function} onTagAction - Callback for tag actions (optional)
 * @param {Set} blockedLanguages - Set of currently blocked language codes (optional)
 * @param {Function} onLanguageAction - Callback for language actions (optional)
 */
export function showModal(config = {}) {
    const {
        blockedCountries, blockedRegions, onCountryAction, onRegionAction,
        blockedTags = null, onTagAction = null,
        blockedBioTags = null, onBioTagAction = null,
        blockedPcf = null, onPcfAction = null,
        blockedLanguages = null, onLanguageAction = null,
        blockedAffiliations = null, onAffiliationAction = null
    } = config;

    // Remove existing modal if present
    if (currentModal) {
        currentModal.remove();
        currentModal = null;
    }

    // Store references for syncing
    localBlockedCountries = blockedCountries;
    localBlockedRegions = blockedRegions;
    localBlockedTags = blockedTags || new Set();
    localBlockedBioTags = blockedBioTags || new Set();
    localBlockedPcf = blockedPcf || new Set();
    localBlockedLanguages = blockedLanguages || new Set();
    localBlockedAffiliations = blockedAffiliations || new Set();

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
    updateTabCounts(blockedCountries.size, blockedRegions.size, tagTotal(), localBlockedLanguages.size, localBlockedAffiliations.size);

    // Create bodies for all tabs
    const { body: countryBody, renderCountries, searchInput: countrySearch } = createCountryBody(blockedCountries, onCountryAction);
    const { body: regionBody, renderRegions, searchInput: regionSearch } = createRegionBody(blockedRegions, onRegionAction);
    const { body: tagBody, renderTags, searchInput: tagSearch } = createTagBody(onTagAction, onBioTagAction, onPcfAction);
    const { body: languageBody, renderLanguages, searchInput: languageSearch } = createLanguageBody(localBlockedLanguages, onLanguageAction);
    const { body: affiliationBody, renderAffiliations, searchInput: affiliationInput } = createAffiliationBody(localBlockedAffiliations, onAffiliationAction);

    // Tab content container
    const tabContent = createElement('div', { className: 'x-blocker-tab-content' });
    tabContent.appendChild(countryBody);
    tabContent.appendChild(regionBody);
    tabContent.appendChild(tagBody);
    tabContent.appendChild(affiliationBody);
    tabContent.appendChild(languageBody);

    // Initially show countries tab
    countryBody.style.display = 'block';
    regionBody.style.display = 'none';
    tagBody.style.display = 'none';
    languageBody.style.display = 'none';
    affiliationBody.style.display = 'none';

    // Tab switching logic
    const handleTabSwitch = tab => {
        activeTab = tab;
        switchTab(tab);

        countryBody.style.display = tab === 'countries' ? 'block' : 'none';
        regionBody.style.display = tab === 'regions' ? 'block' : 'none';
        tagBody.style.display = tab === 'tags' ? 'block' : 'none';
        languageBody.style.display = tab === 'languages' ? 'block' : 'none';
        affiliationBody.style.display = tab === 'affiliations' ? 'block' : 'none';

        if (tab === 'countries') {
            updateStats(blockedCountries.size, 'countries');
            setTimeout(() => countrySearch.focus(), 50);
        } else if (tab === 'regions') {
            updateStats(blockedRegions.size, 'regions');
            setTimeout(() => regionSearch.focus(), 50);
        } else if (tab === 'tags') {
            updateStats(tagTotal(), 'tags');
            setTimeout(() => tagSearch.focus(), 50);
        } else if (tab === 'languages') {
            updateStats(localBlockedLanguages.size, 'languages');
            setTimeout(() => languageSearch.focus(), 50);
        } else if (tab === 'affiliations') {
            updateStats(localBlockedAffiliations.size, 'affiliations');
            setTimeout(() => affiliationInput.focus(), 50);
        }
    };

    // Wire up tab click handlers
    tabBar.querySelector('[data-tab="countries"]').addEventListener('click', () => handleTabSwitch('countries'));
    tabBar.querySelector('[data-tab="regions"]').addEventListener('click', () => handleTabSwitch('regions'));
    tabBar.querySelector('[data-tab="tags"]').addEventListener('click', () => handleTabSwitch('tags'));
    tabBar.querySelector('[data-tab="languages"]').addEventListener('click', () => handleTabSwitch('languages'));
    tabBar.querySelector('[data-tab="affiliations"]').addEventListener('click', () => handleTabSwitch('affiliations'));

    // Create footer
    // Clearing the Tags tab clears all three of its lists — leaving two behind while the
    // button says "Clear All" is exactly the kind of half-action that reads as a bug.
    const onClearTags = async () => {
        await Promise.all([
            onTagAction ? onTagAction('clear') : null,
            onBioTagAction ? onBioTagAction('clear') : null,
            onPcfAction ? onPcfAction('clear') : null
        ]);
        localBlockedTags.clear();
        localBlockedBioTags.clear();
        localBlockedPcf.clear();
    };

    const footer = createFooter({
        blockedCountries,
        blockedRegions,
        blockedLanguages: localBlockedLanguages,
        onCountryAction,
        onRegionAction,
        onLanguageAction,
        onClearTags,
        renderCountries,
        renderRegions,
        renderTags,
        renderLanguages,
        onClose: () => {
            overlay.remove();
            currentModal = null;
        }
    });

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
    renderLanguages();
    renderAffiliations();
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

    const affiliationsTab = createElement('button', {
        className: 'x-blocker-tab',
        'data-tab': 'affiliations'
    });
    affiliationsTab.appendChild(tabIcon('affiliation'));
    affiliationsTab.appendChild(document.createTextNode('Affiliations '));
    const affiliationsCount = createElement('span', {
        className: 'x-blocker-tab-count',
        id: 'modal-affiliations-count',
        textContent: '0'
    });
    affiliationsTab.appendChild(affiliationsCount);

    const languagesTab = createElement('button', {
        className: 'x-blocker-tab',
        'data-tab': 'languages'
    });
    languagesTab.appendChild(tabIcon('languages'));
    languagesTab.appendChild(document.createTextNode('Languages '));
    const languagesCount = createElement('span', {
        className: 'x-blocker-tab-count',
        id: 'modal-languages-count',
        textContent: '0'
    });
    languagesTab.appendChild(languagesCount);

    tabBar.appendChild(countriesTab);
    tabBar.appendChild(regionsTab);
    tabBar.appendChild(tagsTab);
    tabBar.appendChild(affiliationsTab);
    tabBar.appendChild(languagesTab);

    // Update count function
    const updateTabCounts = (countries, regions, tags, languages, affiliations = 0) => {
        countriesCount.textContent = countries;
        countriesCount.style.display = countries > 0 ? 'inline-flex' : 'none';
        regionsCount.textContent = regions;
        regionsCount.style.display = regions > 0 ? 'inline-flex' : 'none';
        tagsCount.textContent = tags;
        tagsCount.style.display = tags > 0 ? 'inline-flex' : 'none';
        languagesCount.textContent = languages;
        languagesCount.style.display = languages > 0 ? 'inline-flex' : 'none';
        affiliationsCount.textContent = affiliations;
        affiliationsCount.style.display = affiliations > 0 ? 'inline-flex' : 'none';
    };

    const switchTab = tab => {
        countriesTab.classList.toggle('active', tab === 'countries');
        regionsTab.classList.toggle('active', tab === 'regions');
        tagsTab.classList.toggle('active', tab === 'tags');
        languagesTab.classList.toggle('active', tab === 'languages');
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
 * Create language body with search and language list (issue #25)
 */
function createLanguageBody(blockedLanguages, onAction) {
    const body = createElement('div', { className: 'x-blocker-body x-blocker-tab-panel', 'data-panel': 'languages' });

    const info = createElement('div', {
        className: 'x-blocker-info',
        textContent: 'Block posts by their language. X detects each post’s language automatically — tweets written in these languages will be hidden from your feed.'
    });

    const search = createElement('input', {
        type: 'text',
        className: 'x-blocker-search',
        placeholder: 'Search languages...'
    });

    const languagesContainer = createElement('div', {
        className: 'x-blocker-countries x-blocker-languages'
    });

    body.appendChild(info);
    body.appendChild(search);
    body.appendChild(languagesContainer);

    let currentFilter = '';

    // Render languages function with memoized filtering
    const renderLanguages = (filter = currentFilter) => {
        currentFilter = filter;
        languagesContainer.replaceChildren();

        const filterLower = filter.toLowerCase();
        let filteredLanguages;

        if (cachedLanguageFilter === filterLower && cachedFilteredLanguages) {
            filteredLanguages = cachedFilteredLanguages;
        } else {
            filteredLanguages = LANGUAGE_LIST.filter(language =>
                language.name.toLowerCase().includes(filterLower) ||
                language.native.toLowerCase().includes(filterLower) ||
                language.code.toLowerCase().includes(filterLower)
            );
            cachedLanguageFilter = filterLower;
            cachedFilteredLanguages = filteredLanguages;
        }

        const fragment = document.createDocumentFragment();

        for (const language of filteredLanguages) {
            const item = createLanguageItem(language, blockedLanguages, onAction);
            fragment.appendChild(item);
        }

        languagesContainer.appendChild(fragment);
    };

    // Search functionality with debouncing
    const debouncedRender = debounce(value => {
        renderLanguages(value);
    }, TIMING.SEARCH_DEBOUNCE_MS);

    search.addEventListener('input', e => {
        debouncedRender(e.target.value);
    });

    return { body, renderLanguages, searchInput: search };
}

/**
 * Create tag body with search, common tags, and custom tag input
 */
/**
 * Affiliations panel: block every account carrying an organisation's badge.
 * Free text rather than a picker, because the set of organisations on X is open-ended.
 * @param {Set<string>} blockedAffiliations
 * @param {Function} onAction - (action, value) => response
 * @returns {{body: HTMLElement, renderAffiliations: Function, searchInput: HTMLElement}}
 */
function createAffiliationBody(blockedAffiliations, onAction) {
    const body = createElement('div', { className: 'x-blocker-body x-blocker-tab-panel', 'data-panel': 'affiliations' });

    const info = createElement('div', {
        className: 'x-blocker-info',
        textContent: 'Block every account affiliated with an organisation. Type the organisation’s name as plain text, not the badge icon. Part of the name is enough and it is not case sensitive. Hover an account’s info button to see the name to use.'
    });

    const inputSection = createElement('div', { className: 'x-blocker-tag-input-section' });

    const affiliationInput = createElement('input', {
        type: 'text',
        className: 'x-blocker-search x-blocker-tag-input',
        placeholder: 'Type an organisation name',
        maxlength: '100'
    });

    const addBtn = createElement('button', {
        className: 'x-blocker-btn x-blocker-btn-add',
        textContent: '+ Add'
    });

    inputSection.appendChild(affiliationInput);
    inputSection.appendChild(addBtn);

    const blockedSection = createElement('div', { className: 'x-blocker-blocked-tags-section' });
    const blockedLabel = createElement('div', {
        className: 'x-blocker-section-label',
        textContent: 'Blocked Affiliations'
    });
    const listContainer = createElement('div', { className: 'x-blocker-tags-list' });
    blockedSection.appendChild(blockedLabel);
    blockedSection.appendChild(listContainer);

    body.appendChild(info);
    body.appendChild(inputSection);
    body.appendChild(blockedSection);

    const syncLocal = data => {
        localBlockedAffiliations.clear();
        for (const value of data) {
            localBlockedAffiliations.add(value);
        }
    };

    const renderAffiliations = () => {
        listContainer.replaceChildren();

        if (!localBlockedAffiliations || localBlockedAffiliations.size === 0) {
            listContainer.appendChild(createElement('div', {
                className: 'x-blocker-empty',
                textContent: 'No affiliations blocked yet. Add one above.'
            }));
            return;
        }

        const fragment = document.createDocumentFragment();
        for (const affiliation of Array.from(localBlockedAffiliations).sort()) {
            const item = createElement('div', { className: 'x-blocker-tag-item' });
            item.appendChild(createElement('span', {
                className: 'x-blocker-tag-text',
                textContent: affiliation
            }));

            const removeBtn = createElement('button', {
                className: 'x-blocker-tag-remove',
                textContent: '×',
                title: `Unblock ${affiliation}`
            });
            removeBtn.addEventListener('click', async () => {
                if (!onAction) return;
                const response = await onAction('remove', affiliation);
                if (response?.success && response.data) {
                    syncLocal(response.data);
                    renderAffiliations();
                    updateStats(localBlockedAffiliations.size, 'affiliations');
                }
            });

            item.appendChild(removeBtn);
            fragment.appendChild(item);
        }
        listContainer.appendChild(fragment);
    };

    const addAffiliation = async () => {
        const value = affiliationInput.value.trim();
        if (!value || !onAction) return;

        const response = await onAction('add', value);
        if (response?.success && response.data) {
            syncLocal(response.data);
            affiliationInput.value = '';
            renderAffiliations();
            updateStats(localBlockedAffiliations.size, 'affiliations');
        }
    };

    addBtn.addEventListener('click', addAffiliation);
    affiliationInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
            e.preventDefault();
            addAffiliation();
        }
    });

    return { body, renderAffiliations, searchInput: affiliationInput };
}

/** Total across every "who they are" tag list, for the tab badge and footer. */
function tagTotal() {
    return (localBlockedTags?.size || 0) + (localBlockedBioTags?.size || 0) + (localBlockedPcf?.size || 0);
}

/**
 * One free-text tag section (display name, or bio). Each gets its own input, list and
 * over-matching caution: the two match against completely different text, and presenting
 * them as a single undifferentiated list is what made over-matching read as a bug.
 * @param {{title: string, hint: string, placeholder: string, getSet: Function, onAction: Function}} opts
 */
function createTagSection({ title, hint, placeholder, getSet, onAction }) {
    const section = createElement('div', { className: 'x-blocker-tag-section' });

    const heading = createElement('div', { className: 'x-blocker-tag-group' });
    heading.appendChild(createElement('span', { className: 'x-blocker-tag-group-label', textContent: title }));
    heading.appendChild(createElement('span', { className: 'x-blocker-tag-group-hint', textContent: hint }));

    const inputRow = createElement('div', { className: 'x-blocker-tag-input-section' });
    const input = createElement('input', {
        type: 'text',
        className: 'x-blocker-search x-blocker-tag-input',
        placeholder
    });
    const addBtn = createElement('button', { className: 'x-blocker-btn x-blocker-btn-add', textContent: '+ Add' });
    inputRow.appendChild(input);
    inputRow.appendChild(addBtn);

    const riskNote = createElement('div', { className: 'x-blocker-risk-note' });
    riskNote.style.display = 'none';

    const list = createElement('div', { className: 'x-blocker-tags-list' });

    section.appendChild(heading);
    section.appendChild(inputRow);
    section.appendChild(riskNote);
    section.appendChild(list);

    const showRisk = tag => {
        const message = tag ? describeTagRisk(tag) : null;
        riskNote.textContent = message || '';
        riskNote.style.display = message ? 'block' : 'none';
    };

    const render = () => {
        list.replaceChildren();
        const values = Array.from(getSet() || []);

        if (values.length === 0) {
            list.appendChild(createElement('div', {
                className: 'x-blocker-empty',
                textContent: 'Nothing blocked here yet.'
            }));
            return;
        }

        const fragment = document.createDocumentFragment();
        for (const value of values.sort()) {
            const item = createElement('div', { className: 'x-blocker-tag-item' });
            item.appendChild(createElement('span', { className: 'x-blocker-tag-text', textContent: value }));

            const removeBtn = createElement('button', {
                className: 'x-blocker-tag-remove',
                textContent: '×',
                title: `Remove ${value}`
            });
            removeBtn.addEventListener('click', async e => {
                e.stopPropagation();
                if (!onAction) return;
                const response = await onAction('remove', value);
                if (response?.success) {
                    showRisk(null);
                    render();
                    updateStats(tagTotal(), 'tags');
                }
            });

            item.appendChild(removeBtn);
            fragment.appendChild(item);
        }
        list.appendChild(fragment);
    };

    const add = async () => {
        const value = input.value.trim();
        if (!value || !onAction) return;
        const response = await onAction('add', value);
        if (response?.success) {
            input.value = '';
            render();
            showRisk(value);
            updateStats(tagTotal(), 'tags');
        }
    };

    addBtn.addEventListener('click', add);
    input.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
            e.preventDefault();
            add();
        }
    });

    return { section, render, input };
}

/**
 * Tags panel: three things an account can be filtered by, each matched against a different
 * part of the account and therefore given its own section.
 *   - Display name  - substring of the name shown next to the handle
 *   - Bio           - substring of the profile description
 *   - Account label - X's own structured Parody / Commentary / Fan value
 */
function createTagBody(onTagAction, onBioTagAction, onPcfAction) {
    const body = createElement('div', { className: 'x-blocker-body x-blocker-tab-panel', 'data-panel': 'tags' });

    body.appendChild(createElement('div', {
        className: 'x-blocker-info',
        textContent: 'Filter accounts by what they say about themselves — the name they display, the text of their bio, or the account label X gives them.'
    }));

    const nameSection = createTagSection({
        title: 'Display name contains',
        hint: 'Matched anywhere inside the name shown on a post',
        placeholder: 'Enter emoji or text (e.g., ⭐ or [BOT])...',
        getSet: () => localBlockedTags,
        onAction: onTagAction
    });

    const bioSection = createTagSection({
        title: 'Bio contains',
        hint: ' Matched anywhere inside the account’s bio',
        placeholder: 'Enter a word or phrase from a bio...',
        getSet: () => localBlockedBioTags,
        onAction: onBioTagAction
    });

    // Account label is a CLOSED set, so it gets pills rather than free text.
    const labelSection = createElement('div', { className: 'x-blocker-tag-section' });
    const labelHeading = createElement('div', { className: 'x-blocker-tag-group' });
    labelHeading.appendChild(createElement('span', {
        className: 'x-blocker-tag-group-label',
        textContent: 'Account label'
    }));
    labelHeading.appendChild(createElement('span', {
        className: 'x-blocker-tag-group-hint',
        textContent: 'X’s own label — works even when the name doesn’t say so'
    }));
    const labelPills = createElement('div', { className: 'x-blocker-common-tags' });
    labelSection.appendChild(labelHeading);
    labelSection.appendChild(labelPills);

    const renderLabels = () => {
        labelPills.replaceChildren();
        const fragment = document.createDocumentFragment();
        for (const label of PCF_LABELS) {
            const isBlocked = localBlockedPcf.has(label.value);
            const pill = createElement('span', {
                className: `x-blocker-common-tag${isBlocked ? ' blocked' : ''}`,
                textContent: label.name,
                title: isBlocked ? 'Click to unblock' : 'Click to block'
            });
            pill.addEventListener('click', async () => {
                if (!onPcfAction) return;
                const response = await onPcfAction('toggle', label.value);
                if (response?.success && response.data) {
                    localBlockedPcf.clear();
                    for (const v of response.data) localBlockedPcf.add(v);
                    renderLabels();
                    updateStats(tagTotal(), 'tags');
                }
            });
            fragment.appendChild(pill);
        }
        labelPills.appendChild(fragment);
    };

    body.appendChild(nameSection.section);
    body.appendChild(bioSection.section);
    body.appendChild(labelSection);

    const renderAll = () => {
        nameSection.render();
        bioSection.render();
        renderLabels();
    };

    return { body, renderTags: renderAll, searchInput: nameSection.input };
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
 * Create a single language item using safe DOM methods (issue #25)
 * @param {Object} language - Language object with {code, name, native}
 */
function createLanguageItem(language, blockedLanguages, onAction) {
    const code = language.code;
    const isBlocked = blockedLanguages.has(code);

    const item = createElement('div', {
        className: `x-country-item x-language-item${isBlocked ? ' blocked' : ''}`
    });

    // Leading chip shows the exact BCP-47 code we match against (renders on every
    // OS, unlike country-flag emoji, and sidesteps one-flag-per-language ambiguity).
    const codeChip = createElement('span', {
        className: 'x-country-flag x-language-code',
        textContent: code.toUpperCase()
    });

    // Name (English) with the endonym as a muted suffix
    const name = createElement('span', {
        className: 'x-country-name x-language-name',
        textContent: language.name
    });
    if (language.native && language.native !== language.name) {
        const native = createElement('span', {
            className: 'x-language-native',
            textContent: ` · ${language.native}`
        });
        name.appendChild(native);
    }

    const status = createElement('span', {
        className: 'x-country-status',
        textContent: isBlocked ? 'BLOCKED' : ''
    });

    item.appendChild(codeChip);
    item.appendChild(name);
    item.appendChild(status);

    // Click handler - sync from response data
    item.addEventListener('click', async () => {
        const response = await onAction('toggle', code);

        if (response?.success && response.data) {
            localBlockedLanguages.clear();
            for (const l of response.data) {
                localBlockedLanguages.add(l);
            }

            const nowBlocked = localBlockedLanguages.has(code);
            item.classList.toggle('blocked', nowBlocked);
            status.textContent = nowBlocked ? 'BLOCKED' : '';

            updateStats(localBlockedLanguages.size, 'languages');
        }
    });

    return item;
}

/**
 * Create modal footer
 */
function createFooter({
    blockedCountries, blockedRegions, blockedLanguages,
    onCountryAction, onRegionAction, onLanguageAction, onClearTags,
    renderCountries, renderRegions, renderTags, renderLanguages, onClose
}) {
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
            } else if (activeTab === 'tags' && onClearTags) {
                await onClearTags();
                renderTags();
                updateStats(0, 'tags');
            } else if (activeTab === 'languages' && onLanguageAction) {
                const response = await onLanguageAction('clear');
                if (response?.success) {
                    blockedLanguages.clear();
                    // Invalidate cache to force re-render (blockedLanguages mutated)
                    cachedFilteredLanguages = null;
                    cachedLanguageFilter = '';
                    renderLanguages();
                    updateStats(0, 'languages');
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
        else if (type === 'languages') label = 'languages';
        else if (type === 'affiliations') label = 'affiliations';
        else label = 'tags';
        stats.textContent = `${count} ${label} blocked`;
    }
}

