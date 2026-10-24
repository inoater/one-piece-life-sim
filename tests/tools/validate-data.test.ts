import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { copyProject, runTool } from '../helpers/project';

const edit = (dir: string, file: string, change: (json: any) => void) => {
  const path = join(dir, file);
  const json = JSON.parse(readFileSync(path, 'utf8'));
  change(json);
  writeFileSync(path, JSON.stringify(json, null, 2));
};

describe('npm run validate (tools/validate-data.ts)', () => {
  it('passes on the real data: exit 0 and a summary', () => {
    const { status, output } = runTool('validate-data.ts', []);
    expect(status).toBe(0);
    expect(output).toMatch(
      /Data is valid: \d+ files \(traits \d+, weapons \d+, locations \d+, events \d+, races \d+, birthplaces \d+, legacies \d+, occupations \d+, names \d+, foci \d+, backstory \d+, activities \d+, jobs \d+, lanes \d+, vessels \d+, factions \d+, cast \d+, canon \d+, fruits \d+, tracks \d+, techniques \d+, movesets \d+\), data hash [0-9a-f]{12}/,
    );
  });

  it('fails with exit 1 and names the file and the field', () => {
    const dir = copyProject();
    edit(
      dir,
      'data/events/test_crossroads.json',
      (e) => (e.conditions[0].trait = 'trait_test_brawlr'),
    );
    const { status, output } = runTool('validate-data.ts', ['--root', dir]);
    expect(status).toBe(1);
    expect(output).toContain('data/events/test_crossroads.json');
    expect(output).toContain('conditions[0].trait');
    expect(output).toContain('did you mean "trait_test_brawler"?');
    expect(output).toContain('Data is invalid: 1 problem in 1 file.');
  });

  it('reports a JSON syntax error with its line and column', () => {
    const dir = copyProject();
    writeFileSync(
      join(dir, 'data/traits/test_quick.json'),
      '{\n  "id": "trait_test_quick",\n  oops\n}\n',
    );
    const { status, output } = runTool('validate-data.ts', ['--root', dir]);
    expect(status).toBe(1);
    expect(output).toMatch(
      /data\/traits\/test_quick\.json\s+error\s+\(file\): Invalid JSON: .*line 3/,
    );
  });

  it('emits machine-readable output with --json', () => {
    const dir = copyProject();
    edit(dir, 'data/locations/test_harbor.json', (e) => (e.region = 'atlantis'));
    const { output } = runTool('validate-data.ts', ['--root', dir, '--json']);
    const parsed = JSON.parse(output);
    expect(parsed.ok).toBe(false);
    expect(parsed.issues[0]).toMatchObject({
      severity: 'error',
      file: 'data/locations/test_harbor.json',
      field: 'region',
    });
  });

  it('treats warnings as failures only with --strict', () => {
    const dir = copyProject();
    edit(dir, 'data/traits/test_quick.json', (e) => (e.id = 'trait_not_the_file_name'));
    expect(runTool('validate-data.ts', ['--root', dir]).status).toBe(0);
    const strict = runTool('validate-data.ts', ['--root', dir, '--strict']);
    expect(strict.status).toBe(1);
    expect(strict.output).toContain('warning');
  });
});
