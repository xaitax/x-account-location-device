/** Public post relationships observed in X's existing responses. No text or viewer state. */
export const POST_RELATION_LIMITS = Object.freeze({
    MAX_ENTRIES: 5000,
    MAX_POSTS_PER_RESPONSE: 500,
    MAX_BATCH_ENTRIES: 100,
    MAX_RELAY_LENGTH: 65536,
    MAX_WALK_NODES: 200000
});

export function isPostId(value) {
    // Numeric JSON values can already have lost precision before we see them.
    return typeof value === 'string' && /^[1-9][0-9]{0,19}$/.test(value);
}

function postHandle(value) {
    return typeof value === 'string' && /^[a-zA-Z0-9_]{1,15}$/.test(value)
        ? value.toLowerCase() : undefined;
}

function postLanguage(value) {
    return typeof value === 'string' && value.length <= 35 &&
        /^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8}){0,3}$/.test(value)
        ? value.toLowerCase() : undefined;
}

/** Copy only bounded primitive fields. Missing/malformed fields remain unobserved. */
export function normalizePostRelation(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || !isPostId(value.id)) return null;
    const record = { id: value.id };
    const author = postHandle(value.author);
    const language = postLanguage(value.language);
    if (author) record.author = author;
    if (language) record.language = language;
    for (const kind of ['replyTo', 'quote']) {
        const id = value[`${kind}Id`];
        if (!isPostId(id) || id === record.id) continue;
        record[`${kind}Id`] = id;
        const relatedAuthor = postHandle(value[`${kind}Author`]);
        if (relatedAuthor) record[`${kind}Author`] = relatedAuthor;
    }
    return record;
}

/** Sparse representations must not erase relationships learned from fuller results. */
export function mergePostRelation(previous, patch) {
    const before = normalizePostRelation(previous);
    const next = normalizePostRelation(patch);
    if (!next) return before;
    if (!before || before.id !== next.id) return next;
    const merged = { ...before, ...next };
    for (const kind of ['replyTo', 'quote']) {
        if (next[`${kind}Id`] && before[`${kind}Id`] !== next[`${kind}Id`] && !next[`${kind}Author`]) {
            delete merged[`${kind}Author`];
        }
    }
    return merged;
}

function unwrapTweet(value) {
    let node = value;
    for (let depth = 0; depth < 4 && node?.__typename === 'TweetWithVisibilityResults'; depth++) node = node.tweet;
    if (!node || typeof node !== 'object' || Array.isArray(node)) return null;
    if (node.__typename === 'Tweet') return node;
    // Older embedded legacy statuses have no typename. Do not mistake public User
    // IDs, conversation IDs, cards or arbitrary objects for posts.
    if (node.__typename !== undefined || !isPostId(node.id_str)) return null;
    const hasPostFields = Object.hasOwn(node, 'full_text') || Object.hasOwn(node, 'text') ||
        Object.hasOwn(node, 'in_reply_to_status_id_str') || Object.hasOwn(node, 'quoted_status_id_str');
    return hasPostFields && (isPostId(node.user_id_str) || node.user) ? node : null;
}

function tweetId(tweet) {
    for (const value of [tweet?.rest_id, tweet?.legacy?.id_str, tweet?.id_str]) {
        if (isPostId(value)) return value;
    }
    return undefined;
}

function tweetAuthor(tweet) {
    const user = tweet?.core?.user_results?.result ?? tweet?.user;
    return postHandle(user?.core?.screen_name ?? user?.legacy?.screen_name ?? user?.screen_name);
}

/** Project actual Tweet/visibility wrappers and older embedded legacy statuses. */
export function projectPostRelation(value) {
    const tweet = unwrapTweet(value);
    const id = tweetId(tweet);
    if (!id) return null;
    const legacy = tweet.legacy && typeof tweet.legacy === 'object' ? tweet.legacy : tweet;
    const record = { id, author: tweetAuthor(tweet), language: legacy.lang ?? tweet.lang };
    if (isPostId(legacy.in_reply_to_status_id_str)) {
        record.replyToId = legacy.in_reply_to_status_id_str;
        record.replyToAuthor = legacy.in_reply_to_screen_name;
    }
    const quoted = unwrapTweet(tweet.quoted_status_result?.result ?? tweet.quoted_status ?? legacy.quoted_status);
    const quoteId = tweetId(quoted) ?? legacy.quoted_status_id_str;
    if (isPostId(quoteId)) {
        record.quoteId = quoteId;
        record.quoteAuthor = tweetAuthor(quoted);
    }
    return normalizePostRelation(record);
}

/** Bounded, iterative response walk, including quotes, replies and retweeted statuses. */
export function collectPostRelations(data) {
    if (!data || typeof data !== 'object') return [];
    const found = new Map();
    const visited = new Set();
    const stack = [data];
    let nodes = 0;
    while (stack.length && ++nodes <= POST_RELATION_LIMITS.MAX_WALK_NODES) {
        const node = stack.pop();
        if (!node || typeof node !== 'object' || visited.has(node)) continue;
        visited.add(node);
        const record = projectPostRelation(node);
        if (record && (found.size < POST_RELATION_LIMITS.MAX_POSTS_PER_RESPONSE || found.has(record.id))) {
            found.set(record.id, mergePostRelation(found.get(record.id), record));
        }
        const capacity = POST_RELATION_LIMITS.MAX_WALK_NODES - nodes - stack.length;
        if (Array.isArray(node)) {
            for (let index = 0; index < Math.min(node.length, capacity); index++) stack.push(node[index]);
        } else {
            for (const key in node) {
                if (nodes + stack.length >= POST_RELATION_LIMITS.MAX_WALK_NODES) break;
                if (Object.hasOwn(node, key)) stack.push(node[key]);
            }
        }
    }
    // Resolve only by the exact related post ID, never by mentions or conversation ID.
    for (const record of found.values()) {
        for (const kind of ['replyTo', 'quote']) {
            const author = found.get(record[`${kind}Id`])?.author;
            if (!record[`${kind}Author`] && author) record[`${kind}Author`] = author;
        }
    }
    return [...found.values()];
}
