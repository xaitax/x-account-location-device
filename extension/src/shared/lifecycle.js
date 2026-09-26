/** Own the listeners and scheduled work belonging to one content-script session. */
export function createLifecycle() {
    let disposed = false;
    const cleanups = new Set();

    function add(cleanup) {
        if (disposed) cleanup();
        else cleanups.add(cleanup);
        return () => cleanups.delete(cleanup);
    }

    function listen(target, type, listener, options) {
        if (disposed) return () => {};
        target.addEventListener(type, listener, options);
        const remove = () => target.removeEventListener(type, listener, options);
        const forget = add(remove);
        return () => { forget(); remove(); };
    }

    function delay(callback, milliseconds) {
        if (disposed) return () => {};
        const timer = setTimeout(() => {
            forget();
            if (!disposed) callback();
        }, milliseconds);
        const cancel = () => clearTimeout(timer);
        const forget = add(cancel);
        return () => { forget(); cancel(); };
    }

    function dispose() {
        if (disposed) return;
        disposed = true;
        for (const cleanup of [...cleanups].reverse()) {
            try { cleanup(); } catch (error) {
                console.error('X-Posed: Session cleanup failed:', error);
            }
        }
        cleanups.clear();
    }

    return { get disposed() { return disposed; }, add, listen, delay, dispose };
}
