/**
 * Device, flag and compact badge/Share artwork retained by the Graphite UI.
 * Built via createElementNS (never innerHTML) so it is XSS-safe and inherits
 * the surrounding text/accent color. Distinct device icons (Apple / Android /
 * Web / Unknown). General interface icons live in dialog-icons.js.
 */

import { COUNTRY_FLAGS, canonicalCountry } from '../shared/constants.js';
import { classifyDevice } from '../shared/utils.js';

const NS = 'http://www.w3.org/2000/svg';

function el(tag, attrs) {
    const node = document.createElementNS(NS, tag);
    for (const key in attrs) {
        node.setAttribute(key, attrs[key]);
    }
    return node;
}

function base(size, stroke) {
    const svg = el('svg', { viewBox: '0 0 24 24', width: String(size), height: String(size), 'aria-hidden': 'true' });
    if (stroke) {
        svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', 'currentColor');
        svg.setAttribute('stroke-width', '1.8');
        svg.setAttribute('stroke-linecap', 'round');
        svg.setAttribute('stroke-linejoin', 'round');
    } else {
        svg.setAttribute('fill', 'currentColor');
    }
    return svg;
}

// ---- device icons ----
function apple(size) {
    const s = base(size, false);
    s.appendChild(el('path', { d: 'M17.05 12.5c-.03-2.5 2.04-3.7 2.13-3.76-1.16-1.7-2.97-1.93-3.61-1.96-1.54-.16-3 .9-3.78.9-.78 0-1.98-.88-3.25-.86-1.67.03-3.21.97-4.07 2.46-1.74 3.02-.45 7.49 1.25 9.94.83 1.2 1.82 2.55 3.12 2.5 1.25-.05 1.72-.81 3.23-.81 1.51 0 1.94.81 3.26.78 1.35-.02 2.2-1.22 3.02-2.43.95-1.39 1.34-2.74 1.36-2.81-.03-.01-2.61-1-2.64-3.99zM14.6 5.1c.69-.83 1.15-1.99 1.02-3.14-.99.04-2.19.66-2.9 1.49-.64.73-1.2 1.91-1.05 3.03 1.1.09 2.24-.56 2.93-1.38z' }));
    return s;
}
function android(size) {
    const s = base(size, false);
    s.appendChild(el('path', { fill: 'none', stroke: 'currentColor', 'stroke-width': '1.2', 'stroke-linecap': 'round', d: 'M8.8 5.3 7.6 3.6M15.2 5.3l1.2-1.7' }));
    s.appendChild(el('path', { 'fill-rule': 'evenodd', d: 'M12 5C8.9 5 6.4 7.3 6.2 10.2h11.6C17.6 7.3 15.1 5 12 5zm-2.3 3.1a.78.78 0 1 1 0-1.56.78.78 0 0 1 0 1.56zm4.6 0a.78.78 0 1 1 0-1.56.78.78 0 0 1 0 1.56z' }));
    s.appendChild(el('rect', { x: '6.4', y: '11', width: '11.2', height: '7.3', rx: '1.2' }));
    s.appendChild(el('rect', { x: '8.7', y: '17.8', width: '2', height: '3.4', rx: '1' }));
    s.appendChild(el('rect', { x: '13.3', y: '17.8', width: '2', height: '3.4', rx: '1' }));
    s.appendChild(el('rect', { x: '3.7', y: '11.5', width: '2', height: '5.2', rx: '1' }));
    s.appendChild(el('rect', { x: '18.3', y: '11.5', width: '2', height: '5.2', rx: '1' }));
    return s;
}
function web(size) {
    const s = base(size, true);
    s.appendChild(el('circle', { cx: '12', cy: '12', r: '8.2' }));
    s.appendChild(el('path', { d: 'M3.8 12h16.4M12 3.8c2.4 2.2 3.7 5.1 3.7 8.2s-1.3 6-3.7 8.2c-2.4-2.2-3.7-5.1-3.7-8.2S9.6 6 12 3.8z' }));
    return s;
}
function unknownDevice(size) {
    const s = base(size, true);
    s.appendChild(el('circle', { cx: '12', cy: '12', r: '8.2' }));
    s.appendChild(el('path', { d: 'M9.7 9.4a2.3 2.3 0 0 1 4.5.6c0 1.5-2.2 1.9-2.2 3.3M12 16.4h.01' }));
    return s;
}

// ---- live badge / Share glyphs ----
const GLYPHS = {
    info(size) {
        const s = base(size, true);
        s.appendChild(el('circle', { cx: '12', cy: '12', r: '8.5' }));
        s.appendChild(el('path', { d: 'M12 11v5M12 7.7h.01' }));
        return s;
    },
    vpn(size) {
        const s = base(size, true);
        s.appendChild(el('path', { d: 'M12 3l7 3v5c0 4.4-3 8-7 10-4-2-7-5.6-7-10V6z' }));
        s.appendChild(el('path', { d: 'M9.5 12l1.8 1.8L15 9.8' }));
        return s;
    },
    shield(size) {
        const s = base(size, true);
        s.appendChild(el('path', { d: 'M12 2L4 5v6.09c0 5.05 3.41 9.76 8 10.91 4.59-1.15 8-5.86 8-10.91V5l-8-3z' }));
        return s;
    },
    save(size) {
        const s = base(size, true);
        s.appendChild(el('path', { d: 'M5.5 3.5h11L20.5 7.5v12a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1z' }));
        s.appendChild(el('path', { d: 'M7.5 3.5v5h7v-5M7.5 20.5v-6h9v6' }));
        return s;
    },
    copy(size) {
        const s = base(size, true);
        s.appendChild(el('rect', { x: '9', y: '9', width: '11', height: '11', rx: '2' }));
        s.appendChild(el('path', { d: 'M5 15V5a2 2 0 0 1 2-2h10' }));
        return s;
    },
    share(size) {
        const s = base(size, true);
        s.appendChild(el('path', { d: 'M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7' }));
        s.appendChild(el('path', { d: 'M16 6l-4-4-4 4M12 2v13' }));
        return s;
    },
    xLogo(size) {
        const s = base(size, false);
        s.appendChild(el('path', { d: 'M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z' }));
        return s;
    },
    zoom(size) {
        const s = base(size, true);
        s.appendChild(el('circle', { cx: '11', cy: '11', r: '7' }));
        s.appendChild(el('path', { d: 'M20.5 20.5 16 16M11 8.2v5.6M8.2 11h5.6' }));
        return s;
    }
};

/**
 * Return an SVG element for a device/source string.
 * @param {string|null|undefined} deviceString
 * @param {number} size
 * @returns {SVGElement}
 */
// Cache built icon templates and return clones — cloneNode is cheaper than re-running
// the createElementNS/setAttribute chains for the identical icon on every badge.
const _deviceIconCache = new Map();

export function deviceIcon(deviceString, size = 15) {
    const category = classifyDevice(deviceString);
    const key = `${category}@${size}`;
    let tpl = _deviceIconCache.get(key);
    if (!tpl) {
        switch (category) {
            case 'ios': tpl = apple(size); break;
            case 'android': tpl = android(size); break;
            case 'web': tpl = web(size); break;
            default: tpl = unknownDevice(size);
        }
        _deviceIconCache.set(key, tpl);
    }
    return tpl.cloneNode(true);
}

/**
 * Return an SVG element for a badge or Share glyph (info, vpn, shield, save,
 * copy, share, xLogo, zoom). Falls back to the info glyph.
 * @param {string} name
 * @param {number} size
 * @returns {SVGElement}
 */
const _glyphCache = new Map();

export function glyph(name, size = 16) {
    const key = `${name}@${size}`;
    let tpl = _glyphCache.get(key);
    if (!tpl) {
        tpl = (GLYPHS[name] || GLYPHS.info)(size);
        _glyphCache.set(key, tpl);
    }
    return tpl.cloneNode(true);
}

/**
 * Build a flag <img> element (Twemoji SVG) for a country name, or null when the
 * country is unknown (callers fall back to the location text alone). Renders on
 * every OS, unlike regional-indicator emoji which fail on Windows.
 * @param {string|null|undefined} countryName
 * @returns {HTMLImageElement|null}
 */
export function flagImage(countryName) {
    if (!countryName) return null;
    const emoji = COUNTRY_FLAGS[canonicalCountry(countryName)];
    if (!emoji || emoji === '🌍') return null;
    const cp = Array.from(emoji).map(c => c.codePointAt(0).toString(16)).join('-');
    const img = document.createElement('img');
    img.className = 'x-flag-emoji';
    img.src = `https://abs-0.twimg.com/emoji/v2/svg/${cp}.svg`;
    img.alt = '';
    img.loading = 'lazy';
    img.referrerPolicy = 'no-referrer';
    return img;
}
