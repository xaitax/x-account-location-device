/** Common handling for X lookup deadlines and server-directed cooldowns. */
export const LOOKUP_TIMEOUT_MS = 8000;
export const RATE_LIMIT_STORAGE_KEY = 'x_api_rate_limit_reset';

export class RequestTimeoutError extends Error {
    constructor() {
        super('Request timed out');
        this.name = 'RequestTimeoutError';
        this.code = 'TIMEOUT';
    }
}

export class LookupTimeoutError extends RequestTimeoutError {
    constructor() {
        super();
        this.message = 'Account lookup timed out';
        this.name = 'LookupTimeoutError';
    }
}

/** Honor the latest valid server deadline; malformed/past headers use a 60s fallback. */
export function readRateLimitReset(headers, now = Date.now()) {
    const deadlines = [];
    const reset = Number(headers?.get('x-rate-limit-reset')) * 1000;
    if (Number.isFinite(reset) && reset > now) deadlines.push(reset);

    const retry = headers?.get('retry-after');
    if (retry !== null && retry !== undefined && String(retry).trim() !== '') {
        const seconds = Number(retry);
        const deadline = Number.isFinite(seconds) && seconds >= 0
            ? now + seconds * 1000
            : Date.parse(retry);
        if (Number.isFinite(deadline) && deadline > now) deadlines.push(deadline);
    }
    return deadlines.length ? Math.max(...deadlines) : now + 60000;
}

/** Bound the whole operation, including response decoding, and always clear its timer. */
export async function withRequestTimeout(operation, timeoutMs, createTimeoutError = () => new RequestTimeoutError()) {
    const controller = new AbortController();
    let timer;
    try {
        return await Promise.race([
            Promise.resolve().then(() => operation(controller.signal)),
            new Promise((_, reject) => {
                timer = setTimeout(() => {
                    reject(createTimeoutError());
                    controller.abort();
                }, timeoutMs);
            })
        ]);
    } finally {
        clearTimeout(timer);
    }
}

/** Preserve the lookup-specific error contract for X's background and page queues. */
export function withLookupTimeout(operation, timeoutMs = LOOKUP_TIMEOUT_MS) {
    return withRequestTimeout(operation, timeoutMs, () => new LookupTimeoutError());
}

/** Page-session fallback queue. Waiting time counts against the request deadline. */
export class PacedLookupQueue {
    constructor({ minIntervalMs = 1000, maxConcurrent = 2, timeoutMs = LOOKUP_TIMEOUT_MS } = {}) {
        this.minIntervalMs = minIntervalMs;
        this.maxConcurrent = maxConcurrent;
        this.timeoutMs = timeoutMs;
        this.pending = [];
        this.active = 0;
        this.lastStart = 0;
        this.resetTime = 0;
        this.timer = null;
    }

    rateLimitError() {
        return Object.assign(new Error('Rate limit exceeded'), {
            code: 'RATE_LIMITED', retryAfter: this.resetTime
        });
    }

    setRateLimit(resetTime) {
        if (!Number.isFinite(resetTime)) return;
        this.resetTime = Math.max(this.resetTime, resetTime);
        this.pump();
    }

    add(operation) {
        return withLookupTimeout(signal => new Promise((resolve, reject) => {
            if (this.resetTime > Date.now()) {
                reject(this.rateLimitError());
                return;
            }
            const item = { operation, signal, resolve, reject, deadline: Date.now() + this.timeoutMs };
            const onAbort = () => {
                const index = this.pending.indexOf(item);
                if (index !== -1) this.pending.splice(index, 1);
                reject(new LookupTimeoutError());
                if (item.finish) item.finish();
                this.pump();
            };
            signal.addEventListener('abort', onAbort, { once: true });
            item.cleanup = () => signal.removeEventListener('abort', onAbort);
            this.pending.push(item);
            this.pump();
        }), this.timeoutMs);
    }

    pump() {
        if (this.timer !== null) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        if (this.resetTime > Date.now()) {
            for (const item of this.pending.splice(0)) {
                item.cleanup();
                item.reject(this.rateLimitError());
            }
            return;
        }
        if (!this.pending.length || this.active >= this.maxConcurrent) return;
        const delay = this.minIntervalMs - (Date.now() - this.lastStart);
        if (delay > 0) {
            this.timer = setTimeout(() => { this.timer = null; this.pump(); }, delay);
            return;
        }
        const item = this.pending.shift();
        if (item.signal.aborted || item.deadline <= Date.now()) {
            item.cleanup();
            item.reject(new LookupTimeoutError());
            this.pump();
            return;
        }
        this.active++;
        this.lastStart = Date.now();
        let finished = false;
        item.finish = () => {
            if (finished) return;
            finished = true;
            item.cleanup();
            this.active--;
            this.pump();
        };
        Promise.resolve().then(() => item.operation(item.signal))
            .then(item.resolve, item.reject)
            .finally(item.finish);
        this.pump();
    }
}
