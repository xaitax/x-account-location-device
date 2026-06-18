/**
 * Icon set (monochrome SVG, currentColor) for the glass UI system.
 * Built via createElementNS (never innerHTML) so it is XSS-safe and inherits
 * the surrounding text/accent color. Distinct device icons (Apple / Android /
 * Web / Unknown) plus the hovercard glyphs.
 */

import { COUNTRY_FLAGS } from '../shared/constants.js';
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

// ---- hovercard / badge glyphs ----
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
    location(size) {
        const s = base(size, true);
        s.appendChild(el('path', { d: 'M12 21s-6-5.3-6-10a6 6 0 1 1 12 0c0 4.7-6 10-6 10z' }));
        s.appendChild(el('circle', { cx: '12', cy: '11', r: '2.2' }));
        return s;
    },
    verified(size) {
        const s = base(size, true);
        s.appendChild(el('path', { d: 'M12 3l2.2 1.6 2.7-.2 1 2.5 2.3 1.4-.6 2.6.6 2.6-2.3 1.4-1 2.5-2.7-.2L12 21l-2.2-1.6-2.7.2-1-2.5L3.8 15.7l.6-2.6-.6-2.6 2.3-1.4 1-2.5 2.7.2z' }));
        s.appendChild(el('path', { d: 'M9.6 12l1.7 1.7 3.3-3.4' }));
        return s;
    },
    created(size) {
        const s = base(size, true);
        s.appendChild(el('rect', { x: '4', y: '5', width: '16', height: '16', rx: '2.5' }));
        s.appendChild(el('path', { d: 'M4 9h16M8 3v4M16 3v4' }));
        return s;
    },
    id(size) {
        // hashtag — reads instantly as a numeric identifier
        const s = base(size, true);
        s.appendChild(el('path', { d: 'M9.5 4 7.5 20M16.5 4l-2 16M5 9.5h14.5M4.5 14.5H19' }));
        return s;
    },
    affiliation(size) {
        const s = base(size, true);
        s.appendChild(el('path', { d: 'M4 21V5l8-2 8 2v16' }));
        s.appendChild(el('path', { d: 'M9 9h.01M9 13h.01M15 9h.01M15 13h.01M10 21v-4h4v4' }));
        return s;
    },
    clock(size) {
        const s = base(size, true);
        s.appendChild(el('circle', { cx: '12', cy: '12', r: '8.5' }));
        s.appendChild(el('path', { d: 'M12 7.5V12l3 1.8' }));
        return s;
    },
    swap(size) {
        const s = base(size, true);
        s.appendChild(el('path', { d: 'M7 7h11l-3-3M17 17H6l3 3' }));
        return s;
    },
    camera(size) {
        const s = base(size, false);
        s.appendChild(el('path', { d: 'M12 9a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm0 6a2 2 0 1 1 0-4 2 2 0 0 1 0 4z' }));
        s.appendChild(el('path', { d: 'M20 4h-3.17L15 2H9L7.17 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 14H4V6h4.05l1.83-2h4.24l1.83 2H20v12z' }));
        return s;
    },
    shield(size) {
        const s = base(size, true);
        s.appendChild(el('path', { d: 'M12 2L4 5v6.09c0 5.05 3.41 9.76 8 10.91 4.59-1.15 8-5.86 8-10.91V5l-8-3z' }));
        return s;
    },
    close(size) {
        const s = base(size, true);
        s.appendChild(el('path', { d: 'M6 6 L18 18' }));
        s.appendChild(el('path', { d: 'M18 6 L6 18' }));
        return s;
    },
    warn(size) {
        const s = base(size, true);
        s.appendChild(el('path', { d: 'M12 3.2 1.6 21h20.8z' }));
        s.appendChild(el('path', { d: 'M12 9.5v5M12 17.8h.01' }));
        return s;
    },
    globe(size) {
        const s = base(size, true);
        s.appendChild(el('circle', { cx: '12', cy: '12', r: '8.5' }));
        s.appendChild(el('path', { d: 'M3.5 12h17M12 3.5c2.5 2.3 3.9 5.3 3.9 8.5s-1.4 6.2-3.9 8.5c-2.5-2.3-3.9-5.3-3.9-8.5S9.5 5.8 12 3.5z' }));
        return s;
    },
    map(size) {
        const s = base(size, true);
        s.appendChild(el('path', { d: 'M9 4 3.5 6v14L9 18l6 2 5.5-2V4L15 6 9 4z' }));
        s.appendChild(el('path', { d: 'M9 4v14M15 6v14' }));
        return s;
    },
    tag(size) {
        const s = base(size, true);
        s.appendChild(el('path', { d: 'M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0l-7.2-7.2A2 2 0 0 1 3 12V4.5a1.5 1.5 0 0 1 1.5-1.5H12a2 2 0 0 1 1.4.6l7.2 7.2a2 2 0 0 1 0 2.6z' }));
        s.appendChild(el('path', { d: 'M7.5 7.5h.01' }));
        return s;
    },
    cloud(size) {
        const s = base(size, true);
        s.appendChild(el('path', { d: 'M7 18.5a4.2 4.2 0 0 1-.3-8.4 5.6 5.6 0 0 1 10.8-1.6A3.8 3.8 0 0 1 17.3 18.5z' }));
        return s;
    },
    lock(size) {
        const s = base(size, true);
        s.appendChild(el('rect', { x: '4.8', y: '10.5', width: '14.4', height: '10', rx: '2' }));
        s.appendChild(el('path', { d: 'M8 10.5V7.2a4 4 0 0 1 8 0v3.3M12 14.3v2.6' }));
        return s;
    },
    hourglass(size) {
        const s = base(size, true);
        s.appendChild(el('path', { d: 'M6.5 3h11M6.5 21h11' }));
        s.appendChild(el('path', { d: 'M7.5 3c0 4.8 4.5 6 4.5 9s-4.5 4.2-4.5 9M16.5 3c0 4.8-4.5 6-4.5 9s4.5 4.2 4.5 9' }));
        return s;
    },
    wrench(size) {
        const s = base(size, true);
        s.appendChild(el('path', { d: 'M15.3 6.3a3.6 3.6 0 0 1-4.6 4.6l-6 6a1.8 1.8 0 1 1-2.6-2.6l6-6a3.6 3.6 0 0 1 4.6-4.6L10.4 6 11 7.4l1.4.6 2.9-1.7z' }));
        return s;
    },
    sparkles(size) {
        const s = base(size, true);
        s.appendChild(el('path', { d: 'M12 3.5l1.7 4.8L18.5 10l-4.8 1.7L12 16.5l-1.7-4.8L5.5 10l4.8-1.7z' }));
        s.appendChild(el('path', { d: 'M18 14.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z' }));
        return s;
    },
    save(size) {
        const s = base(size, true);
        s.appendChild(el('path', { d: 'M5.5 3.5h11L20.5 7.5v12a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1z' }));
        s.appendChild(el('path', { d: 'M7.5 3.5v5h7v-5M7.5 20.5v-6h9v6' }));
        return s;
    },
    check(size) {
        const s = base(size, true);
        s.appendChild(el('path', { d: 'M4.5 12.5l4.5 4.5 10.5-10.5' }));
        return s;
    },
    heart(size) {
        const s = base(size, true);
        s.appendChild(el('path', { d: 'M12 20.5S3.5 15 3.5 9.2C3.5 6.4 5.6 4.5 8.1 4.5c1.7 0 3.1.9 3.9 2.2.8-1.3 2.2-2.2 3.9-2.2 2.5 0 4.6 1.9 4.6 4.7 0 5.8-8.5 11.3-8.5 11.3z' }));
        return s;
    },
    reply(size) {
        const s = base(size, true);
        s.appendChild(el('path', { d: 'M9 17l-5-5 5-5' }));
        s.appendChild(el('path', { d: 'M4 12h11a5 5 0 0 1 5 5v1' }));
        return s;
    },
    plus(size) {
        const s = base(size, true);
        s.appendChild(el('path', { d: 'M12 5v14M5 12h14' }));
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
export function deviceIcon(deviceString, size = 15) {
    switch (classifyDevice(deviceString)) {
        case 'ios': return apple(size);
        case 'android': return android(size);
        case 'web': return web(size);
        default: return unknownDevice(size);
    }
}

/**
 * Return an SVG element for a named glyph (info, vpn, location, verified,
 * created, id, affiliation, clock, swap, camera, shield, close, warn, globe,
 * map, tag, cloud, lock, hourglass, wrench, sparkles, save, check, heart,
 * reply, plus, copy, share, xLogo, zoom). Falls back to the info glyph.
 * @param {string} name
 * @param {number} size
 * @returns {SVGElement}
 */
export function glyph(name, size = 16) {
    return (GLYPHS[name] || GLYPHS.info)(size);
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
    const emoji = COUNTRY_FLAGS[String(countryName).trim().toLowerCase()];
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
