/**
 * Read a single post into immutable capture data before any asynchronous work.
 * Quoted posts own their author, content and permalink; none falls back to the
 * enclosing post or the current page URL.
 */
import { extractUsername } from '../shared/utils.js';
import { ownPostId, statusIdOf } from './post-identity.js';

const ARTICLE = 'article[data-testid="tweet"]';
const AUTHOR = '[data-testid="User-Name"]';
const QUOTE = '[data-testid="quoteTweet"], [role="link"][tabindex="0"]';

function scopeOf(node, article) {
    for (let current = node; current && current !== article; current = current.parentElement) {
        if (current.matches(QUOTE) && current.querySelector(AUTHOR)) return current;
    }
    return article;
}

function scopedNodes(scope, selector, article) {
    return Array.from(scope.querySelectorAll(selector)).filter(node =>
        node.closest(ARTICLE) === article && scopeOf(node, article) === scope);
}

function unavailable(isQuote) {
    return new Error(isQuote
        ? 'X has not exposed an unambiguous link for this quoted post. Open the quoted post and try again.'
        : 'This post could not be identified reliably. Open the post and try again.');
}

function readIdentity(scope, article, screenName) {
    const isQuote = scope !== article;
    const ownId = isQuote ? null : ownPostId(article);
    if (!isQuote && !ownId) throw unavailable(false);

    const candidates = [];
    for (const time of scopedNodes(scope, 'time', article)) {
        if (time.closest('[data-testid="tweetText"]')) continue;
        const link = time.closest('a[href]');
        if (!link || (!scope.contains(link) && link !== scope)) continue;
        if (link !== scope && link.querySelector(`${AUTHOR}, [data-testid="tweetText"]`)) continue;
        const href = link.getAttribute('href');
        const id = statusIdOf(href);
        if (!id || (!isQuote && id !== ownId)) continue;
        const path = new URL(href, 'https://x.com').pathname;
        const author = /^\/([a-zA-Z0-9_]{1,15})\/status\//.exec(path)?.[1];
        if (author && author.toLowerCase() !== screenName.toLowerCase()) throw unavailable(isQuote);
        candidates.push({ id, timestamp: time.getAttribute('datetime') || time.textContent.trim() });
    }
    if (!candidates.length || new Set(candidates.map(item => item.id)).size !== 1 ||
        new Set(candidates.map(item => item.timestamp)).size !== 1) throw unavailable(isQuote);

    return {
        timestamp: candidates[0].timestamp,
        tweetUrl: `https://x.com/${screenName}/status/${candidates[0].id}`
    };
}

function textWithEmoji(node) {
    if (!node) return '';
    if (node.nodeType === 3) return node.textContent;
    if (node.nodeType !== 1) return '';
    if (node.matches('.x-info-badge')) return '';
    if (node.tagName === 'IMG') return node.getAttribute('alt') || '';
    if (node.tagName === 'BR') return '\n';
    return Array.from(node.childNodes, textWithEmoji).join('');
}

/**
 * @param {HTMLElement} article
 * @param {string} screenName - Account owning the metadata supplied by the badge.
 * @param {HTMLElement|null} sourceAuthor - The clicked badge's live author header.
 * @returns {Readonly<object>} Detached data only, including frozen media and metrics.
 */
export function extractCaptureSnapshot(article, screenName, sourceAuthor = null) {
    if (!article?.matches(ARTICLE) || !article.isConnected ||
        typeof screenName !== 'string' || !/^[a-zA-Z0-9_]{1,15}$/.test(screenName)) {
        throw unavailable(false);
    }
    let author = sourceAuthor;
    if (!author) {
        const mainAuthors = scopedNodes(article, AUTHOR, article);
        if (mainAuthors.length !== 1) throw unavailable(false);
        [author] = mainAuthors;
    }
    if (!author.matches(AUTHOR) || author.closest(ARTICLE) !== article || !article.contains(author) ||
        extractUsername(author)?.toLowerCase() !== screenName.toLowerCase()) {
        throw new Error('The account on this post changed. Refresh X and try again.');
    }

    const scope = scopeOf(author, article);
    const scopedAuthors = scopedNodes(scope, AUTHOR, article);
    if (scopedAuthors.length !== 1 || scopedAuthors[0] !== author) throw unavailable(scope !== article);
    const identity = readIdentity(scope, article, screenName);
    const name = author.querySelector('a[role="link"] span, [dir="ltr"] span');
    const texts = scopedNodes(scope, '[data-testid="tweetText"]', article);
    if (texts.length > 1) throw unavailable(scope !== article);
    const avatar = scopedNodes(scope, '[data-testid="Tweet-User-Avatar"] img', article)[0];
    const mediaUrls = scopedNodes(scope, '[data-testid="tweetPhoto"] img', article)
        .map(image => image.currentSrc || image.src).filter(src => src && !src.includes('emoji'));
    const metric = selector => {
        const value = scopedNodes(scope, selector, article)[0]?.textContent.trim();
        return value && value !== '0' ? value : null;
    };

    return Object.freeze({
        ...identity,
        screenName,
        displayName: textWithEmoji(name).trim() || screenName,
        profileImageUrl: avatar?.currentSrc || avatar?.src || null,
        tweetText: textWithEmoji(texts[0]),
        mediaUrls: Object.freeze(mediaUrls),
        metrics: Object.freeze({
            replies: metric('[data-testid="reply"]'),
            retweets: metric('[data-testid="retweet"]'),
            likes: metric('[data-testid="like"]'),
            views: metric('a[href*="/analytics"]')
        })
    });
}
