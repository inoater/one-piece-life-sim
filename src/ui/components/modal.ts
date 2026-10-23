import { h } from '../dom';

/**
 * An accessible modal dialog: labelled, focus moves in and returns on close, Tab stays inside,
 * Escape and a click on the backdrop close it.
 */

export interface ModalHandle {
  el: HTMLElement;
  close(): void;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

let counter = 0;

export function openModal(options: {
  title: string;
  body: Node;
  onClose?: () => void;
  className?: string;
}): ModalHandle {
  const titleId = `modal-title-${++counter}`;
  const previouslyFocused = document.activeElement as HTMLElement | null;
  let closed = false;

  const closeButton = h(
    'button',
    { class: 'button button--quiet', type: 'button', 'aria-label': 'Close' },
    'Close',
  );
  const dialog = h(
    'div',
    {
      class: `modal ${options.className ?? ''}`.trim(),
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': titleId,
      tabindex: '-1',
    },
    h(
      'header',
      { class: 'modal__header' },
      h('h2', { id: titleId, class: 'modal__title' }, options.title),
      closeButton,
    ),
    h('div', { class: 'modal__body' }, options.body),
  );
  const backdrop = h('div', { class: 'modal-backdrop' }, dialog);

  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey, true);
    backdrop.remove();
    previouslyFocused?.focus?.();
    options.onClose?.();
  };

  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
    } else if (event.key === 'Tab') {
      const items = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) => !el.closest('[hidden]'),
      );
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const first = items[0] as HTMLElement;
      const last = items[items.length - 1] as HTMLElement;
      if (
        event.shiftKey &&
        (document.activeElement === first || document.activeElement === dialog)
      ) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  };

  closeButton.addEventListener('click', close);
  backdrop.addEventListener('mousedown', (event) => {
    if (event.target === backdrop) close();
  });
  document.addEventListener('keydown', onKey, true);
  document.body.appendChild(backdrop);
  dialog.focus();
  return { el: dialog, close };
}
