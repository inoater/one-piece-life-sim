import {
  BLUE_NAMES,
  CHANNELS,
  DESIGNS,
  DETAIL_NAMES,
  DRAWN,
  GRAND_LINE_NAMES,
  LOBES,
  NOTES,
  RED_LINE,
  TOWNS,
} from './atlas-data.js';

/**
 * The world map's drawing: sea, Grand Line and Calm Belts, the Red Line, Reverse Mountain, about
 * 150 islands, names and notes. Ported from the map the project owner supplied; its data is copied
 * verbatim into atlas-data.js, and the drawing is the same procedure (seeded, so it is identical
 * every time).
 *
 * Two parts:
 *  - the model, computed once per page: every path, label and place, as plain data;
 *  - `drawAtlas`, which turns the model into SVG for one map on the page.
 *
 * Clicks are resolved with point-in-polygon maths on the model, not by asking the browser what is
 * under the pointer, so picking a place is fast and can be tested without a browser.
 */

export const MAP_W = 2576;
export const MAP_H = 1288;
const NS = 'http://www.w3.org/2000/svg';

type Pt = [number, number];

// ---- Geometry ------------------------------------------------------------------------------

function rng(seed: number): () => number {
  let s = Math.imul(seed | 0, 2654435761) >>> 0 || 1;
  const next = () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return s >>> 0;
  };
  for (let i = 0; i < 5; i++) next();
  return () => next() / 4294967296;
}
const f1 = (n: number) => Math.round(n * 10) / 10;
const polyD = (p: readonly Pt[]) => `M${p.map((q) => `${f1(q[0])} ${f1(q[1])}`).join('L')}Z`;
function smooth(p: readonly Pt[]): string {
  const n = p.length;
  const mid = (a: Pt, b: Pt): Pt => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const start = mid(p[n - 1] as Pt, p[0] as Pt);
  let d = `M${f1(start[0])} ${f1(start[1])}`;
  for (let i = 0; i < n; i++) {
    const e = mid(p[i] as Pt, p[(i + 1) % n] as Pt);
    d += `Q${f1((p[i] as Pt)[0])} ${f1((p[i] as Pt)[1])} ${f1(e[0])} ${f1(e[1])}`;
  }
  return `${d}Z`;
}
function noise1(seed: number, scale: number): (x: number) => number {
  const r = rng(seed);
  const v: number[] = [];
  for (let i = 0; i < Math.ceil(MAP_W / scale) + 4; i++) v.push(r() * 2 - 1);
  return (x) => {
    const c = Math.min(MAP_W, Math.max(0, x));
    const t = c / scale;
    const i = Math.floor(t);
    const f = t - i;
    const u = f * f * (3 - 2 * f);
    return (v[i] ?? 0) * (1 - u) + (v[i + 1] ?? 0) * u;
  };
}
function bandPath(y0: number, y1: number, seed: number, amp: number): string {
  const fa = noise1(seed, 90);
  const fb = noise1(seed + 1, 23);
  const fc = noise1(seed + 2, 90);
  const fd = noise1(seed + 3, 23);
  const top: Pt[] = [];
  const bottom: Pt[] = [];
  for (let x = -10; x <= MAP_W + 10; x += 10) {
    top.push([x, y0 + amp * (fa(x) + 0.35 * fb(x))]);
    bottom.push([x, y1 + amp * (fc(x) + 0.35 * fd(x))]);
  }
  return polyD(top.concat(bottom.reverse()));
}
function jag(
  poly: readonly (readonly [number, number])[],
  seed: number,
  rough: number,
  minL: number,
): Pt[] {
  const r = rng(seed);
  const out: Pt[] = [];
  const split = (a: Pt, b: Pt): void => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (len < minL) {
      out.push(a);
      return;
    }
    const o = (r() - 0.5) * 2 * rough * len;
    const m: Pt = [(a[0] + b[0]) / 2 - (dy / len) * o, (a[1] + b[1]) / 2 + (dx / len) * o];
    split(a, m);
    split(m, b);
  };
  poly.forEach((a, i) => {
    const b = poly[(i + 1) % poly.length] as readonly [number, number];
    const onFrame =
      (a[0] === b[0] && (a[0] <= 0 || a[0] >= MAP_W)) ||
      (a[1] === b[1] && (a[1] <= 0 || a[1] >= MAP_H));
    if (onFrame) out.push([a[0], a[1]]);
    else split([a[0], a[1]], [b[0], b[1]]);
  });
  return out;
}
function blobPts(x: number, y: number, rx: number, ry: number, rot: number, seed: number): Pt[] {
  const r = rng(seed * 977 + 11);
  const q = (rot * Math.PI) / 180;
  const c = Math.cos(q);
  const sn = Math.sin(q);
  const n = Math.max(12, Math.min(56, Math.round((rx + ry) / 2.6)));
  const big = rx + ry > 60;
  const ph = [r() * 6.3, r() * 6.3, r() * 6.3, r() * 6.3, r() * 6.3];
  const am = big ? [0.15, 0.12, 0.08, 0.06, 0.04] : [0.1, 0.08, 0.05, 0.03, 0.02];
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 6.2832;
    let k = 1;
    for (let hh = 0; hh < 5; hh++)
      k += (am[hh] as number) * Math.sin(a * (hh + 2) + (ph[hh] as number));
    k += (r() - 0.5) * (big ? 0.09 : 0.06);
    const px = Math.cos(a) * rx * k;
    const py = Math.sin(a) * ry * k;
    pts.push([x + px * c - py * sn, y + px * sn + py * c]);
  }
  return pts;
}
function spiralPts(cx: number, cy: number, ws: number): Pt[] {
  const o: Pt[] = [];
  const inner: Pt[] = [];
  for (let th = 0.3; th <= 13.6; th += 0.1) {
    const r = 12 + (17 * th) / Math.PI;
    const w = (8 + (2.4 * th) / Math.PI) * ws;
    const jr = (Math.sin(th * 7) + Math.sin(th * 3.3)) * 0.8 * ws;
    o.push([cx + (r + w / 2 + jr) * Math.cos(th), cy + (r + w / 2 + jr) * Math.sin(th)]);
    inner.push([cx + (r - w / 2 - jr) * Math.cos(th), cy + (r - w / 2 - jr) * Math.sin(th)]);
  }
  return o.concat(inner.reverse());
}
const circlePath = (x: number, y: number, rad: number) =>
  `M${f1(x - rad)} ${f1(y)}a${f1(rad)} ${f1(rad)} 0 1 0 ${f1(2 * rad)} 0a${f1(rad)} ${f1(rad)} 0 1 0 ${f1(-2 * rad)} 0`;

/** Is (x, y) inside the polygon? Even-odd ray casting. */
export function insidePolygon(
  x: number,
  y: number,
  poly: readonly (readonly [number, number])[],
): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i] as readonly [number, number];
    const [xj, yj] = poly[j] as readonly [number, number];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// ---- The model -----------------------------------------------------------------------------

const COLOURS: Record<string, [string, string, string, string, string]> = {
  g: ['#6a9a3b', '#76a643', '#86b34d', '#2e561e', '#c4e178'],
  o: ['#85853a', '#929245', '#a1a152', '#46461a', '#d6d684'],
  t: ['#bd8553', '#c99562', '#d6a672', '#7a4a22', '#f0cfa0'],
  d: ['#3b6a2f', '#487a3a', '#568a45', '#1d3a16', '#9cc47a'],
  p: ['#e089b4', '#e99bc2', '#f0b0cf', '#8f3a63', '#ffd2e6'],
};

interface Lobe {
  d: string;
  pts: Pt[];
  x: number;
  y: number;
  rx: number;
  ry: number;
}

export interface Label {
  text: string;
  x: number;
  y: number;
  size: number;
  className?: string;
  style?: string;
  transform?: string;
  textLength?: number;
}

export interface Place {
  name: string;
  x: number;
  /** Where clicks count (labels sit below small islands, so this is slightly above). */
  ay: number;
  r: number;
  kind: string;
  parent: string | undefined;
  note: string | undefined;
  /** Shown only when zoomed in. */
  detail: boolean;
}

interface Model {
  seaBlobs: { cx: number; cy: number; rx: number; ry: number; dark: boolean }[];
  bands: { d: string; fill: string; opacity: number }[];
  redPaths: string[];
  redBlobs: { cx: number; cy: number; rx: number; ry: number; dark: boolean }[];
  land: {
    outline: string;
    layers: Record<string, { b: string; h1: string; h2: string; dk: string; lt: string }>;
  };
  designs: {
    name: string;
    x: number;
    y: number;
    scale: number;
    layers: (typeof DESIGNS)[string]['L'];
    k: number;
  }[];
  labels: Label[];
  lobes: Lobe[];
  places: Place[];
  notes: Map<string, { kind: string; parent: string | undefined; text: string }>;
}

let cached: Model | null = null;

function buildModel(): Model {
  const seaBlobs: Model['seaBlobs'] = [];
  {
    const r = rng(5);
    for (let i = 0; i < 46; i++) {
      seaBlobs.push({
        cx: r() * MAP_W,
        cy: r() * MAP_H,
        rx: 140 + r() * 260,
        ry: 90 + r() * 170,
        dark: !(r() < 0.5),
      });
    }
  }
  const bands: Model['bands'] = [
    { d: bandPath(528, 800, 11, 10), fill: '#8fcbe0', opacity: 0.28 },
    { d: bandPath(545, 782, 12, 6), fill: '#86c6dc', opacity: 0.78 },
    { d: bandPath(566, 754, 13, 5), fill: '#5ea4c2', opacity: 0.9 },
    { d: bandPath(581, 739, 14, 3.5), fill: '#2b6784', opacity: 1 },
  ];
  const redPaths = RED_LINE.map((poly, i) => polyD(jag(poly, 31 + i * 7, 0.05, 8)));
  const redBlobs: Model['redBlobs'] = [];
  {
    const r = rng(8);
    for (let i = 0; i < 90; i++) {
      const k = r();
      const x = k < 0.4 ? r() * 215 : k < 0.7 ? 2380 + r() * 196 : 1000 + r() * 500;
      redBlobs.push({
        cx: x,
        cy: r() * MAP_H,
        rx: 25 + r() * 70,
        ry: 20 + r() * 60,
        dark: !(r() < 0.5),
      });
    }
  }

  // Islands
  const layers: Record<
    string,
    { b: string[]; h1: string[]; h2: string[]; dk: string[]; lt: string[] }
  > = {};
  for (const key of Object.keys(COLOURS)) layers[key] = { b: [], h1: [], h2: [], dk: [], lt: [] };
  const outline: string[] = [];
  const lobes: Lobe[] = [];
  let seed = 1;
  const lobe = (x: number, y: number, rx: number, ry: number, rot = 0, type = 'g') => {
    const L = layers[type] ?? (layers['g'] as (typeof layers)[string]);
    const s = seed++;
    const pts = blobPts(x, y, rx, ry, rot, s);
    const d = smooth(pts);
    outline.push(d);
    L.b.push(d);
    lobes.push({ d, pts, x, y, rx, ry });
    if (rx > 16 && ry > 9) {
      const scaled = (k: number, dx: number, dy: number) =>
        smooth(pts.map((p): Pt => [x + (p[0] - x) * k + dx, y + (p[1] - y) * k + dy]));
      L.h1.push(scaled(0.72, -rx * 0.04, -ry * 0.06));
      if (rx > 28 && ry > 16) L.h2.push(scaled(0.4, -rx * 0.06, -ry * 0.09));
    }
    const dots = Math.min(24, Math.floor((rx * ry) / 280));
    if (dots > 0) {
      const r = rng(s * 31 + 7);
      const q = (rot * Math.PI) / 180;
      const c = Math.cos(q);
      const sn = Math.sin(q);
      for (let i = 0; i < dots * 2; i++) {
        const a = r() * 6.283;
        const dd = Math.sqrt(r()) * 0.5;
        const lx = Math.cos(a) * dd * rx;
        const ly = Math.sin(a) * dd * ry;
        const px = x + lx * c - ly * sn;
        const py = y + lx * sn + ly * c;
        const rad = 1.4 + r() * Math.min(5, rx * 0.1);
        (i % 2 ? L.dk : L.lt).push(circlePath(px, py, rad));
      }
    }
  };
  for (const spec of LOBES.split(';')) {
    const a = spec.trim().split(/\s+/);
    if (a.length < 4) continue;
    lobe(
      Number(a[0]),
      Number(a[1]),
      Number(a[2]),
      Number(a[3]),
      Number(a[4] ?? 0) || 0,
      a[5] ?? 'g',
    );
  }
  {
    // Whole Cake Island's spiral
    const cx = 440;
    const cy = 1128;
    const pts = spiralPts(cx, cy, 1);
    const d = smooth(pts);
    outline.push(d);
    lobes.push({ d, pts, x: cx, y: cy, rx: 90, ry: 90 });
    const L = layers['o'] as (typeof layers)[string];
    L.b.push(d);
    L.h1.push(smooth(spiralPts(cx, cy, 0.55)));
    const r = rng(444);
    for (let i = 0; i < 60; i++) {
      const th = 0.6 + r() * 12.6;
      const rr = 12 + (17 * th) / Math.PI;
      const rad = 1.4 + r() * 2.4;
      (i % 2 ? L.dk : L.lt).push(circlePath(cx + rr * Math.cos(th), cy + rr * Math.sin(th), rad));
    }
  }

  // Labels, keeping boxes so scattered islets avoid them
  const labels: Label[] = [];
  const boxes: [number, number, number, number][] = [];
  const label = (
    text: string,
    x: number,
    y: number,
    size: number,
    extra: Partial<Label> & { nobox?: boolean } = {},
  ) => {
    const { nobox, ...rest } = extra;
    labels.push({ text, x, y, size, ...rest });
    if (!nobox) {
      const w = text.length * size * 0.5 + 4;
      boxes.push([x - w / 2, x + w / 2, y - size, y + 3]);
    }
  };
  for (const s of GRAND_LINE_NAMES) {
    const [name = '', xs = '0', ys = '0'] = s.split('|');
    const x = Number(xs);
    const y = Number(ys);
    if (name === 'Wano Kingdom') continue;
    if (y > 560 && y < 770 && !DRAWN.has(name)) {
      lobe(x, y - 14, 8, 6, 0, 'g');
      boxes.push([x - 9, x + 9, y - 22, y - 8]);
    }
    label(name, x, y, 10.5);
  }
  for (const s of BLUE_NAMES) {
    const [name = '', x = '0', y = '0', size = '12'] = s.split('|');
    label(name, Number(x), Number(y), Number(size));
  }
  label('WANO KINGDOM', 853, 614, 11.5, { style: 'fill:#4a2b14' });
  for (const [name, x, y] of DETAIL_NAMES) label(name, x, y, 7.5, { className: 'det' });

  const designs: Model['designs'] = [];
  for (const [name, x, y, w, ow] of [
    ['Dressrossa Kingdom', 227, 708, 27, 1.6],
    ['Punk Hazard', 141, 709, 17, 1.6],
    ['G5', 84, 716, 8, 1.3],
    ['Fish-Man Island', 59, 670, 10, 1.3],
    ['Boin Archipelago', 1465, 713, 51, 1.0],
    ['Sandy Island', 1628, 614, 40, 1.8],
    ['Long Ring Long Land', 1867.5, 627.5, 18, 0.9],
    ['Enies Lobby', 2242.5, 686.5, 27, 1.6],
    ['Impel Down', 2296, 742.5, 14, 1.6],
  ] as const) {
    const design = DESIGNS[name];
    if (!design) continue;
    const scale = (w - 2 * ow) / 200;
    designs.push({ name, x, y, scale, layers: design.L, k: 1 / scale });
    const hgt = w * design.a;
    boxes.push([x - w / 2 - 3, x + w / 2 + 3, y - hgt / 2 - 3, y + hgt / 2 + 3]);
  }

  {
    // Scattered islets across the Grand Line, kept clear of labels
    const r = rng(2024);
    const free = (x: number, y: number, rad: number) =>
      !boxes.some((b) => x + rad > b[0] && x - rad < b[1] && y + rad > b[2] && y - rad < b[3]);
    let placed = 0;
    for (let i = 0; i < 4000 && placed < 200; i++) {
      const x = r() < 0.46 ? 115 + r() * 1045 : 1365 + r() * 1105;
      const y = 592 + r() * 140;
      const rad = 2.5 + r() * r() * 8;
      if (!free(x, y, rad + 4)) continue;
      lobe(x, y, rad * 1.25, rad * 0.9, r() * 180, r() < 0.12 ? 'o' : 'g');
      placed++;
    }
  }

  // Titles and regions
  const TF = 'font-family:var(--font-text),Georgia,serif;';
  const title = (
    text: string,
    x: number,
    y: number,
    size: number,
    fill: string,
    halo: string,
    hw: number,
    tl: number,
  ) => {
    label(text, x + 2, y + 3, size, {
      style: `${TF}fill:#06283c;stroke:none;opacity:.32`,
      nobox: true,
      textLength: tl,
    });
    label(text, x, y, size, {
      style: `${TF}fill:${fill};stroke:${halo};stroke-width:${hw}px`,
      nobox: true,
      textLength: tl,
    });
  };
  title('North Blue', 262, 50, 64, '#0b6aa4', '#cfe9f5', 5, 227);
  title('East Blue', 2290, 50, 64, '#0b6aa4', '#cfe9f5', 5, 200);
  title('West Blue', 277, 1280, 68, '#0b6aa4', '#cfe9f5', 5, 220);
  title('South Blue', 2365, 1280, 68, '#0b6aa4', '#cfe9f5', 5, 232);
  title('RED', 1242, 330, 115, '#5a1c24', '#e8a0a6', 6, 140);
  title('LINE', 1256, 440, 115, '#5a1c24', '#e8a0a6', 6, 168);
  label('Reverse Mountain', 1320, 656, 14, {
    style: 'fill:#fbe3e5;stroke:#5a1c24;stroke-width:3px',
    nobox: true,
  });
  label('New World', 160, 590, 28, { style: `${TF}fill:#0a5c88;stroke:#cfe9f5;stroke-width:3px` });
  label('Paradise', 1432, 590, 28, { style: `${TF}fill:#0a5c88;stroke:#cfe9f5;stroke-width:3px` });
  label('Sambas Region', 1940, 505, 20, {
    style: 'font-style:italic;fill:#173f5c;stroke:none',
    transform: 'rotate(9 1940 505)',
  });
  label('Florian Triangle', 2310, 620, 17, {
    style: 'font-style:italic;fill:#e8f4fa;stroke:#173f5c;stroke-width:3px',
    transform: 'rotate(20 2310 620)',
  });
  label('Las Camp Region', 472, 1232, 20, {
    style: 'font-style:italic;fill:#173f5c;stroke:none',
    transform: 'rotate(-8 472 1232)',
  });
  for (const [xs, y] of [
    [[317, 386, 456, 527, 678, 747, 815, 883], 563],
    [[317, 386, 456, 527, 678, 747, 815, 883], 760],
    [[1562, 1631, 1701, 1773, 1923, 1993, 2060, 2128], 557],
    [[1570, 1640, 1709, 1780, 1931, 2001, 2068, 2135], 751],
  ] as const) {
    'CALMBELT'.split('').forEach((ch, i) =>
      label(ch, xs[i] ?? 0, y + 8, 24, {
        style: `${TF}fill:#16405a;stroke:rgba(255,255,255,.5);stroke-width:2px`,
        nobox: true,
      }),
    );
  }

  // Places and their notes
  const notes = new Map<string, { kind: string; parent: string | undefined; text: string }>();
  for (const line of NOTES.split('\n')) {
    const [name = '', kind = '', parent = '', text = ''] = line.split('|');
    if (name) notes.set(name, { kind, parent: parent || undefined, text });
  }
  const kindOf = (n: string) =>
    /Kingdom|Country/.test(n)
      ? 'Kingdom'
      : /Village/.test(n)
        ? 'Village'
        : /Town/.test(n)
          ? 'Town'
          : /Island/.test(n)
            ? 'Island'
            : 'Place';
  const places: Place[] = [];
  const place = (
    name: string,
    x: number,
    y: number,
    r: number,
    ay: number | null = null,
    detail = false,
  ) => {
    const note = notes.get(name);
    places.push({
      name,
      x,
      ay: ay ?? y,
      r: note?.parent ? Math.min(r, 16) : r,
      kind: note?.kind || kindOf(name),
      parent: note?.parent,
      note: note?.text || undefined,
      detail,
    });
  };
  for (const s of GRAND_LINE_NAMES) {
    const [name = '', xs = '0', ys = '0'] = s.split('|');
    const x = Number(xs);
    const y = Number(ys);
    if (DRAWN.has(name)) place(name, x, y, 40);
    else if (y > 560 && y < 770) place(name, x, y, 14, y - 14);
    else place(name, x, y, 40, y - 8);
  }
  for (const s of BLUE_NAMES) {
    const [name = '', x = '0', y = '0', size = '12'] = s.split('|');
    const f = Number(size);
    place(name, Number(x), Number(y), f > 15 ? 140 : f > 12 ? 90 : 50);
  }
  for (const [name, x, y] of DETAIL_NAMES) place(name, x, y, 10, null, true);
  place('Reverse Mountain', 1248, 660, 26);
  place('Reverse Mountain', 1320, 656, 30);

  const L = (k: string) => layers[k] as (typeof layers)[string];
  return {
    seaBlobs,
    bands,
    redPaths,
    redBlobs,
    land: {
      outline: outline.join(''),
      layers: Object.fromEntries(
        Object.keys(COLOURS).map((k) => [
          k,
          {
            b: L(k).b.join(''),
            h1: L(k).h1.join(''),
            h2: L(k).h2.join(''),
            dk: L(k).dk.join(''),
            lt: L(k).lt.join(''),
          },
        ]),
      ),
    },
    designs,
    labels,
    lobes,
    places,
    notes,
  };
}

export function atlasModel(): Model {
  return (cached ??= buildModel());
}

// ---- Asking the map what is where ----------------------------------------------------------

export type Region =
  'Red Line' | 'New World' | 'Paradise' | 'North Blue' | 'East Blue' | 'West Blue' | 'South Blue';

const RED_POLYS = RED_LINE as readonly (readonly (readonly [number, number])[])[];
const onRedLine = (x: number, y: number) => RED_POLYS.some((poly) => insidePolygon(x, y, poly));

export function regionAt(x: number, y: number): Region {
  if (onRedLine(x, y)) return 'Red Line';
  if (y > 560 && y < 770) return x < 1248 ? 'New World' : 'Paradise';
  if (y < 644) return x < 1248 ? 'North Blue' : 'East Blue';
  return x < 1248 ? 'West Blue' : 'South Blue';
}

const inRegion = (r: Region) =>
  r === 'Red Line' ? 'on the Red Line' : r === 'New World' ? 'in the New World' : `in ${r}`;

export interface Selection {
  name: string;
  /** "Kingdom in the New World" */
  where: string;
  text: string;
  /** Places to go next: inside this one, or the one it is part of. */
  links: { label: string; name: string }[];
  /** Outlines to highlight (island shapes), or a circle when there is no shape. */
  outlines: string[];
  circle: { x: number; y: number; r: number } | null;
  /** Where to centre the view, and the zoom it wants. */
  x: number;
  y: number;
  detail: boolean;
}

function owner(model: Model, l: Lobe): Place | null {
  let best: Place | null = null;
  let bestScore = 1;
  for (const p of model.places) {
    if (p.detail) continue;
    const s =
      Math.max(0, Math.hypot(l.x - p.x, l.y - p.ay) - Math.min(60, Math.max(l.rx, l.ry) * 0.6)) /
      p.r;
    if (s <= bestScore) {
      bestScore = s;
      best = p;
    }
  }
  return best;
}

function lobeAt(model: Model, x: number, y: number, tol: number): Lobe | null {
  for (let i = model.lobes.length - 1; i >= 0; i--) {
    const l = model.lobes[i] as Lobe;
    const m = Math.max(l.rx, l.ry);
    if (Math.abs(x - l.x) > m * 1.5 + tol || Math.abs(y - l.y) > m * 1.5 + tol) continue;
    if (m < 14 && Math.hypot(x - l.x, y - l.y) <= m + tol) return l;
    if (insidePolygon(x, y, l.pts)) return l;
  }
  return null;
}

/** Everything the info panel says about a named place. */
export function describePlace(name: string): Selection | null {
  const model = atlasModel();
  const p = model.places.find((q) => q.name === name);
  if (p) return selectionFor(model, p);
  const note = model.notes.get(name);
  if (!note) return null;
  return {
    name,
    where: note.kind,
    text: note.text,
    links: [],
    outlines: [],
    circle: null,
    x: MAP_W / 2,
    y: MAP_H / 2,
    detail: false,
  };
}

function selectionFor(model: Model, p: Place): Selection {
  const mine = model.lobes.filter((l) => owner(model, l) === p).map((l) => l.d);
  const children = [...new Set(model.places.filter((q) => q.parent === p.name).map((q) => q.name))];
  const links = children.map((n) => ({ label: n, name: n }));
  if (p.parent) links.unshift({ label: `Part of ${p.parent}`, name: p.parent });
  return {
    name: p.name,
    where: `${p.kind} ${inRegion(regionAt(p.x, p.ay))}`,
    text:
      p.note ??
      (p.parent
        ? `Listed under ${p.parent} on this map.`
        : 'This chart marks it, but there are no notes for it yet.'),
    links,
    outlines: mine,
    circle: mine.length > 0 ? null : { x: p.x, y: p.ay, r: Math.min(p.r, 30) * 0.5 + 6 },
    x: p.x,
    y: p.ay,
    detail: p.detail,
  };
}

/** What is at map point (x, y)? `zoomedIn` includes the small names; `tol` is the click slop. */
export function pickAt(x: number, y: number, zoomedIn: boolean, tol: number): Selection {
  const model = atlasModel();
  let best: Place | null = null;
  let bestScore = 1;
  for (const p of model.places) {
    if (p.detail && !zoomedIn) continue;
    const s = Math.hypot(x - p.x, y - p.ay) / Math.max(p.r, tol);
    if (s <= bestScore) {
      bestScore = s;
      best = p;
    }
  }
  if (best) return selectionFor(model, best);
  const l = lobeAt(model, x, y, tol);
  if (l) {
    const o = owner(model, l);
    if (o) return selectionFor(model, o);
    const region = regionAt(x, y);
    return {
      name: 'Unnamed island',
      where: `${y > 560 && y < 770 ? 'Islet' : 'Island'} ${inRegion(region)}`,
      text: 'The chart draws this island but does not name it.',
      links: [],
      outlines: [l.d],
      circle: null,
      x,
      y,
      detail: false,
    };
  }
  const sea = onRedLine(x, y)
    ? 'Red Line'
    : y >= 581 && y <= 739
      ? x < 1248
        ? 'New World'
        : 'Paradise'
      : y >= 528 && y <= 800
        ? 'Calm Belt'
        : regionAt(x, y);
  const note = model.notes.get(sea);
  return {
    name: sea,
    where: note?.kind ?? 'Sea',
    text: note?.text ?? '',
    links: [],
    outlines: [],
    circle: null,
    x,
    y,
    detail: false,
  };
}

// ---- Drawing -------------------------------------------------------------------------------

function el<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> | null,
  parent: Element | null,
  style?: string,
): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (style) e.setAttribute('style', style);
  if (parent) parent.appendChild(e);
  return e;
}

let texture: string | null | undefined;

/** The paper grain over the map, painted once with canvas noise (no image file). */
function paperTexture(): string | null {
  if (texture !== undefined) return texture;
  try {
    const w = 1024;
    const hgt = 512;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = hgt;
    const g = canvas.getContext('2d');
    if (!g) return (texture = null);
    const image = g.createImageData(w, hgt);
    const d = image.data;
    const r = rng(77);
    const octaves: [number, number][] = [
      [96, 0.42],
      [40, 0.28],
      [16, 0.18],
      [6, 0.12],
    ];
    const grids = octaves.map(([cs]) => {
      const gw = Math.ceil(w / cs) + 2;
      const gh = Math.ceil(hgt / cs) + 2;
      const a = new Float32Array(gw * gh);
      for (let i = 0; i < a.length; i++) a[i] = r();
      return { cs, gw, a };
    });
    for (let y = 0; y < hgt; y++) {
      for (let x = 0; x < w; x++) {
        let n = 0;
        for (let k = 0; k < 4; k++) {
          const o = grids[k] as (typeof grids)[number];
          const fx = x / o.cs;
          const fy = y / o.cs;
          const ix = fx | 0;
          const iy = fy | 0;
          const tx = fx - ix;
          const ty = fy - iy;
          const ux = tx * tx * (3 - 2 * tx);
          const uy = ty * ty * (3 - 2 * ty);
          const i = iy * o.gw + ix;
          const a = o.a;
          n +=
            ((a[i] ?? 0) * (1 - ux) * (1 - uy) +
              (a[i + 1] ?? 0) * ux * (1 - uy) +
              (a[i + o.gw] ?? 0) * (1 - ux) * uy +
              (a[i + o.gw + 1] ?? 0) * ux * uy) *
            (octaves[k] as [number, number])[1];
        }
        const s = (n - 0.5) * 2.6 + (r() - 0.5) * 0.3;
        const alpha = Math.min(0.2, Math.abs(s) * 0.26);
        const p = (y * w + x) * 4;
        if (s > 0) {
          d[p] = 255;
          d[p + 1] = 248;
          d[p + 2] = 228;
        } else {
          d[p] = 14;
          d[p + 1] = 26;
          d[p + 2] = 36;
        }
        d[p + 3] = alpha * 255;
      }
    }
    g.putImageData(image, 0, 0);
    texture = canvas.toDataURL('image/png');
  } catch {
    texture = null;
  }
  return texture;
}

let instances = 0;

/**
 * Draw the whole map into `root` (an <svg> whose viewBox the caller controls). Returns the group
 * that the caller can put its own pins and highlights in, above the land and below the names.
 */
export function drawAtlas(root: SVGSVGElement): { overlay: SVGGElement; labels: SVGGElement } {
  const model = atlasModel();
  const id = `atlas${++instances}`;
  const defs = el('defs', null, root);
  const gradient = (name: string, colour: string, opacity: number) => {
    const g = el('radialGradient', { id: `${id}-${name}` }, defs);
    el('stop', { offset: 0, 'stop-color': colour, 'stop-opacity': opacity }, g);
    el('stop', { offset: 1, 'stop-color': colour, 'stop-opacity': 0 }, g);
  };
  gradient('sL', '#9ad0e2', 0.2);
  gradient('sD', '#1d4f69', 0.22);
  gradient('rL', '#d27a7f', 0.3);
  gradient('rD', '#5a1c24', 0.32);
  const clip = el('clipPath', { id: `${id}-red` }, defs);

  const sea = el('g', null, root);
  const band = el('g', null, root);
  const red = el('g', null, root);
  const channels = el('g', null, root);
  const land = el('g', null, root);
  const icons = el('g', null, root);
  const grain = el('g', { 'pointer-events': 'none' }, root);
  const overlay = el('g', { class: 'atlas__overlay' }, root);
  const names = el('g', { class: 'atlas__names' }, root);

  el('rect', { width: MAP_W, height: MAP_H, fill: '#437f9d' }, sea);
  for (const b of model.seaBlobs) {
    el(
      'ellipse',
      { cx: b.cx, cy: b.cy, rx: b.rx, ry: b.ry, fill: `url(#${id}-${b.dark ? 'sD' : 'sL'})` },
      sea,
    );
  }
  for (const b of model.bands)
    el('path', { d: b.d, fill: b.fill, 'fill-opacity': b.opacity }, band);

  for (const d of model.redPaths) {
    el('path', { d }, clip);
    el('path', { d, fill: '#a8434b' }, red);
  }
  const redClipped = el('g', { 'clip-path': `url(#${id}-red)` }, red);
  for (const d of model.redPaths) {
    el(
      'path',
      {
        d,
        fill: 'none',
        stroke: '#6d232b',
        'stroke-width': 34,
        'stroke-opacity': 0.28,
        'stroke-linejoin': 'round',
      },
      redClipped,
    );
  }
  for (const b of model.redBlobs) {
    el(
      'ellipse',
      { cx: b.cx, cy: b.cy, rx: b.rx, ry: b.ry, fill: `url(#${id}-${b.dark ? 'rD' : 'rL'})` },
      redClipped,
    );
  }
  for (const d of model.redPaths) {
    el(
      'path',
      { d, fill: 'none', stroke: '#5a1c24', 'stroke-width': 3, 'stroke-linejoin': 'round' },
      red,
    );
  }

  for (const d of CHANNELS)
    el('path', { d, fill: 'none', stroke: '#1f5870', 'stroke-width': 10 }, channels);
  for (const d of CHANNELS)
    el('path', { d, fill: 'none', stroke: '#5da7c2', 'stroke-width': 5 }, channels);
  el(
    'circle',
    { cx: 1248, cy: 660, r: 16, fill: '#4d93b0', stroke: '#1f5870', 'stroke-width': 4 },
    channels,
  );
  el(
    'circle',
    { cx: 1248, cy: 660, r: 7, fill: '#7fc0d6', stroke: '#1f5870', 'stroke-width': 2 },
    channels,
  );

  el(
    'path',
    {
      d: model.land.outline,
      fill: 'none',
      stroke: '#2c3b1e',
      'stroke-width': 4,
      'stroke-linejoin': 'round',
    },
    land,
  );
  for (const [k, layer] of Object.entries(model.land.layers)) {
    const c = COLOURS[k] as (typeof COLOURS)[string];
    el('path', { d: layer.b, fill: c[0] }, land);
    el('path', { d: layer.h1, fill: c[1] }, land);
    el('path', { d: layer.h2, fill: c[2] }, land);
    el('path', { d: layer.dk, fill: c[3], 'fill-opacity': 0.28 }, land);
    el('path', { d: layer.lt, fill: c[4], 'fill-opacity': 0.28 }, land);
  }

  // Hand-traced islands
  for (const design of model.designs) {
    const g = el(
      'g',
      { transform: `translate(${design.x} ${design.y}) scale(${design.scale})` },
      icons,
    );
    const k = design.k;
    for (const l of design.layers) {
      if (l[0] === 'b') {
        el(
          'path',
          {
            d: l[3],
            fill: l[2],
            stroke: l[1],
            'stroke-width': 2 * l[4] * k,
            'stroke-linejoin': 'round',
            'fill-rule': 'evenodd',
            'paint-order': 'stroke',
          },
          g,
        );
      } else if (l[0] === 'f') {
        el('path', { d: l[2], fill: l[1], 'fill-rule': 'evenodd' }, g);
      } else if (l[0] === 'dm') {
        const [, x, y, size] = l;
        const r = Math.max(size, 1.7 * k);
        const R = r * 1.9;
        const q = (a: number) => `M${x} ${y - a}L${x + a} ${y}L${x} ${y + a}L${x - a} ${y}Z`;
        el('path', { d: q(R), fill: 'none', stroke: '#d02a2e', 'stroke-width': 0.9 * k }, g);
        el(
          'path',
          {
            d: q(r),
            fill: '#d02a2e',
            stroke: '#4b1018',
            'stroke-width': 0.9 * k,
            'stroke-linejoin': 'round',
          },
          g,
        );
      } else {
        const [, x, y, size] = l;
        const r = Math.max(size, 2.6 * k);
        el(
          'circle',
          { cx: x, cy: y, r, fill: '#f3c93a', stroke: '#7a5a10', 'stroke-width': 1.2 * k },
          g,
        );
        el('circle', { cx: x, cy: y, r: r * 0.42, fill: '#fff6c8' }, g);
      }
    }
  }

  // Icons: clouds, towns, rails, landmarks
  const cloud = (x: number, y: number, s: number, colour = '#fff') => {
    const g = el('g', { transform: `translate(${x} ${y}) scale(${s})` }, icons);
    const parts: [number, number, number][] = [
      [-7, 2, 6],
      [0, -2, 8],
      [8, 2, 6],
      [0, 4, 7],
    ];
    for (const [cx, cy, r] of parts)
      el('circle', { cx, cy, r, fill: colour, stroke: '#8fb6c9', 'stroke-width': 1.2 }, g);
    for (const [cx, cy, r] of parts) el('circle', { cx, cy, r: r - 0.7, fill: colour }, g);
  };
  el(
    'path',
    {
      d: 'M2030 622L2086 692L2230 686M2096 622L2230 686M2062 654L2096 622',
      fill: 'none',
      stroke: '#a9c3cf',
      'stroke-width': 1.3,
      'stroke-opacity': 0.7,
    },
    icons,
  );
  el(
    'circle',
    { cx: 22, cy: 665, r: 10, fill: '#2a2b3d', stroke: '#0d0e18', 'stroke-width': 2 },
    icons,
  );
  el('path', { d: 'M22 656V674M13 665H31', stroke: '#c9c9d6', 'stroke-width': 1.6 }, icons);
  {
    const outer = smooth(blobPts(853, 642, 34, 24, 0, 901));
    const inner = smooth(blobPts(853, 642, 17, 11, 0, 902));
    el(
      'path',
      {
        d: outer + inner,
        fill: '#7f9a62',
        stroke: '#2c3b1e',
        'stroke-width': 2.4,
        'fill-rule': 'evenodd',
      },
      icons,
    );
    for (const [x, y] of [
      [836, 652],
      [862, 626],
      [872, 640],
      [880, 652],
      [848, 675],
    ] as const) {
      el(
        'circle',
        { cx: x, cy: y, r: 3, fill: '#e0562a', stroke: '#3a1408', 'stroke-width': 1 },
        icons,
      );
    }
    el(
      'path',
      {
        d: smooth(blobPts(848, 684, 9, 6, 0, 903)),
        fill: '#6a9a3b',
        stroke: '#2c3b1e',
        'stroke-width': 2,
      },
      icons,
    );
  }
  cloud(1782, 616, 1.4);
  cloud(1758, 636, 1);
  cloud(1800, 654, 1.1);
  cloud(1780, 646, 0.8, '#f6efc8');
  cloud(1919, 564, 1.2, '#eef6fa');
  cloud(735, 622, 1.2);
  cloud(750, 619, 0.9);
  cloud(1131, 664, 1.15, '#f2f6f8');
  el(
    'path',
    {
      d: 'M2340 677A9 9 0 1 0 2340 695A5 9 0 1 1 2340 677Z',
      fill: '#8aa0b2',
      stroke: '#34495a',
      'stroke-width': 1.8,
    },
    icons,
  );
  el(
    'path',
    {
      d: smooth(blobPts(2307, 626, 11, 8, 0, 905)),
      fill: '#3d3a48',
      stroke: '#14121a',
      'stroke-width': 2,
    },
    icons,
  );
  el(
    'circle',
    { cx: 2096, cy: 622, r: 4, fill: '#b8452b', stroke: '#3a1408', 'stroke-width': 1.2 },
    icons,
  );
  el(
    'path',
    {
      d: smooth(blobPts(2200, 740, 12, 8, 0, 906)),
      fill: '#6a9a3b',
      stroke: '#2c3b1e',
      'stroke-width': 2,
    },
    icons,
  );
  el(
    'circle',
    {
      cx: 972,
      cy: 628,
      r: 6,
      fill: 'none',
      stroke: '#c4e178',
      'stroke-width': 1.4,
      'stroke-opacity': 0.8,
    },
    icons,
  );
  {
    const g = el('g', null, icons);
    el(
      'rect',
      {
        x: 1962,
        y: 68,
        width: 56,
        height: 9,
        fill: '#8a6a4e',
        stroke: '#4a3524',
        'stroke-width': 1.2,
      },
      g,
    );
    for (const x of [1966, 1978, 1992, 2004, 2012]) {
      el(
        'rect',
        { x, y: 60, width: 6, height: 10, fill: '#8a6a4e', stroke: '#4a3524', 'stroke-width': 1 },
        g,
      );
    }
  }
  el(
    'circle',
    { cx: 1943, cy: 441, r: 3, fill: 'none', stroke: '#0f6aa8', 'stroke-width': 2 },
    icons,
  );
  el(
    'path',
    {
      d: 'M1943 444v16M1936 449h14M1934 455q0 7 9 7t9-7',
      fill: 'none',
      stroke: '#0f6aa8',
      'stroke-width': 2.3,
      'stroke-linecap': 'round',
    },
    icons,
  );
  for (const [x, y, t] of TOWNS) {
    if (t === 'y') {
      el(
        'circle',
        { cx: x, cy: y, r: 5, fill: '#f3c93a', stroke: '#7a5a10', 'stroke-width': 1.6 },
        icons,
      );
      el('circle', { cx: x, cy: y, r: 1.8, fill: '#fff6c8' }, icons);
    } else {
      el(
        'circle',
        { cx: x, cy: y, r: 3.6, fill: '#d02a2e', stroke: '#4b1018', 'stroke-width': 1.3 },
        icons,
      );
    }
  }

  for (const l of model.labels) {
    const t = el(
      'text',
      {
        x: l.x,
        y: l.y,
        'font-size': l.size,
        class: `atlas__label${l.className ? ` atlas__label--${l.className}` : ''}`,
      },
      names,
      l.style,
    );
    if (l.transform) t.setAttribute('transform', l.transform);
    if (l.textLength) {
      t.setAttribute('textLength', String(l.textLength));
      t.setAttribute('lengthAdjust', 'spacingAndGlyphs');
    }
    t.textContent = l.text;
  }

  // The grain is the slowest part; paint it after the map is on screen.
  setTimeout(() => {
    const url = paperTexture();
    if (url)
      el(
        'image',
        { x: 0, y: 0, width: MAP_W, height: MAP_H, preserveAspectRatio: 'none', href: url },
        grain,
        'pointer-events:none',
      );
  }, 30);

  return { overlay, labels: names };
}
