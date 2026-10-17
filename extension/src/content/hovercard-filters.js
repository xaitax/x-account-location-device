/** Quick filters use current local state and existing committed filter mutations only. */
import {
    COUNTRY_LIST, MESSAGE_TYPES, REGION_NAMES, canonicalCountry, isRegion, observedAccountId
} from '../shared/constants.js';
import { formatCountryName, getDeviceCountry, getLoggedInUsername } from '../shared/utils.js';
import { getProfile } from './profile-cache.js';
import { isFollowing } from './following-cache.js';
import { dialogIcon } from './dialog-icons.js';
import { matchingBlockedRegions } from '../shared/region-membership.js';

const COUNTRIES = new Set(COUNTRY_LIST);
let quickFilterSequence = 0;

function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function includes(values, value, normalize = entry => entry) {
    if (!Array.isArray(values) && !(values instanceof Set)) return false;
    return [...values].some(entry => normalize(entry) === value);
}

/** Never turn an unknown location into a guessed country or invented flag. */
function locationTarget(info, settings) {
    const reported = settings.flagFromDevice === true && typeof info?.device === 'string'
        ? getDeviceCountry(info.device) || info?.location : info?.location;
    const value = canonicalCountry(reported);
    const region = isRegion(value);
    if (!region && !COUNTRIES.has(value)) return null;
    return {
        type: region ? MESSAGE_TYPES.SET_BLOCKED_REGIONS : MESSAGE_TYPES.SET_BLOCKED_COUNTRIES,
        field: region ? 'blockedRegions' : 'blockedCountries',
        key: region ? 'region' : 'country',
        noun: region ? 'region' : 'country',
        value,
        label: region ? REGION_NAMES[value] : formatCountryName(value),
        icon: region ? 'map' : 'globe'
    };
}

export function createQuickFilterControl({
    handle, info, getState, sendMessage, isCurrent = () => true, onChange = () => {}, writes = new Map()
}) {
    const validHandle = typeof handle === 'string' && /^[a-zA-Z0-9_]{1,15}(?![\s\S])/.test(handle);
    let currentInfo = info;
    let disposed = false;
    let localPending = false;
    let feedback = '';
    let feedbackTone = '';
    let feedbackKey = null;
    const watched = new WeakSet();
    const container = element('div', 'x-posed-quick-controls x-posed-footer-section');
    const heading = element('div', 'x-posed-footer-section-heading', 'Hide');
    heading.id = `x-posed-quick-filters-heading-${++quickFilterSequence}`;
    container.setAttribute('role', 'group');
    container.setAttribute('aria-labelledby', heading.id);
    const group = element('div', 'x-posed-quick-filters x-posed-footer-section-controls');
    const status = element('div', 'x-posed-quick-filter-status');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.hidden = true;
    container.append(heading, group, status);
    const controls = new Map();
    const writeKey = target => `${target.type}:${target.value}`;
    const alive = () => !disposed && isCurrent();
    const readState = () => getState?.() || {};
    const selected = (state, target) => includes(state[target.field], target.value,
        target.noun === 'account' ? value => value : canonicalCountry);

    function targets(state) {
        const userId = validHandle ? observedAccountId(currentInfo, getProfile(handle)) : null;
        return {
            location: locationTarget(currentInfo, state.settings || {}),
            account: userId ? {
                type: MESSAGE_TYPES.SET_BLOCKED_ACCOUNTS, field: 'blockedAccounts', key: 'accountId',
                noun: 'account', value: userId, label: `@${handle}`, icon: 'atSign'
            } : null
        };
    }

    function pendingFor(currentTargets) {
        return localPending || Object.values(currentTargets).some(target => target && writes.has(writeKey(target)));
    }

    function watch(operation) {
        if (!operation || typeof operation.then !== 'function' || watched.has(operation)) return;
        watched.add(operation);
        // Reopened cards subscribe to an existing write instead of issuing it again.
        void operation.then(() => {
            if (alive()) refresh();
        }, () => {
            if (alive()) refresh();
        });
    }

    function refresh() {
        if (disposed) return;
        const state = readState();
        const currentTargets = targets(state);
        if (feedbackKey && !Object.values(currentTargets).some(target => target && writeKey(target) === feedbackKey)) {
            feedback = '';
            feedbackTone = '';
            feedbackKey = null;
        }
        const pending = pendingFor(currentTargets);
        const verb = state.settings?.highlightBlockedTweets === true ? 'Highlight' : 'Hide';
        const savedRegions = Array.isArray(state.blockedRegions) ? state.blockedRegions
            : state.blockedRegions instanceof Set ? [...state.blockedRegions] : [];
        const blockedRegions = new Set(savedRegions.map(canonicalCountry));
        if (heading.textContent !== verb) heading.textContent = verb;
        for (const [kind, control] of controls) {
            const target = currentTargets[kind];
            if (target) watch(writes.get(writeKey(target)));
            const active = target ? selected(state, target) : false;
            const regions = target?.noun === 'country'
                ? matchingBlockedRegions(target.value, blockedRegions, state.settings?.regionCountrySelections) : [];
            const regionNames = regions.map(region => REGION_NAMES[region] || formatCountryName(region)).join(', ');
            const covered = !active && regions.length > 0;
            const caption = kind === 'account' ? 'Account' : target?.noun === 'region' ? 'Region' : 'Country';
            const description = target ? active ? `Remove ${target.noun} filter for ${target.label}` : `${verb} ${target.label}`
                : kind === 'account' ? 'Unavailable. Waiting for a known user ID' : 'Unavailable. No supported location is known';
            const identity = target?.noun === 'account' ? ` Permanent user ID: ${target.value}.` : '';
            control.text.textContent = caption;
            control.button.setAttribute('aria-label', `${caption}: ${description}.${identity}`);
            if (regions.length) {
                const coverage = active
                    ? `Regional coverage through ${regionNames} remains after removing this direct country filter.`
                    : `${target.label} is already covered by ${regionNames}. Activating adds a separate country filter.`;
                control.button.setAttribute('aria-label', `${control.button.getAttribute('aria-label')} ${coverage}`);
            }
            control.button.setAttribute('aria-pressed', String(active));
            control.button.setAttribute('aria-disabled', String(pending || !target));
            control.check.hidden = !active;
            control.coverage.hidden = !covered;
            if (covered) control.button.dataset.coverage = 'region';
            else delete control.button.dataset.coverage;
            if (pending) control.button.setAttribute('aria-busy', 'true');
            else control.button.removeAttribute('aria-busy');
            control.button.removeAttribute('title');
            control.button.dataset.xTooltipHeading = target
                ? active ? `Remove ${target.noun} filter` : `${verb} ${target.label}`
                : kind === 'account' ? 'Account not identified yet' : 'Location unavailable';
            control.button.dataset.xTooltipDescription = !target
                ? kind === 'account'
                    ? 'This becomes available when X provides the account’s permanent User ID.'
                    : 'X hasn’t provided a supported country or region for this account.'
                : active
                    ? `Removes the direct filter for ${target.label}. Other saved filters may still apply.`
                    : target.noun === 'account'
                        ? 'Applies to this account, even if its handle changes. Only changes what you see on X.'
                        : target.noun === 'region'
                            ? 'Matches X’s region label and any countries you’ve included for this region in Blocking.'
                            : `Applies to all accounts matched to ${target.label}, not just this one.`;
            if (covered) {
                control.button.dataset.xTooltipHeading = regions.length === 1
                    ? `Included through ${regionNames}` : 'Included through regions';
                control.button.dataset.xTooltipDescription = `${target.label} is already covered by ${regionNames}. ` +
                    'Clicking adds a separate country filter; it does not change your region selections.';
            } else if (active && regions.length) {
                control.button.dataset.xTooltipDescription = `Removes the direct filter for ${target.label}. ` +
                    `${regionNames} still ${regions.length === 1 ? 'applies' : 'apply'} through your region selections.`;
            }
            const icon = target?.icon || (kind === 'account' ? 'atSign' : 'globe');
            if (control.iconName !== icon) {
                control.icon.replaceChildren(dialogIcon(icon, 18));
                control.iconName = icon;
            }
        }
        const alwaysShow = validHandle && includes(state.allowedUsers, handle.toLowerCase(), value =>
            typeof value === 'string' ? value.replace(/^@+/, '').toLowerCase() : '');
        const ownAccount = validHandle && getLoggedInUsername()?.toLowerCase() === handle.toLowerCase();
        const followedAccount = validHandle && state.settings?.alwaysShowFollowing === true && isFollowing(handle);
        container.dataset.exempt = String(ownAccount || alwaysShow || followedAccount);
        const notice = ownAccount ? 'Your own account always stays visible.'
            : alwaysShow ? 'Always Show takes priority for this account.'
                : followedAccount ? 'Your Always Show followed accounts setting takes priority for this account.' : '';
        if (notice) {
            for (const { button } of controls.values()) {
                button.dataset.xTooltipDescription += ` ${notice}`;
                button.setAttribute('aria-label', `${button.getAttribute('aria-label')} ${notice}`);
            }
        }
        status.textContent = [feedback, notice].filter(Boolean).join(' ');
        status.hidden = !status.textContent;
        if (feedbackTone) status.dataset.tone = feedbackTone;
        else delete status.dataset.tone;
        onChange();
    }

    async function activate(kind, event) {
        event.preventDefault();
        event.stopPropagation();
        if (!alive()) return;
        const state = readState();
        const currentTargets = targets(state);
        if (pendingFor(currentTargets)) return;
        // Capture the identity/location and requested operation before any await.
        const target = currentTargets[kind];
        if (!target) return;
        const action = selected(state, target) ? 'remove' : 'add';
        const key = writeKey(target);
        const sameTarget = () => {
            const current = targets(readState())[kind];
            return current && writeKey(current) === key;
        };
        localPending = true;
        feedback = '';
        feedbackTone = '';
        feedbackKey = null;
        // Deferring invocation one microtask publishes the shared guard first, even
        // if a transport calls back synchronously or another card opens immediately.
        const operation = Promise.resolve().then(() => sendMessage({
            type: target.type, payload: { action, [target.key]: target.value }
        })).finally(() => {
            // Subscribers must see the guard cleared before their settle refresh.
            if (writes.get(key) === operation) writes.delete(key);
        });
        writes.set(key, operation);
        refresh();
        try {
            const response = await operation;
            if (response?.success !== true || !Array.isArray(response.data) ||
                selected({ [target.field]: response.data }, target) !== (action === 'add')) {
                throw new Error('The filter change was not saved.');
            }
            if (!alive() || !sameTarget()) return;
            feedback = `${target.noun.charAt(0).toUpperCase() + target.noun.slice(1)} filter ${action === 'add' ? 'added' : 'removed'}.`;
            feedbackTone = 'success';
            feedbackKey = key;
        } catch {
            if (!alive() || !sameTarget()) return;
            feedback = 'Could not save this filter. Please try again.';
            feedbackTone = 'error';
            feedbackKey = key;
        } finally {
            if (writes.get(key) === operation) writes.delete(key);
            localPending = false;
            if (alive()) refresh();
        }
    }

    for (const kind of ['location', 'account']) {
        const button = element('button', 'x-posed-quick-filter x-posed-card-action');
        button.type = 'button';
        button.dataset.action = kind;
        const icon = element('span', 'x-posed-quick-filter-icon');
        icon.setAttribute('aria-hidden', 'true');
        const text = element('span', 'x-posed-card-action-label');
        const check = element('span', 'x-posed-card-action-check');
        check.setAttribute('aria-hidden', 'true');
        check.appendChild(dialogIcon('check', 10));
        check.hidden = true;
        const coverage = element('span', 'x-posed-card-action-coverage');
        coverage.setAttribute('aria-hidden', 'true');
        coverage.hidden = true;
        button.append(icon, text, check, coverage);
        button.addEventListener('click', event => { void activate(kind, event); });
        controls.set(kind, { button, icon, text, check, coverage, iconName: null });
        group.appendChild(button);
    }
    refresh();
    return {
        element: container, heading, status, refresh,
        updateInfo(nextInfo) {
            if (disposed) return;
            currentInfo = nextInfo;
            refresh();
        },
        dispose() { disposed = true; },
        get pending() { return pendingFor(targets(readState())); }
    };
}
