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
