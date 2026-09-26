/**
 * Lucide 0.468.0 artwork for Graphite settings, toolbar popup and blocking dialog.
 * Source: https://github.com/lucide-icons/lucide/tree/0.468.0/icons
 * ISC license: third-party/LUCIDE-LICENSE.txt (included in both browser builds).
 * Only the SVG elements needed by these views are vendored. No runtime requests.
 */

const NS = 'http://www.w3.org/2000/svg';

const ICON_NODES = {
    // power.svg
    power: [
        ['path', { d: 'M12 2v10' }],
        ['path', { d: 'M18.4 6.6a9 9 0 1 1-12.77.04' }]
    ],
    // settings-2.svg
    settings: [
        ['path', { d: 'M20 7h-9' }],
        ['path', { d: 'M14 17H5' }],
        ['circle', { cx: '17', cy: '17', r: '3' }],
        ['circle', { cx: '7', cy: '7', r: '3' }]
    ],
    // eye.svg
    eye: [
        ['path', { d: 'M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0' }],
        ['circle', { cx: '12', cy: '12', r: '3' }]
    ],
    // chart-no-axes-column.svg
    chart: [
        ['line', { x1: '18', x2: '18', y1: '20', y2: '10' }],
        ['line', { x1: '12', x2: '12', y1: '20', y2: '4' }],
        ['line', { x1: '6', x2: '6', y1: '20', y2: '14' }]
    ],
    // cloud.svg
    cloud: [['path', { d: 'M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z' }]],
    // database.svg
    database: [
        ['ellipse', { cx: '12', cy: '5', rx: '9', ry: '3' }],
        ['path', { d: 'M3 5V19A9 3 0 0 0 21 19V5' }],
        ['path', { d: 'M3 12A9 3 0 0 0 21 12' }]
    ],
    // info.svg
    infoCircle: [
        ['circle', { cx: '12', cy: '12', r: '10' }],
        ['path', { d: 'M12 16v-4' }],
        ['path', { d: 'M12 8h.01' }]
    ],
    // coffee.svg
    coffee: [
        ['path', { d: 'M10 2v2' }],
        ['path', { d: 'M14 2v2' }],
        ['path', { d: 'M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 1 0 8h-1' }],
        ['path', { d: 'M6 2v2' }]
    ],
    // heart.svg
    heart: [['path', { d: 'M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z' }]],
    // triangle-alert.svg
    warn: [
        ['path', { d: 'm21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3' }],
        ['path', { d: 'M12 9v4' }],
        ['path', { d: 'M12 17h.01' }]
    ],
    // check.svg
    check: [['path', { d: 'M20 6 9 17l-5-5' }]],
    // earth.svg
    globe: [
        ['path', { d: 'M21.54 15H17a2 2 0 0 0-2 2v4.54' }],
        ['path', { d: 'M7 3.34V5a3 3 0 0 0 3 3a2 2 0 0 1 2 2c0 1.1.9 2 2 2a2 2 0 0 0 2-2c0-1.1.9-2 2-2h3.17' }],
        ['path', { d: 'M11 21.95V18a2 2 0 0 0-2-2a2 2 0 0 1-2-2v-1a2 2 0 0 0-2-2H2.05' }],
        ['circle', { cx: '12', cy: '12', r: '10' }]
    ],
    // map.svg
    map: [
        ['path', { d: 'M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z' }],
        ['path', { d: 'M15 5.764v15' }],
        ['path', { d: 'M9 3.236v15' }]
    ],
    // contact-round.svg
    tag: [
        ['path', { d: 'M16 2v2' }],
        ['path', { d: 'M17.915 22a6 6 0 0 0-12 0' }],
        ['path', { d: 'M8 2v2' }],
        ['circle', { cx: '12', cy: '12', r: '4' }],
        ['rect', { x: '3', y: '4', width: '18', height: '18', rx: '2' }]
    ],
    // text.svg
    info: [
        ['path', { d: 'M17 6.1H3' }],
        ['path', { d: 'M21 12.1H3' }],
        ['path', { d: 'M15.1 18H3' }]
    ],
    // link.svg
    share: [
        ['path', { d: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71' }],
        ['path', { d: 'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71' }]
    ],
    // badge-check.svg
    verified: [
        ['path', { d: 'M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z' }],
        ['path', { d: 'm9 12 2 2 4-4' }]
    ],
    // building-2.svg
    affiliation: [
        ['path', { d: 'M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z' }],
        ['path', { d: 'M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2' }],
        ['path', { d: 'M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2' }],
        ['path', { d: 'M10 6h4' }],
        ['path', { d: 'M10 10h4' }],
        ['path', { d: 'M10 14h4' }],
        ['path', { d: 'M10 18h4' }]
    ],
    // languages.svg
    languages: [
        ['path', { d: 'm5 8 6 6' }],
        ['path', { d: 'm4 14 6-6 2-3' }],
        ['path', { d: 'M2 5h12' }],
        ['path', { d: 'M7 2h1' }],
        ['path', { d: 'm22 22-5-10-5 10' }],
        ['path', { d: 'M14 18h6' }]
    ],
    // shield.svg
    shield: [
        ['path', { d: 'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z' }]
    ],
    // x.svg
    close: [
        ['path', { d: 'M18 6 6 18' }],
        ['path', { d: 'm6 6 12 12' }]
    ],
    // plus.svg
    plus: [
        ['path', { d: 'M5 12h14' }],
        ['path', { d: 'M12 5v14' }]
    ],
    // chevron-right.svg
    chevronRight: [
        ['path', { d: 'm9 18 6-6-6-6' }]
    ]
};

const templates = new Map();

/** Return an independent SVG so callers cannot mutate the cached icon template. */
export function dialogIcon(name, size = 18) {
    let template = templates.get(name);
    if (!template) {
        const nodes = Object.hasOwn(ICON_NODES, name) ? ICON_NODES[name] : ICON_NODES.shield;
        template = document.createElementNS(NS, 'svg');
        const attributes = {
            viewBox: '0 0 24 24',
            fill: 'none',
            stroke: 'currentColor',
            'stroke-width': '2',
            'stroke-linecap': 'round',
            'stroke-linejoin': 'round',
            'aria-hidden': 'true',
            focusable: 'false'
        };
        for (const [key, value] of Object.entries(attributes)) {
            template.setAttribute(key, value);
        }
        for (const [tag, attrs] of nodes) {
            const child = document.createElementNS(NS, tag);
            for (const [key, value] of Object.entries(attrs)) {
                child.setAttribute(key, value);
            }
            template.appendChild(child);
        }
        templates.set(name, template);
    }
    const svg = template.cloneNode(true);
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    return svg;
}
