/**
 * A local, immutable PNG of the account card that is already on screen.
 * No account lookups, uploads, page stylesheets or capture permissions are used.
 */

const HTML_NS = 'http://www.w3.org/1999/xhtml';
const SVG_NS = 'http://www.w3.org/2000/svg';
const SCALE = 2;
const MAX_WIDTH = 768;
const MAX_HEIGHT = 2400;
const MAX_PIXELS = 8000000;
const MAX_NODES = 1200;
const MAX_ASSETS = 160;
const MAX_TEXT = 32768;
const MAX_SERIALIZED_LENGTH = 4 * 1024 * 1024;
const MAX_IMAGE_BYTES = 1024 * 1024;
const MAX_ARTWORK_BYTES = 4 * 1024 * 1024;
const ARTWORK_CONCURRENCY = 4;
const IMAGE_TIMEOUT = 5000;
const ARTWORK_TIMEOUT = 10000;
const RENDER_TIMEOUT = 5000;
const SYSTEM_FONT = '"Segoe UI", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif';
const OMIT = '.x-posed-card-close, .x-posed-card-actions, .x-posed-export-actions, .x-posed-export-status, .x-posed-warning-help, .x-posed-sr-only, [role="tooltip"], button';
const HTML_TAGS = new Set(['div', 'span', 'p', 'time', 'strong', 'em', 'small', 'b', 'i', 'br', 'img', 'a']);
const SVG_TAGS = new Set(['svg', 'g', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse', 'defs', 'linearGradient', 'radialGradient', 'stop', 'clipPath', 'mask']);
const SVG_ATTRIBUTES = new Set(['viewBox', 'width', 'height', 'x', 'y', 'x1', 'x2', 'y1', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'd', 'points', 'fill', 'fill-rule', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-opacity', 'clip-rule', 'clip-path', 'mask', 'transform', 'id', 'offset', 'stop-color', 'stop-opacity', 'gradientUnits', 'gradientTransform', 'spreadMethod']);
const REFLOW_PROPERTIES = new Set(['width', 'height', 'block-size', 'inline-size', 'position', 'inset', 'inset-block', 'inset-inline', 'top', 'right', 'bottom', 'left', 'float', 'clear', 'transform', 'translate', 'rotate', 'scale', 'zoom', 'animation', 'transition']);

function cancelled() {
    return new DOMException('Account card image was cancelled.', 'AbortError');
}

function checkAbort(signal) {
    if (signal?.aborted) throw cancelled();
}

/** Keep local SVG paint references, never network URLs inherited from X CSS. */
function localPaint(value) {
    if (!/url\s*\(/i.test(value)) return value;
    const match = /^url\(["']?(?:[^"')]*#)?([A-Za-z_][\w:.-]*)["']?\)$/.exec(value);
    return match ? `url(#${match[1]})` : null;
}

function copyStyles(source, target) {
    const computed = getComputedStyle(source);
    for (const property of computed) {
        if (property.startsWith('--') || REFLOW_PROPERTIES.has(property) ||
            /^(?:animation|transition|scroll|caret|cursor|pointer-events)/.test(property)) continue;
        const value = localPaint(computed.getPropertyValue(property));
        if (value && !/(?:expression\s*\(|-moz-binding)/i.test(value)) {
            target.style.setProperty(property, value);
        }
    }
    // An SVG image document cannot load X's web fonts. Use the same UI stack
    // everywhere rather than capturing a name with an unavailable custom font.
    target.style.fontFamily = SYSTEM_FONT;
    target.style.position = 'static';
    target.style.transform = 'none';
    target.style.animation = 'none';
    target.style.transition = 'none';
    target.style.textShadow = 'none';
    target.style.outline = 'none';
    target.style.pointerEvents = 'none';
    if (source.localName === 'img' || source.namespaceURI === SVG_NS) {
        // Preserve the icon rail and emoji geometry, but let text containers
        // find their natural size after scroll/footer constraints are removed.
        target.style.width = computed.width;
        target.style.height = computed.height;
    }
}

function trustedArtwork(raw) {
    if (typeof raw !== 'string' || raw.length > 512) return null;
    let url;
    try { url = new URL(raw); } catch { return null; }
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    if (/^abs(?:-\d+)?\.twimg\.com$/i.test(url.hostname) &&
        /^\/emoji\/v\d+\/svg\/[a-f0-9]+(?:-[a-f0-9]+)*\.svg$/i.test(url.pathname)) {
        url.search = '';
        url.hash = '';
        return { url: url.href, svg: true };
    }
    if (url.hostname === 'pbs.twimg.com' &&
        /^\/profile_images\/\d+\/[\w.-]{1,160}\.(?:png|jpe?g|webp|gif)$/i.test(url.pathname)) {
        url.search = '';
        url.hash = '';
        return { url: url.href, svg: false };
    }
    return null;
}

function createSnapshot(card) {
    if (!card?.matches?.('.x-posed-hovercard-visible') || !card.isConnected) {
        throw new Error('Open an account card before copying its image.');
    }
    const bounds = card.getBoundingClientRect();
    if (!Number.isFinite(bounds.width) || bounds.width < 120 || !card.textContent.trim()) {
        throw new Error('This account card is not ready to capture.');
    }
    const assets = [];
    let count = 0;
    let textLength = 0;
    const clone = source => {
        if (++count > MAX_NODES) throw new Error('This account card is too large to capture.');
        if (source.nodeType === Node.TEXT_NODE) {
            textLength += source.textContent.length;
            if (textLength > MAX_TEXT) throw new Error('This account card contains too much text to capture.');
            return document.createTextNode(source.textContent);
        }
        if (source.nodeType !== Node.ELEMENT_NODE || source.matches(OMIT) || source.hidden) return null;
        const svg = source.namespaceURI === SVG_NS;
        if (!(svg ? SVG_TAGS : HTML_TAGS).has(source.localName)) return null;
        if (getComputedStyle(source).display === 'none') return null;
        const target = document.createElementNS(svg ? SVG_NS : HTML_NS, source.localName === 'a' ? 'span' : source.localName);
        if (svg) {
            for (const { name, value } of source.attributes) {
                if (!SVG_ATTRIBUTES.has(name)) continue;
                const safe = localPaint(value);
                if (safe !== null) target.setAttribute(name, safe);
            }
        }
        // Classes are owned by the extension and only used by local reflow below.
        target.setAttribute('class', source.getAttribute('class') || '');
        copyStyles(source, target);
        if (source.localName === 'img') {
            if (assets.length >= MAX_ASSETS) throw new Error('This account card has too much artwork to capture.');
            const alt = source.getAttribute('alt') || '';
            target.setAttribute('alt', alt);
            assets.push({ target, artwork: trustedArtwork(source.getAttribute('src')), alt,
                flag: source.classList.contains('x-flag-emoji') });
        } else {
            for (const child of source.childNodes) {
                const copy = clone(child);
                if (copy) target.appendChild(copy);
            }
        }
        return target;
    };
    const root = clone(card);
    if (!root) throw new Error('This account card is not ready to capture.');
    const width = Math.min(MAX_WIDTH, Math.ceil(bounds.width));
    Object.assign(root.style, {
        width: `${width}px`, minWidth: '0', maxWidth: 'none', height: 'auto',
        minHeight: '0', maxHeight: 'none', position: 'relative', inset: 'auto',
        margin: '0', opacity: '1', visibility: 'visible', overflow: 'hidden',
        boxShadow: 'none', display: 'flex', flexDirection: 'column'
    });
    const body = root.querySelector('.x-posed-card-body');
    if (body) Object.assign(body.style, { height: 'auto', maxHeight: 'none', overflow: 'visible', flex: 'none' });
    const header = root.querySelector('.x-posed-card-header');
    if (header) header.style.flexShrink = '0';
    const name = root.querySelector('.x-posed-name');
    if (name) Object.assign(name.style, { whiteSpace: 'normal', overflow: 'visible', textOverflow: 'clip', overflowWrap: 'anywhere' });
    const warning = root.querySelector('.x-posed-card-warning');
    if (warning) warning.style.whiteSpace = 'normal';
    // Frozen computed CSS can contain old track widths. Retain fractional
    // layouts so long labels and any wrapped display name can reflow safely.
    root.querySelectorAll('.x-posed-signal-value').forEach(value => {
        value.style.gridTemplateColumns = 'minmax(0, 1fr) 18px';
    });
    const stats = root.querySelector('.x-posed-card-stats');
    if (stats?.style.display === 'grid') stats.style.gridTemplateColumns = 'repeat(2, minmax(0, 1fr))';
    return { root, width, assets };
}

/** Reject SVGs with active/foreign content or any external paint dependency. */
function sanitizeSvg(text) {
    if (/<!DOCTYPE|<!ENTITY/i.test(text)) return null;
    const parsed = new DOMParser().parseFromString(text, 'image/svg+xml');
    if (parsed.querySelector('parsererror') || parsed.documentElement.localName !== 'svg') return null;
    const elements = [parsed.documentElement, ...parsed.documentElement.querySelectorAll('*')];
    if (elements.length > 500) return null;
    for (const node of elements) {
        if (node.namespaceURI !== SVG_NS || !SVG_TAGS.has(node.localName)) return null;
        for (const { name, value } of [...node.attributes]) {
            if (name === 'xmlns') continue;
            if (!SVG_ATTRIBUTES.has(name) || localPaint(value) === null || /(?:javascript:|data:)/i.test(value)) return null;
            // Styles may normalize local references to document URLs, but CDN
            // source artwork must already be wholly self-contained.
            if (/url\s*\(/i.test(value) && !/^url\(["']?#[A-Za-z_][\w:.-]*["']?\)$/.test(value)) return null;
        }
    }
    return new XMLSerializer().serializeToString(parsed.documentElement);
}

async function boundedResponse(response, budget) {
    if (!response.body?.getReader) {
        const buffer = await response.arrayBuffer();
        if (buffer.byteLength > budget.remaining) { budget.remaining = 0; return null; }
        budget.remaining -= buffer.byteLength;
        return buffer.byteLength <= MAX_IMAGE_BYTES ? buffer : null;
    }
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    try {
        while (size <= MAX_IMAGE_BYTES) {
            const { value, done } = await reader.read();
            if (done) break;
            if (value.byteLength > budget.remaining) {
                budget.remaining = 0;
                await reader.cancel();
                return null;
            }
            budget.remaining -= value.byteLength;
            size += value.byteLength;
            if (size > MAX_IMAGE_BYTES) {
                await reader.cancel();
                return null;
            }
            chunks.push(value);
        }
        const buffer = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; }
        return buffer;
    } finally { reader.releaseLock(); }
}

function dataUri(blob, signal) {
    return new Promise((resolve, reject) => {
        checkAbort(signal);
        const reader = new FileReader();
        let settled = false;
        const finish = error => {
            if (settled) return;
            settled = true;
            signal?.removeEventListener('abort', abort);
            reader.onload = null;
            reader.onerror = null;
            if (error) {
                if (reader.readyState === FileReader.LOADING) reader.abort();
                reject(error);
            } else resolve(reader.result);
        };
        const abort = () => finish(cancelled());
        signal?.addEventListener('abort', abort, { once: true });
        reader.onload = () => finish();
        reader.onerror = () => finish(new Error('Could not prepare account card artwork.'));
        try { reader.readAsDataURL(blob); }
        catch { finish(new Error('Could not prepare account card artwork.')); }
    });
}

async function fetchArtwork(artwork, signal, budget) {
    checkAbort(signal);
    if (budget.remaining <= 0 || Date.now() >= budget.deadline) return null;
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, Math.min(IMAGE_TIMEOUT, Math.max(1, budget.deadline - Date.now())));
    try {
        const response = await fetch(artwork.url, {
            mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer',
            redirect: 'error', cache: 'force-cache', signal: controller.signal
        });
        if (!response.ok || Number(response.headers.get('content-length')) > MAX_IMAGE_BYTES) return null;
        const type = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
        if (artwork.svg ? type !== 'image/svg+xml' : !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(type)) return null;
        const buffer = await boundedResponse(response, budget);
        if (!buffer) return null;
        const svg = artwork.svg ? sanitizeSvg(new TextDecoder().decode(buffer)) : null;
        if (artwork.svg && !svg) return null;
        return await dataUri(new Blob([artwork.svg ? svg : buffer], { type }), controller.signal);
    } catch {
        checkAbort(signal);
        return null;
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        // Cancel any body we rejected from its headers instead of allowing an
        // unused oversized/invalid artwork response to keep downloading.
        controller.abort();
    }
}

function replaceMissingArtwork(asset) {
    if (asset.alt) {
        const text = document.createElementNS(HTML_NS, 'span');
        text.style.cssText = asset.target.style.cssText;
        text.style.width = 'auto';
        text.textContent = asset.alt;
        asset.target.replaceWith(text);
    } else if (asset.flag) {
        // A monochrome globe is a readable fallback, never a broken image.
        const icon = document.createElementNS(SVG_NS, 'svg');
        icon.setAttribute('viewBox', '0 0 24 24');
        icon.style.cssText = asset.target.style.cssText;
        icon.style.fill = 'none';
        icon.style.stroke = 'currentColor';
        icon.style.strokeWidth = '1.8px';
        icon.setAttribute('fill', 'none');
        icon.setAttribute('stroke', 'currentColor');
        icon.setAttribute('stroke-width', '1.8');
        const circle = document.createElementNS(SVG_NS, 'circle');
        circle.setAttribute('cx', '12'); circle.setAttribute('cy', '12'); circle.setAttribute('r', '8.2');
        const path = document.createElementNS(SVG_NS, 'path');
        path.setAttribute('d', 'M3.8 12h16.4M12 3.8c2.4 2.2 3.7 5.1 3.7 8.2s-1.3 6-3.7 8.2c-2.4-2.2-3.7-5.1-3.7-8.2S9.6 6 12 3.8z');
        icon.append(circle, path);
        asset.target.replaceWith(icon);
    } else asset.target.remove();
}

async function inlineArtwork(assets, signal) {
    const byUrl = new Map();
    for (const asset of assets) {
        if (asset.artwork) {
            if (!byUrl.has(asset.artwork.url)) byUrl.set(asset.artwork.url, { artwork: asset.artwork, uri: null });
        }
    }
    const queue = [...byUrl.values()];
    const budget = { remaining: MAX_ARTWORK_BYTES, deadline: Date.now() + ARTWORK_TIMEOUT };
    let next = 0;
    const worker = async () => {
        while (next < queue.length) {
            checkAbort(signal);
            const entry = queue[next++];
            entry.uri = await fetchArtwork(entry.artwork, signal, budget);
        }
    };
    await Promise.all(Array.from({ length: Math.min(ARTWORK_CONCURRENCY, queue.length) }, worker));
    for (const asset of assets) {
        checkAbort(signal);
        const uri = asset.artwork ? byUrl.get(asset.artwork.url).uri : null;
        if (uri) asset.target.setAttribute('src', uri);
        else replaceMissingArtwork(asset);
    }
}

function decodeImage(url, signal) {
    return new Promise((resolve, reject) => {
        checkAbort(signal);
        const image = new Image();
        let settled = false;
        const finish = error => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            signal?.removeEventListener('abort', abort);
            image.onload = null;
            image.onerror = null;
            if (error) { image.removeAttribute('src'); reject(error); }
            else resolve(image);
        };
        const abort = () => finish(cancelled());
        const timer = setTimeout(() => finish(new Error('Account card image rendering timed out.')), RENDER_TIMEOUT);
        signal?.addEventListener('abort', abort, { once: true });
        image.onload = () => finish();
        image.onerror = () => finish(new Error('This browser could not render the account card image.'));
        image.src = url;
    });
}

function canvasBlob(canvas, signal) {
    return new Promise((resolve, reject) => {
        checkAbort(signal);
        let settled = false;
        const finish = (blob, error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            signal?.removeEventListener('abort', abort);
            if (error) reject(error);
            else resolve(blob);
        };
        const abort = () => finish(null, cancelled());
        const timer = setTimeout(() => finish(null, new Error('Account card PNG encoding timed out.')), RENDER_TIMEOUT);
        signal?.addEventListener('abort', abort, { once: true });
        try {
            canvas.toBlob(blob => {
                if (signal?.aborted) finish(null, cancelled());
                else if (blob?.size && blob.type === 'image/png') finish(blob);
                else finish(null, new Error('This browser could not create a PNG of the account card.'));
            }, 'image/png');
        } catch {
            finish(null, new Error('This browser could not encode the account card PNG.'));
        }
    });
}

async function renderSnapshot(snapshot, signal) {
    checkAbort(signal);
    await inlineArtwork(snapshot.assets, signal);
    checkAbort(signal);
    const host = document.createElement('div');
    host.style.cssText = 'all:initial!important;position:fixed!important;left:-100000px!important;top:0!important;visibility:hidden!important;pointer-events:none!important;contain:layout style!important;';
    const shadow = host.attachShadow({ mode: 'closed' });
    shadow.appendChild(snapshot.root);
    document.documentElement.appendChild(host);
    try {
        const height = Math.ceil(snapshot.root.getBoundingClientRect().height);
        if (height < 40 || height > MAX_HEIGHT || snapshot.width * height * SCALE * SCALE > MAX_PIXELS) {
            throw new Error('This account card is too tall to save as one image.');
        }
        // A self-contained image document: only styled native nodes and
        // sanitized, embedded artwork survive the serialization boundary.
        const svg = document.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('width', String(snapshot.width));
        svg.setAttribute('height', String(height));
        const foreign = document.createElementNS(SVG_NS, 'foreignObject');
        foreign.setAttribute('width', '100%');
        foreign.setAttribute('height', '100%');
        foreign.appendChild(snapshot.root);
        svg.appendChild(foreign);
        const markup = new XMLSerializer().serializeToString(svg);
        if (markup.length > MAX_SERIALIZED_LENGTH) throw new Error('This account card image is too large to render.');
        // Chromium treats foreignObject inside a Blob-backed SVG as tainted
        // even when every image is embedded. A self-contained data document
        // remains origin-clean and can safely be encoded into a PNG.
        const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
        const image = await decodeImage(url, signal);
        checkAbort(signal);
        const canvas = document.createElement('canvas');
        canvas.width = snapshot.width * SCALE;
        canvas.height = height * SCALE;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('This browser cannot create an account card image.');
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        try {
            // Drawing can succeed yet yield an empty foreignObject on an
            // unsupported engine. Never claim a blank image was copied.
            const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
            let opaque = 0;
            let variation = false;
            const first = [pixels[0], pixels[1], pixels[2]];
            for (let i = 0; i < pixels.length; i += 40) {
                if (pixels[i + 3] > 0) opaque++;
                if (pixels[i] !== first[0] || pixels[i + 1] !== first[1] || pixels[i + 2] !== first[2]) variation = true;
            }
            if (!opaque || !variation) throw new Error('The browser rendered an empty account card image.');
        } catch (error) {
            if (error.name === 'SecurityError') throw new Error('This browser blocked local account card image capture.');
            throw error;
        }
        return await canvasBlob(canvas, signal);
    } finally {
        host.remove();
    }
}

/**
 * Snapshot synchronously, before image work can race with another hovercard.
 * The returned promise can be passed straight to a PNG ClipboardItem in the
 * initiating click handler so clipboard user activation is not lost.
 * @param {HTMLElement} card The visible, extension-owned account card.
 * @param {{signal?: AbortSignal}} options
 * @returns {Promise<Blob>} image/png at 2× the card's CSS resolution.
 */
export function createHovercardPng(card, { signal } = {}) {
    try {
        checkAbort(signal);
        const snapshot = createSnapshot(card);
        return renderSnapshot(snapshot, signal);
    } catch (error) {
        return Promise.reject(error);
    }
}
