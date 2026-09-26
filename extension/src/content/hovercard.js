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
import { MESSAGE_TYPES, Z_INDEX } from '../shared/constants.js';
import { LRUCache } from '../shared/lru-cache.js';
import { deviceIcon, flagImage } from './icons.js';
import { dialogIcon } from './dialog-icons.js';
import { getProfile } from './profile-cache.js';

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

function createTag({ label, tone = 'neutral', title = '' }) {
    const tag = createEl('span', `x-posed-tag x-posed-tag-${tone}`);
    if (title) tag.title = safeText(title, 200);
    tag.append(dialogIcon(tone === 'neutral' ? 'shield' : 'verified', 13), document.createTextNode(safeText(label, 24)));
    return tag;
}

function createRow({ icon, label, value, primary = false }) {
    let cls = 'x-posed-row';
    if (primary) cls += ' x-posed-row--primary';
    const row = createEl('div', cls);

    const left = createEl('div', 'x-posed-row-left');
    if (icon) {
        const iconEl = createEl('span', 'x-posed-row-icon');
        if (icon instanceof Node) iconEl.appendChild(icon);
        else iconEl.textContent = icon;
        left.appendChild(iconEl);
    }
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

    let left = rect.right + margin;
    let top = rect.top - 6;

    // Prefer flipping to the left of the badge if it would overflow the right edge.
    if (left + cardRect.width > window.innerWidth - margin) {
        left = rect.left - cardRect.width - margin;
    }

    // No horizontal room either side: drop below the badge.
    if (left < margin) {
        top = rect.bottom + margin;
    }

    // Clamp horizontally so the card is always fully on-screen (both edges).
    left = Math.min(left, window.innerWidth - cardRect.width - margin);
    left = Math.max(margin, left);

    // Flip above the badge if it would overflow the bottom edge, then clamp.
    if (top + cardRect.height > window.innerHeight - margin) {
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

function buildCardContent({ screenName, displayName = '', fallbackName = '', info, loading = false, errorText = '', allowlistControl = null, onClose }) {
    const card = ensureCard();
    const focusedElement = card.contains(document.activeElement) ? document.activeElement : null;
    const focusedClose = focusedElement?.classList.contains('x-posed-card-close');
    const focusedLink = focusedElement?.classList.contains('x-posed-link');
    const focusedBody = focusedElement?.classList.contains('x-posed-card-body');
    const accountKey = String(screenName || '').toLowerCase();
    const scrollTop = card.dataset.xScreenName === accountKey
        ? card.querySelector('.x-posed-card-body')?.scrollTop || 0 : 0;
    card.dataset.xScreenName = accountKey;
    card.replaceChildren();
    card.setAttribute('aria-label', `Account details for @${safeText(screenName, 20)}`);

    const meta = info?.meta || {};

    // Header
    const header = createEl('div', 'x-posed-card-header');

    // The cached profile image can be stale or blurry. Lead with the name and
    // account signals without adding another image request.
    const titleWrap = createEl('div', 'x-posed-title');
    const nameLine = createEl('div', 'x-posed-name-line');
    const name = safeText(displayName || meta.name || fallbackName || screenName, 60);
    const nameEl = createEl('span', 'x-posed-name', name);
    const handleEl = createEl('span', 'x-posed-handle', `@${safeText(screenName, 20)}`);
    nameLine.appendChild(nameEl);

    // Tags
    const tags = createEl('div', 'x-posed-tags');

    if (meta.blueVerified) {
        tags.appendChild(createTag({ label: 'Blue verification', tone: 'blue', title: 'X Premium / Blue verified' }));
    }
    if (meta.verified) {
        tags.appendChild(createTag({ label: 'Legacy verified', tone: 'gold', title: 'Legacy verified' }));
    }
    if (meta.identityVerified) {
        tags.appendChild(createTag({ label: 'Identity verified', tone: 'green', title: 'Identity verified' }));
    }
    if (meta.protected) {
        tags.appendChild(createTag({ label: 'Protected', tone: 'neutral', title: 'Protected account' }));
    }

    const aff = meta.affiliate;

    titleWrap.appendChild(nameLine);
    titleWrap.appendChild(handleEl);
    if (tags.childNodes.length > 0) titleWrap.appendChild(tags);

    header.appendChild(titleWrap);
    const closeButton = createEl('button', 'x-posed-card-close');
    closeButton.type = 'button';
    closeButton.setAttribute('aria-label', 'Close account details');
    closeButton.title = 'Close account details';
    closeButton.appendChild(dialogIcon('close', 16));
    closeButton.addEventListener('click', onClose);
    header.appendChild(closeButton);

    // Body
    const body = createEl('div', 'x-posed-card-body');
    body.tabIndex = 0;
    body.setAttribute('role', 'region');
    body.setAttribute('aria-label', 'Account information');

    // Keep known location and connection details visible even when richer
    // account metadata is unavailable.
    const signals = createEl('div', 'x-posed-card-signals');
    if (info?.location) {
        const locVal = createEl('span', 'x-posed-loc');
        const fimg = flagImage(info.location);
        if (fimg) locVal.appendChild(fimg);
        locVal.appendChild(document.createTextNode(safeText(info.location, 80)));
        signals.appendChild(createRow({ icon: dialogIcon('globe', 14), label: 'Location', value: locVal, primary: true }));
    }

    if (info?.device) {
        signals.appendChild(createRow({ icon: deviceIcon(info.device, 14), label: 'Connected via', value: safeText(info.device, 80), primary: true }));
    }
    if (signals.childNodes.length) body.appendChild(signals);

    if (info?.locationAccurate === false) {
        const warning = createEl('div', 'x-posed-card-warning');
        warning.title = 'X reports that this account’s location may not be accurate.';
        const copy = createEl('span', 'x-posed-warning-copy', 'Location may be inaccurate.');
        copy.setAttribute('aria-hidden', 'true');
        warning.append(dialogIcon('warn', 15), copy,
            createEl('span', 'x-posed-sr-only', warning.title));
        body.appendChild(warning);
    }

    // Follower / following / post counts, harvested from the profile data X already ships
    // with its own timeline responses. No lookup was spent to show these, and they are
    // simply absent for an account we have not seen in a response yet.
    const profile = getProfile(screenName);
    if (profile) {
        const stats = createEl('div', 'x-posed-card-stats');
        const values = [
            { label: 'Followers', value: profile.followers },
            { label: 'Following', value: profile.following },
            { label: 'Posts', value: profile.tweets }
        ];
        for (const { label, value } of values) {
            const exactCount = formatCount(value);
            if (exactCount === null) continue;
            const stat = createEl('div', 'x-posed-stat');
            stat.title = `${exactCount} ${label}`;
            stat.setAttribute('role', 'group');
            stat.setAttribute('aria-label', stat.title);
            const number = createEl('span', 'x-posed-stat-value', formatCompactCount(value));
            number.title = exactCount;
            number.setAttribute('aria-label', exactCount);
            stat.append(number, createEl('span', 'x-posed-stat-label', label));
            stats.appendChild(stat);
        }
        if (stats.childNodes.length) body.appendChild(stats);
    }

    const metadata = createEl('div', 'x-posed-card-metadata');
    const media = formatCount(profile?.media);
    if (media !== null) {
        metadata.appendChild(createRow({ label: 'Media', value: media }));
    }
    const createdAt = parseCreatedAt(meta.createdAt);
    const ageYears = yearsSince(createdAt);
    if (createdAt) {
        const ageSuffix = typeof ageYears === 'number' ? ` (${ageYears}y)` : '';
        metadata.appendChild(createRow({ label: 'Created', value: `${formatShortDate(createdAt)}${ageSuffix}` }));
    }

    // Verified since
    if (typeof meta.verifiedSinceMsec === 'number' && meta.verifiedSinceMsec > 0) {
        const d = new Date(meta.verifiedSinceMsec);
        if (!Number.isNaN(d.getTime())) {
            metadata.appendChild(createRow({ label: 'Verified since', value: formatShortDate(d) }));
        }
    }

    if (typeof meta.usernameChanges === 'number') {
        metadata.appendChild(createRow({ label: 'Handle changes', value: String(meta.usernameChanges) }));
    }

    // X internal stable user identifier (useful for tracking across handle changes)
    if (meta.restId) {
        metadata.appendChild(createRow({ label: 'User ID', value: safeText(meta.restId, 40) }));
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
    if (metadata.childNodes.length) body.appendChild(metadata);

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

    card.appendChild(header);
    card.appendChild(body);
    if (allowlistControl) card.appendChild(allowlistControl);
    body.scrollTop = scrollTop;
    // Refreshing metadata must not drop keyboard focus while someone is reading
    // the card or using its account exception control.
    if (focusedElement?.isConnected) focusedElement.focus({ preventScroll: true });
    else if (focusedClose) closeButton.focus({ preventScroll: true });
    else if (focusedBody) body.focus({ preventScroll: true });
    else if (focusedLink) (card.querySelector('.x-posed-link') || closeButton).focus({ preventScroll: true });
    return card;
}

// Touch / no-hover devices (e.g. Firefox for Android) have no mouseenter/mouseleave,
// so the dossier opens on tap instead of hover (see attach()).
const TOUCH = !(typeof window !== 'undefined' && window.matchMedia &&
    window.matchMedia('(hover: hover)').matches);

class HovercardController {
    constructor() {
        this.card = null;
        this.hideTimeout = null;
        this.currentAnchor = null;
        this.currentScreenName = '';
        this.viewId = 0;
        this.generation = 0;
        this.allowlistState = null;
        this.allowlistWrites = new Map();
        this._clickMode = false;

        // Per-session cache to avoid repeated API hits while you hover around.
        // Bounded LRU so a long browsing session can't grow it without limit
        // (entries are also TTL-checked on read). screenName -> { data, fetchedAt }
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
    }

    /**
     * @param {HTMLElement} badgeEl
     * @param {object} opts
     * @param {boolean} [opts.clickToOpen] - open on click instead of hover (issue #38).
     *   Touch devices always use click regardless, since they have no hover at all.
     */
    attach(badgeEl, { screenName, displayName = '', info, csrfToken = null, clickToOpen = false }) {
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
            if (e.target.closest('.x-capture-btn')) return;
            e.preventDefault();
            e.stopPropagation();
            const open = this.currentAnchor === badgeEl &&
                this.card?.classList.contains('x-posed-hovercard-visible');
            if (open && this._clickMode) this.hide();
            else {
                this.show(badgeEl, { screenName, displayName, info, csrfToken, clickToOpen: true });
                if (e.detail === 0) this.card?.querySelector('.x-posed-card-close')?.focus({ preventScroll: true });
            }
        });
        if (!useClick) {
            const onEnter = () => {
                if (this._clickMode && this.card?.classList.contains('x-posed-hovercard-visible')) return;
                this.show(badgeEl, { screenName, displayName, info, csrfToken });
            };
            const onLeave = () => this.hideSoon();
            badgeEl.addEventListener('mouseenter', onEnter);
            badgeEl.addEventListener('mouseleave', onLeave);
        }
        badgeEl.addEventListener('focusin', this._handleCardEnter);
        badgeEl.addEventListener('focusout', this._handleFocusOut);

        // Mark for cleanup by content-script cleanup routines.
        badgeEl.classList.add('x-posed-has-hovercard');
    }

    show(anchorEl, { screenName, displayName = '', info, csrfToken = null, clickToOpen = false }) {
        if (!anchorEl || !anchorEl.isConnected) return;

        // Click-opened cards must not close on mouseleave. The reader deliberately
        // opened this one and expects it to stay until they dismiss it.
        const useClick = TOUCH || clickToOpen;

        if (this.hideTimeout) {
            clearTimeout(this.hideTimeout);
            this.hideTimeout = null;
        }

        if (this.currentAnchor === anchorEl && this.card?.classList.contains('x-posed-hovercard-visible') &&
            !useClick) return;
        this.currentAnchor?.querySelector('.x-badge-details')?.setAttribute('aria-expanded', 'false');
        this.currentAnchor = anchorEl;
        this._clickMode = useClick;
        anchorEl.querySelector('.x-badge-details')?.setAttribute('aria-expanded', 'true');
        this.currentScreenName = String(screenName || '').toLowerCase();
        const viewId = ++this.viewId;
        this.allowlistState = this._createAllowlistState(this.currentScreenName, viewId);
        // Seed the header from the name already visible on X. Keep this local to
        // the card view so enrichment cannot replace it with a handle or a stale
        // cached name, and never write observed DOM text into the account cache.
        const headerName = safeText(displayName, 60);

        // Show immediate card (using whatever we currently know)
        this.card = buildCardContent({
            screenName, displayName: headerName, info, loading: true,
            allowlistControl: this.allowlistState?.element, onClose: this._handleClose
        });
        this.card.classList.add('x-posed-hovercard-visible');
        positionCard(this.card, anchorEl);
        if (this.allowlistState) this._loadAllowlist(this.allowlistState);

        // Request rich metadata only when the card opens, with short TTL caching.
        // Pass the badge's known info so an error card can still show it (issue #14).
        this._fetchAndUpdate(anchorEl, screenName, csrfToken, info, viewId, headerName).catch(() => {});

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
        if (this._clickMode || this.card?.contains(document.activeElement) ||
            this.currentAnchor?.contains(document.activeElement)) return;
        if (this.hideTimeout) clearTimeout(this.hideTimeout);
        this.hideTimeout = setTimeout(() => this.hide(), delayMs);
    }

    hide() {
        if (this.hideTimeout) {
            clearTimeout(this.hideTimeout);
            this.hideTimeout = null;
        }

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

    _handleKeyDown(event) {
        if (event.key !== 'Escape' || !this.card?.classList.contains('x-posed-hovercard-visible')) return;
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
        if (this.hideTimeout) {
            clearTimeout(this.hideTimeout);
            this.hideTimeout = null;
        }
    }

    _handleCardLeave() {
        this.hideSoon(120);
    }

    _handleFocusOut() {
        // Metadata refreshes temporarily detach focused controls. Let the
        // rebuild restore focus before deciding that the reader left the card.
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
        if (this.card.contains(t)) return;
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

    _createAllowlistState(handle, viewId) {
        if (!/^[a-z0-9_]{1,15}$/.test(handle)) return null;
        const element = createEl('div', 'x-posed-card-actions');
        const button = createEl('button', 'x-blocker-btn x-blocker-btn-secondary x-posed-allowlist-button');
        button.type = 'button';
        const status = createEl('div', 'x-posed-allowlist-status');
        status.setAttribute('aria-live', 'polite');
        element.append(button, status);
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
        button.disabled = pending;
        button.setAttribute('aria-busy', String(pending));
        button.setAttribute('aria-pressed', String(allowed === true));
        const label = pending && allowed !== null ? 'Saving…'
            : state.error && allowed === null ? 'Retry Always Show'
                : allowed ? `Stop always showing @${handle}` : `Always show @${handle}`;
        button.replaceChildren(dialogIcon('shield', 15), createEl('span', null, label));
        button.title = allowed ? 'Apply your filters to this account again.' : 'Exempt this account from your filters.';
        status.textContent = state.error || state.message || (pending && allowed === null ? 'Checking Always Show…' : '');
        status.hidden = !status.textContent;
        status.setAttribute('role', state.error ? 'alert' : 'status');
        status.classList.toggle('x-posed-allowlist-error', !!state.error);
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

    async _fetchAndUpdate(anchorEl, screenName, csrfToken, initialInfo = {}, viewId = this.viewId, displayName = '') {
        const generation = this.generation;
        const key = String(screenName || '').toLowerCase();
        if (!key) return;
        const fallbackName = safeText(initialInfo?.meta?.name, 60);

        const cached = this.hoverCache.get(key);
        if (cached && Date.now() - cached.fetchedAt < this.cacheTtlMs) {
            if (this._isCurrentView(anchorEl, screenName, viewId)) {
                this.card = buildCardContent({
                    screenName, displayName, fallbackName, info: cached.data, loading: false,
                    allowlistControl: this.allowlistState?.element,
                    onClose: this._handleClose
                });
                this.card.classList.add('x-posed-hovercard-visible');
                positionCard(this.card, anchorEl);
            }
            return;
        }

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

        if (!response?.success || !response.data) {
            const msg = describeHovercardError(response);
            if (this._isCurrentView(anchorEl, screenName, viewId)) {
                this.card = buildCardContent({
                    screenName, displayName, info: initialInfo, loading: false, errorText: msg,
                    allowlistControl: this.allowlistState?.element,
                    onClose: this._handleClose
                });
                this.card.classList.add('x-posed-hovercard-visible');
                positionCard(this.card, anchorEl);
            }
            return;
        }

        this.hoverCache.set(key, { data: response.data, fetchedAt: Date.now() });

        // Issue #23: the badge may have rendered from a stale cloud-cache snapshot (cloud
        // entries carry no `meta`, so this hover forced a live, authoritative fetch). If the
        // live location/device disagree with what the badge was given, tell the content
        // layer to refresh the cached entry and re-render the badge, so the flag next to the
        // name matches this card. Gated on an actual difference to avoid needless churn.
        const fresh = response.data;
        if (fresh && (fresh.location !== initialInfo?.location || fresh.device !== initialInfo?.device)) {
            try {
                document.dispatchEvent(new CustomEvent('xposed:authoritative-info', {
                    detail: { screenName, info: fresh }
                }));
            } catch { /* CustomEvent unsupported — non-fatal */ }
        }

        if (this._isCurrentView(anchorEl, screenName, viewId)) {
            this.card = buildCardContent({
                screenName, displayName, fallbackName, info: response.data, loading: false,
                allowlistControl: this.allowlistState?.element,
                onClose: this._handleClose
            });
            this.card.classList.add('x-posed-hovercard-visible');
            positionCard(this.card, anchorEl);
        }
    }

    _handleScroll() {
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

        const card = document.getElementById(CARD_ID);
        if (card) card.remove();
        this.card = null;
    }
}

export const hovercard = new HovercardController();
