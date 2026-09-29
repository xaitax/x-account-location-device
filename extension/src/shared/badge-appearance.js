/** Shared appearance preferences for on-X badges and the settings preview. */
export const BADGE_SIZES = Object.freeze(['small', 'medium', 'large']);

export function normalizeBadgeSize(value) {
    return BADGE_SIZES.includes(value) ? value : 'medium';
}

export function applyBadgeAppearance(badge, settings) {
    badge.dataset.size = normalizeBadgeSize(settings.badgeSize);
    badge.dataset.background = String(settings.showBadgeBackground !== false);
}
