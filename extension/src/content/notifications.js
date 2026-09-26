/** Shared Graphite notifications. No dependency on badges, capture or other UI controllers. */
import { Z_INDEX } from '../shared/constants.js';
import { dialogIcon } from './dialog-icons.js';

let container = null;
const notifications = new Map();

function getContainer() {
    if (!container?.isConnected) {
        container = document.createElement('div');
        container.className = 'x-toast-container';
        container.style.zIndex = String(Z_INDEX.TOAST);
        (document.body || document.documentElement).appendChild(container);
    }
    return container;
}

function removeToast(toast) {
    const state = notifications.get(toast);
    if (state) {
        clearTimeout(state.timeout);
        clearTimeout(state.removalTimeout);
        notifications.delete(toast);
    }
    toast.remove();
    if (container && !container.childElementCount) {
        container.remove();
        container = null;
    }
}

/**
 * Show a notification without moving focus. Message, title and timeBadge are text only.
 * The returned element remains compatible with callers of ui.js's original toast API.
 * duration=0 keeps the notification visible until dismissed.
 */
export function showToast({ title, message, timeBadge, icon, iconType = 'warning', duration = 8000,
    loading = false, dismissible = true }) {
    const tone = ['warning', 'error', 'success', 'info'].includes(iconType) ? iconType : 'info';
    const toast = document.createElement('div');
    toast.className = 'x-toast';
    toast.dataset.tone = tone;

    const iconEl = document.createElement('div');
    iconEl.className = 'x-toast-icon';
    iconEl.setAttribute('aria-hidden', 'true');
    if (loading) {
        const spinner = document.createElement('span');
        spinner.className = 'x-toast-spinner';
        iconEl.appendChild(spinner);
    } else {
        const defaultIcon = tone === 'success' ? 'check'
            : tone === 'warning' || tone === 'error' ? 'warn' : 'infoCircle';
        const iconNode = icon ?? dialogIcon(defaultIcon, 20);
        if (iconNode instanceof Node) iconEl.appendChild(iconNode);
        else iconEl.textContent = String(iconNode);
    }

    const content = document.createElement('div');
    content.className = 'x-toast-content';
    content.setAttribute('role', tone === 'error' ? 'alert' : 'status');
    content.setAttribute('aria-atomic', 'true');
    if (title) {
        const heading = document.createElement('div');
        heading.className = 'x-toast-title';
        heading.textContent = title;
        content.appendChild(heading);
    }
    const body = document.createElement('div');
    body.className = 'x-toast-message';
    body.textContent = message ?? '';
    if (timeBadge) {
        const badge = document.createElement('span');
        badge.className = 'x-toast-time';
        badge.textContent = timeBadge;
        body.append(document.createTextNode(' '), badge);
    }
    content.appendChild(body);
    toast.append(iconEl, content);

    if (dismissible) {
        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'x-toast-close';
        close.setAttribute('aria-label', 'Dismiss notification');
        close.appendChild(dialogIcon('close', 16));
        close.addEventListener('click', () => dismissToast(toast));
        toast.appendChild(close);
        toast.addEventListener('keydown', event => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            event.stopPropagation();
            dismissToast(toast);
        });
    }

    const remaining = Number.isFinite(duration) && duration > 0 ? duration : 0;
    const state = { timeout: null, removalTimeout: null, remaining, deadline: 0,
        hovered: false, focused: false, hiding: false, returnFocus: document.activeElement };
    notifications.set(toast, state);
    if (remaining) {
        const progress = document.createElement('div');
        progress.className = 'x-toast-progress';
        progress.setAttribute('aria-hidden', 'true');
        progress.style.animationDuration = `${remaining}ms`;
        toast.appendChild(progress);

        const updateTimer = () => {
            if (state.hiding || !notifications.has(toast)) return;
            const paused = state.hovered || state.focused;
            toast.classList.toggle('x-toast-paused', paused);
            if (paused && state.timeout !== null) {
                clearTimeout(state.timeout);
                state.timeout = null;
                state.remaining = Math.max(0, state.deadline - Date.now());
            } else if (!paused && state.timeout === null) {
                state.deadline = Date.now() + state.remaining;
                state.timeout = setTimeout(() => dismissToast(toast), state.remaining);
            }
        };
        toast.addEventListener('mouseenter', () => { state.hovered = true; updateTimer(); });
        toast.addEventListener('mouseleave', () => { state.hovered = false; updateTimer(); });
        toast.addEventListener('focusin', () => { state.focused = true; updateTimer(); });
        toast.addEventListener('focusout', event => {
            state.focused = toast.contains(event.relatedTarget);
            updateTimer();
        });
        updateTimer();
    }
    getContainer().appendChild(toast);
    return toast;
}

/** Dismiss once, cancel its timer, and restore focus only if it was inside this notice. */
export function dismissToast(toast, { immediate = false } = {}) {
    if (!toast) return;
    const state = notifications.get(toast);
    if (state?.hiding && !immediate) return;
    if (state) {
        clearTimeout(state.timeout);
        state.timeout = null;
        state.hiding = true;
        if (toast.contains(document.activeElement) && state.returnFocus?.isConnected) {
            state.returnFocus.focus?.({ preventScroll: true });
        }
    }
    if (immediate || !toast.isConnected || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
        removeToast(toast);
        return;
    }
    toast.classList.add('x-toast-hiding');
    const timeout = setTimeout(() => removeToast(toast), 300);
    if (state) state.removalTimeout = timeout;
}

/** Cancel pending timers and remove all extension notices when content UI is torn down. */
export function cleanupNotifications() {
    for (const toast of notifications.keys()) dismissToast(toast, { immediate: true });
}
