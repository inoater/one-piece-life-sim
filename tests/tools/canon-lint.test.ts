import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RawFile } from '../../src/engine/data/loader';
import { lintCanon } from '../../tools/lib/canon-lint';
import { copyProject, runTool } from '../helpers/project';

const cast = (path: string, content: unknown): RawFile => ({
  path: `data/cast/${path}`,
  content,
});
const beats = (path: string, content: unknown): RawFile => ({
  path: `data/canon/${path}`,
  content,
});
const messages = (files: RawFile[]) =>
  lintCanon(files).issues.map((i) => `${i.file} ${i.field}: ${i.message}`);

describe('canon lint', () => {
  it('has nothing to say about no canon files', () => {
    expect(lintCanon([])).toEqual({ issues: [], checkedFiles: 0, checkedItems: 0 });
  });

  it('accepts well-formed canon entries in each canon folder', () => {
    const files = [
      cast('cast.json', [
        { id: 'char_gol_d_roger', origin: 'canon' },
        { id: 'char_monkey_d_garp' },
      ]),
      { path: 'data/factions/a.json', content: [{ id: 'org_marines' }] },
      {
        path: 'data/locations/a.json',
        content: [{ id: 'loc_loguetown' }, { id: 'loc_my_village', origin: 'generated' }],
      },
      beats('a.json', [{ id: 'beat_god_valley' }]),
    ];
    expect(lintCanon(files)).toMatchObject({ issues: [], checkedFiles: 4, checkedItems: 6 });
  });

  it('rejects ids in the generated namespace', () => {
    expect(messages([cast('a.json', { id: 'gen_000412' })])[0]).toContain('generated id namespace');
  });

  it('rejects ids that are not readable typed slugs', () => {
    for (const id of [
      'Roger',
      'char_',
      'char-roger',
      'roger',
      'char_Roger',
      'char__x',
      'planet_earth',
    ]) {
      expect(messages([cast('a.json', { id })])[0], id).toContain('not a valid canon id');
    }
  });

  it('rejects an id whose prefix does not belong in its folder', () => {
    expect(messages([cast('a.json', { id: 'org_marines' })])[0]).toContain(
      'in data/cast/ but its prefix says organization',
    );
  });

  it('rejects beat ids that are not beat slugs', () => {
    expect(messages([beats('a.json', { id: 'char_gol_d_roger' })])[0]).toContain(
      'not a valid beat id',
    );
  });

  it('rejects duplicate ids across files, naming the other file', () => {
    const found = messages([cast('a.json', { id: 'char_a' }), cast('b.json', { id: 'char_a' })]);
    expect(found).toEqual([
      'data/cast/b.json id: Duplicate canon id "char_a" (also in data/cast/a.json)',
    ]);
  });

  it('requires canon origin when an origin is given (invented places excepted)', () => {
    expect(messages([cast('a.json', { id: 'char_a', origin: 'generated' })])[0]).toContain(
      'must have origin "canon"',
    );
    expect(
      messages([{ path: 'data/locations/a.json', content: { id: 'loc_a', origin: 'generated' } }]),
    ).toEqual([]);
  });

  it('keeps a character in one place at a time: keyframes may not overlap', () => {
    const found = messages([
      cast('a.json', {
        id: 'char_a',
        keyframes: [{ from: { year: 1 }, to: { year: 5 } }, { from: { year: 4 } }],
      }),
    ]);
    expect(found[0]).toContain('keyframes[0].to: overlaps the next keyframe');
  });

  it('reports non-objects, missing ids and bad JSON with their position', () => {
    expect(messages([cast('a.json', [1, { id: 'char_a' }])])[0]).toContain(
      '[0]: Expected an object',
    );
    expect(messages([cast('a.json', {})])[0]).toContain('needs a string id');
    expect(messages([cast('a.json', [{ id: 'char_ok' }, { name: 'no id' }])])[0]).toContain(
      '[1].id',
    );
    expect(
      lintCanon([{ path: 'data/canon/a.json', parseError: 'Unexpected end (line 9)' }]).issues[0]
        ?.message,
    ).toContain('line 9');
  });

  it('ignores files outside the canon folders', () => {
    expect(
      lintCanon([{ path: 'data/traits/x.json', content: { id: 'gen_000001' } }]).checkedFiles,
    ).toBe(0);
  });
});

describe('npm run canon-lint', () => {
  it('passes on the real lore, saying how much it checked', () => {
    const { status, output } = runTool('canon-lint.ts', []);
    expect(status).toBe(0);
    expect(output).toMatch(/Canon lint: \d+ entries in \d+ files are clean/);
  });

  it('fails when a canon file breaks the rules', () => {
    const dir = copyProject();
    mkdirSync(join(dir, 'data/cast'), { recursive: true });
    writeFileSync(join(dir, 'data/cast/bad.json'), JSON.stringify([{ id: 'Roger' }]));
    const { status, output } = runTool('canon-lint.ts', ['--root', dir]);
    expect(status).toBe(1);
    expect(output).toContain('data/cast/bad.json');
    expect(output).toContain('Canon lint failed with 1 problem');
  });
});
