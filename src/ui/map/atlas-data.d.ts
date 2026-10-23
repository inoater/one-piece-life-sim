/** Types for the map data copied verbatim from the supplied map (see atlas-data.js). */

/** One layer of a hand-traced island: base shape, fill, or a town marker. */
export type DesignLayer =
  | ['b', string, string, string, number]
  | ['f', string, string]
  | ['dm', number, number, number]
  | ['dc', number, number, number];

export const DESIGNS: Readonly<Record<string, { a: number; L: DesignLayer[] }>>;
export const RED_LINE: readonly (readonly [number, number])[][];
export const CHANNELS: readonly string[];
export const LOBES: string;
export const GRAND_LINE_NAMES: readonly string[];
export const BLUE_NAMES: readonly string[];
export const DETAIL_NAMES: readonly [string, number, number][];
export const DRAWN: ReadonlySet<string>;
export const NOTES: string;
export const TOWNS: readonly [number, number, string][];
