/**
 * Identify the deliberately opened post from its own timestamp permalink. X's
 * article tabindex and links in post/quote text do not establish that identity.
 */

const X_HOSTS = new Set([
    'x.com', 'www.x.com', 'mobile.x.com',
    'twitter.com', 'www.twitter.com', 'mobile.twitter.com'
]);
const STATUS_PATH = /^\/(?:[a-zA-Z0-9_]{1,15}\/status|i\/web\/status)\/([1-9]\d*)(?:\/(?:photo|video)\/[1-9]\d*)?\/?$/;
export const QUOTE_CARD_SELECTOR = '[data-testid="quoteTweet"], [role="link"][tabindex="0"]';

/** The nearest quote owns its verdict; containing quotes must not inherit it. */
export function quoteCardOf(element, article = element?.closest('article[data-testid="tweet"]')) {
    if (!article) return null;
    for (let node = element?.parentElement; node && node !== article; node = node.parentElement) {
        if (node.matches(QUOTE_CARD_SELECTOR)) return node;
    }
    return null;
}

/**
 * Read an exact post ID without losing precision. Only post and media routes
 * count; analytics, quote listings, and other post subpages do not.
 * @param {string} pathOrUrl
 * @returns {string|null}
 */
export function statusIdOf(pathOrUrl) {
    if (typeof pathOrUrl !== 'string' || !pathOrUrl || pathOrUrl.includes('\\')) return null;
    if (!pathOrUrl.startsWith('/') && !/^https?:\/\//i.test(pathOrUrl)) return null;

    try {
        const url = new URL(pathOrUrl, 'https://x.com');
        if (!['http:', 'https:'].includes(url.protocol) || !X_HOSTS.has(url.hostname) ||
            url.username || url.password || url.port) return null;
        return STATUS_PATH.exec(url.pathname)?.[1] || null;
    } catch {
        return null;
    }
}

/**
 * @param {HTMLElement} time
 * @param {HTMLAnchorElement} link
 * @param {HTMLElement} article
 * @returns {boolean}
 */
function isOwnTimestamp(time, link, article) {
    if (link.closest('article') !== article) return false;
    // An anchor wrapping an entire quote card is not its timestamp permalink.
    if (link.querySelector('[data-testid="User-Name"], [data-testid="tweetText"]')) return false;

    let node = time.parentElement;
    while (node && node !== article) {
        if (node.matches('article, [data-testid="tweetText"], [data-testid="quoteTweet"]')) return false;
        // The timestamp itself may be focusable; its containing quote card is
        // the boundary. This matches the card structure supplied from X.
        if (node !== link && node.matches('[role="link"][tabindex="0"]')) return false;
        node = node.parentElement;
    }
    return node === article;
}

/**
 * Resolve only unambiguous timestamps belonging to this article. In particular,
 * a quote's time can precede the main post's footer timestamp in document order.
 * @param {HTMLElement|null} article
 * @returns {string|null}
 */
export function ownPostId(article) {
    if (!article?.matches('article[data-testid="tweet"]')) return null;
    let ownId = null;
    for (const time of article.querySelectorAll('time')) {
        const link = time.closest('a[href]');
        if (!link || !isOwnTimestamp(time, link, article)) continue;
        const id = statusIdOf(link.getAttribute('href'));
        if (!id) continue;
        if (ownId && ownId !== id) return null;
        ownId = id;
    }
    return ownId;
}

/**
 * Read a quote's own timestamp link. Never borrow the surrounding post's ID or
 * an arbitrary link from its text. Linkless quotes have no reliable identity.
 */
export function quotedPostId(card) {
    const article = card?.closest('article[data-testid="tweet"]');
    if (!article || card === article || !card.matches('[data-testid="quoteTweet"], [role="link"][tabindex="0"]')) return null;
    let quoteId = null;
    for (const time of card.querySelectorAll('time')) {
        if (time.closest('article') !== article || time.closest('[data-testid="tweetText"]')) continue;
        const link = time.closest('a[href]');
        if (!link || (link !== card && !card.contains(link))) continue;
        if (link !== card && link.querySelector('[data-testid="User-Name"], [data-testid="tweetText"]')) continue;
        let parent = time.parentElement;
        while (parent && parent !== card) {
            if (parent !== link && parent.matches('[data-testid="quoteTweet"], [role="link"][tabindex="0"]')) break;
            parent = parent.parentElement;
        }
        if (parent !== card) continue;
        const id = statusIdOf(link.getAttribute('href'));
        if (!id) continue;
        if (quoteId && quoteId !== id) return null;
        quoteId = id;
    }
    return quoteId;
}

/**
 * Unknown identity cannot exempt a post from filtering.
 * @param {HTMLElement|null} article
 * @param {string} [pathname]
 * @returns {boolean}
 */
export function isFocalTweet(article, pathname = globalThis.location?.pathname) {
    const focalId = statusIdOf(pathname);
    return focalId !== null && ownPostId(article) === focalId;
}
