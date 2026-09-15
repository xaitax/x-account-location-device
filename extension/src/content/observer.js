/**
 * Observer Module
 * Handles DOM observation, user processing, and caching
 */

import { SELECTORS, CSS_CLASSES, MESSAGE_TYPES, TIMING, canonicalCountry, GOVERNMENT_LABEL } from '../shared/constants.js';
import { extractUsername, findInsertionPoint, getLoggedInUsername, extractTagsFromText, getDeviceCountry } from '../shared/utils.js';
import { createBadge, findUserCellInsertionPoint, showRateLimitToast } from './ui.js';
import { LRUCache } from '../shared/lru-cache.js';
import { getProfile } from './profile-cache.js';
import { isFocalTweet, ownPostId } from './post-identity.js';
import { hasGovernmentBadge, VERIFIED_BADGE_SELECTOR } from './government-badge.js';

/**
 * Resolve the country used for the flag, the xCountry dataset, and country/region
 * blocking. When the "flag from device" option is on (issue #17) and the device
 * source string carries a country, that country wins; otherwise we use the
 * account location. Web/unknown device sources have no country, so we fall back
 * to location. Returns null when neither is known.
 * @param {{location?: string, device?: string}|null|undefined} info
 * @param {boolean} flagFromDevice
 * @returns {string|null}
 */
function effectiveCountry(info, flagFromDevice) {
    if (flagFromDevice && info?.device) {
        const deviceCountry = getDeviceCountry(info.device);
        if (deviceCountry) return deviceCountry;
    }
    return info?.location || null;
}

/**
 * Which filters blocked this account, or '' if none did.
 *
 * The verdict used to be computed as one OR'd boolean in two separate places
 * (applyInfoToElement and runUpdateBlockedTweets), which meant the two could drift
 * apart and the reason was thrown away the moment it was known. Both now call this,
 * so they cannot disagree, and the surviving reason is what labels a collapsed quote
 * card (issue #42).
 *
 * The order is stable so the quote-card label is predictable when several filters match.
 *
 /**
 * @param {Object} r - reason flags, each already resolved by the caller
 * @returns {string} comma-separated reason keys, or ''
 */

function resolveBlockReason({ isExempt, isBlockedCountry, isBlockedRegion, isTagBlocked,
    isBioBlocked, isLinkBlocked, isLabelBlocked, isAffiliationBlocked }) {
    if (isExempt) return '';
    let reason = '';
    if (isBlockedCountry) reason = 'country';
    if (isBlockedRegion) reason += reason ? ',region' : 'region';
    if (isTagBlocked) reason += reason ? ',tag' : 'tag';
    if (isBioBlocked) reason += reason ? ',bio' : 'bio';
    if (isLinkBlocked) reason += reason ? ',link' : 'link';
    if (isLabelBlocked) reason += reason ? ',label' : 'label';
    if (isAffiliationBlocked) reason += reason ? ',affiliation' : 'affiliation';
    return reason;
}

const BLOCK_REASON_LABELS = {
    country: 'Country',
    region: 'Region',
    tag: 'Name tag',
    bio: 'Bio tag',
    link: 'Linked domain',
    label: 'Account type',
    affiliation: 'Affiliation'
};

function formatBlockReason(reason) {
    const labels = String(reason || '').split(',')
        .map(key => BLOCK_REASON_LABELS[key])
        .filter(Boolean);
    return labels.length > 0 ? `Quoted post hidden · ${labels.join(', ')}` : 'Quoted post hidden';
}

/**
 * Apply a row's block/highlight/VPN state to the username element and its tweet
 * article AUTHORITATIVELY: every reason re-sets the marker it owns and clears the
 * ones that no longer apply. This is what lets the timeline recover when a setting
 * flips (e.g. re-enabling "Show VPN/Proxy Users") or when X recycles a row that was
 * hidden under a previous setting — the old code only ever ADDED markers, so a hidden
 * row stayed hidden until a hard reload.
 *
 * All filters honor the hide-vs-highlight preference. The persistent data-x-block
 * marker lets CSS :has() keep the article styled after X wipes our class.
 *
 * Shared by the per-element resolution path (applyInfoToElement) and the bulk
 * re-derive pass (runUpdateBlockedTweets) so the two can never disagree about a row.
 * @param {HTMLElement} element
 * @param {HTMLElement|null} tweet
 * @param {{isListBlocked: boolean, isVpnHidden: boolean, highlightMode: boolean, isQuote?: boolean, neverHide?: boolean, reason?: string}} state
 * @returns {{hide: boolean, highlight: boolean}}
 */
function applyBlockState(element, tweet, { isListBlocked, isVpnHidden, highlightMode, isQuote = false, neverHide = false, reason = '' }) {
    // A quoted author lives INSIDE someone else's tweet, so it must never decide the
    // fate of the row (issue #32) — the article-level `:has([data-x-block="hide"])`
    // rule can't tell a quoted marker from the main author's. Mark the quoted username
    // element in its own namespace instead and let CSS collapse only the quote card.
    if (isQuote) {
        delete element.dataset.xBlock;
        const quoteHighlight = isListBlocked && highlightMode;
        // Never re-collapse a card the reader explicitly revealed (see setupQuoteReveal).
        // Element recycling deletes the marker, so a reused row can't inherit 'shown'.
        if (element.dataset.xQuoteBlock !== 'shown') {
            element.dataset.xQuoteBlock = isListBlocked
                ? (highlightMode ? 'highlight' : 'hide')
                : '';
            // Names the filter on the collapsed card's placeholder (issue #42). Written
            // alongside the verdict it belongs to, and cleared with it, so a row that
            // stops being blocked — or gets recycled — can never keep a stale reason.
            element.dataset.xQuoteReason = isListBlocked ? reason : '';
            const quoteCard = element.closest('div[role="link"][tabindex="0"]');
            if (quoteCard) quoteCard.dataset.xQuoteLabel = isListBlocked ? formatBlockReason(reason) : '';
        }
        // Always report hide:false: the row stays, and the badge is still built so it's
        // already in place inside the card when the reader reveals it.
        return { hide: false, highlight: quoteHighlight };
    }

    delete element.dataset.xQuoteBlock;
    delete element.dataset.xQuoteReason;

    // People lists (Followers, Verified followers, Following) only ever FLAG a row.
    // Removing someone from your own follower list hides the information you opened
    // the page to read, and leaves the count looking wrong. Every filter highlights there.
    const matchesFilter = isListBlocked || isVpnHidden;
    // The post deliberately opened by its own timestamp remains readable. This
    // runs after the quote branch, so its quoted authors retain independent rules.
    const keepVisible = neverHide || isFocalTweet(tweet);
    const hide = !keepVisible && matchesFilter && !highlightMode;
    const highlight = !hide && matchesFilter;

    if (tweet) {
        tweet.classList.toggle(CSS_CLASSES.TWEET_BLOCKED, hide);
        tweet.classList.toggle('x-tweet-vpn-blocked', isVpnHidden && hide);
        tweet.classList.toggle('x-tweet-highlighted', highlight);
    }
    element.dataset.xBlock = hide ? 'hide' : (highlight ? 'highlight' : '');

    return { hide, highlight };
}

/**
 * Apply resolved user info to an element: write the data-* attributes, run the
 * blocked-country/region/tag + VPN handling, and create the badge. This is the single
 * source of truth shared by all three processElement resolution paths (local-cache
 * hit, in-flight resolved, fresh API response) so they behave identically.
 * @param {HTMLElement} element
 * @param {string} screenName
 * @param {{location?: string, device?: string, locationAccurate?: boolean}|null} info
 * @param {Object} opts
 * @param {Set} opts.blockedCountries - lowercase blocked country names
 * @param {Set} [opts.blockedRegions] - lowercase blocked region names
 * @param {Object} opts.settings
 * @param {boolean} opts.isUserCell
 * @param {HTMLElement|null} opts.tweet - the already-resolved tweet article
 * @param {boolean} [opts.tagBlocked] - display-name tag verdict computed in processElement
 * @param {Function} [opts.debug]
 * @param {string|null} [opts.csrfToken]
 */
function applyInfoToElement(element, screenName, info, opts) {
    const { blockedCountries, blockedRegions, blockedAffiliations, blockedBioTags, blockedLinks, blockedPcf, allowedUsers, settings, isUserCell, tweet, debug, csrfToken, tagBlocked } = opts;

    const effCountry = effectiveCountry(info, settings.flagFromDevice);
    element.dataset.xCountry = effCountry || '';

    const loggedInUser = getLoggedInUsername();
    const isSelf = loggedInUser && screenName.toLowerCase() === loggedInUser.toLowerCase();
    // Allowlisted ("always show") accounts are exempt from every filter, exactly like
    // your own account — so treat them as isExempt everywhere a block is decided (issue #26).
    const isExempt = isSelf || (allowedUsers && allowedUsers.has(screenName.toLowerCase()));

    // Resolve the full block decision from every reason at once, then apply it in one
    // authoritative pass (set what applies, clear what doesn't).
    // Fold aliases ("Macedonia" → "north macedonia") so a location X words differently
    // than the picker still matches the blocked set.
    const locationLower = canonicalCountry(effCountry);
    const isQuote = isInsideQuoteTweet(element, tweet);
    // Who-they-are filters (country/region/tag) apply to quoted authors too — they just
    // collapse the quote card instead of the row (issue #32).
    const affiliationBlocked = hasBlockedAffiliation(info?.meta, blockedAffiliations);
    // Bio, links and account label come from the profile data X already sent with the timeline,
    // so neither costs a lookup — see profile-cache.js.
    const bioBlocked = hasBlockedBio(screenName, blockedBioTags);
    const linkBlocked = hasBlockedLink(screenName, blockedLinks);
    const labelBlocked = hasBlockedAccountLabel(element, tweet, screenName, blockedPcf);
    const blockReason = resolveBlockReason({
        isExempt,
        isBlockedCountry: locationLower !== '' && blockedCountries.has(locationLower),
        isBlockedRegion: locationLower !== '' && !!blockedRegions && blockedRegions.has(locationLower),
        isTagBlocked: tagBlocked,
        isBioBlocked: bioBlocked,
        isLinkBlocked: linkBlocked,
        isLabelBlocked: labelBlocked,
        isAffiliationBlocked: affiliationBlocked
    });
    const matchesBlockList = blockReason !== '';
    // Location uncertainty is filtered only for the MAIN author: a quoted account
    // must never hide the quoting user's own post.
    const isVpnHidden =
        !isQuote && info?.locationAccurate === false && settings.showVpnUsers === false && !isExempt;

    const { hide } = applyBlockState(element, tweet, {
        isListBlocked: matchesBlockList,
        isVpnHidden,
        highlightMode: settings.highlightBlockedTweets === true,
        isQuote,
        neverHide: isUserCell,
        reason: blockReason
    });

    if (hide) return; // hidden row → don't build a badge

    if (info?.location || info?.device) {
        try {
            createBadge(element, screenName, info, isUserCell, settings, debug, csrfToken, effCountry);
        } catch (badgeError) {
            if (debug) debug(`Badge creation error for @${screenName}: ${badgeError.message}`);
        }
    }
}

// ============================================
// VALIDATION
// ============================================

/**
 * Validate a Twitter/X screen name
 * Valid screen names: 1-15 chars, alphanumeric + underscore only
 * @param {string} screenName - The screen name to validate
 * @returns {boolean} - True if valid
 */
function isValidScreenName(screenName) {
    if (!screenName || typeof screenName !== 'string') return false;
    return /^[a-zA-Z0-9_]{1,15}$/.test(screenName);
}

/**
 * Check if element is inside a quoted tweet (not the main tweet author)
 * Quote tweets on X are inside clickable card containers with role="link" and tabindex="0"
 * @param {HTMLElement} element - The element to check
 * @param {HTMLElement|null} [tweet] - The already-resolved tweet article (avoids a
 *   redundant closest() call). Falls back to element.closest(TWEET) when omitted.
 * @returns {boolean} - True if inside a quote tweet
 */
function isInsideQuoteTweet(element, tweet = element.closest(SELECTORS.TWEET)) {
    // Get the tweet article
    if (!tweet) return false;

    // Walk up from the element to the tweet article
    // If we encounter a quote card container, this is a quoted user
    let current = element.parentElement;
    while (current && current !== tweet) {
        // Quote tweet cards are clickable containers with role="link" and tabindex="0"
        // They contain the quoted tweet's content including the username
        if (current.getAttribute('role') === 'link' &&
            current.getAttribute('tabindex') === '0') {
            return true;
        }
        current = current.parentElement;
    }

    return false;
}

/**
 * Read the language X assigned to the MAIN tweet's text (issue #25). X tags every
 * text tweet with its own ML-detected BCP-47 language on the tweetText node
 * (`<div data-testid="tweetText" lang="ja">`). We use the FIRST tweetText that is
 * NOT inside a quoted-tweet card, so a quote's language can't stand in for the
 * author's own post. Returns the lowercase primary subtag ("zh" from "zh-Hant"),
 * or null when the main tweet has no text (media/link/emoji-only rows have no
 * tweetText, or carry lang="und").
 * @param {HTMLElement} tweet - the article element
 * @returns {string|null}
 */
function getMainTweetLanguage(tweet) {
    const texts = tweet.querySelectorAll('[data-testid="tweetText"]');
    for (const node of texts) {
        if (!isInsideQuoteTweet(node, tweet)) {
            const lang = node.getAttribute('lang');
            if (!lang) return null;
            return lang.split('-')[0].toLowerCase();
        }
    }
    return null;
}

/**
 * Screen name (lowercase) of a tweet's MAIN author — the first processed username
 * element that isn't inside a quoted-tweet card. Used to apply the per-author
 * allowlist to per-tweet (language) blocking. Returns '' when unknown/unprocessed.
 * @param {HTMLElement} tweet - the article element
 * @returns {string}
 */
function getMainAuthorScreenName(tweet) {
    const els = tweet.querySelectorAll('[data-x-screen-name]');
    for (const el of els) {
        if (!isInsideQuoteTweet(el, tweet)) {
            return (el.dataset.xScreenName || '').toLowerCase();
        }
    }
    return '';
}

/**
 * Is a tweet's main author on the "always show" allowlist (issue #26)? Allowlisted
 * accounts are exempt from every filter, so this short-circuits language blocking
 * the same way isSelf/isAllowed exempts the per-author country/region/tag/VPN blocks.
 * @param {HTMLElement} tweet
 * @param {Set<string>} allowedUsers - lowercase allowlisted handles
 * @returns {boolean}
 */
function isAuthorAllowlisted(tweet, allowedUsers) {
    if (!allowedUsers || allowedUsers.size === 0) return false;
    const author = getMainAuthorScreenName(tweet);
    return author !== '' && allowedUsers.has(author);
}

/**
 * Mark (or unmark) a tweet article for language blocking. Uses a SEPARATE
 * article-level marker (data-x-lang-block) from the per-author data-x-block, so
 * the two filters compose in CSS instead of clobbering each other's state. The
 * marker honors the hide-vs-highlight preference; 'und' (undetermined —
 * emoji/link-only) is never blocked, and an allowlisted author is never blocked.
 * @param {HTMLElement|null} tweet - the article element
 * @param {Set<string>} blockedLanguages - lowercase primary subtags
 * @param {Object} settings
 * @param {Set<string>} [allowedUsers] - lowercase "always show" handles
 */
function applyLanguageBlock(tweet, blockedLanguages, settings, allowedUsers) {
    if (!tweet) return;

    let blocked = false;
    if (blockedLanguages && blockedLanguages.size > 0 && !isAuthorAllowlisted(tweet, allowedUsers)) {
        const lang = getMainTweetLanguage(tweet);
        if (lang && lang !== 'und' && blockedLanguages.has(lang)) {
            blocked = true;
        }
    }

    if (blocked) {
        tweet.dataset.xLangBlock = settings.highlightBlockedTweets === true || isFocalTweet(tweet)
            ? 'highlight' : 'hide';
    } else if (tweet.dataset.xLangBlock) {
        delete tweet.dataset.xLangBlock;
    }
}

// ============================================
// LRU CACHE (using shared implementation from storage.js)
// ============================================

const USER_INFO_CACHE_MAX_SIZE = 1000;

// Cached combined selector for better performance (avoids repeated string creation)
const COMBINED_USER_SELECTOR = `${SELECTORS.USERNAME}, ${SELECTORS.USER_CELL}`;

// Use the shared LRU cache implementation to avoid code duplication
export const userInfoCache = new LRUCache(USER_INFO_CACHE_MAX_SIZE);

// ============================================
// STATE
// ============================================

let observer = null;
let intersectionObserver = null;
const pendingVisibility = new Map();
const PENDING_VISIBILITY_MAX_SIZE = 500;

// Processing queue with bounded size and timeout cleanup
// Map<screenName, Promise> for deduplication and waiting on in-flight requests
const PROCESSING_QUEUE_MAX_SIZE = 200;
export const processingQueue = new Map();

// Each processing attempt owns its row until another attempt or a settings reset
// replaces it. Network replies may arrive after X has recycled the same DOM node.
let elementProcessingTokens = new WeakMap();
let elementTweetContexts = new WeakMap();
let elementQuoteContexts = new WeakMap();
let postContexts = new WeakMap();

function hasChangedElementContext(element) {
    if (!elementTweetContexts.has(element)) return false;
    const tweet = element.closest(SELECTORS.TWEET);
    return elementTweetContexts.get(element) !== tweet ||
        elementQuoteContexts.get(element) !== isInsideQuoteTweet(element, tweet);
}

// A lookup can outlive list/allowlist changes without the row being recycled.
// Keep the latest broadcast available to delayed applies as soon as it arrives,
// including before the coalesced DOM update runs on the next animation frame.
let filterRevision = 0;
let latestFilterSnapshot = null;

const LOOKUP_RETRY_DELAY_MS = 60000;

function clearRetryState(element) {
    delete element.dataset.xRetryAfter;
    delete element.dataset.xRetryScreenName;
}

/** A retry belongs to the account that failed, never to a recycled row. */
function isRetryDeferred(element, currentName) {
    if (!element.dataset.xRetryAfter) return false;
    if (currentName === undefined) {
        currentName = element.matches(SELECTORS.USER_CELL)
            ? extractUsernameFromUserCell(element)
            : extractUsername(element);
    }
    if (currentName && currentName.toLowerCase() !== element.dataset.xRetryScreenName?.toLowerCase()) {
        clearRetryState(element);
        return false;
    }
    return Date.now() < Number(element.dataset.xRetryAfter);
}

function retryDeadline(response) {
    const now = Date.now();
    const reset = typeof response?.retryAfter === 'number'
        ? response.retryAfter
        : Date.parse(response?.retryAfter);
    return response?.code === 'RATE_LIMITED' && Number.isFinite(reset) && reset > now
        ? reset
        : now + LOOKUP_RETRY_DELAY_MS;
}

function deferElementRetry(element, screenName, retryAt) {
    element.dataset.xRetryAfter = String(retryAt);
    element.dataset.xRetryScreenName = screenName;
    // Keep xScreenName and local filter markers so later profile/list updates
    // remain effective. Existing scans can queue this row once its deadline passes.
    delete element.dataset.xProcessed;
}

// Toast cooldown tracking
let lastRateLimitToastTime = 0;

// Cleanup functions registry
export const observerCleanupFunctions = [];

// ============================================
// DISPLAY NAME EXTRACTION
// ============================================

/**
 * Extract display name including emojis from an element
 * X renders emojis as images (sometimes with an empty alt), so reconstruct the text.
 * @param {HTMLElement} element - The username element
 * @returns {string} - Display name with emojis
 */
function extractDisplayName(element) {
    // Prefer this author's own username container. Searching the whole article
    // reads the main author's name again when processing a quoted author (#57).
    const tweet = element.closest(SELECTORS.TWEET);
    const userCell = element.closest(SELECTORS.USER_CELL);
    const ownName = element.closest(SELECTORS.USERNAME);
    const quoteCard = isInsideQuoteTweet(element, tweet)
        ? element.closest(QUOTE_CARD_SELECTOR)
        : null;
    const container = ownName || quoteCard || userCell || tweet;
    if (!container) return '';

    const belongsToAuthor = node => !tweet || !!quoteCard || !isInsideQuoteTweet(node, tweet);
    const isProfileLink = node => /^\/[a-zA-Z0-9_]{1,15}\/?$/.test(node.getAttribute('href') || '');
    
    // Method 1: Look for User-Name testid which contains display name and @handle
    const userNameContainer = ownName || Array.from(container.querySelectorAll(SELECTORS.USERNAME))
        .find(belongsToAuthor);
    if (userNameContainer) {
        // Captured X markup puts the display-name text in the first directional
        // block of the first group. In quotes this group has no profile anchor.
        // Read only that field, not the sibling handle, time or affiliation badge.
        // A real display name may itself begin with @; this is not the handle field.
        const nameGroup = userNameContainer.firstElementChild;
        const nameField = nameGroup?.matches('div[dir]')
            ? nameGroup
            : nameGroup?.querySelector('div[dir]');
        const handleGroup = nameGroup?.nextElementSibling;
        const hasSeparateHandle = handleGroup && Array.from(handleGroup.querySelectorAll('span'))
            .some(span => /^@[a-zA-Z0-9_]{1,15}$/.test(span.textContent.trim()));
        // An incomplete header may contain only the handle group. Do not treat
        // that as a name while X is still constructing or recycling the row.
        if (hasSeparateHandle && nameField && !nameField.querySelector('time') &&
            nameField.closest(SELECTORS.USERNAME) === userNameContainer) {
            const displayName = extractTextWithEmojis(nameField);
            if (displayName) return displayName;
        }

        // The first link usually contains the display name
        const displayNameLink = Array.from(userNameContainer.querySelectorAll('a[href^="/"]'))
            .find(isProfileLink);
        if (displayNameLink) {
            const displayName = extractTextWithEmojis(displayNameLink);
            if (displayName && !displayName.startsWith('@')) {
                return displayName;
            }
        }
    }
    
    // Method 2: Look for profile links with role="link"
    const profileLinks = container.querySelectorAll('a[href^="/"][role="link"]');
    for (const link of profileLinks) {
        if (!belongsToAuthor(link) || !isProfileLink(link)) continue;
        const displayName = extractTextWithEmojis(link);
        // Skip if it looks like a @username or if it's empty
        if (displayName && !displayName.startsWith('@') && displayName.length > 0) {
            return displayName;
        }
    }
    
    // Method 3: Check the element itself if it contains the display name
    const parentSpan = element.closest('span');
    if (parentSpan) {
        const displayName = extractTextWithEmojis(parentSpan);
        if (displayName && !displayName.startsWith('@')) {
            return displayName;
        }
    }
    
    return '';
}

/**
 * Read an emoji image without guessing from its title or arbitrary asset URLs.
 * Some current X emoji images have alt="" but retain the Unicode SVG filename.
 * @param {HTMLImageElement} image
 * @returns {string}
 */
function emojiImageText(image) {
    if (image.alt) return image.alt;
    const match = /^https:\/\/abs(?:-\d+)?\.twimg\.com\/emoji\/v\d+\/svg\/([a-f0-9]+(?:-[a-f0-9]+)*)\.svg(?:[?#].*)?$/i
        .exec(image.getAttribute('src') || '');
    if (!match) return '';
    const points = match[1].split('-').map(point => parseInt(point, 16));
    if (points.length > 32 || points.some(point => point < 0x20 || point > 0x10ffff ||
        (point >= 0xd800 && point <= 0xdfff))) return '';
    return String.fromCodePoint(...points);
}

/**
 * Extract text content including emoji image text from an element
 * @param {HTMLElement} element - Element to extract text from
 * @returns {string} - Text with emojis
 */
function extractTextWithEmojis(element) {
    let result = '';
    
    const walker = document.createTreeWalker(
        element,
        NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
        {
            acceptNode: node => {
                if (node.nodeType === Node.TEXT_NODE) return NodeFilter.FILTER_ACCEPT;
                if (node.nodeName === 'IMG') return NodeFilter.FILTER_ACCEPT;
                return NodeFilter.FILTER_SKIP;
            }
        }
    );
    
    let node;
    while ((node = walker.nextNode())) {
        if (node.nodeType === Node.TEXT_NODE) {
            result += node.textContent;
        } else if (node.nodeName === 'IMG') {
            result += emojiImageText(node);
        }
    }
    
    return result.trim();
}

/**
 * Check if a display name contains any blocked tags
 * @param {string} displayName - The display name to check
 * @param {Set} blockedTags - Set of blocked tags
 * @returns {boolean} - True if any blocked tag is found
 */
/**
 * Does an account's affiliation label match the blocked set? X exposes the parent
 * organisation on affiliated accounts as a badge next to the display name, which
 * we already read from the API and now also share via the community cache.
 *
 * Matching is case-insensitive substring in both directions, mirroring blocked tags: it
 * lets someone type part of an organisation name and catch it without knowing the exact label.
 * @param {{affiliate?: {name?: string}|null, affiliateUsername?: string|null}|null|undefined} meta
 * @param {Set<string>} blockedAffiliations - lowercase blocked affiliation names
 * @returns {boolean}
 */
function hasBlockedAffiliation(meta, blockedAffiliations) {
    if (!meta || !blockedAffiliations || blockedAffiliations.size === 0) return false;

    const candidates = [];
    if (meta.affiliate && meta.affiliate.name) candidates.push(String(meta.affiliate.name).toLowerCase());
    if (meta.affiliateUsername) candidates.push(String(meta.affiliateUsername).toLowerCase());
    if (candidates.length === 0) return false;

    for (const blocked of blockedAffiliations) {
        const needle = blocked.toLowerCase().trim();
        if (!needle) continue;
        for (const candidate of candidates) {
            if (candidate.includes(needle) || needle.includes(candidate)) return true;
        }
    }
    return false;
}

// ============================================
// ACCOUNT LABEL — Parody / Commentary / Fan (#41) and grey verification (#48)
// ============================================

// X's authenticity labels render on BOTH the timeline row and the profile header, but not
// identically: the timeline wraps the label in a link to the authenticity policy, while the
// profile header is bare divs. Only the icon and the text are common to both, so we match on
// any of the three and normalise afterwards.
const ACCOUNT_TYPE_LINK_SELECTOR = 'a[href*="rules-and-policies/authenticity"]';
const ACCOUNT_TYPE_IMG_SELECTOR = 'img[src*="-mask."]';
const ACCOUNT_TYPE_SELECTOR = `${ACCOUNT_TYPE_LINK_SELECTOR}, ${ACCOUNT_TYPE_IMG_SELECTOR}`;

// How far up from a username element to look when there is no enclosing article to scope
// to (profile header, people-list row). Bounded so a neighbouring row's label can't leak in.
const ACCOUNT_TYPE_MAX_ANCESTORS = 5;

/**
 * First account-type label node inside `scope`, skipping any that belongs to a quoted
 * account when `tweetForQuoteCheck` is supplied.
 */
function firstAccountTypeNode(scope, tweetForQuoteCheck) {
    const nodes = scope.querySelectorAll(ACCOUNT_TYPE_SELECTOR);
    for (const node of nodes) {
        if (tweetForQuoteCheck && isInsideQuoteTweet(node, tweetForQuoteCheck)) continue;
        return node;
    }
    return null;
}

/**
 * Normalise a matched node to the element that actually carries the label TEXT.
 * On the timeline that is the anchor; on a profile header there is no anchor, so climb
 * from the icon to the nearest small ancestor holding the text.
 */
function accountTypeRoot(node) {
    const link = node.closest?.(ACCOUNT_TYPE_LINK_SELECTOR);
    if (link) return link;

    // On the profile header the icon sits five wrappers below the element that also holds
    // the label text, so the climb needs real headroom; the length guard below — not the
    // depth — is what stops us swallowing the whole header if X restructures this.
    let el = node.parentElement;
    for (let i = 0; i < 8 && el; i++) {
        const text = el.textContent.trim();
        if (text.length > 0 && text.length <= 60) return el;
        el = el.parentElement;
    }
    return node;
}

/**
 * Locate the account-type label that belongs to THIS username element.
 * @param {HTMLElement} element
 * @param {HTMLElement|null} tweet
 * @returns {HTMLElement|null}
 */
function findAccountTypeNode(element, tweet) {
    // A quoted account's label lives inside the quote card and must not be read as the
    // main author's (and vice versa) — same separation as the rest of the quote handling.
    if (isInsideQuoteTweet(element, tweet)) {
        const card = element.closest(QUOTE_CARD_SELECTOR);
        return card ? firstAccountTypeNode(card, null) : null;
    }

    if (tweet) return firstAccountTypeNode(tweet, tweet);

    // Profile header / people-list row: no article to bound the search, so walk up.
    let scope = element.parentElement;
    for (let i = 0; i < ACCOUNT_TYPE_MAX_ANCESTORS && scope; i++) {
        const found = firstAccountTypeNode(scope, null);
        if (found) return found;
        scope = scope.parentElement;
    }
    return null;
}

/**
 * Matchable tokens for an account's authenticity label, or null when it has none.
 *
 * Deliberately returns several tokens rather than one canonical type, because we cannot
 * assume how X names things: the label text ("Parody account") carries the type but is
 * localised, while the icon asset (".../parody-mask.<hash>.svg") is locale-independent but
 * only carries the type if X ships a distinct asset per label. Emitting both means a
 * blocked value matches whichever of the two happens to be meaningful — and an authenticity
 * label X adds in future is still captured instead of silently ignored.
 * @param {HTMLElement} element
 * @param {HTMLElement|null} tweet
 * @returns {Set<string>|null} lowercase tokens, e.g. {"parody account", "parody"}
 */
function getAccountTypeTokens(element, tweet) {
    const node = findAccountTypeNode(element, tweet);
    if (!node) return null;

    const tokens = new Set();
    const root = accountTypeRoot(node);

    const text = (root.textContent || '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (text && text.length <= 60) {
        tokens.add(text);
        const firstWord = text.split(' ')[0];
        if (firstWord) tokens.add(firstWord);
    }

    const img = node.tagName === 'IMG' ? node : root.querySelector('img');
    const assetMatch = (img?.getAttribute('src') || '').match(/\/([a-z0-9]+)-mask\./i);
    if (assetMatch) tokens.add(assetMatch[1].toLowerCase());

    return tokens.size > 0 ? tokens : null;
}

/**
 * Does this account's BIO contain a blocked term?
 *
 * The bio comes from the profile data X already ships with its own timeline responses
 * (see profile-cache.js), so this costs no lookup. Absent profile data simply means "not
 * blocked" — never a guess.
 * @param {string|null|undefined} screenName
 * @param {Set<string>|null} blockedBioTags - lowercase terms
 * @returns {boolean}
 */
function hasBlockedBio(screenName, blockedBioTags) {
    if (!screenName || !blockedBioTags || blockedBioTags.size === 0) return false;

    const bio = getProfile(screenName)?.bio;
    if (!bio) return false;

    const haystack = bio.toLowerCase();
    for (const term of blockedBioTags) {
        const needle = term.trim().toLowerCase();
        if (needle && haystack.includes(needle)) return true;
    }
    return false;
}

/**
 * Does this account link to a blocked domain, from its profile website or its bio?
 *
 * Like the bio, the links come from the profile data X already ships with its own
 * timeline responses (see profile-cache.js), so this costs no lookup. Absent profile
 * data simply means "not blocked" — never a guess.
 *
 * Matching is exact-host-or-subdomain, never substring: a substring test would let
 * 'throne.com' match 'not-throne.com' (false positive) and 'throne.com.evil.net' (a
 * one-line evasion for anyone who noticed).
 * @param {string|null|undefined} screenName
 * @param {Set<string>|null} blockedLinks - normalized lowercase bare hosts
 * @returns {boolean}
 */
function hasBlockedLink(screenName, blockedLinks) {
    if (!screenName || !blockedLinks || blockedLinks.size === 0) return false;

    const links = getProfile(screenName)?.links;
    if (!links || links.length === 0) return false;

    for (const host of links) {
        for (const domain of blockedLinks) {
            if (host === domain || host.endsWith(`.${domain}`)) return true;
        }
    }
    return false;
}

/**
 * Does this account carry a selected authenticity label or grey badge?
 *
 * Prefers X's STRUCTURED `parody_commentary_fan_label`, harvested from its own responses —
 * exact, and locale-independent. Falls back to the label rendered in the DOM, which is what
 * keeps this working with profile enrichment switched off and before the first timeline
 * response has landed.
 * @param {HTMLElement} element
 * @param {HTMLElement|null} tweet
 * @param {string|null|undefined} screenName
 * @param {Set<string>|null} blockedPcf - lowercase label values
 * @returns {boolean}
 */
function hasBlockedAccountLabel(element, tweet, screenName, blockedPcf) {
    if (!blockedPcf || blockedPcf.size === 0) return false;

    // Grey verification is independent of the PCF enum. A parody label must not
    // suppress grey-badge detection, and an arbitrary raw PCF string must never
    // stand in for a government badge. No extra lookup is required (#48).
    if (blockedPcf.has(GOVERNMENT_LABEL) && hasGovernmentBadge(element)) return true;
    if (blockedPcf.size === 1 && blockedPcf.has(GOVERNMENT_LABEL)) return false;
    const structured = getProfile(screenName)?.pcf;
    if (structured) return structured !== GOVERNMENT_LABEL && blockedPcf.has(structured);

    const tokens = getAccountTypeTokens(element, tweet);
    if (!tokens) return false;
    for (const value of blockedPcf) {
        if (value === GOVERNMENT_LABEL) continue;
        for (const token of tokens) {
            if (token.includes(value)) return true;
        }
    }
    return false;
}

function hasBlockedTag(displayName, blockedTags) {
    if (!blockedTags || blockedTags.size === 0) return false;
    if (!displayName) return false;

    // Extract tags from display name
    const nameTags = extractTagsFromText(displayName);
    
    // Check each tag against blocked set
    for (const tag of nameTags) {
        if (blockedTags.has(tag)) {
            return true;
        }
    }
    
    // Also check if the display name contains any blocked tag as a substring
    const displayLower = displayName.toLowerCase();
    for (const blockedTag of blockedTags) {
        const tagLower = blockedTag.toLowerCase();
        if (displayLower.includes(tagLower)) {
            return true;
        }
    }
    
    return false;
}

// ============================================
// USERNAME EXTRACTION
// ============================================

/**
 * Extract username from a UserCell element
 */
export function extractUsernameFromUserCell(userCell) {
    // Method 1: Look for UserAvatar-Container-{username} testid
    const avatarContainer = userCell.querySelector('[data-testid^="UserAvatar-Container-"]');
    if (avatarContainer) {
        const testId = avatarContainer.getAttribute('data-testid');
        const match = testId.match(/UserAvatar-Container-(.+)/);
        if (match) {
            return match[1];
        }
    }
    
    // Method 2: Look for profile links
    const profileLinks = userCell.querySelectorAll('a[href^="/"]');
    for (const link of profileLinks) {
        const href = link.getAttribute('href');
        if (href.includes('/') && href.split('/').length === 2) {
            const screenName = href.slice(1);
            if (/^[a-zA-Z0-9_]+$/.test(screenName)) {
                return screenName;
            }
        }
    }
    
    return null;
}

// ============================================
// INTERSECTION OBSERVER
// ============================================

/**
 * Start Intersection Observer for lazy processing
 */
export function startIntersectionObserver(processElementSafe, _debug) {
    if (intersectionObserver) return;
    
    intersectionObserver = new IntersectionObserver(
        entries => {
            for (const entry of entries) {
                if (entry.isIntersecting) {
                    const element = entry.target;
                    
                    intersectionObserver.unobserve(element);
                    pendingVisibility.delete(element);
                    
                    processElementSafe(element);
                }
            }
        },
        {
            rootMargin: '200px',
            threshold: 0
        }
    );
    
    observerCleanupFunctions.push(() => {
        if (intersectionObserver) {
            intersectionObserver.disconnect();
            intersectionObserver = null;
        }
        pendingVisibility.clear();
    });
}

/**
 * Queue element for processing when visible
 */
export function queueForVisibility(element, processElementSafe, debug) {
    if (hasChangedElementContext(element)) {
        const screenName = element.matches(SELECTORS.USER_CELL)
            ? extractUsernameFromUserCell(element) : extractUsername(element);
        releaseElementMarkers(element, screenName);
    }
    if (isRetryDeferred(element)) return;
    if (!intersectionObserver) {
        processElementSafe(element);
        return;
    }
    
    if (pendingVisibility.has(element) || element.dataset.xProcessed) {
        return;
    }
    
    if (pendingVisibility.size >= PENDING_VISIBILITY_MAX_SIZE) {
        const firstKey = pendingVisibility.keys().next().value;
        if (firstKey) {
            intersectionObserver.unobserve(firstKey);
            pendingVisibility.delete(firstKey);
            if (debug) debug(`Evicted oldest pending visibility entry, queue size: ${pendingVisibility.size}`);
        }
    }
    
    pendingVisibility.set(element, true);
    intersectionObserver.observe(element);
}

// ============================================
// MUTATION OBSERVER
// ============================================

/**
 * Start MutationObserver for DOM changes
 */
export function startObserver(isEnabled, processElementSafe, scanPage, debug, getFilters) {
    if (observer) return;
    
    // Start Intersection Observer
    startIntersectionObserver(processElementSafe, debug);

    let pendingElements = new Set();
    let processTimeout = null;
    let contextFrame = null;

    const scheduleContextRefresh = () => {
        if (contextFrame !== null) return;
        contextFrame = requestAnimationFrame(() => {
            contextFrame = null;
            if (!isEnabled()) return;
            releaseRecycledElements(debug);
            refreshPostContext(getFilters?.() || latestFilterSnapshot, processElementSafe);
            scanPage();
        });
    };

    const processPending = () => {
        if (pendingElements.size === 0) return;
        
        const elements = Array.from(pendingElements);
        pendingElements = new Set();
        
        for (const element of elements) {
            queueForVisibility(element, processElementSafe, debug);
        }
    };

    const scheduleProcessing = () => {
        if (processTimeout) return;
        processTimeout = setTimeout(() => {
            processTimeout = null;
            processPending();
        }, 50);
    };

    // Post identity and focal status can change while the author stays the same.
    const onNavigate = () => {
        if (!isEnabled()) return;
        scheduleContextRefresh();
    };
    startNavigationWatcher(onNavigate);

    observer = new MutationObserver(mutations => {
        if (!isEnabled()) return;

        // One string compare per batch; only does real work when the path changed.
        checkForNavigation(onNavigate);

        for (const mutation of mutations) {
            if (mutation.type === 'attributes') {
                // Only timestamp anchor hrefs can change an existing post's ID.
                if (mutation.target.tagName === 'A' && mutation.target.querySelector('time') &&
                    mutation.target.closest(SELECTORS.TWEET)) scheduleContextRefresh();
                if (mutation.attributeName === 'fill' &&
                    mutation.target.closest(VERIFIED_BADGE_SELECTOR)?.closest(SELECTORS.USERNAME)) {
                    scheduleContextRefresh();
                }
                continue;
            }
            for (const node of [...mutation.addedNodes, ...mutation.removedNodes]) {
                if (node.nodeType === Node.ELEMENT_NODE &&
                    (node.matches(`time, ${SELECTORS.TWEET}, ${SELECTORS.USERNAME}`) ||
                    node.querySelector(`time, ${SELECTORS.TWEET}, ${SELECTORS.USERNAME}`))) {
                    scheduleContextRefresh();
                }
                // A badge/path may arrive, change or disappear without replacing
                // its already-processed author. Re-evaluate locally in the same
                // coalesced pass; never cache a government verdict by username.
                if (node.nodeType === Node.ELEMENT_NODE &&
                    mutation.target.closest?.(SELECTORS.USERNAME) &&
                    (node.matches(VERIFIED_BADGE_SELECTOR) || node.querySelector(VERIFIED_BADGE_SELECTOR) ||
                        mutation.target.closest?.(VERIFIED_BADGE_SELECTOR))) {
                    scheduleContextRefresh();
                }
            }
            for (const node of mutation.addedNodes) {
                if (node.nodeType !== Node.ELEMENT_NODE) continue;

                // Check if the node itself matches (single combined check)
                if (node.matches && node.matches(COMBINED_USER_SELECTOR)) {
                    if (!node.dataset.xProcessed || hasChangedElementContext(node)) {
                        pendingElements.add(node);
                    }
                }

                // Query descendants with combined selector (single DOM query).
                // Skip leaf nodes (no element children): they can't contain a match, and
                // X emits constant churn of such nodes (icons, text spans, animation
                // layers) during scroll. The self-check above already covers the node itself.
                if (node.querySelectorAll && node.firstElementChild) {
                    const elements = node.querySelectorAll(COMBINED_USER_SELECTOR);
                    for (let i = 0; i < elements.length; i++) {
                        const el = elements[i];
                        if (!el.dataset.xProcessed || hasChangedElementContext(el)) {
                            pendingElements.add(el);
                        }
                    }
                }
            }
        }

        if (pendingElements.size > 0) {
            scheduleProcessing();
        }
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['href', 'fill']
    });

    // Initial scan
    scanPage();
    scheduleContextRefresh();
    
    // Delayed scan after X loads
    const initialScanTimeout = setTimeout(() => scanPage(), 2000);
    
    observerCleanupFunctions.push(() => {
        clearTimeout(initialScanTimeout);
        if (processTimeout !== null) clearTimeout(processTimeout);
        if (contextFrame !== null) cancelAnimationFrame(contextFrame);
        pendingElements.clear();
        if (observer) {
            observer.disconnect();
            observer = null;
        }
    });
}

/**
 * Scan the current page for username elements
 */
export function scanPage(isEnabled, processElementsBatch, debug) {
    if (!isEnabled()) return;

    // Use cached combined selector for single DOM query (better performance)
    const elements = document.querySelectorAll(COMBINED_USER_SELECTOR);

    if (elements.length > 0 && debug) {
        debug(`Found ${elements.length} user elements to process`);
    }

    processElementsBatch(Array.from(elements));
}

/**
 * Process elements in batches
 */
export function processElementsBatch(elements, processElementSafe, debug) {
    if (elements.length === 0) return;

    for (const element of elements) {
        queueForVisibility(element, processElementSafe, debug);
    }
}

// ============================================
// USER ELEMENT PROCESSING
// ============================================

/**
 * Safe wrapper for processElement with error boundary
 */
export function createProcessElementSafe(processElement) {
    return function processElementSafe(element) {
        try {
            processElement(element).catch(error => {
                console.error('X-Posed: Error processing element:', error.message);
                if (element && element.dataset) {
                    element.dataset.xProcessed = 'error';
                }
            });
        } catch (error) {
            console.error('X-Posed: Sync error processing element:', error.message);
            if (element && element.dataset) {
                element.dataset.xProcessed = 'error';
            }
        }
    };
}

/**
 * Process a single username element
 */
export async function processElement(element, {
    blockedCountries,
    blockedRegions,
    blockedTags,
    blockedBioTags,
    blockedLinks,
    blockedPcf,
    blockedLanguages,
    blockedAffiliations,
    allowedUsers,
    settings,
    csrfToken,
    sendMessage,
    fetchUserInfoViaPage,
    debug,
    debugMode
}) {
    if (!element.isConnected) return;
    const isUserCell = element.matches && element.matches(SELECTORS.USER_CELL);
    
    const screenName = isUserCell
        ? extractUsernameFromUserCell(element)
        : extractUsername(element);
        
    if (!screenName) {
        return;
    }
    
    // Validate screen name to prevent injection attacks
    if (!isValidScreenName(screenName)) {
        if (debug) debug(`Invalid screen name rejected: ${screenName.substring(0, 20)}...`);
        return;
    }
    const tweet = element.closest(SELECTORS.TWEET);
    const isQuoteAtStart = isInsideQuoteTweet(element, tweet);
    const movedToAnotherTweet = hasChangedElementContext(element);
    if (isRetryDeferred(element, screenName)) return;
    clearRetryState(element);
    
    // Handle element recycling
    if (element.dataset.xScreenName) {
        const previousScreenName = element.dataset.xScreenName;
        if (previousScreenName === screenName && !movedToAnotherTweet) {
            // Already resolved for this user, and the outcome is terminal: a badge means a
            // visible row; data-x-block="hide" means we deliberately hid it (VPN or a list
            // block). Either way, don't reprocess on every scan — that was a per-scan busy
            // loop on badge-less hidden rows. Recovery still happens because a settings
            // change clears xProcessed (see content-script SETTINGS_UPDATED) and a
            // blocked-list change re-derives directly via runUpdateBlockedTweets.
            if (element.dataset.xProcessed &&
                (element.querySelector(`.${CSS_CLASSES.INFO_BADGE}`) || element.dataset.xBlock === 'hide')) {
                return;
            }
        } else {
            if (debug) debug(`Element recycled: @${previousScreenName} → @${screenName}`);
            releaseElementMarkers(element, screenName);
        }
    }
    
    element.dataset.xProcessed = 'true';
    element.dataset.xScreenName = screenName;
    const processingToken = {};
    elementProcessingTokens.set(element, processingToken);
    elementTweetContexts.set(element, tweet);
    elementQuoteContexts.set(element, isQuoteAtStart);
    const isCurrentElement = () => {
        if (!element.isConnected || elementProcessingTokens.get(element) !== processingToken ||
            element.dataset.xScreenName !== screenName || element.closest(SELECTORS.TWEET) !== tweet ||
            isInsideQuoteTweet(element, tweet) !== isQuoteAtStart) return false;
        const currentName = isUserCell ? extractUsernameFromUserCell(element) : extractUsername(element);
        return currentName?.toLowerCase() === screenName.toLowerCase();
    };

    if (debug) debug(`Processing @${screenName}`);

    // Language blocking is a per-tweet signal (X's own lang tag), independent of the
    // author lookup — apply it eagerly here, before any early return below, so
    // media/API state can't gate it. Marks the article via a separate data-x-lang-block.
    // (Skips allowlisted authors — data-x-screen-name is already set above.)
    applyLanguageBlock(tweet, blockedLanguages, settings, allowedUsers);

    // In HIDE mode a language-blocked article is fully hidden by CSS, so skip the badge
    // AND the user-info lookup entirely — otherwise blocking a common language would fire
    // a lookup per hidden tweet (mirrors the blocked-tag short-circuit). xScreenName is
    // already set above, so unblocking the language re-derives the row via the article
    // pass in runUpdateBlockedTweets. HIGHLIGHT mode keeps the badge (row stays visible).
    if (tweet && tweet.dataset.xLangBlock === 'hide') {
        return;
    }

    // Shared opts for applyInfoToElement across all three resolution paths
    const applyOpts = {
        blockedCountries,
        blockedRegions,
        blockedTags,
        blockedLanguages,
        blockedAffiliations,
        blockedBioTags,
        blockedLinks,
        blockedPcf,
        allowedUsers,
        settings,
        isUserCell,
        tweet,
        debug,
        csrfToken
    };
    const startedFilterRevision = filterRevision;
    const applyCurrentInfo = info => {
        if (!isCurrentElement()) return;
        const currentOpts = latestFilterSnapshot && filterRevision !== startedFilterRevision
            ? { ...applyOpts, ...latestFilterSnapshot }
            : applyOpts;
        applyLanguageBlock(tweet, currentOpts.blockedLanguages, currentOpts.settings, currentOpts.allowedUsers);
        applyInfoToElement(element, screenName, info, {
            ...currentOpts,
            tagBlocked: currentOpts.blockedTags?.size > 0 &&
                hasBlockedTag(extractDisplayName(element), currentOpts.blockedTags)
        });
    };

    // Name/bio/label filters already have their inputs, even if location is unknown,
    // negatively cached, or a lookup fails. Apply them before any network work (#57).
    // A quoted verdict only collapses its card; the lookup can still populate its badge.
    applyCurrentInfo(userInfoCache.get(screenName) || null);

    // Check local cache
    if (userInfoCache.has(screenName)) {
        if (debug) debug(`Using local cache for @${screenName}`);
        return;
    }
    if (element.dataset.xBlock === 'hide') return;

    // Check if request in flight - use promise-based waiting instead of arbitrary timeout
    if (processingQueue.has(screenName)) {
        // Wait for the in-flight request to complete using the stored promise
        const pendingPromise = processingQueue.get(screenName);
        let result;
        if (pendingPromise && typeof pendingPromise.then === 'function') {
            try {
                result = await pendingPromise;
            } catch {
                // Ignore errors - we'll check cache below
            }
        }
        
        // The row may have changed while waiting; applyCurrentInfo checks ownership.
        applyCurrentInfo(userInfoCache.get(screenName) || null);
        if (result?.retryAt && isCurrentElement()) deferElementRetry(element, screenName, result.retryAt);
        return;
    }

    // Create the processing promise and store it for waiting
    let resolveProcessing;
    let retryAt = null;
    const processingPromise = new Promise(resolve => {
        resolveProcessing = resolve;
    });
    // Evict oldest entry if queue is at capacity
    if (processingQueue.size >= PROCESSING_QUEUE_MAX_SIZE) {
        const firstKey = processingQueue.keys().next().value;
        if (firstKey) {
            processingQueue.delete(firstKey);
            if (debug) debug(`Evicted oldest processing entry (${firstKey}), queue was full`);
        }
    }
    
    processingQueue.set(screenName, processingPromise);
    
    const processingTimeout = setTimeout(() => {
        if (processingQueue.get(screenName) === processingPromise) {
            if (debug) debug(`Cleaning up stale processing entry for @${screenName}`);
            processingQueue.delete(screenName);
            resolveProcessing();
        }
    }, 30000);
    
    // Show shimmer in debug mode
    let shimmer = null;
    if (debugMode) {
        shimmer = document.createElement('span');
        shimmer.className = CSS_CLASSES.FLAG_SHIMMER;
        const insertionPoint = isUserCell
            ? findUserCellInsertionPoint(element, screenName)
            : findInsertionPoint(element, screenName);
        if (insertionPoint) {
            insertionPoint.target.insertBefore(shimmer, insertionPoint.ref);
        }
    }

    try {
        let response = await sendMessage({
            type: MESSAGE_TYPES.FETCH_USER_INFO,
            payload: { screenName, csrfToken }
        });

        // Issue #14: if the background can't authenticate (e.g. a Firefox container
        // cookie mismatch), retry the lookup from the PAGE context — which uses the
        // page's own correct session — then cache the result via the background.
        if ((response?.code === 'UNAUTHORIZED' || response?.code === 'NO_HEADERS') && fetchUserInfoViaPage) {
            const pageResponse = await fetchUserInfoViaPage(screenName);
            // Keep the page's actual failure code too, so a rate limit or timeout
            // isn't mislabeled as the background's original authentication failure.
            if (pageResponse) response = { ...pageResponse, source: 'page' };
            if (pageResponse?.success) {
                await sendMessage({
                    type: MESSAGE_TYPES.SET_CACHE,
                    payload: { screenName, data: pageResponse.data }
                });
            }
        }

        if (shimmer) shimmer.remove();

        if (!response?.success || !response.data) {
            const code = response?.code;
            const isTransient = code === 'RATE_LIMITED' || code === 'NETWORK_ERROR' || code === 'TIMEOUT';
            if (isTransient) retryAt = retryDeadline(response);
            if (!isCurrentElement()) return;
            applyCurrentInfo(null);
            if (retryAt) deferElementRetry(element, screenName, retryAt);
            if (response?.code === 'RATE_LIMITED') {
                const resetDate = response.retryAfter ? new Date(response.retryAfter) : null;
                let resetStr = 'unknown';
                let relativeStr = '';
                
                if (resetDate) {
                    resetStr = resetDate.toLocaleTimeString();
                    const now = Date.now();
                    const diffMs = resetDate.getTime() - now;
                    
                    if (diffMs > 0) {
                        const diffMins = Math.ceil(diffMs / 60000);
                        if (diffMins >= 60) {
                            const hours = Math.floor(diffMins / 60);
                            const mins = diffMins % 60;
                            relativeStr = mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
                        } else {
                            relativeStr = `${diffMins} min${diffMins > 1 ? 's' : ''}`;
                        }
                    }
                }
                
                console.warn(`⚠️ X-Posed: Rate limited! Resets at ${resetStr}${relativeStr ? ` (in ${relativeStr})` : ''}`);
                
                const now = Date.now();
                if (now - lastRateLimitToastTime > TIMING.RATE_LIMIT_TOAST_COOLDOWN_MS) {
                    lastRateLimitToastTime = now;
                    showRateLimitToast(relativeStr || 'a few minutes');
                }
            } else if (response?.error) {
                if (debug) debug(`API error for @${screenName}: ${response.error}`);
            }

            // Issue #14: on auth failure (the in-page fetch fallback above also failed),
            // clear the processed markers so the element is retried once fresh headers
            // are captured — rather than being negative-cached for the session.
            if (response?.code === 'UNAUTHORIZED' || response?.code === 'NO_HEADERS') {
                delete element.dataset.xProcessed;
                return;
            }

            // Issue #16: do NOT negative-cache other TRANSIENT failures (rate-limit,
            // network) for the session — caching null used to blank the user until LRU
            // eviction or a reload, even after the condition cleared. Only genuine
            // misses (not-found/unknown) are negative-cached.
            if (!isTransient) {
                userInfoCache.set(screenName, null);
            }
            return;
        }

        const info = response.data;
        if (debug) debug(`Received data for @${screenName}:`, { location: info.location, device: info.device });

        userInfoCache.set(screenName, info);

        applyCurrentInfo(info);
    } catch (error) {
        // Issue #16: a thrown error (e.g. messaging/network blip) is transient, so we
        // do NOT negative-cache it — the user is retried on a later scan rather than
        // being blanked for the session.
        applyCurrentInfo(null);
        retryAt = retryDeadline(null);
        if (isCurrentElement()) deferElementRetry(element, screenName, retryAt);
        if (debug) debug(`Processing error for @${screenName}: ${error?.message || error}`);
    } finally {
        if (shimmer) shimmer.remove();
        clearTimeout(processingTimeout);
        if (processingQueue.get(screenName) === processingPromise) processingQueue.delete(screenName);
        resolveProcessing({ retryAt }); // Waiting rows inherit the same retry deadline.
    }
}

// ============================================
// BLOCKED TWEETS UPDATE
// ============================================

function applyAvailableFilters(element, screenName, filters) {
    const tweet = element.closest(SELECTORS.TWEET);
    const isUserCell = element.matches(SELECTORS.USER_CELL);
    element.dataset.xScreenName = screenName;
    applyLanguageBlock(tweet, filters.blockedLanguages, filters.settings, filters.allowedUsers);
    applyInfoToElement(element, screenName, userInfoCache.get(screenName) || null, {
        ...filters, tweet, isUserCell,
        tagBlocked: filters.blockedTags?.size > 0 &&
            hasBlockedTag(extractDisplayName(element), filters.blockedTags)
    });
}

/**
 * Release rendered rows for a settings rescan, including collapsed quotes whose
 * children otherwise never intersect the viewport. Invalidate outstanding applies
 * at the same time so replies from the previous settings cannot restore old state.
 * Explicitly revealed quotes remain revealed until their element is recycled.
 */
export function resetProcessedElements(filters) {
    const retryRows = Array.from(document.querySelectorAll('[data-x-retry-after]'));
    document.querySelectorAll(`.${CSS_CLASSES.INFO_BADGE}`).forEach(el => el.remove());
    document.querySelectorAll('[data-x-processed], [data-x-screen-name]').forEach(el => {
        elementProcessingTokens.delete(el);
        delete el.dataset.xProcessed;
        delete el.dataset.xScreenName;
    });
    document.querySelectorAll('.x-tweet-blocked, .x-tweet-vpn-blocked, .x-tweet-highlighted')
        .forEach(el => el.classList.remove('x-tweet-blocked', 'x-tweet-vpn-blocked', 'x-tweet-highlighted'));
    document.querySelectorAll('[data-x-block]').forEach(el => { delete el.dataset.xBlock; });
    document.querySelectorAll('[data-x-lang-block]').forEach(el => { delete el.dataset.xLangBlock; });
    document.querySelectorAll('[data-x-quote-block], [data-x-quote-reason], [data-x-quote-label]').forEach(el => {
        if (el.dataset.xQuoteBlock !== 'shown') delete el.dataset.xQuoteBlock;
        delete el.dataset.xQuoteReason;
        if (el.dataset.xQuoteBlock !== 'shown') delete el.dataset.xQuoteLabel;
    });

    // Waiting rows skip the visibility queue, but their already-known filters
    // must still reflect settings changes. This pass performs no lookup.
    if (filters) {
        for (const element of retryRows) {
            const isUserCell = element.matches(SELECTORS.USER_CELL);
            const screenName = isUserCell ? extractUsernameFromUserCell(element) : extractUsername(element);
            if (!screenName || !isRetryDeferred(element, screenName)) continue;
            applyAvailableFilters(element, screenName, filters);
        }
    }
}

// Coalesce rapid BLOCKED_COUNTRIES/REGIONS/TAGS updates into a single rAF pass.
// Each trigger fires updateBlockedTweets separately; without batching that means
// one full-document querySelectorAll (+ closest()/querySelector per match) per
// trigger. We keep only the LATEST args and run a single scan on the next frame.
let pendingBlockedTweetsUpdate = null;
let pendingBlockedTweetsArgs = null;

/**
 * Update visibility of tweets based on blocked countries and regions.
 * Coalesced: multiple calls within the same frame collapse into one DOM pass
 * using the most recent arguments.
 * @param {Set} blockedCountries - Set of blocked country names (lowercase)
 * @param {Set} blockedRegions - Set of blocked region names (lowercase)
 * @param {Set} blockedTags - Set of blocked tags (lowercase)
 * @param {Object} settings - Settings object with highlightBlockedTweets flag
 * @param {Set} [blockedLinks] - Set of blocked linked domains (normalized bare hosts)
 */
export function updateBlockedTweets(filters) {
    pendingBlockedTweetsArgs = filters || {};
    latestFilterSnapshot = pendingBlockedTweetsArgs;
    filterRevision++;
    if (pendingBlockedTweetsUpdate !== null) return;

    pendingBlockedTweetsUpdate = requestAnimationFrame(() => {
        pendingBlockedTweetsUpdate = null;
        const args = pendingBlockedTweetsArgs;
        pendingBlockedTweetsArgs = null;
        if (args) runUpdateBlockedTweets(args);
    });
}

/**
 * Perform the actual single-pass tweet visibility update. See updateBlockedTweets.
 */
function runUpdateBlockedTweets({
    blockedCountries,
    blockedRegions,
    blockedTags,
    blockedBioTags = null,
    blockedLinks = null,
    blockedPcf = null,
    settings = {},
    blockedLanguages = null,
    allowedUsers = null,
    blockedAffiliations = null
} = {}) {
    const highlightMode = settings.highlightBlockedTweets === true;
    const hasTags = blockedTags && blockedTags.size > 0;
    const loggedInUser = getLoggedInUsername();

    document.querySelectorAll('[data-x-screen-name]').forEach(element => {
        const tweet = element.closest(SELECTORS.TWEET);
        // People-list rows have no enclosing tweet, but they still need re-deriving when a
        // filter changes — otherwise adding a country would flag nothing on Followers /
        // Following until a reload.
        const isUserCell = !tweet && !!element.matches && element.matches(SELECTORS.USER_CELL);
        if (!tweet && !isUserCell) return;

        const screenName = element.dataset.xScreenName;
        const isSelf = !!loggedInUser && !!screenName && screenName.toLowerCase() === loggedInUser.toLowerCase();
        // Allowlisted accounts are exempt from every filter, like your own account (issue #26).
        const isExempt = isSelf || (!!screenName && !!allowedUsers && allowedUsers.has(screenName.toLowerCase()));
        const isQuote = isInsideQuoteTweet(element, tweet);

        const locationLower = canonicalCountry(element.dataset.xCountry);
        const isBlockedCountry = locationLower !== '' && blockedCountries.has(locationLower);
        const isBlockedRegion = locationLower !== '' && blockedRegions && blockedRegions.has(locationLower);

        // Re-derive tag-blocking from the CURRENT blocked-tags set against the live
        // display name (the row is still on screen). This is what makes adding OR
        // removing a tag re-apply to already-rendered tweets — and, because we never
        // trust a cached flag, a recycled row can't inherit a previous occupant's block.
                const isTagBlocked = hasTags && hasBlockedTag(extractDisplayName(element), blockedTags);
        const isBioBlocked = hasBlockedBio(screenName, blockedBioTags);
        const isLinkBlocked = hasBlockedLink(screenName, blockedLinks);
        const isLabelBlocked = hasBlockedAccountLabel(element, tweet, screenName, blockedPcf);

        // Affiliation lives on the cached info, keyed by name, like locationAccurate below.
        const cachedInfo = screenName ? userInfoCache.get(screenName) : null;
        const isAffiliationBlocked = hasBlockedAffiliation(cachedInfo?.meta, blockedAffiliations);

        // Who-they-are filters apply to quoted authors too; applyBlockState routes a
        // quoted verdict to the card-only marker instead of the row (issue #32).
        const blockReason = resolveBlockReason({
            isExempt, isBlockedCountry, isBlockedRegion, isTagBlocked,
            isBioBlocked, isLinkBlocked, isLabelBlocked, isAffiliationBlocked
        });
        const matchesBlockList = blockReason !== '';

        // Location uncertainty is a setting, not a blocked-list entry, but a list edit
        // must retain its verdict. The presentation follows hide/highlight mode too.
        // locationAccurate lives on the cached info, keyed by name.
        // Never for a quoted author: that would hide the quoting user's own post.
        const info = screenName ? userInfoCache.get(screenName) : null;
        const isVpnHidden = !isQuote && !!info && info.locationAccurate === false &&
            settings.showVpnUsers === false && !isExempt;

        const { hide } = applyBlockState(element, tweet, {
            isListBlocked: matchesBlockList,
            isVpnHidden,
            highlightMode,
            isQuote,
            neverHide: isUserCell,
            reason: blockReason
        });

        const badge = element.querySelector(`.${CSS_CLASSES.INFO_BADGE}`);
        if (badge) badge.style.display = hide ? 'none' : '';
    });

    // Language blocking is per-tweet (not per-author), so re-derive it across ALL
    // articles — this is what makes adding OR removing a language re-apply to
    // already-rendered tweets. applyLanguageBlock authoritatively sets or clears the
    // marker, so a removed language un-hides its tweets. Runs only on config/setting
    // changes (this pass is rAF-coalesced), not per scroll.
    document.querySelectorAll(SELECTORS.TWEET).forEach(tweet => {
        applyLanguageBlock(tweet, blockedLanguages, settings, allowedUsers);
    });
}

// ============================================
// QUOTE REVEAL (issue #32)
// ============================================

/** Quote cards are clickable containers — see isInsideQuoteTweet. */
const QUOTE_CARD_SELECTOR = 'div[role="link"][tabindex="0"]';

let quoteRevealBound = false;

/**
 * Let the reader open a collapsed quote card ("click to show"). Delegated on document
 * in the CAPTURE phase so we run before X's own card handler and can stop it from
 * navigating to the quoted post. Nothing is injected into the DOM, so X re-rendering
 * a row can't break this — the reveal is just a marker flip that CSS reacts to.
 * Idempotent: safe to call more than once.
 */
export function setupQuoteReveal() {
    if (quoteRevealBound) return;
    quoteRevealBound = true;

    const reveal = event => {
        const target = event.target;
        if (!target || typeof target.closest !== 'function') return;

        const card = target.closest(QUOTE_CARD_SELECTOR);
        if (!card) return;

        const marker = card.querySelector('[data-x-quote-block="hide"]');
        if (!marker) return;

        // Swallow the interaction before X navigates to the quoted post.
        event.preventDefault();
        event.stopPropagation();
        marker.dataset.xQuoteBlock = 'shown';
    };

    document.addEventListener('click', reveal, true);
    document.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') reveal(event);
    }, true);
}

// ============================================
// SPA NAVIGATION (issue #40)
// ============================================

function releaseElementMarkers(element, currentScreenName) {
    element.querySelector(`.${CSS_CLASSES.INFO_BADGE}`)?.remove();
    elementProcessingTokens.delete(element);
    elementTweetContexts.delete(element);
    elementQuoteContexts.delete(element);
    delete element.dataset.xProcessed;
    delete element.dataset.xScreenName;
    delete element.dataset.xCountry;
    delete element.dataset.xBlock;
    delete element.dataset.xQuoteBlock;
    delete element.dataset.xQuoteReason;
    element.closest('div[role="link"][tabindex="0"]')?.removeAttribute('data-x-quote-label');
    if (isValidScreenName(currentScreenName)) element.dataset.xScreenName = currentScreenName;
}

/**
 * Re-derive post presentation after route or timestamp changes. A newly opened
 * focal post can have been hidden before its identity was known, so its main
 * author must bypass the visibility queue once to recover the badge/lookup.
 * Unknown identity never receives that exception; quoted authors remain lazy.
 */
export function refreshPostContext(filters, processElementSafe) {
    if (!filters) return;
    const focalElements = [];
    for (const tweet of document.querySelectorAll(SELECTORS.TWEET)) {
        const previous = postContexts.get(tweet);
        const id = ownPostId(tweet);
        const current = {
            id,
            focal: isFocalTweet(tweet),
            lastKnownId: id || previous?.lastKnownId || null
        };
        postContexts.set(tweet, current);
        const changed = !previous || previous.id !== current.id || previous.focal !== current.focal;
        if (previous?.lastKnownId && current.id && previous.lastKnownId !== current.id) {
            // A reveal belongs to the quoted post in this outer post, not to a
            // recycled article. Route-only changes keep the explicit reveal.
            for (const element of tweet.querySelectorAll('[data-x-quote-block]')) {
                delete element.dataset.xQuoteBlock;
                delete element.dataset.xQuoteReason;
            }
        }

        // A username can move to a different article without taking the old
        // article's classes with it. Rebuild those classes from current authors.
        tweet.classList.remove(CSS_CLASSES.TWEET_BLOCKED, 'x-tweet-vpn-blocked', 'x-tweet-highlighted');
        if (!current.focal) continue;
        for (const element of tweet.querySelectorAll(SELECTORS.USERNAME)) {
            if (element.closest(SELECTORS.TWEET) !== tweet || isInsideQuoteTweet(element, tweet)) continue;
            if (!element.dataset.xProcessed ||
                (changed && !element.querySelector(`.${CSS_CLASSES.INFO_BADGE}`))) {
                focalElements.push(element);
            }
        }
    }

    latestFilterSnapshot = filters;
    filterRevision++;
    // Moving a deferred account must not bypass its already-known name/bio/label
    // filters. Restore that state locally while keeping the network deadline.
    for (const element of document.querySelectorAll('[data-x-retry-after]')) {
        const screenName = element.matches(SELECTORS.USER_CELL)
            ? extractUsernameFromUserCell(element) : extractUsername(element);
        if (isValidScreenName(screenName) && isRetryDeferred(element, screenName)) {
            applyAvailableFilters(element, screenName, filters);
        }
    }
    runUpdateBlockedTweets(filters);
    for (const element of focalElements) {
        elementProcessingTokens.delete(element);
        delete element.dataset.xProcessed;
        intersectionObserver?.unobserve(element);
        pendingVisibility.delete(element);
        processElementSafe(element);
    }
}

/**
 * Drop our markers from elements X has recycled for a DIFFERENT account.
 *
 * processElement already detects recycling — but only when it is actually invoked, and
 * nothing re-invokes it on an in-place SPA navigation. Elements reach it via the
 * MutationObserver (added nodes only) or scanPage, and queueForVisibility skips anything
 * already carrying data-x-processed. So when X reuses the profile header for a different
 * account — swapping only the TEXT inside it, which adds no node matching our selector —
 * the previous account's badge, country and block verdict stay on screen and keep being
 * applied to the new account (reported as @anurag_vb showing @anurag's data).
 *
 * Clearing the markers here is what lets the following scanPage re-derive the row from
 * scratch. Uses the same extractors as processElement, so the two can't disagree about
 * who a given element now belongs to.
 * @param {Function} [debug]
 * @returns {number} how many elements were released
 */
export function releaseRecycledElements(debug) {
    let released = 0;

    document.querySelectorAll('[data-x-screen-name]').forEach(element => {
        const isUserCell = !!element.matches && element.matches(SELECTORS.USER_CELL);
        const current = isUserCell
            ? extractUsernameFromUserCell(element)
            : extractUsername(element);

        const moved = hasChangedElementContext(element);
        // An unchanged handle does not imply an unchanged article.
        if (!current || (current === element.dataset.xScreenName && !moved)) return;

        releaseElementMarkers(element, current);
        released++;
    });

    if (released > 0 && debug) {
        debug(`Navigation: released ${released} recycled element(s)`);
    }
    return released;
}

// X swaps the header content asynchronously after the URL changes, so a single pass can
// land before the new account is in the DOM (we'd re-read the OLD handle and conclude
// nothing changed). Re-check across a short settle window instead.
const NAV_SETTLE_DELAYS_MS = [150, 600, 1500];

let lastPath = '';
let navTimeouts = [];

/**
 * Detect an in-place SPA navigation and re-derive recycled rows.
 *
 * Deliberately NOT done by patching history.pushState: content scripts run in an isolated
 * world, so a patch here never sees the page's own calls. We piggyback on the
 * MutationObserver instead (X mutates heavily during navigation, so this fires promptly
 * and costs one string compare per batch) with popstate covering back/forward.
 * @param {Function} onNavigate - invoked after each settle-window pass
 */
function checkForNavigation(onNavigate) {
    if (typeof location === 'undefined' || location.pathname === lastPath) return;
    lastPath = location.pathname;

    onNavigate();
    for (const id of navTimeouts) clearTimeout(id);
    navTimeouts = NAV_SETTLE_DELAYS_MS.map(delay => setTimeout(onNavigate, delay));
}

/**
 * Start watching for SPA navigations. Idempotent per observer lifecycle.
 * @param {Function} onNavigate
 */
export function startNavigationWatcher(onNavigate) {
    lastPath = typeof location !== 'undefined' ? location.pathname : '';

    const onPopState = () => checkForNavigation(onNavigate);
    window.addEventListener('popstate', onPopState);

    observerCleanupFunctions.push(() => {
        window.removeEventListener('popstate', onPopState);
        for (const id of navTimeouts) clearTimeout(id);
        navTimeouts = [];
    });
}

// ============================================
// CLEANUP
// ============================================

/**
 * Cleanup all observer resources
 */
export function cleanupObservers() {
    for (const cleanupFn of observerCleanupFunctions) {
        try {
            cleanupFn();
        } catch (error) {
            console.error('X-Posed: Observer cleanup error:', error);
        }
    }
    observerCleanupFunctions.length = 0;

    // Cancel any pending coalesced blocked-tweets update
    if (pendingBlockedTweetsUpdate !== null) {
        cancelAnimationFrame(pendingBlockedTweetsUpdate);
        pendingBlockedTweetsUpdate = null;
        pendingBlockedTweetsArgs = null;
    }

    // Clear all processing queues properly
    elementProcessingTokens = new WeakMap();
    elementTweetContexts = new WeakMap();
    elementQuoteContexts = new WeakMap();
    postContexts = new WeakMap();
    latestFilterSnapshot = null;
    processingQueue.clear();
    userInfoCache.clear();
    pendingVisibility.clear();
}
