/**
 * Country Blocker Modal Component
 * Provides UI for blocking/unblocking countries
 */

import { COUNTRY_LIST, CSS_CLASSES, TIMING } from '../shared/constants.js';
import { getFlagEmoji, formatCountryName, createElement, debounce } from '../shared/utils.js';

let currentModal = null;

// Memoized country filtering for performance
let cachedFilteredCountries = null;
let cachedFilter = '';

/**
 * Show the country blocker modal
 * @param {Set} blockedCountries - Set of currently blocked countries
 * @param {Function} onAction - Callback for actions (toggle, clear)
 */
export function showModal(blockedCountries, onAction) {
    // Remove existing modal if present
    if (currentModal) {
        currentModal.remove();
        currentModal = null;
    }

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

    // Create body
    const { body, renderCountries, searchInput } = createBody(blockedCountries, onAction);

    // Create footer
    const footer = createFooter(blockedCountries, onAction, renderCountries, () => {
        overlay.remove();
        currentModal = null;
    });

    // Assemble modal
    modal.appendChild(header);
    modal.appendChild(body);
    modal.appendChild(footer);
    overlay.appendChild(modal);

    // Close on overlay click
    overlay.addEventListener('click', e => {
        if (e.target === overlay) {
            overlay.remove();
            currentModal = null;
        }
    });

    // Close on Escape key (with proper cleanup)
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
    setTimeout(() => searchInput.focus(), 100);

    // Initial render
    renderCountries();
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
    title.appendChild(document.createTextNode('Block Countries'));

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
 * Create modal body with search and country list
 */
function createBody(blockedCountries, onAction) {
    const body = createElement('div', { className: 'x-blocker-body' });

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
        countriesContainer.innerHTML = '';

        // Use memoized results if filter hasn't changed
        const filterLower = filter.toLowerCase();
        let filteredCountries;
        
        if (cachedFilter === filterLower && cachedFilteredCountries) {
            filteredCountries = cachedFilteredCountries;
        } else {
            filteredCountries = COUNTRY_LIST.filter(country =>
                country.includes(filterLower)
            );
            cachedFilter = filterLower;
            cachedFilteredCountries = filteredCountries;
        }

        // Use document fragment for better performance
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
 * Create a single country item using safe DOM methods
 */
function createCountryItem(country, blockedCountries, onAction, _renderCountries) {
    const isBlocked = blockedCountries.has(country);
    
    const item = createElement('div', {
        className: `x-country-item${isBlocked ? ' blocked' : ''}`
    });

    // Flag - using safe DOM methods
    const flagSpan = createElement('span', { className: 'x-country-flag' });
    const flag = getFlagEmoji(country);
    if (typeof flag === 'string' && flag.startsWith('<img')) {
        // Parse the img tag safely by creating a temporary container
        // The Twemoji img is safe since it's generated internally with trusted source
        const temp = document.createElement('div');
        temp.innerHTML = flag;
        const imgEl = temp.firstChild;
        if (imgEl && imgEl.tagName === 'IMG') {
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

    // Click handler - update only this item's visual state instead of full re-render
    item.addEventListener('click', async () => {
        const response = await onAction('toggle', country);
        
        if (response?.success) {
            // Update local state
            const wasBlocked = blockedCountries.has(country);
            if (wasBlocked) {
                blockedCountries.delete(country);
            } else {
                blockedCountries.add(country);
            }
            
            // Update this item's visual state only (avoid full re-render)
            item.classList.toggle('blocked', !wasBlocked);
            const statusEl = item.querySelector('.x-country-status');
            if (statusEl) {
                statusEl.textContent = wasBlocked ? '' : 'BLOCKED';
            }
            
            updateStats(blockedCountries.size);
        }
    });

    return item;
}

/**
 * Create modal footer
 */
function createFooter(blockedCountries, onAction, renderCountries, onClose) {
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
            const response = await onAction('clear');
            if (response?.success) {
                blockedCountries.clear();
                renderCountries();
                updateStats(0);
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
function updateStats(count) {
    const stats = document.getElementById('x-blocker-stats');
    if (stats) {
        stats.textContent = `${count} countries blocked`;
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