/**
 * Full settings page. Blocking shares the same Graphite editor as the on-X dialog.
 * All writes use the existing background API and revisioned snapshots.
 */
import browserAPI from '../shared/browser-api.js';
import { MESSAGE_TYPES, VERSION, STORAGE_KEYS, TIMING, CACHE_CONFIG } from '../shared/constants.js';
import { dialogIcon } from '../content/dialog-icons.js';
import { deviceIcon, flagImage, glyph } from '../content/icons.js';
import { BADGE_SIZES, normalizeBadgeSize, applyBadgeAppearance } from '../shared/badge-appearance.js';
import { mountStatistics } from './statistics.js';
import { mountBlockingSettings } from '../content/graphite-dialog.js';
import { createSnapshotTracker } from '../shared/state-sync.js';
import { FILTER_SOURCES } from '../shared/filter-registry.js';
import { BACKUP_FORMAT, prepareBackupImport } from '../shared/backup.js';

const TOGGLES = [
    ['opt-enabled', 'enabled', true],
    ['opt-debug', 'debugMode', false],
    ['opt-badge-background', 'showBadgeBackground', true],
    ['opt-flags', 'showFlags', true],
    ['opt-devices', 'showDevices', true],
    ['opt-vpn', 'showVpnIndicator', true],
    ['opt-capture-button', 'showCaptureButton', true],
    ['opt-info-icon', 'showInfoIcon', true],
    ['opt-click-details', 'hovercardTrigger', 'hover'],
    ['opt-sidebar-link', 'showSidebarBlockerLink', true],
    ['opt-changelog-on-update', 'openChangelogOnUpdate', true]
];

// Presentation order and copy stay local; storage and messaging identifiers are shared.
const LISTS = Object.entries({
    countries: 'country filters', regions: 'region filters', tags: 'display-name filters',
    bioTags: 'bio-text filters', links: 'domain and URL filters', pcf: 'account-label filters',
    languages: 'post-language filters', affiliations: 'organization filters', allowedUsers: 'always-show accounts'
}).map(([kind, label]) => ({ ...FILTER_SOURCES.find(source => source.kind === kind), label }));

const elements = Object.fromEntries(Object.entries({
    optBadgeSize: 'opt-badge-size',
    badgePreviewExample: 'badge-preview-example',
    badgePreviewBadge: 'badge-preview-badge',
    badgePreviewDescription: 'badge-preview-description',
    optCloudCache: 'opt-cloud-cache',
    cloudStatusIndicator: 'cloud-status-indicator',
    cloudStatusText: 'cloud-status-text',
    cloudStats: 'cloud-stats',
    cloudTotalEntries: 'cloud-total-entries',
    cloudLookups: 'cloud-lookups',
    cloudHits: 'cloud-hits',
    cloudContributions: 'cloud-contributions',
    cloudUnconfigured: 'cloud-unconfigured',
    cloudActions: 'cloud-actions',
    btnSyncToCloud: 'btn-sync-to-cloud',
    syncStatus: 'sync-status',
    rateLimitBanner: 'rate-limit-banner',
    rateLimitTime: 'rate-limit-time',
    cacheSize: 'cache-size',
    btnClearCache: 'btn-clear-cache',
    btnExportCache: 'btn-export-cache',
    btnImportData: 'btn-import-data',
    importFileInput: 'import-file-input',
    importStatus: 'import-status',
    version: 'version',
    saveStatus: 'save-status'
}).map(([key, id]) => [key, document.getElementById(id)]));

let currentSettings = {};
let settingsLoaded = false;
let blockingEditor = null;
let pendingReleaseNavigation = null;
let statisticsView = null;
let cloudEnabled = false;
let saveStatusTimeout = null;
let rateLimitMonitorInterval = null;
const listState = Object.fromEntries(LISTS.map(source => [source.field, []]));
const snapshots = createSnapshotTracker();

async function initialize() {
    for (const slot of document.querySelectorAll('[data-settings-icon]')) {
        slot.replaceChildren(dialogIcon(slot.dataset.settingsIcon, 20));
    }
    elements.version.textContent = VERSION;
    for (const label of document.querySelectorAll('[data-release-version]')) label.textContent = VERSION;
    const cacheDays = Math.round(CACHE_CONFIG.EXPIRY_MS / (24 * 60 * 60 * 1000));
    document.getElementById('cache-expiry').textContent = `Up to ${cacheDays} days`;
    for (const [id] of TOGGLES) document.getElementById(id).disabled = true;
    elements.optBadgeSize.disabled = true;
    elements.optCloudCache.disabled = true;
    setupNav();
    setupEventListeners();
    browserAPI.runtime.onMessage.addListener(handleMessage);
    window.addEventListener('beforeunload', () => {
        browserAPI.runtime.onMessage.removeListener(handleMessage);
        pendingReleaseNavigation = null;
        blockingEditor?.destroy();
        statisticsView?.destroy();
        clearTimeout(saveStatusTimeout);
    });

    // The page is usable before slow status requests finish.
    void loadTheme();
    void checkWhatsNew();
    void watchCloudStats();
    void loadCacheStats();
    window.addEventListener('focus', () => {
        if (document.getElementById('panel-stats')?.classList.contains('active')) void loadStatistics();
    });
    void loadCloudCacheStatus();
    void loadRateLimitStatus();
    startRateLimitMonitor();
    await loadConfiguration();
}

function setupNav() {
    const items = [...document.querySelectorAll('.xp-nav-item[data-target]')];
    const panels = [...document.querySelectorAll('.xp-panel')];
    const showPanel = target => {
        // A later click or browser-history navigation supersedes any release
        // shortcut waiting for the asynchronous settings editor to be ready.
        pendingReleaseNavigation = null;
        for (const panel of panels) {
            const active = panel.id === target;
            panel.classList.toggle('active', active);
            panel.hidden = !active;
        }
        for (const item of items) {
            const active = item.dataset.target === target;
            item.classList.toggle('active', active);
            if (active) item.setAttribute('aria-current', 'page');
            else item.removeAttribute('aria-current');
            item.setAttribute('aria-controls', item.dataset.target);
        }
        if (target === 'panel-stats') void loadStatistics();
    };
    // Toolbar shortcuts open the existing section, never a separate editor.
    const showHashPanel = () => {
        const target = window.location.hash.slice(1);
        showPanel(items.some(item => item.dataset.target === target) ? target : 'panel-general');
    };
    showHashPanel();
    window.addEventListener('hashchange', showHashPanel);
    const shortcuts = [...document.querySelectorAll('.xp-nav-support[data-target], .whats-new-open[data-target]')];
    for (const item of [...items, ...shortcuts]) {
        item.addEventListener('click', event => {
            event.preventDefault();
            if (item.classList.contains('whats-new-open')) document.getElementById('whats-new-close')?.click();
            showPanel(item.dataset.target);
            const url = new URL(window.location.href);
            url.hash = item.dataset.target;
            window.history.replaceState({}, document.title, url);
            window.scrollTo({ top: 0, behavior: 'auto' });
            if (item.classList.contains('whats-new-open')) {
                const { target, blockingTab, blockingEditor: editor, focusId } = item.dataset;
                if (target === 'panel-blocking' && (blockingTab === 'allowed' ||
                    (blockingTab === 'behavior' && focusId === 'x-g-behavior-hideRelatedPosts') ||
                    (blockingTab === 'add' && ['accountCounts', 'regions'].includes(editor)))) {
                    pendingReleaseNavigation = { target, tab: blockingTab, editor: blockingTab === 'add' ? editor : null, focusId };
                } else if (target === 'panel-display' && focusId === 'opt-badge-size') {
                    pendingReleaseNavigation = { target, focusId };
                }
                if (applyPendingReleaseNavigation()) return;
                const heading = document.getElementById(item.dataset.target)?.querySelector('.section-title, .xp-g-title');
                if (heading) {
                    heading.tabIndex = -1;
                    heading.focus({ preventScroll: true });
                }
            }
        });
    }
}

/** Open an existing settings destination without selecting or saving a preference. */
function applyPendingReleaseNavigation() {
    const destination = pendingReleaseNavigation;
    if (!destination) return false;
    if (!document.getElementById(destination.target)?.classList.contains('active')) {
        pendingReleaseNavigation = null;
        return false;
    }
    if (destination.tab) {
        if (!blockingEditor) return false;
        pendingReleaseNavigation = null;
        blockingEditor.navigate(destination.tab, destination.editor);
        if (destination.focusId) document.getElementById(destination.focusId)?.focus({ preventScroll: true });
        return true;
    }
    const control = document.getElementById(destination.focusId);
    if (!control || control.disabled) return false;
    pendingReleaseNavigation = null;
    control.focus({ preventScroll: true });
    return true;
}

function applySettingsToInputs() {
    for (const [id, key, fallback] of TOGGLES) {
        const input = document.getElementById(id);
        input.checked = key === 'hovercardTrigger'
            ? currentSettings[key] === 'click'
            : (currentSettings[key] ?? fallback) === true;
    }
    elements.optBadgeSize.value = normalizeBadgeSize(currentSettings.badgeSize);
    renderBadgePreview();
    blockingEditor?.updateSettings(currentSettings, snapshots.snapshot()[MESSAGE_TYPES.SETTINGS_UPDATED]);
}

/** Use the actual badge classes and artwork, without interactive controls or lookups. */
function renderBadgePreview(settings = currentSettings) {
    const badge = elements.badgePreviewBadge;
    const details = document.createElement('span');
    details.className = 'x-badge-details';
    const shown = [];
    const appendIcon = (parent, className, icon, description) => {
        const span = document.createElement('span');
        span.className = className;
        if (icon) span.append(icon);
        parent.append(span);
        if (description) shown.push(description);
    };
    if (settings.showFlags !== false) {
        appendIcon(details, 'x-flag', flagImage('Switzerland'), 'country');
    }
    if (settings.showDevices !== false) {
        appendIcon(details, 'x-device', deviceIcon('Switzerland App Store'), 'device');
    }
    // The live badge only shows a location warning alongside a visible country.
    if (settings.showFlags !== false && settings.showVpnIndicator !== false) {
        appendIcon(details, 'x-vpn', glyph('vpn', 13), 'location warning');
    }
    badge.replaceChildren(details);
    const hasContent = settings.showFlags !== false || settings.showDevices !== false;
    if (hasContent) {
        if (settings.showCaptureButton !== false) {
            appendIcon(badge, 'x-sep');
            appendIcon(badge, 'x-capture-btn', glyph('share', 14), 'share');
        }
        if (settings.showInfoIcon !== false) {
            if (settings.showCaptureButton === false) appendIcon(badge, 'x-sep');
            appendIcon(badge, 'x-hover-hint', glyph('info', 14), 'info');
        }
    }
    applyBadgeAppearance(badge, settings);
    badge.hidden = !hasContent;
    elements.badgePreviewExample.hidden = false;
    elements.badgePreviewDescription.textContent = hasContent
        ? 'Example account with a location warning.'
        : 'Enable country flags or device icons to show a badge.';
    const size = normalizeBadgeSize(settings.badgeSize);
    elements.badgePreviewExample.setAttribute('aria-label', hasContent
        ? `${size} badge, background ${settings.showBadgeBackground !== false ? 'on' : 'off'}: ${shown.join(', ')}.`
        : 'No badge. Country flags and device icons are disabled.');
}

function acceptSettings(data, revision) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return;
    if (!snapshots.accept(MESSAGE_TYPES.SETTINGS_UPDATED, revision)) return;
    currentSettings = data;
    settingsLoaded = true;
    applySettingsToInputs();
}

function acceptList(source, data, revision) {
    if (!Array.isArray(data) || !snapshots.accept(source.update, revision)) return;
    listState[source.field] = data;
    blockingEditor?.updateList(source.kind, data, revision);
}

function handleMessage(message) {
    if (message?.type === MESSAGE_TYPES.SETTINGS_UPDATED) {
        acceptSettings(message.payload, message.revision);
    } else if (message?.type === MESSAGE_TYPES.THEME_UPDATED && typeof message.payload === 'string') {
        applyTheme(message.payload);
    } else {
        const source = LISTS.find(item => item.update === message?.type);
        if (source) acceptList(source, message.payload, message.revision);
    }
}

async function loadConfiguration() {
    const host = document.getElementById('blocking-editor');
    if (!blockingEditor) {
        host.textContent = 'Loading your filters...';
        host.setAttribute('aria-busy', 'true');
    }
    try {
        const requests = [
            browserAPI.runtime.sendMessage({ type: MESSAGE_TYPES.GET_SETTINGS }).then(response => {
                if (!response?.success || !response.data || typeof response.data !== 'object' || Array.isArray(response.data)) {
                    throw new Error('Could not read settings');
                }
                acceptSettings(response.data, response.revision);
            }),
            ...LISTS.map(async source => {
                const response = await browserAPI.runtime.sendMessage({ type: source.get });
                if (!response?.success || !Array.isArray(response.data)) throw new Error(`Could not read ${source.label}`);
                acceptList(source, response.data, response.revision);
            })
        ];
        // Wait for all reads before offering a retry or creating an editable surface.
        const results = await Promise.allSettled(requests);
        if (results.some(result => result.status === 'rejected')) throw new Error('Incomplete settings snapshot');
        if (!blockingEditor) {
            host.replaceChildren();
            const callbacks = Object.fromEntries(LISTS.map(source => [
                source.callback, (action, value) => mutateList(source, action, value)
            ]));
            blockingEditor = mountBlockingSettings(host, {
                ...listState, settings: currentSettings, stateRevisions: snapshots.snapshot(),
                ...callbacks, onSettingsChange: saveSettings
            });
        }
        return true;
    } catch (error) {
        console.error('Failed to load settings:', error);
        if (!blockingEditor) {
            const message = document.createElement('p');
            message.textContent = 'Your filters could not be loaded. Nothing has been changed.';
            const retry = document.createElement('button');
            retry.type = 'button';
            retry.className = 'btn btn-secondary';
            retry.textContent = 'Try again';
            retry.addEventListener('click', () => { void loadConfiguration(); });
            host.replaceChildren(message, retry);
        }
        showSaveStatus('Could not load all settings. Please try again.', true);
        return false;
    } finally {
        host.removeAttribute('aria-busy');
        for (const [id] of TOGGLES) document.getElementById(id).disabled = !settingsLoaded;
        elements.optBadgeSize.disabled = !settingsLoaded;
        applyPendingReleaseNavigation();
    }
}

async function mutateList(source, action, value) {
    const response = await browserAPI.runtime.sendMessage({
        type: source.set, payload: { action, [source.valueKey]: value }
    });
    if (!response?.success || !Array.isArray(response.data)) return { success: false };
    acceptList(source, response.data, response.revision);
    return { success: true, data: listState[source.field], revision: snapshots.snapshot()[source.update] };
}

async function saveSettings(newSettings) {
    try {
        const response = await browserAPI.runtime.sendMessage({ type: MESSAGE_TYPES.SET_SETTINGS, payload: newSettings });
        if (!response?.success || !response.data || typeof response.data !== 'object' || Array.isArray(response.data)) {
            throw new Error('Save failed');
        }
        acceptSettings(response.data, response.revision);
        const regions = FILTER_SOURCES.find(source => source.kind === 'regions');
        if (Array.isArray(response.blockedRegions)) {
            acceptList(regions, response.blockedRegions, response.regionsRevision);
        }
        showSaveStatus();
        return {
            success: true, data: currentSettings, revision: snapshots.snapshot()[MESSAGE_TYPES.SETTINGS_UPDATED],
            ...(Array.isArray(response.blockedRegions) ? {
                blockedRegions: listState[regions.field], regionsRevision: snapshots.snapshot()[regions.update]
            } : {})
        };
    } catch (error) {
        console.error('Failed to save settings:', error);
        applySettingsToInputs();
        showSaveStatus('Could not save settings. Please try again.', true);
        return { success: false };
    }
}

function showSaveStatus(message = 'Settings saved', error = false) {
    const status = elements.saveStatus;
    clearTimeout(saveStatusTimeout);
    status.textContent = message;
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.classList.toggle('save-error', error);
    status.classList.add('visible');
    saveStatusTimeout = setTimeout(() => status.classList.remove('visible'), error ? 6000 : 2000);
}

async function watchCloudStats() {
    const showTotal = value => {
        const total = value?.data?.totalEntries;
        if (typeof total === 'number') elements.cloudTotalEntries.textContent = total.toLocaleString();
    };
    const onChanged = (changes, area) => {
        if (area !== 'local') return;
        showTotal(changes?.[STORAGE_KEYS.CLOUD_SERVER_STATS]?.newValue);
        if (changes?.[STORAGE_KEYS.THEME]?.newValue) applyTheme(changes[STORAGE_KEYS.THEME].newValue);
        if (changes?.[STORAGE_KEYS.CLOUD_CACHE_ENABLED]) {
            void loadCloudCacheStatus(changes[STORAGE_KEYS.CLOUD_CACHE_ENABLED].newValue);
        }
    };
    try {
        browserAPI.storage.onChanged.addListener(onChanged);
        window.addEventListener('beforeunload', () => browserAPI.storage.onChanged.removeListener(onChanged));
        const initial = await browserAPI.storage.local.get(STORAGE_KEYS.CLOUD_SERVER_STATS);
        showTotal(initial?.[STORAGE_KEYS.CLOUD_SERVER_STATS]);
    } catch (error) {
        console.debug('Could not read cached cloud statistics:', error);
    }
}

function setupEventListeners() {
    for (const button of document.querySelectorAll('[data-copy-address]')) {
        button.addEventListener('click', async () => {
            if (button.disabled) return;
            const address = document.getElementById(button.dataset.copyAddress);
            if (!address) return;
            button.disabled = true;
            try {
                // Keep the write in the click gesture. No wallet connection or request.
                await navigator.clipboard.writeText(address.textContent.trim());
                showSaveStatus(`${button.dataset.copyLabel} address copied. Check the network before sending.`);
            } catch {
                // The full address remains selectable when clipboard access is unavailable.
                const selection = window.getSelection();
                const range = document.createRange();
                range.selectNodeContents(address);
                selection?.removeAllRanges();
                selection?.addRange(range);
                showSaveStatus('Could not copy automatically. Select the address and copy it manually.', true);
            } finally {
                button.disabled = false;
            }
        });
    }

    for (const [id, key] of TOGGLES) {
        const input = document.getElementById(id);
        input.addEventListener('change', async () => {
            if (!settingsLoaded) return;
            input.disabled = true;
            const value = key === 'hovercardTrigger' ? (input.checked ? 'click' : 'hover') : input.checked;
            renderBadgePreview({ ...currentSettings, [key]: value });
            await saveSettings({ [key]: value });
            input.disabled = false;
        });
    }
    elements.optBadgeSize.addEventListener('change', async () => {
        if (!settingsLoaded || !BADGE_SIZES.includes(elements.optBadgeSize.value)) return;
        const badgeSize = elements.optBadgeSize.value;
        elements.optBadgeSize.disabled = true;
        renderBadgePreview({ ...currentSettings, badgeSize });
        await saveSettings({ badgeSize });
        elements.optBadgeSize.disabled = false;
    });

    elements.optCloudCache.addEventListener('change', async () => {
        const enabled = elements.optCloudCache.checked;
        elements.optCloudCache.disabled = true;
        try {
            const response = await browserAPI.runtime.sendMessage({
                type: MESSAGE_TYPES.SET_CLOUD_CACHE_ENABLED, payload: { enabled }
            });
            if (!response?.success) throw new Error(response?.error || 'Save failed');
            cloudEnabled = enabled;
            showSaveStatus('Cloud preference saved');
            await loadCloudCacheStatus();
        } catch (error) {
            elements.optCloudCache.checked = cloudEnabled;
            showSaveStatus('Could not save the cloud preference. Please try again.', true);
        } finally {
            elements.optCloudCache.disabled = false;
        }
    });

    elements.btnClearCache.addEventListener('click', async () => {
        if (!confirm('Clear the local account cache? Your settings and filters will be kept. Account details will be fetched again as needed.')) return;
        elements.btnClearCache.disabled = true;
        try {
            const response = await browserAPI.runtime.sendMessage({ type: MESSAGE_TYPES.SET_CACHE, payload: { action: 'clear' } });
            if (!response?.success) throw new Error('Clear failed');
            await Promise.all([loadCacheStats(), loadStatistics()]);
            showSaveStatus('Local cache cleared');
        } catch (error) {
            showSaveStatus('Could not clear the local cache. Please try again.', true);
        } finally {
            elements.btnClearCache.disabled = false;
        }
    });
    elements.btnSyncToCloud.addEventListener('click', handleSyncToCloud);
    elements.btnExportCache.addEventListener('click', exportBackup);
    elements.btnImportData.addEventListener('click', () => elements.importFileInput.click());
    elements.importFileInput.addEventListener('change', async event => {
        const file = event.target.files?.[0];
        if (!file) return;
        elements.btnImportData.disabled = true;
        try { await handleImportFile(file); }
        finally {
            elements.importFileInput.value = '';
            elements.btnImportData.disabled = false;
        }
    });
}

async function exportBackup() {
    elements.btnExportCache.disabled = true;
    try {
        // Read every committed store. A failed read must never create an incomplete backup.
        const sources = [
            ['settings', MESSAGE_TYPES.GET_SETTINGS],
            ...FILTER_SOURCES.map(source => [source.field, source.get]),
            ['cache', MESSAGE_TYPES.GET_CACHE],
            ['theme', MESSAGE_TYPES.GET_THEME],
            ['cloudCacheEnabled', MESSAGE_TYPES.GET_CLOUD_CACHE_STATUS]
        ];
        const responses = await Promise.all(sources.map(([, type]) => browserAPI.runtime.sendMessage({ type, payload: {} })));
        const data = {};
        for (const [index, [key]] of sources.entries()) {
            const response = responses[index];
            if (!response?.success) throw new Error(`Could not read ${key} for export`);
            data[key] = key === 'theme' ? response.theme : key === 'cloudCacheEnabled' ? response.enabled : response.data;
        }
        const backup = { exportedAt: new Date().toISOString(), version: VERSION,
            exportFormat: BACKUP_FORMAT, ...prepareBackupImport(data) };
        const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `x-posed-backup-${new Date().toISOString().split('T')[0]}.json`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        showSaveStatus('Backup exported');
    } catch (error) {
        console.error('Failed to export data:', error);
        showSaveStatus('Could not export a complete backup. Please try again.', true);
    } finally {
        elements.btnExportCache.disabled = false;
    }
}

async function handleImportFile(file) {
    const status = elements.importStatus;
    const showStatus = (text, error = false) => {
        status.textContent = text;
        status.className = `import-status ${error ? 'error' : 'success'}`;
        status.style.display = 'block';
    };
    try {
        let data;
        try { data = JSON.parse(await file.text()); }
        catch { showStatus('Invalid JSON file. Please select an X-Posed backup.', true); return; }
        if (!data || typeof data !== 'object' || Array.isArray(data) || (!data.version && !data.exportFormat)) {
            showStatus('This does not appear to be an X-Posed backup file.', true);
            return;
        }
        const payload = prepareBackupImport(data);
        const entries = LISTS.filter(source => Array.isArray(payload[source.field]))
            .map(source => `${data[source.field].length} ${source.label}`);
        if (payload.settings) entries.unshift('Settings');
        if (Object.hasOwn(payload, 'theme')) entries.push(`Theme: ${payload.theme}`);
        if (Object.hasOwn(payload, 'cloudCacheEnabled')) entries.push(`Community cache: ${payload.cloudCacheEnabled ? 'on' : 'off'}`);
        if (Array.isArray(payload.cache)) entries.push(`${payload.cache.length} cached accounts`);
        if (!confirm([
            `Import backup from ${data.version ? `v${data.version}` : 'X-Posed'}?`,
            ...entries,
            'Included settings, preferences and filter lists will replace their current values. Fields missing from this backup will be kept. Cached accounts will be merged.',
            'Continue?'
        ].join('\n\n'))) return;
        const response = await browserAPI.runtime.sendMessage({ type: MESSAGE_TYPES.IMPORT_DATA, payload });
        if (!response?.success) throw new Error(response?.error || 'Import failed');
        const loaded = await loadConfiguration();
        await Promise.all([loadCacheStats(), loadStatistics(), loadTheme(), loadCloudCacheStatus()]);
        const skipped = response.skippedCache > 0
            ? ` ${response.skippedCache} cached accounts were skipped because they were outdated, invalid or already up to date.` : '';
        showStatus(loaded ? `Backup imported. Your settings and filters are up to date.${skipped}`
            : 'Backup imported, but this page could not reload every setting. Please reload the page.', !loaded);
    } catch (error) {
        showStatus(`Import failed: ${error.message}`, true);
    }
}

async function checkWhatsNew() {
    const banner = document.getElementById('whats-new-banner');
    const closeBtn = document.getElementById('whats-new-close');
    
    if (!banner) return;
    
    // Check URL parameter
    const urlParams = new URLSearchParams(window.location.search);
    const showWhatsNew = urlParams.get('whats-new') === 'true';
    const showWelcome = urlParams.get('welcome') === 'true';
    if (showWelcome) document.getElementById('release-heading').textContent = 'Welcome to X-Posed';
    
    // Also check storage flag
    let storageShowWhatsNew = false;
    try {
        const result = await browserAPI.storage.local.get(STORAGE_KEYS.WHATS_NEW_SEEN);
        storageShowWhatsNew = result[STORAGE_KEYS.WHATS_NEW_SEEN] === false;
    } catch (e) {
        console.debug('Could not check whats-new storage flag');
    }
    
    if (showWelcome || showWhatsNew || storageShowWhatsNew) {
        banner.style.display = 'block';
        
        // Scroll to top to show banner
        window.scrollTo({ top: 0, behavior: 'smooth' });
        
        // Setup close button
        if (closeBtn) {
            closeBtn.addEventListener('click', async () => {
                banner.style.display = 'none';
                document.querySelector('.options-header h1')?.focus({ preventScroll: true });
                
                // Mark as seen
                try {
                    await browserAPI.storage.local.set({
                        [STORAGE_KEYS.WHATS_NEW_SEEN]: true
                    });
                } catch (e) {
                    console.debug('Could not save whats-new seen flag');
                }
                
                // Read the current URL after the async write, preserving any
                // settings shortcut or history navigation that happened meanwhile.
                const newUrl = new URL(window.location.href);
                newUrl.searchParams.delete('whats-new');
                newUrl.searchParams.delete('welcome');
                window.history.replaceState({}, document.title, newUrl);
            });
        }
    }
}

async function loadCacheStats() {
    try {
        const response = await browserAPI.runtime.sendMessage({
            type: MESSAGE_TYPES.GET_CACHE,
            payload: {}
        });

        if (response?.success) {
            elements.cacheSize.textContent = response.size || 0;
        }
    } catch (error) {
        console.error('Failed to load cache stats:', error);
        elements.cacheSize.textContent = '-';
    }
}

/**
 * Load and apply theme
 */
async function loadTheme() {
    try {
        const response = await browserAPI.runtime.sendMessage({
            type: MESSAGE_TYPES.GET_THEME
        });

        if (response?.theme) {
            applyTheme(response.theme);
        }
    } catch (error) {
        console.error('Failed to load theme:', error);
    }
}

/**
 * Apply theme to the options page documentElement via data-x-theme.
 * Only two themes are supported now (light + dark); legacy "dim" maps to dark.
 */
function applyTheme(theme) {
    document.documentElement.setAttribute('data-x-theme', theme === 'light' ? 'light' : 'dark');
}

/**
 * Load statistics data
 */
async function loadStatistics() {
    const host = document.getElementById('stats-panel-body');
    if (!host) return;
    statisticsView ||= mountStatistics(host);
    await statisticsView.refresh();
}

/**
 * Load cloud cache status
 */
async function loadCloudCacheStatus(committedEnabled) {
    const retry = document.getElementById('cloud-status-retry');
    if (retry) retry.disabled = true;
    try {
        const response = await browserAPI.runtime.sendMessage({
            type: MESSAGE_TYPES.GET_CLOUD_CACHE_STATUS
        });

        if (!response?.success) throw new Error('Could not read cloud status');
        // A storage notification can precede the worker's in-memory update.
        // Its committed preference takes precedence over that older status reply.
        const enabled = typeof committedEnabled === 'boolean' ? committedEnabled : response.enabled;
        updateCloudCacheUI(enabled, response.configured, response.stats);
        retry?.remove();

        // Use the background's cached statistics. There is no cloud polling here.
        if (enabled && response.configured) {
            void fetchCloudServerStats();
        }
    } catch (error) {
        console.error('Failed to load cloud cache status:', error);
        elements.cloudStatusText.textContent = 'Could not load cloud status';
        elements.cloudStatusIndicator.className = 'status-indicator status-unconfigured';
        if (retry) retry.disabled = false;
        else {
            const button = document.createElement('button');
            button.id = 'cloud-status-retry';
            button.type = 'button';
            button.className = 'btn btn-secondary btn-small';
            button.textContent = 'Try again';
            button.addEventListener('click', () => { void loadCloudCacheStatus(); });
            document.getElementById('cloud-status').append(button);
        }
    }
}

/**
 * Fetch cloud server statistics (total entries)
 */
async function fetchCloudServerStats() {
    try {
        const response = await browserAPI.runtime.sendMessage({
            type: MESSAGE_TYPES.GET_CLOUD_SERVER_STATS
        });

        if (response?.success && response.serverStats) {
            if (elements.cloudTotalEntries) {
                const total = response.serverStats.totalEntries || 0;
                // Exact number (no K/M abbreviation)
                elements.cloudTotalEntries.textContent = Number(total).toLocaleString();
            }
        }
    } catch (error) {
        console.error('Failed to fetch cloud server stats:', error);
        if (elements.cloudTotalEntries) {
            elements.cloudTotalEntries.textContent = '-';
        }
    }
}

/**
 * Handle sync local cache to cloud
 */
async function handleSyncToCloud() {
    const btn = elements.btnSyncToCloud;
    const status = elements.syncStatus;

    if (!btn || !status) return;

    // Disable button during sync
    btn.disabled = true;
    btn.textContent = 'Syncing...';
    status.textContent = '';
    status.className = 'sync-status';

    try {
        const response = await browserAPI.runtime.sendMessage({
            type: MESSAGE_TYPES.SYNC_LOCAL_TO_CLOUD
        });

        if (response?.success && response.result) {
            const { synced, skipped, errors } = response.result;
            status.textContent = `✓ Synced ${synced} entries${skipped > 0 ? `, ${skipped} skipped` : ''}${errors > 0 ? `, ${errors} errors` : ''}`;
            status.className = 'sync-status success';

            // Refresh cloud stats
            await loadCloudCacheStatus();
            // loadCloudCacheStatus also refreshes the server total.
        } else {
            status.textContent = '✗ ' + (response?.error || 'Sync failed');
            status.className = 'sync-status error';
        }
    } catch (error) {
        status.textContent = '✗ ' + error.message;
        status.className = 'sync-status error';
    } finally {
        // Re-enable button
        btn.disabled = false;
        btn.replaceChildren(dialogIcon('cloud', 16), document.createTextNode(' Sync Local Cache to Cloud'));
    }
}

/**
 * Update cloud cache UI
 */
function updateCloudCacheUI(enabled, configured, stats) {
    cloudEnabled = enabled;
    elements.optCloudCache.disabled = false;
    if (elements.optCloudCache) {
        elements.optCloudCache.checked = enabled;
    }

    // Update status indicator
    if (elements.cloudStatusIndicator) {
        elements.cloudStatusIndicator.className = 'status-indicator';
        if (!configured) {
            elements.cloudStatusIndicator.classList.add('status-unconfigured');
            elements.cloudStatusText.textContent = 'Not Configured';
        } else if (enabled) {
            elements.cloudStatusIndicator.classList.add('status-enabled');
            elements.cloudStatusText.textContent = 'Connected';
        } else {
            elements.cloudStatusIndicator.classList.add('status-disabled');
            elements.cloudStatusText.textContent = 'Disabled';
        }
    }

    // Show/hide unconfigured warning
    if (elements.cloudUnconfigured) {
        elements.cloudUnconfigured.style.display = configured ? 'none' : 'block';
    }

    // Show/hide stats
    if (elements.cloudStats) {
        elements.cloudStats.style.display = enabled && configured ? 'grid' : 'none';
    }

    // Show/hide actions
    if (elements.cloudActions) {
        elements.cloudActions.style.display = enabled && configured ? 'flex' : 'none';
    }

    // Reset cloud total if not enabled
    if (elements.cloudTotalEntries && (!enabled || !configured)) {
        elements.cloudTotalEntries.textContent = '-';
    }
    
    // Update stats values
    if (stats) {
        if (elements.cloudLookups) elements.cloudLookups.textContent = stats.lookups || 0;
        if (elements.cloudHits) elements.cloudHits.textContent = stats.hits || 0;
        if (elements.cloudContributions) elements.cloudContributions.textContent = stats.contributions || 0;
    }
}

async function loadRateLimitStatus() {
    try {
        const response = await browserAPI.runtime.sendMessage({
            type: MESSAGE_TYPES.GET_RATE_LIMIT_STATUS
        });
        
        if (typeof response?.isRateLimited === 'boolean') {
            updateRateLimitBanner(response);
        }
    } catch (error) {
        console.debug('Failed to load rate limit status:', error);
    }
}

/**
 * Update rate limit banner UI
 */
function updateRateLimitBanner(status) {
    const banner = elements.rateLimitBanner;
    const timeEl = elements.rateLimitTime;
    
    if (!banner) return;
    
    if (status.isRateLimited) {
        banner.style.display = 'flex';
        banner.className = 'rate-limit-banner rate-limited';
        banner.querySelector('.rate-limit-icon').replaceChildren(dialogIcon('warn', 18));
        banner.querySelector('.rate-limit-title').textContent = 'Rate Limited';
        
        if (timeEl) timeEl.textContent = 'Waiting for X to allow requests again';
        if (timeEl && status.resetTime) {
            const resetDate = new Date(status.resetTime);
            const now = new Date();
            const diffMs = resetDate - now;
            
            if (diffMs > 0) {
                const minutes = Math.ceil(diffMs / 60000);
                timeEl.textContent = `Resets in ~${minutes} minute${minutes !== 1 ? 's' : ''}`;
            } else {
                timeEl.textContent = 'Resetting soon...';
            }
        }
    } else {
        // Show OK status
        banner.style.display = 'flex';
        banner.className = 'rate-limit-banner rate-ok';
        banner.querySelector('.rate-limit-icon').replaceChildren(dialogIcon('check', 18));
        banner.querySelector('.rate-limit-title').textContent = 'API Status: OK';
        if (timeEl) {
            timeEl.textContent = 'No rate limits active';
        }
    }
}

/**
 * Start periodic rate limit status monitoring
 */
function startRateLimitMonitor() {
    // Update every 10 seconds
    rateLimitMonitorInterval = setInterval(loadRateLimitStatus, TIMING.RATE_LIMIT_CHECK_MS);
    
    // Cleanup on page unload
    window.addEventListener('beforeunload', () => {
        if (rateLimitMonitorInterval) {
            clearInterval(rateLimitMonitorInterval);
        }
    });
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
} else {
    initialize();
}
