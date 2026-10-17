/**
 * Hovercard UI (Content Script)
 * Renders a single beautiful, reusable hovercard with rich AboutAccountQuery metadata.
 *
 * Design goals:
 * - zero innerHTML (XSS-safe)
 * - single DOM node reused (performance)
 * - graceful when fields are missing (cloud cache / partial API)
 */

import browserAPI from '../shared/browser-api.js';
import { CACHE_CONFIG, MESSAGE_TYPES, Z_INDEX, isRegion, observedAccountId } from '../shared/constants.js';
import { LRUCache } from '../shared/lru-cache.js';
import { getAccountVerification } from '../shared/account-verification.js';
import { deviceIcon, flagImage } from './icons.js';
import { dialogIcon } from './dialog-icons.js';
import { getProfile } from './profile-cache.js';
import { renderDisplayName, resolveDisplayNamePresentation } from './display-name.js';
import { createHovercardPng } from './hovercard-image.js';
import { createQuickFilterControl } from './hovercard-filters.js';
import { createCardTooltip } from './hovercard-tooltip.js';
import { resolveCardAvatar } from './hovercard-avatar.js';

/**
 * Thousands-separated count, or null when we have no number.
 * @param {number|null|undefined} value
 * @returns {string|null}
 */
function formatCount(value) {
    if (!Number.isInteger(value) || value < 0) return null;
    try {
        return value.toLocaleString();
    } catch {
        return String(value);
    }
}

let compactCountFormatter;

/** Keep large statistics on one line while their exact totals remain accessible. */
function formatCompactCount(value) {
    if (!Number.isInteger(value) || value < 0) return null;
    if (value < 1000000) return formatCount(value);
    try {
        compactCountFormatter ||= new Intl.NumberFormat(undefined, {
            notation: 'compact', maximumFractionDigits: 1
        });
        return compactCountFormatter.format(value);
    } catch {
        return formatCount(value);
    }
}

const CARD_ID = 'x-posed-hovercard';

/** Source timestamps order observations; the time a hover cache was filled does not. */
export function hasNewerObservation(current, candidate) {
    const now = Date.now();
    const observedAt = info => Number.isFinite(info?.timestamp) && info.timestamp > 0 && info.timestamp <= now
        ? info.timestamp : null;
    const currentTime = observedAt(current);
    const candidateTime = observedAt(candidate);
    return currentTime !== null && (candidateTime === null || currentTime > candidateTime);
}

// A lean page/cloud response can have `meta` without being a complete About
// response. Explicit null/false values are known answers, not missing data.
function hasRichMetadata(info) {
    const meta = info?.meta;
    if (!meta || typeof meta !== 'object' || Array.isArray(meta) || meta.partial) return false;
    const fields = ['name', 'avatarUrl', 'createdAt', 'restId', 'affiliateUsername', 'affiliate',
        'usernameChanges', 'profileImageShape', 'blueVerified', 'verified', 'verifiedType',
        'identityVerified', 'verifiedSinceMsec', 'protected', 'createdCountryAccurate', 'learnMoreUrl'];
    return fields.every(field => Object.hasOwn(meta, field) && meta[field] !== undefined) &&
        ['blueVerified', 'verified', 'identityVerified', 'protected', 'createdCountryAccurate']
            .every(field => typeof meta[field] === 'boolean');
}

function metadataObservedAt(info, now = Date.now()) {
    const time = Object.hasOwn(info || {}, 'metaTimestamp') ? info.metaTimestamp : info?.timestamp;
    return Number.isFinite(time) && time > 0 && time <= now ? time : null;
}

function hasUsableMetadata(info, now = Date.now()) {
    if (!hasRichMetadata(info)) return false;
    const observedAt = metadataObservedAt(info, now);
    const deadline = Object.hasOwn(info, 'metaExpiresAt') ? info.metaExpiresAt : info.expiresAt;
    if (deadline !== undefined && (!Number.isFinite(deadline) || deadline <= now)) return false;
    // Unknown age may be displayed, but can never suppress revalidation.
    return observedAt === null || observedAt + CACHE_CONFIG.EXPIRY_MS > now;
}

function hasConflictingSharedMetadata(complete, partial) {
    const createdAt = typeof partial?.createdAt === 'string' ? Date.parse(partial.createdAt) : NaN;
    if (Number.isFinite(createdAt) && createdAt !== Date.parse(complete?.createdAt)) return true;
    if (typeof partial?.usernameChanges === 'number' && partial.usernameChanges !== complete?.usernameChanges) return true;
    const label = value => typeof value === 'string' ? value.trim().toLowerCase() : '';
    const previousLabels = [label(complete?.affiliate?.name), label(complete?.affiliateUsername)];
    return [label(partial?.affiliate?.name), label(partial?.affiliateUsername)]
        .some(value => value && !previousLabels.includes(value));
}

function mergeHovercardInfo(candidate, current) {
    if (!candidate) return current || {};
    if (!current) return candidate;
    const candidateWins = !hasNewerObservation(current, candidate) &&
        (hasNewerObservation(candidate, current) || hasRichMetadata(candidate) || !hasRichMetadata(current));
    const newest = candidateWins ? candidate : current;
    const older = candidateWins ? current : candidate;
    if (hasUsableMetadata(newest) || !hasUsableMetadata(older)) return newest;
    // A later signal-only observation must not discard known details, nor may
    // an old handle snapshot donate another account's identity or warning.
    const sameAccount = /^\d+$/.test(String(newest.meta?.restId || '')) &&
        String(newest.meta.restId) === String(older.meta?.restId);
    const sameSignals = newest.location === older.location && newest.device === older.device &&
        (newest.locationAccurate === false) === (older.locationAccurate === false);
    if (!sameAccount || !sameSignals || hasConflictingSharedMetadata(older.meta, newest.meta)) return newest;
    const merged = { ...newest, meta: older.meta, metaTimestamp: metadataObservedAt(older) };
    const deadline = Object.hasOwn(older, 'metaExpiresAt') ? older.metaExpiresAt : older.expiresAt;
    if (deadline !== undefined) merged.metaExpiresAt = deadline;
    else delete merged.metaExpiresAt;
    return merged;
}

function selectKnownHovercardInfo(initialInfo, cached, now = Date.now()) {
    const initialId = initialInfo?.meta?.restId;
    const cachedId = cached?.data?.meta?.restId;
    if (initialId && cachedId && String(initialId) !== String(cachedId)) cached = null;
    let info = mergeHovercardInfo(cached?.data, initialInfo);
    const complete = hasUsableMetadata(info, now);
    if (hasRichMetadata(info) && !complete) {
        // Do not resurrect metadata past its original hard expiry.
        info = { ...info, meta: { partial: true, name: info.meta.name, restId: info.meta.restId } };
    }
    return { info, complete, observedAt: complete ? metadataObservedAt(info, now) : null };
}

function sameMetadataSnapshot(left, right) {
    const observedAt = metadataObservedAt(left);
    const deadline = info => info?.metaExpiresAt ?? info?.expiresAt ??
        (metadataObservedAt(info) === null ? null : metadataObservedAt(info) + CACHE_CONFIG.EXPIRY_MS);
    return observedAt !== null && observedAt === metadataObservedAt(right) && deadline(left) === deadline(right) &&
        left?.location === right?.location && left?.device === right?.device &&
        (left?.locationAccurate === false) === (right?.locationAccurate === false) &&
        JSON.stringify(left?.meta) === JSON.stringify(right?.meta);
}

function syncBadgeInfo(screenName, info, initialInfo) {
    if (!info || info === initialInfo || (info.location === initialInfo?.location && info.device === initialInfo?.device &&
        (info.locationAccurate === false) === (initialInfo?.locationAccurate === false) &&
        JSON.stringify(info.meta) === JSON.stringify(initialInfo?.meta) &&
        metadataObservedAt(info) === metadataObservedAt(initialInfo))) return;
    try {
        document.dispatchEvent(new CustomEvent('xposed:authoritative-info', {
            detail: { screenName, info }
        }));
    } catch { /* CustomEvent unsupported: non-fatal. */ }
}

function isSafeHttpsUrl(url) {
    return typeof url === 'string' && url.startsWith('https://');
}

function isTrustedTwimgUrl(url) {
    return isSafeHttpsUrl(url) && url.startsWith('https://pbs.twimg.com/');
}

function safeText(value, maxLen = 140) {
    if (value === null || value === undefined) return '';
    // eslint-disable-next-line no-control-regex
    return String(value).replace(/[\u0000-\u001F\u007F]/g, '').slice(0, maxLen);
}

function parseCreatedAt(createdAtStr) {
    if (!createdAtStr) return null;
    const d = new Date(createdAtStr);
    if (!Number.isNaN(d.getTime())) return d;

    // Fallback: try to extract year as a last resort.
    const m = String(createdAtStr).match(/\b(19\d{2}|20\d{2})\b/);
    if (m) {
        const year = Number(m[1]);
        const fallback = new Date(Date.UTC(year, 0, 1));
        return Number.isNaN(fallback.getTime()) ? null : fallback;
    }

    return null;
}

function yearsSince(date) {
    if (!date) return null;
    const ms = Date.now() - date.getTime();
    if (ms < 0) return 0;
    const years = ms / (365.25 * 24 * 60 * 60 * 1000);
    return Math.floor(years);
}

function formatShortDate(date) {
    if (!date) return '';
    try {
        // Use user locale but keep it compact.
        return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' });
    } catch {
        return date.toISOString().slice(0, 10);
    }
}

function createEl(tag, className, text = null) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== null && text !== undefined) el.textContent = text;
    return el;
}

/** Keep snowflake IDs as strings: converting them to Number loses precision. */
function profileUrlForUserId(userId) {
    return typeof userId === 'string' && /^[1-9][0-9]{0,19}$/.test(userId)
        ? `https://x.com/i/user/${userId}` : null;
}

function createUserIdValue(userId) {
    const value = createEl('span', 'x-posed-user-id-value', safeText(userId, 40));
    const url = profileUrlForUserId(userId);
    if (!url) return value;

    const control = createEl('span', 'x-posed-user-id-control');
    control.dataset.xUserId = userId;
    const button = createEl('button', 'x-posed-user-id-copy');
    button.type = 'button';
    const icon = createEl('span', 'x-posed-user-id-icon');
    icon.setAttribute('aria-hidden', 'true');
    const status = createEl('span', 'x-posed-sr-only');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const fallback = createEl('a', 'x-posed-user-id-fallback x-posed-link', url);
    fallback.href = url;
    fallback.target = '_blank';
    fallback.rel = 'noreferrer noopener';
    fallback.title = 'Copy this link address manually';
    fallback.hidden = true;
    let pending = false;
    let resetTimer = null;
    const isCurrent = () => button.isConnected &&
        button.closest('.x-posed-user-id-control')?.dataset.xUserId === userId;
    const feedback = (message = '', success = false) => {
        button.removeAttribute('title');
        button.dataset.xTooltipHeading = message || 'Copy profile link';
        button.dataset.xTooltipDescription = success ? 'Paste it to share a link to this account.'
            : 'Copies a link based on this account’s permanent User ID. It still works if the handle changes.';
        button.setAttribute('aria-label', message || `Copy permanent profile link for user ID ${userId}`);
        button.classList.toggle('x-posed-user-id-copy--success', success);
        icon.replaceChildren(dialogIcon(success ? 'check' : 'copy', 13));
        status.textContent = message;
    };
    feedback();
    button.append(value, icon);
    control.append(button, status, fallback);
    button.addEventListener('click', async event => {
        event.preventDefault();
        event.stopPropagation();
        if (pending) return;
        pending = true;
        clearTimeout(resetTimer);
        button.setAttribute('aria-busy', 'true');
        try {
            if (typeof navigator.clipboard?.writeText !== 'function') throw new Error('Clipboard unavailable');
            // Initiate inside the click gesture, without another lookup or await.
            await navigator.clipboard.writeText(url);
            if (!isCurrent()) return;
            fallback.hidden = true;
            feedback('Profile link copied', true);
            resetTimer = setTimeout(() => {
                if (isCurrent()) feedback();
            }, 1800);
        } catch {
            if (!isCurrent()) return;
            feedback('Could not copy. Copy the link below manually.');
            fallback.hidden = false;
        } finally {
            pending = false;
            button.removeAttribute('aria-busy');
        }
    });
    return control;
}

function createTag({ label, tone = 'neutral', title = '' }) {
    const tag = createEl('span', `x-posed-tag x-posed-tag-${tone}`);
    if (title) tag.title = safeText(title, 200);
    tag.append(dialogIcon(tone === 'neutral' ? 'shield' : 'verified', 13), document.createTextNode(safeText(label, 24)));
    return tag;
}

function createSignalValue(icon, text) {
    const value = createEl('span', 'x-posed-signal-value');
    value.appendChild(createEl('span', 'x-posed-signal-text', safeText(text, 80)));
    // A trailing, fixed-width rail keeps the flag and device aligned even when
    // their labels wrap to different lengths.
    const iconWrap = createEl('span', 'x-posed-signal-icon');
    iconWrap.setAttribute('aria-hidden', 'true');
    if (icon) iconWrap.appendChild(icon);
    value.appendChild(iconWrap);
    return value;
}

function createDateValue(date, ageYears = null) {
    const value = createEl('span', 'x-posed-date-value');
    const time = createEl('time', '', formatShortDate(date));
    time.dateTime = date.toISOString();
    value.appendChild(time);
    if (typeof ageYears === 'number') {
        const age = createEl('span', 'x-posed-account-age', `· ${ageYears}y`);
        age.setAttribute('aria-label', `${ageYears} ${ageYears === 1 ? 'year' : 'years'} old`);
        age.title = age.getAttribute('aria-label');
        value.appendChild(age);
    }
    return value;
}

function setLocationWarningHelp(card, open) {
    const button = card?.querySelector('.x-posed-warning-why');
    const help = card?.querySelector('.x-posed-warning-help');
    if (!button || !help) return;
    button.setAttribute('aria-expanded', String(open));
    help.hidden = !open;
    if (!open) {
        delete button.dataset.pinned;
        return;
    }

    // Keep the explanation inside the card, outside its scrolling body so
    // short/partial cards cannot clip it. It never changes the notice's height.
    const cardRect = card.getBoundingClientRect();
    const warningRect = button.parentElement.getBoundingClientRect();
    help.style.removeProperty('max-height');
    const height = help.getBoundingClientRect().height;
    const roomAbove = Math.max(0, warningRect.top - cardRect.top - 14);
    const roomBelow = Math.max(0, card.clientHeight - (warningRect.bottom - cardRect.top) - 14);
    const above = height <= roomAbove || roomAbove >= roomBelow;
    help.dataset.placement = above ? 'above' : 'below';
    help.style.maxHeight = `${above ? roomAbove : roomBelow}px`;
    help.style.top = `${above
        ? warningRect.top - cardRect.top - help.getBoundingClientRect().height - 6
        : warningRect.bottom - cardRect.top + 6}px`;
    const helpRect = help.getBoundingClientRect();
    const buttonRect = button.getBoundingClientRect();
    const pointerX = Math.max(12, Math.min(helpRect.width - 12, buttonRect.left + buttonRect.width / 2 - helpRect.left));
    help.style.setProperty('--xp-help-pointer-x', `${pointerX}px`);
}

function createLocationWarning(card, helpParent = card) {
    const warning = createEl('div', 'x-posed-card-warning');
    const copy = createEl('span', 'x-posed-warning-copy', 'Location may be inaccurate');
    const button = createEl('button', 'x-posed-warning-why', 'Why?');
    button.type = 'button';
    button.setAttribute('aria-label', 'Why location may be inaccurate');
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-controls', 'x-posed-location-help');
    button.setAttribute('aria-describedby', 'x-posed-location-help');
    const help = createEl('div', 'x-posed-warning-help');
    help.appendChild(createEl('span', 'x-posed-warning-help-copy',
        'X’s partner flags possible VPN/proxy use. Internet providers can use proxies automatically. This is not proof of VPN use.'));
    help.id = 'x-posed-location-help';
    help.setAttribute('role', 'tooltip');
    help.hidden = true;

    let leaveTimer;
    const showHelp = () => {
        clearTimeout(leaveTimer);
        setLocationWarningHelp(card, true);
    };
    const hideUnlessReading = event => {
        if (button.dataset.pinned || document.activeElement === button ||
            button.contains(event.relatedTarget) || help.contains(event.relatedTarget)) return;
        clearTimeout(leaveTimer);
        leaveTimer = setTimeout(() => {
            if (warning.isConnected && !button.dataset.pinned && document.activeElement !== button) {
                setLocationWarningHelp(card, false);
            }
        }, 120);
    };
    button.addEventListener('mouseenter', showHelp);
    button.addEventListener('mouseleave', hideUnlessReading);
    help.addEventListener('mouseenter', () => clearTimeout(leaveTimer));
    help.addEventListener('mouseleave', hideUnlessReading);
    button.addEventListener('focus', () => {
        if (button.matches(':focus-visible')) showHelp();
    });
    button.addEventListener('blur', () => setLocationWarningHelp(card, false));
    button.addEventListener('click', () => {
        const open = !button.dataset.pinned;
        setLocationWarningHelp(card, open);
        if (open) button.dataset.pinned = 'true';
    });
    warning.append(dialogIcon('warn', 15), copy, button);
    helpParent.appendChild(help);
    return warning;
}

function createRow({ label, value, primary = false }) {
    let cls = 'x-posed-row';
    if (primary) cls += ' x-posed-row--primary';
    const row = createEl('div', cls);
    row.dataset.xCardKey = label;

    const left = createEl('div', 'x-posed-row-left');
    const labelEl = createEl('span', 'x-posed-row-label', label);
    left.appendChild(labelEl);

    const right = createEl('div', 'x-posed-row-right');
    if (value instanceof Node) {
        right.appendChild(value);
    } else {
        right.textContent = safeText(value, 160);
    }

    row.appendChild(left);
    row.appendChild(right);
    return row;
}

function ensureCard() {
    let card = document.getElementById(CARD_ID);
    if (card && card.isConnected) return card;

    card = createEl('div', 'x-posed-hovercard');
    card.id = CARD_ID;
    card.setAttribute('role', 'dialog');
    card.style.zIndex = String((Z_INDEX?.TOAST || 1000001) + 5);

    // Prevent the card from interfering with tweet clicks.
    card.addEventListener('click', e => {
        e.stopPropagation();
    });

    document.body.appendChild(card);
    return card;
}

function positionCard(card, anchorEl) {
    // The no-hover layout is a bottom sheet. Leave its placement to CSS rather
    // than retaining desktop inline coordinates after a viewport change.
    if (window.matchMedia?.('(hover: none)').matches) {
        card.style.removeProperty('left');
        card.style.removeProperty('top');
        card.style.removeProperty('max-width');
        return;
    }
    const rect = anchorEl.getBoundingClientRect();
    // Adding a Hide filter can hide the anchor itself. Keep the open card in
    // place so its Remove action stays reachable, rather than jumping to (0,0).
    const previousPosition = rect.width === 0 && rect.height === 0 ? card.getBoundingClientRect() : null;

    // Desired placement: right of badge if possible; otherwise above/below.
    const margin = 10;
    // Issue #21: never let the inline max-width exceed the viewport, so the card
    // stays fully visible on narrow/mobile widths. Kept in sync with content.css
    // (.x-posed-hovercard width:340px / max-width:calc(100vw - 20px)).
    const maxWidth = Math.min(340, window.innerWidth - margin * 2);

    // Temporarily show to measure.
    card.style.left = '0px';
    card.style.top = '0px';
    card.style.maxWidth = `${maxWidth}px`;

    const cardRect = card.getBoundingClientRect();

    let left = previousPosition ? previousPosition.left : rect.right + margin;
    let top = previousPosition ? previousPosition.top : rect.top - 6;

    // Prefer flipping to the left of the badge if it would overflow the right edge.
    if (!previousPosition && left + cardRect.width > window.innerWidth - margin) {
        left = rect.left - cardRect.width - margin;
    }

    // No horizontal room either side: drop below the badge.
    if (!previousPosition && left < margin) {
        top = rect.bottom + margin;
    }

    // Clamp horizontally so the card is always fully on-screen (both edges).
    left = Math.min(left, window.innerWidth - cardRect.width - margin);
    left = Math.max(margin, left);

    // Flip above the badge if it would overflow the bottom edge, then clamp.
    if (!previousPosition && top + cardRect.height > window.innerHeight - margin) {
        top = rect.top - cardRect.height - margin;
    }
    top = Math.min(top, window.innerHeight - cardRect.height - margin);
    top = Math.max(margin, top);

    card.style.left = `${Math.round(left)}px`;
    card.style.top = `${Math.round(top)}px`;
}

/**
 * Issue #14: turn an error response into a clear, distinct hovercard message.
 * A persistent auth failure (common with Firefox multi-account containers, where
 * the background's cookies don't match the container session) used to show a bare
 * "Authentication failed" on EVERY user's card, looking like a per-user data
 * result. Distinguish the cases so the text is actionable.
 */
function describeHovercardError(response) {
    switch (response?.code) {
        case 'UNAUTHORIZED':
            return 'Couldn’t authenticate to X. If you use Firefox containers, open X in your default container (or reload x.com).';
        case 'NO_HEADERS':
            return 'Waiting to capture your X session. Scroll or reload x.com once, then hover again.';
        case 'RATE_LIMITED':
            return 'X rate limit reached. Try again in a moment.';
        case 'NOT_FOUND':
            return 'Account not found.';
        default:
            return response?.error || 'Failed to fetch details';
    }
}

/** Update only changed content; keep reading position, focus and live controls. */
function patchCardNode(current, next) {
    if (current.nodeType !== next.nodeType || current.nodeName !== next.nodeName) {
        current.replaceWith(next);
        return next;
    }
    // Do not reload a displayed avatar on metadata-only refreshes, or retry a
    // failed URL on every patch. A changed URL gets its own load/error handlers.
    if (current.nodeType === Node.ELEMENT_NODE && current.classList.contains('x-posed-card-avatar')) {
        if (current.dataset.xAvatarUrl !== next.dataset.xAvatarUrl) {
            current.replaceWith(next);
            return next;
        }
        current.dataset.shape = next.dataset.shape;
        return current;
    }
    // Its explanation owns interaction state and listeners, not account data.
    if (current.nodeType === Node.ELEMENT_NODE && current.classList.contains('x-posed-card-warning')) return current;
    // The header exception control owns live membership, save state and focus.
    // Metadata refreshes render a placeholder, never a replacement control.
    if (current.nodeType === Node.ELEMENT_NODE && current.classList.contains('x-posed-allowlist-control')) return current;
    if (current.nodeType === Node.ELEMENT_NODE && current.classList.contains('x-posed-user-id-control')) {
        if (current.dataset.xUserId === next.dataset.xUserId) return current;
        // A genuinely changed ID needs fresh listeners and must not inherit an
        // earlier clipboard result. Same-ID enrichment keeps focus and feedback.
        current.dataset.xUserId = next.dataset.xUserId;
        current.replaceChildren(...Array.from(next.childNodes));
        return current;
    }
    if (current.isEqualNode(next)) return current;
    if (current.nodeType === Node.TEXT_NODE) {
        if (current.nodeValue !== next.nodeValue) current.nodeValue = next.nodeValue;
        return current;
    }
    for (const attribute of Array.from(current.attributes)) {
        if (!next.hasAttribute(attribute.name)) current.removeAttribute(attribute.name);
    }
    for (const attribute of Array.from(next.attributes)) {
        if (current.getAttribute(attribute.name) !== attribute.value) {
            current.setAttributeNS(attribute.namespaceURI, attribute.name, attribute.value);
        }
    }
    const key = node => node.nodeType === Node.ELEMENT_NODE
        ? `${node.nodeName}:${node.dataset?.xCardKey || node.getAttribute('class')?.split(' ')[0] || ''}` : node.nodeName;
    const previous = Array.from(current.childNodes);
    const used = new Set();
    let cursor = current.firstChild;
    for (const desired of Array.from(next.childNodes)) {
        const match = previous.find(node => !used.has(node) && key(node) === key(desired));
        const atCursor = match === cursor;
        const node = match ? patchCardNode(match, desired) : desired;
        if (match) used.add(match);
        // Recursive patches may replace the matched node (for example a new
        // avatar URL). Its old reference is no longer a valid insertion point.
        if (atCursor) cursor = node;
        if (node !== cursor) current.insertBefore(node, cursor);
        cursor = node.nextSibling;
    }
    for (const node of previous) if (!used.has(node) && node.parentNode === current) node.remove();
    return current;
}

function buildCardContent({ screenName, displayName = '', displayNamePresentation = null, fallbackName = '', info, avatar = null, loading = false, errorText = '', allowlistControl = null, allowlistStatus = null, imageControl = null, quickFilterControl = null, onClose, update = false }) {
    const card = ensureCard();
    const focusedElement = card.contains(document.activeElement) ? document.activeElement : null;
    const focusedClose = focusedElement?.classList.contains('x-posed-card-close');
    const focusedLink = focusedElement?.classList.contains('x-posed-link');
    const focusedBody = focusedElement?.classList.contains('x-posed-card-body');
    const focusedWarning = focusedElement?.classList.contains('x-posed-warning-why');
    const focusedUserId = focusedElement?.classList.contains('x-posed-user-id-copy');
    const accountKey = String(screenName || '').toLowerCase();
    const scrollTop = card.dataset.xScreenName === accountKey
        ? card.querySelector('.x-posed-card-body')?.scrollTop || 0 : 0;
    const patch = update && card.dataset.xScreenName === accountKey && card.querySelector('.x-posed-card-body');
    const rendered = patch ? createEl('div') : card;
    card.dataset.xScreenName = accountKey;
    if (!patch) card.replaceChildren();
    card.setAttribute('aria-label', `Account details for @${safeText(screenName, 20)}`);

    const meta = info?.meta || {};

    // Header
    const header = createEl('div', 'x-posed-card-header');

    // Prefer the avatar already owned by this author on X. Image loading never
    // holds up the card or adds another account lookup.
    if (avatar?.url) {
        const picture = createEl('img', 'x-posed-card-avatar');
        picture.alt = '';
        picture.width = 48;
        picture.height = 48;
        picture.decoding = 'async';
        picture.referrerPolicy = 'no-referrer';
        picture.draggable = false;
        picture.dataset.shape = avatar.shape === 'square' ? 'square' : 'circle';
        picture.dataset.xAvatarUrl = avatar.url;
        picture.addEventListener('error', () => {
            picture.hidden = true;
            picture.closest('.x-posed-card-header')?.removeAttribute('data-has-avatar');
        });
        header.dataset.hasAvatar = 'true';
        header.appendChild(picture);
    }
    const titleWrap = createEl('div', 'x-posed-title');
    const nameLine = createEl('div', 'x-posed-name-line');
    const nameEl = createEl('span', 'x-posed-name');
    renderDisplayName(nameEl, displayName || meta.name || fallbackName || screenName, displayNamePresentation);
    const handleEl = createEl('span', 'x-posed-handle', `@${safeText(screenName, 20)}`);
    handleEl.title = handleEl.textContent;
    const handleLine = createEl('div', 'x-posed-handle-line');
    handleLine.appendChild(handleEl);
    const exceptionControl = allowlistControl || (patch && card.querySelector('.x-posed-allowlist-control')
        ? createEl('div', 'x-posed-allowlist-control') : null);
    nameLine.appendChild(nameEl);

    // Business/Government take precedence: X also marks some gold accounts
    // is_blue_verified, so that flag alone does not identify the checkmark color.
    const verificationInfo = getAccountVerification(meta);
    if (verificationInfo) {
        const verification = createEl('span', 'x-posed-inline-verification');
        verification.dataset.verification = verificationInfo.type;
        verification.setAttribute('role', 'img');
        verification.setAttribute('aria-label', verificationInfo.label);
        verification.title = verificationInfo.title;
        verification.appendChild(dialogIcon('verified', 18));
        nameLine.appendChild(verification);
    }

    // Less common account statuses still keep their explicit labels.
    const tags = createEl('div', 'x-posed-tags');
    if (meta.identityVerified) {
        tags.appendChild(createTag({ label: 'Identity verified', tone: 'green', title: 'Identity verified' }));
    }
    if (meta.protected) {
        tags.appendChild(createTag({ label: 'Protected', tone: 'neutral', title: 'Protected account' }));
    }

    const aff = meta.affiliate;

    titleWrap.appendChild(nameLine);
    titleWrap.appendChild(handleLine);
    if (tags.childNodes.length > 0) titleWrap.appendChild(tags);

    header.appendChild(titleWrap);
    const headerActions = createEl('div', 'x-posed-header-actions');
    if (exceptionControl) headerActions.appendChild(exceptionControl);
    const closeButton = createEl('button', 'x-posed-card-close');
    closeButton.type = 'button';
    closeButton.setAttribute('aria-label', 'Close account details');
    closeButton.title = 'Close account details';
    closeButton.appendChild(dialogIcon('close', 16));
    closeButton.addEventListener('click', onClose);
    headerActions.appendChild(closeButton);
    header.appendChild(headerActions);

    // Body
    const body = createEl('div', 'x-posed-card-body');
    body.tabIndex = 0;
    body.setAttribute('role', 'region');
    body.setAttribute('aria-label', 'Account information');

    // Keep known location and connection details visible even when richer
    // account metadata is unavailable.
    const signals = createEl('div', 'x-posed-card-signals');
    if (info?.location) {
        signals.appendChild(createRow({
            label: 'Location',
            value: createSignalValue(flagImage(info.location) || dialogIcon(isRegion(info.location) ? 'map' : 'globe', 18), info.location),
            primary: true
        }));
    }

    if (info?.device) {
        signals.appendChild(createRow({
            label: 'Connected via',
            value: createSignalValue(deviceIcon(info.device, 18), info.device),
            primary: true
        }));
    }
    if (signals.childNodes.length) body.appendChild(signals);

    if (info?.locationAccurate === false) {
        body.appendChild(createLocationWarning(card, rendered));
    }

    // Activity counts, harvested from the profile data X already ships
    // with its own timeline responses. No lookup was spent to show these, and they are
    // simply absent for an account we have not seen in a response yet.
    const profile = getProfile(screenName);
    if (profile) {
        const stats = createEl('div', 'x-posed-card-stats');
        stats.setAttribute('role', 'group');
        stats.setAttribute('aria-label', 'Account activity');
        const values = [
            { label: 'Followers', value: profile.followers },
            { label: 'Following', value: profile.following },
            { label: 'Posts', value: profile.tweets },
            { label: 'Media', value: profile.media }
        ];
        for (const { label, value } of values) {
            const exactCount = formatCount(value);
            if (exactCount === null) continue;
            const stat = createEl('div', 'x-posed-stat');
            stat.dataset.xCardKey = label;
            stat.title = `${exactCount} ${label}`;
            stat.setAttribute('role', 'group');
            stat.setAttribute('aria-label', stat.title);
            const number = createEl('span', 'x-posed-stat-value', formatCompactCount(value));
            number.title = exactCount;
            number.setAttribute('aria-label', exactCount);
            stat.append(number, createEl('span', 'x-posed-stat-label', label));
            stats.appendChild(stat);
        }
        if (stats.childNodes.length) {
            stats.dataset.count = String(stats.childNodes.length);
            body.appendChild(stats);
        }
    }

    const metadata = createEl('div', 'x-posed-card-metadata');
    const createdAt = parseCreatedAt(meta.createdAt);
    const ageYears = yearsSince(createdAt);
    if (createdAt) {
        metadata.appendChild(createRow({ label: 'Created', value: createDateValue(createdAt, ageYears) }));
    }

    // Verified since
    if (typeof meta.verifiedSinceMsec === 'number' && meta.verifiedSinceMsec > 0) {
        const d = new Date(meta.verifiedSinceMsec);
        if (!Number.isNaN(d.getTime())) {
            metadata.appendChild(createRow({ label: 'Verified since', value: createDateValue(d) }));
        }
    }

    if (typeof meta.usernameChanges === 'number') {
        metadata.appendChild(createRow({ label: 'Handle changes', value: String(meta.usernameChanges) }));
    }

    if (aff?.name || meta.affiliateUsername) {
        const content = document.createElement('span');

        if (aff?.badgeUrl && isTrustedTwimgUrl(aff.badgeUrl)) {
            const badgeImg = document.createElement('img');
            badgeImg.className = 'x-posed-affiliate-badge';
            badgeImg.src = aff.badgeUrl;
            badgeImg.alt = '';
            badgeImg.loading = 'lazy';
            badgeImg.referrerPolicy = 'no-referrer';
            content.appendChild(badgeImg);
        }

        const label = safeText(aff?.name || meta.affiliateUsername, 60);

        // Link the affiliation NAME itself when a URL is present (no separate arrow).
        if (aff?.url && isSafeHttpsUrl(aff.url)) {
            const link = document.createElement('a');
            link.className = 'x-posed-link';
            link.href = aff.url;
            link.target = '_blank';
            link.rel = 'noreferrer noopener';
            link.textContent = label;
            content.appendChild(link);
        } else {
            content.appendChild(document.createTextNode(label));
        }

        metadata.appendChild(createRow({ label: 'Affiliation', value: content }));
    }

    // Keep this technical, stable identifier last, apart from account history.
    const accountId = observedAccountId(info, profile);
    if (accountId) {
        const identifier = createRow({ label: 'User ID', value: createUserIdValue(accountId) });
        identifier.classList.add('x-posed-row--identifier');
        metadata.appendChild(identifier);
    }
    if (metadata.childNodes.length) {
        metadata.setAttribute('role', 'group');
        metadata.setAttribute('aria-label', 'Account details');
        metadata.prepend(createEl('div', 'x-posed-metadata-heading', 'Account details'));
        body.appendChild(metadata);
    }

    // Intentionally omit `profileImageShape` ("Avatar") and `learnMoreUrl` rows:
    // they add noise without providing actionable signal.

    if (errorText) {
        const error = createEl('div', 'x-posed-card-status x-posed-card-status--error', safeText(errorText, 240));
        error.setAttribute('role', 'status');
        body.appendChild(error);
    } else if (loading) {
        const status = createEl('div', 'x-posed-card-status', 'Fetching account details…');
        status.setAttribute('role', 'status');
        body.appendChild(status);
    }

    // Empty states
    if (body.childNodes.length === 0) {
        body.appendChild(createEl('div', 'x-posed-empty', 'No extra account metadata available.'));
    }

    rendered.appendChild(header);
    rendered.appendChild(body);
    if (!patch && (allowlistControl || imageControl || quickFilterControl)) {
        const footer = createEl('div', 'x-posed-card-actions');
        const actionRow = createEl('div', 'x-posed-card-action-row');
        if (quickFilterControl) actionRow.appendChild(quickFilterControl.element);
        if (imageControl) actionRow.appendChild(imageControl.element);
        const sectionCount = Number(!!quickFilterControl) + Number(!!imageControl);
        if (sectionCount) {
            actionRow.dataset.count = String(sectionCount);
            actionRow.style.setProperty('--xp-card-section-count', String(sectionCount));
            footer.appendChild(actionRow);
        }
        // Feedback stays below both sections without interrupting their action rows.
        if (quickFilterControl) footer.appendChild(quickFilterControl.status);
        if (allowlistStatus) footer.appendChild(allowlistStatus);
        if (imageControl) footer.appendChild(imageControl.status);
        card.appendChild(footer);
    }
    if (patch) {
        patchCardNode(card.querySelector('.x-posed-card-header'), header);
        patchCardNode(card.querySelector('.x-posed-card-body'), body);
        const help = card.querySelector('.x-posed-warning-help');
        if (info?.locationAccurate !== false) help?.remove();
        else if (!help) card.appendChild(rendered.querySelector('.x-posed-warning-help'));
    }
    const liveHeader = card.querySelector('.x-posed-card-header');
    const liveAvatar = liveHeader.querySelector('.x-posed-card-avatar');
    // Populate only the final live image, not a detached patch candidate. This
    // avoids even starting another image load when its URL has not changed.
    if (liveAvatar && liveAvatar.getAttribute('src') !== liveAvatar.dataset.xAvatarUrl) {
        liveAvatar.src = liveAvatar.dataset.xAvatarUrl;
    }
    if (liveAvatar && !liveAvatar.hidden) liveHeader.dataset.hasAvatar = 'true';
    else liveHeader.removeAttribute('data-has-avatar');
    const liveBody = card.querySelector('.x-posed-card-body');
    liveBody.scrollTop = scrollTop;
    // Refreshing metadata must not drop keyboard focus while someone is reading
    // the card or using its account exception control.
    if (focusedElement?.isConnected) focusedElement.focus({ preventScroll: true });
    else if (focusedClose) card.querySelector('.x-posed-card-close').focus({ preventScroll: true });
    else if (focusedBody) liveBody.focus({ preventScroll: true });
    else if (focusedUserId) (card.querySelector('.x-posed-user-id-copy') || card.querySelector('.x-posed-card-close')).focus({ preventScroll: true });
    else if (focusedWarning) (card.querySelector('.x-posed-warning-why') || card.querySelector('.x-posed-card-close')).focus({ preventScroll: true });
    else if (focusedLink) (card.querySelector('.x-posed-link') || card.querySelector('.x-posed-card-close')).focus({ preventScroll: true });
    return card;
}

// Touch / no-hover devices (e.g. Firefox for Android) have no mouseenter/mouseleave,
// so the dossier opens on tap instead of hover (see attach()).
const TOUCH = !(typeof window !== 'undefined' && window.matchMedia &&
    window.matchMedia('(hover: hover)').matches);
const HOVER_INTENT_MS = 300;

class HovercardController {
    constructor() {
        this.card = null;
        this.hideTimeout = null;
        this.hoverIntent = null;
        this.currentAnchor = null;
        this.currentScreenName = '';
        this.viewId = 0;
        this.generation = 0;
        this.allowlistState = null;
        this.imageState = null;
        this.actionTooltip = null;
        this.allowlistWrites = new Map();
        this.filterContext = null;
        this.quickFilterState = null;
        this.quickFilterWrites = new Map();
        this._clickMode = false;

        // Per-session cache to avoid repeated API hits while you hover around.
        // Bounded LRU so a long browsing session can't grow it without limit
        // (entries are also TTL-checked on read). checkedAt is only a short
        // revalidation receipt, not a new observation or a renewed hard expiry.
        // screenName -> { data, fetchedAt, checkedAt }
        this.hoverCache = new LRUCache(200);
        this.inFlight = new Map(); // screenName -> Promise
        this.cacheTtlMs = 60 * 1000; // 60s

        // Coalesce scroll/resize reposition work into a single rAF tick.
        this._repositionRafId = null;

        this._handleCardEnter = this._handleCardEnter.bind(this);
        this._handleCardLeave = this._handleCardLeave.bind(this);
        this._handleScroll = this._handleScroll.bind(this);
        this._handleOutsideTap = this._handleOutsideTap.bind(this);
        this._handleKeyDown = this._handleKeyDown.bind(this);
        this._handleClose = this._handleClose.bind(this);
        this._handleFocusOut = this._handleFocusOut.bind(this);
        this._handleHoverIntentCancel = this._handleHoverIntentCancel.bind(this);
    }

    /** Private content-session state: never fetch settings or expose a page-global mutation API. */
    configureFilters(context) {
        this.filterContext = typeof context?.getState === 'function' && typeof context?.sendMessage === 'function'
            ? context : null;
    }

    syncFilters() {
        this.quickFilterState?.refresh();
    }

    _createQuickFilters(handle, info, viewId) {
        if (!this.filterContext) return null;
        const generation = this.generation;
        let control = null;
        const isCurrent = () => control !== null && this.generation === generation && this.viewId === viewId &&
            this.currentScreenName === handle && this.quickFilterState === control &&
            this.card?.classList.contains('x-posed-hovercard-visible') && this.card.contains(control.element);
        control = createQuickFilterControl({
            handle, info, ...this.filterContext, writes: this.quickFilterWrites, isCurrent,
            onChange: () => {
                if (isCurrent() && this.currentAnchor?.isConnected) positionCard(this.card, this.currentAnchor);
            }
        });
        return control;
    }

    _disposeQuickFilters() {
        this.quickFilterState?.dispose();
        this.quickFilterState = null;
    }

    /**
     * @param {HTMLElement} badgeEl
     * @param {object} opts
     * @param {boolean} [opts.clickToOpen] - open on click instead of hover (issue #38).
     *   Touch devices always use click regardless, since they have no hover at all.
     */
    attach(badgeEl, { screenName, displayName = '', displayNamePresentation = null, info, getInfo = null, csrfToken = null, clickToOpen = false }) {
        if (!badgeEl || badgeEl.dataset.xPosedHovercardAttached === 'true') return;
        badgeEl.dataset.xPosedHovercardAttached = 'true';
        const detailsButton = badgeEl.querySelector('.x-badge-details');
        detailsButton?.setAttribute('aria-haspopup', 'dialog');
        detailsButton?.setAttribute('aria-controls', CARD_ID);
        detailsButton?.setAttribute('aria-expanded', 'false');

        const useClick = TOUCH || clickToOpen;

        // The details control, optional info hint and pill gaps all open the
        // card. Share has its own action and must never toggle account details.
        badgeEl.addEventListener('click', e => {
            this._cancelHoverIntent();
            if (e.target.closest('.x-capture-btn')) return;
            e.preventDefault();
            e.stopPropagation();
            const open = this.currentAnchor === badgeEl &&
                this.card?.classList.contains('x-posed-hovercard-visible');
            if (open && this._clickMode) this.hide();
            else {
                this.show(badgeEl, { screenName, displayName, displayNamePresentation, info, getInfo, csrfToken, clickToOpen: true });
                if (e.detail === 0) this.card?.querySelector('.x-posed-card-close')?.focus({ preventScroll: true });
            }
        });
        if (!useClick) {
            const onEnter = () => {
                this._scheduleHoverIntent(badgeEl, { screenName, displayName, displayNamePresentation, info, getInfo, csrfToken });
            };
            const onLeave = () => {
                this._cancelHoverIntent(badgeEl);
                this.hideSoon();
            };
            badgeEl.addEventListener('mouseenter', onEnter);
            badgeEl.addEventListener('mouseleave', onLeave);
        }
        badgeEl.addEventListener('focusin', this._handleCardEnter);
        badgeEl.addEventListener('focusout', this._handleFocusOut);

        // Mark for cleanup by content-script cleanup routines.
        badgeEl.classList.add('x-posed-has-hovercard');
    }

    _scheduleHoverIntent(anchorEl, options) {
        this._cancelHoverIntent();
        const visible = this.card?.classList.contains('x-posed-hovercard-visible');
        if (visible && this.currentAnchor === anchorEl) {
            this._handleCardEnter();
            return;
        }
        // Passing another badge must not interrupt a pinned card, a keyboard
        // reader or an explicit Copy/Save operation. Clicking can still switch.
        if (!anchorEl?.isConnected || document.hidden || this._clickMode || this.imageState?.pending || this.quickFilterState?.pending ||
            (visible && (this.card.contains(document.activeElement) ||
                this.currentAnchor?.contains(document.activeElement)))) return;

        this._clearHideTimeout();
        const intent = { anchor: anchorEl, options, generation: this.generation, timer: null };
        this.hoverIntent = intent;
        intent.timer = setTimeout(() => {
            if (this.hoverIntent !== intent) return;
            this._cancelHoverIntent();
            if (intent.generation !== this.generation || !anchorEl.isConnected || document.hidden ||
                !anchorEl.matches(':hover') || this._clickMode || this.imageState?.pending || this.quickFilterState?.pending ||
                this.card?.contains(document.activeElement) || this.currentAnchor?.contains(document.activeElement)) {
                this.hideSoon();
                return;
            }
            // show() is the only place that requests rich account metadata, so
            // a brief pass over a badge does not trigger another account lookup.
            this.show(anchorEl, intent.options);
        }, HOVER_INTENT_MS);
        // These listeners exist only while opening is pending, including when
        // there is no visible card yet. Escape never consumes X's own key event.
        document.addEventListener('keydown', this._handleHoverIntentCancel, true);
        document.addEventListener('pointerdown', this._handleHoverIntentCancel, true);
        document.addEventListener('visibilitychange', this._handleHoverIntentCancel);
        window.addEventListener('scroll', this._handleHoverIntentCancel, true);
        window.addEventListener('resize', this._handleHoverIntentCancel, true);
        window.addEventListener('blur', this._handleHoverIntentCancel);
    }

    _cancelHoverIntent(anchorEl = null) {
        const intent = this.hoverIntent;
        if (!intent || (anchorEl && intent.anchor !== anchorEl)) return;
        clearTimeout(intent.timer);
        this.hoverIntent = null;
        document.removeEventListener('keydown', this._handleHoverIntentCancel, true);
        document.removeEventListener('pointerdown', this._handleHoverIntentCancel, true);
        document.removeEventListener('visibilitychange', this._handleHoverIntentCancel);
        window.removeEventListener('scroll', this._handleHoverIntentCancel, true);
        window.removeEventListener('resize', this._handleHoverIntentCancel, true);
        window.removeEventListener('blur', this._handleHoverIntentCancel);
    }

    _handleHoverIntentCancel(event) {
        if (!this.hoverIntent) return;
        if (event?.type === 'keydown' && event.key !== 'Escape') return;
        if (event?.type === 'visibilitychange' && !document.hidden) return;
        this._cancelHoverIntent();
        if (this.card?.classList.contains('x-posed-hovercard-visible')) this.hideSoon();
    }

    _clearHideTimeout() {
        if (!this.hideTimeout) return;
        clearTimeout(this.hideTimeout);
        this.hideTimeout = null;
    }

    _knownBadgeInfo(info, getInfo) {
        try {
            const latest = getInfo?.();
            if (latest && typeof latest === 'object' && !Array.isArray(latest)) return mergeHovercardInfo(latest, info);
        } catch { /* A detached badge can still use its original snapshot. */ }
        return info || {};
    }

    _isFreshKnownInfo(known, cached, now = Date.now()) {
        if (!known.complete || known.observedAt === null) return false;
        if (now - known.observedAt < this.cacheTtlMs) return true;
        // A successful revalidation may return the original RAM observation.
        // Rate-limit repeated IPC, without making that observation younger or
        // extending its hard expiry. Partial/unknown data never gets a receipt.
        return Number.isFinite(cached?.checkedAt) && cached.checkedAt > 0 && cached.checkedAt <= now &&
            now - cached.checkedAt < this.cacheTtlMs && sameMetadataSnapshot(cached.data, known.info);
    }

    show(anchorEl, { screenName, displayName = '', displayNamePresentation = null, info, getInfo = null, csrfToken = null, clickToOpen = false }) {
        this._cancelHoverIntent();
        if (!anchorEl || !anchorEl.isConnected) return;

        // Click-opened cards must not close on mouseleave. The reader deliberately
        // opened this one and expects it to stay until they dismiss it.
        const useClick = TOUCH || clickToOpen;

        this._clearHideTimeout();

        if (this.currentAnchor === anchorEl && this.card?.classList.contains('x-posed-hovercard-visible') &&
            !useClick) return;
        this._disposeImageState();
        this._disposeQuickFilters();
        this.actionTooltip?.dispose();
        this.actionTooltip = null;
        this.currentAnchor?.querySelector('.x-badge-details')?.setAttribute('aria-expanded', 'false');
        this.currentAnchor = anchorEl;
        this._clickMode = useClick;
        anchorEl.querySelector('.x-badge-details')?.setAttribute('aria-expanded', 'true');
        this.currentScreenName = String(screenName || '').toLowerCase();
        const viewId = ++this.viewId;
        this.allowlistState = this._createAllowlistState(this.currentScreenName, viewId);
        this.imageState = this._createImageState(this.currentScreenName, viewId);
        // Seed the header from the name already visible on X. Keep this local to
        // the card view so enrichment cannot replace it with a handle or a stale
        // cached name, and never write observed DOM text into the account cache.
        const headerName = displayName;
        const presentation = resolveDisplayNamePresentation(displayNamePresentation);
        const key = this.currentScreenName;
        const cached = this.hoverCache.get(key);
        const known = selectKnownHovercardInfo(this._knownBadgeInfo(info, getInfo), cached);
        const fresh = this._isFreshKnownInfo(known, cached);
        this.quickFilterState = this._createQuickFilters(key, known.info, viewId);
        if (known.complete) {
            this.hoverCache.set(key, { data: known.info, fetchedAt: cached?.fetchedAt || Date.now(),
                checkedAt: sameMetadataSnapshot(cached?.data, known.info) ? cached?.checkedAt : undefined });
        }

        // Resolve the latest badge and warm cache synchronously, before the
        // first paint. Complete-but-soft-stale details refresh quietly below.
        this.card = buildCardContent({
            screenName, displayName: headerName, displayNamePresentation: presentation, info: known.info, loading: !known.complete,
            avatar: resolveCardAvatar({ anchor: anchorEl, screenName, info: known.info, profile: getProfile(screenName) }),
            allowlistControl: this.allowlistState?.element, allowlistStatus: this.allowlistState?.status, imageControl: this.imageState,
            quickFilterControl: this.quickFilterState, onClose: this._handleClose
        });
        this.card.classList.add('x-posed-hovercard-visible');
        this.actionTooltip = createCardTooltip(this.card);
        this.syncFilters();
        positionCard(this.card, anchorEl);
        if (this.allowlistState) this._loadAllowlist(this.allowlistState);

        // Keep the original short freshness window, measured from observation
        // rather than copying partial data into another cache. No pre-hover RPC.
        if (!fresh) {
            this._fetchAndUpdate(anchorEl, screenName, csrfToken, known.info, viewId, headerName, presentation, getInfo).catch(() => {});
        }
        syncBadgeInfo(screenName, known.info, info);

        // Keep visible if hovering card in hover mode.
        this.card.removeEventListener('mouseenter', this._handleCardEnter);
        this.card.removeEventListener('mouseleave', this._handleCardLeave);
        this.card.removeEventListener('focusin', this._handleCardEnter);
        this.card.removeEventListener('focusout', this._handleFocusOut);
        this.card.addEventListener('focusin', this._handleCardEnter);
        this.card.addEventListener('focusout', this._handleFocusOut);
        if (!useClick) {
            this.card.addEventListener('mouseenter', this._handleCardEnter);
            this.card.addEventListener('mouseleave', this._handleCardLeave);
        }

        // Reposition on scroll/resize while visible
        window.addEventListener('scroll', this._handleScroll, true);
        window.addEventListener('resize', this._handleScroll, true);
        document.addEventListener('keydown', this._handleKeyDown, true);

        // Outside presses dismiss both pinned and hover-opened cards, including
        // a hover card kept open while one of its controls has keyboard focus.
        document.addEventListener('pointerdown', this._handleOutsideTap, true);
    }

    hideSoon(delayMs = 120) {
        if (this.hoverIntent || this._clickMode || this.imageState?.pending || this.quickFilterState?.pending || this.card?.contains(document.activeElement) ||
            this.currentAnchor?.contains(document.activeElement)) return;
        if (this.hideTimeout) clearTimeout(this.hideTimeout);
        this.hideTimeout = setTimeout(() => this.hide(), delayMs);
    }

    hide() {
        this._cancelHoverIntent();
        this.actionTooltip?.dispose();
        this.actionTooltip = null;
        this._disposeImageState();
        this._disposeQuickFilters();
        this._clearHideTimeout();

        if (this._repositionRafId !== null) {
            cancelAnimationFrame(this._repositionRafId);
            this._repositionRafId = null;
        }

        if (this.card) {
            this.card.classList.remove('x-posed-hovercard-visible');
            this.card.replaceChildren();
        }

        this.currentAnchor?.querySelector('.x-badge-details')?.setAttribute('aria-expanded', 'false');
        this.currentAnchor = null;
        this._clickMode = false;
        this.currentScreenName = '';
        this.allowlistState = null;
        this.viewId++;
        window.removeEventListener('scroll', this._handleScroll, true);
        window.removeEventListener('resize', this._handleScroll, true);
        document.removeEventListener('pointerdown', this._handleOutsideTap, true);
        document.removeEventListener('keydown', this._handleKeyDown, true);
    }

    _handleClose() {
        const detailsButton = this.currentAnchor?.querySelector('.x-badge-details');
        const returnFocus = this.card?.contains(document.activeElement);
        this.hide();
        if (returnFocus && detailsButton?.isConnected) detailsButton.focus({ preventScroll: true });
    }

    /** Retain an open view when authoritative information rebuilds its badge. */
    replaceAnchor(previous, replacement, focusSelector = null) {
        this._cancelHoverIntent(previous);
        if (!previous || this.currentAnchor !== previous) return;
        const author = replacement?.closest('[data-x-screen-name]')?.dataset.xScreenName?.toLowerCase();
        if (!replacement?.isConnected || author !== this.currentScreenName) {
            this.hide();
            return;
        }
        previous.querySelector('.x-badge-details')?.setAttribute('aria-expanded', 'false');
        this.currentAnchor = replacement;
        replacement.querySelector('.x-badge-details')?.setAttribute('aria-expanded', 'true');
        this._clearHideTimeout();
        if (focusSelector) replacement.querySelector(focusSelector)?.focus({ preventScroll: true });
        positionCard(this.card, replacement);
    }

    _handleKeyDown(event) {
        if (event.key !== 'Escape' || !this.card?.classList.contains('x-posed-hovercard-visible')) return;
        if (this.actionTooltip?.dismiss()) {
            if (this.card.contains(document.activeElement) || this.currentAnchor?.contains(document.activeElement)) {
                event.preventDefault();
                event.stopPropagation();
            }
            return;
        }
        if (this.card.querySelector('.x-posed-warning-why[aria-expanded="true"]')) {
            setLocationWarningHelp(this.card, false);
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        // A pointer-opened card must not consume Escape intended for an X
        // input or another dialog. Keyboard interaction inside our own card or
        // badge still closes it and restores focus without dismissing X too.
        if (this.card.contains(document.activeElement) || this.currentAnchor?.contains(document.activeElement)) {
            event.preventDefault();
            event.stopPropagation();
        }
        this._handleClose();
    }

    _handleCardEnter() {
        this._cancelHoverIntent();
        this._clearHideTimeout();
    }

    _handleCardLeave() {
        this.hideSoon(120);
    }

    _handleFocusOut() {
        // A disappearing metadata row or a new account view can move focus.
        // Let that update finish before deciding the reader left the card.
        const generation = this.generation;
        const viewId = this.viewId;
        queueMicrotask(() => {
            if (this.generation !== generation || this.viewId !== viewId) return;
            if (!this.card?.classList.contains('x-posed-hovercard-visible')) return;
            if (!this.card.contains(document.activeElement) &&
                !this.currentAnchor?.contains(document.activeElement)) this.hideSoon();
        });
    }

    _handleOutsideTap(e) {
        if (!this.card) return;
        const t = e.target;
        if (this.card.contains(t)) {
            if (!t.closest('.x-posed-warning-why, .x-posed-warning-help')) setLocationWarningHelp(this.card, false);
            return;
        }
        if (this.currentAnchor && this.currentAnchor.contains(t)) return;
        this.hide();
    }

    _isCurrentView(anchorEl, screenName, viewId) {
        return this.viewId === viewId && this.currentAnchor === anchorEl &&
            this.currentScreenName === String(screenName || '').toLowerCase() &&
            anchorEl?.isConnected && this.card?.classList.contains('x-posed-hovercard-visible');
    }

    _isCurrentAllowlist(state) {
        return state.generation === this.generation && this.allowlistState === state &&
            this._isCurrentView(this.currentAnchor, state.handle, state.viewId) &&
            this.card.contains(state.element);
    }

    _isCurrentImageState(state) {
        return this.imageState === state && state.generation === this.generation &&
            this._isCurrentView(this.currentAnchor, state.handle, state.viewId) &&
            this.card.contains(state.element);
    }

    _createImageState(handle, viewId) {
        const element = createEl('div', 'x-posed-export-actions x-posed-footer-section');
        element.setAttribute('role', 'group');
        const heading = createEl('div', 'x-posed-footer-section-heading', 'Card');
        heading.id = 'x-posed-card-image-heading';
        element.setAttribute('aria-labelledby', heading.id);
        const controls = createEl('div', 'x-posed-footer-section-controls');
        element.append(heading, controls);
        const status = createEl('div', 'x-posed-export-status');
        status.setAttribute('role', 'status');
        status.setAttribute('aria-live', 'polite');
        status.hidden = true;
        const state = { handle, viewId, generation: this.generation, element, status,
            buttons: [], pending: false, controller: null, resetTimer: null, success: '', message: '', error: false };
        for (const action of ['copy', 'save']) {
            const button = createEl('button', 'x-posed-export-button x-posed-card-action');
            button.type = 'button';
            button.dataset.action = action;
            const icon = createEl('span', 'x-posed-card-action-icon');
            icon.setAttribute('aria-hidden', 'true');
            button.append(icon, createEl('span', 'x-posed-card-action-label', action === 'copy' ? 'Copy' : 'Save'));
            button.addEventListener('click', event => {
                event.preventDefault();
                event.stopPropagation();
                this._exportImage(state, action);
            });
            state.buttons.push(button);
            controls.appendChild(button);
        }
        this._renderImageState(state);
        return state;
    }

    _renderImageState(state) {
        for (const button of state.buttons) {
            const action = button.dataset.action;
            const success = state.success === action;
            const label = action === 'copy' ? 'Copy card as an image' : 'Save card as an image';
            button.setAttribute('aria-label', label);
            button.removeAttribute('title');
            button.dataset.xTooltipHeading = success ? (action === 'copy' ? 'Card copied' : 'Download started')
                : action === 'copy' ? 'Copy account card' : 'Save account card';
            button.dataset.xTooltipDescription = action === 'copy'
                ? 'Copies this card as an image. Paste it into a message, post or document.'
                : 'Downloads this card as an image so you can keep it or share it later.';
            // Keep keyboard focus while busy. The handler guards repeat activation.
            button.setAttribute('aria-disabled', String(state.pending));
            button.setAttribute('aria-busy', String(state.pending));
            button.classList.toggle('x-posed-export-button--success', success);
            button.querySelector('.x-posed-card-action-icon').replaceChildren(
                dialogIcon(success ? 'check' : action === 'copy' ? 'copy' : 'download', 18));
        }
        state.status.textContent = state.message;
        state.status.hidden = !state.message;
        state.status.classList.toggle('x-posed-export-status--error', state.error);
        if (this._isCurrentImageState(state)) positionCard(this.card, this.currentAnchor);
    }

    _exportImage(state, action) {
        if (!this._isCurrentImageState(state) || state.pending) return;
        if (state.resetTimer) clearTimeout(state.resetTimer);
        state.resetTimer = null;
        state.success = '';
        state.error = false;
        if (action === 'copy' && (!navigator.clipboard?.write || !window.ClipboardItem)) {
            state.error = true;
            state.message = 'Image copying is unavailable here. Use Save instead.';
            this._renderImageState(state);
            return;
        }
        const controller = new AbortController();
        state.controller = controller;
        state.pending = true;
        state.message = 'Creating card image…';
        let png;
        let transfer;
        try {
            // Snapshot immediately and initiate write in this click handler. Passing
            // the PNG promise preserves activation while artwork is rasterized.
            png = createHovercardPng(this.card, { signal: controller.signal }).then(blob => {
                // Check again at Blob delivery, not just at snapshot time. A
                // closed/replaced card must not finish a pending clipboard job.
                if (!this._isCurrentImageState(state) || controller.signal.aborted) {
                    throw new DOMException('Account card image was cancelled.', 'AbortError');
                }
                return blob;
            });
            transfer = action === 'copy'
                ? navigator.clipboard.write([new window.ClipboardItem({ 'image/png': png })])
                : png.then(blob => {
                    if (!this._isCurrentImageState(state) || controller.signal.aborted) return;
                    const url = URL.createObjectURL(blob);
                    const link = document.createElement('a');
                    link.href = url;
                    link.download = `x-posed-${state.handle.replace(/[^a-z0-9_]/g, '') || 'account'}-card.png`;
                    document.body.appendChild(link);
                    try { link.click(); }
                    finally {
                        link.remove();
                        // Give the browser time to start its download before revoking.
                        setTimeout(() => URL.revokeObjectURL(url), 1000);
                    }
                });
        } catch (error) {
            transfer = Promise.reject(error);
            png ||= Promise.resolve();
        }
        this._renderImageState(state);
        Promise.all([png, transfer]).then(() => {
            if (!this._isCurrentImageState(state) || controller.signal.aborted) return;
            state.success = action;
            state.message = action === 'copy' ? 'Card copied. Paste it wherever images are supported.' : 'Card download started.';
            state.resetTimer = setTimeout(() => {
                if (!this._isCurrentImageState(state)) return;
                state.resetTimer = null;
                state.success = '';
                state.message = '';
                this._renderImageState(state);
            }, 3500);
        }).catch(error => {
            controller.abort();
            if (!this._isCurrentImageState(state) || error?.name === 'AbortError') return;
            state.error = true;
            state.message = action === 'copy'
                ? 'Couldn’t copy the image. Use Save, or try copying again.'
                : 'Couldn’t create the image. Please try again.';
        }).finally(() => {
            if (!this._isCurrentImageState(state)) return;
            state.pending = false;
            state.controller = null;
            this._renderImageState(state);
        });
    }

    _disposeImageState() {
        const state = this.imageState;
        this.imageState = null;
        if (!state) return;
        state.controller?.abort();
        if (state.resetTimer) clearTimeout(state.resetTimer);
    }

    _createAllowlistState(handle, viewId) {
        if (!/^[a-z0-9_]{1,15}$/.test(handle)) return null;
        const element = createEl('div', 'x-posed-allowlist-control');
        const button = createEl('button', 'x-posed-allowlist-button');
        button.type = 'button';
        const status = createEl('div', 'x-posed-allowlist-status');
        status.setAttribute('aria-live', 'polite');
        element.appendChild(button);
        const state = { handle, viewId, generation: this.generation, element, button, status,
            allowed: null, pending: true, error: '', message: '' };
        this._renderAllowlist(state);
        button.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            if (!this._isCurrentAllowlist(state) || state.pending) return;
            if (state.allowed === null) this._loadAllowlist(state);
            else this._setAllowedUser(state);
        });
        return state;
    }

    _renderAllowlist(state) {
        const { button, status, handle, allowed, pending } = state;
        // Keep a focused header action in the tab order while its write settles.
        // The click handler already guards pending operations.
        button.setAttribute('aria-disabled', String(pending));
        button.setAttribute('aria-busy', String(pending));
        button.setAttribute('aria-pressed', String(allowed === true));
        const action = pending && allowed !== null ? 'Saving Always Show'
            : state.error && allowed === null ? 'Retry Always Show'
                : allowed ? 'Remove Always Show' : 'Always show';
        button.replaceChildren(dialogIcon('shield', 16));
        button.setAttribute('aria-label', `Always show @${handle}. ${action}${pending ? '…' : '.'}`);
        button.removeAttribute('title');
        button.dataset.xTooltipHeading = allowed ? 'Let filters apply again' : 'Always show this account';
        button.dataset.xTooltipDescription = allowed
            ? `Removes the exception for @${handle}. Your saved filters can match this account again.`
            : `Keeps @${handle} visible, even when the account matches one of your filters.`;
        if (state.error && allowed === null) {
            button.dataset.xTooltipHeading = 'Couldn’t check Always Show';
            button.dataset.xTooltipDescription = 'Select this button to try again.';
        }
        status.textContent = state.error || state.message || (pending && allowed === null ? 'Checking Always Show…' : '');
        status.hidden = !status.textContent;
        status.setAttribute('role', state.error ? 'alert' : 'status');
        status.classList.toggle('x-posed-allowlist-error', !!state.error);
        if (this._isCurrentAllowlist(state)) this.syncFilters();
        if (this._isCurrentAllowlist(state)) positionCard(this.card, this.currentAnchor);
    }

    async _loadAllowlist(state) {
        if (!this._isCurrentAllowlist(state)) return;
        state.pending = true;
        state.error = '';
        state.message = '';
        this._renderAllowlist(state);
        try {
            // Reopening this account while its previous card is still saving must
            // read membership after that write, otherwise the new card sees old state.
            const pendingWrite = this.allowlistWrites.get(state.handle);
            if (pendingWrite) {
                try { await pendingWrite; } catch { /* Read the actual state after a failed write too. */ }
                if (!this._isCurrentAllowlist(state)) return;
            }
            const response = await browserAPI.runtime.sendMessage({ type: MESSAGE_TYPES.GET_ALLOWED_USERS });
            if (!this._isCurrentAllowlist(state)) return;
            if (!response?.success || !Array.isArray(response.data)) throw new Error('Allowlist unavailable');
            state.allowed = response.data.some(handle => typeof handle === 'string' && handle.toLowerCase() === state.handle);
        } catch {
            if (!this._isCurrentAllowlist(state)) return;
            state.error = 'Couldn’t load Always Show. Try again.';
        } finally {
            if (this._isCurrentAllowlist(state)) {
                state.pending = false;
                this._renderAllowlist(state);
            }
        }
    }

    async _setAllowedUser(state) {
        if (!this._isCurrentAllowlist(state) || state.pending || state.allowed === null) return;
        const shouldAllow = !state.allowed;
        state.pending = true;
        state.error = '';
        state.message = '';
        this._renderAllowlist(state);
        try {
            // Send an explicit operation for the captured handle. Never replace the list:
            // another tab may have edited it since this card's initial membership check.
            const write = browserAPI.runtime.sendMessage({
                type: MESSAGE_TYPES.SET_ALLOWED_USERS,
                payload: { action: shouldAllow ? 'add' : 'remove', username: state.handle }
            });
            this.allowlistWrites.set(state.handle, write);
            const response = await write.finally(() => {
                if (state.generation === this.generation && this.allowlistWrites.get(state.handle) === write) {
                    this.allowlistWrites.delete(state.handle);
                }
            });
            if (!this._isCurrentAllowlist(state)) return;
            if (!response?.success || !Array.isArray(response.data)) throw new Error('Allowlist update failed');
            const confirmed = response.data.some(handle => typeof handle === 'string' && handle.toLowerCase() === state.handle);
            if (confirmed !== shouldAllow) throw new Error('Allowlist update not confirmed');
            state.allowed = confirmed;
            state.message = confirmed ? `Always showing @${state.handle}.` : `Filters apply to @${state.handle} again.`;
        } catch {
            if (!this._isCurrentAllowlist(state)) return;
            state.error = 'Couldn’t update Always Show. Try again.';
        } finally {
            if (this._isCurrentAllowlist(state)) {
                state.pending = false;
                this._renderAllowlist(state);
            }
        }
    }

    async _fetchAndUpdate(anchorEl, screenName, csrfToken, initialInfo = {}, viewId = this.viewId, displayName = '', displayNamePresentation = null, getInfo = null) {
        const generation = this.generation;
        const key = String(screenName || '').toLowerCase();
        if (!key) return;
        const fallbackName = initialInfo?.meta?.name || '';

        if (!this.inFlight.has(key)) {
            const p = browserAPI.runtime
                .sendMessage({
                    type: MESSAGE_TYPES.FETCH_HOVERCARD_INFO,
                    payload: { screenName, csrfToken }
                })
                .catch(() => ({ success: false, error: 'Couldn’t load account details. Try opening them again.' }))
                .finally(() => {
                    if (this.generation === generation && this.inFlight.get(key) === p) this.inFlight.delete(key);
                });
            this.inFlight.set(key, p);
        }

        const response = await this.inFlight.get(key);
        // Requests cannot be cancelled through runtime messaging. Ignore every
        // local effect when a pagehide/teardown has ended their owning session.
        if (this.generation !== generation) return;
        const known = selectKnownHovercardInfo(this._knownBadgeInfo(initialInfo, getInfo), this.hoverCache.get(key));

        if (!response?.success || !response.data) {
            const msg = describeHovercardError(response);
            if (this._isCurrentView(anchorEl, screenName, viewId)) {
                this.card = buildCardContent({
                    screenName, displayName, displayNamePresentation, info: known.info, loading: false,
                    avatar: resolveCardAvatar({ anchor: anchorEl, screenName, info: known.info, profile: getProfile(screenName) }),
                    errorText: known.complete ? '' : msg, onClose: this._handleClose, update: true
                });
                this.card.classList.add('x-posed-hovercard-visible');
                this.quickFilterState?.updateInfo(known.info);
                positionCard(this.card, anchorEl);
            }
            return;
        }

        const selected = selectKnownHovercardInfo(mergeHovercardInfo(response.data, known.info), null);
        const fresh = selected.info;
        this.hoverCache.set(key, { data: fresh, fetchedAt: Date.now(),
            checkedAt: hasUsableMetadata(response.data) && selected.complete && sameMetadataSnapshot(response.data, fresh)
                ? Date.now() : undefined });

        // Issue #23: the badge may have rendered from a stale cloud-cache snapshot (cloud
        // entries carry no `meta`, so this hover forced a live, authoritative fetch). If the
        // live location/device or accuracy disagree with what the badge was given, tell the content
        // layer to retain both signals AND rich metadata for other visible badges.
        // Metadata-only enrichment updates their snapshots without replacing DOM.
        syncBadgeInfo(screenName, fresh, known.info);

        if (this._isCurrentView(anchorEl, screenName, viewId)) {
            this.card = buildCardContent({
                screenName, displayName, displayNamePresentation, fallbackName, info: fresh, loading: false,
                avatar: resolveCardAvatar({ anchor: anchorEl, screenName, info: fresh, profile: getProfile(screenName) }),
                onClose: this._handleClose, update: true
            });
            this.card.classList.add('x-posed-hovercard-visible');
            this.quickFilterState?.updateInfo(fresh);
            positionCard(this.card, anchorEl);
        }
    }

    _handleScroll(event) {
        if (event?.target?.closest?.('.x-posed-warning-help')) return;
        setLocationWarningHelp(this.card, false);
        // Coalesce bursts of capture-phase scroll/resize events into one rAF so
        // we don't call getBoundingClientRect()/reposition on every tick.
        if (this._repositionRafId !== null) return;
        this._repositionRafId = requestAnimationFrame(() => {
            this._repositionRafId = null;
            if (!this.card || !this.currentAnchor || !this.currentAnchor.isConnected) {
                this.hide();
                return;
            }
            positionCard(this.card, this.currentAnchor);
        });
    }

    /**
     * Tear down all listeners, timers, pending rAF and cached state. Idempotent.
     * Registered with the content-script cleanup so SPA navigations/unloads
     * don't leak the hovercard's global scroll/resize listeners or its cache.
     */
    teardown() {
        this.generation++;
        this.hide();
        this.hoverCache.clear();
        this.inFlight.clear();
        this.allowlistWrites.clear();
        this.quickFilterWrites.clear();
        this.filterContext = null;

        const card = document.getElementById(CARD_ID);
        if (card) card.remove();
        this.card = null;
    }
}

export const hovercard = new HovercardController();
