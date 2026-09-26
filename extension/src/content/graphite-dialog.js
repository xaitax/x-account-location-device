/** Graphite filtering dialog. All changes use the existing revisioned storage API. */
import { COUNTRY_LIST, REGION_LIST, LANGUAGE_LIST, ACCOUNT_LABELS, CSS_CLASSES, MESSAGE_TYPES } from '../shared/constants.js';
import { createElement, formatCountryName, describeTagRisk } from '../shared/utils.js';
import { normalizeLinkRule, normalizeDomain, normalizeExactUrl, findBlockedDomain, DOMAIN_LIMITS } from '../shared/domain-utils.js';
import { createSnapshotTracker } from '../shared/state-sync.js';
import { createBlockingModeControl } from '../shared/blocking-mode-control.js';
import { FILTER_SOURCES } from '../shared/filter-registry.js';
import { flagImage } from './icons.js';
import { dialogIcon as glyph } from './dialog-icons.js';

const SOURCES = [
    { key: 'countries', title: 'Countries', label: 'Country', icon: 'globe', hint: 'Countries reported by X.' },
    { key: 'regions', title: 'X regions', label: 'X region', icon: 'map', hint: 'Regional labels reported by X.' },
    { key: 'tags', title: 'Display name', label: 'Display name', icon: 'tag', hint: 'Words or emoji in display names.' },
    { key: 'bioTags', title: 'Bio text', label: 'Bio text', icon: 'info', hint: 'Words or phrases in profile bios.' },
    { key: 'links', title: 'Domains & URLs', label: 'Link', icon: 'share', hint: 'Whole websites or exact URLs.' },
    { key: 'pcf', title: 'Account labels', label: 'Account label', icon: 'verified', hint: 'Parody, Commentary, Fan or grey checkmark.' },
    { key: 'affiliations', title: 'Organization affiliation', label: 'Organization', icon: 'affiliation', hint: 'Organization names or handles.' },
    { key: 'languages', title: 'Post languages', label: 'Post language', icon: 'languages', hint: 'The language X detects in a post.' },
    { key: 'allowedUsers', title: 'Always Show', label: 'Account', icon: 'shield' }
].map(view => ({ ...FILTER_SOURCES.find(source => source.kind === view.key), ...view }));
const FILTERS = SOURCES.filter(source => source.key !== 'allowedUsers');
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
    const view = { tab: 'add', editor: null, query: '', source: 'all', catalogQuery: '', selectedOnly: false, userQuery: '', linkMode: 'auto', clearKind: null };

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
        const target = previousSource || body.querySelector('input, select, .xp-g-source, #x-g-editor-title') || body;
        if (!embedded || modal.getClientRects().length) target.focus({ preventScroll: true });
    }

    function sourceLabel(kind, value) {
        if (kind === 'countries') return formatCountryName(value);
        if (kind === 'allowedUsers') return `@${value}`;
        return CATALOGS[kind]?.find(item => item.value === value)?.label || value;
    }

    function makeRow(source, value) {
        const row = el('div', 'xp-g-row');
        const label = source.key === 'links' ? (value.includes('://') ? 'Exact URL' : 'Domain') : source.label;
        const kind = el('span', 'xp-g-kind', label);
        const content = el('span', `xp-g-value${source.key === 'links' ? ' mono' : ''}`);
        const icon = locationIcon(source.key, value);
        if (icon) content.append(icon);
        content.append(el('span', '', sourceLabel(source.key, value)));
        const remove = iconButton(`Remove ${label}: ${sourceLabel(source.key, value)}`, 'close', () => mutate(source.key, 'remove', value));
        remove.id = `x-g-remove-${source.key}-${encodeURIComponent(value)}`;
        remove.disabled = pending.has(`${source.key}:${value}`) || pending.has(`${source.key}:undefined`);
        row.append(kind, content, remove);
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
        headingText.append(el('h3', '', 'Saved filters'), el('p', '', 'Review or remove the filters you have added.'));
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
            for (const value of [...sets[source.key]].sort((a, b) => sourceLabel(source.key, a).localeCompare(sourceLabel(source.key, b)))) {
                if (query && !`${source.title} ${sourceLabel(source.key, value)} ${value}`.toLocaleLowerCase().includes(query)) continue;
                list.append(makeRow(source, value)); shown++;
            }
        }
        const total = FILTERS.reduce((count, source) => count + sets[source.key].size, 0);
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
            const count = sets[source.key].size;
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
        container.append(el('p', 'xp-g-help', kind === 'regions' ? 'Regions match the label reported by X. Selecting Europe does not select individual European countries.'
            : kind === 'languages' ? 'Uses the language X detects for the post, not the author’s country. Unknown languages are not filtered.'
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
            : kind === 'allowedUsers' ? 'Exact handles only. These accounts override all filters; this does not change whom you follow or block on X.'
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
            container.append(el('p', '', `Remove all ${count} ${kind === 'allowedUsers' ? 'Always Show exceptions' : `${source.title.toLowerCase()} filters`}? Other filter types will be kept.`));
            const confirm = button('Remove all', () => mutate(kind, 'clear', undefined, () => { view.clearKind = null; }));
            confirm.disabled = busy;
            container.append(confirm, button('Cancel', () => { view.clearKind = null; render(); }, 'xp-g-button ghost'));
        } else {
            const clear = button(`Clear ${source.title.toLowerCase()} (${count})`, () => { view.clearKind = kind; render(); }, 'xp-g-button ghost');
            clear.disabled = busy;
            container.append(clear);
        }
        return container;
    }

    function renderUsers() {
        const container = el('div', 'xp-g-users');
        container.append(el('p', 'xp-g-help', 'Always keep these accounts visible, even when they match your filters.'), renderTextEditor('allowedUsers'),
            search('x-g-user-search', 'Search saved accounts', view.userQuery, value => { view.userQuery = value; }));
        const values = [...sets.allowedUsers].sort().filter(value => value.includes(view.userQuery.toLowerCase().replace(/^@/, '').trim()));
        const source = SOURCES.find(item => item.key === 'allowedUsers');
        for (const value of values) container.append(makeRow(source, value));
        if (!values.length) container.append(empty(sets.allowedUsers.size ? 'No matching accounts' : 'No exceptions yet', 'Add an exact handle above to always keep that account visible.'));
        container.append(renderClear('allowedUsers'));
        return container;
    }

    function renderBehavior() {
        const container = el('div', 'xp-g-behavior');
        const heading = el('div', 'xp-g-section-heading');
        heading.append(el('h3', '', 'Filtering preferences'), el('p', '', settings.highlightBlockedTweets === true
            ? 'Highlight is active. Matching posts stay visible and are highlighted.'
            : 'Hide is active. Matching posts are hidden from your feed.'));
        container.append(heading);

        function choiceSection(key, titleText, labelText, options, description, defaultValue) {
            const section = el('section', 'xp-g-behavior-section');
            section.append(el('h4', '', titleText));
            const field = el('div', 'xp-g-setting-choice');
            const id = `x-g-behavior-${key}`;
            const label = el('label', '', labelText); label.htmlFor = id;
            const select = createElement('select', { id, className: 'xp-g-select', 'aria-describedby': `${id}-help` });
            for (const [value, text] of options) {
                const option = el('option', '', text); option.value = String(value); select.append(option);
            }
            select.value = String(settings[key] === undefined ? defaultValue : settings[key] === true);
            select.disabled = pending.has('settings');
            select.addEventListener('change', () => changeSettings({ [key]: select.value === 'true' }));
            const help = el('p', '', description); help.id = `${id}-help`;
            field.append(label, select, help); section.append(field);
            return section;
        }

        container.append(choiceSection('showVpnUsers', 'Location warnings', 'When X marks an account’s location as uncertain', [
            [true, 'Use saved filters only'], [false, 'Also filter accounts with location warnings']
        ], 'A warning indicates location uncertainty, not confirmed VPN use. Saved filters still apply. Warning matches follow Hide or Highlight.', true));
        container.append(choiceSection('flagFromDevice', 'Country source', 'Preferred location source', [
            [false, 'Account location'], [true, 'Device country, when available']
        ], 'Used for flags and country/region filters. Device country comes from the connected app; account location is used when it is unavailable.', false));

        const profile = el('section', 'xp-g-behavior-section');
        const row = el('div', 'xp-g-setting');
        const text = el('div');
        const label = el('label', '', 'Use profile details'); label.htmlFor = 'x-g-behavior-profileEnrichment';
        const help = el('p', '', 'Read bios, links and account details that X already loads. No extra requests are made; these details stay on this device.');
        help.id = 'x-g-profile-help';
        text.append(label, help);
        const input = createElement('input', { id: label.htmlFor, type: 'checkbox', className: 'xp-g-switch', role: 'switch', 'aria-describedby': help.id });
        input.checked = settings.profileEnrichment !== false;
        input.disabled = pending.has('settings');
        input.addEventListener('change', () => changeSettings({ profileEnrichment: input.checked }));
        row.append(text, input); profile.append(row); container.append(profile);

        const notes = el('section', 'xp-g-rule-notes');
        const list = el('ul');
        for (const note of [
            'A post only needs to match one filter.',
            'Always Show accounts are exempt from all filters.',
            'Highlight keeps all matching posts visible, including location warnings.'
        ]) list.append(el('li', '', note));
        notes.append(el('h4', '', 'How your filters work together'), list);
        const details = el('details', 'xp-g-details');
        details.append(el('summary', '', 'Quotes, replies and opened posts'),
            el('p', '', 'In Hide mode, a matching quoted author hides only the quote. You can reveal it without changing your filters.'),
            el('p', '', 'When X-Posed can identify the main post you opened, it stays readable. Replies still follow your filters. Accounts in people lists remain visible.'));
        container.append(notes, details);
        return container;
    }

    function render(preserveFocus = true) {
        if (closed) return;
        const focused = document.activeElement;
        const focusId = preserveFocus && body.contains(focused)
            ? (focused === body && deferredFocusId ? deferredFocusId : focused.id) : '';
        const selection = focusId && typeof focused.selectionStart === 'number' ? [focused.selectionStart, focused.selectionEnd] : null;
        const scrollTop = body.scrollTop;
        const count = FILTERS.reduce((total, source) => total + sets[source.key].size, 0);
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
            const source = SOURCES.find(item => item.key === view.editor);
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
            if (CATALOGS[view.editor]) fragment.append(renderCatalog(view.editor));
            else fragment.append(renderTextEditor(view.editor));
            fragment.append(renderClear(view.editor));
        } else fragment.append(view.tab === 'add' ? renderChooser() : view.tab === 'saved' ? renderLibrary() : view.tab === 'allowed' ? renderUsers() : renderBehavior());
        body.replaceChildren(fragment);
        body.scrollTop = preserveFocus ? scrollTop : 0;
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
        status.textContent = statusText;
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
