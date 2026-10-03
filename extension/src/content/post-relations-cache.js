/** Bounded public-post observations for this tab session. Never written to storage. */
import { POST_RELATION_LIMITS, isPostId, normalizePostRelation, mergePostRelation } from '../shared/post-relations.js';
import { isFollowingViewer } from '../shared/following-data.js';

const posts = new Map();
let enabled = false;
let viewer = null;
let generation = 0;

export function getPostRelationsContext() {
    return { enabled, generation, viewer };
}

/** Unknown viewers can use public post observations; account switches clear them. */
export function configurePostRelations(nextEnabled, nextViewer = null) {
    const active = nextEnabled === true;
    const identity = active && isFollowingViewer(nextViewer) ? nextViewer : null;
    if (enabled !== active || viewer !== identity) {
        posts.clear();
        enabled = active;
        viewer = identity;
        generation++;
    }
    return getPostRelationsContext();
}

function sameRecord(previous, next) {
    if (!previous || Object.keys(previous).length !== Object.keys(next).length) return false;
    return Object.keys(next).every(key => {
        const value = next[key];
        return Array.isArray(value)
            ? Array.isArray(previous[key]) && previous[key].length === value.length &&
                value.every((label, index) => label === previous[key][index])
            : previous[key] === value;
    });
}

/** These two fields are observed in DOM headers, never accepted from page relays. */
function domEvidence(record) {
    const evidence = {};
    if (Object.hasOwn(record, 'displayName') && typeof record.displayName === 'string' && record.displayName.length <= 200) {
        evidence.displayName = record.displayName;
    }
    if (Object.hasOwn(record, 'accountLabels') && Array.isArray(record.accountLabels) &&
        record.accountLabels.length <= 8 && record.accountLabels.every(label => typeof label === 'string' && label.length <= 64)) {
        evidence.accountLabels = [...record.accountLabels];
    }
    return evidence;
}

function remember(record, includeDomEvidence, changedIds = null) {
    if (!enabled) return false;
    const normalized = normalizePostRelation(record);
    if (!normalized) return false;
    const previous = posts.get(normalized.id);
    const next = mergePostRelation(previous, normalized);
    // A changed author cannot borrow the old header's name or account labels.
    const sameAuthor = !normalized.author || !previous?.author || previous.author === normalized.author;
    if (sameAuthor && previous) {
        for (const key of ['displayName', 'accountLabels']) {
            if (Object.hasOwn(previous, key)) next[key] = previous[key];
        }
    }
    if (includeDomEvidence) Object.assign(next, domEvidence(record));
    const changed = !sameRecord(previous, next);
    posts.delete(next.id);
    posts.set(next.id, next);
    if (changed) changedIds?.add(next.id);
    if (posts.size > POST_RELATION_LIMITS.MAX_ENTRIES) {
        const oldest = posts.keys().next().value;
        posts.delete(oldest);
        changedIds?.add(oldest);
    }
    return changed;
}

/** Reject late generations, oversized wires/batches, and malformed envelopes. */
export function mergePostRelationsBatch(batch) {
    const changed = new Set();
    if (!enabled || !batch || typeof batch !== 'object' || Array.isArray(batch) ||
        !Number.isSafeInteger(batch.generation) || batch.generation !== generation ||
        !Array.isArray(batch.posts) || batch.posts.length > POST_RELATION_LIMITS.MAX_BATCH_ENTRIES) return changed;
    try {
        if (JSON.stringify(batch).length > POST_RELATION_LIMITS.MAX_RELAY_LENGTH) return changed;
    } catch { return changed; }
    for (const record of batch.posts) remember(record, false, changed);
    return changed;
}

/** Return a copied, bounded observation so callers cannot mutate the stored record. */
export function getPostRelation(id) {
    if (!enabled || !isPostId(id)) return null;
    const record = posts.get(id);
    if (!record) return null;
    posts.delete(id);
    posts.set(id, record);
    return { ...record, ...(record.accountLabels ? { accountLabels: [...record.accountLabels] } : {}) };
}

/** Remember already-observed DOM identity/relationships, without retaining nodes. */
export function rememberPostRelation(record) {
    return remember(record, true);
}

export function clearPostRelations() {
    posts.clear();
    enabled = false;
    viewer = null;
    generation++;
}

export function postRelationsCount() {
    return posts.size;
}
