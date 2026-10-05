/**
 * Country/area memberships for X-Posed's existing 16 region filters.
 *
 * These are transparent filter groupings, NOT an assertion that X uses identical
 * boundaries. Base geography: United Nations M49, checked 2026-10-05:
 * https://unstats.un.org/unsd/methodology/m49/
 * M49 groupings are for statistical convenience, not political affiliation.
 *
 * Territory membership follows M49 geography, not the administering country:
 * French Guiana -> South America; Greenland -> North America; British Indian
 * Ocean Territory/French Southern Territories -> Africa. M49 places Bouvet and
 * South Georgia/South Sandwich in South America and Heard/McDonald in Oceania.
 *
 * Explicit compatibility additions:
 * - Taiwan remains a separately selectable location in Eastern Asia.
 * - Kosovo remains a separately selectable location in Europe.
 *   M49's FAQ documents their geographic parent areas; these additions make no
 *   assertion about sovereignty or political status.
 * - England, Scotland and Wales retain their existing selectable labels and use
 *   the United Kingdom's geographic continent. Do not infer a finer X location.
 *
 * Explicit composites:
 * - North America = Northern America + Central America + Caribbean (M49 FAQ).
 * - East Asia & Pacific = Eastern Asia + South-eastern Asia + Oceania.
 * - Australasia = M49 Australia/New Zealand group, including listed territories.
 * - Eastern Europe (Non-EU) = M49 Eastern Europe minus EU members at review date.
 *
 * Antarctica is deliberately country-only: none of the 16 labels describes it.
 * Europe and European Union are reported regional/political labels, not countries.
 */
import { canonicalCountry } from './constants.js';

export const REGION_GEOGRAPHY_SOURCES = Object.freeze({
    reviewedAt: '2026-10-05',
    geographicalGroups: 'https://unstats.un.org/unsd/methodology/m49/',
    euMembership: 'https://eur-lex.europa.eu/EN/legal-content/glossary/member-states.html'
});

function members(...groups) {
    return Object.freeze([...new Set(groups.flat().map(canonicalCountry))].sort());
}

const NORTHERN_AFRICA = [
    'algeria',
    'egypt',
    'libya',
    'morocco',
    'sudan',
    'tunisia',
    'western sahara'
];

const OTHER_AFRICA = [
    'angola',
    'benin',
    'botswana',
    'british indian ocean territory',
    'burkina faso',
    'burundi',
    'cameroon',
    'cape verde',
    'central african republic',
    'chad',
    'comoros',
    'congo',
    'democratic republic of the congo',
    'djibouti',
    'equatorial guinea',
    'eritrea',
    'eswatini',
    'ethiopia',
    'french southern territories',
    'gabon',
    'gambia',
    'ghana',
    'guinea',
    'guinea-bissau',
    'ivory coast',
    'kenya',
    'lesotho',
    'liberia',
    'madagascar',
    'malawi',
    'mali',
    'mauritania',
    'mauritius',
    'mayotte',
    'mozambique',
    'namibia',
    'niger',
    'nigeria',
    'rwanda',
    'réunion',
    'saint helena',
    'sao tome and principe',
    'senegal',
    'seychelles',
    'sierra leone',
    'somalia',
    'south africa',
    'south sudan',
    'tanzania',
    'togo',
    'uganda',
    'zambia',
    'zimbabwe'
];

const CARIBBEAN = [
    'anguilla',
    'antigua and barbuda',
    'aruba',
    'bahamas',
    'barbados',
    'bonaire',
    'british virgin islands',
    'cayman islands',
    'cuba',
    'curaçao',
    'dominica',
    'dominican republic',
    'grenada',
    'guadeloupe',
    'haiti',
    'jamaica',
    'martinique',
    'montserrat',
    'puerto rico',
    'saint barthelemy',
    'saint kitts and nevis',
    'saint lucia',
    'saint martin',
    'saint vincent and the grenadines',
    'sint maarten',
    'trinidad and tobago',
    'turks and caicos islands',
    'us virgin islands'
];

const CENTRAL_AMERICA = [
    'belize',
    'costa rica',
    'el salvador',
    'guatemala',
    'honduras',
    'mexico',
    'nicaragua',
    'panama'
];

const NORTHERN_AMERICA = [
    'bermuda',
    'canada',
    'greenland',
    'saint pierre and miquelon',
    'united states'
];

const SOUTH_AMERICA = [
    'argentina',
    'bolivia',
    'bouvet island',
    'brazil',
    'chile',
    'colombia',
    'ecuador',
    'falkland islands',
    'french guiana',
    'guyana',
    'paraguay',
    'peru',
    'south georgia and the south sandwich islands',
    'suriname',
    'uruguay',
    'venezuela'
];

const CENTRAL_ASIA = [
    'kazakhstan',
    'kyrgyzstan',
    'tajikistan',
    'turkmenistan',
    'uzbekistan'
];

const EASTERN_ASIA = [
    'china',
    'hong kong',
    'japan',
    'macao',
    'mongolia',
    'north korea',
    'south korea',
    'taiwan'
];

const SOUTHERN_ASIA = [
    'afghanistan',
    'bangladesh',
    'bhutan',
    'india',
    'iran',
    'maldives',
    'nepal',
    'pakistan',
    'sri lanka'
];

const SOUTH_EASTERN_ASIA = [
    'brunei',
    'cambodia',
    'indonesia',
    'laos',
    'malaysia',
    'myanmar',
    'philippines',
    'singapore',
    'thailand',
    'timor-leste',
    'vietnam'
];

const WESTERN_ASIA = [
    'armenia',
    'azerbaijan',
    'bahrain',
    'cyprus',
    'georgia',
    'iraq',
    'israel',
    'jordan',
    'kuwait',
    'lebanon',
    'oman',
    'palestine',
    'qatar',
    'saudi arabia',
    'syria',
    'turkey',
    'united arab emirates',
    'yemen'
];

const UN_EASTERN_EUROPE = [
    'belarus',
    'bulgaria',
    'czech republic',
    'hungary',
    'moldova',
    'poland',
    'romania',
    'russia',
    'slovakia',
    'ukraine'
];

const OTHER_EUROPE = [
    'aland islands',
    'albania',
    'andorra',
    'austria',
    'belgium',
    'bosnia and herzegovina',
    'croatia',
    'denmark',
    'england',
    'estonia',
    'faroe islands',
    'finland',
    'france',
    'germany',
    'gibraltar',
    'greece',
    'guernsey',
    'iceland',
    'ireland',
    'isle of man',
    'italy',
    'jersey',
    'kosovo',
    'latvia',
    'liechtenstein',
    'lithuania',
    'luxembourg',
    'malta',
    'monaco',
    'montenegro',
    'netherlands',
    'north macedonia',
    'norway',
    'portugal',
    'san marino',
    'scotland',
    'serbia',
    'slovenia',
    'spain',
    'svalbard',
    'sweden',
    'switzerland',
    'united kingdom',
    'vatican city',
    'wales'
];

const AUSTRALIA_NEW_ZEALAND = [
    'australia',
    'christmas island',
    'cocos (keeling) islands',
    'heard island and mcdonald islands',
    'new zealand',
    'norfolk island'
];

const OTHER_OCEANIA = [
    'american samoa',
    'cook islands',
    'fiji',
    'french polynesia',
    'guam',
    'kiribati',
    'marshall islands',
    'micronesia',
    'nauru',
    'new caledonia',
    'niue',
    'northern mariana islands',
    'palau',
    'papua new guinea',
    'pitcairn',
    'samoa',
    'solomon islands',
    'tokelau',
    'tonga',
    'tuvalu',
    'united states minor outlying islands',
    'vanuatu',
    'wallis and futuna'
];

// EU membership is a dated reference, not inferred from currency or geography.
const EU_MEMBERS_2026_10_05 = [
    'austria',
    'belgium',
    'bulgaria',
    'croatia',
    'cyprus',
    'czech republic',
    'denmark',
    'estonia',
    'finland',
    'france',
    'germany',
    'greece',
    'hungary',
    'ireland',
    'italy',
    'latvia',
    'lithuania',
    'luxembourg',
    'malta',
    'netherlands',
    'poland',
    'portugal',
    'romania',
    'slovakia',
    'slovenia',
    'spain',
    'sweden'
];

const EU_MEMBER_SET = new Set(EU_MEMBERS_2026_10_05);

const AFRICA = members(NORTHERN_AFRICA, OTHER_AFRICA);
const ASIA = members(CENTRAL_ASIA, EASTERN_ASIA, SOUTHERN_ASIA, SOUTH_EASTERN_ASIA, WESTERN_ASIA);
const EUROPE = members(UN_EASTERN_EUROPE, OTHER_EUROPE);
const OCEANIA = members(AUSTRALIA_NEW_ZEALAND, OTHER_OCEANIA);

export const REGION_GEOGRAPHY_GROUPS = Object.freeze({
    africa: AFRICA,
    asia: ASIA,
    australasia: members(AUSTRALIA_NEW_ZEALAND),
    caribbean: members(CARIBBEAN),
    'central asia': members(CENTRAL_ASIA),
    'east asia': members(EASTERN_ASIA),
    'east asia & pacific': members(EASTERN_ASIA, SOUTH_EASTERN_ASIA, OCEANIA),
    'eastern europe (non-eu)': members(UN_EASTERN_EUROPE.filter(name => !EU_MEMBER_SET.has(name))),
    europe: EUROPE,
    'north africa': members(NORTHERN_AFRICA),
    'north america': members(NORTHERN_AMERICA, CENTRAL_AMERICA, CARIBBEAN),
    oceania: OCEANIA,
    'south america': members(SOUTH_AMERICA),
    'south asia': members(SOUTHERN_ASIA),
    'southeast asia': members(SOUTH_EASTERN_ASIA),
    'west asia': members(WESTERN_ASIA)
});

export const REGION_GEOGRAPHY_NOTES = Object.freeze({
    africa: 'African countries and their separately listed territories.',
    asia: 'Asian countries and territories, including Taiwan as a separate location.',
    australasia: 'Australia, New Zealand and their separately listed territories in this region.',
    caribbean: 'Caribbean countries and territories. These also belong to North America.',
    'central asia': 'Kazakhstan, Kyrgyzstan, Tajikistan, Turkmenistan and Uzbekistan.',
    'east asia': 'China, Japan, Mongolia, the Koreas and nearby territories, including Taiwan.',
    'east asia & pacific': 'East Asia, Southeast Asia and Oceania combined.',
    'eastern europe (non-eu)': 'Belarus, Moldova, Russia and Ukraine. EU member countries are not included.',
    europe: "European countries and territories, including Kosovo and the UK's home-nation labels.",
    'north africa': 'Northern African countries and territories, including Sudan and Western Sahara.',
    'north america': 'North American countries and territories, including Central America and the Caribbean.',
    oceania: 'Australia/New Zealand, Melanesia, Micronesia and Polynesia.',
    'south america': 'South American countries and territories, including nearby island areas.',
    'south asia': 'Southern Asian countries, including Afghanistan and Iran.',
    'southeast asia': 'Southeastern Asian countries, including Timor-Leste.',
    'west asia': 'Western Asian countries, including Cyprus, Türkiye and the Caucasus.'
});

export const UNMAPPED_GEOGRAPHY_LOCATIONS = Object.freeze(['antarctica']);
export const REGIONAL_LOCATION_LABELS = Object.freeze(['europe', 'european union']);
