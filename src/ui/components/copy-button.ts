import { h } from '../dom';

/** A small "Copy" button for seeds and hashes. Clipboard access can be refused, so it says so. */
export function copyButton(text: string, label = 'Copy'): HTMLButtonElement {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const button = h(
    'button',
    { class: 'button button--tiny', type: 'button', 'aria-label': `${label} ${text}` },
    label,
  );
  button.addEventListener('click', async () => {
    let outcome = 'Copied';
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      outcome = 'Not allowed';
    }
    button.textContent = outcome;
    clearTimeout(timer);
    timer = setTimeout(() => (button.textContent = label), 1500);
  });
  return button;
}
