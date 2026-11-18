/**
 * Exact bio matching checks. Exercises the production helper used by hasBlockedBio.
 * No browser, X requests or account changes.
 * Run via `npm run check:bio` (also included in `npm run lint`).
 */
import assert from 'node:assert/strict';
import { includesWholeTerm } from '../src/shared/utils.js';

const cases = [
    ['cat', 'my cat is here', true],
    ['cat', 'concatenate', false],
    ['cat', 'copycat', false],
    ['cat', 'cat, dog', true],
    ['cat', 'dog. cat', true],
    ['cat', 'cat', true],
    ['foo bar', 'foo bar', true],
    ['foo bar', 'foo barista', false],
    ['foo bar', 'foo, bar', false],
    ['c++', 'i use c++ daily', true],
    ['c++', 'abc++', false],
    ['🚀', 'hello 🚀', true],
    ['é', 'café', false],
    ['é', 'é isso', true],
    ['hello', 'hello, world', true],
    ['hello', 'shelloworld', false]
];

for (const [needle, haystack, expected] of cases) {
    assert.equal(includesWholeTerm(haystack, needle), expected, `${needle} in ${haystack}`);
}

console.log(`${cases.length} exact bio matching checks passed.`);
