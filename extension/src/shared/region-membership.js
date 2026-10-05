/** Explicit country coverage for region filters; X's literal region labels always remain valid. */
import { COUNTRY_FLAGS, REGION_LIST, canonicalCountry } from './constants.js';
import { REGION_GEOGRAPHY_GROUPS, REGION_GEOGRAPHY_NOTES } from './region-geography.js';

const EMPTY = Object.freeze([]);
const EMPTY_SELECTIONS = Object.freeze({});
const regionKeys = new Set(REGION_LIST.map(region => region.key));
const memberSets = new Map();
const countryRegions = new Map();
for (const region of REGION_LIST) {
    const members = REGION_GEOGRAPHY_GROUPS[region.key] || EMPTY;
    memberSets.set(region.key, new Set(members));
    for (const country of members) {
        // A region must never introduce a location that cannot use our flag set.
        if (!Object.hasOwn(COUNTRY_FLAGS, country)) throw new Error(`Missing region-country flag: ${country}`);
        if (!countryRegions.has(country)) countryRegions.set(country, []);
        countryRegions.get(country).push(region.key);
    }
}
for (const [country, regions] of countryRegions) countryRegions.set(country, Object.freeze(regions));

export function getRegionCountries(regionKey) {
    const region = canonicalCountry(regionKey);
    return regionKeys.has(region) ? REGION_GEOGRAPHY_GROUPS[region] : EMPTY;
}

export function getRegionDescription(regionKey) {
    const region = canonicalCountry(regionKey);
    return regionKeys.has(region) ? REGION_GEOGRAPHY_NOTES[region] : '';
}

export function getCountryRegions(country) {
    return countryRegions.get(canonicalCountry(country)) || EMPTY;
}

/**
 * An absent key means literal labels only; a present [] means enabled with no countries.
 * Explicit lists are snapshots: new future members never silently widen a saved filter.
 * Strict writes/imports reject mistakes; old/corrupt local data is conservatively sanitized.
 */
export function normalizeRegionCountrySelections(value, { strict = false } = {}) {
    const invalid = message => {
        if (strict) throw new TypeError(`Invalid region country selections: ${message}`);
    };
    if (!value || typeof value !== 'object' ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
        invalid('expected a plain object.');
        return EMPTY_SELECTIONS;
    }
    const result = {};
    for (const [rawRegion, values] of Object.entries(value)) {
        const region = canonicalCountry(rawRegion);
        if (!regionKeys.has(region)) {
            invalid(`unknown region ${rawRegion}.`);
            continue;
        }
        if (!Array.isArray(values)) {
            invalid(`${rawRegion} must contain a list of countries.`);
            continue;
        }
        const selected = new Set();
        for (const rawCountry of values) {
            const country = typeof rawCountry === 'string' ? canonicalCountry(rawCountry) : '';
            if (!memberSets.get(region).has(country)) {
                invalid(`${String(rawCountry)} is not a member of ${rawRegion}.`);
                continue;
            }
            selected.add(country);
        }
        // Duplicate differently-cased region keys must not re-enable excluded countries.
        if (Object.hasOwn(result, region)) {
            invalid(`duplicate region ${rawRegion}.`);
            result[region] = Object.freeze(result[region].filter(country => selected.has(country)));
        } else {
            result[region] = Object.freeze([...selected].sort());
        }
    }
    return Object.freeze(result);
}

/** Browser messages clone objects: compare meaning, not object identity, for live rechecks. */
export function areRegionCountrySelectionsEqual(left, right) {
    if (left === right) return true;
    const a = normalizeRegionCountrySelections(left);
    const b = normalizeRegionCountrySelections(right);
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every(region =>
        Object.hasOwn(b, region) && a[region].length === b[region].length &&
        a[region].every((country, index) => country === b[region][index]));
}

export function hasRegionCountrySelection(regionKey, record = EMPTY_SELECTIONS) {
    const region = canonicalCountry(regionKey);
    return regionKeys.has(region) && !!record && Object.hasOwn(record, region) && Array.isArray(record[region]);
}

export function getIncludedRegionCountries(regionKey, record = EMPTY_SELECTIONS) {
    const region = canonicalCountry(regionKey);
    if (!hasRegionCountrySelection(region, record)) return EMPTY;
    return Object.freeze([...new Set(record[region]
        .filter(country => typeof country === 'string')
        .map(canonicalCountry)
        .filter(country => memberSets.get(region).has(country)))].sort());
}

// Settings are replaced as immutable snapshots, not edited in place. Reuse one reverse
// index per snapshot so scrolling never rebuilds hundreds of memberships per post.
const coverageIndexes = new WeakMap();
function coverageIndex(record) {
    if (!record || typeof record !== 'object') return new Map();
    if (coverageIndexes.has(record)) return coverageIndexes.get(record);
    const index = new Map();
    const normalized = normalizeRegionCountrySelections(record);
    for (const [region, countries] of Object.entries(normalized)) {
        for (const country of countries) {
            if (!index.has(country)) index.set(country, []);
            index.get(country).push(region);
        }
    }
    coverageIndexes.set(record, index);
    return index;
}

/** Active regions matching the observed location; unknown/city/free text is never inferred. */
export function matchingBlockedRegions(location, blockedRegions, record = EMPTY_SELECTIONS) {
    const country = canonicalCountry(location);
    if (!country || !blockedRegions?.size) return [];
    // Preserve exact matching for legacy saved labels even if X adds a new region.
    const matches = blockedRegions.has(country) ? [country] : [];
    for (const region of coverageIndex(record).get(country) || EMPTY) {
        if (blockedRegions.has(region) && !matches.includes(region)) matches.push(region);
    }
    return matches;
}
