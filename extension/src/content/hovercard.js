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
import { LRUCache } from '../shared/lru-cache.js';
import { deviceIcon, glyph, flagImage } from './icons.js';

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

function createRow({ icon, label, value, primary = false, alert = false }) {
    let cls = 'x-posed-row';
    if (primary) cls += ' x-posed-row--primary';
    if (alert) cls += ' x-posed-alert';
    const row = createEl('div', cls);

    const left = createEl('div', 'x-posed-row-left');
    const iconEl = createEl('span', 'x-posed-row-icon');
    if (icon instanceof Node) iconEl.appendChild(icon);
    else if (icon) iconEl.textContent = icon;
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
            return 'Waiting to capture your X session — scroll or reload x.com once, then hover again.';
        case 'RATE_LIMITED':
            return 'X rate limit reached — try again in a moment.';
        case 'NOT_FOUND':
            return 'Account not found.';
        default:
            return response?.error || 'Failed to fetch details';
    }
}

function buildCardContent({ screenName, info, loading = false, errorText = '' }) {
    const card = ensureCard();
    card.replaceChildren();

    const meta = info?.meta || {};

    // Header
    const header = createEl('div', 'x-posed-card-header');

    // Avatar intentionally omitted — the cached profile image is often stale/blurry
    // and adds no forensic value; the dossier leads with the name + signals.
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

    header.appendChild(titleWrap);

    // Body
    const body = createEl('div', 'x-posed-card-body');

    // Primary signals first — Location (with flag), Device (platform icon), VPN.
    if (info?.location) {
        const locVal = createEl('span', 'x-posed-loc');
        const fimg = flagImage(info.location);
        if (fimg) locVal.appendChild(fimg);
        locVal.appendChild(document.createTextNode(safeText(info.location, 80)));
        body.appendChild(createRow({ icon: glyph('location', 16), label: 'Location', value: locVal, primary: true }));
    }

    if (info?.device) {
        body.appendChild(createRow({ icon: deviceIcon(info.device, 16), label: 'Device', value: safeText(info.device, 80), primary: true }));
    }

    if (info?.locationAccurate === false) {
        body.appendChild(createRow({ icon: glyph('vpn', 16), label: 'Signal', value: 'VPN / Proxy suspected', primary: true, alert: true }));
    }

    // Verification summary row (if any signal exists)
    const verificationBits = [];
    if (meta.blueVerified) verificationBits.push('Blue');
    if (meta.verified) verificationBits.push('Legacy');
    if (meta.identityVerified) verificationBits.push('ID');
    if (meta.protected) verificationBits.push('Protected');
    if (verificationBits.length > 0) {
        body.appendChild(createRow({ icon: glyph('verified', 16), label: 'Verification', value: verificationBits.join(' · ') }));
    }

    const createdAt = parseCreatedAt(meta.createdAt);
    const ageYears = yearsSince(createdAt);
    if (createdAt) {
        const ageSuffix = typeof ageYears === 'number' ? ` (${ageYears}y)` : '';
        body.appendChild(createRow({ icon: glyph('created', 16), label: 'Created', value: `${formatShortDate(createdAt)}${ageSuffix}` }));
    }

    // Verified since
    if (typeof meta.verifiedSinceMsec === 'number' && meta.verifiedSinceMsec > 0) {
        const d = new Date(meta.verifiedSinceMsec);
        if (!Number.isNaN(d.getTime())) {
            body.appendChild(createRow({ icon: glyph('clock', 16), label: 'Verified since', value: formatShortDate(d) }));
        }
    }

    if (typeof meta.usernameChanges === 'number') {
        body.appendChild(createRow({ icon: glyph('swap', 16), label: 'Handle changes', value: String(meta.usernameChanges) }));
    }

    // X internal stable user identifier (useful for tracking across handle changes)
    if (meta.restId) {
        body.appendChild(createRow({ icon: glyph('id', 16), label: 'User ID', value: safeText(meta.restId, 40) }));
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

        body.appendChild(createRow({ icon: glyph('affiliation', 16), label: 'Affiliation', value: content }));
    }

    // Intentionally omit `profileImageShape` ("Avatar") and `learnMoreUrl` rows:
    // they add noise without providing actionable signal.

    if (errorText) {
        body.appendChild(createRow({ icon: glyph('warn', 16), label: 'Error', value: safeText(errorText, 120) }));
    } else if (loading) {
        body.appendChild(createRow({ icon: glyph('hourglass', 16), label: 'Loading', value: 'Fetching account details…' }));
    }

    // Empty states
    if (body.childNodes.length === 0) {
        body.appendChild(createEl('div', 'x-posed-empty', 'No extra account metadata available.'));
    }

    card.appendChild(createEl('span', 'x-posed-scanline'));
    card.appendChild(header);
    card.appendChild(body);
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
    }

    attach(badgeEl, { screenName, info, csrfToken = null }) {
        if (!badgeEl || badgeEl.dataset.xPosedHovercardAttached === 'true') return;
        badgeEl.dataset.xPosedHovercardAttached = 'true';

        if (TOUCH) {
            // No hover on touch: tap the badge to toggle the dossier. Stop the tap
            // from bubbling/navigating to the profile or triggering X's own handlers.
            badgeEl.addEventListener('click', e => {
                e.preventDefault();
                e.stopPropagation();
                const open = this.currentAnchor === badgeEl &&
                    this.card?.classList.contains('x-posed-hovercard-visible');
                if (open) this.hide();
                else this.show(badgeEl, { screenName, info, csrfToken });
            });
        } else {
            const onEnter = () => this.show(badgeEl, { screenName, info, csrfToken });
            const onLeave = () => this.hideSoon();
            badgeEl.addEventListener('mouseenter', onEnter);
            badgeEl.addEventListener('mouseleave', onLeave);
        }

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
        // Pass the badge's known info so an error card can still show it (issue #14).
        this._fetchAndUpdate(anchorEl, screenName, csrfToken, info).catch(() => {});

        // Keep visible if hovering card
        this.card.removeEventListener('mouseenter', this._handleCardEnter);
        this.card.removeEventListener('mouseleave', this._handleCardLeave);
        this.card.addEventListener('mouseenter', this._handleCardEnter);
        this.card.addEventListener('mouseleave', this._handleCardLeave);

        // Reposition on scroll/resize while visible
        window.addEventListener('scroll', this._handleScroll, true);
        window.addEventListener('resize', this._handleScroll, true);

        // Touch: there is no mouseleave to dismiss, so close on a tap outside the
        // card or its anchor.
        if (TOUCH) document.addEventListener('pointerdown', this._handleOutsideTap, true);
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

        if (this._repositionRafId !== null) {
            cancelAnimationFrame(this._repositionRafId);
            this._repositionRafId = null;
        }

        if (this.card) {
            this.card.classList.remove('x-posed-hovercard-visible');
            this.card.replaceChildren();
        }

        this.currentAnchor = null;
        window.removeEventListener('scroll', this._handleScroll, true);
        window.removeEventListener('resize', this._handleScroll, true);
        document.removeEventListener('pointerdown', this._handleOutsideTap, true);
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

    _handleOutsideTap(e) {
        if (!this.card) return;
        const t = e.target;
        if (this.card.contains(t)) return;
        if (this.currentAnchor && this.currentAnchor.contains(t)) return;
        this.hide();
    }

    async _fetchAndUpdate(anchorEl, screenName, csrfToken, initialInfo = {}) {
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
            const msg = describeHovercardError(response);
            if (this.currentAnchor === anchorEl && this.card?.classList.contains('x-posed-hovercard-visible')) {
                this.card = buildCardContent({ screenName, info: initialInfo, loading: false, errorText: msg });
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

        if (this.currentAnchor === anchorEl && this.card?.classList.contains('x-posed-hovercard-visible')) {
            this.card = buildCardContent({ screenName, info: response.data, loading: false });
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
        this.hide();
        this.hoverCache.clear();
        this.inFlight.clear();

        const card = document.getElementById(CARD_ID);
        if (card) card.remove();
        this.card = null;
    }
}

export const hovercard = new HovercardController();

// For CSS targeting (keeps the feature isolated)
export const HOVERCARD_CARD_ID = CARD_ID;
export const HOVERCARD_BADGE_CLASS = CSS_CLASSES?.INFO_BADGE || 'x-info-badge';
