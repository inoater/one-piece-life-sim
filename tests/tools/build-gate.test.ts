import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { copyProject, runVite } from '../helpers/project';

/**
 * "A broken data file stops the build and names the file and field."
 * Runs the real `vite build` against a throwaway copy of the project.
 */
describe('the build gate', () => {
  it('stops `vite build` on bad data, naming file and field, and builds once the data is fixed', () => {
    const dir = copyProject();
    const eventPath = join(dir, 'data/events/test_crossroads.json');
    const original = readFileSync(eventPath, 'utf8');

    writeFileSync(eventPath, original.replace('trait_test_brawler', 'trait_test_brawlr'));
    const broken = runVite(['build'], dir);
    expect(broken.status).not.toBe(0);
    expect(broken.output).toContain('Game data is invalid');
    expect(broken.output).toContain('data/events/test_crossroads.json');
    expect(broken.output).toContain('conditions[0].trait');
    expect(broken.output).toContain('Unknown trait "trait_test_brawlr"');
    expect(existsSync(join(dir, 'dist/index.html'))).toBe(false);

    writeFileSync(eventPath, original);
    const fixed = runVite(['build'], dir);
    expect(fixed.status, fixed.output).toBe(0);
    expect(existsSync(join(dir, 'dist/index.html'))).toBe(true);
  }, 180_000);
});
