/**
 * Evidence Screenshot Generator
 * Captures tweets with metadata overlay for researchers and journalists
 * Uses native Canvas API with image loading for profile pics and media
 */

import { VERSION } from '../shared/constants.js';
import { getCountryCode, classifyDevice } from '../shared/utils.js';
import { glyph } from '../content/icons.js';
import { dialogIcon } from './dialog-icons.js';
import browserAPI from '../shared/browser-api.js';
import { showToast, dismissToast } from './notifications.js';
import { extractCaptureSnapshot } from './capture-snapshot.js';
import { statusIdOf } from './post-identity.js';

let activeCapture = null;

/** Cancel unfinished rendering and release the Share sheet's focus listeners. */
export function cleanupEvidenceCapture() {
    cancelPendingCapture();
    activeShareSheet?.close(false);
}

function cancelPendingCapture() {
    if (!activeCapture) return;
    const previous = activeCapture;
    activeCapture = null;
    previous.controller.abort();
    dismissToast(previous.toast, { immediate: true });
}

/**
 * Capture the post belonging to the clicked badge, not a nearby quoted account.
 * The immutable snapshot is taken before images load or X can recycle the DOM.
 * @param {HTMLElement} tweetElement
 * @param {Object} userInfo
 * @param {string} screenName
 * @param {HTMLElement|null} sourceAuthor
 */
export async function captureEvidence(tweetElement, userInfo, screenName, sourceAuthor = null) {
    cancelPendingCapture();
    const job = { controller: new AbortController(), toast: null };
    activeCapture = job;
    const signal = job.controller.signal;
    try {
        const snapshot = Object.freeze({
            ...extractCaptureSnapshot(tweetElement, screenName, sourceAuthor),
            location: typeof userInfo?.location === 'string' && userInfo.location ? userInfo.location : 'Unknown',
            device: typeof userInfo?.device === 'string' && userInfo.device ? userInfo.device : 'Unknown',
            locationAccurate: userInfo?.locationAccurate,
            captureTime: new Date().toISOString(),
            version: VERSION
        });
        job.toast = showToast({ message: 'Capturing evidence…', iconType: 'info',
            duration: 0, loading: true, dismissible: false });
        const canvas = await createEvidenceCanvas(snapshot, signal);
        if (activeCapture !== job || signal.aborted) return;
        showShareSheet(canvas, {
            screenName: snapshot.screenName,
            tweetUrl: snapshot.tweetUrl,
            location: snapshot.location
        });
    } catch (error) {
        if (activeCapture !== job || signal.aborted) return;
        console.error('X-Posed: Evidence capture failed:', error);
        showErrorNotification(error.message || 'Failed to capture this post. Try again.');
    } finally {
        dismissToast(job.toast, { immediate: true });
        if (activeCapture === job) activeCapture = null;
    }
}

function captureAborted() {
    return new DOMException('Evidence capture cancelled.', 'AbortError');
}

/** Image requests belong to the capture job and cannot outlive its cleanup. */
function loadImage(src, signal) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(captureAborted());
            return;
        }
        const img = new Image();
        let settled = false;
        const finish = error => {
            if (settled) return;
            settled = true;
            img.onload = null;
            img.onerror = null;
            signal?.removeEventListener('abort', onAbort);
            if (error) reject(error);
            else resolve(img);
        };
        const onAbort = () => {
            finish(captureAborted());
            img.removeAttribute('src');
        };
        img.crossOrigin = 'anonymous';
        img.onload = () => finish();
        img.onerror = () => finish(new Error('Failed to load image'));
        signal?.addEventListener('abort', onAbort, { once: true });
        img.src = src;
    });
}

/**
 * Create evidence canvas with all data
 */
async function createEvidenceCanvas(data, signal) {
    if (signal?.aborted) throw captureAborted();
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    // Solid Graphite colors match the surrounding account and settings views.
    const theme = document.documentElement.getAttribute('data-x-theme') === 'light' ? 'light' : 'dark';
    const PAL = theme === 'light'
        ? { bg: '#FFFFFF', panel: '#F1F4F3', text: '#20272A', dim: '#5E6A70', border: '#D7DDDD', accent: '#236C5C', warning: '#85500D' }
        : { bg: '#1C1F22', panel: '#25292D', text: '#ECF0F1', dim: '#A5AFB6', border: '#353B40', accent: '#91D2C2', warning: '#E7B36A' };
    const font = '"Segoe UI", system-ui, sans-serif';

    // 24x24-viewBox vector icon path data (matches the extension SVG icon set).
    // Each icon is an array of { d, fill? } sub-paths (fill:true => fill, else stroke).
    const ICONS = {
        location: [
            { d: 'M12 21s-6-5.3-6-10a6 6 0 1 1 12 0c0 4.7-6 10-6 10z' },
            { d: 'M12 11 m-2.2 0 a2.2 2.2 0 1 0 4.4 0 a2.2 2.2 0 1 0 -4.4 0' }
        ],
        vpn: [
            { d: 'm21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3' },
            { d: 'M12 9v4M12 17h.01' }
        ],
        verified: [
            { d: 'M9.6 12l1.7 1.7 3.3-3.4' },
            { d: 'M12 3l2.2 1.6 2.7-.2 1 2.5 2.3 1.4-.6 2.6.6 2.6-2.3 1.4-1 2.5-2.7-.2L12 21l-2.2-1.6-2.7.2-1-2.5L3.8 15.7l.6-2.6-.6-2.6 2.3-1.4 1-2.5 2.7.2z' }
        ],
        date: [
            { d: 'M4 5h16v16H4z' },
            { d: 'M4 9h16M8 3v4M16 3v4' }
        ],
        apple: [
            { d: 'M17.05 12.5c-.03-2.5 2.04-3.7 2.13-3.76-1.16-1.7-2.97-1.93-3.61-1.96-1.54-.16-3 .9-3.78.9-.78 0-1.98-.88-3.25-.86-1.67.03-3.21.97-4.07 2.46-1.74 3.02-.45 7.49 1.25 9.94.83 1.2 1.82 2.55 3.12 2.5 1.25-.05 1.72-.81 3.23-.81 1.51 0 1.94.81 3.26.78 1.35-.02 2.2-1.22 3.02-2.43.95-1.39 1.34-2.74 1.36-2.81-.03-.01-2.61-1-2.64-3.99zM14.6 5.1c.69-.83 1.15-1.99 1.02-3.14-.99.04-2.19.66-2.9 1.49-.64.73-1.2 1.91-1.05 3.03 1.1.09 2.24-.56 2.93-1.38z', fill: true }
        ],
        android: [
            { d: 'M8 8h8v9a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1z' },
            { d: 'M10.5 21h3' }
        ],
        web: [
            { d: 'M12 12 m-8.2 0 a8.2 8.2 0 1 0 16.4 0 a8.2 8.2 0 1 0 -16.4 0' },
            { d: 'M3.8 12h16.4M12 3.8c2.4 2.2 3.7 5.1 3.7 8.2s-1.3 6-3.7 8.2c-2.4-2.2-3.7-5.1-3.7-8.2S9.6 6 12 3.8z' }
        ],
        link: [
            { d: 'M9.5 14.5l5-5' },
            { d: 'M8 11l-1.8 1.8a3 3 0 0 0 4.2 4.2L12.5 15' },
            { d: 'M16 13l1.8-1.8a3 3 0 0 0-4.2-4.2L11.5 9' }
        ],
        camera: [
            { d: 'M4 8h3l1.5-2h7L17 8h3v12H4z' },
            { d: 'M12 13 m-3 0 a3 3 0 1 0 6 0 a3 3 0 1 0 -6 0' }
        ],
        reply: [
            { d: 'M5 6h14v9H9l-4 4z' }
        ],
        retweet: [
            { d: 'M6 8h9l-2.5-2.5M18 16H9l2.5 2.5' }
        ],
        like: [
            { d: 'M12 20s-7-4.7-7-9.6A3.4 3.4 0 0 1 12 8a3.4 3.4 0 0 1 7 2.4C19 15.3 12 20 12 20z' }
        ],
        views: [
            { d: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z' },
            { d: 'M12 12 m-2.6 0 a2.6 2.6 0 1 0 5.2 0 a2.6 2.6 0 1 0 -5.2 0' }
        ]
    };

    // Draw a 24x24-viewBox icon at (x,y) sized `size`, in color `color`.
    function drawIcon(ctx, paths, x, y, size, color, opts = {}) {
        ctx.save();
        ctx.translate(x, y);
        ctx.scale(size / 24, size / 24);
        ctx.strokeStyle = color; ctx.fillStyle = color;
        ctx.lineWidth = opts.lineWidth || 1.8; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        for (const p of paths) {
            const path = new Path2D(p.d);
            if (p.fill) ctx.fill(path); else ctx.stroke(path);
        }
        ctx.restore();
    }

    // Pick a device icon based on the device string. Uses the shared
    // classifyDevice() ladder so classification stays consistent across the
    // extension; maps each category onto this Canvas ICONS set.
    function deviceIconFor(device) {
        switch (classifyDevice(device)) {
            case 'ios': return ICONS.apple;
            case 'android': return ICONS.android;
            case 'web':
            default: return ICONS.web;
        }
    }

    // Configuration - improved spacing
    const width = 580;
    const padding = 24;
    const lineHeight = 24;
    
    // Load images
    let profileImg = null;
    if (data.profileImageUrl) {
        try {
            profileImg = await loadImage(data.profileImageUrl, signal);
        } catch (e) {
            if (signal?.aborted) throw captureAborted();
            console.warn('Could not load profile image');
        }
    }
    
    // Load first media image if exists
    let mediaImg = null;
    if (data.mediaUrls && data.mediaUrls.length > 0) {
        try {
            mediaImg = await loadImage(data.mediaUrls[0], signal);
        } catch (e) {
            if (signal?.aborted) throw captureAborted();
            console.warn('Could not load media image');
        }
    }
    
    if (signal?.aborted) throw captureAborted();

    // Calculate content height
    const tempCanvas = document.createElement('canvas');
    const tempCtx = tempCanvas.getContext('2d');
    const tweetLines = wrapText(tempCtx, data.tweetText, width - padding * 2 - 70, `15px ${font}`);
    const tweetHeight = Math.max(tweetLines.length * lineHeight, lineHeight);
    
    // Media height (max 250px, maintain aspect ratio)
    let mediaHeight = 0;
    let mediaWidth = 0;
    if (mediaImg) {
        const maxMediaHeight = 250;
        const maxMediaWidth = width - padding * 2;
        const aspectRatio = mediaImg.width / mediaImg.height;
        
        if (aspectRatio > maxMediaWidth / maxMediaHeight) {
            mediaWidth = maxMediaWidth;
            mediaHeight = maxMediaWidth / aspectRatio;
        } else {
            mediaHeight = Math.min(mediaImg.height, maxMediaHeight);
            mediaWidth = mediaHeight * aspectRatio;
        }
        mediaHeight += 15; // spacing
    }
    
    // Calculate total height - improved spacing
    const headerHeight = 65;
    const tweetSectionHeight = tweetHeight + 20;
    const metricsHeight = 40;
    const metadataHeight = 175;
    
    const height = padding + headerHeight + tweetSectionHeight + mediaHeight + metricsHeight + metadataHeight + padding + 10;
    
    // Set canvas size (2x for retina)
    const scale = 2;
    canvas.width = width * scale;
    canvas.height = height * scale;
    ctx.scale(scale, scale);
    
    // Background - theme-aware
    ctx.fillStyle = PAL.bg;
    ctx.fillRect(0, 0, width, height);

    // A quiet outline keeps the exported image consistent with Graphite.
    ctx.strokeStyle = PAL.border;
    ctx.lineWidth = 1;
    roundRect(ctx, 0, 0, width, height, 12);
    ctx.stroke();
    ctx.shadowBlur = 0;
    
    let y = padding;
    
    // === USER HEADER ===
    // Profile image
    if (profileImg) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(padding + 22, y + 22, 22, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(profileImg, padding, y, 44, 44);
        ctx.restore();
        
        // Border around avatar
        ctx.strokeStyle = PAL.border;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(padding + 22, y + 22, 22, 0, Math.PI * 2);
        ctx.stroke();
    } else {
        // Fallback circle with initial
        ctx.fillStyle = PAL.accent;
        ctx.beginPath();
        ctx.arc(padding + 22, y + 22, 22, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = PAL.bg;
        ctx.font = `bold 18px ${font}`;
        ctx.textAlign = 'center';
        ctx.fillText(data.screenName.charAt(0).toUpperCase(), padding + 22, y + 28);
        ctx.textAlign = 'left';
    }
    
    // Display name - larger and bolder
    ctx.fillStyle = PAL.text;
    ctx.font = `bold 16px ${font}`;
    ctx.fillText(truncateText(ctx, data.displayName, 220), padding + 60, y + 20);

    // Username - better spacing
    ctx.fillStyle = PAL.dim;
    ctx.font = `14px ${font}`;
    const userStr = `@${data.screenName}`;
    ctx.fillText(userStr, padding + 60, y + 42);
    
    y += headerHeight;
    
    // === TWEET TEXT ===
    ctx.fillStyle = PAL.text;
    ctx.font = `16px ${font}`;

    for (const line of tweetLines) {
        ctx.fillText(line, padding, y + 18);
        y += lineHeight;
    }

    if (tweetLines.length === 0) {
        ctx.fillStyle = PAL.dim;
        ctx.font = `italic 15px ${font}`;
        ctx.fillText('[Media or link only]', padding, y + 18);
        y += lineHeight;
    }
    
    y += 15;
    
    // === MEDIA IMAGE ===
    if (mediaImg && mediaHeight > 0) {
        const mediaX = padding;
        ctx.save();
        roundRect(ctx, mediaX, y, mediaWidth, mediaHeight - 15, 12);
        ctx.clip();
        ctx.drawImage(mediaImg, mediaX, y, mediaWidth, mediaHeight - 15);
        ctx.restore();
        
        // Border
        ctx.strokeStyle = PAL.border;
        ctx.lineWidth = 1;
        roundRect(ctx, mediaX, y, mediaWidth, mediaHeight - 15, 12);
        ctx.stroke();

        y += mediaHeight;
    }

    // === METRICS === - improved spacing
    ctx.fillStyle = PAL.dim;
    ctx.font = `14px ${font}`;
    
    let metricsX = padding;
    const metricGap = 28;
    const metricIconSize = 16;
    const metricTextGap = 6;
    // Draw a single metric: vector icon + count value, advance metricsX.
    const drawMetric = (paths, value) => {
        drawIcon(ctx, paths, metricsX, y + 5, metricIconSize, PAL.dim, { lineWidth: 1.6 });
        const textX = metricsX + metricIconSize + metricTextGap;
        ctx.fillStyle = PAL.dim;
        ctx.fillText(value, textX, y + 18);
        metricsX = textX + ctx.measureText(value).width + metricGap;
    };
    if (data.metrics.replies) {
        drawMetric(ICONS.reply, `${data.metrics.replies}`);
    }
    if (data.metrics.retweets) {
        drawMetric(ICONS.retweet, `${data.metrics.retweets}`);
    }
    if (data.metrics.likes) {
        drawMetric(ICONS.like, `${data.metrics.likes}`);
    }
    if (data.metrics.views) {
        drawMetric(ICONS.views, `${data.metrics.views}`);
    }
    
    y += metricsHeight;
    
    // === DIVIDER ===
    ctx.strokeStyle = PAL.border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padding, y);
    ctx.lineTo(width - padding, y);
    ctx.stroke();

    y += 20;

    // === EVIDENCE METADATA SECTION ===
    // Background for metadata - subtle rounded container
    ctx.fillStyle = PAL.panel;
    roundRect(ctx, padding - 8, y - 8, width - padding * 2 + 16, metadataHeight - 15, 10);
    ctx.fill();
    ctx.strokeStyle = PAL.border;
    ctx.lineWidth = 1;
    roundRect(ctx, padding - 8, y - 8, width - padding * 2 + 16, metadataHeight - 15, 10);
    ctx.stroke();

    // Header - larger and more prominent
    drawIcon(ctx, ICONS.camera, padding + 4, y + 2, 14, PAL.accent);
    ctx.fillStyle = PAL.accent;
    ctx.font = `bold 12px ${font}`;
    ctx.fillText('X-POSED EVIDENCE CAPTURE', padding + 24, y + 14);
    
    y += 32;
    
    // Metadata rows - improved spacing and typography
    const labelX = padding + 4;
    const valueX = padding + 110;
    const rowHeight = 26;
    
    // Location row
    drawIcon(ctx, ICONS.location, labelX, y + 3, 16, PAL.accent);
    ctx.font = `14px ${font}`;
    ctx.fillStyle = PAL.dim;
    ctx.fillText('Location', labelX + 22, y + 16);

    const countryCode = getCountryCode(data.location);
    const locationUncertain = data.locationAccurate === false;

    // Location value with country code
    ctx.fillStyle = PAL.text;
    ctx.font = `600 14px ${font}`;
    ctx.fillText(data.location, valueX, y + 16);

    // Country code badge - improved styling
    const locWidth = ctx.measureText(data.location).width;
    ctx.fillStyle = hexToRgba(PAL.accent, 0.15);
    const codeText = `${countryCode}`;
    ctx.font = `bold 11px ${font}`;
    const codeWidth = ctx.measureText(codeText).width + 10;
    roundRect(ctx, valueX + locWidth + 10, y + 3, codeWidth, 18, 4);
    ctx.fill();
    ctx.fillStyle = PAL.accent;
    ctx.fillText(codeText, valueX + locWidth + 15, y + 16);

    // X's warning signals uncertainty, not proof of a VPN or proxy.
    if (locationUncertain) {
        const vpnX = valueX + locWidth + 10 + codeWidth + 12;

        ctx.fillStyle = hexToRgba(PAL.warning, 0.15);
        roundRect(ctx, vpnX - 6, y + 1, 105, 22, 5);
        ctx.fill();
        ctx.strokeStyle = PAL.warning;
        ctx.lineWidth = 1.5;
        roundRect(ctx, vpnX - 6, y + 1, 105, 22, 5);
        ctx.stroke();

        drawIcon(ctx, ICONS.vpn, vpnX + 2, y + 4, 15, PAL.warning, { lineWidth: 1.6 });
        ctx.fillStyle = PAL.warning;
        ctx.font = `bold 11px ${font}`;
        ctx.fillText('UNCERTAIN', vpnX + 20, y + 16);
    }

    y += rowHeight;

    // Device row
    drawIcon(ctx, deviceIconFor(data.device), labelX, y + 3, 16, PAL.accent);
    ctx.font = `14px ${font}`;
    ctx.fillStyle = PAL.dim;
    ctx.fillText('Device', labelX + 22, y + 16);
    ctx.fillStyle = PAL.text;
    ctx.font = `600 14px ${font}`;
    ctx.fillText(data.device || 'Unknown', valueX, y + 16);

    y += rowHeight;

    // Capture time row
    const captureDate = new Date(data.captureTime);
    const dateStr = captureDate.toISOString().replace('T', '  ').substring(0, 21) + ' UTC';

    drawIcon(ctx, ICONS.date, labelX, y + 3, 16, PAL.accent);
    ctx.font = `14px ${font}`;
    ctx.fillStyle = PAL.dim;
    ctx.fillText('Captured', labelX + 22, y + 16);
    ctx.fillStyle = PAL.text;
    ctx.font = `600 14px ${font}`;
    ctx.fillText(dateStr, valueX, y + 16);

    y += rowHeight;

    // URL row
    drawIcon(ctx, ICONS.link, labelX, y + 3, 16, PAL.accent);
    ctx.font = `14px ${font}`;
    ctx.fillStyle = PAL.dim;
    ctx.fillText('Source', labelX + 22, y + 16);
    ctx.fillStyle = PAL.accent;
    ctx.font = `13px ${font}`;
    const shortUrl = data.tweetUrl.replace('https://x.com/', 'x.com/');
    ctx.fillText(truncateText(ctx, shortUrl, width - valueX - padding - 20), valueX, y + 16);

    y += rowHeight + 10;

    // Footer - subtle branding
    ctx.fillStyle = PAL.dim;
    ctx.font = `11px ${font}`;
    ctx.fillText(`Generated by X-Posed v${data.version}`, labelX, y + 10);
    
    return canvas;
}

/**
 * Convert a #RRGGBB hex color to an rgba() string with the given alpha
 */
function hexToRgba(hex, alpha) {
    const h = hex.replace('#', '');
    const r = parseInt(h.substring(0, 2), 16);
    const g = parseInt(h.substring(2, 4), 16);
    const b = parseInt(h.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Draw rounded rectangle
 */
function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}

/**
 * Truncate text to fit width
 */
function truncateText(ctx, text, maxWidth) {
    if (!text) return '';
    const metrics = ctx.measureText(text);
    if (metrics.width <= maxWidth) return text;
    
    let truncated = text;
    while (ctx.measureText(truncated + '...').width > maxWidth && truncated.length > 0) {
        truncated = truncated.slice(0, -1);
    }
    return truncated + '...';
}

/**
 * Wrap text to fit within width
 */
function wrapText(ctx, text, maxWidth, font) {
    if (!text) return [];
    
    ctx.font = font;
    const words = text.split(' ');
    const lines = [];
    let currentLine = '';
    
    for (const word of words) {
        const testLine = currentLine ? `${currentLine} ${word}` : word;
        const metrics = ctx.measureText(testLine);
        
        if (metrics.width > maxWidth && currentLine) {
            lines.push(currentLine);
            currentLine = word;
        } else {
            currentLine = testLine;
        }
    }
    
    if (currentLine) {
        lines.push(currentLine);
    }
    
    // Limit to 8 lines
    if (lines.length > 8) {
        lines.length = 8;
        lines[7] += '...';
    }
    
    return lines;
}

// ---- share sheet: quote / reply / post with the evidence image ----

// Touch / no-hover devices (e.g. Firefox for Android) use the native share sheet.
const TOUCH = !(typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(hover: hover)').matches);
let lastShareMode = 'quote';
let activeShareSheet = null;

// Synchronous data-URL -> Blob so clipboard write / window.open / share can all
// fire inside the click gesture (an async toBlob would trip popup + clipboard guards).
function dataUrlToBlob(dataUrl) {
    const parts = dataUrl.split(',');
    const mime = (/:(.*?);/.exec(parts[0]) || [])[1] || 'image/png';
    const bin = atob(parts[1]);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
}

// Initiated synchronously within a gesture; resolves true if the image landed.
function copyImage(blob) {
    try {
        if (navigator.clipboard && window.ClipboardItem) {
            return navigator.clipboard.write([new window.ClipboardItem({ 'image/png': blob })])
                .then(() => true).catch(() => false);
        }
    } catch (_) { /* clipboard unavailable */ }
    return Promise.resolve(false);
}

// X's official compose intent. Quote = caption + their tweet URL (X embeds it as a
// quote); Reply = caption under their post; New = a standalone post.
function buildIntentUrl(mode, caption, tweetUrl, statusId, screenName) {
    const p = new URLSearchParams();
    let text = caption || '';
    if (mode === 'reply' && statusId) {
        p.set('in_reply_to', statusId);
    } else if (mode === 'quote' && tweetUrl) {
        p.set('url', tweetUrl);
    } else if (mode === 'post' && screenName) {
        // "New post" is a standalone tweet that mentions the account. The @handle goes
        // at the end (not leading) so X does not treat the post as a reply.
        text = `${text} @${screenName}`.trim();
    }
    p.set('text', text);
    return 'https://x.com/intent/post?' + p.toString();
}

function defaultCaption(location) {
    const where = location && location !== 'Unknown' ? location : null;
    return where
        ? `X lists this account’s location as ${where}. (via X-Posed)`
        : 'Account information reported by X. (via X-Posed)';
}

/**
 * Show the share sheet: preview the evidence image, edit a caption, and post it to
 * X as a quote / reply / new post (or copy / save). Replaces the old save-only
 * evidence modal; the capture engine (createEvidenceCanvas) is reused unchanged.
 */
function showShareSheet(canvas, info) {
    const ce = (tag, cls, txt) => {
        const n = document.createElement(tag);
        if (cls) n.className = cls;
        if (typeof txt === 'string') n.textContent = txt;
        return n;
    };

    const statusId = statusIdOf(info.tweetUrl);
    const filename = generateFilename(info.screenName);

    // Encode the (immutable) rendered canvas once; preview, zoom, clipboard, share, and
    // save all reuse this single data URL instead of re-running toDataURL each time.
    const previewDataUrl = canvas.toDataURL('image/png');
    const blob = dataUrlToBlob(previewDataUrl);
    const returnFocus = activeShareSheet ? activeShareSheet.returnFocus : document.activeElement;
    activeShareSheet?.close(false);
    let closed = false;
    let pending = false;
    let copying = false;
    let zoom = null;

    const overlay = ce('div', 'x-share-overlay');
    const sheet = ce('div', 'x-share-sheet');
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-labelledby', 'x-share-title');
    sheet.tabIndex = -1;

    const head = ce('div', 'x-share-head');
    const htitle = ce('div', 'x-share-title');
    const heading = ce('h2', null, 'Share evidence');
    heading.id = 'x-share-title';
    htitle.append(heading, ce('p', 'x-share-subtitle', `Account information for @${info.screenName}`));
    const closeBtn = ce('button', 'x-share-close');
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Close share evidence');
    closeBtn.appendChild(dialogIcon('close', 18));
    head.append(htitle, closeBtn);

    const previewColumn = ce('div', 'x-share-preview-column');
    const sectionHead = ce('div', 'x-share-section-head');
    sectionHead.append(ce('h3', null, 'Evidence image'), ce('span', null, 'PNG'));
    const preview = ce('button', 'x-share-preview');
    preview.type = 'button';
    preview.setAttribute('aria-label', 'Enlarge evidence preview');
    const img = ce('img');
    img.src = previewDataUrl;
    img.alt = `Evidence image for @${info.screenName}`;
    preview.appendChild(img);
    const zoomHint = ce('span', 'x-share-zoomhint');
    zoomHint.append(glyph('zoom', 15), ce('span', null, 'Enlarge preview'));
    preview.appendChild(zoomHint);
    preview.addEventListener('click', () => {
        if (zoom || closed) return;
        zoom = ce('div', 'x-share-zoom');
        zoom.setAttribute('role', 'dialog');
        zoom.setAttribute('aria-modal', 'true');
        zoom.setAttribute('aria-label', 'Enlarged evidence image');
        zoom.tabIndex = -1;
        const big = ce('img');
        big.src = previewDataUrl;
        big.alt = img.alt;
        const zoomClose = ce('button', 'x-share-zoom-close');
        zoomClose.type = 'button';
        zoomClose.setAttribute('aria-label', 'Close enlarged preview');
        zoomClose.appendChild(dialogIcon('close', 20));
        zoomClose.addEventListener('click', () => closeZoom());
        zoom.append(big, zoomClose);
        zoom.addEventListener('click', event => {
            event.stopPropagation();
            if (event.target === zoom || event.target === big) closeZoom();
        });
        sheet.inert = true;
        document.body.appendChild(zoom);
        zoomClose.focus({ preventScroll: true });
    });

    const exports = ce('div', 'x-share-exports');
    const copyBtn = ce('button', 'x-share-ghost');
    copyBtn.type = 'button';
    copyBtn.append(glyph('copy', 16), ce('span', null, 'Copy image'));
    const saveBtn = ce('button', 'x-share-ghost');
    saveBtn.type = 'button';
    saveBtn.append(glyph('save', 16), ce('span', null, 'Save PNG'));
    exports.append(copyBtn, saveBtn);
    previewColumn.append(sectionHead, preview, exports);

    const capWrap = ce('div', 'x-share-capwrap');
    const capLabel = ce('label', 'x-share-caplbl', 'Caption');
    capLabel.htmlFor = 'x-share-caption';
    const cap = ce('textarea', 'x-share-cap');
    cap.id = 'x-share-caption';
    cap.maxLength = 280;
    cap.rows = 4;
    cap.value = defaultCaption(info.location).slice(0, 280);
    cap.setAttribute('aria-describedby', 'x-share-caption-meta');
    const capMeta = ce('div', 'x-share-capmeta');
    capMeta.id = 'x-share-caption-meta';
    const count = ce('span', 'x-share-count');
    const updCount = () => { count.textContent = `${cap.value.length} / 280`; };
    cap.addEventListener('input', updCount);
    updCount();
    capWrap.appendChild(cap);
    capMeta.append(ce('span', null, 'Edit before continuing'), count);
    const captionGroup = ce('div', 'x-share-caption-group');
    captionGroup.append(capLabel, capWrap, capMeta);

    const modeWrap = ce('fieldset', 'x-share-modes');
    modeWrap.hidden = TOUCH;
    modeWrap.appendChild(ce('legend', 'x-share-modelbl', 'Share as'));
    const seg = ce('div', 'x-share-seg');
    const MODES = [
        { key: 'quote', label: 'Quote', desc: 'Opens an X draft with the original post linked for quoting.' },
        { key: 'reply', label: 'Reply', desc: 'Opens an X reply draft under the original post.' },
        { key: 'post', label: 'New post', desc: 'Opens a new X draft mentioning this account.' }
    ];
    const desc = ce('div', 'x-share-desc');
    desc.id = 'x-share-mode-description';
    modeWrap.setAttribute('aria-describedby', desc.id);
    const radios = [];
    let mode = MODES.some(m => m.key === lastShareMode) ? lastShareMode : 'quote';
    const selectMode = key => {
        mode = key;
        lastShareMode = key;
        radios.forEach(radio => { radio.checked = radio.value === key; });
        desc.textContent = MODES.find(item => item.key === key).desc;
    };
    MODES.forEach(item => {
        const label = ce('label', 'x-share-mode');
        const radio = ce('input');
        radio.type = 'radio';
        radio.name = 'x-share-mode';
        radio.value = item.key;
        radio.addEventListener('change', () => { if (radio.checked) selectMode(item.key); });
        label.append(radio, ce('span', null, item.label));
        radios.push(radio);
        seg.appendChild(label);
    });
    modeWrap.append(seg, desc);
    selectMode(mode);

    const shareBtn = ce('button', 'x-share-primary');
    shareBtn.type = 'button';
    shareBtn.append(glyph(TOUCH ? 'share' : 'xLogo', 17), ce('span', null, TOUCH ? 'Share image' : 'Continue to X'));
    const feedback = ce('div', 'x-share-feedback');
    feedback.setAttribute('role', 'status');
    feedback.hidden = true;
    const guide = ce('div', 'x-share-guide');
    guide.append(dialogIcon('infoCircle', 16), ce('p', null, TOUCH
        ? 'Your device’s share sheet chooses the destination. Select X or another app and review before sharing. Location may be approximate.'
        : 'Continue copies the PNG and opens an X draft. Paste the image with Ctrl/⌘+V, review it, then post. Location may be approximate.'));
    const sbody = ce('div', 'x-share-body');
    const side = ce('div', 'x-share-side');
    side.append(modeWrap, captionGroup, guide);
    sbody.append(previewColumn, side);
    const footer = ce('div', 'x-share-footer');
    footer.append(ce('p', 'x-share-footnote', 'Nothing is posted automatically.'), shareBtn);
    sheet.append(head, sbody, feedback, footer);
    overlay.appendChild(sheet);

    function closeZoom(restoreFocus = true) {
        if (!zoom) return;
        zoom.remove();
        zoom = null;
        sheet.inert = false;
        if (restoreFocus && !closed) preview.focus({ preventScroll: true });
    }
    function close(restoreFocus = true) {
        if (closed) return;
        closed = true;
        closeZoom(false);
        overlay.remove();
        document.removeEventListener('keydown', onKey, true);
        document.removeEventListener('focusin', onFocus, true);
        if (activeShareSheet?.overlay === overlay) activeShareSheet = null;
        if (restoreFocus && returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
    }
    function focusables(root) {
        return Array.from(root.querySelectorAll('button:not([disabled]), textarea:not([disabled]), input:not([disabled]), [tabindex="0"]'))
            .filter(node => node.getClientRects().length > 0 && !node.closest('[hidden]') &&
                (node.type !== 'radio' || node.checked));
    }
    function onFocus(event) {
        const root = zoom || sheet;
        if (!closed && !root.contains(event.target)) (focusables(root)[0] || root).focus({ preventScroll: true });
    }
    function onKey(e) {
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            if (zoom) closeZoom();
            else close();
        } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !zoom) {
            e.preventDefault();
            e.stopPropagation();
            doShare();
        } else if (e.key === 'Tab') {
            const root = zoom || sheet;
            const items = focusables(root);
            const first = items[0] || root;
            const last = items[items.length - 1] || root;
            if (!root.contains(document.activeElement) || document.activeElement === root ||
                (e.shiftKey ? document.activeElement === first : document.activeElement === last)) {
                e.preventDefault();
                (e.shiftKey ? last : first).focus({ preventScroll: true });
            }
        }
    }
    closeBtn.addEventListener('click', () => close());
    overlay.addEventListener('click', event => {
        event.stopPropagation();
        if (event.target === overlay) close();
    });
    function report(message, tone = 'success') {
        if (closed) return;
        feedback.textContent = message;
        feedback.dataset.tone = tone;
        feedback.hidden = false;
    }
    function setPending(value) {
        pending = value;
        shareBtn.disabled = value || copying;
        copyBtn.disabled = value || copying;
        shareBtn.setAttribute('aria-busy', String(value));
    }

    const saveImage = () => {
        if (closed) return;
        const link = document.createElement('a');
        link.download = filename;
        link.href = previewDataUrl;
        document.body.appendChild(link);
        link.click();
        link.remove();
    };
    function nativeFailure(error) {
        if (closed) return;
        setPending(false);
        if (error?.name === 'AbortError') {
            report('Sharing cancelled. Your image is still here.', 'warning');
            return;
        }
        saveImage();
        report('Sharing was unavailable. A PNG download was requested. Attach it manually, or use Save PNG if the download did not start.', 'warning');
    }

    // Clipboard, window.open and native share are invoked before any await, while
    // the initiating click or keyboard gesture still provides user activation.
    function doShare() {
        if (closed || pending || copying || zoom) return;
        setPending(true);
        const caption = cap.value;
        if (TOUCH) {
            try {
                const file = new File([blob], filename, { type: 'image/png' });
                if (navigator.share && navigator.canShare?.({ files: [file] })) {
                    Promise.resolve(navigator.share({ files: [file], text: caption + (info.tweetUrl ? ' ' + info.tweetUrl : '') }))
                        .then(() => close(), nativeFailure);
                } else nativeFailure();
            } catch (error) {
                nativeFailure(error);
            }
            return;
        }

        const clip = copyImage(blob);
        let win = null;
        try {
            win = window.open(buildIntentUrl(mode, caption, info.tweetUrl, statusId, info.screenName), '_blank');
            if (win) win.opener = null;
        } catch { /* Treat browser-denied opens as blocked pop-ups. */ }
        clip.then(copied => {
            if (closed) return;
            if (win && copied) {
                // Only a successful image copy plus a real composer window may
                // produce the reminder in the destination tab.
                try {
                    Promise.resolve(browserAPI.storage.local.set({ xpPasteHint: Date.now() })).catch(() => {});
                } catch { /* The draft and clipboard remain usable without a reminder. */ }
                close();
            } else if (!win) {
                report(copied
                    ? 'The image was copied, but the X window was blocked. Allow pop-ups and try again, or open an X draft and paste with Ctrl/⌘+V.'
                    : 'The X window and image copy were blocked. Allow pop-ups and try again, or use Save PNG to attach the image manually.', 'warning');
            } else {
                report('The X draft opened, but image copy was blocked. Use Copy image to retry, or Save PNG and attach the file in your draft.', 'warning');
            }
            if (!closed) setPending(false);
        });
    }

    shareBtn.addEventListener('click', doShare);
    copyBtn.addEventListener('click', () => {
        if (closed || pending || copying) return;
        copying = true;
        setPending(false);
        copyBtn.setAttribute('aria-busy', 'true');
        copyImage(blob).then(ok => {
            copying = false;
            if (closed) return;
            setPending(false);
            copyBtn.setAttribute('aria-busy', 'false');
            report(ok ? 'Image copied. Paste it into your draft with Ctrl/⌘+V.'
                : 'Your browser blocked image copy. Use Save PNG and attach the file instead.', ok ? 'success' : 'warning');
        });
    });
    saveBtn.addEventListener('click', () => {
        saveImage();
        report(`PNG download started: ${filename}`);
    });

    activeShareSheet = { overlay, close, returnFocus };
    document.body.appendChild(overlay);
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('focusin', onFocus, true);
    cap.focus({ preventScroll: true });
}

/**
 * Generate evidence filename
 */
function generateFilename(screenName) {
    const date = new Date();
    const dateStr = date.toISOString().split('T')[0];
    const timeStr = date.toTimeString().split(' ')[0].replace(/:/g, '-');
    return `evidence_${screenName}_${dateStr}_${timeStr}.png`;
}

/**
 * Show error notification
 */
function showErrorNotification(message) {
    showToast({ title: 'Capture unavailable', message, iconType: 'error', duration: 3000 });
}
