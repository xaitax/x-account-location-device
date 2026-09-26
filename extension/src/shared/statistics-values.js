/** Bounded, identical bucket names for local filter-statistics producers and storage. */
import { COUNTRY_FLAGS, REGION_FLAGS, canonicalCountry } from './constants.js';
import { classifyDevice } from './utils.js';

export const STATISTICS_UNKNOWN = 'Unknown';
const DEVICE_LABELS = { ios: 'iOS', android: 'Android', web: 'Web', unknown: STATISTICS_UNKNOWN };

export function normalizeStatisticsLocation(value) {
    if (typeof value !== 'string' || value.length > 128) return STATISTICS_UNKNOWN;
    const location = canonicalCountry(value);
    return Object.hasOwn(COUNTRY_FLAGS, location) || Object.hasOwn(REGION_FLAGS, location)
        ? location : STATISTICS_UNKNOWN;
}

export function normalizeStatisticsDevice(value) {
    if (typeof value !== 'string' || value.length > 128) return STATISTICS_UNKNOWN;
    return DEVICE_LABELS[classifyDevice(value)];
}
