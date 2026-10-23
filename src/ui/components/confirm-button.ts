import { h } from '../dom';

/**
 * A button for actions that replace or delete something. The first press arms it ("Press again
 * to confirm"); a second press within a few seconds does it. No native dialog, so it works the
 * same everywhere and stays inside the page's design.
 */
export function confirmButton(options: {
  label: string;
  confirmLabel?: string;
  className?: string;
  disabled?: boolean;
  onConfirm: () => void;
  armedMs?: number;
}): HTMLButtonElement {
  const {
    label,
    confirmLabel = 'Press again to confirm',
    className = 'button button--quiet',
    armedMs = 4000,
  } = options;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const button = h(
    'button',
    { class: className, type: 'button', disabled: options.disabled },
    label,
  );
  const disarm = () => {
    clearTimeout(timer);
    timer = undefined;
    button.textContent = label;
    button.classList.remove('is-armed');
  };
  button.addEventListener('click', () => {
    if (timer !== undefined) {
      disarm();
      options.onConfirm();
      return;
    }
    button.textContent = confirmLabel;
    button.classList.add('is-armed');
    timer = setTimeout(disarm, armedMs);
  });
  button.addEventListener('blur', disarm);
  return button;
}
