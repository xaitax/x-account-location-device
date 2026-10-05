/** Portable configuration only. Session credentials and runtime counters stay local. */
import { DEFAULT_SETTINGS } from './constants.js';
import { FILTER_SOURCES } from './filter-registry.js';
import { ACCOUNT_COUNT_FILTERS, isAccountCountThreshold } from './account-counts.js';
import { BADGE_SIZES } from './badge-appearance.js';
import { normalizeRegionCountrySelections } from './region-membership.js';

export const BACKUP_FORMAT = '2.4';

/** Validate the complete supplied configuration before any import writes begin. */
export function prepareBackupImport(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new TypeError('Backup data must be an object.');
    }
    const result = {};
    if (Object.hasOwn(data, 'settings')) {
        if (!data.settings || typeof data.settings !== 'object' || Array.isArray(data.settings)) {
            throw new TypeError('Backup settings must be an object.');
        }
        result.settings = {};
        for (const [key, fallback] of Object.entries(DEFAULT_SETTINGS)) {
            if (!Object.hasOwn(data.settings, key)) continue;
            const value = data.settings[key];
            if (key === 'regionCountrySelections') {
                result.settings[key] = normalizeRegionCountrySelections(value, { strict: true });
                continue;
            }
            const countRule = ACCOUNT_COUNT_FILTERS.find(rule => rule.key === key);
            if (typeof value !== typeof fallback ||
                (key === 'hovercardTrigger' && !['hover', 'click'].includes(value)) ||
                (key === 'badgeSize' && !BADGE_SIZES.includes(value)) ||
                (countRule && !isAccountCountThreshold(value, countRule.max))) {
                throw new TypeError(`Invalid backup setting: ${key}.`);
            }
            result.settings[key] = value;
        }
        // Old settings.cloudCacheEnabled was unused and often incorrectly false.
        // Only the explicit top-level field below restores this preference.
    }
    for (const { field } of FILTER_SOURCES) {
        if (!Object.hasOwn(data, field)) continue;
        if (!Array.isArray(data[field]) || data[field].some(value => typeof value !== 'string')) {
            throw new TypeError(`Backup ${field} must be a list of text values.`);
        }
        result[field] = [...data[field]];
    }
    if (Object.hasOwn(data, 'theme')) {
        if (!['dark', 'light', 'dim'].includes(data.theme)) throw new TypeError('Invalid backup theme.');
        result.theme = data.theme === 'dim' ? 'dark' : data.theme;
    }
    if (Object.hasOwn(data, 'cloudCacheEnabled')) {
        if (typeof data.cloudCacheEnabled !== 'boolean') throw new TypeError('Invalid community cache preference.');
        result.cloudCacheEnabled = data.cloudCacheEnabled;
    }
    if (Object.hasOwn(data, 'cache')) {
        if (!Array.isArray(data.cache)) throw new TypeError('Backup cache must be a list of accounts.');
        result.cache = data.cache;
    }
    if (!Object.keys(result).length) throw new TypeError('This backup contains no supported settings, filters or cached accounts.');
    return result;
}
