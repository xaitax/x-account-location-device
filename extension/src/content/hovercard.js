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
import { CSS_CLASSES, MESSAGE_TYPES, Z_INDEX } from '../shared/constants.js';

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
    tag.textContent = safeText(label, 24);
    return tag;
}

function createRow({ icon, label, value }) {
    const row = createEl('div', 'x-posed-row');

    const left = createEl('div', 'x-posed-row-left');
    const iconEl = createEl('span', 'x-posed-row-icon', icon);
    const labelEl = createEl('span', 'x-posed-row-label', label);
    left.appendChild(iconEl);
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
    card.style.zIndex = String((Z_INDEX?.TOAST || 1000001) + 5);

    // Prevent the card from interfering with tweet clicks.
    card.addEventListener('click', e => {
        e.stopPropagation();
    });

    document.body.appendChild(card);
    return card;
}

function positionCard(card, anchorEl) {
    const rect = anchorEl.getBoundingClientRect();

    // Desired placement: right of badge if possible; otherwise above/below.
    const margin = 10;
    const maxWidth = Math.min(340, window.innerWidth - margin * 2);

    // Temporarily show to measure.
    card.style.left = '0px';
    card.style.top = '0px';
    card.style.maxWidth = `${maxWidth}px`;

    const cardRect = card.getBoundingClientRect();

    let left = rect.right + margin;
    let top = rect.top - 6;

    // Clamp into viewport.
    if (left + cardRect.width > window.innerWidth - margin) {
        left = rect.left - cardRect.width - margin;
    }

    if (left < margin) {
        top = rect.bottom + margin;
    }

    left = Math.min(left, window.innerWidth - cardRect.width - margin);
    left = Math.max(margin, left);
    if (top + cardRect.height > window.innerHeight - margin) {
        top = rect.top - cardRect.height - margin;
    }
    top = Math.min(top, window.innerHeight - cardRect.height - margin);
    top = Math.max(margin, top);

    card.style.left = `${Math.round(left)}px`;
    card.style.top = `${Math.round(top)}px`;
}

function buildCardContent({ screenName, info, loading = false, errorText = '' }) {
    const card = ensureCard();
    card.replaceChildren();

    const meta = info?.meta || {};

    // Header
    const header = createEl('div', 'x-posed-card-header');

    const avatarWrap = createEl('div', 'x-posed-avatar-wrap');
    const avatarUrl = meta.avatarUrl;
    if (isTrustedTwimgUrl(avatarUrl)) {
        const img = document.createElement('img');
        img.className = 'x-posed-avatar';
        img.src = avatarUrl;
        img.alt = '';
        img.loading = 'lazy';
        img.referrerPolicy = 'no-referrer';
        avatarWrap.appendChild(img);
    } else {
        const fallback = createEl('div', 'x-posed-avatar-fallback', (screenName || '?').slice(0, 1).toUpperCase());
        avatarWrap.appendChild(fallback);
    }

    const titleWrap = createEl('div', 'x-posed-title');
    const nameLine = createEl('div', 'x-posed-name-line');
    const name = safeText(meta.name || screenName, 60);
    const nameEl = createEl('span', 'x-posed-name', name);
    const handleEl = createEl('span', 'x-posed-handle', `@${safeText(screenName, 20)}`);
    nameLine.appendChild(nameEl);

    // Tags
    const tags = createEl('div', 'x-posed-tags');

    if (meta.blueVerified) {
        tags.appendChild(createTag({ label: 'Blue', tone: 'blue', title: 'X Premium / Blue verified' }));
    }
    if (meta.verified) {
        tags.appendChild(createTag({ label: 'Verified', tone: 'gold', title: 'Legacy verified' }));
    }
    if (meta.identityVerified) {
        tags.appendChild(createTag({ label: 'ID', tone: 'green', title: 'Identity verified' }));
    }
    if (meta.protected) {
        tags.appendChild(createTag({ label: 'Protected', tone: 'neutral', title: 'Protected account' }));
    }

    // Affiliate badge
    const aff = meta.affiliate;
    if (aff?.name) {
        tags.appendChild(createTag({ label: aff.name, tone: 'purple', title: 'Affiliation / business label' }));
    }

    titleWrap.appendChild(nameLine);
    titleWrap.appendChild(handleEl);
    if (tags.childNodes.length > 0) titleWrap.appendChild(tags);

    header.appendChild(avatarWrap);
    header.appendChild(titleWrap);

    // Body
    const body = createEl('div', 'x-posed-card-body');

    // Always show your core signals first
    if (info?.location) {
        body.appendChild(createRow({ icon: '📍', label: 'Location', value: safeText(info.location, 80) }));
    }

    if (info?.device) {
        body.appendChild(createRow({ icon: '📱', label: 'Device', value: safeText(info.device, 80) }));
    }

    if (info?.locationAccurate === false) {
        body.appendChild(createRow({ icon: '🔒', label: 'Signal', value: 'VPN / Proxy suspected' }));
    }

    // Verification summary row (if any signal exists)
    const verificationBits = [];
    if (meta.blueVerified) verificationBits.push('Blue');
    if (meta.verified) verificationBits.push('Legacy');
    if (meta.identityVerified) verificationBits.push('ID');
    if (meta.protected) verificationBits.push('Protected');
    if (verificationBits.length > 0) {
        body.appendChild(createRow({ icon: '✅', label: 'Verification', value: verificationBits.join(' · ') }));
    }

    const createdAt = parseCreatedAt(meta.createdAt);
    const ageYears = yearsSince(createdAt);
    if (createdAt) {
        const ageSuffix = typeof ageYears === 'number' ? ` (${ageYears}y)` : '';
        body.appendChild(createRow({ icon: '🗓️', label: 'Created', value: `${formatShortDate(createdAt)}${ageSuffix}` }));
    }

    // Verified since
    if (typeof meta.verifiedSinceMsec === 'number' && meta.verifiedSinceMsec > 0) {
        const d = new Date(meta.verifiedSinceMsec);
        if (!Number.isNaN(d.getTime())) {
            body.appendChild(createRow({ icon: '⏱️', label: 'Verified since', value: formatShortDate(d) }));
        }
    }

    if (typeof meta.usernameChanges === 'number') {
        body.appendChild(createRow({ icon: '🔁', label: 'Handle changes', value: String(meta.usernameChanges) }));
    }

    // X internal stable user identifier (useful for tracking across handle changes)
    if (meta.restId) {
        body.appendChild(createRow({ icon: '🆔', label: 'User ID', value: safeText(meta.restId, 40) }));
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

        const label = aff?.name || meta.affiliateUsername;
        content.appendChild(document.createTextNode(safeText(label, 60)));

        // Link out if URL is present
        if (aff?.url && isSafeHttpsUrl(aff.url)) {
            const link = document.createElement('a');
            link.className = 'x-posed-link';
            link.href = aff.url;
            link.target = '_blank';
            link.rel = 'noreferrer noopener';
            link.textContent = ' ↗';
            content.appendChild(link);
        }

        body.appendChild(createRow({ icon: '🏢', label: 'Affiliation', value: content }));
    }

    // Intentionally omit `profileImageShape` ("Avatar") and `learnMoreUrl` rows:
    // they add noise without providing actionable signal.

    if (errorText) {
        body.appendChild(createRow({ icon: '⚠️', label: 'Error', value: safeText(errorText, 120) }));
    } else if (loading) {
        body.appendChild(createRow({ icon: '⏳', label: 'Loading', value: 'Fetching account details…' }));
    }

    // Empty states
    if (body.childNodes.length === 0) {
        body.appendChild(createEl('div', 'x-posed-empty', 'No extra account metadata available.'));
    }

    card.appendChild(header);
    card.appendChild(body);
    return card;
}

class HovercardController {
    constructor() {
        this.card = null;
        this.hideTimeout = null;
        this.currentAnchor = null;

        // Per-session cache to avoid repeated API hits while you hover around
        this.hoverCache = new Map(); // screenName -> { data, fetchedAt }
        this.inFlight = new Map(); // screenName -> Promise
        this.cacheTtlMs = 60 * 1000; // 60s

        this._handleCardEnter = this._handleCardEnter.bind(this);
        this._handleCardLeave = this._handleCardLeave.bind(this);
        this._handleScroll = this._handleScroll.bind(this);
    }

    attach(badgeEl, { screenName, info, csrfToken = null }) {
        if (!badgeEl || badgeEl.dataset.xPosedHovercardAttached === 'true') return;
        badgeEl.dataset.xPosedHovercardAttached = 'true';

        const onEnter = () => this.show(badgeEl, { screenName, info, csrfToken });
        const onLeave = () => this.hideSoon();

        badgeEl.addEventListener('mouseenter', onEnter);
        badgeEl.addEventListener('mouseleave', onLeave);

        // Mark for cleanup by content-script cleanup routines.
        badgeEl.classList.add('x-posed-has-hovercard');
    }

    show(anchorEl, { screenName, info, csrfToken = null }) {
        if (!anchorEl || !anchorEl.isConnected) return;

        if (this.hideTimeout) {
            clearTimeout(this.hideTimeout);
            this.hideTimeout = null;
        }

        this.currentAnchor = anchorEl;

        // Show immediate card (using whatever we currently know)
        this.card = buildCardContent({ screenName, info, loading: true });
        this.card.classList.add('x-posed-hovercard-visible');
        positionCard(this.card, anchorEl);

        // Fetch rich metadata ONLY on hover (forces API), with short TTL caching.
        this._fetchAndUpdate(anchorEl, screenName, csrfToken).catch(() => {});

        // Keep visible if hovering card
        this.card.removeEventListener('mouseenter', this._handleCardEnter);
        this.card.removeEventListener('mouseleave', this._handleCardLeave);
        this.card.addEventListener('mouseenter', this._handleCardEnter);
        this.card.addEventListener('mouseleave', this._handleCardLeave);

        // Reposition on scroll/resize while visible
        window.addEventListener('scroll', this._handleScroll, true);
        window.addEventListener('resize', this._handleScroll, true);
    }

    hideSoon(delayMs = 120) {
        if (this.hideTimeout) clearTimeout(this.hideTimeout);
        this.hideTimeout = setTimeout(() => this.hide(), delayMs);
    }

    hide() {
        if (this.hideTimeout) {
            clearTimeout(this.hideTimeout);
            this.hideTimeout = null;
        }

        if (this.card) {
            this.card.classList.remove('x-posed-hovercard-visible');
            this.card.replaceChildren();
        }

        this.currentAnchor = null;
        window.removeEventListener('scroll', this._handleScroll, true);
        window.removeEventListener('resize', this._handleScroll, true);
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

    async _fetchAndUpdate(anchorEl, screenName, csrfToken) {
        const key = String(screenName || '').toLowerCase();
        if (!key) return;

        const cached = this.hoverCache.get(key);
        if (cached && Date.now() - cached.fetchedAt < this.cacheTtlMs) {
            if (this.currentAnchor === anchorEl && this.card?.classList.contains('x-posed-hovercard-visible')) {
                this.card = buildCardContent({ screenName, info: cached.data, loading: false });
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
                .finally(() => {
                    this.inFlight.delete(key);
                });
            this.inFlight.set(key, p);
        }

        const response = await this.inFlight.get(key);

        if (!response?.success || !response.data) {
            const msg = response?.error || 'Failed to fetch details';
            if (this.currentAnchor === anchorEl && this.card?.classList.contains('x-posed-hovercard-visible')) {
                this.card = buildCardContent({ screenName, info: {}, loading: false, errorText: msg });
                this.card.classList.add('x-posed-hovercard-visible');
                positionCard(this.card, anchorEl);
            }
            return;
        }

        this.hoverCache.set(key, { data: response.data, fetchedAt: Date.now() });

        if (this.currentAnchor === anchorEl && this.card?.classList.contains('x-posed-hovercard-visible')) {
            this.card = buildCardContent({ screenName, info: response.data, loading: false });
            this.card.classList.add('x-posed-hovercard-visible');
            positionCard(this.card, anchorEl);
        }
    }

    _handleScroll() {
        if (!this.card || !this.currentAnchor || !this.currentAnchor.isConnected) {
            this.hide();
            return;
        }
        positionCard(this.card, this.currentAnchor);
    }
}

export const hovercard = new HovercardController();

// For CSS targeting (keeps the feature isolated)
export const HOVERCARD_CARD_ID = CARD_ID;
export const HOVERCARD_BADGE_CLASS = CSS_CLASSES?.INFO_BADGE || 'x-info-badge';
