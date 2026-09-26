/** Local, illustrative country heatmap. Counts never expand regions into countries. */
import { COUNTRY_FLAGS, REGION_NAMES, canonicalCountry, isRegion } from '../shared/constants.js';
import { formatCountryName } from '../shared/utils.js';
import { WORLD_MAP_PATHS } from './world-map-data.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const MAP_CODES = new Set(WORLD_MAP_PATHS.map(([code]) => code));
const unknownNames = new Set(['', 'unknown', 'unknown location']);

export function countValue(value) {
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function countryCode(key) {
    // Unlike a name-prefix fallback, only actual regional-indicator pairs give an ISO code.
    const points = [...(Object.hasOwn(COUNTRY_FLAGS, key) ? COUNTRY_FLAGS[key] : '')];
    if (points.length !== 2 || points.some(point => point.codePointAt(0) < 0x1f1e6 || point.codePointAt(0) > 0x1f1ff)) return '';
    return points.map(point => String.fromCharCode(point.codePointAt(0) - 0x1f1e6 + 65)).join('');
}

export function locationDistribution(counts, total) {
    const canonical = new Map();
    for (const [name, value] of Object.entries(counts || {})) {
        const count = countValue(value);
        if (!count) continue;
        const key = canonicalCountry(name);
        canonical.set(key, (canonical.get(key) || 0) + count);
    }
    const result = { countries: [], regions: [], unmapped: [], unknown: 0, mapped: new Map() };
    let accounted = 0;
    for (const [key, count] of canonical) {
        accounted += count;
        if (unknownNames.has(key)) {
            result.unknown += count;
            continue;
        }
        const label = REGION_NAMES[key] || formatCountryName(key);
        const row = { key, label, count };
        if (isRegion(key) || key === 'european union') {
            result.regions.push(row);
        } else if (Object.hasOwn(COUNTRY_FLAGS, key)) {
            row.code = countryCode(key);
            row.onMap = MAP_CODES.has(row.code);
            result.countries.push(row);
            if (row.onMap) {
                const previous = result.mapped.get(row.code);
                result.mapped.set(row.code, { ...row, count: count + (previous?.count || 0) });
            }
        } else {
            result.unmapped.push(row);
        }
    }
    // Legacy cached-account statistics do not include accounts with no location.
    result.unknown += Math.max(0, countValue(total) - accounted);
    for (const kind of ['countries', 'regions', 'unmapped']) {
        result[kind].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
    }
    return result;
}

export function createWorldMap(distribution, unit) {
    const root = document.createElement('div');
    root.className = 'xp-stat-map';
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 720 300');
    svg.setAttribute('role', 'group');
    svg.setAttribute('aria-label', `World map of ${unit} by reported country. Exact counts also appear in the location lists.`);
    const description = document.createElementNS(SVG_NS, 'desc');
    description.textContent = 'Stronger mint means more records. Neutral countries have no recorded count. Regions are listed separately. Small countries and territories may not appear at this scale.';
    svg.append(description);

    const readout = document.createElement('output');
    readout.className = 'xp-stat-map-readout';
    readout.setAttribute('aria-live', 'polite');
    const defaultText = distribution.mapped.size ? 'Explore a country for its exact count' : 'No mapped country data yet';
    readout.textContent = defaultText;
    const max = Math.max(0, ...[...distribution.mapped.values()].map(row => row.count));
    for (const [code, name, d] of WORLD_MAP_PATHS) {
        const row = distribution.mapped.get(code);
        const path = document.createElementNS(SVG_NS, 'path');
        path.setAttribute('d', d);
        path.setAttribute('fill-rule', 'evenodd');
        path.dataset.countryCode = code;
        if (row) {
            path.classList.add('has-data');
            path.style.setProperty('--xp-map-strength', String(.28 + .72 * row.count / max));
            path.setAttribute('tabindex', '0');
            path.setAttribute('role', 'img');
            path.dataset.statFocus = `country-${code}`;
            const label = `${row.label}: ${row.count.toLocaleString()} ${unit}`;
            path.setAttribute('aria-label', label);
            const title = document.createElementNS(SVG_NS, 'title');
            title.textContent = label;
            path.append(title);
            const show = () => { readout.textContent = label; };
            const restore = () => {
                const focused = svg.querySelector('path:focus');
                readout.textContent = focused?.getAttribute('aria-label') || defaultText;
            };
            path.addEventListener('pointerenter', show);
            path.addEventListener('pointerleave', restore);
            path.addEventListener('focus', show);
            path.addEventListener('blur', restore);
            // Touch users can inspect a shape without opening a link or changing filters.
            path.addEventListener('click', show);
        } else {
            path.setAttribute('aria-hidden', 'true');
            const title = document.createElementNS(SVG_NS, 'title');
            title.textContent = `${code === 'GB' ? 'United Kingdom' : name}: no recorded count`;
            path.append(title);
        }
        svg.append(path);
    }
    const legend = document.createElement('div');
    legend.className = 'xp-stat-map-legend';
    legend.setAttribute('aria-label', `Mint intensity ranges from fewer records to ${max.toLocaleString()} ${unit}. Neutral means no data.`);
    const neutral = document.createElement('span');
    neutral.className = 'xp-stat-map-neutral';
    neutral.textContent = 'No data';
    const ramp = document.createElement('span');
    ramp.className = 'xp-stat-map-ramp';
    ramp.setAttribute('aria-hidden', 'true');
    ramp.append(document.createTextNode('Fewer'));
    for (let i = 0; i < 5; i++) {
        const swatch = document.createElement('i');
        swatch.style.opacity = String(.28 + .18 * i);
        ramp.append(swatch);
    }
    ramp.append(document.createTextNode('More'));
    legend.append(neutral, ramp);
    root.append(svg, readout, legend);
    return root;
}
