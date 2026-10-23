import type { Modifier, Stat } from './state';

/**
 * Rule 3: every number is base plus modifiers.
 *
 *     final = (base + sum of flat) x (1 + sum of pct / 100)
 *
 * Percentages add together rather than compounding, so a tooltip can say "+30% race, +10% trait"
 * and the player can add it up. A modifier is active while `tick < expiresTick`; one with no
 * `expiresTick` is permanent. Expired modifiers are ignored by every reader and pruned during the
 * aging step, so correctness never depends on the pruning having happened.
 *
 * Values are not clamped here. Derived values (Max Health and so on) decide their own floors.
 */

/** The ten character stats from the plan. Luck is hidden from the player and cannot be trained. */
export const STAT_IDS = [
  'strength',
  'speed',
  'endurance',
  'durability',
  'dexterity',
  'intellect',
  'willpower',
  'charisma',
  'perception',
  'luck',
] as const;
export type StatId = (typeof STAT_IDS)[number];

export function makeStat(base: number, mods: Modifier[] = []): Stat {
  return { base, mods };
}

export function isActive(mod: Modifier, tick: number): boolean {
  return mod.expiresTick === undefined || tick < mod.expiresTick;
}

export interface BreakdownLine {
  source: string;
  kind: 'flat' | 'pct';
  value: number;
  /** What this line adds to the total (for pct lines: pct of base plus flats). */
  contribution: number;
  expiresTick?: number;
  active: boolean;
}

export interface StatBreakdown {
  base: number;
  flatTotal: number;
  pctTotal: number;
  /** base + flat, before percentages. */
  subtotal: number;
  total: number;
  lines: BreakdownLine[];
}

export function statBreakdown(
  stat: Stat,
  tick: number,
  options: { includeExpired?: boolean } = {},
): StatBreakdown {
  let flatTotal = 0;
  let pctTotal = 0;
  for (const mod of stat.mods) {
    if (!isActive(mod, tick)) continue;
    if (mod.kind === 'flat') flatTotal += mod.value;
    else pctTotal += mod.value;
  }
  const subtotal = stat.base + flatTotal;
  const total = subtotal * (1 + pctTotal / 100);

  const lines: BreakdownLine[] = [];
  for (const mod of stat.mods) {
    const active = isActive(mod, tick);
    if (!active && !options.includeExpired) continue;
    const line: BreakdownLine = {
      source: mod.source,
      kind: mod.kind,
      value: mod.value,
      contribution: mod.kind === 'flat' ? mod.value : (subtotal * mod.value) / 100,
      active,
    };
    if (mod.expiresTick !== undefined) line.expiresTick = mod.expiresTick;
    lines.push(line);
  }
  return { base: stat.base, flatTotal, pctTotal, subtotal, total, lines };
}

export function statValue(stat: Stat, tick: number): number {
  let flatTotal = 0;
  let pctTotal = 0;
  for (const mod of stat.mods) {
    if (!isActive(mod, tick)) continue;
    if (mod.kind === 'flat') flatTotal += mod.value;
    else pctTotal += mod.value;
  }
  return (stat.base + flatTotal) * (1 + pctTotal / 100);
}

export function addMod(stat: Stat, mod: Modifier): void {
  if (!Number.isFinite(mod.value))
    throw new RangeError(`Modifier "${mod.source}" has a non-finite value`);
  stat.mods.push(mod);
}

export function removeModsBySource(stat: Stat, source: string): number {
  const before = stat.mods.length;
  stat.mods = stat.mods.filter((m) => m.source !== source);
  return before - stat.mods.length;
}

/** Drop modifiers that are no longer active at `tick`. Returns how many were removed. */
export function pruneExpired(stat: Stat, tick: number): number {
  if (stat.mods.every((m) => isActive(m, tick))) return 0;
  const before = stat.mods.length;
  stat.mods = stat.mods.filter((m) => isActive(m, tick));
  return before - stat.mods.length;
}

/** 12 -> "12", 57.5 -> "57.5", 0.3333 -> "0.33". */
export function formatNumber(n: number): string {
  return String(Number(n.toFixed(2)));
}

export function statLabel(id: string): string {
  return id.length === 0 ? id : id.charAt(0).toUpperCase() + id.slice(1);
}

/**
 * One-line explanation of a stat, e.g.
 *   "Strength 74 = 50 base + 12 training + 8 Brawler + 4 Cutlass"
 *   "Speed 57.5 = (40 base + 6 training) x 1.25 (+25% Quick)"
 */
export function describeBreakdown(label: string, b: StatBreakdown): string {
  const flats = b.lines.filter((l) => l.kind === 'flat' && l.active);
  const pcts = b.lines.filter((l) => l.kind === 'pct' && l.active);
  const flatText = [
    `${formatNumber(b.base)} base`,
    ...flats.map(
      (l) => `${l.value < 0 ? '-' : '+'} ${formatNumber(Math.abs(l.value))} ${l.source}`,
    ),
  ].join(' ');
  // "50 base + 12 training": the first flat already carries its sign, so only a leading base is bare.
  let text = flatText;
  if (pcts.length > 0) {
    const mult = formatNumber(1 + b.pctTotal / 100);
    const parts = pcts.map(
      (l) => `${l.value < 0 ? '-' : '+'}${formatNumber(Math.abs(l.value))}% ${l.source}`,
    );
    text = `(${flatText}) x ${mult} (${parts.join(', ')})`;
  }
  return `${label} ${formatNumber(b.total)} = ${text}`;
}
