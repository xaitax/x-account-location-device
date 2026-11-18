/** Named filtering setups. Appearance, credentials and public account data stay global. */
import { DEFAULT_SETTINGS, canonicalCountry, normalizeAccountId } from './constants.js';
import { FILTER_SOURCES } from './filter-registry.js';
import { ACCOUNT_COUNT_FILTERS, isAccountCountThreshold } from './account-counts.js';
import { normalizeLinkRule } from './domain-utils.js';
import { normalizeRegionCountrySelections } from './region-membership.js';

export const PROFILE_MESSAGES = Object.freeze({
    GET_PROFILE_CONTEXT: 'GET_PROFILE_CONTEXT',
    SELECT_PROFILE: 'SELECT_PROFILE',
    CREATE_PROFILE: 'CREATE_PROFILE',
    RENAME_PROFILE: 'RENAME_PROFILE',
    DELETE_PROFILE: 'DELETE_PROFILE',
    EXPORT_PROFILES: 'EXPORT_PROFILES',
    PROFILE_STATE_UPDATED: 'PROFILE_STATE_UPDATED',
    PROFILE_CATALOG_UPDATED: 'PROFILE_CATALOG_UPDATED'
});
export const DEFAULT_PROFILE_ID = 'default';
export const PROFILE_STORAGE_KEY = 'x_filter_profiles_v1';
export const PROFILE_LIMITS = Object.freeze({ MAX_PROFILES: 50, MAX_NAME_LENGTH: 40, MAX_RULES: 10000, MAX_BYTES: 4 * 1024 * 1024 });
export const PROFILE_SETTING_KEYS = Object.freeze([
    'showVpnUsers', 'alwaysShowFollowing', 'hideRelatedPosts', 'regionCountrySelections',
    'bioTagsMatchLocation', 'bioTagsExactMatch', 'linksMatchLocation', 'minFollowing', 'minPosts',
    'minHandleDigits', 'minDisplayNameDigits', 'highlightBlockedTweets', 'highlightInLists'
]);

export function isProfileId(value) {
    return typeof value === 'string' && value.length > 0 && value.length <= 64 && !/[^a-zA-Z0-9_-]/.test(value);
}

export function profileName(value) {
    if (typeof value !== 'string' || /\p{Cc}/u.test(value)) throw new TypeError('Enter a profile name.');
    const name = value.trim();
    if (!name || Array.from(name).length > PROFILE_LIMITS.MAX_NAME_LENGTH) throw new TypeError('Profile names must contain 1–40 characters.');
    return name;
}

export function profileSettings(value = {}, { partial = false, strict = true } = {}) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid profile settings.');
    const result = {};
    for (const key of PROFILE_SETTING_KEYS) {
        if (partial && !Object.hasOwn(value, key)) continue;
        let setting = Object.hasOwn(value, key) ? value[key] : DEFAULT_SETTINGS[key];
        try {
            if (key === 'regionCountrySelections') setting = normalizeRegionCountrySelections(setting, { strict: true });
            else {
                const count = ACCOUNT_COUNT_FILTERS.find(rule => rule.key === key);
                if (count ? !isAccountCountThreshold(setting, count.max) : typeof setting !== 'boolean') {
                    throw new TypeError(`Invalid profile setting: ${key}.`);
                }
            }
        } catch (error) {
            if (strict) throw error;
            setting = DEFAULT_SETTINGS[key];
        }
        result[key] = setting;
    }
    return result;
}

export function normalizeProfileRule(source, raw) {
    if (typeof raw !== 'string' || raw.length > 4096) return '';
    const value = raw.trim();
    if (source.kind === 'countries') return canonicalCountry(value);
    if (source.kind === 'tags') return value;
    if (source.kind === 'links') return normalizeLinkRule(value);
    if (source.kind === 'accounts') return normalizeAccountId(value);
    if (source.kind === 'allowedUsers') {
        const name = value.replace(/^@+/, '').toLowerCase();
        return name.length <= 15 && name.length > 0 && !/[^a-z0-9_]/.test(name) ? name : '';
    }
    if (source.kind === 'languages') return value.toLowerCase().split('-')[0];
    return value.toLowerCase();
}

export function profileFilters(value = {}, { strict = true } = {}) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid profile filters.');
    const result = {};
    for (const source of FILTER_SOURCES) {
        const values = Object.hasOwn(value, source.field) ? value[source.field] : [];
        if (!Array.isArray(values) || values.length > PROFILE_LIMITS.MAX_RULES) throw new TypeError(`Invalid profile ${source.field}.`);
        const normalized = values.map(raw => normalizeProfileRule(source, raw));
        if (strict && normalized.some(rule => !rule)) throw new TypeError(`Invalid profile ${source.field} filter.`);
        result[source.field] = [...new Set(normalized.filter(Boolean))];
    }
    return result;
}

/** Validate portable profile data before restoring anything, retaining no unknown fields. */
export function normalizeProfilesBackup(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== 1 ||
        !Array.isArray(value.profiles) || value.profiles.length < 1 || value.profiles.length > PROFILE_LIMITS.MAX_PROFILES) {
        throw new TypeError('Invalid profile backup.');
    }
    const ids = new Set(), names = new Set();
    const profiles = value.profiles.map(profile => {
        if (!profile || !isProfileId(profile.id) || ids.has(profile.id) || !profile.settings || !profile.filters) {
            throw new TypeError('Invalid or duplicate profile.');
        }
        const name = profileName(profile.name);
        const key = name.toLowerCase();
        if (names.has(key)) throw new TypeError('Profile names must be unique.');
        ids.add(profile.id); names.add(key);
        return { id: profile.id, name, settings: profileSettings(profile.settings), filters: profileFilters(profile.filters) };
    });
    if (!ids.has(DEFAULT_PROFILE_ID)) throw new TypeError('The Default profile is missing.');
    const accounts = {};
    if (value.accounts !== undefined && (!value.accounts || typeof value.accounts !== 'object' || Array.isArray(value.accounts))) {
        throw new TypeError('Invalid profile account assignments.');
    }
    for (const [accountId, id] of Object.entries(value.accounts || {})) {
        if (!normalizeAccountId(accountId) || !ids.has(id)) throw new TypeError('Invalid profile account assignment.');
        accounts[accountId] = id;
    }
    if (Object.keys(accounts).length > 1000) throw new TypeError('Too many profile account assignments.');
    const editorProfileId = value.editorProfileId ?? DEFAULT_PROFILE_ID;
    if (!ids.has(editorProfileId)) throw new TypeError('Invalid selected profile.');
    const result = { version: 1, profiles, accounts, editorProfileId };
    if (new TextEncoder().encode(JSON.stringify(result)).byteLength > PROFILE_LIMITS.MAX_BYTES) throw new TypeError('Profile data is too large.');
    return result;
}
