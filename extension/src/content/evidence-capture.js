/**
 * Evidence Screenshot Generator
 * Captures tweets with metadata overlay for researchers and journalists
 * Uses native Canvas API with image loading for profile pics and media
 */

import { VERSION, Z_INDEX } from '../shared/constants.js';
import { getCountryCode } from '../shared/utils.js';

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
        
        // Show preview modal
        showEvidencePreview(canvas, {
            screenName,
            captureTime,
            tweetUrl: tweetData.tweetUrl
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

    // Pick a device icon based on the device string.
    function deviceIconFor(device) {
        const d = (device || '').toLowerCase();
        if (d.includes('app store') || d.includes('iphone') || d.includes('ipad') || d.includes('ios') || d.includes('mac')) {
            return ICONS.apple;
        }
        if (d.includes('android')) {
            return ICONS.android;
        }
        return ICONS.web;
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

/**
 * Show evidence preview modal
 */
function showEvidencePreview(canvas, info) {
    // Remove existing modal if any
    const existingModal = document.querySelector('.x-evidence-modal-overlay');
    if (existingModal) existingModal.remove();
    
    // Create overlay
    const overlay = document.createElement('div');
    overlay.className = 'x-evidence-modal-overlay';
    
    // Create modal
    const modal = document.createElement('div');
    modal.className = 'x-evidence-modal';
    
    // Header - using safe DOM methods
    const header = document.createElement('div');
    header.className = 'x-evidence-header';
    
    // Create title
    const title = document.createElement('h2');
    title.className = 'x-evidence-title';
    
    const titleIcon = document.createElement('span');
    titleIcon.style.marginRight = '8px';
    titleIcon.textContent = '📸';
    title.appendChild(titleIcon);
    title.appendChild(document.createTextNode('Evidence Captured'));
    
    // Create close button
    const closeBtn = document.createElement('button');
    closeBtn.className = 'x-evidence-close';
    closeBtn.setAttribute('aria-label', 'Close');
    
    const closeSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    closeSvg.setAttribute('viewBox', '0 0 24 24');
    closeSvg.setAttribute('width', '20');
    closeSvg.setAttribute('height', '20');
    
    const closePath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    closePath.setAttribute('fill', 'currentColor');
    closePath.setAttribute('d', 'M10.59 12L4.54 5.96l1.42-1.42L12 10.59l6.04-6.05 1.42 1.42L13.41 12l6.05 6.04-1.42 1.42L12 13.41l-6.04 6.05-1.42-1.42L10.59 12z');
    closeSvg.appendChild(closePath);
    closeBtn.appendChild(closeSvg);
    
    header.appendChild(title);
    header.appendChild(closeBtn);
    
    // Body with preview
    const body = document.createElement('div');
    body.className = 'x-evidence-body';
    
    const preview = document.createElement('div');
    preview.className = 'x-evidence-preview';
    
    // Convert canvas to image for preview
    const img = document.createElement('img');
    img.src = canvas.toDataURL('image/png');
    img.alt = 'Evidence screenshot';
    preview.appendChild(img);
    
    body.appendChild(preview);
    
    // Footer with actions
    const footer = document.createElement('div');
    footer.className = 'x-evidence-footer';
    
    // Filename preview
    const filename = generateFilename(info.screenName);
    const filenameDiv = document.createElement('div');
    filenameDiv.className = 'x-evidence-filename';
    filenameDiv.textContent = filename;
    
    // Button container - only save button
    const buttonContainer = document.createElement('div');
    buttonContainer.className = 'x-evidence-buttons';
    
    const saveBtn = document.createElement('button');
    saveBtn.className = 'x-evidence-btn x-evidence-btn-primary';
    saveBtn.title = 'Save image (Enter)';
    
    // Helper to set save button content safely without innerHTML
    const setSaveBtnContent = (isSaved = false) => {
        saveBtn.replaceChildren();
        if (isSaved) {
            saveBtn.textContent = '✓ Saved!';
        } else {
            saveBtn.appendChild(document.createTextNode('💾 Save as PNG '));
            const kbd = document.createElement('kbd');
            kbd.style.cssText = 'opacity:0.7;font-size:11px;margin-left:4px';
            kbd.textContent = '↵';
            saveBtn.appendChild(kbd);
        }
    };
    
    // Set initial content
    setSaveBtnContent(false);
    
    const performSave = () => {
        const link = document.createElement('a');
        link.download = filename;
        link.href = canvas.toDataURL('image/png');
        link.click();
        
        setSaveBtnContent(true);
        saveBtn.style.background = '#00ba7c';
        setTimeout(() => {
            setSaveBtnContent(false);
            saveBtn.style.background = '';
        }, 2000);
    };
    
    saveBtn.onclick = performSave;
    
    buttonContainer.appendChild(saveBtn);
    
    footer.appendChild(filenameDiv);
    footer.appendChild(buttonContainer);
    
    // Assemble modal
    modal.appendChild(header);
    modal.appendChild(body);
    modal.appendChild(footer);
    overlay.appendChild(modal);
    
    // Event listeners
    closeBtn.onclick = () => overlay.remove();
    overlay.onclick = e => {
        if (e.target === overlay) overlay.remove();
    };
    
    // Keyboard shortcuts: Escape to close, Enter to save
    const keyHandler = e => {
        if (e.key === 'Escape') {
            overlay.remove();
            document.removeEventListener('keydown', keyHandler);
        } else if (e.key === 'Enter') {
            e.preventDefault();
            performSave();
        }
    };
    document.addEventListener('keydown', keyHandler);
    
    // Add to page
    document.body.appendChild(overlay);
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