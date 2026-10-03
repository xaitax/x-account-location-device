/** Related-post filtering owns presentation only, never X's article children. */
import { ownPostId, quotedPostId, QUOTE_CARD_SELECTOR, quoteCardOf } from './post-identity.js';
import { getPostRelation } from './post-relations-cache.js';
import { createFilterPlaceholder, updateFilterPlaceholder } from './filter-placeholder.js';

const MAX_DEPTH = 32;
const MAX_NODES = 128;
const ARTICLE_SELECTOR = 'article[data-testid="tweet"]';

function matchingVerdict(verdict) {
    return !!verdict && Array.isArray(verdict.reasons) && verdict.reasons.length > 0;
}

/**
 * The visible post's first edge names the reason, even when the matching author
 * is further down a confirmed reply/quote chain. No conversation-wide inference.
 */
function findRelatedSource(article, filters, getAuthorVerdict, getQuoteVerdicts, lastKnownId) {
    if (article.querySelector(QUOTE_CARD_SELECTOR)) {
        for (const verdict of getQuoteVerdicts(article, filters) || []) {
            if (matchingVerdict(verdict)) return { relation: 'quote', verdict };
        }
    }
    const id = ownPostId(article) || lastKnownId;
    const root = id ? getPostRelation(id) : null;
    if (!root) return null;
    const visited = new Set([id]);
    const pending = [{ record: root, depth: 0, relation: null }];
    for (let index = 0; index < pending.length && index < MAX_NODES; index++) {
        const current = pending[index];
        if (current.depth > 0) {
            const verdict = getAuthorVerdict(current.record, filters);
            if (matchingVerdict(verdict)) return { relation: current.relation, verdict };
        }
        if (current.depth >= MAX_DEPTH) continue;
        for (const [kind, relation] of [['quote', 'quote'], ['replyTo', 'reply']]) {
            const parentId = current.record[`${kind}Id`];
            if (!parentId || visited.has(parentId) || visited.size >= MAX_NODES) continue;
            visited.add(parentId);
            const known = getPostRelation(parentId);
            const author = known?.author || current.record[`${kind}Author`];
            // A confirmed relationship with an explicit author still permits
            // account-level matching when the parent's full result is absent.
            if (!known && !author) continue;
            pending.push({
                record: known ? { ...known, ...(author ? { author } : {}) } : { id: parentId, author },
                depth: current.depth + 1,
                relation: current.relation || relation
            });
        }
    }
    return null;
}

export function createRelatedPostController({
    getAuthorVerdict = () => null,
    getQuoteVerdicts = () => [],
    isExempt = () => false,
    getMainAuthor,
    onChange = () => {}
} = {}) {
    let states = new WeakMap();
    let enabled = false;
    let disposed = false;

    /** Bounded row facts distinguish recycled posts when a permalink is absent. */
    function snapshotFacts(article) {
        const facts = [];
        let textCount = 0;
        for (const text of article.querySelectorAll('[data-testid="tweetText"]')) {
            if (text.closest('article') !== article || quoteCardOf(text, article)) continue;
            const value = text.textContent.slice(0, 512);
            if (value) facts.push(`text:${value}`);
            if (++textCount >= 4) break;
        }
        let mediaCount = 0;
        for (const image of article.querySelectorAll('[data-testid="tweetPhoto"] img')) {
            if (image.closest('article') !== article || quoteCardOf(image, article)) continue;
            const src = image.getAttribute('src');
            if (src) facts.push(`media:${src.slice(0, 256)}`);
            if (++mediaCount >= 4) break;
        }
        let quoteCount = 0;
        for (const card of article.querySelectorAll(QUOTE_CARD_SELECTOR)) {
            if (card.closest('article') !== article || quoteCardOf(card, article)) continue;
            const id = quotedPostId(card);
            if (id) facts.push(`quote:${id}`);
            else {
                const author = card.querySelector('[data-testid="User-Name"]')?.dataset.xScreenName || '';
                let ownText = '';
                for (const text of card.querySelectorAll('[data-testid="tweetText"]')) {
                    if (quoteCardOf(text, article) === card) {
                        ownText = text.textContent.slice(0, 512);
                        break;
                    }
                }
                if (author || ownText) facts.push(`quote:${author}:${ownText}`);
            }
            if (++quoteCount >= 8) break;
        }
        if (!facts.length) return null;
        // Retain a lightweight identity fingerprint, not the post text/media URL.
        const value = JSON.stringify(facts);
        let first = 2166136261;
        let second = 5381;
        for (let index = 0; index < value.length; index++) {
            const code = value.charCodeAt(index);
            first = Math.imul(first ^ code, 16777619);
            second = Math.imul(second, 33) ^ code;
        }
        return `${value.length}:${first >>> 0}:${second >>> 0}`;
    }

    function identity(article) {
        let author = getMainAuthor?.(article);
        if (!author) {
            for (const name of article.querySelectorAll('[data-testid="User-Name"]')) {
                if (name.closest('article') === article && !quoteCardOf(name, article)) {
                    author = name.dataset.xScreenName;
                    break;
                }
            }
        }
        return {
            id: ownPostId(article),
            author: typeof author === 'string' ? author.toLowerCase() : null,
            snapshot: snapshotFacts(article)
        };
    }

    function sameIdentity(state, current) {
        if (state.author !== current.author) return false;
        if (current.id && state.lastKnownId) return current.id === state.lastKnownId;
        // A handle alone does not identify a post. Retain the last confirmed ID
        // through a temporary missing timestamp only while the row facts match.
        return current.snapshot !== null && state.snapshot === current.snapshot;
    }

    function ownButtons(article) {
        return Array.from(article.children).filter(child => child.tagName === 'BUTTON' &&
            child.classList.contains('x-quote-placeholder') && child.classList.contains('x-related-placeholder'));
    }

    function removeButton(article, state) {
        if (state?.button?.parentElement === article) state.button.remove();
        // Restored/reused DOM may contain our button after its WeakMap entry is
        // gone. Never touch X's children or a nested quote's separate placeholder.
        for (const button of ownButtons(article)) button.remove();
        if (state) state.button = null;
    }

    function clearPresentation(article, state, notify = true) {
        const changed = article.hasAttribute('data-x-related-block') || ownButtons(article).length > 0;
        removeButton(article, state);
        article.removeAttribute('data-x-related-block');
        if (changed && notify) onChange(article);
    }

    function reset({ preserveReveals = false } = {}) {
        // No strongly retained articles or timeline-wide enumeration during sync.
        // Detached old rows are cleaned if X restores them and sync runs again.
        for (const article of document.querySelectorAll(`${ARTICLE_SELECTOR}[data-x-related-block]`)) {
            clearPresentation(article, states.get(article));
        }
        if (!preserveReveals) {
            states = new WeakMap();
            enabled = false;
        }
    }

    function sync(article, filters) {
        if (disposed || !article?.matches(ARTICLE_SELECTOR)) return false;
        if (filters?.settings?.hideRelatedPosts !== true) {
            if (enabled) reset();
            // X can restore a previously detached marked row after reset.
            clearPresentation(article, states.get(article));
            states.delete(article);
            return false;
        }
        enabled = true;
        const current = identity(article);
        let state = states.get(article);
        if (!state || !sameIdentity(state, current)) {
            clearPresentation(article, state, false);
            state = { lastKnownId: current.id, author: current.author, snapshot: current.snapshot,
                shown: false, button: null, reasonText: '', description: '' };
            states.set(article, state);
        }
        if (current.id) state.lastKnownId = current.id;
        state.snapshot = current.snapshot;
        if (isExempt(article, filters)) {
            clearPresentation(article, state);
            return false;
        }
        const source = findRelatedSource(article, filters, getAuthorVerdict, getQuoteVerdicts, state.lastKnownId);
        if (!source) {
            clearPresentation(article, state);
            return false;
        }
        if (state.shown) {
            const changed = article.dataset.xRelatedBlock !== 'shown';
            removeButton(article, state);
            article.dataset.xRelatedBlock = 'shown';
            if (changed) onChange(article);
            return false;
        }
        const relationText = source.relation === 'quote' ? 'Quotes a filtered post' : 'Replies to a filtered post';
        const labels = (Array.isArray(source.verdict.labels) ? source.verdict.labels : source.verdict.reasons)
            .filter(label => typeof label === 'string' && label);
        const summary = labels.slice(0, 2).join(' · ') + (labels.length > 2 ? ` · +${labels.length - 2} more` : '');
        const reasonText = `${relationText}${summary ? ` · ${summary}` : ''}`;
        const description = `${relationText}${labels.length ? ` · ${labels.join(' · ')}` : ''}.`;
        let changed = article.dataset.xRelatedBlock !== 'hide' || reasonText !== state.reasonText ||
            description !== state.description;
        if (!state.button || state.button.parentElement !== article) {
            removeButton(article, state);
            state.button = createFilterPlaceholder({ title: 'Post hidden', action: 'Show post', related: true });
            state.button.classList.add('x-related-placeholder');
            article.prepend(state.button);
            changed = true;
        }
        if (changed) updateFilterPlaceholder(state.button, { reasonText, description });
        state.reasonText = reasonText;
        state.description = description;
        article.dataset.xRelatedBlock = 'hide';
        if (changed) onChange(article);
        return true;
    }

    function reveal(event) {
        if (disposed || !enabled) return false;
        if (event.type !== 'click' && event.type !== 'keydown') return false;
        if (event.type === 'keydown' && event.key !== 'Enter' && event.key !== ' ') return false;
        const target = event.target?.nodeType === 3 ? event.target.parentElement : event.target;
        const button = target?.closest?.('.x-related-placeholder');
        const keyboardArticle = event.type === 'keydown' && (event.key === 'Enter' || event.key === ' ') &&
            target?.matches?.(ARTICLE_SELECTOR) ? target : null;
        const article = button?.parentElement?.matches(ARTICLE_SELECTOR) ? button.parentElement : keyboardArticle;
        const state = article && states.get(article);
        if (!state || article.dataset.xRelatedBlock !== 'hide' ||
            (button && state.button !== button) || (!button && !keyboardArticle)) return false;
        if (!sameIdentity(state, identity(article))) {
            clearPresentation(article, state);
            states.delete(article);
            return false;
        }
        event.preventDefault();
        event.stopPropagation();
        state.shown = true;
        removeButton(article, state);
        article.dataset.xRelatedBlock = 'shown';
        article.focus({ preventScroll: true });
        onChange(article);
        return true;
    }

    return {
        sync,
        reveal,
        reset,
        dispose() {
            reset();
            disposed = true;
        }
    };
}
