import { h, svg } from '../dom';
import { prefersReducedMotion, tween } from '../motion';
import { describePlace, drawAtlas, MAP_H, MAP_W, pickAt, type Selection } from './atlas';

/**
 * The world map as a widget: drag to pan, scroll or pinch to zoom, double-click to reset, click an
 * island to read about it. Game pins (birthplaces, home) sit on top at a constant size whatever
 * the zoom. Keyboard: Tab to the map, then arrows pan, + and - zoom, 0 resets; pins are buttons.
 *
 * The same widget is the Map page and the Birthplace screen's chooser.
 */

export interface MapPin {
  id: string;
  x: number;
  y: number;
  /** Short name drawn beside the pin when it is labelled. */
  label: string;
  /**
   * home: where the player lives; open/closed/chosen/rolled: birthplace choices. Phase 3 (the
   * Map page): here (where the player is), place, visited, reachable (a lane leads there from
   * here), target (where the voyage is bound), ship (the player at sea; not a button).
   */
  kind:
    | 'home'
    | 'open'
    | 'closed'
    | 'chosen'
    | 'rolled'
    | 'here'
    | 'place'
    | 'visited'
    | 'reachable'
    | 'target'
    | 'ship';
  /** Spoken and shown on hover. */
  title: string;
  /** Draw the label even when not hovered. */
  labelled?: boolean;
}

/** A sea lane drawn on the map (Phase 3). */
export interface MapRoute {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** lane: any lane; reachable: from where the player is; voyage: the one being sailed. */
  kind: 'lane' | 'reachable' | 'voyage';
  danger: number;
  land: boolean;
}

export interface WorldMapOptions {
  label: string;
  /** Show the notes panel when a place is clicked. */
  notes?: boolean;
  onPin?: (id: string) => void;
  className?: string;
}

export interface WorldMap {
  el: HTMLElement;
  setPins(pins: readonly MapPin[]): void;
  /** Draw the sea lanes (Phase 3). Lanes that cross the map's edge are drawn across it. */
  setRoutes(routes: readonly MapRoute[]): void;
  /** Glide to a map point at a zoom (1 = whole map). */
  focusOn(x: number, y: number, zoom: number): void;
  /** Open the notes for a named place, and go there. */
  open(name: string): void;
  /** Re-measure (after the map becomes visible or changes size). */
  measure(): void;
  destroy(): void;
}

const MAX_ZOOM = 14;
const PIN_SIZE = 1;

export function createWorldMap(options: WorldMapOptions): WorldMap {
  const map = svg('svg', {
    class: 'atlas',
    viewBox: `0 0 ${MAP_W} ${MAP_H}`,
    role: 'img',
    'aria-label': options.label,
    tabindex: '0',
  });
  const { overlay } = drawAtlas(map);
  const selection = svg('g', { class: 'atlas__selection', 'pointer-events': 'none' });
  const pinLayer = svg('g', { class: 'atlas__pins' });
  const routeLayer = svg('g', { class: 'atlas__routes', 'pointer-events': 'none' });
  overlay.append(selection);
  map.append(routeLayer, pinLayer); // above the names, so a pin is never hidden under a label

  const name = h('h3', { class: 'atlas-info__name' });
  const where = h('p', { class: 'atlas-info__where' });
  const text = h('p', { class: 'atlas-info__text' });
  const links = h('div', { class: 'atlas-info__links' });
  const close = h(
    'button',
    { class: 'atlas-info__close', type: 'button', 'aria-label': 'Close the notes' },
    '×',
  );
  const info = h(
    'aside',
    { class: 'atlas-info', hidden: true, 'aria-live': 'polite' },
    close,
    name,
    where,
    text,
    links,
  );

  const zoomIn = h(
    'button',
    { class: 'atlas-controls__button', type: 'button', 'aria-label': 'Zoom in' },
    '+',
  );
  const zoomOut = h(
    'button',
    { class: 'atlas-controls__button', type: 'button', 'aria-label': 'Zoom out' },
    '−',
  );
  const home = h(
    'button',
    { class: 'atlas-controls__button', type: 'button', 'aria-label': 'Show the whole map' },
    '⌂',
  );
  const controls = h('div', { class: 'atlas-controls' }, zoomIn, zoomOut, home);
  const el = h(
    'div',
    { class: `world-map${options.className ? ` ${options.className}` : ''}` },
    map,
    info,
    controls,
  );

  let vw = 1;
  let vh = 1;
  let fit = 1;
  const cam = { x: MAP_W / 2, y: MAP_H / 2, k: 1 };
  let pins: readonly MapPin[] = [];
  let glide: (() => void) | null = null;

  function measure(): void {
    const r = el.getBoundingClientRect();
    vw = Math.max(1, r.width);
    vh = Math.max(1, r.height);
    const before = cam.k / fit;
    fit = Math.min(vw / MAP_W, vh / MAP_H);
    cam.k = (Number.isFinite(before) && before > 0 ? before : 1) * fit;
    apply();
  }

  function apply(): void {
    cam.k = Math.min(fit * MAX_ZOOM, Math.max(fit, cam.k));
    const ww = vw / cam.k;
    const hh = vh / cam.k;
    cam.x = ww >= MAP_W ? MAP_W / 2 : Math.min(MAP_W - ww / 2, Math.max(ww / 2, cam.x));
    cam.y = hh >= MAP_H ? MAP_H / 2 : Math.min(MAP_H - hh / 2, Math.max(hh / 2, cam.y));
    map.setAttribute('viewBox', `${cam.x - ww / 2} ${cam.y - hh / 2} ${ww} ${hh}`);
    map.classList.toggle('is-zoomed', cam.k / fit > 1.4);
    // Pins keep their size on screen: scale them by the inverse of the zoom.
    const s = (PIN_SIZE / cam.k).toFixed(4);
    for (const g of pinLayer.children) {
      const x = g.getAttribute('data-x');
      const y = g.getAttribute('data-y');
      g.setAttribute('transform', `translate(${x} ${y}) scale(${s})`);
    }
  }

  const toWorld = (cx: number, cy: number): [number, number] => {
    const r = el.getBoundingClientRect();
    return [cam.x + (cx - r.left - vw / 2) / cam.k, cam.y + (cy - r.top - vh / 2) / cam.k];
  };
  const anchor = (w: [number, number], cx: number, cy: number) => {
    const r = el.getBoundingClientRect();
    cam.x = w[0] - (cx - r.left - vw / 2) / cam.k;
    cam.y = w[1] - (cy - r.top - vh / 2) / cam.k;
  };
  const zoomAt = (factor: number, cx: number, cy: number) => {
    glide?.();
    const w = toWorld(cx, cy);
    cam.k = Math.min(fit * MAX_ZOOM, Math.max(fit, cam.k * factor));
    anchor(w, cx, cy);
    apply();
  };
  const zoomCentre = (factor: number) => {
    const r = el.getBoundingClientRect();
    zoomAt(factor, r.left + r.width / 2, r.top + r.height / 2);
  };

  function focusOn(x: number, y: number, zoom: number): void {
    glide?.();
    const from = { ...cam };
    const toK = Math.min(fit * MAX_ZOOM, Math.max(fit, fit * zoom));
    if (prefersReducedMotion()) {
      Object.assign(cam, { x, y, k: toK });
      apply();
      return;
    }
    glide = tween(0, 1, 550, (t) => {
      cam.x = from.x + (x - from.x) * t;
      cam.y = from.y + (y - from.y) * t;
      cam.k = from.k + (toK - from.k) * t;
      apply();
    });
  }

  function reset(): void {
    clearSelection();
    focusOn(MAP_W / 2, MAP_H / 2, 1);
  }

  // ---- Notes -------------------------------------------------------------------------------

  function clearSelection(): void {
    info.hidden = true;
    selection.replaceChildren();
  }

  function show(sel: Selection): void {
    selection.replaceChildren();
    for (const d of sel.outlines) {
      selection.append(
        svg('path', { d, class: 'atlas__highlight-shadow' }),
        svg('path', { d, class: 'atlas__highlight' }),
      );
    }
    if (sel.circle) {
      selection.append(
        svg('circle', {
          cx: sel.circle.x,
          cy: sel.circle.y,
          r: sel.circle.r,
          class: 'atlas__highlight',
        }),
      );
    }
    if (!options.notes) return;
    name.textContent = sel.name;
    where.textContent = sel.where;
    text.textContent = sel.text;
    links.replaceChildren(
      ...sel.links.map((l) =>
        h('button', { class: 'chip', type: 'button', onclick: () => openPlace(l.name) }, l.label),
      ),
    );
    info.hidden = false;
  }

  function openPlace(placeName: string): void {
    const sel = describePlace(placeName);
    if (!sel) return;
    focusOn(sel.x, sel.y, Math.max(cam.k / fit, sel.detail ? 6 : 3));
    show(sel);
  }

  close.addEventListener('click', clearSelection);

  // ---- Pins --------------------------------------------------------------------------------

  const STAR =
    'M0 -9 L2.6 -2.8 L9 -2.8 L3.8 1.2 L5.6 7.6 L0 3.8 L-5.6 7.6 L-3.8 1.2 L-9 -2.8 L-2.6 -2.8 Z';
  const BOAT = 'M-9 1 L9 1 L5 7 L-5 7 Z M0 1 L0 -9 L7 -1 Z';
  const markFor = (pin: MapPin) => {
    if (pin.kind === 'home' || pin.kind === 'here')
      return svg('path', { class: 'atlas-pin__mark', d: STAR });
    if (pin.kind === 'ship') return svg('path', { class: 'atlas-pin__mark', d: BOAT });
    return svg('circle', {
      class: 'atlas-pin__mark',
      r:
        pin.kind === 'chosen' || pin.kind === 'rolled' || pin.kind === 'target'
          ? 6.5
          : pin.kind === 'place'
            ? 4
            : 5,
    });
  };
  const inert = (pin: MapPin) =>
    pin.kind === 'closed' || pin.kind === 'home' || pin.kind === 'ship';

  function setRoutes(routes: readonly MapRoute[]): void {
    const lines: SVGElement[] = [];
    for (const r of routes) {
      // A lane across the map's edge (Sabaody to Fish-Man Island) is drawn off both edges.
      const wraps = Math.abs(r.x1 - r.x2) > MAP_W / 2;
      const segments = wraps
        ? r.x1 > r.x2
          ? [
              [r.x1, r.y1, r.x2 + MAP_W, r.y2],
              [r.x1 - MAP_W, r.y1, r.x2, r.y2],
            ]
          : [
              [r.x1, r.y1, r.x2 - MAP_W, r.y2],
              [r.x1 + MAP_W, r.y1, r.x2, r.y2],
            ]
        : [[r.x1, r.y1, r.x2, r.y2]];
      for (const [x1, y1, x2, y2] of segments) {
        lines.push(
          svg('line', {
            class: 'atlas-route',
            x1,
            y1,
            x2,
            y2,
            dataset: { kind: r.kind, danger: String(r.danger), land: String(r.land) },
          }),
        );
      }
    }
    routeLayer.replaceChildren(...lines);
  }

  function setPins(next: readonly MapPin[]): void {
    pins = next;
    pinLayer.replaceChildren(
      ...pins.map((pin) => {
        const interactive = options.onPin !== undefined && !inert(pin);
        const g = svg(
          'g',
          {
            class: 'atlas-pin',
            'data-x': pin.x,
            'data-y': pin.y,
            dataset: { kind: pin.kind, pin: pin.id, labelled: String(pin.labelled === true) },
            role: interactive ? 'button' : 'img',
            tabindex: interactive ? '0' : undefined,
            'aria-label': pin.title,
            'aria-pressed': interactive ? String(pin.kind === 'chosen') : undefined,
          },
          svg('title', null, pin.title),
          svg('circle', { class: 'atlas-pin__halo', r: 13 }),
          markFor(pin),
          svg(
            'text',
            { class: 'atlas-pin__label', x: 0, y: -15, 'text-anchor': 'middle' },
            pin.label,
          ),
        );
        if (interactive) {
          const pick = () => options.onPin?.(pin.id);
          g.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              pick();
            }
          });
        }
        return g;
      }),
    );
    apply();
  }

  const pinAt = (x: number, y: number): MapPin | undefined => {
    const reach = 14 / cam.k;
    let best: MapPin | undefined;
    let bestD = Infinity;
    for (const p of pins) {
      if (p.kind === 'ship') continue;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d <= reach && d < bestD) {
        best = p;
        bestD = d;
      }
    }
    return best;
  };

  // ---- Pointer and keyboard ----------------------------------------------------------------

  const pointers = new Map<
    number,
    { x: number; y: number; sx: number; sy: number; t: number; moved: boolean }
  >();
  let lastTap = 0;

  map.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : 1;
      zoomAt(
        Math.exp(-event.deltaY * unit * (event.ctrlKey ? 0.01 : 0.0015)),
        event.clientX,
        event.clientY,
      );
    },
    { passive: false },
  );
  map.addEventListener('pointerdown', (event) => {
    map.setPointerCapture?.(event.pointerId);
    pointers.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
      sx: event.clientX,
      sy: event.clientY,
      t: performance.now(),
      moved: false,
    });
    if (pointers.size > 1) for (const p of pointers.values()) p.moved = true;
    map.classList.add('is-dragging');
    glide?.();
  });
  const up = (event: PointerEvent) => {
    const p = pointers.get(event.pointerId);
    pointers.delete(event.pointerId);
    if (pointers.size === 0) map.classList.remove('is-dragging');
    if (event.type !== 'pointerup' || !p || p.moved || performance.now() - p.t > 300) return;
    const now = performance.now();
    if (now - lastTap < 350) {
      lastTap = 0;
      reset();
      return;
    }
    lastTap = now;
    const [x, y] = toWorld(event.clientX, event.clientY);
    const pin = pinAt(x, y);
    if (pin && options.onPin && !inert(pin)) {
      options.onPin(pin.id);
      return;
    }
    show(pickAt(x, y, map.classList.contains('is-zoomed'), 9 / cam.k));
  };
  map.addEventListener('pointerup', up);
  map.addEventListener('pointercancel', up);
  map.addEventListener('pointermove', (event) => {
    const p = pointers.get(event.pointerId);
    if (!p) return;
    if (Math.hypot(event.clientX - p.sx, event.clientY - p.sy) > 6) p.moved = true;
    if (pointers.size === 1) {
      cam.x -= (event.clientX - p.x) / cam.k;
      cam.y -= (event.clientY - p.y) / cam.k;
      apply();
    } else {
      const otherId = [...pointers.keys()].find((k) => k !== event.pointerId);
      const o = otherId === undefined ? undefined : pointers.get(otherId);
      if (o) {
        const d0 = Math.hypot(p.x - o.x, p.y - o.y);
        const d1 = Math.hypot(event.clientX - o.x, event.clientY - o.y);
        const w = toWorld((p.x + o.x) / 2, (p.y + o.y) / 2);
        if (d0 > 0 && d1 > 0) cam.k = Math.min(fit * MAX_ZOOM, Math.max(fit, (cam.k * d1) / d0));
        anchor(w, (event.clientX + o.x) / 2, (event.clientY + o.y) / 2);
        apply();
      }
    }
    p.x = event.clientX;
    p.y = event.clientY;
  });
  map.addEventListener('keydown', (event) => {
    const step = 60 / cam.k;
    const keys: Record<string, () => void> = {
      '+': () => zoomCentre(1.3),
      '=': () => zoomCentre(1.3),
      '-': () => zoomCentre(1 / 1.3),
      _: () => zoomCentre(1 / 1.3),
      '0': reset,
      ArrowLeft: () => ((cam.x -= step), apply()),
      ArrowRight: () => ((cam.x += step), apply()),
      ArrowUp: () => ((cam.y -= step), apply()),
      ArrowDown: () => ((cam.y += step), apply()),
      Escape: clearSelection,
    };
    const act = keys[event.key];
    if (!act) return;
    // Escape with nothing selected is not the map's: it closes whatever holds the map.
    if (event.key === 'Escape' && info.hidden && selection.childElementCount === 0) return;
    event.preventDefault();
    event.stopPropagation();
    act();
  });
  zoomIn.addEventListener('click', () => zoomCentre(1.5));
  zoomOut.addEventListener('click', () => zoomCentre(1 / 1.5));
  home.addEventListener('click', reset);

  const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(() => measure()) : null;
  resize?.observe(el);

  return {
    el,
    setPins,
    setRoutes,
    focusOn,
    open: openPlace,
    measure,
    destroy() {
      resize?.disconnect();
      glide?.();
    },
  };
}
