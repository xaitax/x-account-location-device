/** Account-count rules use visible names or profile data already observed locally. */
export const ACCOUNT_COUNT_FILTERS = Object.freeze([
    {
        key: 'minFollowing', profileField: 'following', label: 'Following',
        presets: Object.freeze([1000, 2500, 5000, 10000]), suggested: 5000, reason: 'following',
        max: Number.MAX_SAFE_INTEGER, requiresProfile: true
    },
    {
        key: 'minPosts', profileField: 'tweets', label: 'Total posts',
        presets: Object.freeze([25000, 50000, 100000, 250000]), suggested: 100000, reason: 'posts',
        max: Number.MAX_SAFE_INTEGER, requiresProfile: true
    },
    {
        key: 'minHandleDigits', profileField: null, label: 'Digits in handle',
        presets: Object.freeze([]), suggested: 5, reason: 'handleDigits', max: 15, requiresProfile: false
    },
    {
        key: 'minDisplayNameDigits', profileField: null, label: 'Digits in display name',
        presets: Object.freeze([]), suggested: 5, reason: 'displayNameDigits', max: 50, requiresProfile: false
    }
].map(Object.freeze));

/** Zero disables a rule. Positive thresholds must be exact, nonnegative integers. */
export function isAccountCountThreshold(value, max = Number.MAX_SAFE_INTEGER) {
    return Number.isSafeInteger(value) && value >= 0 && value <= max;
}

/** Count all ASCII digits in a valid X handle; malformed or missing handles are unknown. */
export function countHandleDigits(screenName) {
    if (typeof screenName !== 'string' || screenName.length < 1 || screenName.length > 15 ||
        /[^a-zA-Z0-9_]/.test(screenName)) return undefined;
    return (screenName.match(/[0-9]/g) || []).length;
}

/** Count decimal digits only, without converting superscripts or other numeric symbols. */
export function countDisplayNameDigits(text) {
    if (typeof text !== 'string' || text.length === 0 || text.length > 4096) return undefined;
    return (text.match(/\p{Decimal_Number}/gu) || []).length;
}

/** Unknown/invalid observations never match, and the threshold is inclusive. */
export function matchesAccountCount(count, threshold) {
    return isAccountCountThreshold(threshold) && threshold > 0 &&
        isAccountCountThreshold(count) && count >= threshold;
}
