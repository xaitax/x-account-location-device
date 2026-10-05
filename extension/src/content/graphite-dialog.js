/** Graphite filtering dialog. All changes use the existing revisioned storage API. */
import { COUNTRY_LIST, REGION_LIST, LANGUAGE_LIST, ACCOUNT_LABELS, CSS_CLASSES, MESSAGE_TYPES, canonicalCountry } from '../shared/constants.js';
import { createElement, formatCountryName, describeTagRisk } from '../shared/utils.js';
import { normalizeLinkRule, normalizeDomain, normalizeExactUrl, findBlockedDomain, DOMAIN_LIMITS } from '../shared/domain-utils.js';
import { createSnapshotTracker } from '../shared/state-sync.js';
import { createBlockingModeControl } from '../shared/blocking-mode-control.js';
import { FILTER_SOURCES } from '../shared/filter-registry.js';
import { ACCOUNT_COUNT_FILTERS, isAccountCountThreshold } from '../shared/account-counts.js';
import { getRegionCountries, getRegionDescription, getIncludedRegionCountries, hasRegionCountrySelection } from '../shared/region-membership.js';
import { flagImage } from './icons.js';
import { dialogIcon as glyph } from './dialog-icons.js';

const SOURCES = [
    { key: 'countries', title: 'Countries', label: 'Country', icon: 'globe', hint: 'Countries reported by X.' },
    { key: 'regions', title: 'Regions', label: 'Region', icon: 'map', hint: 'X region labels and optional member countries.' },
    { key: 'tags', title: 'Display name', label: 'Display name', icon: 'tag', hint: 'Words or emoji in display names.' },
    { key: 'bioTags', title: 'Bio text', label: 'Bio text', icon: 'info', hint: 'Words or phrases in profile bios.' },
    { key: 'links', title: 'Domains & URLs', label: 'Link', icon: 'share', hint: 'Whole websites or exact URLs.' },
    { key: 'pcf', title: 'Account labels', label: 'Account label', icon: 'verified', hint: 'Parody, Commentary, Fan or grey checkmark.' },
    { key: 'affiliations', title: 'Organization affiliation', label: 'Organization', icon: 'affiliation', hint: 'Organization names or handles.' },
    { key: 'languages', title: 'Post languages', label: 'Post language', icon: 'languages', hint: 'The language X detects in a post.' },
    { key: 'allowedUsers', title: 'Always Show', label: 'Account', icon: 'atSign' }
].map(view => ({ ...FILTER_SOURCES.find(source => source.kind === view.key), ...view }));
// This is a presentation label. Keep the source and setting keys stable for backups.
const COUNT_SOURCE = { key: 'accountCounts', title: 'Activity & names', icon: 'chart', hint: 'Following, total posts and digits in account names.' };
const FILTERS = [...SOURCES.filter(source => source.key !== 'allowedUsers'), COUNT_SOURCE];
const countFormat = new Intl.NumberFormat('en-US');
const COUNT_EDITOR_DETAILS = {
    minFollowing: {
        title: 'Following', icon: 'users', hint: 'Accounts they follow',
        label: 'Following at least',
        help: 'The number of accounts this account follows, not its followers.',
        preview: value => `Matches accounts following ${countFormat.format(value)} or more accounts.`
    },
    minPosts: {
        title: 'Total posts', icon: 'chart', hint: 'Total posts reported by X',
        label: 'Total posts at least',
        help: 'The total post count reported by X, not posts per day.',
        preview: value => `Matches accounts with ${countFormat.format(value)} or more total posts.`
    },
    minHandleDigits: {
        title: 'Handle digits', icon: 'atSign', hint: 'Numbers in the @handle',
        label: 'Minimum digits in handle',
        help: 'Counts digits anywhere in the @handle, not the display name. They do not need to be consecutive.',
        preview: value => `Matches handles containing ${value} or more digits.`,
        source: 'handle'
    },
    minDisplayNameDigits: {
        title: 'Display-name digits', icon: 'tag', hint: 'Numbers in the visible name',
        label: 'Minimum digits in display name',
        help: 'Counts digits anywhere in the display name, including styled digits. The @handle is counted separately.',
        preview: value => `Matches display names containing ${value} or more digits.`,
        source: 'display name'
    }
};
const COUNT_EDITOR_GROUPS = [
    { key: 'activity', title: 'Activity', rules: ['minFollowing', 'minPosts'] },
    { key: 'names', title: 'Name patterns', rules: ['minHandleDigits', 'minDisplayNameDigits'] }
];
const CATALOGS = {
    countries: COUNTRY_LIST.map(value => ({ value, label: formatCountryName(value) })),
    regions: REGION_LIST.map(region => ({ value: region.key, label: region.name })),
    languages: LANGUAGE_LIST.map(language => ({ value: language.code, label: language.native && language.native !== language.name
        ? `${language.name} (${language.native})` : language.name })),
    pcf: ACCOUNT_LABELS.map(label => ({ value: label.value, label: label.name }))
};
let activeDialog = null;

export function syncModalState(kind, values, revision) {
    activeDialog?.updateList(kind, values, revision);
}

export function syncModalSettings(settings, revision) {
    activeDialog?.updateSettings(settings, revision);
}

function el(tag, className, text) {
    return createElement(tag, { ...(className ? { className } : {}), ...(text !== undefined ? { textContent: text } : {}) });
}

function button(text, onClick, className = 'xp-g-button') {
    const result = el('button', className, text);
    result.type = 'button';
    result.addEventListener('click', onClick);
    return result;
}

function iconButton(label, icon, onClick) {
    const result = button('', onClick, 'xp-g-icon-button');
    result.setAttribute('aria-label', label);
    result.title = label;
    result.append(glyph(icon, 18));
    return result;
}

function locationIcon(kind, value) {
    if (kind === 'countries') return flagImage(value);
    if (kind !== 'regions') return null;
    const icon = el('span', 'xp-g-region-icon');
    icon.setAttribute('aria-hidden', 'true');
    icon.append(glyph('map', 18));
    return icon;
}

/** Open the on-X dialog, keeping only one modal instance active. */
export function showModal(config = {}) {
    activeDialog?.close();
    activeDialog = createBlockingSurface(config);
}

/** Dispose the on-page dialog without returning focus during content teardown. */
export function closeModal({ restoreFocus = false } = {}) {
    activeDialog?.close({ restoreFocus });
}

/** Mount the same filtering controls in the full settings page. */
export function mountBlockingSettings(container, config = {}) {
    const surface = createBlockingSurface(config, container);
    return {
        updateList: surface.updateList,
        updateSettings: surface.updateSettings,
        navigate: surface.navigate,
        destroy: surface.close
    };
}

/** Each surface owns its drafts, pending writes and snapshot tracker. */
function createBlockingSurface(config, container = null) {
    const embedded = container !== null;
    const opener = document.activeElement;
    const sets = Object.fromEntries(SOURCES.map(source => [source.key, new Set(config[source.field] || [])]));
    const snapshots = createSnapshotTracker(config.stateRevisions);
    let settings = { ...config.settings };
    let closed = false;
    let statusText = 'Changes save automatically';
    let statusError = false;
    let deferredFocusId = '';
    const pending = new Set();
    const drafts = Object.create(null);
    const expandedRegions = new Set();
    const regionQueries = Object.create(null);
    const view = { tab: 'add', editor: null, query: '', source: 'all', catalogQuery: '', selectedOnly: false, userQuery: '', linkMode: 'auto', clearKind: null, countMetric: ACCOUNT_COUNT_FILTERS[0].key };

    const overlay = embedded ? null : el('div', `${CSS_CLASSES.MODAL_OVERLAY} xp-graphite-overlay`);
    const modal = createElement('div', {
        className: `${CSS_CLASSES.MODAL} xp-graphite${embedded ? ' xp-graphite-embedded' : ''}`,
        role: embedded ? 'region' : 'dialog',
        ...(!embedded ? { 'aria-modal': 'true' } : {}),
        'aria-labelledby': 'x-blocker-title'
    });
    const findById = id => [...modal.querySelectorAll('[id]')].find(node => node.id === id);
    const header = el('header', 'xp-g-header');
    const heading = el('div', 'xp-g-heading');
    const title = el('h2', 'xp-g-title');
    title.id = 'x-blocker-title';
    title.tabIndex = -1;
    title.append(glyph('shield', 24), document.createTextNode('Blocking'));
    heading.append(title, el('p', 'xp-g-subtitle', 'Choose what appears in your feed.'));
    const mode = createBlockingModeControl({ id: 'x-modal-blocking-mode', settings,
        revision: config.stateRevisions?.[MESSAGE_TYPES.SETTINGS_UPDATED], onChange: changeSettings });
    header.append(heading, mode.element);
    if (!embedded) {
        const closeButton = iconButton('Close blocking settings', 'close', close);
        closeButton.id = 'x-graphite-close';
        header.append(closeButton);
    }
    const tabs = createElement('div', { className: 'xp-g-tabs', role: 'tablist', 'aria-label': 'Blocking settings' });
    const body = createElement('div', { className: 'xp-g-body', id: 'x-graphite-panel', role: 'tabpanel', tabindex: '0' });
    const status = createElement('p', { className: 'xp-g-status', role: 'status', 'aria-live': 'polite' });
    const footer = el('footer', 'xp-g-footer');
    const footerActions = el('div', 'xp-g-footer-actions');
    if (!embedded && config.onOpenSettings) {footerActions.append(button('Open full settings', async () => {
        try {
            const response = await config.onOpenSettings();
            if (!response?.success) throw new Error('Could not open settings');
        } catch { setStatus('Couldn’t open settings. Please try again.', true); }
    }, 'xp-g-button ghost'));}
    if (!embedded) footerActions.append(button('Done', close, 'xp-g-button primary'));
    footer.append(status);
    if (!embedded) footer.append(footerActions);
    modal.append(header, tabs, body, footer);
    overlay?.append(modal);

    function setStatus(text, error = false) {
        if (closed) return;
        statusText = text;
        statusError = error;
        status.textContent = text;
        status.classList.toggle('error', error);
    }

    function close({ restoreFocus = true } = {}) {
        if (closed) return;
        closed = true;
        if (!embedded) document.removeEventListener('keydown', handleKeydown, true);
        if (embedded) { modal.remove(); return; }
        overlay.remove();
        if (activeDialog?.overlay === overlay) activeDialog = null;
        const target = opener?.isConnected ? opener : (opener?.id ? document.getElementById(opener.id) : null);
        if (restoreFocus) target?.focus({ preventScroll: true });
    }

    function handleKeydown(event) {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            if (view.editor) navigate(view.tab); else close();
        } else if (event.key === 'Tab') {
            const items = [...modal.querySelectorAll('button, input, select, textarea, a[href], summary, [tabindex="0"]')]
                .filter(item => !item.matches(':disabled') && item.tabIndex >= 0 && item.getClientRects().length
                    && (item.type !== 'radio' || item.checked));
            const first = items[0];
            const last = items[items.length - 1];
            if (event.shiftKey && (document.activeElement === first || !modal.contains(document.activeElement))) {
                event.preventDefault(); last?.focus();
            } else if (!event.shiftKey && (document.activeElement === last || !modal.contains(document.activeElement))) {
                event.preventDefault(); first?.focus();
            }
        }
    }

    function updateList(kind, values, revision) {
        const source = SOURCES.find(item => item.key === kind);
        if (closed || !source || !Array.isArray(values) || !snapshots.accept(source.update, revision)) return;
        sets[kind] = new Set(values);
        render();
    }

    function updateSettings(next, revision) {
        if (closed || !next || !snapshots.accept(MESSAGE_TYPES.SETTINGS_UPDATED, revision)) return;
        settings = { ...next };
        mode.update(settings, revision);
        render();
    }

    async function changeSettings(patch) {
        const key = 'settings';
        if (pending.has(key) || closed) return { success: false };
        pending.add(key);
        setStatus('Saving…');
        render();
        let response;
        try {
            response = await config.onSettingsChange?.(patch);
            if (!response?.success || !response.data) throw new Error('Save failed');
            updateSettings(response.data, response.revision);
            if (Array.isArray(response.blockedRegions)) updateList('regions', response.blockedRegions, response.regionsRevision);
            setStatus('Changes saved');
        } catch {
            response = { success: false };
            setStatus('Couldn’t save this change. Please try again.', true);
        } finally {
            pending.delete(key);
            render();
        }
        return response;
    }

    async function mutate(kind, action, value, onSuccess) {
        const source = SOURCES.find(item => item.key === kind);
        const key = `${kind}:${value}`;
        if (closed || pending.has(key) || pending.has(`${kind}:undefined`)) return;
        pending.add(key);
        setStatus('Saving…');
        render();
        try {
            const response = await config[source.callback]?.(action, value);
            if (closed) return;
            if (!response?.success || !Array.isArray(response.data)) throw new Error('Save failed');
            updateList(kind, response.data, response.revision);
            onSuccess?.();
            setStatus('Changes saved');
        } catch { setStatus('Couldn’t save this change. Your previous filters are unchanged. Please try again.', true); }
        finally { pending.delete(key); render(); }
    }

    function navigate(tab, editor = null) {
        if (closed || !['add', 'saved', 'allowed', 'behavior'].includes(tab)) return;
        if (editor && !FILTERS.some(source => source.key === editor)) return;
        deferredFocusId = '';
        const previousEditor = view.editor;
        view.tab = tab;
        view.editor = editor;
        view.clearKind = null;
        view.catalogQuery = '';
        view.selectedOnly = false;
        render(false);
        body.scrollTop = 0;
        const previousSource = tab === 'add' && !editor && previousEditor ? findById(`x-g-source-${previousEditor}`) : null;
        const target = previousSource || body.querySelector('.xp-g-count-selector input:checked') ||
            body.querySelector('input, select, .xp-g-source, #x-g-editor-title') || body;
        if (!embedded || modal.getClientRects().length) target.focus({ preventScroll: true });
    }

    function sourceLabel(kind, value) {
        if (kind === COUNT_SOURCE.key) {
            const metric = ACCOUNT_COUNT_FILTERS.find(item => item.key === value);
            return `${metric.label}: ${countFormat.format(settings[value])} or more`;
        }
        if (kind === 'countries') return formatCountryName(value);
        if (kind === 'allowedUsers') return `@${value}`;
        return CATALOGS[kind]?.find(item => item.value === value)?.label || value;
    }

    function makeRow(source, value) {
        if (source.key === COUNT_SOURCE.key) return makeCountRow(value);
        const row = el('div', 'xp-g-row');
        const label = source.key === 'links' ? (value.includes('://') ? 'Exact URL' : 'Domain') : source.label;
        const kind = el('span', 'xp-g-kind', label);
        const content = el('span', `xp-g-value${source.key === 'links' ? ' mono' : ''}`);
        content.append(locationIcon(source.key, value) || glyph(source.icon, 18));
        const text = el('span', '', sourceLabel(source.key, value));
        if (source.key === 'regions') {
            row.classList.add('xp-g-region-saved-row');
            const included = getIncludedRegionCountries(value, settings.regionCountrySelections);
            text.append(el('small', '', included.length
                ? `X label + ${included.length} ${included.length === 1 ? 'country' : 'countries'}` : 'X label only'));
        }
        content.append(text);
        const remove = iconButton(`Remove ${label}: ${sourceLabel(source.key, value)}`, 'close', () => mutate(source.key, 'remove', value));
        remove.id = `x-g-remove-${source.key}-${encodeURIComponent(value)}`;
        remove.disabled = pending.has(`${source.key}:${value}`) || pending.has(`${source.key}:undefined`);
        if (source.key === 'regions') {
            const actions = el('div', 'xp-g-row-actions');
            const edit = button('Edit', () => {
                expandedRegions.add(value);
                navigate('add', 'regions');
                findById(`x-g-region-expand-${encodeURIComponent(value)}`)?.focus({ preventScroll: true });
                findById(`x-g-region-${encodeURIComponent(value)}`)?.scrollIntoView({ block: 'nearest', behavior: 'auto' });
            }, 'xp-g-button ghost');
            edit.id = `x-g-edit-region-${encodeURIComponent(value)}`;
            edit.setAttribute('aria-label', `Edit ${sourceLabel(source.key, value)} region filter`);
            actions.append(edit, remove);
            row.append(kind, content, actions);
        } else row.append(kind, content, remove);
        return row;
    }

    function filterValues(source) {
        return source.key === COUNT_SOURCE.key
            ? ACCOUNT_COUNT_FILTERS.filter(metric => isAccountCountThreshold(settings[metric.key], metric.max) && settings[metric.key] > 0).map(metric => metric.key)
            : [...sets[source.key]];
    }

    function filterTotal() {
        return FILTERS.reduce((total, source) => total + filterValues(source).length, 0);
    }

    function makeCountRow(key) {
        const metric = ACCOUNT_COUNT_FILTERS.find(item => item.key === key);
        const row = el('div', 'xp-g-row xp-g-count-row');
        row.dataset.countKey = key;
        const value = el('span', 'xp-g-value');
        const text = el('span', '', `${countFormat.format(settings[key])} or more`);
        if (metric.requiresProfile && settings.profileEnrichment === false) text.append(el('small', '', 'Inactive: profile details disabled'));
        value.append(glyph(COUNT_SOURCE.icon, 18), text);
        const actions = el('div', 'xp-g-row-actions');
        const edit = button('Edit', () => {
            view.countMetric = key;
            delete drafts[key];
            navigate('add', COUNT_SOURCE.key);
        }, 'xp-g-button ghost');
        edit.id = `x-g-edit-${key}`;
        edit.setAttribute('aria-label', `Edit ${metric.label.toLowerCase()} filter`);
        const remove = iconButton(`Remove ${metric.label.toLowerCase()} filter`, 'close', async () => {
            const response = await changeSettings({ [key]: 0 });
            if (response.success) { delete drafts[key]; render(); }
        });
        remove.id = `x-g-remove-${key}`;
        edit.disabled = remove.disabled = pending.has('settings');
        actions.append(edit, remove);
        row.append(el('span', 'xp-g-kind', metric.label), value, actions);
        return row;
    }

    function search(id, placeholder, value, onInput) {
        const wrap = el('div', 'xp-g-search');
        const input = createElement('input', { id, type: 'search', placeholder, 'aria-label': placeholder, autocomplete: 'off' });
        input.value = value;
        input.addEventListener('input', event => { onInput(input.value); if (!event.isComposing) render(); });
        input.addEventListener('compositionend', () => { onInput(input.value); render(); });
        wrap.append(input);
        return wrap;
    }

    function empty(titleText, hint, actionText, action) {
        const result = el('div', 'xp-g-empty');
        result.append(glyph('shield', 28), el('h3', '', titleText), el('p', '', hint));
        if (action) result.append(button(actionText, action, 'xp-g-button primary'));
        return result;
    }

    function renderLibrary() {
        const container = el('div');
        const heading = el('div', 'xp-g-section-heading xp-g-library-heading');
        const headingText = el('div');
        headingText.append(el('h3', '', 'Saved filters'), el('p', '', 'Review and manage the filters you have added.'));
        const add = button('Add filter', () => navigate('add'), 'xp-g-button primary');
        add.prepend(glyph('plus', 16));
        heading.append(headingText, add);
        const toolbar = el('div', 'xp-g-toolbar');
        const sourceFilter = createElement('select', { className: 'xp-g-select', id: 'x-g-source', 'aria-label': 'Filter by source' });
        for (const [value, titleText] of [['all', 'All sources'], ...FILTERS.map(source => [source.key, source.title])]) {
            const option = el('option', '', titleText); option.value = value; sourceFilter.append(option);
        }
        sourceFilter.value = view.source;
        sourceFilter.addEventListener('change', () => { view.source = sourceFilter.value; render(); });
        toolbar.append(search('x-g-search', 'Search saved filters', view.query, value => { view.query = value; }), sourceFilter);
        const list = el('div', 'xp-g-list');
        const query = view.query.trim().toLocaleLowerCase();
        let shown = 0;
        for (const source of FILTERS) {
            if (view.source !== 'all' && view.source !== source.key) continue;
            for (const value of filterValues(source).sort((a, b) => sourceLabel(source.key, a).localeCompare(sourceLabel(source.key, b)))) {
                const rawCount = source.key === COUNT_SOURCE.key ? settings[value] : '';
                if (query && !`${source.title} ${sourceLabel(source.key, value)} ${value} ${rawCount}`.toLocaleLowerCase().includes(query)) continue;
                list.append(makeRow(source, value)); shown++;
            }
        }
        const total = filterTotal();
        container.append(heading, toolbar, el('p', 'xp-g-summary', `${shown} ${shown === 1 ? 'filter' : 'filters'}${shown !== total ? ` of ${total} saved` : ' saved'}`), list);
        if (!shown) {container.append(total ? empty('No matching filters', 'Try another search or choose a different source.', 'Clear search', () => { view.query = ''; view.source = 'all'; render(); })
            : empty('No filters yet', 'Choose a country, a word, a link or another filter to get started.', 'Add your first filter', () => navigate('add')));}
        return container;
    }

    function renderChooser() {
        const container = el('div');
        const heading = el('div', 'xp-g-section-heading');
        heading.append(el('h3', '', 'Add a filter'), el('p', '', 'Choose what to match. Use Hide or Highlight above to decide what happens.'));
        const grid = el('div', 'xp-g-source-grid');
        for (const source of FILTERS) {
            const choice = button('', () => navigate('add', source.key), 'xp-g-source');
            choice.id = `x-g-source-${source.key}`;
            const text = el('div'); text.append(el('strong', '', source.title), el('p', '', source.hint));
            const tail = el('span', 'xp-g-source-tail');
            const count = filterValues(source).length;
            if (count) {
                const badge = el('span', 'xp-g-source-count', String(count));
                badge.setAttribute('aria-label', `${count} saved`);
                tail.append(badge);
            }
            tail.append(glyph('chevronRight', 16));
            choice.append(glyph(source.icon, 22), text, tail);
            grid.append(choice);
        }
        container.append(heading, grid);
        return container;
    }

    function renderCatalog(kind) {
        if (kind === 'regions') return renderRegions();
        const container = el('div');
        const source = SOURCES.find(item => item.key === kind);
        const toolbar = el('div', 'xp-g-catalog-tools');
        const segmented = el('div', 'xp-g-segmented');
        for (const [selected, text] of [[false, 'All'], [true, `Selected (${sets[kind].size})`]]) {
            const choice = button(text, () => { view.selectedOnly = selected; render(); });
            choice.id = `x-g-catalog-${selected ? 'selected' : 'all'}`;
            choice.setAttribute('aria-pressed', String(view.selectedOnly === selected));
            segmented.append(choice);
        }
        toolbar.append(search('x-g-catalog-search', `Search ${source.title.toLowerCase()}`, view.catalogQuery, value => { view.catalogQuery = value; }), segmented);
        const query = view.catalogQuery.trim().toLocaleLowerCase();
        const catalog = [...CATALOGS[kind]];
        for (const value of sets[kind]) if (!catalog.some(item => item.value === value)) catalog.push({ value, label: sourceLabel(kind, value) });
        const shown = catalog.filter(item => (!view.selectedOnly || sets[kind].has(item.value)) && `${item.label} ${item.value}`.toLocaleLowerCase().includes(query));
        container.append(el('p', 'xp-g-help', kind === 'languages' ? 'Uses the language X detects for the post, not the author’s country. Unknown languages are not filtered.'
            : kind === 'pcf' ? 'Uses X’s account labels and rendered grey verification badge, not words in a bio.' : 'Select as many countries as you need. Your selection stays saved when you search.'), toolbar,
        el('p', 'xp-g-catalog-summary', `${sets[kind].size} selected · ${shown.length} shown`));
        const list = el('div', 'xp-g-list');
        for (const item of shown) {
            const label = el('label', 'xp-g-catalog-row');
            const checked = sets[kind].has(item.value);
            label.dataset.selected = String(checked);
            const icon = locationIcon(kind, item.value);
            if (icon) label.append(icon);
            label.append(el('span', '', item.label));
            const input = createElement('input', { type: 'checkbox', id: `x-g-choice-${kind}-${encodeURIComponent(item.value)}` });
            input.checked = checked;
            input.disabled = pending.has(`${kind}:${item.value}`) || pending.has(`${kind}:undefined`);
            input.addEventListener('change', () => mutate(kind, input.checked ? 'add' : 'remove', item.value));
            label.append(input); list.append(label);
        }
        container.append(list);
        if (!shown.length) container.append(empty(view.selectedOnly && !sets[kind].size ? 'Nothing selected yet' : 'No matches', 'Your other selections are still saved.', 'Show all', () => { view.catalogQuery = ''; view.selectedOnly = false; render(); }));
        return container;
    }

    function saveRegionCountries(regionKey, countries, { activate = false } = {}) {
        return changeSettings({ regionCountrySelection: {
            region: regionKey, countries: countries === null ? null : [...countries], ...(activate ? { activate: true } : {})
        } });
    }

    function renderRegions() {
        const container = el('div', 'xp-g-regions');
        const toolbar = el('div', 'xp-g-catalog-tools');
        const segmented = el('div', 'xp-g-segmented');
        for (const [selected, text] of [[false, 'All'], [true, `Selected (${sets.regions.size})`]]) {
            const choice = button(text, () => { view.selectedOnly = selected; render(); });
            choice.id = `x-g-catalog-${selected ? 'selected' : 'all'}`;
            choice.setAttribute('aria-pressed', String(view.selectedOnly === selected));
            segmented.append(choice);
        }
        toolbar.append(search('x-g-catalog-search', 'Find region or country', view.catalogQuery, value => { view.catalogQuery = value; }), segmented);
        const query = view.catalogQuery.trim().toLocaleLowerCase();
        const canonicalQuery = canonicalCountry(view.catalogQuery.trim());
        const catalog = [...CATALOGS.regions];
        for (const value of sets.regions) if (!catalog.some(item => item.value === value)) catalog.push({ value, label: sourceLabel('regions', value) });
        const shown = catalog.filter(item => (!view.selectedOnly || sets.regions.has(item.value)) && (
            `${item.label} ${item.value} ${getRegionCountries(item.value).map(formatCountryName).join(' ')}`.toLocaleLowerCase().includes(query) ||
            (query && getRegionCountries(item.value).includes(canonicalQuery))));
        const includedCountries = new Set([...sets.regions].flatMap(regionKey => getIncludedRegionCountries(regionKey, settings.regionCountrySelections)));
        const summary = [`${sets.regions.size} ${sets.regions.size === 1 ? 'region' : 'regions'} selected`];
        if (includedCountries.size) summary.push(`${includedCountries.size} ${includedCountries.size === 1 ? 'country' : 'countries'} included`);
        summary.push(`${shown.length} shown`);
        container.append(el('p', 'xp-g-help', 'Select an X region label, or expand a region to choose countries and territories.'), toolbar,
            el('p', 'xp-g-catalog-summary', summary.join(' · ')));
        const list = el('div', 'xp-g-region-list');
        for (const item of shown) list.append(renderRegion(item));
        container.append(list);
        if (!shown.length) {
            container.append(empty(view.selectedOnly && !sets.regions.size ? 'Nothing selected yet' : 'No matching regions',
                'Your other selections are still saved.', 'Show all', () => { view.catalogQuery = ''; view.selectedOnly = false; render(); }));
        } else container.append(el('p', 'xp-g-region-note', 'Countries can belong to several regions. Other region and country filters still apply when you deselect a country here.'));
        return container;
    }

    function renderRegion(item) {
        const regionKey = item.value;
        const id = encodeURIComponent(regionKey);
        const selected = sets.regions.has(regionKey);
        const expanded = expandedRegions.has(regionKey);
        const countries = getRegionCountries(regionKey);
        const include = hasRegionCountrySelection(regionKey, settings.regionCountrySelections);
        const included = new Set(getIncludedRegionCountries(regionKey, settings.regionCountrySelections));
        const regionBusy = pending.has(`regions:${regionKey}`) || pending.has('regions:undefined');
        const busy = regionBusy || pending.has('settings');
        const row = el('section', 'xp-g-region');
        row.id = `x-g-region-${id}`;
        row.dataset.selected = String(selected);
        const heading = el('div', 'xp-g-region-heading');
        const disclosure = button('', () => {
            if (expandedRegions.has(regionKey)) expandedRegions.delete(regionKey);
            else expandedRegions.add(regionKey);
            render();
        }, 'xp-g-region-disclosure');
        disclosure.id = `x-g-region-expand-${id}`;
        disclosure.setAttribute('aria-expanded', String(expanded));
        disclosure.setAttribute('aria-controls', `x-g-region-panel-${id}`);
        disclosure.setAttribute('aria-label', `${expanded ? 'Hide' : 'View'} ${item.label} countries and region options`);
        const text = el('span', 'xp-g-region-text');
        const name = el('strong', '', item.label);
        name.id = `x-g-region-name-${id}`;
        const coverage = selected ? include ? `X label + ${included.size} of ${countries.length} countries` : countries.length ? `X label only · ${countries.length} countries available` : 'X label only'
            : countries.length ? `${countries.length} ${countries.length === 1 ? 'country' : 'countries'} · View list` : 'X label only';
        const coverageText = el('small', 'xp-g-region-coverage', coverage);
        coverageText.id = `x-g-region-coverage-${id}`;
        disclosure.setAttribute('aria-describedby', coverageText.id);
        text.append(name, coverageText);
        const arrow = glyph('chevronRight', 16);
        arrow.classList.add('xp-g-region-chevron');
        disclosure.append(locationIcon('regions', regionKey), text, arrow);
        const toggle = el('label', 'xp-g-region-toggle');
        const input = createElement('input', {
            type: 'checkbox', id: `x-g-choice-regions-${id}`, 'aria-label': `Filter ${item.label}`
        });
        input.checked = selected;
        input.disabled = busy;
        input.addEventListener('change', () => {
            if (input.checked) expandedRegions.add(regionKey);
            mutate('regions', input.checked ? 'add' : 'remove', regionKey);
        });
        toggle.append(input);
        heading.append(disclosure, toggle);
        const panel = el('div', 'xp-g-region-panel');
        panel.id = `x-g-region-panel-${id}`;
        panel.hidden = !expanded;
        panel.setAttribute('role', 'group');
        panel.setAttribute('aria-labelledby', name.id);
        if (expanded) {
            if (countries.length) {
                const description = getRegionDescription(regionKey);
                if (description) panel.append(el('p', 'xp-g-region-definition', description));
                const controls = el('div', 'xp-g-region-controls');
                const inclusion = el('label', 'xp-g-region-include');
                const includeInput = createElement('input', { type: 'checkbox', id: `x-g-region-include-${id}` });
                includeInput.checked = include;
                includeInput.disabled = busy;
                includeInput.addEventListener('change', () => saveRegionCountries(regionKey, includeInput.checked ? countries : null,
                    { activate: includeInput.checked }));
                inclusion.append(includeInput, el('span', '', 'Include countries'));
                const count = el('span', 'xp-g-region-member-count', include ? `${included.size} of ${countries.length} included` : `${countries.length} countries & territories`);
                controls.append(inclusion, count);
                panel.append(controls);
                if (!selected) panel.append(el('p', 'xp-g-region-hint', 'Choosing countries automatically enables this region. Include countries selects all.'));
                else if (!include) panel.append(el('p', 'xp-g-region-hint', 'Choose individual countries below, or use Include countries to select them all.'));
                const tools = el('div', 'xp-g-region-country-tools');
                tools.append(search(`x-g-region-search-${id}`, `Search ${item.label} countries`, regionQueries[regionKey] || '', value => { regionQueries[regionKey] = value; }));
                const actions = el('div', 'xp-g-region-country-actions');
                for (const [title, members] of [['All', countries], ['None', []]]) {
                    const action = button(title, () => saveRegionCountries(regionKey, members, { activate: members.length > 0 }), 'xp-g-button ghost');
                    action.id = `x-g-region-${title.toLowerCase()}-${id}`;
                    action.setAttribute('aria-label', `${title === 'All' ? 'Include all' : 'Deselect all'} ${item.label} countries`);
                    action.disabled = busy;
                    actions.append(action);
                }
                tools.append(actions);
                panel.append(tools);
                const countryQuery = (regionQueries[regionKey] || '').trim().toLocaleLowerCase();
                const canonicalCountryQuery = canonicalCountry((regionQueries[regionKey] || '').trim());
                const members = countries.filter(country => `${country} ${formatCountryName(country)}`.toLocaleLowerCase().includes(countryQuery) ||
                    (countryQuery && country === canonicalCountryQuery));
                const grid = el('div', 'xp-g-region-countries');
                grid.id = `x-g-region-countries-${id}`;
                grid.setAttribute('role', 'group');
                grid.setAttribute('aria-label', `${item.label} countries`);
                for (const country of members) {
                    const label = el('label', 'xp-g-region-country');
                    const member = createElement('input', { type: 'checkbox', id: `x-g-region-country-${id}-${encodeURIComponent(country)}` });
                    member.checked = include && included.has(country);
                    member.disabled = busy;
                    member.addEventListener('change', () => {
                        const next = new Set(getIncludedRegionCountries(regionKey, settings.regionCountrySelections));
                        if (member.checked) next.add(country); else next.delete(country);
                        saveRegionCountries(regionKey, countries.filter(value => next.has(value)), { activate: member.checked });
                    });
                    label.dataset.selected = String(member.checked);
                    label.dataset.disabled = String(member.disabled);
                    const flag = flagImage(country);
                    label.append(member);
                    if (flag) label.append(flag);
                    label.append(el('span', '', formatCountryName(country)));
                    grid.append(label);
                }
                panel.append(grid);
                if (!members.length) panel.append(el('p', 'xp-g-region-hint', 'No matching countries. Your selection is unchanged.'));
            } else panel.append(el('p', 'xp-g-region-hint', 'This saved label has no country mapping. It still matches the region reported by X.'));
        }
        row.append(heading, panel);
        return row;
    }

    function settingCheckbox(key, text, help) {
        const label = el('label', 'xp-g-check');
        const input = createElement('input', { type: 'checkbox', id: `x-g-setting-${key}` });
        input.checked = settings[key] === true;
        input.disabled = pending.has('settings');
        input.addEventListener('change', () => changeSettings({ [key]: input.checked }));
        const content = el('span', '', text);
        if (help) content.append(el('small', '', help));
        label.append(input, content);
        return label;
    }

    function settingSwitch(key, titleText, helpText, {
        id = `x-g-setting-${key}`, helpId = `${id}-help`, defaultValue = false, inverted = false
    } = {}) {
        const row = el('div', 'xp-g-setting');
        const text = el('div');
        const label = el('label', '', titleText); label.htmlFor = id;
        const help = el('p', '', helpText); help.id = helpId;
        text.append(label, help);
        const input = createElement('input', {
            id, type: 'checkbox', className: 'xp-g-switch', role: 'switch', 'aria-describedby': helpId
        });
        const value = defaultValue ? settings[key] !== false : settings[key] === true;
        input.checked = inverted ? !value : value;
        input.disabled = pending.has('settings');
        input.addEventListener('change', () => changeSettings({ [key]: inverted ? !input.checked : input.checked }));
        row.append(text, input);
        return row;
    }

    function normalizedDraft(kind) {
        const raw = (drafts[kind] || '').trim();
        if (kind === 'links') {
            if (view.linkMode === 'exact') return normalizeExactUrl(raw);
            const normalized = normalizeLinkRule(raw);
            return view.linkMode === 'domain' && normalized.includes('://') ? '' : normalized;
        }
        if (kind === 'allowedUsers') { const username = raw.replace(/^@/, '').toLowerCase(); return /^[a-z0-9_]{1,15}$/.test(username) ? username : ''; }
        return kind === 'tags' ? raw : raw.toLowerCase();
    }

    function renderTextEditor(kind) {
        const source = SOURCES.find(item => item.key === kind);
        const container = el('div');
        const form = el('form');
        const inputId = `x-g-input-${kind}`;
        const field = el('div', 'xp-g-field');
        const label = el('label', '', kind === 'links' ? 'Domain or URL' : kind === 'allowedUsers' ? 'Account handle' : source.title);
        label.htmlFor = inputId;
        const input = createElement('input', { id: inputId, type: 'text', className: 'xp-g-input', autocomplete: 'off',
            ...(kind === 'links' ? { maxlength: String(DOMAIN_LIMITS.MAX_INPUT_LENGTH) }
                : kind === 'allowedUsers' ? { maxlength: '16' } : {}),
            placeholder: kind === 'links' ? 'youtube.com/LiveOverflow' : kind === 'allowedUsers' ? '@username' : kind === 'affiliations' ? 'Organization name or handle' : 'Enter text or emoji' });
        input.value = drafts[kind] || '';
        input.addEventListener('input', event => { drafts[kind] = input.value; if (!event.isComposing) render(); });
        input.addEventListener('compositionend', () => { drafts[kind] = input.value; render(); });
        input.setAttribute('aria-describedby', `${inputId}-help`);
        field.append(label, input);
        const help = el('p', 'xp-g-help', kind === 'links' ? 'A bare domain matches the whole site and subdomains. A URL with a path stays an exact URL.'
            : kind === 'allowedUsers' ? 'These accounts bypass all filters. Your follows and blocks on X stay unchanged.'
                : kind === 'affiliations' ? 'Matches an organization name or handle observed by X-Posed. Some affiliation details appear after opening an account’s hovercard.'
                    : 'Matches text containing this value, case-insensitively. Emoji and punctuation are supported.');
        help.id = `${inputId}-help`;
        form.append(field, help);
        const normalized = normalizedDraft(kind);
        if (kind === 'links') {
            const modes = el('div', 'xp-g-segmented');
            for (const [value, titleText] of [['auto', 'Detect from input'], ['domain', 'Whole site'], ['exact', 'Exact URL']]) {
                const choice = button(titleText, () => { view.linkMode = value; render(); });
                choice.id = `x-g-link-mode-${value}`;
                choice.setAttribute('aria-pressed', String(view.linkMode === value)); modes.append(choice);
            }
            form.append(modes);
            if (normalized) {
                const preview = el('div', 'xp-g-link-preview');
                preview.append(el('strong', '', normalized.includes('://') ? 'Exact URL' : 'Domain · includes subdomains'), el('p', 'mono', normalized));
                form.append(preview);
                const overlap = normalized.includes('://') ? findBlockedDomain([normalizeDomain(normalized)], sets.links) : null;
                if (overlap) form.append(el('p', 'xp-g-notice warning', `The saved domain “${overlap}” still matches the whole site. Adding this URL does not narrow that rule. Remove the domain separately if you only want this URL.`));
            }
            form.append(settingCheckbox('linksMatchLocation', 'Also match URLs in profile location', 'Uses self-written profile location text, not X’s account country.'));
        }
        if (kind === 'bioTags') form.append(settingCheckbox('bioTagsMatchLocation', 'Also match bio filters in profile location', 'Applies to all bio filters. Profile location is self-written text.'));
        if (settings.profileEnrichment === false && ['bioTags', 'links'].includes(kind)) form.append(el('p', 'xp-g-notice warning', 'Profile details are disabled. Enable them in Behavior to use observed bios and links.'));
        const risk = ['tags', 'bioTags'].includes(kind) ? describeTagRisk(drafts[kind]) : null;
        if (risk) form.append(el('p', 'xp-g-notice warning', risk));
        const duplicate = normalized && [...sets[kind]].some(value => kind === 'links' ? value === normalized : value.toLowerCase() === normalized.toLowerCase());
        const invalid = Boolean((drafts[kind] || '').trim() && !normalized);
        if (invalid) {
            input.setAttribute('aria-invalid', 'true');
            form.append(el('p', 'xp-g-notice error', kind === 'allowedUsers' ? 'Use 1–15 letters, numbers or underscores, with an optional @.'
                : view.linkMode === 'domain' ? 'For a whole-site rule, enter a bare domain such as youtube.com. Choose Exact URL to keep a path.' : 'Enter a valid domain or HTTP(S) URL without spaces or credentials.'));
        }
        if (duplicate) form.append(el('p', 'xp-g-help', 'This filter is already saved.'));
        const actions = el('div', 'xp-g-form-actions');
        const add = button(kind === 'allowedUsers' ? 'Add account' : 'Add filter', () => form.requestSubmit(), 'xp-g-button primary');
        add.disabled = !normalized || Boolean(duplicate) || pending.has(`${kind}:${normalized}`) || pending.has(`${kind}:undefined`);
        actions.append(add); form.append(actions);
        form.addEventListener('submit', event => {
            event.preventDefault();
            if (add.disabled) return;
            const submitted = drafts[kind];
            mutate(kind, 'add', normalized, () => { if (drafts[kind] === submitted) drafts[kind] = ''; });
        });
        container.append(form);
        if (kind !== 'allowedUsers' && sets[kind].size) {
            const existing = el('div', 'xp-g-existing');
            existing.append(el('h4', '', `Saved ${source.title.toLowerCase()} filters`));
            for (const value of [...sets[kind]].sort()) existing.append(makeRow(source, value));
            container.append(existing);
        }
        return container;
    }

    function renderClear(kind) {
        const container = el('div', 'xp-g-clear');
        const count = sets[kind].size;
        if (!count) return container;
        const source = SOURCES.find(item => item.key === kind);
        const busy = [...pending].some(key => key.startsWith(`${kind}:`));
        if (view.clearKind === kind) {
            container.classList.add('xp-g-notice', 'warning');
            container.append(el('p', '', kind === 'allowedUsers'
                ? `Remove all ${count} saved accounts? Your follow preference and other filters will be kept.`
                : `Remove all ${count} ${source.title.toLowerCase()} filters? Other filter types will be kept.`));
            const confirm = button('Remove all', () => mutate(kind, 'clear', undefined, () => { view.clearKind = null; }));
            confirm.disabled = busy;
            container.append(confirm, button('Cancel', () => { view.clearKind = null; render(); }, 'xp-g-button ghost'));
        } else {
            const clear = button(`Clear ${kind === 'allowedUsers' ? 'saved accounts' : source.title.toLowerCase()} (${count})`, () => { view.clearKind = kind; render(); }, 'xp-g-button ghost');
            clear.disabled = busy;
            container.append(clear);
        }
        return container;
    }

    function renderCountEditor() {
        const container = el('div', 'xp-g-count-editor');
        const metric = ACCOUNT_COUNT_FILTERS.find(item => item.key === view.countMetric);
        const details = COUNT_EDITOR_DETAILS[metric.key];
        const busy = pending.has('settings');
        const selector = el('fieldset', 'xp-g-count-selector');
        selector.append(el('legend', '', 'Choose a rule to add or edit'));
        const instructions = el('p', 'xp-g-help', 'Each rule works independently. Select one below, set a minimum, then save.');
        instructions.id = 'x-g-count-instructions';
        selector.setAttribute('aria-describedby', instructions.id);
        const choices = el('div', 'xp-g-count-metrics');
        for (const group of COUNT_EDITOR_GROUPS) {
            const section = createElement('div', { className: 'xp-g-count-group', role: 'group', 'aria-labelledby': `x-g-count-group-${group.key}` });
            const heading = el('h4', '', group.title);
            heading.id = `x-g-count-group-${group.key}`;
            section.append(heading);
            for (const key of group.rules) {
                const item = COUNT_EDITOR_DETAILS[key];
                const choice = el('label', 'xp-g-count-choice');
                const input = createElement('input', {
                    id: `x-g-count-metric-${key}`, type: 'radio', name: 'x-g-account-rule', value: key,
                    'aria-labelledby': `x-g-count-title-${key}`, 'aria-describedby': `x-g-count-hint-${key}`
                });
                input.checked = key === metric.key;
                input.addEventListener('change', () => {
                    if (!input.checked) return;
                    view.countMetric = key;
                    render();
                });
                const card = el('span', 'xp-g-source xp-g-count-choice-body');
                const text = el('span', 'xp-g-count-choice-text');
                const title = el('strong', '', item.title);
                title.id = `x-g-count-title-${key}`;
                const hint = el('small', '', item.hint);
                hint.id = `x-g-count-hint-${key}`;
                text.append(title, hint);
                card.append(glyph(item.icon, 20), text);
                choice.append(input, card);
                section.append(choice);
            }
            choices.append(section);
        }
        selector.append(instructions, choices);
        container.append(selector);
        const saved = isAccountCountThreshold(settings[metric.key], metric.max) && settings[metric.key] > 0 ? settings[metric.key] : 0;
        const raw = drafts[metric.key] ?? String(saved || metric.suggested);
        const parsed = /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : NaN;
        const valid = isAccountCountThreshold(parsed, metric.max) && parsed > 0;
        const form = el('form');
        const presets = createElement('div', { className: 'xp-g-count-presets', role: 'group', 'aria-label': `${metric.label} presets` });
        for (const threshold of metric.presets) {
            const preset = button(countFormat.format(threshold), () => { drafts[metric.key] = String(threshold); render(); });
            preset.id = `x-g-count-preset-${threshold}`;
            preset.setAttribute('aria-pressed', String(valid && parsed === threshold));
            preset.disabled = busy;
            presets.append(preset);
        }
        if (metric.presets.length) {
            form.append(el('p', 'xp-g-help', 'Choose a preset or enter a custom minimum, then save your filter.'), presets);
        } else {
            form.append(el('p', 'xp-g-help', `Enter a minimum from 1 to ${metric.max}, then save your filter.`));
        }
        const field = el('div', 'xp-g-field');
        const label = el('label', '', details.label);
        label.htmlFor = 'x-g-count-input';
        const input = createElement('input', { id: label.htmlFor, type: 'text', inputmode: 'numeric', className: 'xp-g-input', autocomplete: 'off', 'aria-describedby': 'x-g-count-help x-g-count-validation' });
        input.value = raw;
        input.disabled = busy;
        input.addEventListener('input', event => { drafts[metric.key] = input.value; if (!event.isComposing) render(); });
        input.addEventListener('compositionend', () => { drafts[metric.key] = input.value; render(); });
        input.setAttribute('aria-invalid', String(Boolean(raw.trim()) && !valid));
        field.append(label, input);
        const help = el('p', 'xp-g-help', details.help);
        help.id = 'x-g-count-help';
        const validation = el('p', 'xp-g-notice error', raw.trim() && !valid
            ? metric.max < Number.MAX_SAFE_INTEGER ? `Enter a whole number from 1 to ${metric.max}.` : 'Enter a positive whole number using digits only.'
            : '');
        validation.id = 'x-g-count-validation';
        form.append(field, help, validation);
        if (valid) {
            const preview = el('div', 'xp-g-count-preview');
            preview.append(glyph(details.icon, 18), el('span', '', details.preview(parsed)));
            form.append(preview);
        }
        if (metric.requiresProfile && settings.profileEnrichment === false) {
            const notice = el('div', 'xp-g-notice warning');
            notice.append(el('p', '', 'Profile details are disabled. Following and Total posts filters stay saved but inactive until you enable them in Behavior.'));
            const behavior = button('Open Behavior', () => navigate('behavior'), 'xp-g-button ghost');
            behavior.id = 'x-g-count-enable-profile';
            notice.append(behavior);
            form.append(notice);
        }
        const actions = el('div', 'xp-g-form-actions');
        const save = button(saved ? 'Save changes' : 'Add filter', () => form.requestSubmit(), 'xp-g-button primary');
        save.id = 'x-g-count-save';
        save.disabled = busy || !valid || parsed === saved;
        actions.append(save);
        if (saved && parsed === saved) actions.append(el('span', 'xp-g-help', 'Already saved'));
        form.append(actions);
        form.addEventListener('submit', async event => {
            event.preventDefault();
            if (save.disabled) return;
            const submitted = drafts[metric.key];
            const response = await changeSettings({ [metric.key]: parsed });
            if (response.success && drafts[metric.key] === submitted) { delete drafts[metric.key]; render(); }
        });
        container.append(form, el('p', 'xp-g-help', metric.requiresProfile
            ? 'Uses counts X already loads, without extra requests. Unknown counts do not match. Saved rules follow Hide or Highlight and respect Always Show.'
            : `Uses the visible ${details.source}, even with profile details disabled. No extra requests. Saved rules follow Hide or Highlight and respect Always Show.`));
        const values = filterValues(COUNT_SOURCE);
        if (values.length) {
            const existing = el('section', 'xp-g-existing');
            existing.append(el('h4', '', 'Saved activity and name filters'));
            const list = el('div', 'xp-g-list');
            for (const key of values) list.append(makeCountRow(key));
            existing.append(list);
            container.append(existing);
        }
        return container;
    }

    function renderUsers() {
        const container = el('div', 'xp-g-users');
        container.append(settingSwitch('alwaysShowFollowing', 'Always show accounts I follow',
            'Applies when X provides follow status. Otherwise, your filters still apply.'));
        const accounts = el('section');
        const heading = el('div', 'xp-g-section-heading');
        heading.append(el('h3', '', 'Specific accounts'));
        accounts.append(heading, renderTextEditor('allowedUsers'),
            search('x-g-user-search', 'Search saved accounts', view.userQuery, value => { view.userQuery = value; }));
        const values = [...sets.allowedUsers].sort().filter(value => value.includes(view.userQuery.toLowerCase().replace(/^@/, '').trim()));
        const source = SOURCES.find(item => item.key === 'allowedUsers');
        for (const value of values) accounts.append(makeRow(source, value));
        if (!values.length) accounts.append(empty(sets.allowedUsers.size ? 'No matching accounts' : 'No saved accounts yet', 'Add an exact handle above to always keep that account visible.'));
        accounts.append(renderClear('allowedUsers'));
        container.append(accounts);
        return container;
    }

    function renderBehavior() {
        const container = el('div', 'xp-g-behavior');

        function group(titleText, id) {
            const section = el('section', 'xp-g-behavior-section');
            const heading = el('h3', '', titleText); heading.id = id;
            section.setAttribute('aria-labelledby', id);
            const rows = el('div', 'xp-g-behavior-rows');
            section.append(heading, rows);
            container.append(section);
            return { section, rows };
        }

        const filtering = group('Post filtering', 'x-g-behavior-filtering');
        filtering.rows.append(settingSwitch('hideRelatedPosts', 'Hide replies and quotes of filtered posts',
            'Hide whole replies and quotes of known filter matches, even in Highlight. Use Show post to reveal them.',
            { id: 'x-g-behavior-hideRelatedPosts' }));
        filtering.rows.append(settingSwitch('showVpnUsers', 'Filter accounts with location warnings',
            'Follow Hide or Highlight when X marks a location as uncertain. This is not proof of VPN use.',
            { id: 'x-g-behavior-showVpnUsers', defaultValue: true, inverted: true }));

        const data = group('Data sources', 'x-g-behavior-data');
        data.rows.append(settingSwitch('flagFromDevice', 'Use device country when available',
            'Use the connected app’s country for flags and location filters. Otherwise, use account location.',
            { id: 'x-g-behavior-flagFromDevice' }));
        const profile = settingSwitch('profileEnrichment', 'Use profile details',
            'Use bios, links and activity counts X already loads. No extra requests.',
            { id: 'x-g-behavior-profileEnrichment', helpId: 'x-g-profile-help', defaultValue: true });
        data.rows.append(profile);
        if (settings.profileEnrichment === false) {
            const dependency = el('p', 'xp-g-behavior-dependency',
                'Following and Total posts filters need profile details. Name-digit filters still work.');
            dependency.id = 'x-g-profile-dependency';
            profile.querySelector('input').setAttribute('aria-describedby', 'x-g-profile-help x-g-profile-dependency');
            data.section.append(dependency);
        }

        const note = el('p', 'xp-g-behavior-note');
        const icon = glyph('infoCircle', 16); icon.setAttribute('aria-hidden', 'true');
        note.append(icon, el('span', '', 'Always Show takes priority. Posts you open directly stay readable; unknown relationships keep normal filtering.'));
        container.append(note);
        return container;
    }

    function render(preserveFocus = true) {
        if (closed) return;
        const focused = document.activeElement;
        const focusId = preserveFocus && body.contains(focused)
            ? (focused === body && deferredFocusId ? deferredFocusId : focused.id) : '';
        const selection = focusId && typeof focused.selectionStart === 'number' ? [focused.selectionStart, focused.selectionEnd] : null;
        const scrollTop = body.scrollTop;
        const regionScroll = [...body.querySelectorAll('.xp-g-region-countries')].map(node => [node.id, node.scrollTop]);
        const count = filterTotal();
        // Keep the tab nodes stable so keyboard focus survives broadcasts.
        if (!tabs.children.length) {for (const [key, text] of [['add', 'Add filter'], ['saved', 'Saved filters'], ['allowed', 'Always Show'], ['behavior', 'Behavior']]) {
            const tab = button('', () => navigate(key));
            tab.id = `x-g-tab-${key}`; tab.dataset.tab = key; tab.setAttribute('role', 'tab'); tab.setAttribute('aria-controls', body.id);
            tab.append(el('span', 'xp-g-tab-label', text), el('span', 'xp-g-count')); tabs.append(tab);
            tab.addEventListener('keydown', event => {
                const items = [...tabs.children];
                let index = items.indexOf(tab);
                if (event.key === 'ArrowRight') index = (index + 1) % items.length;
                else if (event.key === 'ArrowLeft') index = (index + items.length - 1) % items.length;
                else if (event.key === 'Home') index = 0;
                else if (event.key === 'End') index = items.length - 1;
                else return;
                event.preventDefault(); navigate(items[index].dataset.tab); items[index].focus();
            });
        }}
        for (const tab of tabs.children) {
            const active = view.tab === tab.dataset.tab;
            tab.classList.toggle('active', active); tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1;
            const badge = tab.querySelector('.xp-g-count');
            badge.textContent = tab.dataset.tab === 'saved' ? String(count) : tab.dataset.tab === 'allowed' ? String(sets.allowedUsers.size) : '';
            badge.hidden = !badge.textContent;
        }
        body.setAttribute('aria-labelledby', `x-g-tab-${view.tab}`);
        const fragment = document.createDocumentFragment();
        if (view.editor) {
            const source = FILTERS.find(item => item.key === view.editor);
            const breadcrumb = createElement('nav', { className: 'xp-g-breadcrumb', 'aria-label': 'Filter navigation' });
            const trail = el('ol');
            const parent = el('li');
            const back = button('Add filter', () => navigate('add'), 'xp-g-breadcrumb-parent');
            back.id = 'x-g-filter-parent';
            parent.append(back);
            const current = el('li');
            current.setAttribute('aria-current', 'page');
            const editorTitle = el('h3', '', source.title);
            editorTitle.id = 'x-g-editor-title';
            editorTitle.tabIndex = -1;
            current.append(glyph('chevronRight', 16), editorTitle);
            trail.append(parent, current);
            breadcrumb.append(trail);
            fragment.append(breadcrumb);
            if (view.editor === COUNT_SOURCE.key) fragment.append(renderCountEditor());
            else if (CATALOGS[view.editor]) fragment.append(renderCatalog(view.editor));
            else fragment.append(renderTextEditor(view.editor));
            if (view.editor !== COUNT_SOURCE.key) fragment.append(renderClear(view.editor));
        } else fragment.append(view.tab === 'add' ? renderChooser() : view.tab === 'saved' ? renderLibrary() : view.tab === 'allowed' ? renderUsers() : renderBehavior());
        body.replaceChildren(fragment);
        body.scrollTop = preserveFocus ? scrollTop : 0;
        if (preserveFocus) {
            for (const [id, scroll] of regionScroll) {
                const replacement = findById(id);
                if (replacement) replacement.scrollTop = scroll;
            }
        }
        if (focusId) {
            const replacement = findById(focusId);
            if (replacement && body.contains(replacement) && !replacement.disabled) {
                deferredFocusId = '';
                replacement.focus({ preventScroll: true });
                if (selection) replacement.setSelectionRange(...selection);
            } else {
                deferredFocusId = replacement?.disabled ? focusId : '';
                body.focus({ preventScroll: true });
            }
        }
        status.textContent = view.editor === COUNT_SOURCE.key && statusText === 'Changes save automatically'
            ? 'Rules change only when saved' : statusText;
        status.classList.toggle('error', statusError);
    }

    if (embedded) {
        container.append(modal);
    } else {
        overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
        document.addEventListener('keydown', handleKeydown, true);
        document.body.append(overlay);
    }
    render(false);
    if (!embedded) title.focus({ preventScroll: true });
    return { overlay, close, updateList, updateSettings, navigate };
}
