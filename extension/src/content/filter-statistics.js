/**
 * Observe settled filtering outcomes without performing lookups. A bounded hot
 * cache avoids repeat messages; durable, cross-tab deduplication belongs to the
 * background ledger. Only identified posts and already-known metadata leave
 * this page, through local extension messaging.
 */
import { MESSAGE_TYPES, SELECTORS, canonicalCountry } from '../shared/constants.js';
import { extractUsername } from '../shared/utils.js';
import { ownPostId, quotedPostId } from './post-identity.js';
import { normalizeStatisticsLocation, normalizeStatisticsDevice, STATISTICS_UNKNOWN } from '../shared/statistics-values.js';

const QUOTE = '[data-testid="quoteTweet"], [role="link"][tabindex="0"]';
const MATCHED = new Set(['hide', 'highlight']);
const BATCH_SIZE = 100;
const HOT_CACHE_SIZE = 2000;
const MAX_PENDING_POSTS = 2000;
const POST_ID = /^[1-9]\d{0,19}$/;

function quoteOf(author, article) {
    for (let node = author.parentElement; node && node !== article; node = node.parentElement) {
        if (node.matches(QUOTE)) return node;
    }
    return null;
}

/** Read marker outcomes, not the filter rules themselves. No second matcher. */
export function filteredPostsInArticle(article, getInfo) {
    if (!article?.isConnected || !article.matches(SELECTORS.TWEET)) return [];
    const authors = [...article.querySelectorAll(SELECTORS.USERNAME)]
        .filter(author => author.closest(SELECTORS.TWEET) === article);
    const main = authors.find(author => !quoteOf(author, article));
    const currentAuthor = author => {
        const name = extractUsername(author);
        const processed = author?.dataset.xScreenName;
        return name && (!processed || processed.toLowerCase() === name.toLowerCase()) ? (processed || name) : null;
    };
    const metadata = author => {
        const name = currentAuthor(author);
        if (!name) return null;
        const info = getInfo(name);
        return {
            location: normalizeStatisticsLocation(canonicalCountry(info?.location || author.dataset.xCountry || '')),
            device: normalizeStatisticsDevice(info?.device)
        };
    };
    const posts = [];
    const mainMatched = MATCHED.has(article.dataset.xLangBlock) || MATCHED.has(main?.dataset.xBlock);
    if (main && mainMatched) {
        const id = ownPostId(article);
        const info = metadata(main);
        if (id && POST_ID.test(id) && info) posts.push({ id, ...info });
    }
    // A hidden parent already removes the quote from the timeline. Do not
    // record its independently marked child as another filtering action.
    if (article.dataset.xLangBlock === 'hide' || main?.dataset.xBlock === 'hide') return posts;
    for (const author of authors) {
        const card = quoteOf(author, article);
        if (!card || !MATCHED.has(author.dataset.xQuoteBlock)) continue;
        const id = quotedPostId(card);
        const info = metadata(author);
        if (id && POST_ID.test(id) && info) posts.push({ id, ...info });
    }
    return posts;
}

export function createFilterStatisticsReporter({ sendMessage, isEnabled, getInfo, delayMs = 300 }) {
    const dirty = new Set();
    const pending = new Map();
    const recorded = new Map();
    let disposed = false;
    let epoch = null;
    let generation = 0;
    let revision = -1;
    let drainQueued = false;
    let timer = null;
    let inFlight = null;
    let retryAt = 0;

    const signature = post => `${post.location}\n${post.device}`;
    const remember = post => {
        recorded.delete(post.id);
        recorded.set(post.id, signature(post));
        if (recorded.size > HOT_CACHE_SIZE) recorded.delete(recorded.keys().next().value);
    };
    const reset = (nextEpoch, nextRevision) => {
        if (Number.isSafeInteger(nextRevision) && nextRevision < revision) return;
        if (typeof nextEpoch !== 'string' || !nextEpoch || nextEpoch === epoch) return;
        generation++;
        epoch = nextEpoch;
        if (Number.isSafeInteger(nextRevision)) revision = nextRevision;
        dirty.clear();
        pending.clear();
        recorded.clear();
        clearTimeout(timer);
        timer = null;
        retryAt = 0;
    };
    const scheduleFlush = () => {
        if (disposed || timer !== null || !pending.size || inFlight || !isEnabled()) return;
        timer = setTimeout(() => {
            timer = null;
            void flush();
        }, Math.max(delayMs, retryAt - Date.now()));
    };
    const collect = () => {
        drainQueued = false;
        const articles = [...dirty];
        dirty.clear();
        if (disposed || !isEnabled()) return;
        for (const article of articles) {
            for (const post of filteredPostsInArticle(article, getInfo)) {
                if (recorded.get(post.id) === signature(post)) continue;
                const previous = pending.get(post.id);
                // Storage outages must not retain an unbounded feed in memory.
                // Unqueued IDs are never marked recorded and may be retried if
                // observed again; the durable ledger is never evicted.
                if (!previous && pending.size >= MAX_PENDING_POSTS) continue;
                pending.set(post.id, previous ? {
                    id: post.id,
                    location: previous.location === STATISTICS_UNKNOWN ? post.location : previous.location,
                    device: previous.device === STATISTICS_UNKNOWN ? post.device : previous.device
                } : post);
            }
        }
    };

    async function flush() {
        if (disposed) return;
        if (!isEnabled()) {
            pending.clear();
            dirty.clear();
            return;
        }
        collect();
        if (inFlight || !pending.size) return inFlight;
        clearTimeout(timer);
        timer = null;
        const startedGeneration = generation;
        let batch = [];
        const task = (async () => {
            try {
                if (!epoch) {
                    const response = await sendMessage({ type: MESSAGE_TYPES.GET_FILTER_STATISTICS });
                    if (disposed || generation !== startedGeneration) return;
                    if (!response?.success || !response.data?.epoch) throw new Error('Statistics unavailable');
                    epoch = response.data.epoch;
                    revision = response.data.revision;
                }
                if (!isEnabled() || disposed || generation !== startedGeneration) return;
                batch = [...pending.values()].slice(0, BATCH_SIZE);
                for (const post of batch) pending.delete(post.id);
                const response = await sendMessage({
                    type: MESSAGE_TYPES.RECORD_FILTER_STATISTICS,
                    payload: { epoch, posts: batch }
                });
                if (disposed || generation !== startedGeneration) return;
                if (response?.code === 'STALE_EPOCH') {
                    reset(response.epoch, response.data?.revision);
                    return;
                }
                if (!response?.success) throw new Error('Statistics could not be saved');
                if (Number.isSafeInteger(response.revision)) revision = Math.max(revision, response.revision);
                for (const post of batch) remember(post);
                retryAt = 0;
            } catch {
                if (disposed || generation !== startedGeneration) return;
                for (const post of batch) if (!pending.has(post.id)) pending.set(post.id, post);
                // Local storage can temporarily fail. Back off rather than
                // spinning or marking an uncommitted batch as recorded.
                retryAt = Date.now() + 30000;
            }
        })();
        inFlight = task;
        try { await task; }
        finally {
            if (inFlight === task) inFlight = null;
            scheduleFlush();
        }
    }

    return {
        schedule(article) {
            if (disposed || !isEnabled() || !article) return;
            dirty.add(article);
            if (drainQueued) return;
            drainQueued = true;
            queueMicrotask(() => {
                collect();
                scheduleFlush();
            });
        },
        reset,
        flush,
        dispose() {
            if (disposed) return;
            collect();
            // Dispatch remaining known-epoch batches before this page loses
            // its context. Already in-flight work commits independently, and
            // late replies cannot revive this session. No new epoch is adopted
            // during teardown; an uninitialized session remains best-effort.
            if (epoch && isEnabled()) {
                const posts = [...pending.values()];
                for (let index = 0; index < posts.length; index += BATCH_SIZE) {
                    try {
                        Promise.resolve(sendMessage({
                            type: MESSAGE_TYPES.RECORD_FILTER_STATISTICS,
                            payload: { epoch, posts: posts.slice(index, index + BATCH_SIZE) }
                        })).catch(() => {});
                    } catch { /* Extension context may already be gone. */ }
                }
            }
            disposed = true;
            generation++;
            clearTimeout(timer);
            timer = null;
            dirty.clear();
            pending.clear();
            recorded.clear();
        }
    };
}
