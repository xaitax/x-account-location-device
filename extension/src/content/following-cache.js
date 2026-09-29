/** Bounded, tab-session-only relationships for one signed-in viewer. No storage. */
import { FOLLOWING_LIMITS, isFollowingHandle, isFollowingViewer, readFollowingViewer } from '../shared/following-data.js';

const relationships = new Map();
let enabled = false;
let viewer = null;
let generation = 0;

export function getFollowingContext() {
    return { enabled, viewer, generation };
}

/** A generation also rejects late replies after disable/re-enable or A -> B -> A. */
export function configureFollowing(nextEnabled, nextViewer) {
    const valid = nextEnabled === true && isFollowingViewer(nextViewer);
    const identity = valid ? nextViewer : null;
    if (enabled !== valid || viewer !== identity) {
        relationships.clear();
        enabled = valid;
        viewer = identity;
        generation++;
    }
    return getFollowingContext();
}

/** Only strict booleans from the current request generation can update the map. */
export function mergeFollowingBatch(batch) {
    const changed = new Set();
    if (!enabled || !batch || typeof batch !== 'object' || Array.isArray(batch) ||
        batch.viewer !== viewer || batch.generation !== generation ||
        readFollowingViewer() !== viewer || !Number.isSafeInteger(batch.sequence) || batch.sequence < 0 ||
        !Array.isArray(batch.users) || batch.users.length > FOLLOWING_LIMITS.MAX_BATCH_ENTRIES) return changed;

    for (const entry of batch.users) {
        if (!entry || !isFollowingHandle(entry.u) || typeof entry.following !== 'boolean') continue;
        const name = entry.u.toLowerCase();
        const previous = relationships.get(name);
        if (previous && batch.sequence < previous.sequence) continue;
        // Conflicting representations at the same request order cannot grant an exemption.
        const following = previous?.sequence === batch.sequence
            ? previous.following && entry.following : entry.following;
        if (previous?.following !== following) changed.add(name);
        relationships.delete(name);
        relationships.set(name, { following, sequence: batch.sequence });
        if (relationships.size > FOLLOWING_LIMITS.MAX_ENTRIES) {
            const oldest = relationships.keys().next().value;
            relationships.delete(oldest);
            changed.add(oldest);
        }
    }
    return changed;
}

export function isFollowing(screenName) {
    return enabled && isFollowingHandle(screenName) &&
        relationships.get(screenName.toLowerCase())?.following === true && readFollowingViewer() === viewer;
}

export function clearFollowing() {
    relationships.clear();
    enabled = false;
    viewer = null;
    generation++;
}
