/** One hoverable, keyboard-readable tooltip owned by the current account card. */
let tooltipSequence = 0;

export function createCardTooltip(card) {
    const tooltip = document.createElement('div');
    tooltip.className = 'x-posed-action-tooltip';
    do { tooltip.id = `x-posed-action-tooltip-${++tooltipSequence}`; }
    while (document.getElementById(tooltip.id));
    tooltip.setAttribute('role', 'tooltip');
    tooltip.hidden = true;
    const heading = document.createElement('div');
    heading.className = 'x-posed-action-tooltip-heading';
    const description = document.createElement('div');
    description.className = 'x-posed-action-tooltip-description';
    tooltip.append(heading, description);
    card.appendChild(tooltip);

    let disposed = false;
    let current = null;
    let pendingTarget = null;
    let pointerTarget = null;
    let focusTarget = null;
    let suppressed = null;
    let overTooltip = false;
    let showTimer = null;
    let leaveTimer = null;
    const valid = button => button?.isConnected && card.isConnected && card.contains(button) &&
        button.matches('button[data-x-tooltip-heading]') && button.dataset.xTooltipHeading;
    const trigger = node => {
        const button = node?.closest?.('button[data-x-tooltip-heading]');
        return button && card.contains(button) ? button : null;
    };
    const pointer = event => event.pointerType === 'mouse' || event.pointerType === 'pen';

    function clearShow() {
        clearTimeout(showTimer);
        showTimer = null;
        pendingTarget = null;
    }

    function clearLeave() {
        clearTimeout(leaveTimer);
        leaveTimer = null;
    }

    function describe(button, add) {
        if (!button) return;
        const tokens = (button.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
        const next = tokens.filter(token => token !== tooltip.id);
        if (add) next.push(tooltip.id);
        if (next.length) button.setAttribute('aria-describedby', next.join(' '));
        else button.removeAttribute('aria-describedby');
    }

    function hide() {
        clearShow();
        clearLeave();
        describe(current, false);
        current = null;
        overTooltip = false;
        tooltip.hidden = true;
    }

    function position() {
        const anchor = current.getBoundingClientRect();
        const width = window.innerWidth;
        const height = window.innerHeight;
        // Inherited CSS zoom scales fixed descendants too. Rects are viewport
        // coordinates; style positions and constraints remain local CSS pixels.
        const measured = tooltip.getBoundingClientRect();
        const scaleX = tooltip.offsetWidth > 0 ? measured.width / tooltip.offsetWidth : 1;
        const scaleY = tooltip.offsetHeight > 0 ? measured.height / tooltip.offsetHeight : 1;
        tooltip.style.maxWidth = `${Math.max(1, Math.min(276, (width - 24) / scaleX))}px`;
        // Measure the natural text box, not scrollHeight: the decorative pointer
        // deliberately protrudes below the box and otherwise creates false overflow.
        tooltip.style.maxHeight = 'none';
        tooltip.style.overflowY = 'visible';
        const availableHeight = Math.max(1, height - 16);
        const scrollable = tooltip.getBoundingClientRect().height > availableHeight + 1;
        tooltip.style.maxHeight = `${availableHeight / scaleY}px`;
        tooltip.style.overflowY = scrollable ? 'auto' : 'visible';
        tooltip.dataset.scrollable = String(scrollable);
        const bounds = tooltip.getBoundingClientRect();
        const center = anchor.left + anchor.width / 2;
        const left = Math.max(8, Math.min(center - bounds.width / 2, width - bounds.width - 8));
        let top = anchor.top - bounds.height - 8;
        let placement = 'top';
        if (top < 8) {
            top = anchor.bottom + 8;
            placement = 'bottom';
        }
        top = Math.max(8, Math.min(top, height - bounds.height - 8));
        tooltip.style.left = `${left / scaleX}px`;
        tooltip.style.top = `${top / scaleY}px`;
        tooltip.dataset.placement = placement;
        tooltip.style.setProperty('--xp-tooltip-arrow-x',
            `${Math.max(12, Math.min((center - left) / scaleX, bounds.width / scaleX - 12))}px`);
    }

    function refresh() {
        if (disposed) return;
        if (!card.isConnected || (current && !valid(current))) {
            hide();
            return;
        }
        if (tooltip.parentElement !== card) card.appendChild(tooltip);
        if (pendingTarget && !valid(pendingTarget)) clearShow();
        if (!current || tooltip.hidden) return;
        const title = current.dataset.xTooltipHeading.slice(0, 160);
        const copy = (current.dataset.xTooltipDescription || '').slice(0, 1200);
        if (heading.textContent !== title) heading.textContent = title;
        if (description.textContent !== copy) description.textContent = copy;
        description.hidden = !copy;
        describe(current, true);
        position();
    }

    function show(button) {
        clearShow();
        clearLeave();
        if (disposed || button === suppressed || !valid(button)) return;
        if (current !== button) describe(current, false);
        current = button;
        tooltip.hidden = false;
        refresh();
    }

    function enter(button, immediate = false) {
        clearLeave();
        if (button === suppressed) return;
        suppressed = null;
        if (current === button && !tooltip.hidden) return;
        if (current && current !== button) hide();
        clearShow();
        if (immediate) show(button);
        else {
            pendingTarget = button;
            showTimer = setTimeout(() => show(button), 220);
        }
    }

    function leave() {
        if (pendingTarget && pointerTarget !== pendingTarget && focusTarget !== pendingTarget) clearShow();
        clearLeave();
        if (pointerTarget === current || focusTarget === current || overTooltip) return;
        leaveTimer = setTimeout(hide, 100);
    }

    function onPointerOver(event) {
        if (disposed || !pointer(event)) return;
        if (tooltip.contains(event.target)) {
            overTooltip = true;
            clearLeave();
            return;
        }
        const button = trigger(event.target);
        if (!button || button.contains(event.relatedTarget)) return;
        pointerTarget = button;
        enter(button);
    }

    function onPointerOut(event) {
        if (disposed || !pointer(event)) return;
        if (tooltip.contains(event.target)) {
            if (tooltip.contains(event.relatedTarget)) return;
            overTooltip = false;
        } else {
            const button = trigger(event.target);
            if (!button || button.contains(event.relatedTarget)) return;
            if (pointerTarget === button) pointerTarget = null;
            if (suppressed === button) suppressed = null;
        }
        leave();
    }

    function onFocusIn(event) {
        const button = trigger(event.target);
        if (disposed || !button || !button.matches(':focus-visible')) return;
        focusTarget = button;
        enter(button, true);
    }

    function onFocusOut(event) {
        const button = trigger(event.target);
        if (disposed || !button || button.contains(event.relatedTarget)) return;
        if (focusTarget === button) focusTarget = null;
        if (suppressed === button) suppressed = null;
        leave();
    }

    function dismiss() {
        const visible = !tooltip.hidden;
        if (disposed) return false;
        suppressed = current || pendingTarget || pointerTarget || focusTarget;
        hide();
        return visible;
    }

    const onViewportChange = event => {
        // Reading a capped explanation is not movement of its viewport anchor.
        if (event.target?.nodeType && tooltip.contains(event.target)) return;
        dismiss();
    };
    const observer = new MutationObserver(records => {
        if (records.some(record => !tooltip.contains(record.target))) refresh();
    });
    observer.observe(card, {
        subtree: true, childList: true, attributes: true,
        attributeFilter: ['data-x-tooltip-heading', 'data-x-tooltip-description']
    });
    card.addEventListener('pointerover', onPointerOver);
    card.addEventListener('pointerout', onPointerOut);
    card.addEventListener('focusin', onFocusIn);
    card.addEventListener('focusout', onFocusOut);
    window.addEventListener('scroll', onViewportChange, true);
    window.addEventListener('resize', onViewportChange);

    return {
        refresh, dismiss,
        dispose() {
            if (disposed) return;
            hide();
            disposed = true;
            observer.disconnect();
            card.removeEventListener('pointerover', onPointerOver);
            card.removeEventListener('pointerout', onPointerOut);
            card.removeEventListener('focusin', onFocusIn);
            card.removeEventListener('focusout', onFocusOut);
            window.removeEventListener('scroll', onViewportChange, true);
            window.removeEventListener('resize', onViewportChange);
            tooltip.remove();
            current = pendingTarget = pointerTarget = focusTarget = suppressed = null;
        }
    };
}
