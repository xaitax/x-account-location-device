/** Pure AboutAccountQuery projection shared by the background and bundled page script. */
export class AccountResponseMismatchError extends Error {
    constructor(returnedScreenName, requestedScreenName) {
        super(`Returned @${returnedScreenName} does not match requested @${requestedScreenName}`);
    }
}

/**
 * Read the common filtering fields once. The page fallback intentionally omits
 * hovercard-only fields; callers retain their own transport/error classification.
 */
export function parseAccountResponse(data, requestedScreenName = null, { fullMetadata = true } = {}) {
    const user = data?.data?.user_result_by_screen_name?.result;
    const profile = user?.about_profile;

    // Never attach one account's observation to another. Missing handles retain
    // the existing permissive behavior for otherwise usable X responses.
    const returnedScreenName = user?.core?.screen_name || null;
    if (requestedScreenName && returnedScreenName &&
        returnedScreenName.toLowerCase() !== requestedScreenName.toLowerCase()) {
        throw new AccountResponseMismatchError(returnedScreenName, requestedScreenName);
    }

    // Prefer the organization label, falling back to X's identity-profile label.
    const label = user?.affiliates_highlighted_label?.label ||
        user?.identity_profile_labels_highlighted_label?.label || null;
    const affiliate = label?.description ? {
        name: label.description,
        badgeUrl: label?.badge?.url || null,
        url: label?.url?.url || null,
        type: label?.userLabelType || label?.userLabelDisplayType || null
    } : null;

    let usernameChanges = null;
    const rawChanges = profile?.username_changes?.count;
    if (rawChanges !== null && rawChanges !== undefined) {
        const parsed = Number.parseInt(String(rawChanges), 10);
        if (!Number.isNaN(parsed)) usernameChanges = parsed;
    }

    const meta = {
        name: user?.core?.name || null,
        avatarUrl: user?.avatar?.image_url || null,
        createdAt: user?.core?.created_at || null,
        restId: user?.rest_id || null,
        // Presence, even when null, marks affiliation as checked. Do not omit it.
        affiliateUsername: profile?.affiliate_username || null,
        affiliate,
        usernameChanges
    };

    if (fullMetadata) {
        const rawVerifiedType = user?.verification?.verified_type;
        const normalizedVerifiedType = typeof rawVerifiedType === 'string'
            ? rawVerifiedType.trim().toLowerCase() : null;
        // Business/Government describe the checkmark, independently of X's
        // is_blue_verified boolean. Unknown values must not guess a badge color.
        const verifiedType = ['business', 'government', 'blue'].includes(normalizedVerifiedType)
            ? normalizedVerifiedType : null;
        let verifiedSinceMsec = null;
        const rawVerifiedSince = user?.verification_info?.reason?.verified_since_msec;
        if (rawVerifiedSince !== null && rawVerifiedSince !== undefined) {
            const parsed = Number.parseInt(String(rawVerifiedSince), 10);
            if (!Number.isNaN(parsed) && parsed > 0) verifiedSinceMsec = parsed;
        }

        Object.assign(meta, {
            profileImageShape: user?.profile_image_shape || null,
            blueVerified: user?.is_blue_verified === true,
            verified: user?.verification?.verified === true,
            verifiedType,
            identityVerified: user?.verification_info?.is_identity_verified === true,
            verifiedSinceMsec,
            protected: user?.privacy?.protected === true,
            createdCountryAccurate: profile?.created_country_accurate === true,
            learnMoreUrl: profile?.learn_more_url || null
        });
    }

    return {
        location: profile?.account_based_in || null,
        device: profile?.source || null,
        locationAccurate: profile?.location_accurate !== false,
        meta
    };
}
