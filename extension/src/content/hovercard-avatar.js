/** Resolve an account's own avatar without fetching or retaining any page nodes. */
import { SELECTORS, normalizeAccountId } from '../shared/constants.js';
import { quoteCardOf } from './post-identity.js';

const AVATAR_PREFIX = 'UserAvatar-Container-';

/** Only raster profile artwork on X's image CDN; queries never become tracking requests. */
export function normalizeAvatarUrl(raw) {
    if (typeof raw !== 'string' || raw.length > 512 || /[\s\\]/.test(raw) ||
        !/^https:\/\/pbs\.twimg\.com\//i.test(raw)) return null;
    let url;
    try { url = new URL(raw); } catch { return null; }
    if (url.protocol !== 'https:' || url.hostname !== 'pbs.twimg.com' || url.username || url.password || url.port ||
        !/^\/profile_images\/[0-9]+\/[\w.-]{1,160}\.(?:jpe?g|png|webp|gif)$/i.test(url.pathname)) return null;
    url.search = '';
    url.hash = '';
    return url.href;
}

function visibleImage(image) {
    if (!image.isConnected || image.hidden || image.getClientRects?.().length === 0) return false;
    const style = typeof getComputedStyle === 'function' ? getComputedStyle(image) : null;
    return style?.visibility !== 'hidden' && style?.display !== 'none';
}

function squareAvatar(image, container) {
    for (let node = image; node && container.contains(node); node = node.parentElement) {
        if (/shape-square/i.test(node.style?.clipPath || '') ||
            node.getAttribute('aria-label') === 'Square profile picture' ||
            node.getAttribute('alt') === 'Square profile picture') return true;
    }
    return false;
}

/** Prefer the live author's visible image; unknown quote ownership never borrows an outer image. */
export function resolveCardAvatar({ anchor, screenName, info, profile } = {}) {
    if (typeof screenName !== 'string' || !/^[a-zA-Z0-9_]{1,15}(?![\s\S])/.test(screenName)) return null;
    const handle = screenName.toLowerCase();
    const owner = anchor?.closest?.('[data-x-screen-name]') || anchor?.closest?.(SELECTORS.USER_CELL);
    if (anchor && (!anchor.isConnected || (owner?.dataset.xScreenName &&
        owner.dataset.xScreenName.toLowerCase() !== handle))) return null;

    const profileId = normalizeAccountId(profile?.userId);
    const metaId = normalizeAccountId(info?.meta?.restId);
    const compatible = !profileId || (metaId !== '' && metaId === profileId);
    const rawShape = info?.meta?.profileImageShape;
    const metadataShape = compatible && typeof rawShape === 'string' && rawShape.toLowerCase() === 'square'
        ? 'square' : 'circle';
    const cell = anchor?.closest?.(SELECTORS.USER_CELL) || null;
    const article = anchor?.closest?.(SELECTORS.TWEET) || null;
    const quote = article ? quoteCardOf(owner || anchor, article) : null;
    // Native profile headers/hover previews have different boundaries. Use only
    // compatible API metadata there rather than searching the entire document.
    const scope = cell || quote || article;
    if (scope && owner) {
        for (const container of Array.from(scope.querySelectorAll('[data-testid^="UserAvatar-Container-"]')).slice(0, 32)) {
            const testId = container.getAttribute('data-testid') || '';
            if (testId.slice(AVATAR_PREFIX.length).toLowerCase() !== handle ||
                container.closest(SELECTORS.USER_CELL) !== cell ||
                container.closest(SELECTORS.TWEET) !== article ||
                (article && quoteCardOf(container, article) !== quote)) continue;
            for (const image of Array.from(container.querySelectorAll('img')).slice(0, 8)) {
                if (!visibleImage(image) || image.closest(SELECTORS.USER_CELL) !== cell ||
                    image.closest(SELECTORS.TWEET) !== article ||
                    (article && quoteCardOf(image, article) !== quote)) continue;
                const url = normalizeAvatarUrl(image.currentSrc || image.getAttribute('src'));
                if (url) return { url, shape: squareAvatar(image, container) ? 'square' : metadataShape };
            }
        }
    }
    if (!compatible) return null;
    const url = normalizeAvatarUrl(info?.meta?.avatarUrl);
    return url ? { url, shape: metadataShape } : null;
}
