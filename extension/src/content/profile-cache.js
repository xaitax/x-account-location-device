/**
 * Profile Cache (Content Script)
 *
 * Holds the profile data X already sends with its own timeline responses — bio, account
 * label, follower/following/post counts — harvested by page-script.js and relayed here.
 * Nothing in this module ever costs an API call.
 *
 * MEMORY CONTRACT (this is the whole point of the module):
 *  - Bounded LRU. A long scroll session evicts the coldest entries rather than growing.
 *  - Only PRIMITIVES are stored. We never retain a reference into X's parsed response, so
 *    the multi-megabyte payload is collectable the moment X drops it.
 *  - Bios are truncated on the way in, so one pathological profile can't dominate the budget.
 *  - SESSION-ONLY. Never written to chrome.storage: bios are personal free text and counts
 *    go stale within minutes, so persisting either would be both wrong and a privacy problem.
 *  - Cleared on teardown along with every other content-script cache.
 *
 * Each source's host list and text length is capped before processing. Storage stays
 * bounded even when a relayed record is malformed, and no X response objects are kept.
 */

import { LRUCache } from '../shared/lru-cache.js';
import { normalizePcfLabel } from '../shared/constants.js';
import { PROFILE_LIMITS, isProfileUsername, normalizeProfileHosts, normalizeProfileUrls } from '../shared/profile-data.js';

/** Lowercase username -> bounded primitive profile fields; missing means unknown. */
const profiles = new LRUCache(PROFILE_LIMITS.MAX_ENTRIES);

/**
 * Coerce to a non-negative integer, or undefined. Counts arrive as numbers already, but a
 * shape change upstream shouldn't put a string or an object into the cache.
 * @param {any} value
 * @returns {number|undefined}
 */
function toCount(value) {
    return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

/**
 * Merge known fields from a harvested profile. Omitted/invalid fields preserve the
 * previous value; explicit empty strings/arrays remove old matching evidence.
 * Null link fields invalidate an observed source whose destinations are now unknown.
 * Changed source text invalidates its old hosts when replacement hosts are unknown.
 * Returns whether text, label or link evidence changed. Callers separately compare
 * active account-count rules before and after merging the profile.
 * @param {string} screenName
 * @param {Object} data - optional bio/location/host and exact URL lists/label/counts
 * @returns {boolean}
 */
export function setProfile(screenName, data) {
    if (!isProfileUsername(screenName) || !data || typeof data !== 'object' || Array.isArray(data)) return false;
    const key = screenName.toLowerCase();
    const previous = profiles.get(key) || {};
    const next = { ...previous };
    let changed = false;
    let filtersChanged = false;
    const assign = (field, value, affectsFilters = true) => {
        if (value === undefined) return;
        const old = previous[field];
        const equal = Array.isArray(value)
            ? Array.isArray(old) && old.length === value.length && value.every((host, i) => host === old[i])
            : old === value;
        if (equal) return;
        next[field] = value;
        changed = true;
        if (affectsFilters) filtersChanged = true;
    };

    const forget = field => {
        if (!Object.hasOwn(next, field)) return;
        delete next[field];
        changed = filtersChanged = true;
    };
    const linkPatch = {};
    const sources = [
        ['websiteHosts', 'websiteUrls'], ['bioHosts', 'bioUrls'], ['locationHosts', 'locationUrls']
    ];
    for (const [hosts, urls] of sources) {
        if (Object.hasOwn(data, hosts)) linkPatch[hosts] = normalizeProfileHosts(data[hosts]);
        if (Object.hasOwn(data, urls)) linkPatch[urls] = normalizeProfileUrls(data[urls]);
        if (Object.hasOwn(data, hosts) && data[hosts] === null) {
            forget(hosts);
            if (linkPatch[urls] === undefined) forget(urls);
        }
        if (Object.hasOwn(data, urls) && data[urls] === null) {
            forget(urls);
            if (linkPatch[hosts] === undefined) forget(hosts);
        }
        // A host-only update cannot keep an old channel/page URL alive, or vice versa.
        if (linkPatch[hosts] !== undefined && linkPatch[urls] === undefined) forget(urls);
        if (linkPatch[urls] !== undefined && linkPatch[hosts] === undefined) forget(hosts);
    }
    for (const [field, limit, evidence] of [
        ['bio', PROFILE_LIMITS.MAX_BIO_LENGTH, ['bioHosts', 'bioUrls']],
        ['location', PROFILE_LIMITS.MAX_LOCATION_LENGTH, ['locationHosts', 'locationUrls']]
    ]) {
        if (Object.hasOwn(data, field) && typeof data[field] === 'string') {
            const text = data[field].slice(0, limit);
            if (text !== previous[field]) {
                for (const source of evidence) {
                    if (linkPatch[source] === undefined) forget(source);
                }
            }
            assign(field, text);
        }
    }
    for (const [field, value] of Object.entries(linkPatch)) {
        assign(field, value);
    }
    if (Object.hasOwn(data, 'pcf') && typeof data.pcf === 'string' && data.pcf.length <= 32) {
        const label = normalizePcfLabel(data.pcf);
        if (['', 'parody', 'commentary', 'fan'].includes(label)) assign('pcf', label);
    }
    for (const field of ['followers', 'following', 'tweets', 'media']) {
        if (Object.hasOwn(data, field)) assign(field, toCount(data[field]), false);
    }
    if (changed) profiles.set(key, next);
    return filtersChanged;
}

/**
 * @param {string|null|undefined} screenName
 * @returns {Object|null} Known profile fields, or null if not observed this session.
 */
export function getProfile(screenName) {
    if (!screenName || typeof screenName !== 'string') return null;
    return profiles.get(screenName.toLowerCase()) || null;
}

/** Drop everything. Called from the content-script teardown. */
export function clearProfiles() {
    profiles.clear();
}

/** Current entry count — used by the debug surface, not by any filter. */
export function profileCount() {
    return profiles.size;
}
