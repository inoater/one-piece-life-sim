import type { CharacterSheet } from '../../worker/protocol';
import { h, svg } from '../dom';

/**
 * The wanted poster: the most recognisable object in the seas, used as the character's portrait.
 * Nobody has a bounty yet (bounties arrive in a later phase), so the poster says so with a stamp.
 *
 * The portrait is a bust in ink, built from what the sheet already knows: race (fins, ears, wings,
 * horns, a flame), stage of life (a child's head is larger), build, height class and hair. It is a
 * sketch for the poster, not the avatar layers Phase 7 will draw.
 */

type Field = 'build' | 'height' | 'hairStyle' | 'feature';

const BUILD_WIDTH: Record<string, number> = {
  slight: 0.84,
  lean: 0.9,
  wiry: 0.92,
  stocky: 1.06,
  broad: 1.16,
  heavyset: 1.2,
};

function field(sheet: CharacterSheet, id: Field): string {
  return sheet.appearance.fields.find((f) => f.id === id)?.optionId ?? '';
}

/** Ears, fins, horns and wings, by race feature (and race where the feature is a whole-body thing). */
function features(sheet: CharacterSheet, headR: number, top: number): SVGElement[] {
  const feature = field(sheet, 'feature');
  const race = sheet.race.id;
  const out: SVGElement[] = [];
  const cx = 60;
  const ear = (d: string) => out.push(svg('path', { class: 'portrait__ink', d }));
  if (race === 'race_skypiean' || race === 'race_lunarian') {
    const span = race === 'race_lunarian' ? 52 : 30;
    const y = top + headR * 2.6;
    for (const side of [-1, 1]) {
      out.unshift(
        svg('path', {
          class: race === 'race_lunarian' ? 'portrait__ink' : 'portrait__soft',
          d: `M${cx + side * 14} ${y} C${cx + side * (span * 0.8)} ${y - 26} ${cx + side * span} ${y - 8} ${cx + side * (span + 4)} ${y + 18} C${cx + side * (span * 0.7)} ${y + 8} ${cx + side * 24} ${y + 14} ${cx + side * 14} ${y + 6} Z`,
        }),
      );
    }
    if (race === 'race_lunarian') {
      out.push(
        svg('path', {
          class: 'portrait__flame',
          d: `M${cx} ${top + headR * 2.2} c-6 -8 -2 -14 0 -20 c2 6 6 9 3 14 c4 -2 5 -6 4 -9 c4 6 2 13 -7 15 Z`,
        }),
      );
    }
  }
  switch (feature) {
    case 'rabbit':
      for (const s of [-1, 1])
        ear(`M${cx + s * 5} ${top + 4} c${s * 2} -26 ${s * 10} -30 ${s * 11} -2 Z`);
      break;
    case 'cat':
    case 'jaguar':
    case 'fox':
      for (const s of [-1, 1]) ear(`M${cx + s * 3} ${top + 4} l${s * 12} -14 l${s * 2} 18 Z`);
      break;
    case 'dog':
      for (const s of [-1, 1])
        ear(
          `M${cx + s * (headR - 2)} ${top + 6} c${s * 10} 2 ${s * 12} 16 ${s * 6} 22 c${s * -2} -8 ${s * -6} -14 ${s * -8} -16 Z`,
        );
      break;
    case 'bear':
      for (const s of [-1, 1])
        out.push(
          svg('circle', { class: 'portrait__ink', cx: cx + s * (headR - 3), cy: top + 4, r: 5.5 }),
        );
      break;
    case 'sheep':
      for (const s of [-1, 1])
        ear(
          `M${cx + s * (headR - 4)} ${top + 8} c${s * 14} -8 ${s * 16} 12 ${s * 4} 12 c${s * 6} -3 ${s * 4} -9 ${s * -1} -7 Z`,
        );
      break;
    case 'lion':
      out.unshift(
        svg('circle', { class: 'portrait__soft', cx, cy: top + headR + 2, r: headR + 9 }),
      );
      break;
    case 'shark':
      ear(`M${cx - 3} ${top + 1} l9 -16 l3 17 Z`);
      break;
    case 'hammerhead':
      ear(`M${cx - headR - 10} ${top + 10} h${(headR + 10) * 2} v6 h${-(headR + 10) * 2} Z`);
      break;
    case 'sawshark':
      ear(`M${cx - 2} ${top + headR + 4} h4 l-1 22 h-2 Z`);
      break;
    case 'pufferfish':
      for (let i = 0; i < 7; i++) {
        const a = (i / 6) * Math.PI - Math.PI;
        const x = cx + Math.cos(a) * (headR + 1);
        const y = top + headR + Math.sin(a) * (headR + 1);
        ear(
          `M${x.toFixed(1)} ${y.toFixed(1)} l${(Math.cos(a) * 7).toFixed(1)} ${(Math.sin(a) * 7).toFixed(1)} l2 2 Z`,
        );
      }
      break;
    case 'manta':
    case 'goldfish':
    case 'koi_tail':
    case 'silver_tail':
    case 'deep_tail':
    case 'coral_tail':
    case 'eel_tail':
      for (const s of [-1, 1])
        ear(
          `M${cx + s * (headR - 1)} ${top + headR} c${s * 10} -10 ${s * 14} -4 ${s * 12} 6 c${s * -4} -2 ${s * -8} -1 ${s * -12} 2 Z`,
        );
      break;
    case 'octopus':
      for (const s of [-1, 1]) {
        for (const k of [0, 1])
          ear(
            `M${cx + s * (24 + k * 6)} ${top + headR * 2.9} q${s * 10} 14 ${s * 2} 26 q${s * 6} -12 ${s * -6} -24 Z`,
          );
      }
      break;
    case 'giant_horns':
      for (const s of [-1, 1])
        ear(`M${cx + s * 6} ${top + 3} q${s * 10} -14 ${s * 4} -20 q${s * 2} 10 ${s * -8} 18 Z`);
      break;
    case 'fluffy_tail':
    case 'striped_tail':
    case 'round_nose':
      out.unshift(
        svg('path', {
          class: 'portrait__soft',
          d: `M${cx + 22} ${top + headR * 3.4} c18 -6 22 -26 8 -34 c6 12 0 22 -12 26 Z`,
        }),
      );
      break;
    default:
      break;
  }
  return out;
}

function hair(style: string, cx: number, top: number, r: number): SVGElement | null {
  switch (style) {
    case 'bald':
      return null;
    case 'long':
      return svg('path', {
        class: 'portrait__ink',
        d: `M${cx - r} ${top + r} q0 -${r + 2} ${r} -${r + 1} q${r} -1 ${r} ${r + 1} v${r * 2.2} h-5 v-${r * 1.6} h-${r * 2 - 10} v${r * 1.6} h-5 Z`,
      });
    case 'topknot':
      return svg(
        'g',
        null,
        svg('circle', { class: 'portrait__ink', cx, cy: top - 4, r: 5 }),
        svg('path', {
          class: 'portrait__ink',
          d: `M${cx - r} ${top + r - 2} q${r} -${r + 4} ${r * 2} 0 Z`,
        }),
      );
    case 'braided':
      return svg(
        'g',
        null,
        svg('path', {
          class: 'portrait__ink',
          d: `M${cx - r} ${top + r - 1} q${r} -${r + 4} ${r * 2} 0 Z`,
        }),
        svg('path', {
          class: 'portrait__ink',
          d: `M${cx + r - 3} ${top + r} q8 10 2 28 l-4 -1 q4 -14 -2 -24 Z`,
        }),
      );
    case 'shaggy':
      return svg('path', {
        class: 'portrait__ink',
        d: `M${cx - r - 1} ${top + r + 2} l2 -9 l4 3 l2 -8 l5 5 l3 -7 l4 6 l4 -6 l3 7 l5 -5 l2 8 l4 -3 l2 9 Z`,
      });
    case 'wispy':
      return svg('path', {
        class: 'portrait__soft',
        d: `M${cx - 5} ${top + 2} q3 -7 5 0 q2 -6 5 0`,
      });
    default:
      return svg('path', {
        class: 'portrait__ink',
        d: `M${cx - r} ${top + r - 1} q${r} -${r + 3} ${r * 2} 0 Z`,
      });
  }
}

export function renderPortrait(sheet: CharacterSheet): SVGSVGElement {
  const stage = sheet.stage.id;
  const young = stage === 'infant' || stage === 'toddler' || stage === 'child';
  const build = BUILD_WIDTH[field(sheet, 'build')] ?? 1;
  const giant = sheet.race.id === 'race_giant';
  const tiny = sheet.race.id === 'race_tontatta';
  const headR = young ? 15 : 12;
  const shoulders = (young ? 22 : 30) * build * (giant ? 1.15 : 1);
  const cx = 60;
  const top = young ? 30 : 26;
  const neckY = top + headR * 2 - 1;
  const body = svg('path', {
    class: 'portrait__ink',
    d: `M${cx - 6} ${neckY - 2} h12 v6 C${cx + shoulders} ${neckY + 6} ${cx + shoulders + 4} ${neckY + 22} ${cx + shoulders + 6} 128 H${cx - shoulders - 6} C${cx - shoulders - 4} ${neckY + 22} ${cx - shoulders} ${neckY + 6} ${cx - 6} ${neckY + 4} Z`,
  });
  const head = svg('circle', { class: 'portrait__ink', cx, cy: top + headR, r: headR });
  const scars = sheet.scars.some((s) => s.area === 'head' || s.area === 'eyes')
    ? svg('path', { class: 'portrait__scar', d: `M${cx - 6} ${top + headR - 6} l9 10` })
    : null;
  const group = svg(
    'g',
    {
      class: 'portrait__figure',
      // A dwarf is drawn small, as if seen from across the room; a giant fills the frame.
      transform: tiny ? 'translate(30 54) scale(0.5)' : giant ? 'translate(-6 -4) scale(1.1)' : '',
    },
    features(sheet, headR, top),
    body,
    head,
    hair(field(sheet, 'hairStyle'), cx, top, headR),
    scars,
  );
  return svg(
    'svg',
    { class: 'portrait', viewBox: '0 0 120 128', 'aria-hidden': 'true', focusable: 'false' },
    tiny ? svg('path', { class: 'portrait__soft', d: 'M20 128 q40 -14 80 0 Z' }) : null,
    group,
  );
}

export function renderPoster(
  sheet: CharacterSheet,
  options: { compact?: boolean } = {},
): HTMLElement {
  return h(
    'figure',
    {
      class: `poster${options.compact ? ' poster--compact' : ''}`,
      'aria-label': `Poster: ${sheet.name}, no bounty yet`,
    },
    h('p', { class: 'poster__title', 'aria-hidden': 'true' }, 'WANTED'),
    h(
      'div',
      { class: 'poster__frame' },
      renderPortrait(sheet),
      h('span', { class: 'poster__stamp', 'aria-hidden': 'true' }, 'Not yet'),
    ),
    h('figcaption', { class: 'poster__name' }, sheet.name),
    h(
      'p',
      { class: 'poster__bounty' },
      h('span', { class: 'poster__berry', 'aria-hidden': 'true' }, '฿'),
      ' —',
    ),
    h('p', { class: 'poster__meta' }, `${sheet.race.name} · ${sheet.birthplace.shortName}`),
  );
}
