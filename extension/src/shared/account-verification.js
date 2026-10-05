/** Choose one checkmark description from X's observed account metadata. */
export function getAccountVerification(meta) {
    // An organization can also have is_blue_verified=true. Its reported type
    // takes precedence so Business/Government never masquerade as blue checks.
    if (meta?.verifiedType === 'business') {
        return {
            type: 'business', label: 'Business verified', tone: 'gold',
            title: 'Gold checkmark / Verified business or organization'
        };
    }
    if (meta?.verifiedType === 'government') {
        return {
            type: 'government', label: 'Government verified', tone: 'grey',
            title: 'Grey checkmark / Government or multilateral organization'
        };
    }
    if (meta?.verifiedType === 'blue' || meta?.blueVerified === true) {
        return {
            type: 'blue', label: 'Blue verification', tone: 'blue',
            title: 'Blue checkmark / X Premium'
        };
    }
    // Older cached observations may only carry verified=true. That is not
    // evidence of Business verification and must not be labeled a gold check.
    if (meta?.verified === true) {
        return {
            type: 'legacy', label: 'Legacy verified', tone: 'neutral',
            title: 'Legacy verification reported by X'
        };
    }
    return null;
}
