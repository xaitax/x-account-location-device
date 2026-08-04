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
 * At the configured limits the worst case is roughly 500 × ~550 B ≈ 270 KB.
 */

import { LRUCache } from '../shared/lru-cache.js';
import { PROFILE_CACHE_CONFIG, normalizePcfLabel } from '../shared/constants.js';

/** screenName (lowercase) -> { bio, pcf, followers, following, tweets, media } */
const profiles = new LRUCache(PROFILE_CACHE_CONFIG.MAX_ENTRIES);

/**
 * Coerce to a non-negative integer, or null. Counts arrive as numbers already, but a
 * shape change upstream shouldn't put a string or an object into the cache.
 * @param {any} value
 * @returns {number|null}
 */
function toCount(value) {
    return Number.isInteger(value) && value >= 0 ? value : null;
}

/**
 * Store one harvested profile. Values are copied into a fresh object of primitives —
 * see the memory contract above.
 * @param {string} screenName
 * @param {{bio?: string, pcf?: string, followers?: number, following?: number, tweets?: number, media?: number}} data
 */
export function setProfile(screenName, data) {
    if (!screenName || typeof screenName !== 'string' || !data) return;

    const bio = typeof data.bio === 'string'
        ? data.bio.slice(0, PROFILE_CACHE_CONFIG.MAX_BIO_LENGTH)
        : null;

    profiles.set(screenName.toLowerCase(), {
        bio: bio || null,
        pcf: normalizePcfLabel(data.pcf) || null,
        followers: toCount(data.followers),
        following: toCount(data.following),
        tweets: toCount(data.tweets),
        media: toCount(data.media)
    });
}

/**
 * @param {string|null|undefined} screenName
 * @returns {{bio: string|null, pcf: string|null, followers: number|null, following: number|null, tweets: number|null, media: number|null}|null}
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
