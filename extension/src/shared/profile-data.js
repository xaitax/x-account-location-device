/**
 * Lightweight passive-profile projection. Omitted fields are unobserved; empty
 * strings/arrays are known empty. Null link evidence invalidates a source that was
 * observed but is now unknown. Nothing here reads storage or makes requests.
 */
import { DOMAIN_LIMITS, normalizeDomain, normalizeExactUrl, extractDomainHosts, extractExactUrls } from './domain-utils.js';

export const PROFILE_LIMITS = Object.freeze({
    MAX_ENTRIES: 500,
    MAX_USERS_PER_RESPONSE: 500,
    MAX_BATCH_ENTRIES: 32,
    MAX_RELAY_LENGTH: 512 * 1024,
    MAX_BIO_LENGTH: 200,
    MAX_LOCATION_LENGTH: 64,
    MAX_HOSTS_PER_SOURCE: 12,
    MAX_URLS_PER_SOURCE: 12,
    MAX_URL_CHARS_PER_SOURCE: 4096,
    MAX_ENTITY_URLS: 24,
    MAX_WALK_NODES: 200000,
    EMIT_TTL_MS: 15000
});

const WIRE_FIELDS = Object.freeze({
    b: 'bio', o: 'location', w: 'websiteHosts', l: 'bioHosts', h: 'locationHosts',
    W: 'websiteUrls', L: 'bioUrls', H: 'locationUrls',
    p: 'pcf', f: 'followers', g: 'following', t: 'tweets', m: 'media'
});

export function isProfileUsername(value) {
    return typeof value === 'string' && value.length <= 15 && /^[a-zA-Z0-9_]{1,15}$/.test(value);
}

/** Preserve field presence when translating the compact page-to-content relay. */
export function profilePatchFromWire(entry) {
    if (!entry || typeof entry !== 'object' || !isProfileUsername(entry.u)) return null;
    const patch = {};
    for (const [wire, field] of Object.entries(WIRE_FIELDS)) {
        if (Object.hasOwn(entry, wire)) patch[field] = entry[wire];
    }
    return patch;
}

/** Validated copy; malformed or oversized arrays remain unknown, not known empty. */
export function normalizeProfileHosts(values) {
    if (!Array.isArray(values) || values.length > PROFILE_LIMITS.MAX_ENTITY_URLS) return undefined;
    const hosts = new Set();
    for (const value of values) {
        const host = normalizeDomain(value);
        if (!host) return undefined;
        // A known destination remains useful beside an unresolved shortlink.
        // An all-shortlink list is unknown, never proof that the source is empty.
        if (host === 't.co') continue;
        hosts.add(host);
        if (hosts.size > PROFILE_LIMITS.MAX_HOSTS_PER_SOURCE) return undefined;
    }
    if (values.length > 0 && hosts.size === 0) return undefined;
    return [...hosts].sort();
}

/** Bounded exact evidence; an incomplete or oversized source remains unknown. */
export function normalizeProfileUrls(values) {
    if (!Array.isArray(values) || values.length > PROFILE_LIMITS.MAX_ENTITY_URLS) return undefined;
    const urls = new Set();
    let chars = 0;
    for (const value of values) {
        if (typeof value !== 'string' || !/^https?:\/\//i.test(value)) return undefined;
        const url = normalizeExactUrl(value);
        if (!url) return undefined;
        if (normalizeDomain(url) === 't.co') continue;
        if (urls.has(url)) continue;
        chars += url.length;
        urls.add(url);
        if (urls.size > PROFILE_LIMITS.MAX_URLS_PER_SOURCE || chars > PROFILE_LIMITS.MAX_URL_CHARS_PER_SOURCE) return undefined;
    }
    if (values.length > 0 && urls.size === 0) return undefined;
    return [...urls].sort();
}

/**
 * Read only structured expanded destinations. display_url is presentation text and
 * may be truncated; unresolved t.co wrappers must not become blocking evidence.
 * Prefer the modern source when present, including an explicitly empty list.
 */
function entityLinks(user, group) {
    for (const entities of [user.profile_bio?.entities, user.legacy?.entities]) {
        if (!entities || typeof entities !== 'object' || !Object.hasOwn(entities, group)) continue;
        const section = entities[group];
        const unknown = { hosts: null, urls: null };
        if (!section || typeof section !== 'object' || !Object.hasOwn(section, 'urls')) return unknown;
        const urls = section.urls;
        if (!Array.isArray(urls) || urls.length > PROFILE_LIMITS.MAX_ENTITY_URLS) return unknown;
        const expanded = [];
        for (const item of urls) {
            const url = item?.expanded_url;
            if (typeof url !== 'string' || url.length > DOMAIN_LIMITS.MAX_INPUT_LENGTH ||
                !/^https?:\/\//i.test(url)) return unknown;
            expanded.push(url);
        }
        const hosts = normalizeProfileHosts(expanded);
        // Longer destinations can still provide bounded host-only evidence.
        // Missing exact evidence clears previously observed paths during merging.
        return hosts === undefined ? unknown : { hosts, urls: normalizeProfileUrls(expanded) };
    }
    return undefined;
}

/**
 * Project only the supported timeline User shapes. In particular, do not guess at
 * location.name/text/value aliases or fetch a profile to fill missing fields.
 */
export function projectProfileUser(user) {
    if (!user || typeof user !== 'object' || !isProfileUsername(user.core?.screen_name)) return null;
    const result = { u: user.core.screen_name.toLowerCase() };
    const bio = user.profile_bio?.description;
    if (typeof bio === 'string') result.b = bio.slice(0, PROFILE_LIMITS.MAX_BIO_LENGTH);

    // The modern location object uses `location`; retain the plain-string shape too.
    const location = typeof user.location === 'string' ? user.location : user.location?.location;
    if (typeof location === 'string') {
        result.o = location.slice(0, PROFILE_LIMITS.MAX_LOCATION_LENGTH).trim();
        // Never manufacture a host by cutting a longer token in half at the limit.
        if (location.length <= PROFILE_LIMITS.MAX_LOCATION_LENGTH) {
            result.h = extractDomainHosts(result.o, PROFILE_LIMITS.MAX_HOSTS_PER_SOURCE);
            result.H = normalizeProfileUrls(extractExactUrls(result.o, PROFILE_LIMITS.MAX_URLS_PER_SOURCE));
        } else {
            result.h = null;
            result.H = null;
        }
    }

    const websiteLinks = entityLinks(user, 'url');
    const bioLinks = bio === '' ? { hosts: [], urls: [] } : entityLinks(user, 'description');
    if (websiteLinks !== undefined) {
        result.w = websiteLinks.hosts;
        if (websiteLinks.urls !== undefined) result.W = websiteLinks.urls;
    }
    if (bioLinks !== undefined) {
        result.l = bioLinks.hosts;
        if (bioLinks.urls !== undefined) result.L = bioLinks.urls;
    }
    if (typeof user.parody_commentary_fan_label === 'string') {
        result.p = user.parody_commentary_fan_label.slice(0, 32);
    }
    for (const [key, value] of [
        ['f', user.relationship_counts?.followers], ['g', user.relationship_counts?.following],
        ['t', user.tweet_counts?.tweets], ['m', user.tweet_counts?.media_tweets]
    ]) {
        if (Number.isSafeInteger(value) && value >= 0) result[key] = value;
    }
    return Object.keys(result).length > 1 ? result : null;
}

/**
 * Sparse records preserve independent sources, but a changed source text makes
 * its previously observed hosts stale until replacement entities arrive.
 */
export function mergeProjectedProfile(previous, patch) {
    const next = { ...previous, ...patch };
    for (const [text, fields] of [['b', ['l', 'L']], ['o', ['h', 'H']]]) {
        if (Object.hasOwn(patch, text) && patch[text] !== previous?.[text]) {
            for (const field of fields) {
                if (!Object.hasOwn(patch, field)) delete next[field];
            }
        }
    }
    // Host-only observations cannot keep an older path-specific destination alive.
    for (const [hosts, urls] of [['w', 'W'], ['l', 'L'], ['h', 'H']]) {
        if (Object.hasOwn(patch, hosts) && !Object.hasOwn(patch, urls)) delete next[urls];
        if (Object.hasOwn(patch, urls) && !Object.hasOwn(patch, hosts)) {
            delete next[hosts];
        }
    }
    return next;
}

/** Stable signature for a bounded, primitive-only projected record. */
export function profileSignature(record) {
    return JSON.stringify(Object.keys(WIRE_FIELDS).map(key =>
        Object.hasOwn(record, key) ? [key, record[key]] : null));
}
