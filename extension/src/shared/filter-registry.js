/** Stable filter storage and messaging identifiers. No DOM, storage instances or UI copy. */
import { MESSAGE_TYPES, STORAGE_KEYS } from './constants.js';

// Keep the existing import commit order. A failed later write must not change which
// earlier lists were committed. Views choose their own presentation order and labels.
export const FILTER_SOURCES = Object.freeze([
    ['countries', 'blockedCountries', 'BLOCKED_COUNTRIES', 'country', 'countries', 'onCountryAction'],
    ['regions', 'blockedRegions', 'BLOCKED_REGIONS', 'region', 'regions', 'onRegionAction'],
    ['tags', 'blockedTags', 'BLOCKED_TAGS', 'tag', 'tags', 'onTagAction'],
    ['bioTags', 'blockedBioTags', 'BLOCKED_BIO_TAGS', 'tag', 'tags', 'onBioTagAction'],
    ['pcf', 'blockedPcf', 'BLOCKED_PCF', 'label', 'labels', 'onPcfAction'],
    ['languages', 'blockedLanguages', 'BLOCKED_LANGUAGES', 'language', 'languages', 'onLanguageAction'],
    ['affiliations', 'blockedAffiliations', 'BLOCKED_AFFILIATIONS', 'affiliation', 'affiliations', 'onAffiliationAction'],
    ['links', 'blockedLinks', 'BLOCKED_LINKS', 'link', 'links', 'onLinkAction'],
    ['allowedUsers', 'allowedUsers', 'ALLOWED_USERS', 'username', 'usernames', 'onAllowedUserAction']
].map(([kind, field, type, valueKey, valuesKey, callback]) => Object.freeze({
    kind, field, valueKey, valuesKey, callback,
    storageKey: STORAGE_KEYS[type],
    get: MESSAGE_TYPES[`GET_${type}`],
    set: MESSAGE_TYPES[`SET_${type}`],
    update: MESSAGE_TYPES[`${type}_UPDATED`]
})));
