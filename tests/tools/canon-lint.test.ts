import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RawFile } from '../../src/engine/data/loader';
import { lintCanon } from '../../tools/lib/canon-lint';
import { copyProject, runTool } from '../helpers/project';

const canon = (path: string, content: unknown): RawFile => ({
  path: `data/canon/${path}`,
  content,
});
const messages = (files: RawFile[]) =>
  lintCanon(files).issues.map((i) => `${i.file} ${i.field}: ${i.message}`);

describe('canon lint', () => {
  it('has nothing to say about an empty canon folder', () => {
    expect(lintCanon([])).toEqual({ issues: [], checkedFiles: 0, checkedItems: 0 });
  });

  it('accepts well-formed canon entries', () => {
    const files = [
      canon('cast.json', [
        { id: 'char_gol_d_roger', type: 'character', origin: 'canon' },
        { id: 'org_marines', type: 'organization' },
        { id: 'ship_oro_jackson' },
      ]),
    ];
    expect(lintCanon(files)).toMatchObject({ issues: [], checkedFiles: 1, checkedItems: 3 });
  });

  it('rejects ids in the generated namespace', () => {
    expect(messages([canon('a.json', { id: 'gen_000412' })])[0]).toContain(
      'generated id namespace',
    );
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
      expect(messages([canon('a.json', { id })])[0], id).toContain('not a valid canon id');
    }
  });

  it('rejects duplicate ids across files, naming the other file', () => {
    const found = messages([canon('a.json', { id: 'char_a' }), canon('b.json', { id: 'char_a' })]);
    expect(found).toEqual([
      'data/canon/b.json id: Duplicate canon id "char_a" (also in data/canon/a.json)',
    ]);
  });

  it('checks that the id prefix agrees with the declared type', () => {
    expect(messages([canon('a.json', { id: 'char_a', type: 'ship' })])[0]).toContain(
      'means type "character", but type is "ship"',
    );
    expect(messages([canon('a.json', { id: 'char_a', type: 'wizard' })])[0]).toContain(
      'not an entity type',
    );
  });

  it('requires canon origin when an origin is given', () => {
    expect(messages([canon('a.json', { id: 'char_a', origin: 'generated' })])[0]).toContain(
      'must have origin "canon"',
    );
  });

  it('reports non-objects, missing ids and bad JSON with their position', () => {
    expect(messages([canon('a.json', [1, { id: 'char_a' }])])[0]).toContain(
      '[0]: Expected an object',
    );
    expect(messages([canon('a.json', {})])[0]).toContain('needs a string id');
    expect(messages([canon('a.json', [{ id: 'char_ok' }, { name: 'no id' }])])[0]).toContain(
      '[1].id',
    );
    expect(
      lintCanon([{ path: 'data/canon/a.json', parseError: 'Unexpected end (line 9)' }]).issues[0]
        ?.message,
    ).toContain('line 9');
  });

  it('ignores files outside data/canon', () => {
    expect(
      lintCanon([{ path: 'data/traits/x.json', content: { id: 'gen_000001' } }]).checkedFiles,
    ).toBe(0);
  });
});

describe('npm run canon-lint', () => {
  it('succeeds, saying so, while there is no lore', () => {
    const { status, output } = runTool('canon-lint.ts', []);
    expect(status).toBe(0);
    expect(output).toContain('no canon files yet');
  });

  it('fails when a canon file breaks the rules', () => {
    const dir = copyProject();
    mkdirSync(join(dir, 'data/canon'), { recursive: true });
    writeFileSync(join(dir, 'data/canon/cast.json'), JSON.stringify([{ id: 'Roger' }]));
    const { status, output } = runTool('canon-lint.ts', ['--root', dir]);
    expect(status).toBe(1);
    expect(output).toContain('data/canon/cast.json');
    expect(output).toContain('Canon lint failed with 1 problem');
  });
});
