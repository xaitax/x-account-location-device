/**
 * Regression checks for explicit region-country coverage and legacy filter safety.
 * Run with `npm run check:regions`; no browser, network or additional dependencies.
 */
import assert from 'node:assert/strict';
import {
    COUNTRY_FLAGS, COUNTRY_LIST, DEFAULT_SETTINGS, REGION_LIST, STORAGE_KEYS, canonicalCountry
} from '../src/shared/constants.js';
import {
    getRegionCountries, getRegionDescription, getCountryRegions,
    normalizeRegionCountrySelections, hasRegionCountrySelection,
    getIncludedRegionCountries, matchingBlockedRegions, areRegionCountrySelectionsEqual
} from '../src/shared/region-membership.js';
import { prepareBackupImport } from '../src/shared/backup.js';

let checks = 0;
function check(name, action) {
    action();
    checks += 1;
    console.log(`✓ ${name}`);
}
async function checkAsync(name, action) {
    await action();
    checks += 1;
    console.log(`✓ ${name}`);
}
const ordered = values => [...values].sort();
const ownEntries = value => Object.fromEntries(Object.entries(value));
const regionKeys = new Set(REGION_LIST.map(region => region.key));
const countryKeys = new Set(COUNTRY_LIST);
const strict = value => normalizeRegionCountrySelections(value, { strict: true });

check('All 16 regions contain only unique, canonical country/territory entries', () => {
    assert.equal(regionKeys.size, 16);
    for (const region of REGION_LIST) {
        const members = getRegionCountries(region.key);
        assert.ok(Array.isArray(members) && members.length > 0, `${region.name}: non-empty members`);
        assert.equal(new Set(members).size, members.length, `${region.name}: no duplicate members`);
        const description = getRegionDescription(region.key);
        assert.equal(typeof description, 'string');
        assert.ok(description.trim().length > 0, `${region.name}: explain the definition`);
        assert.doesNotMatch(description, /\b(?:UN\s*M49|M49)\b/i,
            `${region.name}: descriptions use plain language rather than taxonomy codes`);
        for (const member of members) {
            assert.equal(member, canonicalCountry(member), `${region.name}: canonical ${member}`);
            assert.ok(countryKeys.has(member), `${region.name}: known country ${member}`);
            assert.ok(Object.hasOwn(COUNTRY_FLAGS, member), `${region.name}: flag for ${member}`);
            assert.ok(!regionKeys.has(member), `${region.name}: ${member} is not another region`);
            assert.notEqual(member, 'european union', 'EU is not a country');
        }
    }
});

check('Every supported country/territory is mapped, except Antarctica and legacy region labels', () => {
    const uncovered = COUNTRY_LIST.filter(country => getCountryRegions(country).length === 0);
    const exceptions = new Set(['antarctica', 'europe', 'european union']);
    assert.deepEqual(ordered(uncovered), ordered(COUNTRY_LIST.filter(country => exceptions.has(country))));
    for (const country of COUNTRY_LIST) {
        const regions = getCountryRegions(country);
        assert.equal(new Set(regions).size, regions.length, `${country}: unique region memberships`);
        for (const region of regions) {
            assert.ok(regionKeys.has(region), `${country}: known region ${region}`);
            assert.ok(getRegionCountries(region).includes(country), `${country}: reverse lookup agrees`);
        }
    }
});

check('Geographic hierarchy and intentional overlaps are preserved', () => {
    const expected = {
        india: ['asia', 'south asia'],
        iran: ['asia', 'south asia'],
        turkey: ['asia', 'west asia'],
        russia: ['europe', 'eastern europe (non-eu)'],
        china: ['asia', 'east asia', 'east asia & pacific'],
        japan: ['asia', 'east asia', 'east asia & pacific'],
        australia: ['australasia', 'oceania', 'east asia & pacific'],
        egypt: ['africa', 'north africa'],
        jamaica: ['north america', 'caribbean'],
        guatemala: ['north america'],
        mexico: ['north america'],
        'united states': ['north america']
    };
    for (const [country, regions] of Object.entries(expected)) {
        for (const region of regions) {
            assert.ok(getCountryRegions(country).includes(region), `${country} belongs to ${region}`);
        }
    }
    assert.ok(!getCountryRegions('iran').includes('west asia'), 'UN M49 places Iran in Southern Asia');
    assert.ok(!getCountryRegions('germany').includes('eastern europe (non-eu)'), 'Germany is not Non-EU');
});

check('The competitor spelling gaps and exact official names resolve without new countries', () => {
    const aliases = {
        'Cabo Verde': 'cape verde',
        'U.S. Virgin Islands': 'us virgin islands',
        'United States Virgin Islands': 'us virgin islands',
        'Republic of Korea': 'south korea',
        'Republic of Moldova': 'moldova',
        'United Republic of Tanzania': 'tanzania',
        'Holy See': 'vatican city',
        'Svalbard and Jan Mayen Islands': 'svalbard'
    };
    for (const [alias, canonical] of Object.entries(aliases)) {
        assert.equal(canonicalCountry(alias), canonical);
        assert.deepEqual(ordered(getCountryRegions(alias)), ordered(getCountryRegions(canonical)));
    }
    const missingAreas = [
        'antarctica', 'bouvet island', 'british indian ocean territory', 'cocos (keeling) islands',
        'french southern territories', 'heard island and mcdonald islands', 'pitcairn',
        'south georgia and the south sandwich islands', 'united states minor outlying islands'
    ];
    for (const area of missingAreas) assert.ok(Object.hasOwn(COUNTRY_FLAGS, area), `Complete area coverage: ${area}`);
});

check('Old region filters remain literal-only until the user explicitly includes countries', () => {
    const blocked = new Set(['asia', 'south asia']);
    assert.deepEqual(ordered(matchingBlockedRegions('Asia', blocked)), ['asia']);
    assert.deepEqual(matchingBlockedRegions('India', blocked), []);
    assert.deepEqual(matchingBlockedRegions('India', blocked, {}), []);
    assert.equal(hasRegionCountrySelection('asia', {}), false);
    assert.deepEqual(getIncludedRegionCountries('asia', {}), []);
    assert.deepEqual(ownEntries(DEFAULT_SETTINGS.regionCountrySelections), {});
});

check('Explicit country coverage matches aliases and respects the active region checkbox', () => {
    const selections = strict({ asia: ['India', 'Republic of Korea'], africa: ['Cabo Verde'] });
    assert.equal(hasRegionCountrySelection('asia', selections), true);
    assert.deepEqual(ordered(getIncludedRegionCountries('asia', selections)), ['india', 'south korea']);
    assert.deepEqual(matchingBlockedRegions('India', new Set(['asia']), selections), ['asia']);
    assert.deepEqual(matchingBlockedRegions('Republic of Korea', new Set(['asia']), selections), ['asia']);
    assert.deepEqual(matchingBlockedRegions('Cabo Verde', new Set(['africa']), selections), ['africa']);
    assert.deepEqual(matchingBlockedRegions('India', new Set(), selections), []);
    assert.deepEqual(matchingBlockedRegions('India', new Set(['africa']), selections), []);
    assert.deepEqual(matchingBlockedRegions('Asia', new Set(['asia']), selections), ['asia']);
});

check('Exclusions and overlapping region rules remain independent', () => {
    let selections = strict({ asia: ['japan'], 'south asia': ['india'] });
    const blocked = new Set(['asia', 'south asia']);
    assert.deepEqual(matchingBlockedRegions('India', blocked, selections), ['south asia']);
    assert.deepEqual(matchingBlockedRegions('Japan', blocked, selections), ['asia']);
    selections = strict({ asia: ['japan', 'india'], 'south asia': ['india'] });
    assert.deepEqual(ordered(matchingBlockedRegions('India', blocked, selections)), ['asia', 'south asia']);
    selections = strict({ asia: ['japan', 'india'], 'south asia': [] });
    assert.deepEqual(matchingBlockedRegions('India', blocked, selections), ['asia']);
    selections = strict({ asia: [], 'south asia': [] });
    assert.deepEqual(matchingBlockedRegions('India', blocked, selections), []);
    assert.equal(hasRegionCountrySelection('asia', selections), true, 'Enabled with zero members is not disabled');
    assert.deepEqual(getIncludedRegionCountries('asia', selections), []);
    assert.deepEqual(matchingBlockedRegions('Asia', blocked, selections), ['asia'], 'Literal X labels still match');
});

check('Unknown locations are never guessed from cities, text or owning countries', () => {
    const selections = Object.fromEntries(REGION_LIST.map(region => [region.key, getRegionCountries(region.key)]));
    for (const location of ['Unknown', 'London', 'Dubai', 'Somewhere in Asia', 'Mars', '', null, undefined]) {
        assert.deepEqual(matchingBlockedRegions(location, regionKeys, selections), [], `${location}: no inference`);
    }
    assert.deepEqual(getCountryRegions('Mars'), []);
});

check('Unknown saved labels and inherited object keys are safe without losing literal matching', () => {
    const legacyRecord = JSON.parse('{"constructor":[],"__proto__":[],"future region":[]}');
    for (const key of ['constructor', '__proto__', 'prototype', 'toString', 'future region', '', null, undefined]) {
        assert.deepEqual(getRegionCountries(key), [], `${key}: no inherited members`);
        assert.equal(getRegionDescription(key), '', `${key}: no inherited description`);
        assert.deepEqual(getIncludedRegionCountries(key, legacyRecord), []);
        assert.equal(hasRegionCountrySelection(key, legacyRecord), false);
    }
    for (const label of ['constructor', '__proto__', 'future region']) {
        const blocked = new Set([label]);
        assert.deepEqual(matchingBlockedRegions(label.toUpperCase(), blocked, {}), [label], 'Legacy labels match exactly');
        assert.deepEqual(matchingBlockedRegions(`somewhere in ${label}`, blocked, {}), [], 'Legacy labels do not infer geography');
        assert.deepEqual(matchingBlockedRegions('India', blocked, {}), []);
    }
});

check('Region selection equality is semantic while missing and explicit-empty rules stay distinct', () => {
    const snapshot = strict({ asia: ['india', 'south korea'], africa: ['cape verde'] });
    const reordered = { Africa: ['Cabo Verde'], ASIA: ['Korea', 'India', 'india'] };
    const original = structuredClone(reordered);
    assert.equal(areRegionCountrySelectionsEqual(snapshot, structuredClone(snapshot)), true);
    assert.equal(areRegionCountrySelectionsEqual(snapshot, reordered), true, 'Case, aliases, order and duplicates do not cause edits');
    assert.equal(areRegionCountrySelectionsEqual(reordered, snapshot), true, 'Equality is symmetric');
    assert.deepEqual(reordered, original, 'Equality does not mutate caller data');
    assert.equal(areRegionCountrySelectionsEqual({}, {}), true);
    assert.equal(areRegionCountrySelectionsEqual({ asia: [] }, { ASIA: [] }), true);
    assert.equal(areRegionCountrySelectionsEqual({}, { asia: [] }), false, 'Absent means literal-only, [] means opted-in empty');
    assert.equal(areRegionCountrySelectionsEqual({ asia: [] }, {}), false);
    assert.equal(areRegionCountrySelectionsEqual({ asia: ['india'] }, { asia: ['japan'] }), false);
    assert.equal(areRegionCountrySelectionsEqual(snapshot, { asia: ['india', 'south korea'] }), false, 'An omitted region is a change');
});

check('Strict normalization rejects malformed, inherited, unknown and non-member rules', () => {
    const invalid = [
        null, false, 1, 'asia', [], new Date(0), new Map(),
        { asia: true }, { asia: 'india' }, { asia: null }, { asia: [1] },
        { nowhere: ['india'] }, { asia: ['france'] }, { asia: ['Mars'] },
        { asia: ['asia'] }, { europe: ['european union'] },
        Object.create({ asia: ['india'] }),
        JSON.parse('{"__proto__":{"polluted":true},"asia":["india"]}'),
        { constructor: ['india'] }, { prototype: ['india'] }
    ];
    for (const value of invalid) assert.throws(() => strict(value), TypeError);
    assert.equal({}.polluted, undefined);
});

check('Loaded rules sanitize safely without turning exclusions into full coverage', () => {
    for (const value of [null, undefined, false, 1, 'asia', [], new Date(0), new Map()]) {
        assert.deepEqual(ownEntries(normalizeRegionCountrySelections(value)), {});
    }
    const malformed = JSON.parse('{"asia":["India","india","france",null,7],"africa":[],"oceania":false,"nowhere":["japan"],"__proto__":{"polluted":true}}');
    const clean = normalizeRegionCountrySelections(malformed);
    assert.deepEqual(clean.asia, ['india']);
    assert.ok(Object.hasOwn(clean, 'africa'));
    assert.deepEqual(clean.africa, []);
    assert.ok(!Object.hasOwn(clean, 'nowhere'));
    assert.ok(!Object.hasOwn(clean, '__proto__'));
    assert.equal({}.polluted, undefined);
    assert.deepEqual(matchingBlockedRegions('Japan', new Set(['asia']), clean), []);
    assert.deepEqual(matchingBlockedRegions('Kenya', new Set(['africa']), clean), []);
    const original = { asia: ['India', 'India'] };
    const normalized = strict(original);
    assert.deepEqual(normalized.asia, ['india']);
    assert.deepEqual(original.asia, ['India', 'India'], 'Normalization does not mutate caller data');
});

check('Backup import preflights all region rules and preserves old backups', () => {
    const old = prepareBackupImport({ settings: { enabled: true, highlightBlockedTweets: true }, blockedRegions: ['Asia'] });
    assert.equal(old.settings.enabled, true);
    assert.equal(old.settings.highlightBlockedTweets, true);
    assert.ok(!Object.hasOwn(old.settings, 'regionCountrySelections'), 'Old backups do not enable expansion');
    assert.deepEqual(old.blockedRegions, ['Asia']);
    const valid = prepareBackupImport({
        settings: { regionCountrySelections: { asia: ['India'], africa: [] } }, blockedRegions: ['asia']
    });
    assert.deepEqual(valid.settings.regionCountrySelections.asia, ['india']);
    assert.deepEqual(valid.settings.regionCountrySelections.africa, []);
    for (const value of [null, [], { asia: ['france'] }, { asia: 'india' }, { nowhere: ['india'] }]) {
        assert.throws(() => prepareBackupImport({ settings: { regionCountrySelections: value }, blockedRegions: ['asia'] }), TypeError);
    }
});

// Browser storage is simulated locally: no extension context, credentials or network.
const memory = new Map();
const writes = [];
const writeAttempts = [];
let nextWriteError = null;
globalThis.browser = {
    storage: {
        local: {
            async get(keys) {
                const list = typeof keys === 'string' ? [keys] : keys;
                return Object.fromEntries(list.filter(key => memory.has(key)).map(key => [key, structuredClone(memory.get(key))]));
            },
            async set(values) {
                writeAttempts.push(structuredClone(values));
                if (nextWriteError) {
                    const error = nextWriteError;
                    nextWriteError = null;
                    throw error;
                }
                writes.push(structuredClone(values));
                for (const [key, value] of Object.entries(values)) memory.set(key, structuredClone(value));
            }
        },
        onChanged: { addListener() {} }
    }
};
const { SettingsStorage, BlockedSetStorage } = await import('../src/shared/storage.js');
const createRegionStore = () => new BlockedSetStorage({
    storageKey: STORAGE_KEYS.BLOCKED_REGIONS,
    label: 'test region filters',
    normalize: value => typeof value === 'string' ? value.trim().toLowerCase() : ''
});

// SettingsStorage logs full local preferences; suppress these routine test-fixture logs.
const originalLog = console.log;
const originalError = console.error;
try {
    console.log = (...values) => {
        if (typeof values[0] === 'string' && values[0].startsWith('✓')) originalLog(...values);
    };
    console.error = () => {};

    await checkAsync('Existing stored settings stay literal-only and preserve unrelated preferences', async () => {
        memory.clear();
        memory.set(STORAGE_KEYS.SETTINGS, { enabled: false, highlightBlockedTweets: true });
        const store = new SettingsStorage();
        await store.load();
        assert.equal(store.get('enabled'), false);
        assert.equal(store.get('highlightBlockedTweets'), true);
        assert.deepEqual(ownEntries(store.get('regionCountrySelections')), {});
    });

    await checkAsync('Loaded region selections sanitize without widening active rules', async () => {
        memory.clear();
        memory.set(STORAGE_KEYS.SETTINGS, {
            ...DEFAULT_SETTINGS,
            regionCountrySelections: { asia: ['India', 'france', 5], africa: [], unknown: ['kenya'] }
        });
        const store = new SettingsStorage();
        await store.load();
        const clean = store.get('regionCountrySelections');
        assert.deepEqual(clean.asia, ['india']);
        assert.deepEqual(clean.africa, []);
        assert.ok(!Object.hasOwn(clean, 'unknown'));
        assert.deepEqual(matchingBlockedRegions('Japan', new Set(['asia']), clean), []);
    });

    await checkAsync('Valid settings persist; rejected updates cannot change state, revision or storage', async () => {
        memory.clear();
        writes.length = 0;
        const store = new SettingsStorage();
        await store.load();
        await store.set('regionCountrySelections', { asia: ['India'], africa: [] });
        assert.deepEqual(store.get('regionCountrySelections').asia, ['india']);
        assert.deepEqual(memory.get(STORAGE_KEYS.SETTINGS).regionCountrySelections.asia, ['india']);
        const before = structuredClone(store.snapshot());
        const writeCount = writes.length;
        let notifications = 0;
        store.addListener(() => { notifications += 1; });
        await store.set('regionCountrySelections', structuredClone(store.get('regionCountrySelections')));
        await store.set('regionCountrySelections', { AFRICA: [], Asia: ['India', 'india'] });
        assert.deepEqual(store.snapshot(), before, 'Semantic no-op edits do not advance revisions');
        assert.equal(writes.length, writeCount, 'Semantic no-op edits do not write storage');
        assert.equal(notifications, 0, 'Semantic no-op edits do not trigger content refreshes');
        for (const value of [null, [], { asia: ['france'] }, { asia: 'india' }, { unknown: ['india'] }]) {
            await assert.rejects(store.set('regionCountrySelections', value), TypeError);
        }
        assert.deepEqual(store.snapshot(), before);
        assert.equal(writes.length, writeCount);
        assert.deepEqual(memory.get(STORAGE_KEYS.SETTINGS).regionCountrySelections.asia, ['india']);
        await store.set('regionCountrySelections', { asia: [] });
        assert.deepEqual(store.get('regionCountrySelections').asia, [], 'Queue recovers after rejected updates');
    });

    await checkAsync('Atomic region edits merge concurrent changes without erasing other regions', async () => {
        memory.clear();
        writes.length = 0;
        const store = new SettingsStorage();
        await store.load();
        await Promise.all([
            store.setRegionCountries('ASIA', ['India']),
            store.setRegionCountries('Europe', ['Germany'])
        ]);
        assert.deepEqual(ownEntries(store.get('regionCountrySelections')), { asia: ['india'], europe: ['germany'] });
        assert.deepEqual(memory.get(STORAGE_KEYS.SETTINGS).regionCountrySelections, { asia: ['india'], europe: ['germany'] });

        await store.setRegionCountries('Asia', ['Japan']);
        assert.deepEqual(store.get('regionCountrySelections').asia, ['japan']);
        assert.deepEqual(store.get('regionCountrySelections').europe, ['germany']);
        await store.setRegionCountries('North America', ['USA', 'United States', 'U.S. Virgin Islands']);
        assert.deepEqual(store.get('regionCountrySelections')['north america'], ['united states', 'us virgin islands']);
        await store.setRegionCountries('Asia', null);
        assert.ok(!Object.hasOwn(store.get('regionCountrySelections'), 'asia'), 'Null removes only the named region');
        assert.deepEqual(store.get('regionCountrySelections').europe, ['germany']);
        assert.deepEqual(store.get('regionCountrySelections')['north america'], ['united states', 'us virgin islands']);
        await store.setRegionCountries('Asia', []);
        assert.equal(hasRegionCountrySelection('asia', store.get('regionCountrySelections')), true);
        assert.deepEqual(store.get('regionCountrySelections').asia, [], 'Explicit empty arrays remain enabled');

        const before = structuredClone(store.snapshot());
        const storedBefore = structuredClone(memory.get(STORAGE_KEYS.SETTINGS));
        const writeCount = writes.length;
        const invalidEdits = [
            ['asia', ['France']], ['asia', [7]], ['asia', 'india'], ['asia', false],
            ['asia', {}], ['asia', undefined], ['unknown', ['india']],
            ['constructor', []], ['__proto__', []], [null, ['india']]
        ];
        for (const [region, countries] of invalidEdits) {
            await assert.rejects(async () => store.setRegionCountries(region, countries), TypeError);
        }
        assert.deepEqual(store.snapshot(), before, 'Rejected edits cannot advance revisions or erase selections');
        assert.deepEqual(memory.get(STORAGE_KEYS.SETTINGS), storedBefore);
        assert.equal(writes.length, writeCount);
        await store.setRegionCountries('Asia', ['India']);
        assert.deepEqual(store.get('regionCountrySelections').europe, ['germany'], 'Queue recovers without losing sibling regions');
    });

    await checkAsync('Partial restoration of older backups preserves existing region-country coverage', async () => {
        memory.clear();
        const store = new SettingsStorage();
        await store.load();
        await store.setRegionCountries('Asia', ['India']);
        await store.setRegionCountries('Europe', ['Germany']);
        const coverage = structuredClone(store.get('regionCountrySelections'));
        const old = prepareBackupImport({
            settings: { enabled: false, highlightBlockedTweets: true }, blockedRegions: ['asia']
        });
        assert.ok(!Object.hasOwn(old.settings, 'regionCountrySelections'));
        await store.set(old.settings);
        assert.equal(store.get('enabled'), false);
        assert.equal(store.get('highlightBlockedTweets'), true);
        assert.deepEqual(store.get('regionCountrySelections'), coverage, 'Omitted newer settings are preserved, not reset');
        assert.deepEqual(memory.get(STORAGE_KEYS.SETTINGS).regionCountrySelections, coverage);
    });

    await checkAsync('Country edits activate exactly their region in one committed storage transaction', async () => {
        memory.clear();
        const store = new SettingsStorage();
        const regions = createRegionStore();
        await Promise.all([store.load(), regions.load()]);
        await store.setRegionCountries('Europe', ['Germany']);
        await regions.add('europe');
        writes.length = 0;
        const before = { settings: store.revision, regions: regions.revision };
        const notifications = [];
        store.addListener(() => notifications.push({
            active: regions.isBlocked('asia'),
            countries: [...(store.get('regionCountrySelections').asia || [])]
        }));
        await store.setRegionCountries('ASIA', ['India'], { activate: true, regionStore: regions });
        assert.deepEqual(ordered(regions.snapshot().data), ['asia', 'europe']);
        assert.deepEqual(store.get('regionCountrySelections').asia, ['india']);
        assert.deepEqual(store.get('regionCountrySelections').europe, ['germany']);
        assert.deepEqual(notifications, [{ active: true, countries: ['india'] }], 'Listeners see both committed states together');
        assert.equal(writes.length, 1, 'Activation and country coverage must use one storage write');
        for (const key of [STORAGE_KEYS.SETTINGS, store.revisionKey, regions.storageKey, regions.revisionKey]) {
            assert.ok(Object.hasOwn(writes[0], key), `Combined transaction includes ${key}`);
        }
        assert.equal(store.revision, before.settings + 1);
        assert.equal(regions.revision, before.regions + 1);
        assert.deepEqual(memory.get(regions.storageKey), regions.snapshot().data);
        assert.deepEqual(memory.get(STORAGE_KEYS.SETTINGS).regionCountrySelections, store.get('regionCountrySelections'));
        assert.deepEqual(matchingBlockedRegions('India', regions.values, store.get('regionCountrySelections')), ['asia']);
        assert.deepEqual(matchingBlockedRegions('Japan', regions.values, store.get('regionCountrySelections')), [], 'Activation does not select unrelated countries');

        const committed = { settings: store.snapshot(), regions: regions.snapshot() };
        await store.setRegionCountries('Asia', ['INDIA', 'India'], { activate: true, regionStore: regions });
        assert.deepEqual({ settings: store.snapshot(), regions: regions.snapshot() }, committed);
        assert.equal(writes.length, 1, 'Repeated semantic no-op activation does not write');
        assert.equal(notifications.length, 1);

        await regions.remove('asia');
        writes.length = 0;
        const settingsRevision = store.revision;
        const regionsRevision = regions.revision;
        await store.setRegionCountries('Asia', ['India'], { activate: true, regionStore: regions });
        assert.equal(regions.isBlocked('asia'), true, 'Existing inactive coverage can still activate its region');
        assert.equal(store.revision, settingsRevision, 'Activation-only edits do not change settings revision');
        assert.equal(regions.revision, regionsRevision + 1);
        assert.equal(writes.length, 1);
        assert.equal(notifications.length, 1, 'Unchanged coverage does not notify settings listeners');

        await store.setRegionCountries('Asia', null);
        assert.equal(regions.isBlocked('asia'), true, 'Removing coverage preserves the active literal-region filter');
        assert.deepEqual(matchingBlockedRegions('Asia', regions.values, store.get('regionCountrySelections')), ['asia']);
        assert.deepEqual(matchingBlockedRegions('India', regions.values, store.get('regionCountrySelections')), []);
        await store.setRegionCountries('Africa', [], { activate: true, regionStore: regions });
        assert.equal(regions.isBlocked('africa'), true);
        assert.equal(hasRegionCountrySelection('africa', store.get('regionCountrySelections')), true);
        assert.deepEqual(matchingBlockedRegions('Kenya', regions.values, store.get('regionCountrySelections')), [], 'Enabled empty coverage never becomes all countries');
    });

    await checkAsync('Malformed activation cannot write, enable a region or erase valid sibling filters', async () => {
        memory.clear();
        const store = new SettingsStorage();
        const regions = createRegionStore();
        await Promise.all([store.load(), regions.load()]);
        await store.setRegionCountries('Europe', ['Germany'], { activate: true, regionStore: regions });
        const before = structuredClone({ settings: store.snapshot(), regions: regions.snapshot() });
        const attemptCount = writeAttempts.length;
        let notifications = 0;
        store.addListener(() => { notifications += 1; });
        const invalid = [
            ['Asia', ['France'], { activate: true, regionStore: regions }],
            ['Asia', [7], { activate: true, regionStore: regions }],
            ['Asia', 'India', { activate: true, regionStore: regions }],
            ['unknown', ['India'], { activate: true, regionStore: regions }],
            ['constructor', [], { activate: true, regionStore: regions }],
            ['Asia', ['India'], { activate: 'yes', regionStore: regions }],
            ['Asia', ['India'], { activate: true }],
            ['Asia', ['India'], { activate: true, regionStore: {} }],
            ['Asia', ['India'], { activate: true, regionStore: new BlockedSetStorage({
                storageKey: STORAGE_KEYS.BLOCKED_COUNTRIES,
                label: 'not the region store', normalize: canonicalCountry
            }) }]
        ];
        for (const [region, countries, options] of invalid) {
            await assert.rejects(async () => store.setRegionCountries(region, countries, options), TypeError);
        }
        assert.deepEqual({ settings: store.snapshot(), regions: regions.snapshot() }, before);
        assert.equal(writeAttempts.length, attemptCount, 'Invalid activation rejects before any storage call');
        assert.equal(notifications, 0);
        assert.equal(regions.isBlocked('asia'), false);
    });

    await checkAsync('Failed activation writes leave both stores unchanged and their queues recover', async () => {
        memory.clear();
        const store = new SettingsStorage();
        const regions = createRegionStore();
        await Promise.all([store.load(), regions.load()]);
        await store.setRegionCountries('Asia', ['India'], { activate: true, regionStore: regions });
        let notifications = 0;
        store.addListener(() => { notifications += 1; });
        for (const [region, countries] of [['Europe', ['Germany']], ['Asia', ['Japan']]]) {
            const before = structuredClone({ settings: store.snapshot(), regions: regions.snapshot() });
            const persisted = structuredClone([...memory.entries()]);
            const attemptCount = writeAttempts.length;
            nextWriteError = new Error('Injected combined region write failure');
            await assert.rejects(store.setRegionCountries(region, countries, { activate: true, regionStore: regions }), /Injected combined region write failure/);
            assert.deepEqual({ settings: store.snapshot(), regions: regions.snapshot() }, before, 'Failed writes publish neither half of the update');
            assert.deepEqual([...memory.entries()], persisted, 'Both persisted stores remain unchanged');
            assert.equal(writeAttempts.length, attemptCount + 1, 'Failure is a single combined write, not partial writes plus rollback');
            assert.equal(notifications, 0, 'Failed writes do not notify listeners');
        }
        assert.equal(regions.isBlocked('europe'), false);
        assert.deepEqual(store.get('regionCountrySelections').asia, ['india']);
        await Promise.all([
            store.setRegionCountries('Europe', ['Germany'], { activate: true, regionStore: regions }),
            regions.add('africa'),
            store.setRegionCountries('Asia', ['Japan'], { activate: true, regionStore: regions })
        ]);
        assert.deepEqual(ordered(regions.snapshot().data), ['africa', 'asia', 'europe']);
        assert.deepEqual(store.get('regionCountrySelections').asia, ['japan']);
        assert.deepEqual(store.get('regionCountrySelections').europe, ['germany']);
        assert.equal(notifications, 2, 'Both successful coverage changes notify after recovery');
    });

    await checkAsync('Coordinated activation serializes races with ordinary settings and region-list edits', async () => {
        memory.clear();
        const store = new SettingsStorage();
        const regions = createRegionStore();
        await Promise.all([store.load(), regions.load()]);
        await Promise.all([
            regions.add('africa'),
            store.setRegionCountries('Asia', ['India'], { activate: true, regionStore: regions }),
            regions.add('europe'),
            store.setRegionCountries('Africa', ['Cabo Verde'], { activate: true, regionStore: regions }),
            store.set('highlightBlockedTweets', true)
        ]);
        assert.deepEqual(ordered(regions.snapshot().data), ['africa', 'asia', 'europe']);
        assert.deepEqual(ownEntries(store.get('regionCountrySelections')), { asia: ['india'], africa: ['cape verde'] });
        assert.equal(store.get('highlightBlockedTweets'), true);
        assert.equal(store.revision, 3, 'Only the two changed coverages and one ordinary setting advance settings revision');
        assert.equal(regions.revision, 3, 'Already-active Africa does not get an unnecessary region revision');
        assert.deepEqual(memory.get(regions.storageKey), regions.snapshot().data);
        assert.deepEqual(memory.get(STORAGE_KEYS.SETTINGS).regionCountrySelections, store.get('regionCountrySelections'));
    });
} finally {
    console.log = originalLog;
    console.error = originalError;
    delete globalThis.browser;
}

console.log(`Region filtering: ${checks} regression groups passed.`);
