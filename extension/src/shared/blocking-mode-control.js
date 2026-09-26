import { createSnapshotTracker } from './state-sync.js';

/** The same native, two-choice filtering control in Settings and the on-page dialog. */
export function createBlockingModeControl({ id, settings = {}, revision, onChange }) {
    const element = document.createElement('fieldset');
    element.className = 'xp-blocking-mode';
    const legend = document.createElement('legend');
    legend.textContent = 'Matching posts';
    const choices = document.createElement('div');
    choices.className = 'xp-blocking-mode-choices';
    const status = document.createElement('p');
    status.className = 'xp-control-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    let committed = { ...settings };
    const snapshots = createSnapshotTracker();
    snapshots.accept('settings', revision);
    let pending = false;
    const inputs = [];

    function render() {
        for (const input of inputs) {
            input.checked = (committed.highlightBlockedTweets === true) === (input.value === 'highlight');
        }
        element.disabled = pending;
    }

    function update(next, nextRevision) {
        const previousRevision = snapshots.snapshot().settings;
        if (!snapshots.accept('settings', nextRevision)) return;
        committed = { ...next };
        if (!pending && nextRevision !== previousRevision) status.textContent = '';
        render();
    }

    for (const [value, text] of [['hide', 'Hide'], ['highlight', 'Highlight']]) {
        const label = document.createElement('label');
        const input = document.createElement('input');
        input.type = 'radio';
        input.name = id;
        input.value = value;
        const caption = document.createElement('span');
        caption.textContent = text;
        label.append(input, caption);
        choices.appendChild(label);
        inputs.push(input);
        input.addEventListener('change', async () => {
            if (!input.checked || pending) return;
            const highlight = value === 'highlight';
            if (highlight === (committed.highlightBlockedTweets === true)) return;
            pending = true;
            element.disabled = true;
            status.textContent = 'Saving…';
            try {
                const response = await onChange({ highlightBlockedTweets: highlight });
                if (!response?.success) throw new Error('Save failed');
                // A later broadcast wins over an older action acknowledgement.
                if (snapshots.accept('settings', response.revision)) committed = { ...response.data };
                status.textContent = '';
            } catch {
                status.textContent = 'Couldn’t save the mode. Please try again.';
            } finally {
                pending = false;
                render();
            }
        });
    }
    element.append(legend, choices, status);
    render();
    return { element, update };
}
