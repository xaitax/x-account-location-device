/** Shared, accessible reveal card for a filtered quote or a related whole post. */
import { dialogIcon } from './dialog-icons.js';

export function createFilterPlaceholder({ title, action, related = false }) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'x-quote-placeholder' + (related ? ' x-related-placeholder' : '');
    const icon = dialogIcon('shield', 18);
    icon.classList.add('x-quote-placeholder-icon');
    const copy = document.createElement('span');
    copy.className = 'x-quote-placeholder-copy';
    for (const [suffix, text] of [['title', title], ['reasons', '']]) {
        const span = document.createElement('span');
        span.className = `x-quote-placeholder-${suffix}`;
        span.textContent = text;
        copy.appendChild(span);
    }
    const affordance = document.createElement('span');
    affordance.className = 'x-quote-placeholder-action';
    affordance.append(action, dialogIcon('chevronRight', 14));
    button.append(icon, copy, affordance);
    return button;
}

export function updateFilterPlaceholder(button, { reasonText, description }) {
    const reasons = button.querySelector('.x-quote-placeholder-reasons');
    if (reasons.textContent !== reasonText) reasons.textContent = reasonText;
    const action = button.querySelector('.x-quote-placeholder-action').textContent;
    button.setAttribute('aria-label', `${action}. ${description}`);
    button.title = description;
}
