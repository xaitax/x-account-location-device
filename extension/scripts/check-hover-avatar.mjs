/** Local avatar resolution and ownership checks. No browser, network or image requests. */
import assert from 'node:assert/strict';
import { normalizeAvatarUrl, resolveCardAvatar } from '../src/content/hovercard-avatar.js';

const MAIN = 'https://pbs.twimg.com/profile_images/123/main_bigger.jpg';
const QUOTED = 'https://pbs.twimg.com/profile_images/456/quote_normal.png';
const CACHED = 'https://pbs.twimg.com/profile_images/789/cached.webp';

class Element {
    constructor(tag = 'div', attributes = {}) {
        this.tagName = tag.toUpperCase(); this.attributes = new Map(); this.dataset = {};
        this.children = []; this.parentElement = null; this.style = {}; this.hidden = false; this.connected = true;
        for (const [name, value] of Object.entries(attributes)) this.setAttribute(name, value);
    }
    setAttribute(name, value) {
        this.attributes.set(name, String(value));
        if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = String(value);
    }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    append(...nodes) { for (const node of nodes) { this.children.push(node); node.parentElement = this; } }
    get isConnected() { return this.connected && (!this.parentElement || this.parentElement.isConnected); }
    getClientRects() { return this.noRects ? [] : [{}]; }
    contains(node) { return this === node || this.children.some(child => child.contains(node)); }
    matches(selector) {
        return selector.split(',').some(part => {
            part = part.trim(); const tag = /^[a-z]+/i.exec(part)?.[0];
            if (tag && tag.toUpperCase() !== this.tagName) return false;
            const attributes = [...part.matchAll(/\[([\w-]+)(?:(\^?=)"([^"]*)")?\]/g)];
            return Boolean(tag || attributes.length) && attributes.every(([, name, operator, value]) => {
                const actual = this.getAttribute(name);
                return !operator ? actual !== null : operator === '^=' ? actual?.startsWith(value) : actual === value;
            });
        });
    }
    closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) || null; }
    querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
}

function author(scope, handle, url = MAIN) {
    const container = new Element('div', { 'data-testid': `UserAvatar-Container-${handle}` });
    const image = new Element('img', { src: url }); container.append(image);
    const owner = new Element('div', { 'data-testid': 'User-Name', 'data-x-screen-name': handle });
    const anchor = new Element('span'); owner.append(anchor); scope.append(container, owner);
    return { container, image, owner, anchor };
}
function post(handle = 'alice', url = MAIN) {
    const article = new Element('article', { 'data-testid': 'tweet' });
    return { article, ...author(article, handle, url) };
}
const resolve = (fixture, info = {}, profile = null, screenName = 'alice') => resolveCardAvatar({ anchor: fixture?.anchor, screenName, info, profile });
const cached = (restId = '123') => ({ meta: { restId, avatarUrl: CACHED, profileImageShape: 'Square' } });
let groups = 0;
function check(name, run) { run(); groups++; console.log(`PASS ${name}`); }

check('Avatar URLs allow only bounded HTTPS raster profile artwork and strip query/fragment', () => {
    for (const suffix of ['jpg', 'jpeg', 'png', 'webp', 'gif']) {
        const url = `https://pbs.twimg.com/profile_images/123/avatar_bigger.${suffix}`;
        assert.equal(normalizeAvatarUrl(`${url}?name=normal#fragment`), url);
    }
    for (const invalid of [null, {}, 123, '', ` ${MAIN}`, `${MAIN} `, MAIN.replace('https:', 'http:'),
        MAIN.replace('pbs.twimg.com', 'pbs.twimg.com.evil.test'), MAIN.replace('pbs.twimg.com', 'user@pbs.twimg.com'),
        MAIN.replace('pbs.twimg.com', 'pbs.twimg.com:443'), MAIN.replace('pbs.twimg.com', 'pbs.twimg.com:8443'),
        MAIN.replace('.jpg', '.svg'), 'data:image/png;base64,AAAA', 'javascript:alert(1)',
        'https://pbs.twimg.com/media/123.jpg', 'https://abs.twimg.com/sticky/default_profile_images/default_profile_normal.png',
        'https://pbs.twimg.com/profile_images/123/a%2favatar.jpg', 'https://pbs.twimg.com/profile_images/123/' + 'x'.repeat(161) + '.jpg',
        MAIN + '?x=' + 'x'.repeat(512)]) assert.equal(normalizeAvatarUrl(invalid), null, String(invalid));
});

check('The exact live author avatar appears without About metadata or an account lookup', () => {
    const fixture = post('ALICE');
    assert.deepEqual(resolve(fixture), { url: MAIN, shape: 'circle' });
    fixture.image.currentSrc = QUOTED;
    assert.deepEqual(resolve(fixture), { url: QUOTED, shape: 'circle' }, 'Current rendered source takes precedence over src');
});

check('Direct, reply and quoted authors remain in their own article/quote boundaries', () => {
    const main = post();
    const quote = new Element('div', { role: 'link', tabindex: '0' }); main.article.append(quote);
    const quoted = author(quote, 'bob', QUOTED);
    const reply = post('carol', CACHED); main.article.append(reply.article);
    assert.deepEqual(resolve(main), { url: MAIN, shape: 'circle' });
    assert.deepEqual(resolve(quoted, {}, null, 'bob'), { url: QUOTED, shape: 'circle' });
    assert.deepEqual(resolve(reply, {}, null, 'carol'), { url: CACHED, shape: 'circle' });
});

check('Repeated handles inside quotes do not borrow the outer same-handle image', () => {
    const main = post(); const quote = new Element('div', { 'data-testid': 'quoteTweet' }); main.article.append(quote);
    const same = author(quote, 'alice', QUOTED);
    assert.deepEqual(resolve(same), { url: QUOTED, shape: 'circle' });
    same.image.hidden = true;
    assert.equal(resolve(same), null, 'An unpainted quote avatar cannot be replaced by the containing post\'s image');
    assert.deepEqual(resolve(main), { url: MAIN, shape: 'circle' });
});

check('People-list rows resolve only their own exact account image', () => {
    const rows = new Element();
    const cell = new Element('button', { 'data-testid': 'UserCell', 'data-x-screen-name': 'alice' }); rows.append(cell);
    const own = author(cell, 'alice', MAIN);
    const otherCell = new Element('button', { 'data-testid': 'UserCell', 'data-x-screen-name': 'bob' }); rows.append(otherCell); author(otherCell, 'bob', QUOTED);
    assert.deepEqual(resolve(own), { url: MAIN, shape: 'circle' });
    own.image.hidden = true; assert.equal(resolve(own), null);
});

check('Recycled handles and disconnected anchors reject even an otherwise valid cached fallback', () => {
    const fixture = post(); fixture.owner.dataset.xScreenName = 'bob';
    assert.equal(resolve(fixture, cached()), null);
    fixture.owner.dataset.xScreenName = 'alice'; fixture.anchor.connected = false;
    assert.equal(resolve(fixture, cached()), null);
    for (const name of [null, '', 'a'.repeat(16), 'alice\n', '@alice', 'with space']) assert.equal(resolveCardAvatar({ screenName: name, info: cached() }), null);
});

check('Cached fallback requires compatible immutable identity and never coerces numeric IDs', () => {
    assert.deepEqual(resolveCardAvatar({ screenName: 'alice', info: cached() }), { url: CACHED, shape: 'square' });
    assert.deepEqual(resolveCardAvatar({ screenName: 'alice', info: cached('123'), profile: { userId: '123' } }), { url: CACHED, shape: 'square' });
    assert.equal(resolveCardAvatar({ screenName: 'alice', info: cached('123'), profile: { userId: '456' } }), null);
    assert.equal(resolveCardAvatar({ screenName: 'alice', info: cached(123), profile: { userId: '123' } }), null);
    assert.equal(resolveCardAvatar({ screenName: 'alice', info: { meta: { avatarUrl: CACHED } }, profile: { userId: '123' } }), null);
    assert.deepEqual(resolve(post(), cached('123'), { userId: '456' }), { url: MAIN, shape: 'circle' }, 'Current owned DOM remains usable without borrowing stale metadata shape');
});

check('Hidden, unpainted, foreign-source and wrong-account images are skipped conservatively', () => {
    for (const invalidate of [fixture => { fixture.image.hidden = true; }, fixture => { fixture.image.noRects = true; },
        fixture => { fixture.image.connected = false; }, fixture => { fixture.container.setAttribute('data-testid', 'UserAvatar-Container-bob'); },
        fixture => { fixture.image.setAttribute('src', 'https://evil.test/avatar.jpg'); }]) {
        const fixture = post(); invalidate(fixture); assert.equal(resolve(fixture), null);
        assert.deepEqual(resolve(fixture, cached()), { url: CACHED, shape: 'square' });
    }
});

check('Square shape comes from compatible metadata or explicit native image presentation', () => {
    assert.deepEqual(resolve(post(), cached()), { url: MAIN, shape: 'square' });
    const alt = post(); alt.image.setAttribute('alt', 'Square profile picture');
    assert.equal(resolve(alt).shape, 'square');
    const clipped = post(); clipped.image.style.clipPath = 'url("#shape-square-rx-16")';
    assert.equal(resolve(clipped).shape, 'square');
    const unknown = { meta: { avatarUrl: CACHED, profileImageShape: 'Hexagon' } };
    assert.equal(resolveCardAvatar({ screenName: 'alice', info: unknown }).shape, 'circle');
});

console.log(`Avatar regression checks passed (${groups} groups).`);
