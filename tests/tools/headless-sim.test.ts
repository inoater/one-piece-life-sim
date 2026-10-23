import { describe, expect, it } from 'vitest';
import { runTool } from '../helpers/project';

describe('npm run sim (tools/headless-sim.ts)', () => {
  it('runs 468 months and reports a verified, repeatable hash', () => {
    const { status, output } = runTool('headless-sim.ts', [
      '--seed',
      'cli',
      '--probe',
      '--verify',
      '--json',
    ]);
    expect(status).toBe(0);
    const { summary, runs } = JSON.parse(output);
    expect(summary).toMatchObject({
      worlds: 1,
      ticksRequested: 468,
      verified: true,
      distinctHashes: 1,
    });
    expect(runs[0]).toMatchObject({
      seed: 'cli',
      ticksRun: 468,
      finalTick: 468,
      stop: 'completed',
    });
    expect(runs[0].hash).toMatch(/^[0-9a-f]{32}$/);
    expect(summary.totalMs).toBeLessThan(2000);
  });

  it('is repeatable across separate processes', () => {
    const hash = () =>
      JSON.parse(runTool('headless-sim.ts', ['--seed', 'xproc', '--probe', '--json']).output)
        .runs[0].hash;
    expect(hash()).toBe(hash());
  });

  it('simulates many worlds at once, each from its own seed', () => {
    const { output } = runTool('headless-sim.ts', [
      '--seed',
      'batch',
      '--worlds',
      '40',
      '--probe',
      '--verify',
      '--json',
    ]);
    const { summary } = JSON.parse(output);
    expect(summary).toMatchObject({ worlds: 40, distinctHashes: 40, verified: true });
  });

  it('supports shorter runs, the dev test entity, and a human-readable summary', () => {
    const { status, output } = runTool('headless-sim.ts', [
      '--seed',
      'short',
      '--ticks',
      '24',
      '--fixtures',
    ]);
    expect(status).toBe(0);
    expect(output).toContain('seed short: 24 ticks');
    expect(output).toContain('1 entities');
  });

  it('rejects bad arguments with exit code 2', () => {
    expect(runTool('headless-sim.ts', ['--ticks', 'many']).status).toBe(2);
    expect(runTool('headless-sim.ts', ['--decisions', 'sometimes']).status).toBe(2);
  });
});
