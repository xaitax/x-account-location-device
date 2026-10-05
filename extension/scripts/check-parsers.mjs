/**
 * Guard the shared AboutAccountQuery parser and each caller's metadata projection.
 * Rollup bundles the shared module into the page script's MAIN-world IIFE, so
 * neither caller needs its own response mapping. Parse syntax rather than matching
 * textual object keys: comments, formatting and nested objects cannot fool this check.
 * Run via `npm run check:parsers` (also included in `npm run lint`).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAst } from 'rollup/parseAst';
import { parseAccountResponse, AccountResponseMismatchError } from '../src/shared/account-response.js';
import { getAccountVerification } from '../src/shared/account-verification.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sharedPath = '../shared/account-response.js';

function parse(file) {
    return parseAst(fs.readFileSync(path.join(root, file), 'utf8'));
}

function walk(node, visit) {
    if (!node || typeof node !== 'object') return;
    if (typeof node.type === 'string') visit(node);
    for (const value of Object.values(node)) {
        if (Array.isArray(value)) value.forEach(child => walk(child, visit));
        else if (value && typeof value === 'object') walk(value, visit);
    }
}

function propertyName(node) {
    if (!node.computed && node.property?.type === 'Identifier') return node.property.name;
    if (node.property?.type === 'Literal') return node.property.value;
    return null;
}

function checkCaller(file, fullMetadata) {
    const ast = parse(file);
    const imports = ast.body.filter(node => node.type === 'ImportDeclaration' && node.source.value === sharedPath);
    const bindings = imports.flatMap(node => node.specifiers).filter(node =>
        node.type === 'ImportSpecifier' && node.imported.name === 'parseAccountResponse'
    );
    assert.equal(bindings.length, 1, `${file}: import the shared response parser exactly once`);
    const parserName = bindings[0].local.name;
    const calls = [];
    walk(ast, node => {
        if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === parserName) {
            calls.push(node);
        }
        if (node.type === 'MemberExpression') {
            assert.ok(!['about_profile', 'user_result_by_screen_name'].includes(propertyName(node)),
                `${file}: raw AboutAccount response mapping belongs in shared/account-response.js`);
        }
    });
    assert.equal(calls.length, 1, `${file}: delegate to the shared response parser exactly once`);
    const args = calls[0].arguments;
    if (fullMetadata) {
        assert.equal(args.length, 2, `${file}: retain the default full metadata projection`);
    } else {
        assert.equal(args.length, 3, `${file}: explicitly request the page metadata subset`);
        assert.equal(args[2].type, 'ObjectExpression', `${file}: use explicit parser options`);
        assert.equal(args[2].properties.length, 1, `${file}: keep the page projection explicit`);
        const option = args[2].properties[0];
        assert.equal(option.type, 'Property', `${file}: do not spread parser options`);
        assert.equal(option.computed, false, `${file}: use a literal projection option`);
        assert.equal(option.key.name || option.key.value, 'fullMetadata');
        assert.equal(option.value.type, 'Literal');
        assert.equal(option.value.value, false, `${file}: retain the page metadata subset`);
    }
    console.log(`${file}: shared parser, ${fullMetadata ? 'full' : 'page'} metadata projection`);
}

const shared = parse('src/shared/account-response.js');
assert.ok(shared.body.some(node => node.type === 'ExportNamedDeclaration' &&
    node.declaration?.type === 'FunctionDeclaration' && node.declaration.id.name === 'parseAccountResponse'),
'The shared response parser must remain an exported function');
assert.ok(!shared.body.some(node => node.type === 'ImportDeclaration'),
    'The shared response projection must remain independent of browser and transport modules');
checkCaller('src/background/api-client.js', true);
checkCaller('src/content/page-script.js', false);
console.log('AboutAccount response mapping is centralized in both execution paths.');

// Realistic metadata fixtures ensure X's organization checkmarks are not lost
// or mistaken for blue verification when is_blue_verified is also true.
const account = (overrides = {}) => ({ data: { user_result_by_screen_name: { result: {
    core: { screen_name: 'sample', name: 'Sample account' },
    about_profile: { account_based_in: 'Switzerland', source: 'Switzerland App Store' },
    ...overrides
} } } });
let metadataChecks = 0;
function checkMetadata(name, action) {
    action();
    metadataChecks += 1;
    console.log(`✓ ${name}`);
}

checkMetadata('Business gold check takes precedence over is_blue_verified=true', () => {
    const result = parseAccountResponse(account({ is_blue_verified: true,
        verification: { verified: false, verified_type: 'Business' } }), 'sample');
    assert.equal(result.meta.verifiedType, 'business');
    assert.equal(result.meta.blueVerified, true);
    assert.equal(result.meta.verified, false);
    assert.deepEqual(getAccountVerification(result.meta), {
        type: 'business', label: 'Business verified', tone: 'gold',
        title: 'Gold checkmark / Verified business or organization'
    });
    assert.equal(JSON.parse(JSON.stringify(result)).meta.verifiedType, 'business',
        'Full metadata survives ordinary runtime message serialization');
});

checkMetadata('Government grey check takes precedence over blue and legacy booleans', () => {
    for (const blueVerified of [false, true]) {
        const result = parseAccountResponse(account({ is_blue_verified: blueVerified,
            verification: { verified: true, verified_type: 'Government' } }), 'sample');
        assert.equal(result.meta.verifiedType, 'government');
        assert.deepEqual(getAccountVerification(result.meta), {
            type: 'government', label: 'Government verified', tone: 'grey',
            title: 'Grey checkmark / Government or multilateral organization'
        });
    }
});

checkMetadata('A region-only account without verification remains unverified', () => {
    const result = parseAccountResponse(account({
        about_profile: { account_based_in: 'Africa', location_accurate: false }
    }), 'sample');
    assert.equal(result.location, 'Africa');
    assert.equal(result.locationAccurate, false);
    assert.equal(result.meta.verifiedType, null);
    assert.equal(getAccountVerification(result.meta), null);
    assert.ok(!Object.hasOwn(result.meta, 'vpn'), 'Location uncertainty is not proof of VPN use');
});

checkMetadata('Verification type normalization rejects unknown and malformed values', () => {
    for (const [raw, expected] of [[' Business ', 'business'], ['GOVERNMENT', 'government'],
        ['blue', 'blue'], ['Gold', null], ['Grey', null], ['Enterprise', null], ['', null],
        [null, null], [undefined, null], [true, null], [42, null], [{ type: 'Business' }, null],
        [['Business'], null]]) {
        const result = parseAccountResponse(account({
            verification: { verified_type: raw }
        }), 'sample');
        assert.equal(result.meta.verifiedType, expected);
        assert.equal(getAccountVerification(result.meta)?.type || null, expected);
    }
});

checkMetadata('Blue and legacy fallback preserve their distinct meaning', () => {
    assert.equal(getAccountVerification({ blueVerified: true, verified: true }).type, 'blue');
    assert.equal(getAccountVerification({ verifiedType: 'blue', blueVerified: false }).type, 'blue');
    assert.equal(getAccountVerification({ verifiedType: 'unknown', blueVerified: true }).type, 'blue');
    assert.deepEqual(getAccountVerification({ verified: true }), {
        type: 'legacy', label: 'Legacy verified', tone: 'neutral',
        title: 'Legacy verification reported by X'
    });
    for (const meta of [null, undefined, {}, { verified: false }, { verified: 'true' },
        { blueVerified: 'true' }, { identityVerified: true }, { protected: true }]) {
        assert.equal(getAccountVerification(meta), null);
    }
});

checkMetadata('Unknown reported types use booleans without inventing organization verification', () => {
    const blue = parseAccountResponse(account({ is_blue_verified: true,
        verification: { verified_type: 'Other' } }), 'sample');
    assert.equal(getAccountVerification(blue.meta).type, 'blue');
    const legacy = parseAccountResponse(account({
        verification: { verified: true, verified_type: 'Other' }
    }), 'sample');
    assert.equal(getAccountVerification(legacy.meta).type, 'legacy');
});

checkMetadata('Page fallback intentionally keeps its existing metadata projection', () => {
    const result = parseAccountResponse(account({ is_blue_verified: true,
        verification: { verified: true, verified_type: 'Business' }
    }), 'sample', { fullMetadata: false });
    for (const field of ['verifiedType', 'blueVerified', 'verified', 'identityVerified', 'verifiedSinceMsec']) {
        assert.ok(!Object.hasOwn(result.meta, field), `Page subset must omit ${field}`);
    }
    assert.equal(getAccountVerification(result.meta), null);
});

checkMetadata('Returned account identity mismatch still rejects metadata', () => {
    assert.throws(() => parseAccountResponse(account({
        verification: { verified_type: 'Business' }
    }), 'another'), AccountResponseMismatchError);
});
console.log(`${metadataChecks} account-verification metadata regression groups passed.`);
