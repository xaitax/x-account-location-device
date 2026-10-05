/**
 * Observer Module
 * Handles DOM observation, user processing, and caching
 */

import { SELECTORS, CSS_CLASSES, MESSAGE_TYPES, TIMING, canonicalCountry, GOVERNMENT_LABEL } from '../shared/constants.js';
import { extractUsername, findInsertionPoint, getLoggedInUsername, extractTagsFromText, getDeviceCountry } from '../shared/utils.js';
import { createBadge, findUserCellInsertionPoint, showRateLimitToast } from './ui.js';
import { LRUCache } from '../shared/lru-cache.js';
import { getProfile } from './profile-cache.js';
import { isFollowing } from './following-cache.js';
import { isFocalTweet, ownPostId, quotedPostId, QUOTE_CARD_SELECTOR, quoteCardOf } from './post-identity.js';
import { hasGovernmentBadge, VERIFIED_BADGE_SELECTOR } from './government-badge.js';
import { findBlockedDomain, findBlockedExactUrl } from '../shared/domain-utils.js';
import { createFilterPlaceholder, updateFilterPlaceholder } from './filter-placeholder.js';
import { createRelatedPostController } from './related-posts.js';
import { rememberPostRelation } from './post-relations-cache.js';
import { matchingBlockedRegions } from '../shared/region-membership.js';
import { captureDisplayName, emojiImageText } from './display-name.js';
import {
    ACCOUNT_COUNT_FILTERS, countDisplayNameDigits, countHandleDigits, isAccountCountThreshold, matchesAccountCount
} from '../shared/account-counts.js';

let filterStatisticsReporter = null;
let displayNameCounts = new WeakMap();

/** The content session owns reporting. Standalone observers perform no messaging. */
export function setFilterStatisticsReporter(reporter) {
    filterStatisticsReporter = reporter;
}

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
export function effectiveCountry(info, flagFromDevice) {
    if (flagFromDevice && info?.device) {
        const deviceCountry = getDeviceCountry(info.device);
        if (deviceCountry) return deviceCountry;
    }
    return info?.location || null;
}

/** The reader and Always Show accounts are exempt from every filter. */
function isAuthorExempt(screenName, allowedUsers, settings, loggedInUser = getLoggedInUsername()) {
    const author = screenName?.toLowerCase();
    return !!author && (author === loggedInUser?.toLowerCase() || allowedUsers?.has(author) === true ||
        (settings?.alwaysShowFollowing === true && isFollowing(author)));
}

/** Assemble the same author verdict for first resolution and live filter updates. */
function resolveAuthorBlockState(element, screenName, info, filters, tweet, isUserCell,
    loggedInUser = getLoggedInUsername()) {
    const { blockedCountries, blockedRegions, blockedTags, blockedBioTags, blockedLinks,
        blockedPcf, blockedAffiliations, allowedUsers, settings } = filters;
    const isExempt = isAuthorExempt(screenName, allowedUsers, settings, loggedInUser);
    const isQuote = isInsideQuoteTweet(element, tweet);
    const location = canonicalCountry(element.dataset.xCountry);
    const profile = settings.profileEnrichment === false ? null : getProfile(screenName);
    const displayName = blockedTags?.size || settings.minDisplayNameDigits > 0
        ? extractDisplayName(element, false, screenName) : undefined;
    const accountCountReasons = resolveAccountCountReasons(screenName, profile, settings, displayName);
    if (settings.minDisplayNameDigits > 0) displayNameCounts.set(element, countDisplayNameDigits(displayName));
    const reasons = resolveBlockReasons({
        isExempt,
        isBlockedCountry: location !== '' && blockedCountries.has(location),
        isBlockedRegion: matchingBlockedRegions(location, blockedRegions, settings.regionCountrySelections).length > 0,
        isTagBlocked: blockedTags?.size > 0 && hasBlockedTag(displayName, blockedTags),
        isBioBlocked: hasBlockedBio(profile, blockedBioTags, settings),
        isLinkBlocked: hasBlockedLink(profile, blockedLinks, settings),
        isLabelBlocked: hasBlockedAccountLabel(element, tweet, blockedPcf, profile),
        isAffiliationBlocked: hasBlockedAffiliation(info?.meta, blockedAffiliations),
        accountCountReasons
    });
    return {
        isListBlocked: reasons.length > 0,
        // A quoted account's location warning must not hide the quoting author's post.
        isVpnHidden: !isQuote && info?.locationAccurate === false && settings.showVpnUsers === false && !isExempt,
        highlightMode: settings.highlightBlockedTweets === true,
        isQuote,
        neverHide: isUserCell,
        reasons
    };
}

/** Unknown counts/names never stand in for an observed value. */
function resolveAccountCountReasons(screenName, profile, settings, displayName) {
    const reasons = [];
    for (const rule of ACCOUNT_COUNT_FILTERS) {
        const threshold = settings[rule.key];
        if (!isAccountCountThreshold(threshold, rule.max) || threshold === 0) continue;
        let count;
        if (rule.requiresProfile) count = profile?.[rule.profileField];
        else if (rule.key === 'minHandleDigits') count = countHandleDigits(screenName);
        else if (rule.key === 'minDisplayNameDigits' && typeof displayName === 'string') count = countDisplayNameDigits(displayName);
        if (matchesAccountCount(count, threshold)) reasons.push(rule.reason);
    }
    return reasons;
}

/**
 * Ordered filter categories, shared by initial resolution and live updates.
 * Presentation never needs to parse a comma-separated verdict or profile text.
 */
function resolveBlockReasons({ isExempt, isBlockedCountry, isBlockedRegion, isTagBlocked,
    isBioBlocked, isLinkBlocked, isLabelBlocked, isAffiliationBlocked, accountCountReasons = [] }) {
    if (isExempt) return [];
    const reasons = [];
    if (isBlockedCountry) reasons.push('country');
    if (isBlockedRegion) reasons.push('region');
    if (isTagBlocked) reasons.push('tag');
    if (isBioBlocked) reasons.push('bio');
    if (isLinkBlocked) reasons.push('link');
    if (isLabelBlocked) reasons.push('label');
    if (isAffiliationBlocked) reasons.push('affiliation');
    reasons.push(...accountCountReasons);
    return reasons;
}

const BLOCK_REASON_LABELS = {
    country: 'Country', region: 'Region', tag: 'Display name', bio: 'Bio or profile location',
    link: 'Linked domain / URL', label: 'Account label', affiliation: 'Affiliation',
    vpn: 'Location warning', language: 'Post language',
    ...Object.fromEntries(ACCOUNT_COUNT_FILTERS.map(({ reason, label }) => [reason, label]))
};
const QUOTE_PLACEHOLDER_CLASS = 'x-quote-placeholder';
let quotePlaceholders = new WeakMap();
let quoteCards = new WeakMap();
let quoteOwners = new WeakMap();

function clearQuotePlaceholder(element) {
    const placeholder = quotePlaceholders.get(element);
    if (!placeholder) return;
    placeholder.remove();
    quotePlaceholders.delete(element);
}

function releaseQuoteCard(element) {
    const card = quoteCards.get(element);
    if (card && quoteOwners.get(card) === element) {
        delete card.dataset.xQuoteState;
        quoteOwners.delete(card);
    }
    quoteCards.delete(element);
    clearQuotePlaceholder(element);
}

/** Only our own button is managed; X retains ownership of the quoted content. */
function syncQuotePlaceholder(element, reasons) {
    const card = quoteCardOf(element);
    if (quoteCards.get(element) && quoteCards.get(element) !== card) releaseQuoteCard(element);
    if (card) {
        const oldOwner = quoteOwners.get(card);
        if (oldOwner && oldOwner !== element) releaseQuoteCard(oldOwner);
        quoteOwners.set(card, element);
        quoteCards.set(element, card);
        if (element.dataset.xQuoteBlock) card.dataset.xQuoteState = element.dataset.xQuoteBlock;
        else delete card.dataset.xQuoteState;
    }
    let placeholder = quotePlaceholders.get(element);
    if (placeholder && placeholder.parentElement !== card) {
        clearQuotePlaceholder(element);
        placeholder = null;
    }
    // X can replace just the author node while retaining the card and our button.
    // Retire buttons owned by the old node before creating or clearing this one.
    if (card) {
        for (const child of card.children) {
            if (child.classList.contains(QUOTE_PLACEHOLDER_CLASS) && child !== placeholder) child.remove();
        }
    }
    if (!card || element.dataset.xQuoteBlock !== 'hide') {
        clearQuotePlaceholder(element);
        return;
    }
    if (!placeholder || !placeholder.isConnected) {
        placeholder = createFilterPlaceholder({ title: 'Quoted post hidden', action: 'Show quoted post' });
        card.prepend(placeholder);
        quotePlaceholders.set(element, placeholder);
    }
    const labels = reasons.map(reason => BLOCK_REASON_LABELS[reason]).filter(Boolean);
    const summary = labels.slice(0, 2).join(' · ') + (labels.length > 2 ? ` · +${labels.length - 2} more` : '');
    const description = labels.length ? `Hidden because: ${labels.join(', ')}.` : 'Matches your filters.';
    updateFilterPlaceholder(placeholder, { reasonText: summary, description });
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
 * @param {{isListBlocked: boolean, isVpnHidden: boolean, highlightMode: boolean, isQuote?: boolean, neverHide?: boolean, reasons?: string[]}} state
 * @returns {{hide: boolean, highlight: boolean}}
 */
function applyBlockState(element, tweet, { isListBlocked, isVpnHidden, highlightMode, isQuote = false, neverHide = false, reasons = [] }) {
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
            element.dataset.xQuoteReason = isListBlocked ? reasons[0] || '' : '';
        }
        syncQuotePlaceholder(element, reasons);
        filterStatisticsReporter?.schedule(tweet);
        // Always report hide:false: the row stays, and the badge is still built so it's
        // already in place inside the card when the reader reveals it.
        return { hide: false, highlight: quoteHighlight };
    }

    delete element.dataset.xQuoteBlock;
    delete element.dataset.xQuoteReason;
    releaseQuoteCard(element);

    // People lists (Followers, Verified followers, Following) only ever FLAG a row.
    // Removing someone from your own follower list hides the information you opened
    // the page to read, and leaves the count looking wrong. Every filter highlights there.
    const matchesFilter = isListBlocked || isVpnHidden;
    // The post deliberately opened by its own timestamp remains readable. This
    // runs after the quote branch, so its quoted authors retain independent rules.
    const keepVisible = neverHide || isFocalTweet(tweet) || tweet?.dataset.xRelatedBlock === 'shown';
    const hide = !keepVisible && matchesFilter && !highlightMode;
    const highlight = !hide && matchesFilter;

    if (tweet) {
        tweet.classList.toggle(CSS_CLASSES.TWEET_BLOCKED, hide);
        tweet.classList.toggle('x-tweet-vpn-blocked', isVpnHidden && hide);
        tweet.classList.toggle('x-tweet-highlighted', highlight);
    }
    element.dataset.xBlock = hide ? 'hide' : (highlight ? 'highlight' : '');
    filterStatisticsReporter?.schedule(tweet);

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
 * @param {Function} [opts.debug]
 * @param {string|null} [opts.csrfToken]
 */
function applyInfoToElement(element, screenName, info, opts) {
    const { settings, isUserCell, tweet, debug, csrfToken } = opts;

    const effCountry = effectiveCountry(info, settings.flagFromDevice);
    element.dataset.xCountry = effCountry || '';

    const { hide } = applyBlockState(element, tweet,
        resolveAuthorBlockState(element, screenName, info, opts, tweet, isUserCell));

    // New local facts can also change a reply/quote elsewhere in the timeline.
    if (settings.hideRelatedPosts === true) updateBlockedTweets(opts);

    if (hide) return; // hidden row → don't build a badge

    if (info?.location || info?.device) {
        try {
            const presentation = extractDisplayName(element, true);
            createBadge(element, screenName, info, isUserCell, settings, debug, csrfToken, effCountry,
                presentation?.text || '', presentation);
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
    return quoteCardOf(element, tweet) !== null;
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
    const els = tweet.querySelectorAll(`${SELECTORS.USERNAME}, [data-x-screen-name]`);
    for (const el of els) {
        if (el.closest(SELECTORS.TWEET) === tweet && !isInsideQuoteTweet(el, tweet)) {
            const author = el.dataset.xScreenName || extractUsername(el);
            if (isValidScreenName(author)) return author.toLowerCase();
        }
    }
    return '';
}

/**
 * Is the main author the reader or an Always Show account? Use the same exemption
 * for language and per-author rules so the reader's own posts cannot be hidden.
 * @param {HTMLElement} tweet
 * @param {Set<string>} allowedUsers - lowercase allowlisted handles
 * @returns {boolean}
 */
function isMainAuthorExempt(tweet, allowedUsers, settings) {
    return isAuthorExempt(getMainAuthorScreenName(tweet), allowedUsers, settings);
}

let relatedInfoSnapshot = null;

function knownAuthorInfo(screenName) {
    if (!screenName) return null;
    const key = screenName.toLowerCase();
    if (relatedInfoSnapshot) return relatedInfoSnapshot.get(key) || null;
    const direct = userInfoCache.get(screenName) || userInfoCache.get(key);
    if (direct) return direct;
    for (const [name, info] of userInfoCache.entries()) {
        if (name.toLowerCase() === key) return info;
    }
    return null;
}

function relatedVerdict(reasons, location) {
    return {
        reasons, location,
        labels: reasons.map(reason => {
            const label = BLOCK_REASON_LABELS[reason] || reason;
            return (reason === 'country' || reason === 'region') && location ? `${label}: ${location}` : label;
        })
    };
}

/** Re-evaluate observed parent facts against current rules, never historical statistics. */
function knownPostVerdict(record, filters) {
    const screenName = record.author;
    const { settings, blockedCountries, blockedRegions, blockedTags, blockedBioTags,
        blockedLinks, blockedPcf, blockedAffiliations, blockedLanguages, allowedUsers } = filters;
    if (screenName && isAuthorExempt(screenName, allowedUsers, settings)) return relatedVerdict([]);
    const info = knownAuthorInfo(screenName);
    const location = effectiveCountry(info, settings.flagFromDevice);
    const country = canonicalCountry(location);
    const profile = settings.profileEnrichment === false ? null : getProfile(screenName);
    const labels = record.accountLabels || [];
    const isLabelBlocked = [...(blockedPcf || [])].some(value => value === GOVERNMENT_LABEL
        ? labels.includes(GOVERNMENT_LABEL)
        : profile?.pcf ? profile.pcf === value : labels.some(label => label.includes(value)));
    const reasons = resolveBlockReasons({
        isExempt: false,
        isBlockedCountry: country !== '' && blockedCountries?.has(country),
        isBlockedRegion: matchingBlockedRegions(country, blockedRegions, settings.regionCountrySelections).length > 0,
        isTagBlocked: hasBlockedTag(record.displayName, blockedTags),
        isBioBlocked: hasBlockedBio(profile, blockedBioTags, settings),
        isLinkBlocked: hasBlockedLink(profile, blockedLinks, settings),
        isLabelBlocked,
        isAffiliationBlocked: hasBlockedAffiliation(info?.meta, blockedAffiliations),
        accountCountReasons: screenName ? resolveAccountCountReasons(screenName, profile, settings, record.displayName) : []
    });
    if (info?.locationAccurate === false && settings.showVpnUsers === false) reasons.push('vpn');
    const language = record.language?.split('-')[0];
    if (language && language !== 'und' && blockedLanguages?.has(language)) reasons.push('language');
    return relatedVerdict(reasons, location);
}

function ownTextLanguage(scope, article, card = null) {
    for (const text of scope.querySelectorAll('[data-testid="tweetText"]')) {
        if (text.closest(SELECTORS.TWEET) !== article || quoteCardOf(text, article) !== card) continue;
        return text.getAttribute('lang')?.toLowerCase();
    }
    return undefined;
}

function renderedPostRecord(element, article) {
    const card = quoteCardOf(element, article);
    const id = card ? quotedPostId(card) : ownPostId(article);
    if (!id) return null;
    const author = element.dataset.xScreenName || extractUsername(element);
    if (!isValidScreenName(author)) return null;
    const labels = [...(getAccountTypeTokens(element, article) || [])];
    if (hasGovernmentBadge(element)) labels.push(GOVERNMENT_LABEL);
    const record = {
        id, author, displayName: extractDisplayName(element, false, author),
        accountLabels: labels.slice(0, 8),
        language: ownTextLanguage(card || article, article, card)
    };
    // Only a quote's own timestamp establishes this edge. Media/text links and
    // descendant quotes must not stand in for the direct quoted post.
    const directQuotes = Array.from((card || article).querySelectorAll(QUOTE_CARD_SELECTOR))
        .filter(quote => quote.closest(SELECTORS.TWEET) === article && quoteCardOf(quote, article) === card);
    if (directQuotes.length === 1) {
        const quoteId = quotedPostId(directQuotes[0]);
        if (quoteId) {
            record.quoteId = quoteId;
        }
    }
    return record;
}

/** DOM quotes can be evaluated even when X does not render a quote permalink. */
function renderedQuoteVerdicts(article, filters) {
    const verdicts = [];
    for (const element of article.querySelectorAll(SELECTORS.USERNAME)) {
        const card = quoteCardOf(element, article);
        if (!card || element.closest(SELECTORS.TWEET) !== article) continue;
        const author = element.dataset.xScreenName || extractUsername(element);
        if (!isValidScreenName(author)) continue;
        const info = knownAuthorInfo(author);
        const state = resolveAuthorBlockState(element, author, info, filters, article, false);
        const reasons = [...state.reasons];
        if (!isAuthorExempt(author, filters.allowedUsers, filters.settings)) {
            if (info?.locationAccurate === false && filters.settings.showVpnUsers === false) reasons.push('vpn');
            const language = ownTextLanguage(card, article, card)?.split('-')[0];
            if (language && language !== 'und' && filters.blockedLanguages?.has(language)) {
                reasons.push('language');
            }
        }
        if (reasons.length) {
            verdicts.push(relatedVerdict(reasons,
                effectiveCountry(info, filters.settings.flagFromDevice) || element.dataset.xCountry));
        }
    }
    return verdicts;
}

const relatedPosts = createRelatedPostController({
    getAuthorVerdict: knownPostVerdict,
    getQuoteVerdicts: renderedQuoteVerdicts,
    getMainAuthor: getMainAuthorScreenName,
    isExempt: (article, filters) => isFocalTweet(article) ||
        isMainAuthorExempt(article, filters.allowedUsers, filters.settings),
    onChange: article => filterStatisticsReporter?.schedule(article)
});

function syncRelatedPosts(filters, articles = document.querySelectorAll(SELECTORS.TWEET)) {
    if (filters.settings.hideRelatedPosts !== true) {
        relatedPosts.reset();
        return;
    }
    relatedInfoSnapshot = new Map([...userInfoCache.entries()].map(([name, info]) => [name.toLowerCase(), info]));
    try {
        // Observe all current rows before resolving children; parent DOM order must not matter.
        for (const article of articles) {
            for (const element of article.querySelectorAll(SELECTORS.USERNAME)) {
                if (element.closest(SELECTORS.TWEET) !== article) continue;
                const record = renderedPostRecord(element, article);
                if (record) rememberPostRelation(record);
            }
        }
        for (const article of articles) relatedPosts.sync(article, filters);
    } finally {
        relatedInfoSnapshot = null;
    }
}

/**
 * Mark (or unmark) a tweet article for language blocking. Uses a SEPARATE
 * article-level marker (data-x-lang-block) from the per-author data-x-block, so
 * the two filters compose in CSS instead of clobbering each other's state. The
 * marker honors the hide-vs-highlight preference; 'und' (undetermined —
 * emoji/link-only) is never blocked, and exempt authors are never blocked.
 * @param {HTMLElement|null} tweet - the article element
 * @param {Set<string>} blockedLanguages - lowercase primary subtags
 * @param {Object} settings
 * @param {Set<string>} [allowedUsers] - lowercase "always show" handles
 */
function applyLanguageBlock(tweet, blockedLanguages, settings, allowedUsers) {
    if (!tweet) return;

    let blocked = false;
    if (blockedLanguages && blockedLanguages.size > 0 && !isMainAuthorExempt(tweet, allowedUsers, settings)) {
        const lang = getMainTweetLanguage(tweet);
        if (lang && lang !== 'und' && blockedLanguages.has(lang)) {
            blocked = true;
        }
    }

    if (blocked) {
        tweet.dataset.xLangBlock = settings.highlightBlockedTweets === true || isFocalTweet(tweet) ||
            tweet.dataset.xRelatedBlock === 'shown'
            ? 'highlight' : 'hide';
    } else if (tweet.dataset.xLangBlock) {
        delete tweet.dataset.xLangBlock;
    }
    filterStatisticsReporter?.schedule(tweet);
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
let liveProcessElementSafe = null;
const pendingVisibility = new Map();
const PENDING_VISIBILITY_MAX_SIZE = 500;

// Processing queue with bounded size and timeout cleanup
// Map<screenName, Promise> for deduplication and waiting on in-flight requests
const PROCESSING_QUEUE_MAX_SIZE = 200;
export const processingQueue = new Map();
let processingGeneration = 0;
const processingCleanups = new Set();

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
 * @param {boolean} [includePresentation] - Retain safe artwork for the hovercard.
 * @param {string|null} [screenName] - Restrict fallback links to this author.
 * @returns {string|Object} - Plain name for filters, or local presentation data.
 */
function extractDisplayName(element, includePresentation = false, screenName = null) {
    const result = (node, text) => includePresentation ? captureDisplayName(node, text) || { text } : text;
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
    const isProfileLink = node => {
        const match = /^\/([a-zA-Z0-9_]{1,15})\/?$/.exec(node.getAttribute('href') || '');
        return !!match && (!screenName || match[1].toLowerCase() === screenName.toLowerCase());
    };
    
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
            if (displayName) return result(nameField, displayName);
        }

        // The first link usually contains the display name
        const displayNameLink = Array.from(userNameContainer.querySelectorAll('a[href^="/"]'))
            .find(isProfileLink);
        if (displayNameLink) {
            const displayName = extractTextWithEmojis(displayNameLink);
            if (displayName && !displayName.startsWith('@')) {
                return result(displayNameLink, displayName);
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
            return result(link, displayName);
        }
    }
    
    // Method 3: Check the element itself if it contains the display name
    const parentSpan = element.closest('span');
    if (parentSpan) {
        const displayName = extractTextWithEmojis(parentSpan);
        if (displayName && !displayName.startsWith('@')) {
            return result(parentSpan, displayName);
        }
    }
    
    return '';
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
function firstAccountTypeNode(scope, tweetForQuoteCheck, card = null) {
    const nodes = scope.querySelectorAll(ACCOUNT_TYPE_SELECTOR);
    for (const node of nodes) {
        if (tweetForQuoteCheck && (node.closest(SELECTORS.TWEET) !== tweetForQuoteCheck ||
            quoteCardOf(node, tweetForQuoteCheck) !== card)) continue;
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
        const card = quoteCardOf(element, tweet);
        return card ? firstAccountTypeNode(card, tweet, card) : null;
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
 * Does the bio (or explicitly selected free-text location) contain a blocked term?
 *
 * The bio comes from the profile data X already ships with its own timeline responses
 * (see profile-cache.js), so this costs no lookup. Absent profile data simply means "not
 * blocked" — never a guess.
 * @param {Object|null} profile
 * @param {Set<string>|null} blockedBioTags - lowercase terms
 * @returns {boolean}
 */
function hasBlockedBio(profile, blockedBioTags, settings) {
    if (!profile || !blockedBioTags?.size) return false;
    const bio = profile.bio?.toLowerCase() || '';
    const location = settings.bioTagsMatchLocation === true ? profile.location?.toLowerCase() || '' : '';
    for (const term of blockedBioTags) {
        const needle = term.trim().toLowerCase();
        if (needle && (bio.includes(needle) || location.includes(needle))) return true;
    }
    return false;
}

function hasBlockedLink(profile, blockedLinks, settings) {
    if (!profile || !blockedLinks?.size) return false;
    return findBlockedDomain(profile.websiteHosts, blockedLinks) !== null ||
        findBlockedDomain(profile.bioHosts, blockedLinks) !== null ||
        findBlockedExactUrl(profile.websiteUrls, blockedLinks) !== null ||
        findBlockedExactUrl(profile.bioUrls, blockedLinks) !== null ||
        (settings.linksMatchLocation === true && (
            findBlockedDomain(profile.locationHosts, blockedLinks) !== null ||
            findBlockedExactUrl(profile.locationUrls, blockedLinks) !== null
        ));
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
 * @param {Set<string>|null} blockedPcf - lowercase label values
 * @param {Object|null} profile
 * @returns {boolean}
 */
function hasBlockedAccountLabel(element, tweet, blockedPcf, profile) {
    if (!blockedPcf || blockedPcf.size === 0) return false;

    // Grey verification is independent of the PCF enum. A parody label must not
    // suppress grey-badge detection, and an arbitrary raw PCF string must never
    // stand in for a government badge. No extra lookup is required (#48).
    if (blockedPcf.has(GOVERNMENT_LABEL) && hasGovernmentBadge(element)) return true;
    if (blockedPcf.size === 1 && blockedPcf.has(GOVERNMENT_LABEL)) return false;
    const structured = profile?.pcf;
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
    liveProcessElementSafe = processElementSafe;
    
    // Start Intersection Observer
    startIntersectionObserver(processElementSafe, debug);

    let pendingElements = new Set();
    let processTimeout = null;
    let contextFrame = null;
    let nameFrame = null;
    const pendingNameElements = new Set();
    const nameOwnerSelector = `${SELECTORS.USERNAME}[data-x-screen-name], ${SELECTORS.USER_CELL}[data-x-screen-name]`;
    const ownedNameUI = `.${CSS_CLASSES.INFO_BADGE}, .${QUOTE_PLACEHOLDER_CLASS}`;
    const nameRuleActive = filters => isAccountCountThreshold(filters?.settings?.minDisplayNameDigits, 50) &&
        filters.settings.minDisplayNameDigits > 0;
    const isOwnedNameUI = node => {
        const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
        return !!element?.closest(ownedNameUI);
    };

    const scheduleNameRefresh = target => {
        const element = target.nodeType === Node.ELEMENT_NODE ? target : target.parentElement;
        if (!element || isOwnedNameUI(element)) return;
        // A people-list name can sit inside an unprocessed User-Name. Its processed
        // UserCell is the owner; quoted names retain their own nearest author root.
        const owner = element.closest(nameOwnerSelector);
        if (!owner) return;
        pendingNameElements.add(owner);
        if (nameFrame !== null) return;
        nameFrame = requestAnimationFrame(() => {
            nameFrame = null;
            const elements = Array.from(pendingNameElements);
            pendingNameElements.clear();
            const filters = getFilters?.() || latestFilterSnapshot;
            if (!isEnabled() || !nameRuleActive(filters)) return;
            const loggedInUser = getLoggedInUsername();
            for (const author of elements) {
                if (!author.isConnected) continue;
                const screenName = author.dataset.xScreenName;
                const currentName = author.matches(SELECTORS.USER_CELL)
                    ? extractUsernameFromUserCell(author) : extractUsername(author);
                if (!screenName || currentName?.toLowerCase() !== screenName.toLowerCase()) continue;
                const count = countDisplayNameDigits(extractDisplayName(author, false, screenName));
                if (displayNameCounts.has(author) && displayNameCounts.get(author) === count) continue;
                // This is a local verdict update, not a new lookup. A cached badge
                // can be restored, but a newly readable name never triggers traffic.
                if (updateAuthorBlockState(author, filters, loggedInUser) && userInfoCache.has(screenName)) {
                    applyAvailableFilters(author, screenName, filters);
                }
            }
        });
    };

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
        const watchNames = nameRuleActive(getFilters?.() || latestFilterSnapshot);

        for (const mutation of mutations) {
            if (watchNames && (mutation.type === 'characterData' ||
                (mutation.type === 'attributes' && mutation.target.tagName === 'IMG' &&
                    ['alt', 'src'].includes(mutation.attributeName)) ||
                (mutation.type === 'childList' && [...mutation.addedNodes, ...mutation.removedNodes]
                    .some(node => !isOwnedNameUI(node))))) {
                scheduleNameRefresh(mutation.target);
            }
            if (mutation.type === 'characterData') continue;
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
            if (mutation.target.closest?.(`.${QUOTE_PLACEHOLDER_CLASS}`)) continue;
            if (Array.from(mutation.removedNodes).some(node => node.classList?.contains(QUOTE_PLACEHOLDER_CLASS)) &&
                mutation.target.querySelector?.('[data-x-quote-block="hide"]')) {
                scheduleContextRefresh();
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
        characterData: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['href', 'fill', 'alt', 'src']
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
        if (nameFrame !== null) cancelAnimationFrame(nameFrame);
        pendingElements.clear();
        pendingNameElements.clear();
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
    if (settings.enabled === false || !element.isConnected) return;
    const generation = processingGeneration;
    const isCurrentProcessing = () => generation === processingGeneration;
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
        if (!isCurrentProcessing() || !element.isConnected || elementProcessingTokens.get(element) !== processingToken ||
            element.dataset.xScreenName !== screenName || element.closest(SELECTORS.TWEET) !== tweet ||
            isInsideQuoteTweet(element, tweet) !== isQuoteAtStart) return false;
        const currentName = isUserCell ? extractUsernameFromUserCell(element) : extractUsername(element);
        return currentName?.toLowerCase() === screenName.toLowerCase();
    };

    if (debug) debug(`Processing @${screenName}`);

    // Language blocking is a per-tweet signal (X's own lang tag), independent of the
    // author lookup — apply it eagerly here, before any early return below, so
    // media/API state can't gate it. Marks the article via a separate data-x-lang-block.
    // Self and Always Show exemptions can use the screen name already set above.
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
        if (currentOpts.settings.enabled === false) return;
        applyLanguageBlock(tweet, currentOpts.blockedLanguages, currentOpts.settings, currentOpts.allowedUsers);
        applyInfoToElement(element, screenName, info, currentOpts);
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
        if (!isCurrentProcessing()) return;
        
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
    let shimmer = null;
    let processingTimeout = null;
    let processingFinished = false;
    const finishProcessing = result => {
        if (processingFinished) return;
        processingFinished = true;
        clearTimeout(processingTimeout);
        processingCleanups.delete(finishProcessing);
        if (shimmer) shimmer.remove();
        if (processingQueue.get(screenName) === processingPromise) processingQueue.delete(screenName);
        resolveProcessing(result);
    };
    processingCleanups.add(finishProcessing);
    processingTimeout = setTimeout(() => {
        if (debug) debug(`Cleaning up stale processing entry for @${screenName}`);
        finishProcessing();
    }, 30000);

    // Show shimmer in debug mode
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
        if (!isCurrentProcessing()) return;

        // Issue #14: if the background can't authenticate (e.g. a Firefox container
        // cookie mismatch), retry the lookup from the PAGE context — which uses the
        // page's own correct session — then cache the result via the background.
        if ((response?.code === 'UNAUTHORIZED' || response?.code === 'NO_HEADERS') && fetchUserInfoViaPage) {
            const pageResponse = await fetchUserInfoViaPage(screenName);
            if (!isCurrentProcessing()) return;
            // Keep the page's actual failure code too, so a rate limit or timeout
            // isn't mislabeled as the background's original authentication failure.
            if (pageResponse) response = { ...pageResponse, source: 'page' };
            if (pageResponse?.success) {
                await sendMessage({
                    type: MESSAGE_TYPES.SET_CACHE,
                    payload: { screenName, data: pageResponse.data }
                });
                if (!isCurrentProcessing()) return;
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
        if (!isCurrentProcessing()) return;
        // Issue #16: a thrown error (e.g. messaging/network blip) is transient, so we
        // do NOT negative-cache it — the user is retried on a later scan rather than
        // being blanked for the session.
        applyCurrentInfo(null);
        retryAt = retryDeadline(null);
        if (isCurrentElement()) deferElementRetry(element, screenName, retryAt);
        if (debug) debug(`Processing error for @${screenName}: ${error?.message || error}`);
    } finally {
        finishProcessing({ retryAt }); // Waiting rows inherit the same retry deadline.
    }
}

// ============================================
// BLOCKED TWEETS UPDATE
// ============================================

function applyAvailableFilters(element, screenName, filters) {
    if (filters.settings?.enabled === false) return;
    const tweet = element.closest(SELECTORS.TWEET);
    const isUserCell = element.matches(SELECTORS.USER_CELL);
    element.dataset.xScreenName = screenName;
    applyLanguageBlock(tweet, filters.blockedLanguages, filters.settings, filters.allowedUsers);
    applyInfoToElement(element, screenName, userInfoCache.get(screenName) || null, {
        ...filters, tweet, isUserCell
    });
}

/**
 * Release rendered rows for a settings rescan, including collapsed quotes whose
 * children otherwise never intersect the viewport. Invalidate outstanding applies
 * at the same time so replies from the previous settings cannot restore old state.
 * Explicitly revealed quotes remain revealed until their element is recycled.
 */
export function resetProcessedElements(filters) {
    // An already-scheduled pass must not restore the presentation being cleared.
    if (pendingBlockedTweetsUpdate !== null) cancelAnimationFrame(pendingBlockedTweetsUpdate);
    pendingBlockedTweetsUpdate = null;
    pendingBlockedTweetsArgs = null;
    pendingBlockedUsers = null;
    latestFilterSnapshot = filters || null;
    filterRevision++;
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
    document.querySelectorAll('[data-x-quote-block], [data-x-quote-reason]').forEach(el => {
        if (el.dataset.xQuoteBlock !== 'shown') delete el.dataset.xQuoteBlock;
        delete el.dataset.xQuoteReason;
    });
    relatedPosts.reset({ preserveReveals: filters?.settings?.enabled !== false && filters?.settings?.hideRelatedPosts === true });
    document.querySelectorAll('[data-x-quote-state]').forEach(el => { delete el.dataset.xQuoteState; });
    document.querySelectorAll(`.${QUOTE_PLACEHOLDER_CLASS}`).forEach(el => el.remove());
    quotePlaceholders = new WeakMap();
    quoteCards = new WeakMap();
    quoteOwners = new WeakMap();

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
let pendingBlockedUsers = null;

/**
 * Update visibility of tweets based on blocked countries and regions.
 * Coalesced: multiple calls within the same frame collapse into one DOM pass
 * using the most recent arguments.
 * @param {Object} filters - current filter snapshot
 * @param {Set<string>|null} changedUsers - optional profile-only update scope
 */
export function updateBlockedTweets(filters, changedUsers = null) {
    pendingBlockedTweetsArgs = filters || {};
    latestFilterSnapshot = pendingBlockedTweetsArgs;
    filterRevision++;
    if (pendingBlockedTweetsUpdate === null) {
        pendingBlockedUsers = changedUsers ? new Set(changedUsers) : null;
    } else if (!changedUsers) {
        pendingBlockedUsers = null;
    } else if (pendingBlockedUsers) {
        for (const user of changedUsers) pendingBlockedUsers.add(user);
    }
    if (pendingBlockedTweetsUpdate !== null) return;

    pendingBlockedTweetsUpdate = requestAnimationFrame(() => {
        pendingBlockedTweetsUpdate = null;
        const args = pendingBlockedTweetsArgs;
        const users = pendingBlockedUsers;
        pendingBlockedTweetsArgs = null;
        pendingBlockedUsers = null;
        if (args) runUpdateBlockedTweets(args, users);
    });
}

/**
 * Re-derive one author from current local evidence. Return whether a hidden row
 * became readable without a badge; the caller decides how to recover that badge.
 */
function updateAuthorBlockState(element, filters, loggedInUser) {
    const screenName = element.dataset.xScreenName;
    const tweet = element.closest(SELECTORS.TWEET);
    const isUserCell = !tweet && element.matches(SELECTORS.USER_CELL);
    if (!tweet && !isUserCell) return false;
    const cachedInfo = screenName ? userInfoCache.get(screenName) : null;
    const wasHidden = element.dataset.xBlock === 'hide';
    const { hide } = applyBlockState(element, tweet,
        resolveAuthorBlockState(element, screenName, cachedInfo, filters, tweet, isUserCell, loggedInUser));
    const badge = element.querySelector(`.${CSS_CLASSES.INFO_BADGE}`);
    if (badge) badge.style.display = hide ? 'none' : '';
    return !badge && wasHidden && !hide;
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
} = {}, changedUsers = null) {
    if (settings.enabled === false) return;
    const filters = {
        blockedCountries, blockedRegions, blockedTags, blockedBioTags, blockedLinks,
        blockedPcf, settings, blockedLanguages, allowedUsers, blockedAffiliations
    };
    const newlyVisible = new Set();
    const loggedInUser = getLoggedInUsername();

    document.querySelectorAll('[data-x-screen-name]').forEach(element => {
        const screenName = element.dataset.xScreenName;
        if (changedUsers && !changedUsers.has(screenName?.toLowerCase())) return;
        // People-list rows have no enclosing tweet, but they still need re-deriving when a
        // filter changes — otherwise adding a country would flag nothing on Followers /
        // Following until a reload.
        if (updateAuthorBlockState(element, filters, loggedInUser)) newlyVisible.add(element);
    });

    // Language blocking is per-tweet (not per-author), so re-derive it across ALL
    // articles — this is what makes adding OR removing a language re-apply to
    // already-rendered tweets. applyLanguageBlock authoritatively sets or clears the
    // marker, so a removed language un-hides its tweets. Scoped relationship changes
    // must also revisit language verdicts for the affected main authors.
    document.querySelectorAll(SELECTORS.TWEET).forEach(tweet => {
        if (changedUsers && !changedUsers.has(getMainAuthorScreenName(tweet)?.toLowerCase())) return;
        const wasHidden = tweet.dataset.xLangBlock === 'hide';
        applyLanguageBlock(tweet, blockedLanguages, settings, allowedUsers);
        if (wasHidden && tweet.dataset.xLangBlock !== 'hide') {
            tweet.querySelectorAll('[data-x-screen-name]').forEach(element => {
                if (element.closest(SELECTORS.TWEET) === tweet) newlyVisible.add(element);
            });
        }
    });
    // Recover only after both author and language verdicts have settled.
    for (const element of newlyVisible) recoverVisibleElement(element, filters);
    // A changed parent can affect a different author's reply/quote, so this
    // pass cannot use the author-only scope of profile/follow-status updates.
    syncRelatedPosts(filters);
}

/** Resume work that a previous hide verdict short-circuited before badge creation. */
function recoverVisibleElement(element, filters) {
    if (!element.isConnected || filters.settings?.enabled === false ||
        element.dataset.xBlock === 'hide' || element.closest(SELECTORS.TWEET)?.dataset.xLangBlock === 'hide' ||
        element.querySelector(`.${CSS_CLASSES.INFO_BADGE}`)) return;
    const screenName = element.dataset.xScreenName;
    const currentName = element.matches(SELECTORS.USER_CELL)
        ? extractUsernameFromUserCell(element) : extractUsername(element);
    if (!screenName || currentName?.toLowerCase() !== screenName.toLowerCase()) return;

    // Existing location results can restore a badge without any network work.
    if (userInfoCache.has(screenName)) {
        applyAvailableFilters(element, screenName, filters);
        return;
    }
    elementProcessingTokens.delete(element);
    delete element.dataset.xProcessed;
    // The normal queue retains retry deadlines and waits for off-screen rows.
    if (liveProcessElementSafe) queueForVisibility(element, liveProcessElementSafe);
}

// ============================================
// QUOTE REVEAL (issue #32)
// ============================================

let quoteRevealBound = false;

/**
 * Let the reader open a collapsed quote card. Delegated on document
 * in the CAPTURE phase so we run before X's own card handler and can stop it from
 * navigating to the quoted post. Reveal remains tied to the owned quote marker.
 * Idempotent: safe to call more than once.
 */
export function setupQuoteReveal() {
    if (quoteRevealBound) return;
    quoteRevealBound = true;

    const reveal = event => {
        if (relatedPosts.reveal(event)) {
            if (latestFilterSnapshot) updateBlockedTweets(latestFilterSnapshot);
            return;
        }
        const target = event.target;
        if (!target || typeof target.closest !== 'function') return;

        const card = target.closest(QUOTE_CARD_SELECTOR);
        if (!card || card.dataset.xQuoteState !== 'hide') return;

        const marker = quoteOwners.get(card);
        if (!marker || marker.dataset.xQuoteBlock !== 'hide' || quoteCardOf(marker) !== card) return;

        // Swallow the interaction before X navigates to the quoted post.
        event.preventDefault();
        event.stopPropagation();
        marker.dataset.xQuoteBlock = 'shown';
        card.dataset.xQuoteState = 'shown';
        const hadFocus = card.contains(document.activeElement);
        clearQuotePlaceholder(marker);
        if (hadFocus) card.focus({ preventScroll: true });
    };

    document.addEventListener('click', reveal, true);
    const onKeydown = event => {
        if (event.key === 'Enter' || event.key === ' ') reveal(event);
    };
    document.addEventListener('keydown', onKeydown, true);
    observerCleanupFunctions.push(() => {
        document.removeEventListener('click', reveal, true);
        document.removeEventListener('keydown', onKeydown, true);
        quoteRevealBound = false;
    });
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
    releaseQuoteCard(element);
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
                releaseQuoteCard(element);
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
    // Outstanding lookups may settle after a restored page starts processing again.
    // Invalidate their cache writes independently of row recycling within one session.
    processingGeneration++;
    filterStatisticsReporter = null;
    for (const finishProcessing of processingCleanups) finishProcessing({ cancelled: true });
    liveProcessElementSafe = null;
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
        pendingBlockedUsers = null;
    }

    // Clear all processing queues properly
    elementProcessingTokens = new WeakMap();
    elementTweetContexts = new WeakMap();
    elementQuoteContexts = new WeakMap();
    displayNameCounts = new WeakMap();
    postContexts = new WeakMap();
    relatedPosts.reset();
    relatedInfoSnapshot = null;
    document.querySelectorAll('[data-x-quote-state]').forEach(el => { delete el.dataset.xQuoteState; });
    document.querySelectorAll(`.${QUOTE_PLACEHOLDER_CLASS}`).forEach(el => el.remove());
    quotePlaceholders = new WeakMap();
    quoteCards = new WeakMap();
    quoteOwners = new WeakMap();
    latestFilterSnapshot = null;
    processingQueue.clear();
    userInfoCache.clear();
    pendingVisibility.clear();
}
