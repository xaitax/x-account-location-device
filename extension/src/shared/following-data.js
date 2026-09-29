/** Viewer-specific follow observations. Never part of public profile/cache records. */
export const FOLLOWING_LIMITS = Object.freeze({
    MAX_ENTRIES: 5000,
    MAX_USERS_PER_RESPONSE: 500,
    MAX_BATCH_ENTRIES: 100,
    MAX_RELAY_LENGTH: 65536,
    MAX_WALK_NODES: 200000
});

export function isFollowingHandle(value) {
    return typeof value === 'string' && value.length > 0 && value.length <= 15 && !/[^a-zA-Z0-9_]/.test(value);
}

export function isFollowingViewer(value) {
    return typeof value === 'string' && /^(?:id:[0-9]{1,20}|handle:[a-z0-9_]{1,15})$/.exec(value)?.[0] === value;
}

/**
 * Read the viewer freshly at request/consumption time, never through the cached
 * display-name helper. twid contains the public account ID, not authentication.
 * Extract only that ID; never retain or relay cookies. The sidebar is a fallback
 * when the ID is unavailable. Unknown identity must not grant exemptions.
 */
export function readFollowingViewer() {
    try {
        const raw = document.cookie.match(/(?:^|;\s*)twid=([^;]*)/)?.[1];
        if (raw) {
            const decoded = decodeURIComponent(raw);
            const match = /^u=([0-9]{1,20})$/.exec(decoded);
            if (match?.[0] === decoded) return `id:${match[1]}`;
        }
    } catch { /* Cookie access can be restricted; use the visible account below. */ }
    try {
        const href = document.querySelector('[data-testid="AppTabBar_Profile_Link"]')?.getAttribute('href');
        const match = /^\/([a-zA-Z0-9_]{1,15})\/?$/.exec(href || '');
        return match && match[0] === href ? `handle:${match[1].toLowerCase()}` : null;
    } catch {
        return null;
    }
}

/** Numeric following counts and missing/null/string values are not relationships. */
export function projectFollowingUser(user) {
    if (!user || user.__typename !== 'User') return null;
    const name = user.core?.screen_name ?? user.legacy?.screen_name ?? user.screen_name;
    const following = user.relationship_perspectives?.following;
    return isFollowingHandle(name) && typeof following === 'boolean'
        ? { u: name.toLowerCase(), following } : null;
}
