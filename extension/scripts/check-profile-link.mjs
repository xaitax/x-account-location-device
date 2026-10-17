/**
 * Issue #76: exercise the production ID-link control, in-place patcher and PNG
 * snapshotter with small DOM doubles. No network, clipboard or downloads.
 * Run with node scripts/check-profile-link.mjs.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { parseAst } from 'rollup/parseAst';

const hoverSource = fs.readFileSync(new URL('../src/content/hovercard.js', import.meta.url), 'utf8');
const imageSource = fs.readFileSync(new URL('../src/content/hovercard-image.js', import.meta.url), 'utf8');
const tooltipSource = fs.readFileSync(new URL('../src/content/hovercard-tooltip.js', import.meta.url), 'utf8');
const tooltipFactory = parseAst(tooltipSource).body.map(node => node.type === 'ExportNamedDeclaration' ? node.declaration : node)
    .find(node => node.type === 'FunctionDeclaration' && node.id.name === 'createCardTooltip');
const tooltipPosition = tooltipFactory.body.body.find(node => node.type === 'FunctionDeclaration' && node.id.name === 'position');
assert.ok(tooltipPosition, 'Exercise the actual nested tooltip position policy');
function functions(source, names) {
    const nodes = parseAst(source).body.map(node => node.type === 'ExportNamedDeclaration' ? node.declaration : node);
    return names.map(name => {
        const node = nodes.find(node => node?.type === 'FunctionDeclaration' && node.id.name === name);
        assert.ok(node, `Exercise the actual production ${name} function`);
        return source.slice(node.start, node.end);
    }).join('\n');
}
const imageAst = parseAst(imageSource).body;
const boundary = imageAst.find(node => node.type === 'FunctionDeclaration').start;
const imageConstants = imageAst.filter(node => node.type === 'VariableDeclaration' && node.start < boundary)
    .map(node => imageSource.slice(node.start, node.end)).join('\n');
const controllerDeclaration = parseAst(hoverSource).body.find(node => node.type === 'ClassDeclaration' && node.id.name === 'HovercardController');
const exportMethods = ['_createImageState', '_renderImageState', '_renderAllowlist'].map(name => {
    const method = controllerDeclaration.body.body.find(node => node.key?.name === name);
    assert.ok(method, `Exercise the actual production ${name} method`);
    return hoverSource.slice(method.start, method.end);
}).join('\n');
const production = functions(hoverSource, ['safeText', 'createEl', 'profileUrlForUserId', 'createUserIdValue', 'patchCardNode']) +
    '\n' + imageConstants + '\n' + functions(imageSource, ['localPaint', 'copyStyles', 'trustedArtwork', 'createSnapshot']) +
    `\nclass ExportControl { ${exportMethods}\n_isCurrentImageState() { return false; }\n_isCurrentAllowlist() { return false; }\n_exportImage(_state, action) { this.lastAction = action; } }`;

const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';
const dataAttribute = key => 'data-' + key.replace(/[A-Z]/g, letter => '-' + letter.toLowerCase());
class NodeDouble {
    static ELEMENT_NODE = 1;
    static TEXT_NODE = 3;
    constructor(document, name, namespace = HTML_NAMESPACE, text = null) {
        this.ownerDocument = document;
        this.nodeType = text === null ? NodeDouble.ELEMENT_NODE : NodeDouble.TEXT_NODE;
        this.nodeName = text === null ? name.toUpperCase() : '#text';
        this.localName = text === null ? name.toLowerCase() : undefined;
        this.namespaceURI = namespace;
        this.nodeValue = text;
        this.parentNode = null;
        this.childNodes = [];
        this.attributeMap = new Map();
        this.listeners = new Map();
        this.hidden = false;
        this.style = {
            setProperty(key, value) { this[key] = value; this[key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value; },
            removeProperty(key) { delete this[key]; delete this[key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())]; }
        };
        this.dataset = new Proxy({}, {
            get: (_, key) => this.getAttribute(dataAttribute(key)) ?? undefined,
            set: (_, key, value) => { this.setAttribute(dataAttribute(key), value); return true; },
            deleteProperty: (_, key) => { this.removeAttribute(dataAttribute(key)); return true; }
        });
        this.classList = {
            contains: name => this.className.split(/\s+/).includes(name),
            add: name => { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), name])].join(' '); },
            remove: name => { this.className = this.className.split(/\s+/).filter(value => value !== name).join(' '); },
            toggle: (name, force) => {
                const enabled = force ?? !this.classList.contains(name);
                this.classList[enabled ? 'add' : 'remove'](name);
                return enabled;
            }
        };
    }
    get attributes() { return [...this.attributeMap].map(([name, value]) => ({ name, value, namespaceURI: null })); }
    get className() { return this.getAttribute('class') || ''; }
    set className(value) { this.setAttribute('class', value); }
    get title() { return this.getAttribute('title') || ''; }
    set title(value) { this.setAttribute('title', value); }
    get href() { return this.getAttribute('href') || ''; }
    set href(value) { this.setAttribute('href', value); }
    get type() { return this.getAttribute('type') || ''; }
    set type(value) { this.setAttribute('type', value); }
    get rel() { return this.getAttribute('rel') || ''; }
    set rel(value) { this.setAttribute('rel', value); }
    get target() { return this.getAttribute('target') || ''; }
    set target(value) { this.setAttribute('target', value); }
    get parentElement() { return this.parentNode; }
    get firstChild() { return this.childNodes[0] || null; }
    get nextSibling() { return this.parentNode?.childNodes[this.parentNode.childNodes.indexOf(this) + 1] || null; }
    get isConnected() { return this === this.ownerDocument.body || Boolean(this.parentNode?.isConnected); }
    get textContent() { return this.nodeType === NodeDouble.TEXT_NODE ? this.nodeValue : this.childNodes.map(node => node.textContent).join(''); }
    set textContent(value) {
        if (this.nodeType === NodeDouble.TEXT_NODE) this.nodeValue = String(value);
        else this.replaceChildren(this.ownerDocument.createTextNode(String(value)));
    }
    setAttribute(name, value) { this.attributeMap.set(name, String(value)); }
    setAttributeNS(_namespace, name, value) { this.setAttribute(name, value); }
    getAttribute(name) { return this.attributeMap.get(name) ?? null; }
    hasAttribute(name) { return this.attributeMap.has(name); }
    removeAttribute(name) { this.attributeMap.delete(name); }
    append(...nodes) { for (const node of nodes) this.appendChild(node); }
    appendChild(node) { return this.insertBefore(node, null); }
    insertBefore(node, before) {
        node.remove();
        const index = before ? this.childNodes.indexOf(before) : this.childNodes.length;
        assert.ok(index >= 0, 'Insertion reference belongs to the parent');
        this.childNodes.splice(index, 0, node); node.parentNode = this; return node;
    }
    replaceChildren(...nodes) {
        for (const child of [...this.childNodes]) child.remove();
        this.append(...nodes);
    }
    remove() {
        if (!this.parentNode) return;
        this.parentNode.childNodes.splice(this.parentNode.childNodes.indexOf(this), 1);
        this.parentNode = null;
    }
    replaceWith(node) { this.parentNode.insertBefore(node, this); this.remove(); }
    contains(node) { return node === this || this.childNodes.some(child => child.contains(node)); }
    matches(selector) {
        return selector.split(',').some(part => {
            part = part.trim();
            if (this.nodeType !== NodeDouble.ELEMENT_NODE) return false;
            const attribute = /^\[([^=]+)="([^"]+)"\]$/.exec(part);
            if (attribute) return this.getAttribute(attribute[1]) === attribute[2];
            const tag = /^[a-z]+/i.exec(part)?.[0];
            const classes = [...part.matchAll(/\.([\w-]+)/g)].map(match => match[1]);
            return Boolean(tag || classes.length) && (!tag || this.localName === tag) &&
                classes.every(name => this.classList.contains(name));
        });
    }
    closest(selector) { return this.matches(selector) ? this : this.parentNode?.closest(selector) || null; }
    querySelectorAll(selector) {
        return this.childNodes.flatMap(child => [
            ...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)
        ]);
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    isEqualNode(other) {
        return this.nodeType === other.nodeType && this.nodeName === other.nodeName && this.nodeValue === other.nodeValue &&
            JSON.stringify(this.attributes) === JSON.stringify(other.attributes) && this.childNodes.length === other.childNodes.length &&
            this.childNodes.every((child, index) => child.isEqualNode(other.childNodes[index]));
    }
    addEventListener(type, listener) {
        if (!this.listeners.has(type)) this.listeners.set(type, new Set());
        this.listeners.get(type).add(listener);
    }
    dispatch(type) {
        const event = { type, target: this, defaultPrevented: false, stopped: false,
            preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; } };
        for (let node = this; node; node = node.parentNode) {
            for (const listener of node.listeners.get(type) || []) listener(event);
            if (event.stopped) break;
        }
        return event;
    }
    focus() { this.ownerDocument.activeElement = this; }
    getBoundingClientRect() { return { width: 340, height: 600 }; }
}

function environment() {
    let time = 0; let nextTimer = 0;
    const timers = new Map(); const writes = [];
    const document = { activeElement: null,
        createElement: name => new NodeDouble(document, name),
        createElementNS: (namespace, name) => new NodeDouble(document, name, namespace),
        createTextNode: text => new NodeDouble(document, '#text', HTML_NAMESPACE, text)
    };
    document.body = document.createElement('body');
    let clipboardResult = () => Promise.resolve();
    const navigator = { clipboard: { writeText: url => { writes.push(url); return clipboardResult(); } } };
    const context = vm.createContext({ document, navigator, Node: NodeDouble,
        dialogIcon: name => { const icon = document.createElement('svg'); icon.dataset.icon = name; return icon; },
        getComputedStyle: source => ({
            *[Symbol.iterator]() { yield 'display'; yield 'grid-template-columns'; yield 'row-gap'; },
            getPropertyValue: property => ({ display: source.style.display || 'inline',
                'grid-template-columns': source.style.gridTemplateColumns || 'none', 'row-gap': source.style.rowGap || 'normal' })[property] || '',
            width: '340px', height: '20px', display: source.hidden ? 'none' : source.style.display || 'inline'
        }),
        setTimeout: (callback, delay) => { const id = ++nextTimer; timers.set(id, { at: time + delay, callback }); return id; },
        clearTimeout: id => timers.delete(id), URL
    });
    vm.runInContext(production + '\nglobalThis.api = { profileUrlForUserId, createUserIdValue, patchCardNode, createSnapshot, ExportControl };', context);
    const { api } = context;
    const mount = (...ids) => {
        const userId = ids.length ? ids[0] : '2097352012367015936';
        const control = api.createUserIdValue(userId); document.body.append(control);
        return { control, button: control.querySelector('.x-posed-user-id-copy'),
            fallback: control.querySelector('.x-posed-user-id-fallback'), status: control.querySelector('[role="status"]') };
    };
    const advance = elapsed => {
        time += elapsed;
        for (const [id, timer] of [...timers]) if (timer.at <= time) { timers.delete(id); timer.callback(); }
    };
    return { api, document, navigator, writes, mount, advance, timers,
        clipboard: result => { clipboardResult = result; },
        settle: async () => { for (let index = 0; index < 8; index++) await Promise.resolve(); } };
}

let groups = 0;
async function check(name, action) { await action(); groups++; console.log(`PASS ${name}`); }

await check('numeric IDs retain exact 19/20-digit precision without Number conversion', () => {
    const e = environment();
    for (const id of ['1', '389229444', '2097352012367015936', '18446744073709551615']) {
        assert.equal(e.api.profileUrlForUserId(id), `https://x.com/i/user/${id}`);
        const { control, button } = e.mount(id);
        assert.equal(control.dataset.xUserId, id);
        assert.equal(button.querySelector('.x-posed-user-id-value').textContent, id);
    }
});

await check('grouped card exports retain their label, compact captions, full accessible names and focus through pending/success', () => {
    const e = environment(), renderer = new e.api.ExportControl();
    const state = renderer._createImageState('demo_account', 1);
    const [copy, save] = state.buttons;
    const heading = state.element.querySelector('.x-posed-footer-section-heading');
    const controls = state.element.querySelector('.x-posed-footer-section-controls');
    assert.equal(state.element.classList.contains('x-posed-footer-section'), true);
    assert.equal(state.element.getAttribute('role'), 'group'); assert.equal(state.element.getAttribute('aria-labelledby'), heading.id);
    assert.equal(heading.textContent, 'Card'); assert.ok(heading.id);
    assert.equal(controls.contains(copy), true); assert.equal(controls.contains(save), true);
    assert.equal(copy.textContent, 'Copy'); assert.equal(save.textContent, 'Save');
    for (const [button, caption] of [[copy, 'Copy card'], [save, 'Save card']]) {
        assert.ok(button.getAttribute('aria-label').includes(caption));
        assert.equal(button.hasAttribute('title'), false);
        assert.ok(button.dataset.xTooltipHeading.length > 0);
        assert.match(button.dataset.xTooltipDescription, /PNG|image/i);
    }
    copy.focus();
    state.pending = true; renderer._renderImageState(state);
    assert.equal(copy.getAttribute('aria-disabled'), 'true'); assert.equal(copy.getAttribute('aria-busy'), 'true');
    assert.equal(copy.textContent, 'Copy'); assert.equal(e.document.activeElement, copy);
    state.pending = false; state.success = 'copy'; renderer._renderImageState(state);
    assert.equal(copy, state.buttons[0]); assert.equal(save, state.buttons[1]);
    assert.equal(copy.hasAttribute('title'), false); assert.equal(save.hasAttribute('title'), false);
    assert.equal(copy.textContent, 'Copy'); assert.equal(copy.classList.contains('x-posed-export-button--success'), true);
    assert.equal(state.element.querySelector('.x-posed-footer-section-heading'), heading);
    assert.equal(heading.textContent, 'Card'); assert.equal(state.element.getAttribute('aria-labelledby'), heading.id);
    assert.equal(e.document.activeElement, copy);
    const event = save.dispatch('click'); assert.equal(event.defaultPrevented, true); assert.equal(event.stopped, true);
    assert.equal(renderer.lastAction, 'save');
});

await check('malformed IDs and URL injection never become actionable profile links', () => {
    const e = environment();
    const badIds = [null, undefined, 389229444, 2097352012367015936n, {}, [], '', '0', '000123', '-1', '1.2',
        '1e9', ' 123', '123 ', '123\n', '１２３', '123/../../home', '123?url=evil', '123#evil',
        'https://evil.test', '<img onerror=alert(1)>', '123456789012345678901'];
    for (const id of badIds) {
        assert.equal(e.api.profileUrlForUserId(id), null, `Reject ${String(id)}`);
        const { control, button } = e.mount(id);
        assert.equal(button, null);
        assert.equal(control.querySelector('a'), null);
    }
    assert.deepEqual(e.writes, []);
});

await check('copy uses an accessible native button and does not navigate the tweet', async () => {
    const e = environment(); const { control, button, status, fallback } = e.mount();
    assert.equal(button.localName, 'button'); assert.equal(button.type, 'button');
    assert.match(button.getAttribute('aria-label'), /Copy permanent profile link.*2097352012367015936/);
    assert.equal(button.hasAttribute('title'), false);
    assert.equal(button.dataset.xTooltipHeading, 'Copy profile link');
    assert.match(button.dataset.xTooltipDescription, /permanent User ID.*handle changes/i);
    assert.equal(button.listeners.has('keydown'), false, 'Native Enter/Space activation needs no custom key handler');
    let navigations = 0; control.addEventListener('click', () => navigations++);
    const event = button.dispatch('click');
    assert.equal(event.defaultPrevented, true); assert.equal(event.stopped, true);
    assert.equal(button.getAttribute('aria-busy'), 'true');
    await e.settle();
    assert.deepEqual(e.writes, ['https://x.com/i/user/2097352012367015936']);
    assert.equal(navigations, 0); assert.equal(fallback.hidden, true);
    assert.equal(status.textContent, 'Profile link copied');
    assert.equal(button.classList.contains('x-posed-user-id-copy--success'), true);
    assert.equal(button.hasAttribute('aria-busy'), false);
});

await check('success feedback resets without changing the visible raw ID', async () => {
    const e = environment(); const { button, status } = e.mount('18446744073709551615');
    button.dispatch('click'); await e.settle(); e.advance(1799);
    assert.equal(status.textContent, 'Profile link copied');
    e.advance(1);
    assert.equal(status.textContent, ''); assert.equal(button.dataset.xTooltipHeading, 'Copy profile link');
    assert.equal(button.hasAttribute('title'), false);
    assert.equal(button.classList.contains('x-posed-user-id-copy--success'), false);
    assert.equal(button.querySelector('.x-posed-user-id-value').textContent, '18446744073709551615');
});

await check('pending clicks are coalesced rather than duplicating clipboard writes', async () => {
    const e = environment(); let release;
    e.clipboard(() => new Promise(resolve => { release = resolve; }));
    const { button } = e.mount(); button.dispatch('click'); button.dispatch('click'); button.dispatch('click');
    assert.equal(e.writes.length, 1); assert.equal(button.getAttribute('aria-busy'), 'true');
    release(); await e.settle();
    button.dispatch('click'); assert.equal(e.writes.length, 2);
    release(); await e.settle();
});

await check('denied and unavailable clipboard show a safe manual link without false success', async () => {
    for (const unavailable of [false, true]) {
        const e = environment();
        if (unavailable) delete e.navigator.clipboard;
        else e.clipboard(() => Promise.reject(new Error('NotAllowedError')));
        const { button, status, fallback } = e.mount('389229444'); button.dispatch('click'); await e.settle();
        assert.equal(button.classList.contains('x-posed-user-id-copy--success'), false);
        assert.doesNotMatch(status.textContent, /Profile link copied/);
        assert.match(status.textContent, /manually/); assert.equal(fallback.hidden, false);
        assert.equal(fallback.href, 'https://x.com/i/user/389229444');
        assert.equal(fallback.target, '_blank'); assert.match(fallback.rel, /noopener/);
        assert.equal(button.hasAttribute('aria-busy'), false);
    }
});

await check('retry after clipboard denial succeeds and hides the manual fallback', async () => {
    const e = environment(); e.clipboard(() => Promise.reject(new Error('Denied')));
    const { button, fallback } = e.mount(); button.dispatch('click'); await e.settle();
    assert.equal(fallback.hidden, false);
    e.clipboard(() => Promise.resolve()); button.dispatch('click'); await e.settle();
    assert.equal(fallback.hidden, true); assert.equal(button.dataset.xTooltipHeading, 'Profile link copied');
    assert.equal(button.hasAttribute('title'), false);
});

await check('late clipboard success or failure cannot change a replacement card', async () => {
    for (const failure of [false, true]) {
        const e = environment(); let finish;
        e.clipboard(() => new Promise((resolve, reject) => { finish = failure ? reject : resolve; }));
        const old = e.mount('123'); old.button.dispatch('click'); old.control.remove();
        const replacement = e.mount('456'); const original = replacement.control.textContent;
        finish(failure ? new Error('Denied') : undefined); await e.settle();
        assert.equal(replacement.control.textContent, original);
        assert.equal(replacement.status.textContent, ''); assert.equal(replacement.fallback.hidden, true);
        assert.equal(e.timers.size, 0, 'Disconnected success must not schedule feedback reset');
    }
});

await check('same-ID metadata enrichment keeps focused button, feedback and event listeners', async () => {
    const e = environment(); const current = e.mount('123'); current.button.focus();
    current.button.dispatch('click'); await e.settle();
    const next = e.api.createUserIdValue('123');
    assert.equal(e.api.patchCardNode(current.control, next), current.control);
    assert.equal(current.control.querySelector('.x-posed-user-id-copy'), current.button);
    assert.equal(e.document.activeElement, current.button);
    assert.equal(current.status.textContent, 'Profile link copied');
    current.button.dispatch('click'); await e.settle();
    assert.deepEqual(e.writes, ['https://x.com/i/user/123', 'https://x.com/i/user/123']);
});

await check('changed-ID enrichment replaces closures and copies only the new ID', async () => {
    const e = environment(); let finish;
    e.clipboard(() => new Promise(resolve => { finish = resolve; }));
    const old = e.mount('123'); old.button.dispatch('click');
    e.api.patchCardNode(old.control, e.api.createUserIdValue('18446744073709551615'));
    const button = old.control.querySelector('.x-posed-user-id-copy');
    assert.notEqual(button, old.button); assert.equal(old.button.isConnected, false);
    assert.equal(old.control.dataset.xUserId, '18446744073709551615');
    finish(); await e.settle(); assert.equal(button.dataset.xTooltipHeading, 'Copy profile link');
    e.clipboard(() => Promise.resolve()); button.dispatch('click'); await e.settle();
    assert.deepEqual(e.writes, ['https://x.com/i/user/123', 'https://x.com/i/user/18446744073709551615']);
    assert.equal(button.dataset.xTooltipHeading, 'Profile link copied');
});

await check('metadata header patches preserve the icon-only Always Show action, accessibility, listener, pending state and focus', () => {
    const e = environment();
    const createHeader = name => {
        const header = e.document.createElement('div'); header.className = 'x-posed-card-header';
        const title = e.document.createElement('div'); title.className = 'x-posed-title';
        const nameLine = e.document.createElement('div'); nameLine.className = 'x-posed-name-line';
        const label = e.document.createElement('span'); label.className = 'x-posed-name'; label.textContent = name;
        nameLine.append(label);
        const handleLine = e.document.createElement('div'); handleLine.className = 'x-posed-handle-line';
        const handle = e.document.createElement('span'); handle.className = 'x-posed-handle'; handle.textContent = '@demo_account';
        const exception = e.document.createElement('div'); exception.className = 'x-posed-allowlist-control';
        handleLine.append(handle); title.append(nameLine, handleLine);
        const actions = e.document.createElement('div'); actions.className = 'x-posed-header-actions';
        const close = e.document.createElement('button'); close.className = 'x-posed-card-close';
        actions.append(exception, close); header.append(title, actions);
        return { header, exception, actions, close };
    };
    const current = createHeader('Initial name');
    e.document.body.append(current.header);
    const button = e.document.createElement('button'); button.className = 'x-posed-allowlist-button';
    const status = e.document.createElement('div'); const renderer = new e.api.ExportControl();
    const state = { button, status, handle: 'demo_account', allowed: false, pending: true, error: '', message: '' };
    renderer._renderAllowlist(state);
    assert.equal(button.textContent, '', 'The compact action has no visible caption'); assert.equal(button.querySelectorAll('svg').length, 1);
    assert.match(button.getAttribute('aria-label'), /Always show @demo_account/);
    assert.match(button.dataset.xTooltipDescription, /Keeps @demo_account visible/); assert.equal(button.title, '');
    let activations = 0; button.addEventListener('click', () => { activations++; });
    current.exception.dataset.currentState = 'saving'; current.exception.append(button); button.focus();
    const next = createHeader('Enriched name');
    e.api.patchCardNode(current.header, next.header);
    assert.equal(current.header.querySelector('.x-posed-name').textContent, 'Enriched name');
    assert.equal(current.header.querySelector('.x-posed-allowlist-control'), current.exception);
    assert.equal(current.header.querySelector('.x-posed-allowlist-button'), button);
    assert.equal(current.header.querySelector('.x-posed-header-actions'), current.actions);
    assert.equal(current.header.querySelector('.x-posed-card-close'), current.close);
    assert.equal(current.actions.childNodes[0], current.exception); assert.equal(current.actions.childNodes[1], current.close);
    assert.equal(current.header.querySelector('.x-posed-handle-line').contains(current.exception), false);
    assert.equal(button.isConnected, true); assert.equal(e.document.activeElement, button);
    assert.equal(button.getAttribute('aria-busy'), 'true'); assert.equal(button.getAttribute('aria-disabled'), 'true');
    assert.equal(current.exception.dataset.currentState, 'saving');
    state.allowed = true; state.pending = false; renderer._renderAllowlist(state);
    assert.equal(button.getAttribute('aria-pressed'), 'true'); assert.equal(button.getAttribute('aria-disabled'), 'false');
    assert.equal(button.textContent, ''); assert.match(button.dataset.xTooltipDescription, /Removes the exception for @demo_account/);
    assert.equal(e.document.activeElement, button); button.dispatch('click'); assert.equal(activations, 1);
});

await check('avatar metadata patches preserve the same loaded image, listeners and failure state without restarting its source', () => {
    const e = environment();
    const url = 'https://pbs.twimg.com/profile_images/123/demo_normal.jpg';
    const picture = (desired, shape = 'circle') => {
        const image = e.document.createElement('img'); image.className = 'x-posed-card-avatar';
        image.dataset.xAvatarUrl = desired; image.dataset.shape = shape;
        return image;
    };
    const current = picture(url); current.setAttribute('src', url); current.hidden = true;
    let failures = 0; current.addEventListener('error', () => { failures++; }); e.document.body.append(current);
    const candidate = picture(url, 'square');
    assert.equal(candidate.getAttribute('src'), null, 'Detached candidates have no implicit image request');
    assert.equal(e.api.patchCardNode(current, candidate), current);
    assert.equal(current.getAttribute('src'), url); assert.equal(current.dataset.shape, 'square');
    assert.equal(current.hidden, true, 'Enrichment must not revive a failed image of the same URL');
    current.dispatch('error'); assert.equal(failures, 1, 'The original image event handlers survive');
    const nextUrl = 'https://pbs.twimg.com/profile_images/456/new_normal.png';
    const next = picture(nextUrl); let freshFailures = 0;
    next.addEventListener('error', () => { freshFailures++; });
    assert.equal(e.api.patchCardNode(current, next), next);
    assert.equal(current.isConnected, false); assert.equal(next.isConnected, true); assert.equal(next.hidden, false);
    assert.equal(next.getAttribute('src'), null, 'Only the live render step may activate a changed image');
    next.dispatch('error'); assert.equal(freshFailures, 1);
});

await check('parent header reconciliation keeps its cursor valid when replacing an avatar URL', () => {
    const e = environment();
    const header = (url, label) => {
        const element = e.document.createElement('div'); element.className = 'x-posed-card-header';
        const avatar = e.document.createElement('img'); avatar.className = 'x-posed-card-avatar';
        avatar.dataset.xAvatarUrl = url; avatar.dataset.shape = 'circle';
        const title = e.document.createElement('div'); title.className = 'x-posed-title';
        const name = e.document.createElement('span'); name.className = 'x-posed-name'; name.textContent = label;
        title.append(name);
        const actions = e.document.createElement('div'); actions.className = 'x-posed-header-actions';
        const exception = e.document.createElement('div'); exception.className = 'x-posed-allowlist-control';
        const close = e.document.createElement('button'); close.className = 'x-posed-card-close';
        actions.append(exception, close); element.append(avatar, title, actions);
        return { element, avatar, title, name, exception, close, actions };
    };
    const old = header('https://pbs.twimg.com/profile_images/123/old.jpg', 'Initial name');
    const next = header('https://pbs.twimg.com/profile_images/456/new.jpg', 'Enriched name');
    const action = e.document.createElement('button'); action.textContent = 'Always show'; old.exception.append(action);
    e.document.body.append(old.element); action.focus();
    assert.equal(e.api.patchCardNode(old.element, next.element), old.element);
    assert.deepEqual(old.element.childNodes, [next.avatar, old.title, old.actions], 'The replacement stays first, before the existing title and action group');
    assert.deepEqual(old.actions.childNodes, [old.exception, old.close]);
    assert.equal(old.avatar.isConnected, false); assert.equal(next.avatar.isConnected, true);
    assert.equal(old.element.querySelector('.x-posed-name'), old.name); assert.equal(old.name.textContent, 'Enriched name');
    assert.equal(old.element.querySelector('.x-posed-allowlist-control'), old.exception);
    assert.equal(action.isConnected, true); assert.equal(e.document.activeElement, action, 'Unrelated focused actions survive the parent patch');
});

await check('PNG header snapshots omit Always Show and recover full-width rows from grid/display-contents layout', () => {
    const e = environment();
    const card = e.document.createElement('div'); card.className = 'x-posed-hovercard x-posed-hovercard-visible'; e.document.body.append(card);
    const header = e.document.createElement('div'); header.className = 'x-posed-card-header';
    header.style.display = 'grid'; header.style.gridTemplateColumns = '240px 27px'; header.style.rowGap = '4px';
    const title = e.document.createElement('div'); title.className = 'x-posed-title'; title.style.display = 'contents';
    const name = e.document.createElement('span'); name.className = 'x-posed-name'; name.textContent = 'Noah Example';
    const handleLine = e.document.createElement('div'); handleLine.className = 'x-posed-handle-line';
    const handle = e.document.createElement('span'); handle.className = 'x-posed-handle'; handle.textContent = '@demo_account';
    const exception = e.document.createElement('div'); exception.className = 'x-posed-allowlist-control';
    const button = e.document.createElement('button'); button.textContent = 'Always show'; exception.append(button);
    const actions = e.document.createElement('div'); actions.className = 'x-posed-header-actions';
    const close = e.document.createElement('button'); close.className = 'x-posed-card-close'; actions.append(exception, close);
    const status = e.document.createElement('div'); status.className = 'x-posed-allowlist-status'; status.textContent = 'Always showing @demo_account';
    handleLine.append(handle); title.append(name, handleLine); header.append(title, actions); card.append(header, status);
    const { root } = e.api.createSnapshot(card), exportedHeader = root.querySelector('.x-posed-card-header');
    assert.match(root.textContent, /Noah Example@demo_account/);
    assert.doesNotMatch(root.textContent, /Always show|Always showing/);
    assert.equal(root.querySelector('.x-posed-allowlist-control'), null); assert.equal(root.querySelector('.x-posed-allowlist-status'), null);
    assert.equal(root.querySelector('.x-posed-header-actions'), null, 'The entire action group is omitted, including its otherwise empty layout box');
    assert.equal(exportedHeader.style.display, 'block'); assert.equal(exportedHeader.style.gridTemplateColumns, 'none');
    const exportedTitle = root.querySelector('.x-posed-title');
    assert.equal(exportedTitle.style.display, 'flex'); assert.equal(exportedTitle.style.flexDirection, 'column'); assert.equal(exportedTitle.style.width, '100%');
    assert.equal(exportedTitle.style.rowGap, '4px', 'The original header row spacing is retained without action tracks');
    assert.equal(root.querySelector('.x-posed-handle-line').style.gridTemplateColumns, 'minmax(0, 1fr)');
});

await check('PNG snapshots retain a visible avatar beside the title and gracefully reflow after image failure', () => {
    for (const failed of [false, true]) {
        const e = environment(); const card = e.document.createElement('div');
        card.className = 'x-posed-hovercard x-posed-hovercard-visible'; e.document.body.append(card);
        const header = e.document.createElement('div'); header.className = 'x-posed-card-header';
        header.style.display = 'grid'; header.style.gridTemplateColumns = '48px 208px 27px'; header.style.rowGap = '4px';
        const avatar = e.document.createElement('img'); avatar.className = 'x-posed-card-avatar'; avatar.hidden = failed;
        const url = 'https://pbs.twimg.com/profile_images/123/demo_normal.jpg'; avatar.setAttribute('src', url);
        const title = e.document.createElement('div'); title.className = 'x-posed-title'; title.style.display = 'contents';
        const name = e.document.createElement('span'); name.className = 'x-posed-name'; name.textContent = 'Noah Example';
        const handleLine = e.document.createElement('div'); handleLine.className = 'x-posed-handle-line';
        const handle = e.document.createElement('span'); handle.className = 'x-posed-handle'; handle.textContent = '@demo_account';
        Object.assign(handle.style, { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' });
        handleLine.append(handle); title.append(name, handleLine); header.append(avatar, title);
        const actions = e.document.createElement('div'); actions.className = 'x-posed-header-actions';
        const close = e.document.createElement('button'); close.className = 'x-posed-card-close'; actions.append(close); header.append(actions);
        card.append(header, e.api.createUserIdValue('18446744073709551615'));
        const { root, assets } = e.api.createSnapshot(card);
        const copiedHeader = root.querySelector('.x-posed-card-header'), copiedAvatar = root.querySelector('.x-posed-card-avatar');
        assert.match(root.textContent, /Noah Example@demo_account18446744073709551615/);
        assert.equal(root.querySelector('button'), null);
        assert.equal(root.querySelector('.x-posed-header-actions'), null);
        const copiedHandle = root.querySelector('.x-posed-handle');
        assert.equal(copiedHandle.style.whiteSpace, 'normal'); assert.equal(copiedHandle.style.overflow, 'visible');
        assert.equal(copiedHandle.style.textOverflow, 'clip', 'PNG exports retain the complete handle without ellipsis');
        if (failed) {
            assert.equal(copiedAvatar, null); assert.equal(assets.length, 0);
            assert.equal(copiedHeader.style.display, 'block');
            assert.equal(root.querySelector('.x-posed-title').style.width, '100%');
        } else {
            assert.ok(copiedAvatar); assert.equal(assets.length, 1); assert.equal(assets[0].artwork.url, url);
            assert.equal(assets[0].target, copiedAvatar); assert.equal(copiedHeader.style.display, 'flex');
            assert.equal(copiedAvatar.style.width, '48px'); assert.equal(copiedAvatar.style.height, '48px');
            assert.equal(copiedAvatar.style.flex, '0 0 48px');
            assert.equal(root.querySelector('.x-posed-title').style.flex, '1');
            assert.equal(root.querySelector('.x-posed-title').style.width, 'auto');
        }
    }
});

await check('PNG snapshots retain raw ID but omit icons, clipboard feedback and fallback links', async () => {
    for (const failure of [false, true]) {
        const e = environment(); const card = e.document.createElement('div');
        card.className = 'x-posed-hovercard x-posed-hovercard-visible'; e.document.body.append(card);
        const heading = e.document.createElement('div'); heading.textContent = 'Account details'; card.append(heading);
        const current = e.mount('18446744073709551615'); card.append(current.control);
        const footer = e.document.createElement('div'); footer.className = 'x-posed-card-actions';
        const quickGroup = e.document.createElement('div'); quickGroup.className = 'x-posed-quick-controls x-posed-footer-section';
        const groupHeading = e.document.createElement('div'); groupHeading.className = 'x-posed-footer-section-heading'; groupHeading.textContent = 'Highlight';
        quickGroup.append(groupHeading);
        const exportState = new e.api.ExportControl()._createImageState('demo_account', 1);
        footer.append(quickGroup, exportState.element); card.append(footer);
        const tooltip = e.document.createElement('div'); tooltip.className = 'x-posed-card-tooltip';
        tooltip.setAttribute('role', 'tooltip'); tooltip.textContent = 'Explanatory card tooltip: hide Belgium'; card.append(tooltip);
        e.clipboard(() => failure ? Promise.reject(new Error('Denied')) : Promise.resolve());
        current.button.dispatch('click'); await e.settle();
        const { root, assets } = e.api.createSnapshot(card);
        assert.match(root.textContent, /18446744073709551615/);
        assert.doesNotMatch(root.textContent, /Profile link copied|Could not copy|https:\/\/x.com\/i\/user|Explanatory card tooltip|Highlight|\bCard\b/);
        assert.equal(root.querySelector('button'), null);
        assert.equal(root.querySelector('.x-posed-user-id-icon'), null);
        assert.equal(root.querySelector('.x-posed-user-id-fallback'), null);
        assert.equal(root.querySelector('[role="status"]'), null);
        assert.equal(root.querySelector('[role="tooltip"]'), null);
        assert.equal(root.querySelector('.x-posed-footer-section-heading'), null);
        assert.equal(assets.length, 0, 'Copying the ID adds no image/network dependencies');
    }
});

await check('tooltip overflow uses its natural border box, not the protruding decorative pointer', () => {
    let naturalHeight = 80, scale = 1, scrollReads = 0;
    const window = { innerWidth: 390, innerHeight: 600 };
    const style = { maxWidth: 'none', maxHeight: 'none', left: '0px', top: '0px',
        setProperty(name, value) { this[name] = value; } };
    const localSize = (natural, maximum) => maximum === 'none' ? natural : Math.min(natural, parseFloat(maximum));
    const tooltip = {
        style, dataset: {},
        get offsetWidth() { return localSize(240, style.maxWidth); },
        get offsetHeight() { return localSize(naturalHeight, style.maxHeight); },
        get scrollHeight() { scrollReads++; return naturalHeight + 7; },
        getBoundingClientRect() {
            const left = parseFloat(style.left) * scale, top = parseFloat(style.top) * scale;
            const width = this.offsetWidth * scale, height = this.offsetHeight * scale;
            return { left, top, width, height, right: left + width, bottom: top + height };
        }
    };
    const current = { getBoundingClientRect: () => ({ left: 260, width: 40, top: 250, bottom: 286 }) };
    const context = vm.createContext({ current, tooltip, window });
    vm.runInContext(`${tooltipSource.slice(tooltipPosition.start, tooltipPosition.end)}\nglobalThis.reposition = position;`, context);
    context.reposition();
    assert.equal(style.overflowY, 'visible'); assert.equal(tooltip.dataset.scrollable, 'false');
    assert.equal(scrollReads, 0, 'An extra 7px from ::after must not create a false scrollbar');
    naturalHeight = 1200; context.reposition();
    assert.equal(style.overflowY, 'auto'); assert.equal(tooltip.dataset.scrollable, 'true');
    assert.equal(parseFloat(style.maxHeight), 584); assert.equal(tooltip.getBoundingClientRect().height, 584);
    naturalHeight = 80; context.reposition();
    assert.equal(style.overflowY, 'visible'); assert.equal(tooltip.dataset.scrollable, 'false', 'Short content clears a previous tall tooltip\'s scroll state');
    scale = 1.4; window.innerWidth = 320; window.innerHeight = 400;
    for (const height of [700, 50]) {
        naturalHeight = height; context.reposition();
        const bounds = tooltip.getBoundingClientRect();
        assert.equal(style.overflowY, height === 700 ? 'auto' : 'visible');
        assert.ok(bounds.left >= 8 - 0.01 && bounds.right <= 312 + 0.01, 'Scaled tooltip remains horizontally contained');
        assert.ok(bounds.top >= 8 - 0.01 && bounds.bottom <= 392 + 0.01, 'Scaled tooltip remains vertically contained');
        assert.ok(Math.abs(parseFloat(style.maxHeight) * scale - 384) < 0.01, 'Viewport constraints are converted back to local CSS pixels');
    }
    assert.equal(scrollReads, 0);
});

console.log(`Profile-link regression checks passed (${groups} groups).`);
