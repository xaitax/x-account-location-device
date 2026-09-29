/** Safe, local presentation of the display name already visible on X. */

const MAX_NAME_LENGTH = 4096;
const MAX_NAME_TOKENS = 128;
let nameSegmenter;

function cleanName(value) {
    if (typeof value !== 'string' || value.length > MAX_NAME_LENGTH) return '';
    // eslint-disable-next-line no-control-regex
    return value.replace(/[\u0000-\u001F\u007F]/g, '');
}

function emojiAsset(value) {
    if (typeof value !== 'string' || value.length > 512) return null;
    const match = /^(https:\/\/abs(?:-\d+)?\.twimg\.com\/emoji\/v\d+\/svg\/([a-f0-9]+(?:-[a-f0-9]+)*)\.svg)(?:[?#].*)?$/i.exec(value);
    if (!match) return null;
    const points = match[2].split('-').map(point => parseInt(point, 16));
    if (points.length > 32 || points.some(point => point < 0x20 || point > 0x10ffff ||
        (point >= 0xd800 && point <= 0xdfff))) return null;
    return { src: match[1], text: String.fromCodePoint(...points) };
}

/** Keep the existing plain-text extraction, including X images with an empty alt. */
export function emojiImageText(image) {
    if (image.alt) return image.alt;
    return emojiAsset(image.getAttribute('src'))?.text || '';
}

/** Never split an emoji sequence, combining mark, surrogate pair or flag. */
export function truncateDisplayName(value, limit = 60) {
    const text = cleanName(value);
    if (!text || !Number.isInteger(limit) || limit < 1) return '';
    if (typeof Intl.Segmenter !== 'function') return text;
    nameSegmenter ||= new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    let result = '';
    let count = 0;
    for (const { segment } of nameSegmenter.segment(text)) {
        if (count++ === limit) break;
        result += segment;
    }
    return result;
}

/**
 * Capture only text and validated emoji artwork, never X's markup or handlers.
 * The source reference is local to the badge and only used for a lazy font read.
 */
export function captureDisplayName(element, text) {
    if (!element || !cleanName(text)) return null;
    const tokens = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    let length = 0;
    let node;
    while ((node = walker.nextNode())) {
        let token;
        if (node.nodeType === Node.TEXT_NODE) token = { text: cleanName(node.textContent) };
        else if (node.nodeName === 'IMG') {
            const asset = emojiAsset(node.getAttribute('src'));
            token = { text: cleanName(emojiImageText(node)) };
            if (asset) token.src = asset.src;
        }
        if (!token?.text) continue;
        length += token.text.length;
        if (length > MAX_NAME_LENGTH || tokens.length >= MAX_NAME_TOKENS) return null;
        tokens.push(token);
    }
    // Trim only the outer whitespace, retaining the source's internal spacing.
    while (tokens.length) {
        tokens[0].text = tokens[0].text.trimStart();
        if (tokens[0].text) break;
        tokens.shift();
    }
    while (tokens.length) {
        tokens[tokens.length - 1].text = tokens[tokens.length - 1].text.trimEnd();
        if (tokens[tokens.length - 1].text) break;
        tokens.pop();
    }
    if (tokens.map(token => token.text).join('') !== cleanName(text)) return null;
    return { text, tokens, sourceElement: element };
}

/** Read X's font once on opening, not for every author scrolling past. */
export function resolveDisplayNamePresentation(presentation) {
    if (!presentation) return null;
    let fontFamily = '';
    if (presentation.sourceElement?.isConnected) {
        fontFamily = getComputedStyle(presentation.sourceElement).fontFamily;
    }
    return {
        text: presentation.text,
        tokens: presentation.tokens,
        fontFamily: typeof fontFamily === 'string' && fontFamily.length <= 512 ? fontFamily : ''
    };
}

/** Rebuild a name with safe DOM nodes, with text fallback if an emoji fails. */
export function renderDisplayName(target, value, presentation = null) {
    const text = truncateDisplayName(value);
    target.replaceChildren();
    target.style.removeProperty('font-family');
    if (!presentation || cleanName(presentation.text) !== cleanName(value) ||
        !Array.isArray(presentation.tokens) || presentation.tokens.length > MAX_NAME_TOKENS ||
        presentation.tokens.map(token => cleanName(token?.text)).join('') !== cleanName(value)) {
        target.textContent = text;
        return;
    }
    if (typeof presentation.fontFamily === 'string' && presentation.fontFamily.length <= 512) {
        target.style.fontFamily = presentation.fontFamily;
    }
    let remaining = text.length;
    for (const token of presentation.tokens) {
        if (!remaining) break;
        const copy = cleanName(token.text).slice(0, remaining);
        remaining -= copy.length;
        const asset = emojiAsset(token.src);
        if (asset && copy === token.text) {
            const image = document.createElement('img');
            image.className = 'x-posed-name-emoji';
            image.alt = copy;
            image.draggable = false;
            image.referrerPolicy = 'no-referrer';
            image.addEventListener('error', () => image.replaceWith(document.createTextNode(copy)), { once: true });
            image.src = asset.src;
            target.appendChild(image);
        } else target.appendChild(document.createTextNode(copy));
    }
}
