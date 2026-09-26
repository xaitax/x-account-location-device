/** Graphite statistics. Reads only local aggregates; never requests X or cloud data. */
import browserAPI from '../shared/browser-api.js';
import { MESSAGE_TYPES } from '../shared/constants.js';
import { deviceIcon } from '../content/icons.js';
import { dialogIcon } from '../content/dialog-icons.js';
import { countValue, createWorldMap, locationDistribution } from './world-map.js';

function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function button(id, label, onClick, primary = false) {
    const node = element('button', `btn btn-small${primary ? ' btn-primary' : ''}`, label);
    node.id = id;
    node.type = 'button';
    node.addEventListener('click', onClick);
    return node;
}

function percentage(count, total) {
    return total ? `${Math.round(count / total * 100)}%` : '0%';
}

function validSnapshot(data, filtering) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
    const total = filtering ? data.totalPosts : data.totalUsers;
    if (!Number.isSafeInteger(total) || total < 0) return false;
    for (const field of ['countryCounts', 'deviceCounts']) {
        if (!data[field] || typeof data[field] !== 'object' || Array.isArray(data[field])) return false;
    }
    return !filtering || (typeof data.epoch === 'string' && data.epoch.length > 0);
}

function distributionList(rows, total, kind, unit, expanded) {
    const root = element('div', 'xp-stat-distribution');
    root.dataset.locationKind = kind;
    if (!rows.length) {
        root.append(element('p', 'xp-stat-muted', 'No recorded locations yet.'));
        return root;
    }
    const createList = entries => {
        const list = element('ul', 'xp-stat-list');
        for (const row of entries) {
            const li = element('li', 'xp-stat-row');
            const label = element('span', 'xp-stat-row-name', row.label);
            if (row.onMap === false) {
                label.append(element('span', 'xp-stat-row-note', 'Not shown at this map scale'));
            }
            const count = element('span', 'xp-stat-row-count', row.count.toLocaleString());
            count.append(element('small', '', percentage(row.count, total)));
            count.setAttribute('aria-label', `${row.count.toLocaleString()} ${unit}, ${percentage(row.count, total)}`);
            const bar = element('span', 'xp-stat-row-bar');
            bar.setAttribute('aria-hidden', 'true');
            bar.style.width = `${total ? Math.min(100, row.count / total * 100) : 0}%`;
            li.append(label, count, bar);
            list.append(li);
        }
        return list;
    };
    root.append(createList(rows.slice(0, 5)));
    if (rows.length > 5) {
        const more = element('details', 'xp-stat-more');
        more.dataset.list = kind;
        more.open = expanded.has(kind);
        const summary = element('summary', '', `All ${rows.length.toLocaleString()} locations`);
        summary.dataset.statFocus = `more-${kind}`;
        const remaining = createList(rows.slice(5));
        remaining.tabIndex = 0;
        remaining.dataset.statFocus = `remaining-${kind}`;
        remaining.setAttribute('aria-label', 'Additional locations and exact counts');
        more.append(summary, remaining);
        root.append(more);
    }
    return root;
}

function deviceDistribution(counts, total, unit) {
    const values = { iOS: 0, Android: 0, Web: 0, Unknown: 0 };
    for (const [key, value] of Object.entries(counts || {})) {
        const name = Object.keys(values).find(candidate => candidate.toLowerCase() === key.toLowerCase()) || 'Unknown';
        values[name] += countValue(value);
    }
    values.Unknown += Math.max(0, total - Object.values(values).reduce((sum, count) => sum + count, 0));
    const root = element('div', 'xp-stat-devices');
    for (const [device, count] of Object.entries(values)) {
        const row = element('div', 'xp-stat-device');
        row.dataset.device = device;
        const icon = device === 'Unknown' ? dialogIcon('infoCircle', 17) : deviceIcon({ iOS: 'app store', Android: 'android', Web: 'web' }[device], 17);
        const label = element('span', 'xp-stat-device-label', device);
        const value = element('strong', '', count.toLocaleString());
        value.setAttribute('aria-label', `${count.toLocaleString()} ${unit}`);
        row.append(icon, label, value, element('span', 'xp-stat-muted', percentage(count, total)));
        root.append(row);
    }
    return root;
}

export function mountStatistics(host) {
    let active = 'filtering';
    let disposed = false;
    let generation = 0;
    let pending = false;
    let resetting = false;
    let resetNeedsRefresh = false;
    let confirmEpoch = null;
    const snapshots = { filtering: null, cache: null };
    const errors = { filtering: '', cache: '' };
    const root = element('section', 'options-section');
    root.id = 'stats-section';
    const header = element('div', 'xp-stat-header');
    const title = element('h2', 'section-title');
    title.append(dialogIcon('chart', 20), document.createTextNode('Statistics'));
    const refresh = button('stats-refresh', 'Refresh', () => { void load(); });
    header.append(title, refresh);
    const description = element('p', 'section-description', 'A local view of what your filters catch and the accounts your browser remembers.');
    const tabs = element('div', 'xp-stat-tabs');
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', 'Statistics category');
    const tabButtons = ['filtering', 'cache'].map((key, index) => {
        const tab = button(`stats-tab-${key}`, key === 'filtering' ? 'Filtering' : 'Cached accounts', () => select(key));
        tab.className = 'xp-stat-tab';
        tab.setAttribute('role', 'tab');
        tab.setAttribute('aria-controls', 'stats-content');
        tab.addEventListener('keydown', event => {
            let next;
            if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') next = 1 - index;
            else if (event.key === 'Home') next = 0;
            else if (event.key === 'End') next = 1;
            else return;
            event.preventDefault();
            tabButtons[next].focus();
            select(next ? 'cache' : 'filtering');
        });
        return tab;
    });
    tabs.append(...tabButtons);
    const status = element('p', 'xp-stat-status');
    status.id = 'stats-status';
    status.setAttribute('role', 'status');
    status.hidden = true;
    const reset = button('stats-reset', 'Reset counts', showConfirmation);
    const actions = element('div', 'xp-stat-actions');
    actions.append(element('span', 'xp-stat-muted', 'Stored only in this browser'), reset);
    const confirmation = element('div', 'xp-stat-confirm');
    confirmation.hidden = true;
    confirmation.setAttribute('role', 'group');
    confirmation.setAttribute('aria-labelledby', 'stats-confirm-title');
    const confirmTitle = element('strong', '', 'Start counting again?');
    confirmTitle.id = 'stats-confirm-title';
    confirmation.append(confirmTitle, element('p', '', 'This clears your filtering totals and remembered post fingerprints. Posts seen again can count again. Your filters and cached accounts stay unchanged.'));
    const cancel = button('stats-reset-cancel', 'Cancel', () => closeConfirmation(true));
    const confirm = button('stats-reset-confirm', 'Reset filtering counts', () => { void resetCounts(); }, true);
    const confirmActions = element('div', 'btn-group');
    confirmActions.append(cancel, confirm);
    confirmation.append(confirmActions);
    confirmation.addEventListener('keydown', event => {
        if (event.key !== 'Escape' || resetting) return;
        event.preventDefault();
        closeConfirmation(true);
    });
    const content = element('div', 'xp-stat-content');
    content.id = 'stats-content';
    content.setAttribute('role', 'tabpanel');
    content.setAttribute('tabindex', '0');
    root.append(header, description, tabs, status, actions, confirmation, content);
    host.replaceChildren(root);

    function closeConfirmation(restoreFocus = false) {
        confirmation.hidden = true;
        confirmEpoch = null;
        if (restoreFocus) reset.focus();
    }

    function showConfirmation() {
        if (!snapshots.filtering || resetting || pending || resetNeedsRefresh) return;
        confirmEpoch = snapshots.filtering.epoch;
        confirmation.hidden = false;
        status.hidden = true;
        cancel.focus();
    }

    function select(key) {
        if (resetting || disposed) return;
        active = key;
        closeConfirmation();
        render();
        void load();
    }

    function controls() {
        refresh.disabled = pending || resetting;
        refresh.textContent = pending ? 'Refreshing...' : 'Refresh';
        reset.disabled = pending || resetting || resetNeedsRefresh || !snapshots.filtering || !snapshots.filtering.totalPosts;
        reset.hidden = active !== 'filtering';
        confirm.disabled = resetting;
        cancel.disabled = resetting;
        confirm.textContent = resetting ? 'Resetting...' : 'Reset filtering counts';
        tabButtons.forEach((tab, index) => {
            const selected = active === (index ? 'cache' : 'filtering');
            tab.setAttribute('aria-selected', String(selected));
            tab.tabIndex = selected ? 0 : -1;
            tab.disabled = resetting;
        });
        content.setAttribute('aria-labelledby', `stats-tab-${active}`);
        content.setAttribute('aria-busy', String(pending || resetting));
    }

    function render() {
        controls();
        const snapshot = snapshots[active];
        status.textContent = errors[active];
        status.hidden = !errors[active];
        const focusedKey = content.contains(document.activeElement) ? document.activeElement.dataset.statFocus : null;
        const expanded = new Set([...content.querySelectorAll('details[open][data-list]')].map(node => node.dataset.list));
        content.replaceChildren();
        if (!snapshot) {
            content.append(element('p', 'empty-state', errors[active] ? 'Use Refresh to try again. No data has been changed.' : 'Loading local statistics...'));
            return;
        }
        const filtering = active === 'filtering';
        const total = countValue(filtering ? snapshot.totalPosts : snapshot.totalUsers);
        const unit = filtering ? 'posts' : 'accounts';
        const locations = locationDistribution(snapshot.countryCounts, total);
        const summary = element('div', 'xp-stat-summary');
        const headline = element('div', 'xp-stat-total');
        const number = element('strong', '', total.toLocaleString());
        number.dataset.statTotal = '';
        headline.append(number, element('span', '', filtering ? 'unique posts caught' : 'cached accounts'));
        summary.append(headline);
        if (filtering) {
            const since = new Date(snapshot.since);
            const sinceLabel = snapshot.since && Number.isFinite(since.getTime())
                ? `Since ${since.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
                : 'Counting starts with matching posts you view';
            summary.append(element('p', 'xp-stat-muted', sinceLabel));
            if (!total) summary.append(element('p', 'xp-stat-empty-note', 'Browse X with your filters on. Identifiable matching posts will appear here, whether hidden or highlighted.'));
        } else {
            const meta = element('p', 'xp-stat-muted');
            const knownLocations = locations.countries.length + locations.regions.length + locations.unmapped.length;
            const warnings = countValue(snapshot.vpnCount);
            meta.textContent = `${knownLocations.toLocaleString()} reported locations · ${warnings.toLocaleString()} location warnings (${percentage(warnings, total)})`;
            summary.append(meta);
            if (!total) summary.append(element('p', 'xp-stat-empty-note', 'Your browser has no cached accounts yet. Account details collected while browsing X will appear here.'));
        }
        content.append(summary);

        const geography = element('section', 'xp-stat-geography');
        const mapSide = element('div', 'xp-stat-map-side');
        mapSide.append(element('h3', 'xp-stat-subtitle', 'Locations'), createWorldMap(locations, unit));
        const countrySide = element('div', 'xp-stat-country-side');
        countrySide.append(element('h3', 'xp-stat-subtitle', 'Countries & territories'), distributionList(locations.countries, total, 'countries', unit, expanded));
        geography.append(mapSide, countrySide);
        content.append(geography);

        const other = element('div', 'xp-stat-other-locations');
        for (const [kind, label] of [['regions', 'X-reported regions'], ['unmapped', 'Other reported locations']]) {
            if (!locations[kind].length) continue;
            const block = element('section', 'xp-stat-location-group');
            block.append(element('h3', 'xp-stat-subtitle', label), distributionList(locations[kind], total, kind, unit, expanded));
            other.append(block);
        }
        const unknown = element('div', 'xp-stat-unknown');
        unknown.dataset.locationKind = 'unknown';
        unknown.append(element('span', '', 'Unknown location'), element('strong', '', `${locations.unknown.toLocaleString()} (${percentage(locations.unknown, total)})`));
        other.append(unknown);
        content.append(other);
        const devices = element('section', 'xp-stat-device-section');
        devices.append(element('h3', 'xp-stat-subtitle', 'Devices'), deviceDistribution(snapshot.deviceCounts, total, unit));
        content.append(devices);

        const explanation = element('details', 'xp-stat-explanation');
        explanation.dataset.list = 'about';
        explanation.open = expanded.has('about');
        const explanationTitle = element('summary', '', 'About these counts');
        explanationTitle.dataset.statFocus = 'about-counts';
        explanation.append(explanationTitle);
        explanation.append(element('p', '', filtering
            ? 'Counts identifiable posts that match your filters, including hidden and highlighted posts. Each post counts once across this browser until reset. Quotes without a reliable post ID are not counted. There is no history backfill. Small local fingerprints prevent duplicate counts until you reset them.'
            : 'A snapshot of accounts currently in this browser\'s cache, not the shared community cache. Expiry, cache clearing and newly cached accounts can change these totals. Location warnings are those reported by X.'));
        explanation.append(element('p', '', 'Country and device information is recorded as available. Unknown is kept in the totals. X-reported regions are listed separately, never distributed among countries. These views make no additional X or cloud requests.'));
        explanation.append(element('p', '', 'Map: Natural Earth, public domain. This simplified map omits some small territories. The location lists include them. Boundaries do not imply a position on disputed areas.'));
        content.append(explanation);
        if (focusedKey) {
            [...content.querySelectorAll('[data-stat-focus]')].find(node => node.dataset.statFocus === focusedKey)?.focus({ preventScroll: true });
        }
    }

    async function load() {
        if (disposed || resetting) return;
        const request = ++generation;
        const key = active;
        pending = true;
        controls();
        try {
            const response = await browserAPI.runtime.sendMessage({ type: key === 'filtering' ? MESSAGE_TYPES.GET_FILTER_STATISTICS : MESSAGE_TYPES.GET_STATISTICS });
            if (disposed || request !== generation) return;
            if (!response?.success || !validSnapshot(response.data, key === 'filtering')) throw new Error('Read failed');
            snapshots[key] = response.data;
            if (key === 'filtering') resetNeedsRefresh = false;
            errors[key] = '';
        } catch {
            if (disposed || request !== generation) return;
            errors[key] = snapshots[key] ? 'Could not refresh local statistics. Showing the last loaded counts.' : 'Could not load local statistics.';
        } finally {
            if (!disposed && request === generation) {
                pending = false;
                render();
            }
        }
    }

    async function resetCounts() {
        if (disposed || resetting || confirmEpoch === null) return;
        const epoch = confirmEpoch;
        const request = ++generation;
        resetting = true;
        pending = false;
        controls();
        try {
            const response = await browserAPI.runtime.sendMessage({ type: MESSAGE_TYPES.RESET_FILTER_STATISTICS, payload: { epoch } });
            if (disposed || request !== generation) return;
            if (response?.code === 'STALE_EPOCH') {
                if (!validSnapshot(response.data, true)) throw new Error('Reset snapshot missing');
                snapshots.filtering = response.data;
                errors.filtering = 'These counts were already reset elsewhere. Review the refreshed totals before resetting again.';
            } else if (!response?.success || !validSnapshot(response.data, true)) {
                throw new Error('Reset failed');
            } else {
                snapshots.filtering = response.data;
                errors.filtering = 'Filtering counts reset. Your filters and cached accounts are unchanged.';
            }
        } catch {
            if (disposed || request !== generation) return;
            resetNeedsRefresh = true;
            errors.filtering = 'Could not confirm the reset. Refresh to check the current counts before trying again.';
        } finally {
            if (!disposed && request === generation) {
                resetting = false;
                closeConfirmation();
                render();
                if (!reset.disabled) reset.focus();
                else refresh.focus();
            }
        }
    }

    render();
    return {
        refresh: load,
        destroy() {
            disposed = true;
            generation++;
            root.remove();
        }
    };
}
