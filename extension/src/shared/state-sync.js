/** Ignore out-of-order snapshots without using wall-clock timestamps. */
export function createSnapshotTracker(initialRevisions = {}) {
    const revisions = Object.create(null);
    for (const [key, revision] of Object.entries(initialRevisions || {})) {
        if (Number.isSafeInteger(revision) && revision >= 0) revisions[key] = revision;
    }
    return {
        accept(key, revision) {
            if (typeof key !== 'string' || !key) return false;
            if (revision === undefined || revision === null) return revisions[key] === undefined;
            if (!Number.isSafeInteger(revision) || revision < 0) return false;
            if (revisions[key] !== undefined && revision < revisions[key]) return false;
            revisions[key] = revision;
            return true;
        },
        snapshot() { return { ...revisions }; }
    };
}
