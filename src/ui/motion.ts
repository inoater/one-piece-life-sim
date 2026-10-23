/**
 * Motion that answers an action: numbers that count to their new value, a flash on what changed,
 * shapes that move instead of jumping. Everything here respects `prefers-reduced-motion` and
 * always ends on the true value, so a screen reader, a test or a reduced-motion user sees the same
 * final page as everyone else; only the journey is skipped.
 */

export function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

const hasFrames = () => typeof window.requestAnimationFrame === 'function';

/** Ease-out cubic: fast start, gentle landing. */
const ease = (t: number) => 1 - (1 - t) * (1 - t) * (1 - t);

/**
 * Call `frame` with values from `from` to `to` over `ms`. The last call is always exactly `to`.
 * Returns a cancel function.
 */
export function tween(
  from: number,
  to: number,
  ms: number,
  frame: (value: number, progress: number) => void,
): () => void {
  if (from === to || ms <= 0 || prefersReducedMotion() || !hasFrames()) {
    frame(to, 1);
    return () => {};
  }
  let cancelled = false;
  let start: number | null = null;
  const step = (now: number) => {
    if (cancelled) return;
    start ??= now;
    const t = Math.min(1, (now - start) / ms);
    frame(t >= 1 ? to : from + (to - from) * ease(t), t);
    if (t < 1) window.requestAnimationFrame(step);
  };
  window.requestAnimationFrame(step);
  return () => {
    cancelled = true;
  };
}

const counting = new WeakMap<Element, { value: number; cancel: () => void }>();

/**
 * Show `to` in `el`, counting from the number it showed before. The first value is shown at once.
 * Screen readers get the final value immediately through `aria-label`.
 */
export function countTo(
  el: HTMLElement,
  to: number,
  format: (n: number) => string,
  ms = 650,
): void {
  const previous = counting.get(el);
  previous?.cancel();
  el.setAttribute('aria-label', format(to));
  if (!previous) {
    el.textContent = format(to);
    counting.set(el, { value: to, cancel: () => {} });
    return;
  }
  const cancel = tween(previous.value, to, ms, (v) => {
    el.textContent = format(Math.round(v));
  });
  counting.set(el, { value: to, cancel });
}

/** Forget what an element last counted to (it was emptied), so the next value appears at once. */
export function resetCount(el: HTMLElement): void {
  counting.get(el)?.cancel();
  counting.delete(el);
  el.removeAttribute('aria-label');
}

/** Restart a one-shot CSS animation class on an element. */
export function flash(el: Element, className = 'is-flashing'): void {
  el.classList.remove(className);
  // Reading layout forces the browser to notice the removal, so the animation runs again.
  void (el as HTMLElement).offsetWidth;
  el.classList.add(className);
}
