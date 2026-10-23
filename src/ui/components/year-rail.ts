import { h } from '../dom';

/**
 * The year rail: the chronicle's scrollbar, marked in years.
 *
 * It sits along the right edge of the chronicle and maps the whole log onto its height, like any
 * scrollbar, but it is labelled by year and dotted with what happened when (personal, family and
 * news lines in their category colours). The thumb shows what is on screen; drag it, click the
 * rail, or use the arrow keys on it to travel through a life. Hovering says the year and the age
 * there. Positions come from the laid-out chronicle itself, so the rail is exact, not estimated.
 */

export interface YearRail {
  el: HTMLElement;
  /** Re-read the chronicle's layout (after it is redrawn or resized). */
  refresh(info: { birthTick: number | null }): void;
  /** Move the thumb (on every scroll). */
  sync(): void;
  destroy(): void;
}

const MIN_LABEL_GAP = 22;
const MIN_THUMB = 28;

export function createYearRail(scroller: HTMLElement): YearRail {
  const track = h('div', { class: 'year-rail__track' });
  const marks = h('div', { class: 'year-rail__marks', 'aria-hidden': 'true' });
  const thumb = h('div', { class: 'year-rail__thumb', 'aria-hidden': 'true' });
  const tip = h('div', { class: 'year-rail__tip', hidden: true, 'aria-hidden': 'true' });
  const el = h(
    'div',
    {
      class: 'year-rail',
      role: 'scrollbar',
      'aria-label': 'Chronicle by year',
      'aria-controls': scroller.id,
      'aria-orientation': 'vertical',
      'aria-valuemin': '0',
      'aria-valuemax': '100',
      'aria-valuenow': '100',
      tabindex: '0',
      hidden: true,
    },
    track,
    marks,
    thumb,
    tip,
  );

  /** Year boundaries: where each year starts in the chronicle, as a fraction of its height. */
  let years: { year: number; at: number; tick: number }[] = [];
  let birthTick: number | null = null;

  const scrollable = () => scroller.scrollHeight - scroller.clientHeight;

  function sync(): void {
    const total = scroller.scrollHeight;
    const railH = el.clientHeight;
    if (total <= 0 || railH <= 0) return;
    const visible = scroller.clientHeight / total;
    const height = Math.max(MIN_THUMB, visible * railH);
    const room = railH - height;
    const progress = scrollable() > 0 ? scroller.scrollTop / scrollable() : 1;
    thumb.style.height = `${height}px`;
    thumb.style.transform = `translateY(${(room * progress).toFixed(1)}px)`;
    el.setAttribute('aria-valuenow', String(Math.round(progress * 100)));
    const at = (scroller.scrollTop + scroller.clientHeight / 2) / total;
    el.setAttribute('aria-valuetext', describe(at));
  }

  function yearAt(fraction: number): { year: number; tick: number } | null {
    let found: { year: number; tick: number } | null = null;
    for (const y of years) {
      if (y.at <= fraction + 1e-6) found = y;
      else break;
    }
    return found ?? years[0] ?? null;
  }

  function describe(fraction: number): string {
    const y = yearAt(fraction);
    if (!y) return '';
    if (birthTick === null) return `Year ${y.year}`;
    const age = Math.floor((y.tick - birthTick) / 12);
    return age >= 0 ? `Year ${y.year}, age ${age}` : `Year ${y.year}, before you were born`;
  }

  function refresh(info: { birthTick: number | null }): void {
    birthTick = info.birthTick;
    const total = scroller.scrollHeight;
    const overflow = scrollable() > 4;
    el.hidden = !overflow;
    if (!overflow || total <= 0) {
      marks.replaceChildren();
      return;
    }
    const base = scroller.getBoundingClientRect().top - scroller.scrollTop;
    const offset = (node: Element) => (node.getBoundingClientRect().top - base) / total;

    years = [];
    let lastYear: number | null = null;
    for (const month of scroller.querySelectorAll<HTMLElement>('.month[data-tick]')) {
      const tick = Number(month.dataset['tick']);
      const year = Math.floor(tick / 12);
      if (year !== lastYear) {
        years.push({ year, at: offset(month), tick });
        lastYear = year;
      }
    }

    const railH = el.clientHeight || 1;
    const nodes: HTMLElement[] = [];
    let lastLabel = -Infinity;
    for (const [i, y] of years.entries()) {
      const px = y.at * railH;
      const last = i === years.length - 1;
      if (px - lastLabel >= MIN_LABEL_GAP || (last && px - lastLabel >= MIN_LABEL_GAP / 2)) {
        nodes.push(
          h(
            'span',
            { class: 'year-rail__year', style: `top: ${(y.at * 100).toFixed(2)}%` },
            String(y.year),
          ),
        );
        lastLabel = px;
      } else {
        nodes.push(
          h('span', { class: 'year-rail__tick', style: `top: ${(y.at * 100).toFixed(2)}%` }),
        );
      }
    }
    for (const line of scroller.querySelectorAll<HTMLElement>('.line[data-category]')) {
      const category = line.dataset['category'];
      if (category === 'system' || category === 'world') continue;
      nodes.push(
        h('span', {
          class: 'year-rail__dot',
          dataset: { category: category ?? '' },
          style: `top: ${(offset(line) * 100).toFixed(2)}%`,
        }),
      );
    }
    marks.replaceChildren(...nodes);
    sync();
  }

  // ---- Travelling: click, drag, keys, and the hover label
  const fractionAt = (clientY: number) => {
    const rect = el.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientY - rect.top) / Math.max(1, rect.height)));
  };
  const jumpTo = (fraction: number, smooth: boolean) => {
    const top = fraction * scroller.scrollHeight - scroller.clientHeight / 2;
    scroller.scrollTo({ top, behavior: smooth ? 'smooth' : 'auto' });
  };
  let dragging: { pointer: number; startY: number; startTop: number } | null = null;

  const onDown = (event: PointerEvent) => {
    event.preventDefault();
    el.focus({ preventScroll: true });
    const rect = thumb.getBoundingClientRect();
    if (event.clientY < rect.top || event.clientY > rect.bottom)
      jumpTo(fractionAt(event.clientY), false);
    dragging = { pointer: event.pointerId, startY: event.clientY, startTop: scroller.scrollTop };
    el.setPointerCapture?.(event.pointerId);
    el.classList.add('is-dragging');
  };
  const onMove = (event: PointerEvent) => {
    const fraction = fractionAt(event.clientY);
    tip.hidden = false;
    tip.textContent = describe(fraction);
    tip.style.top = `${(fraction * 100).toFixed(2)}%`;
    if (!dragging || dragging.pointer !== event.pointerId) return;
    const railH = el.clientHeight || 1;
    const thumbH = thumb.getBoundingClientRect().height || MIN_THUMB;
    const ratio = scrollable() / Math.max(1, railH - thumbH);
    scroller.scrollTop = dragging.startTop + (event.clientY - dragging.startY) * ratio;
  };
  const onUp = (event: PointerEvent) => {
    if (dragging?.pointer === event.pointerId) dragging = null;
    el.classList.remove('is-dragging');
  };
  const onLeave = () => {
    if (!dragging) tip.hidden = true;
  };
  const onKey = (event: KeyboardEvent) => {
    const page = scroller.clientHeight * 0.9;
    const moves: Record<string, () => void> = {
      ArrowUp: () => scroller.scrollBy({ top: -80 }),
      ArrowDown: () => scroller.scrollBy({ top: 80 }),
      PageUp: () => scroller.scrollBy({ top: -page }),
      PageDown: () => scroller.scrollBy({ top: page }),
      Home: () => scroller.scrollTo({ top: 0 }),
      End: () => scroller.scrollTo({ top: scroller.scrollHeight }),
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    move();
  };
  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onUp);
  el.addEventListener('pointerleave', onLeave);
  el.addEventListener('keydown', onKey);

  const resize =
    typeof ResizeObserver === 'function' ? new ResizeObserver(() => refresh({ birthTick })) : null;
  resize?.observe(scroller);

  return {
    el,
    refresh,
    sync,
    destroy() {
      resize?.disconnect();
    },
  };
}
