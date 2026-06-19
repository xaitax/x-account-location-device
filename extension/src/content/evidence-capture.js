/**
 * Evidence Screenshot Generator
 * Captures tweets with metadata overlay for researchers and journalists
 * Uses native Canvas API with image loading for profile pics and media
 */

import { VERSION, Z_INDEX } from '../shared/constants.js';
import { getCountryCode, classifyDevice } from '../shared/utils.js';
import { glyph } from '../content/icons.js';
import { showToast } from './ui.js';
import browserAPI from '../shared/browser-api.js';

/**
 * Capture a tweet as evidence with metadata overlay
 * @param {HTMLElement} tweetElement - The tweet article element
 * @param {Object} userInfo - User info from cache (location, device, etc.)
 * @param {string} screenName - The username
 */
export async function captureEvidence(tweetElement, userInfo, screenName) {
    if (!tweetElement) {
        console.error('X-Posed: No tweet element to capture');
        showErrorNotification('No tweet element found');
        return;
    }

    try {
        // Show loading state
        const loadingToast = showLoadingToast('Capturing evidence...');
        
        // Extract tweet content
        const tweetData = await extractTweetData(tweetElement, screenName);
        
        // Get current timestamp
        const captureTime = new Date().toISOString();
        
        // Create canvas with evidence
        const canvas = await createEvidenceCanvas({
            ...tweetData,
            screenName,
            location: userInfo?.location || 'Unknown',
            device: userInfo?.device || 'Unknown',
            locationAccurate: userInfo?.locationAccurate,
            captureTime,
            version: VERSION
        });
        
        // Remove loading toast
        loadingToast.remove();
        
        // Open the share sheet (preview + caption + quote/reply/post)
        showShareSheet(canvas, {
            screenName,
            tweetUrl: tweetData.tweetUrl,
            location: userInfo?.location
        });
        
    } catch (error) {
        console.error('X-Posed: Evidence capture failed:', error);
        showErrorNotification('Failed to capture evidence: ' + error.message);
    }
}

/**
 * Show loading toast using safe DOM methods
 */
function showLoadingToast(message) {
    const toast = document.createElement('div');
    toast.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        background: rgba(13, 15, 18, 0.96);
        border-left: 3px solid #22D3EE;
        color: white;
        padding: 12px 20px;
        border-radius: 8px;
        font-family: -apple-system, BlinkMacSystemFont, sans-serif;
        font-size: 14px;
        z-index: ${Z_INDEX.TOAST};
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        display: flex;
        align-items: center;
        gap: 10px;
    `;
    
    // Create spinner using safe DOM methods
    const spinner = document.createElement('div');
    spinner.style.cssText = 'width: 16px; height: 16px; border: 2px solid white; border-top-color: transparent; border-radius: 50%; animation: x-spin 1s linear infinite;';
    
    // Create text node for message (safe)
    const messageText = document.createTextNode(message);
    
    toast.appendChild(spinner);
    toast.appendChild(messageText);
    
    // Add keyframes if not exists
    if (!document.getElementById('x-evidence-keyframes')) {
        const style = document.createElement('style');
        style.id = 'x-evidence-keyframes';
        style.textContent = '@keyframes x-spin { to { transform: rotate(360deg); } }';
        (document.head || document.documentElement).appendChild(style);
    }
    
    document.body.appendChild(toast);
    return toast;
}

/**
 * Extract data from tweet element
 */
async function extractTweetData(tweetElement, screenName) {
    // Get display name
    let displayName = screenName;
    const nameEl = tweetElement.querySelector('[data-testid="User-Name"] a[role="link"] span span');
    if (nameEl) {
        displayName = nameEl.textContent || screenName;
    }
    
    // Get profile image URL
    let profileImageUrl = null;
    const avatarImg = tweetElement.querySelector('[data-testid="Tweet-User-Avatar"] img');
    if (avatarImg) {
        profileImageUrl = avatarImg.src;
    }
    
    // Get tweet text
    let tweetText = '';
    const tweetTextEl = tweetElement.querySelector('[data-testid="tweetText"]');
    if (tweetTextEl) {
        tweetText = tweetTextEl.textContent || '';
    }
    
    // Get timestamp
    let timestamp = '';
    const timeEl = tweetElement.querySelector('time');
    if (timeEl) {
        timestamp = timeEl.getAttribute('datetime') || timeEl.textContent || '';
    }
    
    // Get tweet URL
    let tweetUrl = window.location.href;
    const timeLink = tweetElement.querySelector('a[href*="/status/"] time')?.closest('a');
    if (timeLink) {
        tweetUrl = 'https://x.com' + timeLink.getAttribute('href');
    } else {
        const statusLink = tweetElement.querySelector('a[href*="/status/"]');
        if (statusLink) {
            const href = statusLink.getAttribute('href');
            if (href.includes('/status/')) {
                tweetUrl = 'https://x.com' + href;
            }
        }
    }
    
    // Get attached media
    const mediaUrls = [];
    const mediaImages = tweetElement.querySelectorAll('[data-testid="tweetPhoto"] img');
    mediaImages.forEach(img => {
        if (img.src && !img.src.includes('emoji')) {
            mediaUrls.push(img.src);
        }
    });
    
    // Get metrics (likes, retweets, etc.)
    const metrics = {
        replies: getMetricValue(tweetElement, '[data-testid="reply"]'),
        retweets: getMetricValue(tweetElement, '[data-testid="retweet"]'),
        likes: getMetricValue(tweetElement, '[data-testid="like"]'),
        views: getMetricValue(tweetElement, 'a[href*="/analytics"]')
    };
    
    return {
        displayName,
        profileImageUrl,
        tweetText,
        timestamp,
        tweetUrl,
        mediaUrls,
        metrics
    };
}

/**
 * Get metric value from button
 */
function getMetricValue(element, selector) {
    const btn = element.querySelector(selector);
    if (btn) {
        const text = btn.textContent.trim();
        if (text && text !== '0' && text !== '') {
            return text;
        }
    }
    return null;
}

/**
 * Load image and return it
 */
function loadImage(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Failed to load image'));
        img.src = src;
    });
}

/**
 * Create evidence canvas with all data
 */
async function createEvidenceCanvas(data) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    // Theme-aware palette - matches the "glass" design tokens
    const theme = document.documentElement.getAttribute('data-x-theme') === 'light' ? 'light' : 'dark';
    const PAL = theme === 'light'
        ? { bg: '#FBFDFE', panel: '#F1F5F8', text: '#0C1A22', dim: '#5A6B78', border: '#D8E0E6', accent: '#0E7490', danger: '#DC2640' }
        : { bg: '#0B0D10', panel: '#14171C', text: '#E9EDF0', dim: '#8A93A0', border: '#2A2F36', accent: '#22D3EE', danger: '#FF4D5E' };

    // 24x24-viewBox vector icon path data (matches the extension SVG icon set).
    // Each icon is an array of { d, fill? } sub-paths (fill:true => fill, else stroke).
    const ICONS = {
        location: [
            { d: 'M12 21s-6-5.3-6-10a6 6 0 1 1 12 0c0 4.7-6 10-6 10z' },
            { d: 'M12 11 m-2.2 0 a2.2 2.2 0 1 0 4.4 0 a2.2 2.2 0 1 0 -4.4 0' }
        ],
        vpn: [
            { d: 'M12 3l7 3v5c0 4.4-3 8-7 10-4-2-7-5.6-7-10V6z' },
            { d: 'M9.5 12l1.8 1.8L15 9.8' }
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
            profileImg = await loadImage(data.profileImageUrl);
        } catch (e) {
            console.warn('Could not load profile image');
        }
    }
    
    // Load first media image if exists
    let mediaImg = null;
    if (data.mediaUrls && data.mediaUrls.length > 0) {
        try {
            mediaImg = await loadImage(data.mediaUrls[0]);
        } catch (e) {
            console.warn('Could not load media image');
        }
    }
    
    // Calculate content height
    const tempCanvas = document.createElement('canvas');
    const tempCtx = tempCanvas.getContext('2d');
    const tweetLines = wrapText(tempCtx, data.tweetText, width - padding * 2 - 70, '15px -apple-system, sans-serif');
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

    // Outer glow effect (accent tint)
    ctx.shadowColor = PAL.accent;
    ctx.shadowBlur = 20;
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
        ctx.font = 'bold 18px -apple-system, BlinkMacSystemFont, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(data.screenName.charAt(0).toUpperCase(), padding + 22, y + 28);
        ctx.textAlign = 'left';
    }
    
    // Display name - larger and bolder
    ctx.fillStyle = PAL.text;
    ctx.font = 'bold 16px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.fillText(truncateText(ctx, data.displayName, 220), padding + 60, y + 20);

    // Username - better spacing
    ctx.fillStyle = PAL.dim;
    ctx.font = '14px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    const userStr = `@${data.screenName}`;
    ctx.fillText(userStr, padding + 60, y + 42);
    
    y += headerHeight;
    
    // === TWEET TEXT ===
    ctx.fillStyle = PAL.text;
    ctx.font = '16px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

    for (const line of tweetLines) {
        ctx.fillText(line, padding, y + 18);
        y += lineHeight;
    }

    if (tweetLines.length === 0) {
        ctx.fillStyle = PAL.dim;
        ctx.font = 'italic 15px -apple-system, "Segoe UI", sans-serif';
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
    ctx.font = '14px -apple-system, "Segoe UI", sans-serif';
    
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
    
    // === DIVIDER WITH GRADIENT ===
    const gradient = ctx.createLinearGradient(padding, y, width - padding, y);
    gradient.addColorStop(0, hexToRgba(PAL.accent, 0.4));
    gradient.addColorStop(0.5, hexToRgba(PAL.accent, 0.7));
    gradient.addColorStop(1, hexToRgba(PAL.accent, 0.4));
    ctx.strokeStyle = gradient;
    ctx.lineWidth = 2;
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
    ctx.strokeStyle = hexToRgba(PAL.accent, 0.15);
    ctx.lineWidth = 1;
    roundRect(ctx, padding - 8, y - 8, width - padding * 2 + 16, metadataHeight - 15, 10);
    ctx.stroke();

    // Header - larger and more prominent
    drawIcon(ctx, ICONS.camera, padding + 4, y + 2, 14, PAL.accent);
    ctx.fillStyle = PAL.accent;
    ctx.font = 'bold 12px -apple-system, "Segoe UI", sans-serif';
    ctx.fillText('X-POSED EVIDENCE CAPTURE', padding + 24, y + 14);
    
    y += 32;
    
    // Metadata rows - improved spacing and typography
    const labelX = padding + 4;
    const valueX = padding + 110;
    const rowHeight = 26;
    
    // Location row
    drawIcon(ctx, ICONS.location, labelX, y + 3, 16, PAL.accent);
    ctx.font = '14px -apple-system, "Segoe UI", sans-serif';
    ctx.fillStyle = PAL.dim;
    ctx.fillText('Location', labelX + 22, y + 16);

    const countryCode = getCountryCode(data.location);
    const isVpn = data.locationAccurate === false;

    // Location value with country code
    ctx.fillStyle = PAL.text;
    ctx.font = '600 14px -apple-system, "Segoe UI", sans-serif';
    ctx.fillText(data.location, valueX, y + 16);

    // Country code badge - improved styling
    const locWidth = ctx.measureText(data.location).width;
    ctx.fillStyle = hexToRgba(PAL.accent, 0.15);
    const codeText = `${countryCode}`;
    ctx.font = 'bold 11px -apple-system, "Segoe UI", sans-serif';
    const codeWidth = ctx.measureText(codeText).width + 10;
    roundRect(ctx, valueX + locWidth + 10, y + 3, codeWidth, 18, 4);
    ctx.fill();
    ctx.fillStyle = PAL.accent;
    ctx.fillText(codeText, valueX + locWidth + 15, y + 16);

    // VPN indicator - VERY prominent warning box
    if (isVpn) {
        const vpnX = valueX + locWidth + 10 + codeWidth + 12;

        // Draw VPN warning box - larger and more visible
        ctx.fillStyle = hexToRgba(PAL.danger, 0.15);
        roundRect(ctx, vpnX - 6, y + 1, 105, 22, 5);
        ctx.fill();
        ctx.strokeStyle = PAL.danger;
        ctx.lineWidth = 1.5;
        roundRect(ctx, vpnX - 6, y + 1, 105, 22, 5);
        ctx.stroke();

        // VPN text with shield warning icon
        drawIcon(ctx, ICONS.vpn, vpnX + 2, y + 4, 15, PAL.danger, { lineWidth: 1.6 });
        ctx.fillStyle = PAL.danger;
        ctx.font = 'bold 11px -apple-system, "Segoe UI", sans-serif';
        ctx.fillText('VPN / PROXY', vpnX + 20, y + 16);
    }

    y += rowHeight;

    // Device row
    drawIcon(ctx, deviceIconFor(data.device), labelX, y + 3, 16, PAL.accent);
    ctx.font = '14px -apple-system, "Segoe UI", sans-serif';
    ctx.fillStyle = PAL.dim;
    ctx.fillText('Device', labelX + 22, y + 16);
    ctx.fillStyle = PAL.text;
    ctx.font = '600 14px -apple-system, "Segoe UI", sans-serif';
    ctx.fillText(data.device || 'Unknown', valueX, y + 16);

    y += rowHeight;

    // Capture time row
    const captureDate = new Date(data.captureTime);
    const dateStr = captureDate.toISOString().replace('T', '  ').substring(0, 21) + ' UTC';

    drawIcon(ctx, ICONS.date, labelX, y + 3, 16, PAL.accent);
    ctx.font = '14px -apple-system, "Segoe UI", sans-serif';
    ctx.fillStyle = PAL.dim;
    ctx.fillText('Captured', labelX + 22, y + 16);
    ctx.fillStyle = PAL.text;
    ctx.font = '600 14px -apple-system, "Segoe UI", sans-serif';
    ctx.fillText(dateStr, valueX, y + 16);

    y += rowHeight;

    // URL row
    drawIcon(ctx, ICONS.link, labelX, y + 3, 16, PAL.accent);
    ctx.font = '14px -apple-system, "Segoe UI", sans-serif';
    ctx.fillStyle = PAL.dim;
    ctx.fillText('Source', labelX + 22, y + 16);
    ctx.fillStyle = PAL.accent;
    ctx.font = '13px -apple-system, "Segoe UI", sans-serif';
    const shortUrl = data.tweetUrl.replace('https://x.com/', 'x.com/');
    ctx.fillText(truncateText(ctx, shortUrl, width - valueX - padding - 20), valueX, y + 16);

    y += rowHeight + 10;

    // Footer - subtle branding
    ctx.fillStyle = PAL.dim;
    ctx.font = '11px -apple-system, "Segoe UI", sans-serif';
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

function statusIdFromUrl(url) {
    const m = /\/status\/(\d+)/.exec(url || '');
    return m ? m[1] : null;
}

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
        ? `This account posts from ${where}. (via X-Posed)`
        : 'Where this account actually posts from. (via X-Posed)';
}

/**
 * Show the share sheet: preview the evidence image, edit a caption, and post it to
 * X as a quote / reply / new post (or copy / save). Replaces the old save-only
 * evidence modal; the capture engine (createEvidenceCanvas) is reused unchanged.
 */
function showShareSheet(canvas, info) {
    document.querySelector('.x-share-overlay')?.remove();

    const ce = (tag, cls, txt) => {
        const n = document.createElement(tag);
        if (cls) n.className = cls;
        if (typeof txt === 'string') n.textContent = txt;
        return n;
    };

    const statusId = statusIdFromUrl(info.tweetUrl);
    const filename = generateFilename(info.screenName);

    const overlay = ce('div', 'x-share-overlay');
    const sheet = ce('div', 'x-share-sheet');
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-label', 'Share evidence');
    sheet.appendChild(ce('div', 'x-share-scan'));
    const pad = ce('div', 'x-share-pad');

    // header
    const head = ce('div', 'x-share-head');
    const hico = ce('div', 'x-share-ico');
    hico.appendChild(glyph('shield', 17));
    const htitle = ce('div', 'x-share-title', 'Share evidence');
    htitle.appendChild(ce('small', null, 'Quote · reply · post'));
    const closeBtn = ce('button', 'x-share-close');
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.appendChild(glyph('close', 16));
    head.appendChild(hico);
    head.appendChild(htitle);
    head.appendChild(closeBtn);

    // evidence preview (click to enlarge)
    const preview = ce('div', 'x-share-preview');
    preview.title = 'Click to enlarge';
    const img = ce('img');
    img.src = canvas.toDataURL('image/png');
    img.alt = 'Evidence';
    preview.appendChild(img);
    const zoomHint = ce('span', 'x-share-zoomhint');
    zoomHint.appendChild(glyph('zoom', 15));
    preview.appendChild(zoomHint);
    preview.addEventListener('click', () => {
        const zoom = ce('div', 'x-share-zoom');
        const big = ce('img');
        big.src = canvas.toDataURL('image/png');
        big.alt = 'Evidence';
        zoom.appendChild(big);
        zoom.addEventListener('click', () => zoom.remove());
        document.body.appendChild(zoom);
    });

    // caption
    const capWrap = ce('div', 'x-share-capwrap');
    const cap = ce('textarea', 'x-share-cap');
    cap.maxLength = 280;
    cap.value = defaultCaption(info.location);
    const count = ce('span', 'x-share-count');
    const updCount = () => { count.textContent = cap.value.length + '/280'; };
    cap.addEventListener('input', updCount);
    updCount();
    capWrap.appendChild(cap);
    capWrap.appendChild(count);

    // modes
    const modeWrap = ce('div', 'x-share-modes');
    modeWrap.appendChild(ce('span', 'x-share-modelbl', 'Share as'));
    const seg = ce('div', 'x-share-seg');
    seg.appendChild(ce('span', 'x-share-pill'));
    const MODES = [
        { key: 'quote', ico: 'swap', mt: 'Quote', ms: 'your timeline', desc: 'Posts to your timeline with their tweet embedded.' },
        { key: 'reply', ico: 'reply', mt: 'Reply', ms: 'under post', desc: 'Replies directly under their post — they get notified.' },
        { key: 'post', ico: 'plus', mt: 'New post', ms: 'mention them', desc: 'A fresh post on your timeline mentioning the account.' }
    ];
    const desc = ce('div', 'x-share-desc');
    const btns = [];
    let mode = MODES.some(m => m.key === lastShareMode) ? lastShareMode : 'quote';
    const selectMode = (key, i) => {
        mode = key;
        lastShareMode = key;
        seg.style.setProperty('--i', String(i));
        btns.forEach((b, j) => b.setAttribute('aria-selected', j === i ? 'true' : 'false'));
        desc.textContent = MODES[i].desc;
    };
    MODES.forEach((m, i) => {
        const b = ce('button');
        b.type = 'button';
        b.appendChild(glyph(m.ico, 15));
        b.appendChild(ce('span', 'x-share-mt', m.mt));
        b.appendChild(ce('span', 'x-share-ms', m.ms));
        b.addEventListener('click', () => selectMode(m.key, i));
        btns.push(b);
        seg.appendChild(b);
    });
    modeWrap.appendChild(seg);
    modeWrap.appendChild(desc);
    selectMode(mode, MODES.findIndex(m => m.key === mode));

    // actions
    const actions = ce('div', 'x-share-actions');
    const shareBtn = ce('button', 'x-share-primary');
    shareBtn.type = 'button';
    shareBtn.appendChild(glyph('xLogo', 17));
    shareBtn.appendChild(ce('span', null, 'Share on X'));
    const copyBtn = ce('button', 'x-share-ghost');
    copyBtn.type = 'button';
    copyBtn.title = 'Copy image';
    copyBtn.appendChild(glyph('copy', 17));
    const saveBtn = ce('button', 'x-share-ghost');
    saveBtn.type = 'button';
    saveBtn.title = 'Save PNG';
    saveBtn.appendChild(glyph('save', 17));
    actions.appendChild(shareBtn);
    actions.appendChild(copyBtn);
    actions.appendChild(saveBtn);

    const hedge = ce('p', 'x-share-hedge', TOUCH
        ? 'Share attaches the image to your X post via your phone’s share sheet. Location may be approximate.'
        : 'Share copies the evidence to your clipboard and opens X. Paste it (Ctrl/⌘+V), then post. Location may be approximate.');

    // Two-column body on PC (preview | controls); stacks on mobile.
    const sbody = ce('div', 'x-share-body');
    const side = ce('div', 'x-share-side');
    side.appendChild(ce('span', 'x-share-caplbl', 'Caption'));
    side.appendChild(capWrap);
    side.appendChild(modeWrap);
    side.appendChild(actions);
    sbody.appendChild(preview);
    sbody.appendChild(side);

    pad.appendChild(head);
    pad.appendChild(sbody);
    pad.appendChild(hedge);
    sheet.appendChild(pad);
    overlay.appendChild(sheet);

    const close = () => {
        overlay.remove();
        document.querySelector('.x-share-zoom')?.remove();
        document.removeEventListener('keydown', onKey);
    };
    function onKey(e) {
        if (e.key === 'Escape') {
            // Escape closes the zoom overlay first (if open), then the sheet.
            const zoom = document.querySelector('.x-share-zoom');
            if (zoom) { zoom.remove(); return; }
            close();
        } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); doShare(); }
    }
    closeBtn.onclick = close;
    overlay.onclick = e => { if (e.target === overlay) close(); };
    document.addEventListener('keydown', onKey);

    // Save the rendered evidence PNG (shared by the Save button and the mobile fallback).
    const saveImage = () => {
        const link = document.createElement('a');
        link.download = filename;
        link.href = canvas.toDataURL('image/png');
        link.click();
    };

    // The flow runs synchronously inside the click so window.open / share / clipboard
    // all keep the user-gesture activation.
    function doShare() {
        const caption = cap.value;
        const blob = dataUrlToBlob(canvas.toDataURL('image/png'));

        if (TOUCH) {
            const file = new File([blob], 'x-posed-evidence.png', { type: 'image/png' });
            if (navigator.canShare && navigator.canShare({ files: [file] })) {
                close();
                navigator.share({ files: [file], text: caption + (info.tweetUrl ? ' ' + info.tweetUrl : '') })
                    .catch(err => {
                        if (err && err.name === 'AbortError') return; // user cancelled — no fallback needed
                        // A real share failure — save the image so the user still has a path.
                        saveImage();
                        showToast({ title: 'Share failed — image saved', message: `${filename} — attach it to your post.`, icon: glyph('save', 20), iconType: 'warning', duration: 7000 });
                    });
                return;
            }
            // No file-level Web Share here, and mobile browsers usually block clipboard
            // image writes too — so save the PNG to attach manually rather than pretend.
            close();
            saveImage();
            showToast({ title: 'Image saved', message: `${filename} — attach it to your X post.`, icon: glyph('save', 20), iconType: 'info', duration: 7000 });
            return;
        }

        const clip = copyImage(blob);
        const win = window.open(buildIntentUrl(mode, caption, info.tweetUrl, statusId, info.screenName), '_blank');
        close();
        clip.then(copied => {
            if (win && copied) {
                // Composer opened AND the image really landed on the clipboard: flag the new
                // X tab so its content script reminds the user to paste. Set only on success
                // so a failed copy can't produce a misleading "Evidence is on your clipboard".
                try { browserAPI.storage.local.set({ xpPasteHint: Date.now() }); } catch (_) { /* ignore */ }
            } else if (!win) {
                // Pop-up blocked: the composer never opened — surface status in this tab.
                showToast({
                    title: 'Pop-up blocked',
                    message: copied
                        ? 'Your evidence is copied — open a post and paste it (Ctrl/⌘+V).'
                        : 'Allow pop-ups for x.com, or use Save to attach the image.',
                    icon: glyph('warn', 20),
                    iconType: 'warning',
                    duration: 9000
                });
            }
            // win && !copied: composer opened but the clipboard write failed — no hint flag
            // (nothing to paste); the user can fall back to Save.
        });
    }

    shareBtn.onclick = doShare;
    copyBtn.onclick = () => {
        const blob = dataUrlToBlob(canvas.toDataURL('image/png'));
        copyImage(blob).then(ok => showToast({
            title: ok ? 'Image copied' : 'Copy unavailable',
            message: ok ? 'Paste it into a post, DM, or anywhere.' : 'Your browser blocked image copy — use Save.',
            icon: glyph(ok ? 'copy' : 'warn', 20),
            iconType: ok ? 'success' : 'warning',
            duration: 4000
        }));
    };
    saveBtn.onclick = () => {
        saveImage();
        showToast({ title: 'Saved evidence PNG', message: filename, icon: glyph('check', 20), iconType: 'success', duration: 4000 });
    };

    document.body.appendChild(overlay);
    setTimeout(() => cap.focus(), 60);
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
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        background: #f4212e;
        color: white;
        padding: 12px 20px;
        border-radius: 8px;
        font-family: -apple-system, BlinkMacSystemFont, sans-serif;
        font-size: 14px;
        z-index: ${Z_INDEX.TOAST};
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    `;
    notification.textContent = message;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.style.opacity = '0';
        notification.style.transition = 'opacity 0.3s';
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}