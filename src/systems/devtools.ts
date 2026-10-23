import type { GameData, StatModDef } from '../engine/data/schemas';
import { createEntity, requireEntity } from '../engine/entities';
import { appendLog } from '../engine/log';
import type { Entity, WorldState } from '../engine/state';
import { addMod, formatNumber, makeStat, statLabel } from '../engine/stats';

/**
 * Dev fixtures: a test entity whose stats carry real modifier stacks. It exists so the modifier
 * system, the debug inspector and the stat tooltip have something to show in an otherwise empty
 * world. Built entirely from /data/test_* files (rule 1) plus an "engine" training line.
 *
 * Strength reproduces the plan's example: 74 = 50 base + 12 training + 8 Brawler + 4 weapon.
 */

const FIXTURE_FILES =
  'data/traits/test_brawler.json, data/traits/test_quick.json and data/weapons/test_cutlass.json';

function applyDefs(entity: Entity, defs: readonly StatModDef[], source: string): void {
  for (const def of defs) {
    const stat = entity.stats[def.stat];
    if (!stat) throw new Error(`Test entity has no ${def.stat} stat to apply "${source}" to`);
    addMod(stat, { source, value: def.value, kind: def.kind });
  }
}

export function spawnTestEntity(state: WorldState, data: GameData): Entity {
  const brawler = data.traits['trait_test_brawler'];
  const quick = data.traits['trait_test_quick'];
  const cutlass = data.weapons['weapon_test_cutlass'];
  if (!brawler || !quick || !cutlass) {
    throw new Error(`The test entity needs ${FIXTURE_FILES}`);
  }

  const existing = Object.values(state.entities).filter(
    (e) => e.flags['dev.fixture'] === true,
  ).length;
  const entity = createEntity(state, {
    type: 'character',
    origin: 'generated',
    name: `Test Dummy ${existing + 1}`,
    flags: { 'dev.fixture': true },
    stats: {
      strength: makeStat(50, [{ source: 'training', value: 12, kind: 'flat' }]),
      speed: makeStat(40, [
        { source: 'training', value: 6, kind: 'flat' },
        { source: 'Tailwind (temporary)', value: 10, kind: 'flat', expiresTick: state.tick + 6 },
      ]),
      endurance: makeStat(35),
    },
  });
  applyDefs(entity, brawler.statMods, `${brawler.name} (trait)`);
  applyDefs(entity, quick.statMods, `${quick.name} (trait)`);
  applyDefs(entity, cutlass.statMods, `${cutlass.name} (weapon)`);

  appendLog(state, state.tick, {
    kind: 'system',
    summary: `Debug: spawned ${entity.name} (${entity.id}).`,
    tags: ['system', 'debug'],
    actorIds: [entity.id],
    cause: 'action:debug/spawnTestEntity',
  });
  return entity;
}

export interface DebugModifierInput {
  entityId: string;
  stat: string;
  value: number;
  kind: 'flat' | 'pct';
  /** Lasts this many months; omit for permanent. */
  months?: number;
  source?: string;
}

export function addDebugModifier(state: WorldState, input: DebugModifierInput): void {
  const entity = requireEntity(state, input.entityId);
  const stat = entity.stats[input.stat];
  if (!stat) {
    const have = Object.keys(entity.stats).join(', ') || 'none';
    throw new Error(`${entity.name} has no stat "${input.stat}" (it has: ${have})`);
  }
  const source = input.source?.trim() || 'Debug modifier';
  addMod(stat, {
    source,
    value: input.value,
    kind: input.kind,
    ...(input.months !== undefined ? { expiresTick: state.tick + input.months } : {}),
  });
  const amount = `${input.value >= 0 ? '+' : '-'}${formatNumber(Math.abs(input.value))}${input.kind === 'pct' ? '%' : ''}`;
  const duration =
    input.months !== undefined ? ` for ${input.months} month${input.months === 1 ? '' : 's'}` : '';
  appendLog(state, state.tick, {
    kind: 'system',
    summary: `Debug: ${amount} ${source} on ${statLabel(input.stat)} of ${entity.name}${duration}.`,
    tags: ['system', 'debug'],
    actorIds: [entity.id],
    cause: 'action:debug/addModifier',
  });
}
