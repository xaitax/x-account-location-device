/**
 * Pure hostname helpers shared by settings, storage and passive profile harvesting.
 * No network access, public-suffix database, or country tables belong in this module.
 */
export const DOMAIN_LIMITS = Object.freeze({ MAX_INPUT_LENGTH: 4096, MAX_HOST_LENGTH: 253 });

/** Parse a complete HTTP(S) authority; never search for a domain inside other text. */
function parseHttpInput(input) {
    if (typeof input !== 'string' || input.length > DOMAIN_LIMITS.MAX_INPUT_LENGTH) return null;
    const value = input.trim();
    if (!value || /[\s\p{Cc}\\]/u.test(value)) return null;
    const isUrl = /^https?:\/\//i.test(value);
    if (isUrl && !/^https?:\/\/[^/]/i.test(value)) return null;
    if (!isUrl) {
        // Validate the complete authority before accepting a scheme-less link.
        // Paths, queries and fragments may contain @ or other URLs, but they
        // never decide which domain is saved. Credentials and other schemes fail.
        const authority = value.split(/[/?#]/, 1)[0];
        if (!authority || /[:@%]/.test(authority)) return null;
    }

    try {
        const url = new URL(isUrl ? value : `https://${value}`);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
        let host = url.hostname.toLowerCase();
        if (host.endsWith('.')) host = host.slice(0, -1);
        if (!host || host.length > DOMAIN_LIMITS.MAX_HOST_LENGTH) return null;
        const labels = host.split('.');
        if (labels.length < 2 || labels.every(label => /^\d+$/.test(label))) return null;
        if (!labels.every(label => label.length <= 63 &&
            /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))) return null;
        return url;
    } catch {
        return null;
    }
}

/** Host-only evidence for site-wide rules; never use this to normalize stored URL rules. */
export function normalizeDomain(input) {
    const url = parseHttpInput(input);
    if (!url) return '';
    let host = url.hostname;
    if (host.endsWith('.')) host = host.slice(0, -1);
    // Preserve unusual repeated prefixes so repeated normalization never broadens a rule.
    if (host.startsWith('www.') && !host.startsWith('www.www.') && host.slice(4).includes('.')) host = host.slice(4);
    return host.includes('.') ? host : '';
}

/** Exact destination: retain scheme, www, path case, query order and fragment. */
export function normalizeExactUrl(input) {
    const url = parseHttpInput(input);
    if (!url || url.href.length > DOMAIN_LIMITS.MAX_INPUT_LENGTH) return '';
    return url.href;
}

/** Bare hosts block a site; explicit URLs or path/query/fragment inputs stay exact. */
export function normalizeLinkRule(input) {
    if (typeof input !== 'string') return '';
    const value = input.trim();
    return /^https?:\/\//i.test(value) || /[/?#]/.test(value)
        ? normalizeExactUrl(input)
        : normalizeDomain(input);
}

/** Both arguments are canonical hosts from normalizeDomain(). */
export function hostMatchesDomain(host, domain) {
    return typeof host === 'string' && typeof domain === 'string' && domain !== '' &&
        (host === domain || host.endsWith(`.${domain}`));
}

/** Match parent domains through Set lookups rather than comparing every rule to every host. */
export function findBlockedDomain(hosts, blocked) {
    if (!Array.isArray(hosts) || !blocked) return null;
    const rules = blocked instanceof Set ? blocked : new Set(blocked);
    if (rules.size === 0) return null;
    for (const host of hosts) {
        if (typeof host !== 'string') continue;
        let candidate = host;
        while (candidate.includes('.')) {
            if (rules.has(candidate)) return candidate;
            candidate = candidate.slice(candidate.indexOf('.') + 1);
        }
    }
    return null;
}

/** Exact rules use only observed complete destinations, never host-only evidence. */
export function findBlockedExactUrl(urls, blocked) {
    if (!Array.isArray(urls) || !blocked?.size) return null;
    for (const url of urls) {
        if (blocked.has(url)) return url;
    }
    return null;
}

/**
 * Conservative free-text support: each whitespace-delimited token must itself be a
 * complete URL/hostname. Never inspect domains embedded in paths, queries or emails.
 * This is used only for the separately opt-in profile-location filter.
 */
export function extractDomainHosts(text, maxHosts = 12) {
    if (typeof text !== 'string' || !text || text.length > DOMAIN_LIMITS.MAX_INPUT_LENGTH ||
        !Number.isInteger(maxHosts) || maxHosts < 1) return [];
    const hosts = new Set();
    for (const raw of text.split(/\s+/u).slice(0, 64)) {
        const token = raw.replace(/^[([<"']+/, '').replace(/[)\]>"',;!]+$/, '');
        const host = normalizeDomain(token);
        if (host && host !== 't.co') hosts.add(host);
        if (hosts.size >= Math.min(maxHosts, 12)) break;
    }
    return [...hosts].sort();
}

/** Opt-in location evidence. Do not strip URL punctuation or infer a path from a host. */
export function extractExactUrls(text, maxUrls = 12) {
    if (typeof text !== 'string' || !text || text.length > DOMAIN_LIMITS.MAX_INPUT_LENGTH ||
        !Number.isInteger(maxUrls) || maxUrls < 1) return [];
    const urls = new Set();
    for (const token of text.split(/\s+/u).slice(0, 64)) {
        const rule = normalizeLinkRule(token);
        if (/^https?:\/\//.test(rule) && normalizeDomain(rule) !== 't.co') urls.add(rule);
        if (urls.size >= Math.min(maxUrls, 12)) break;
    }
    return [...urls].sort();
}
