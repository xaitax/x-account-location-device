/**
 * Local, cumulative filtering statistics. The ledger is retained until Reset so
 * virtualized posts, other tabs and worker restarts cannot count a post twice.
 * Only epoch-scoped SHA-256 keys and normalized buckets are stored, never post
 * IDs, handles or text. Hashes are pseudonymous identifiers, not anonymization.
 */
import { normalizeStatisticsLocation, normalizeStatisticsDevice,
    STATISTICS_UNKNOWN as UNKNOWN } from '../shared/statistics-values.js';

const DATABASE_NAME = 'x-posed-filter-statistics';
const MAX_BATCH_SIZE = 100;

function invalidInput(message) {
    const error = new Error(message);
    error.code = 'INVALID_FILTER_STATISTICS';
    return error;
}

function validateEpoch(epoch) {
    if (typeof epoch !== 'string' || !epoch.length || epoch.length > 128) {
        throw invalidInput('A valid filtering statistics epoch is required.');
    }
}

function normalizePosts(posts) {
    if (!Array.isArray(posts) || posts.length > MAX_BATCH_SIZE) {
        throw invalidInput(`Filtering statistics batches must contain at most ${MAX_BATCH_SIZE} posts.`);
    }
    const unique = new Map();
    for (const post of posts) {
        if (!post || typeof post.id !== 'string' || !/^[1-9]\d{0,19}$/.test(post.id)) {
            throw invalidInput('Filtering statistics require decimal post IDs.');
        }
        const location = normalizeStatisticsLocation(post.location);
        const device = normalizeStatisticsDevice(post.device);
        const existing = unique.get(post.id);
        if (existing) {
            if (existing.location === UNKNOWN) existing.location = location;
            if (existing.device === UNKNOWN) existing.device = device;
        } else {
            unique.set(post.id, { id: post.id, location, device });
        }
    }
    return [...unique.values()];
}

function newTotals(revision = 0) {
    return {
        key: 'totals',
        totalPosts: 0,
        countryCounts: {},
        deviceCounts: {},
        since: Date.now(),
        epoch: globalThis.crypto.randomUUID(),
        revision
    };
}

function snapshot(totals) {
    return {
        totalPosts: totals.totalPosts,
        countryCounts: { ...totals.countryCounts },
        deviceCounts: { ...totals.deviceCounts },
        since: totals.since,
        epoch: totals.epoch,
        revision: totals.revision
    };
}

function staleEpoch(totals) {
    return { success: false, code: 'STALE_EPOCH', epoch: totals.epoch, data: snapshot(totals) };
}

function adjustBucket(counts, bucket, change) {
    const count = (counts[bucket] || 0) + change;
    if (count > 0) counts[bucket] = count;
    else delete counts[bucket];
}

async function hashPost(epoch, post) {
    const bytes = new TextEncoder().encode(`${epoch}:${post.id}`);
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    const key = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    return { key, location: post.location, device: post.device };
}

/** Run synchronous IDB request callbacks, resolving only after durable commit. */
function transact(database, stores, operation) {
    return new Promise((resolve, reject) => {
        const transaction = database.transaction(stores, 'readwrite', { durability: 'strict' });
        let result;
        let failure;
        const guard = callback => () => {
            try {
                callback();
            } catch (error) {
                failure = error;
                transaction.abort();
            }
        };
        transaction.oncomplete = () => resolve(result);
        transaction.onabort = () => reject(failure || transaction.error || new Error('Filtering statistics transaction was aborted.'));
        transaction.onerror = () => {
            failure = failure || transaction.error;
        };
        guard(() => operation(transaction, guard, value => { result = value; }))();
    });
}

function readTotals(transaction, guard, callback) {
    const metadata = transaction.objectStore('metadata');
    const request = metadata.get('totals');
    request.onsuccess = guard(() => {
        const totals = request.result || newTotals();
        if (!request.result) metadata.put(totals);
        callback(totals);
    });
}

export class FilterStatisticsStore {
    constructor({ databaseName = DATABASE_NAME } = {}) {
        this.databaseName = databaseName;
        this.databasePromise = null;
    }

    // Lazy access keeps importing the worker safe in contexts without IndexedDB.
    open() {
        if (this.databasePromise) return this.databasePromise;
        const pending = new Promise((resolve, reject) => {
            if (!globalThis.indexedDB) {
                reject(new Error('Local filtering statistics storage is unavailable.'));
                return;
            }
            const request = globalThis.indexedDB.open(this.databaseName, 1);
            let unavailable = false;
            request.onupgradeneeded = () => {
                const database = request.result;
                database.createObjectStore('posts', { keyPath: 'key' });
                database.createObjectStore('metadata', { keyPath: 'key' });
            };
            request.onerror = () => reject(request.error || new Error('Could not open filtering statistics storage.'));
            request.onblocked = () => {
                unavailable = true;
                reject(new Error('Filtering statistics storage is busy. Try again after closing other extension pages.'));
            };
            request.onsuccess = () => {
                const database = request.result;
                if (unavailable) {
                    database.close();
                    return;
                }
                database.onversionchange = () => {
                    database.close();
                    if (this.databasePromise === pending) this.databasePromise = null;
                };
                resolve(database);
            };
        });
        this.databasePromise = pending;
        pending.catch(() => {
            if (this.databasePromise === pending) this.databasePromise = null;
        });
        return pending;
    }

    async close() {
        const pending = this.databasePromise;
        this.databasePromise = null;
        if (pending) (await pending).close();
    }

    async getSnapshot() {
        const database = await this.open();
        return transact(database, ['metadata'], (transaction, guard, complete) => {
            readTotals(transaction, guard, totals => complete(snapshot(totals)));
        });
    }

    async record(payload = {}) {
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
            throw invalidInput('A filtering statistics batch is required.');
        }
        const { epoch, posts } = payload;
        validateEpoch(epoch);
        const normalized = normalizePosts(posts);
        // Crypto promises must finish before an IDB transaction is opened.
        const entries = await Promise.all(normalized.map(post => hashPost(epoch, post)));
        const database = await this.open();
        return transact(database, ['metadata', 'posts'], (transaction, guard, complete) => {
            readTotals(transaction, guard, totals => {
                if (totals.epoch !== epoch) {
                    complete(staleEpoch(totals));
                    return;
                }
                const ledger = transaction.objectStore('posts');
                let remaining = entries.length;
                let recorded = 0;
                let updated = 0;
                const finish = () => {
                    if (recorded || updated) {
                        totals.revision++;
                        transaction.objectStore('metadata').put(totals);
                    }
                    complete({ success: true, epoch: totals.epoch, revision: totals.revision, recorded, updated });
                };
                if (!remaining) {
                    finish();
                    return;
                }
                for (const entry of entries) {
                    const request = ledger.get(entry.key);
                    request.onsuccess = guard(() => {
                        const existing = request.result;
                        if (!existing) {
                            ledger.put(entry);
                            totals.totalPosts++;
                            adjustBucket(totals.countryCounts, entry.location, 1);
                            adjustBucket(totals.deviceCounts, entry.device, 1);
                            recorded++;
                        } else {
                            // Historical metadata is first-known, not a mutable
                            // reflection of subsequent filter settings or tabs.
                            let changed = false;
                            for (const [field, counts] of [
                                ['location', totals.countryCounts], ['device', totals.deviceCounts]
                            ]) {
                                if (existing[field] === UNKNOWN && entry[field] !== UNKNOWN) {
                                    adjustBucket(counts, UNKNOWN, -1);
                                    adjustBucket(counts, entry[field], 1);
                                    existing[field] = entry[field];
                                    changed = true;
                                }
                            }
                            if (changed) {
                                ledger.put(existing);
                                updated++;
                            }
                        }
                        if (--remaining === 0) finish();
                    });
                }
            });
        });
    }

    async reset(payload = {}) {
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
            throw invalidInput('A filtering statistics epoch is required.');
        }
        const { epoch } = payload;
        validateEpoch(epoch);
        const database = await this.open();
        return transact(database, ['metadata', 'posts'], (transaction, guard, complete) => {
            readTotals(transaction, guard, totals => {
                if (totals.epoch !== epoch) {
                    complete(staleEpoch(totals));
                    return;
                }
                const cleared = newTotals(totals.revision + 1);
                transaction.objectStore('posts').clear();
                transaction.objectStore('metadata').put(cleared);
                complete({ success: true, data: snapshot(cleared) });
            });
        });
    }
}

export const filterStatistics = new FilterStatisticsStore();
