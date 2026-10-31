import { describe, expect, it } from 'vitest';
import { runTool } from '../helpers/project';

describe('npm run lives (tools/lives.ts)', () => {
  it('lives whole lives on worker threads and reports lifespans against the race range', () => {
    // Two lives are far too few to pass the lifespan check, so only the report is checked here;
    // the 1,000-life run and its results are in docs/PHASE2.md.
    const { output } = runTool('lives.ts', [
      '--lives',
      '2',
      '--race',
      'race_tontatta',
      '--workers',
      '2',
      '--seed',
      'tool-test',
      '--json',
    ]);
    const report = JSON.parse(output);
    expect(report.lives).toBe(2);
    expect(report.races).toHaveLength(1);
    const [race] = report.races;
    expect(race).toMatchObject({ race: 'race_tontatta', lives: 2, lifespan: { min: 60, max: 80 } });
    expect(race.mean).toBeGreaterThan(0);
    expect(Object.values(race.causes).reduce((a: number, b) => a + (b as number), 0)).toBe(2);
    expect(race.outcomesPerLife.min).toBeGreaterThan(10);
    // Whole lives (with crews since Phase 8) need room under full-suite load.
  }, 120_000);

  it('is repeatable: the same seeds live the same lives', () => {
    const run = () =>
      JSON.parse(
        runTool('lives.ts', ['--lives', '2', '--race', 'race_human', '--seed', 'again', '--json'])
          .output,
      ).races[0].mean;
    expect(run()).toBe(run());
  }, 240_000);
});
