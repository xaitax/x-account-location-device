/**
 * Guard: the two AboutAccountQuery parsers must stay in sync.
 *
 * `background/api-client.js` parses X's response for the normal path. `content/page-script.js`
 * parses the SAME response for the in-page fallback used when the background can't
 * authenticate. The page script runs in the MAIN world, so it cannot import from shared/ —
 * the duplication is unavoidable, but silent divergence is not.
 *
 * This has already caused a real bug: page-script emitted `restId` without ever reading
 * the affiliation, so accounts were cached as confirmed-unaffiliated and the affiliation
 * filter stopped working after a page refresh.
 *
 * Run via `npm run check:parsers` (and as part of `npm run lint`).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Pull the key names out of the `meta: { ... }` object literal a parser returns. */
function metaKeys(file, startMarker) {
    const src = fs.readFileSync(path.join(root, file), 'utf8');
    const from = src.indexOf(startMarker);
    if (from === -1) throw new Error(`${file}: could not find ${startMarker}`);

    const metaAt = src.indexOf('meta: {', from);
    if (metaAt === -1) throw new Error(`${file}: no 'meta: {' after ${startMarker}`);

    // Walk braces so nested objects don't end the block early.
    let braces = 0;
    let end = metaAt + 'meta: '.length;
    for (let i = end; i < src.length; i++) {
        if (src[i] === '{') braces++;
        else if (src[i] === '}') {
            braces--;
            if (braces === 0) { end = i; break; }
        }
    }

    // Collect keys at depth 1 only, so nested objects (e.g. affiliate: { name })
    // don't leak their fields in. Indentation differs between the two files, so
    // brace depth is the reliable signal rather than column count.
    const body = src.slice(src.indexOf('{', metaAt) + 1, end);
    const keys = new Set();
    let depth = 0;
    for (const rawLine of body.split('\n')) {
        const line = rawLine.trim();
        if (depth === 0) {
            // `key: value`, `key,` and a trailing shorthand `key` with no comma.
            const m = line.match(/^([a-zA-Z][a-zA-Z0-9]*)\s*(?:[,:]|$)/);
            if (m) keys.add(m[1]);
        }
        for (const ch of line) {
            if (ch === '{' || ch === '[') depth++;
            else if (ch === '}' || ch === ']') depth--;
        }
    }
    return keys;
}

const apiKeys = metaKeys('src/background/api-client.js', 'parseResponse');
const pageKeys = metaKeys('src/content/page-script.js', 'function parseAboutAccount');

// Fields the page-script fallback is allowed to omit: they exist only to enrich the
// hovercard, which re-fetches through the background anyway.
const OPTIONAL_IN_PAGE_SCRIPT = new Set([
    'profileImageShape', 'blueVerified', 'verified', 'identityVerified',
    'verifiedSinceMsec', 'protected', 'createdCountryAccurate', 'learnMoreUrl'
]);

// Fields that decide FILTERING must exist in both, or a fallback fetch silently
// mis-classifies the account.
const missing = [...apiKeys].filter(k => !pageKeys.has(k) && !OPTIONAL_IN_PAGE_SCRIPT.has(k));
const extra = [...pageKeys].filter(k => !apiKeys.has(k));

console.log(`api-client   meta keys (${apiKeys.size}): ${[...apiKeys].join(', ')}`);
console.log(`page-script  meta keys (${pageKeys.size}): ${[...pageKeys].join(', ')}`);

if (missing.length || extra.length) {
    if (missing.length) console.error(`\n✗ page-script.js is MISSING required meta fields: ${missing.join(', ')}`);
    if (extra.length) console.error(`\n✗ page-script.js emits unknown meta fields: ${extra.join(', ')}`);
    console.error('\nBoth parsers read the same X response and must agree on the fields that drive filtering.');
    process.exit(1);
}

console.log('\n✓ parsers agree on every filtering-relevant meta field');
