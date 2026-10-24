import { describe, expect, it } from 'vitest';
import { hashValue } from '../../src/engine/canonical';
import { bundledRawFiles } from '../../src/engine/data/bundled';
import { didYouMean, formatIssue, formatPath } from '../../src/engine/data/issues';
import { loadGameData, type RawFile } from '../../src/engine/data/loader';
import { dataHash, rawFiles } from '../helpers/data';

const clone = (): RawFile[] => structuredClone(rawFiles);
const find = (files: RawFile[], suffix: string): RawFile => {
  const file = files.find((f) => f.path.endsWith(suffix));
  if (!file) throw new Error(`no file ending ${suffix}`);
  return file;
};
const content = (files: RawFile[], suffix: string) =>
  find(files, suffix).content as Record<string, any>;
const errors = (files: RawFile[]) =>
  loadGameData(files).issues.filter((i) => i.severity === 'error');

describe('the real data', () => {
  it('is valid, with every dev fixture present', () => {
    const result = loadGameData(rawFiles);
    expect(result.issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(result.ok).toBe(true);
    // Every item in every folder was loaded: counted independently from the files on disk.
    const onDisk: Record<string, number> = {};
    for (const file of rawFiles) {
      const dir = /^data\/([^/]+)\//.exec(file.path)?.[1];
      if (!dir || !file.path.endsWith('.json')) continue;
      onDisk[dir] = (onDisk[dir] ?? 0) + (Array.isArray(file.content) ? file.content.length : 1);
    }
    expect(result.counts).toEqual(onDisk);
    expect(Object.keys(result.data?.events ?? {})).toEqual(
      expect.arrayContaining([
        'evt_test_aftermath',
        'evt_test_crossroads',
        'evt_test_notice',
        'evt_test_secret',
      ]),
    );
    expect(Object.keys(result.data?.traits ?? {})).toEqual(
      expect.arrayContaining(['trait_test_brawler', 'trait_test_quick']),
    );
  });

  it('fills defaults from the schema', () => {
    const notice = loadGameData(rawFiles).data?.events['evt_test_notice'];
    expect(notice).toMatchObject({
      weight: 1,
      cooldown: 0,
      visibility: 'public',
      choices: [],
      effects: [],
      conditions: [],
    });
  });

  it('reads the same through the Vite glob as from disk (same data hash)', () => {
    const bundled = loadGameData(bundledRawFiles());
    expect(bundled.ok).toBe(true);
    expect(bundled.dataHash).toBe(dataHash);
    expect(bundled.fileCount).toBe(loadGameData(rawFiles).fileCount);
  });
});

describe('data hash', () => {
  it('ignores key order but changes with content', () => {
    const files = clone();
    const reordered = clone();
    const notice = find(reordered, 'test_notice.json');
    notice.content = Object.fromEntries(Object.entries(notice.content as object).reverse());
    expect(loadGameData(reordered).dataHash).toBe(loadGameData(files).dataHash);

    content(files, 'test_notice.json')['title'] = 'A different title';
    expect(loadGameData(files).dataHash).not.toBe(dataHash);
  });

  it('does not depend on the order files are supplied', () => {
    expect(loadGameData([...clone()].reverse()).dataHash).toBe(dataHash);
  });
});

describe('every kind of breakage names the file and the field', () => {
  const cases: {
    name: string;
    break: (files: RawFile[]) => void;
    file: string;
    field: string;
    message: RegExp;
  }[] = [
    {
      name: 'a wrong type',
      break: (f) => (content(f, 'test_brawler.json')['statMods'][0].value = 'eight'),
      file: 'data/traits/test_brawler.json',
      field: 'statMods[0].value',
      message: /expected number/i,
    },
    {
      name: 'a value outside an enum',
      break: (f) => (content(f, 'test_brawler.json')['statMods'][0].stat = 'strenght'),
      file: 'data/traits/test_brawler.json',
      field: 'statMods[0].stat',
      message: /strength/,
    },
    {
      name: 'a misspelled (unknown) field',
      break: (f) => (content(f, 'test_quick.json')['colour'] = 'red'),
      file: 'data/traits/test_quick.json',
      field: 'colour',
      message: /Unknown field/,
    },
    {
      name: 'a missing required field',
      break: (f) => delete content(f, 'test_cutlass.json')['name'],
      file: 'data/weapons/test_cutlass.json',
      field: 'name',
      message: /./,
    },
    {
      name: 'a bad id shape',
      break: (f) => (content(f, 'test_harbor.json')['id'] = 'Test Harbor'),
      file: 'data/locations/test_harbor.json',
      field: 'id',
      message: /loc_snake_case_name/,
    },
    {
      name: 'a bad region',
      break: (f) => (content(f, 'test_harbor.json')['region'] = 'atlantis'),
      file: 'data/locations/test_harbor.json',
      field: 'region',
      message: /east_blue/,
    },
    {
      name: 'a typo in a template variable',
      break: (f) => (content(f, 'test_notice.json')['text'] = 'Posted in {monthname}'),
      file: 'data/events/test_notice.json',
      field: 'text',
      message: /Unknown template variable "\{monthname\}"/,
    },
    {
      name: 'an unclosed template brace',
      break: (f) => (content(f, 'test_notice.json')['news'] = 'Oops {date'),
      file: 'data/events/test_notice.json',
      field: 'news',
      message: /Unclosed/,
    },
    {
      name: 'an unknown trait in a condition',
      break: (f) =>
        (content(f, 'test_crossroads.json')['conditions'][0].trait = 'trait_test_brawlr'),
      file: 'data/events/test_crossroads.json',
      field: 'conditions[0].trait',
      message: /Unknown trait "trait_test_brawlr"/,
    },
    {
      name: 'an unknown island in a condition',
      break: (f) =>
        (content(f, 'test_crossroads.json')['conditions'][1].location = 'loc_test_harbour'),
      file: 'data/events/test_crossroads.json',
      field: 'conditions[1].location',
      message: /Unknown location "loc_test_harbour"/,
    },
    {
      name: 'an unknown follow-up event inside a choice',
      break: (f) =>
        (content(f, 'test_crossroads.json')['choices'][0].effects[2].eventId = 'evt_test_aftermth'),
      file: 'data/events/test_crossroads.json',
      field: 'choices[0].effects[2].eventId',
      message: /Unknown event "evt_test_aftermth"/,
    },
    {
      name: 'an effect that would loop within one tick',
      break: (f) => (content(f, 'test_crossroads.json')['choices'][0].effects[2].afterMonths = 0),
      file: 'data/events/test_crossroads.json',
      field: 'choices[0].effects[2].afterMonths',
      message: /./,
    },
    {
      name: 'duplicate choice ids',
      break: (f) => (content(f, 'test_crossroads.json')['choices'][1].id = 'left'),
      file: 'data/events/test_crossroads.json',
      field: 'choices[1].id',
      message: /duplicate choice id "left"/,
    },
    {
      name: 'a secret event with news',
      break: (f) => (content(f, 'test_secret.json')['news'] = 'Everyone hears.'),
      file: 'data/events/test_secret.json',
      field: 'news',
      message: /secret event cannot produce news/,
    },
    {
      name: 'a season that leaves a month uncovered',
      break: (f) => (content(f, 'calendar.json')['seasons'][0].months = [1, 2]), // drops December
      file: 'data/calendar.json',
      field: 'seasons',
      message: /month 12 is not assigned/,
    },
    {
      name: 'a month in two seasons',
      // Winter claims March first; the later claimant (spring) is the one reported.
      break: (f) => content(f, 'calendar.json')['seasons'][0].months.push(3),
      file: 'data/calendar.json',
      field: 'seasons[1].months[0]',
      message: /already belongs to season "winter"/,
    },
    {
      name: 'the wrong number of month names',
      break: (f) => content(f, 'calendar.json')['months'].pop(),
      file: 'data/calendar.json',
      field: 'months',
      message: /./,
    },
    {
      name: 'a nonsense setting',
      break: (f) => (content(f, 'settings.json')['saves'].autosaveSlots = 0),
      file: 'data/settings.json',
      field: 'saves.autosaveSlots',
      message: /./,
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const files = clone();
      c.break(files);
      const found = errors(files).filter((i) => i.file === c.file && i.field === c.field);
      expect(found, JSON.stringify(errors(files), null, 1)).not.toHaveLength(0);
      expect(found.some((i) => c.message.test(i.message + (i.hint ?? '')))).toBe(true);
    });
  }
});

describe('whole-file problems', () => {
  it('rejects invalid JSON with the position', () => {
    const files = clone();
    files.push({
      path: 'data/events/broken.json',
      parseError: 'Unexpected token } (line 3, column 5)',
    });
    expect(errors(files)).toContainEqual(
      expect.objectContaining({
        file: 'data/events/broken.json',
        field: '(file)',
        message: expect.stringContaining('line 3, column 5'),
      }),
    );
  });

  it('rejects a data folder that does not exist, suggesting the likely one', () => {
    const files = clone();
    files.push({ path: 'data/trait/oops.json', content: {} });
    const issue = errors(files).find((i) => i.file === 'data/trait/oops.json');
    expect(issue?.message).toContain('Unknown data folder');
    expect(issue?.hint).toContain('"traits"');
  });

  it('rejects content in folders that have no schema yet', () => {
    for (const dir of ['news']) {
      const files = clone();
      files.push({ path: `data/${dir}/thing.json`, content: { id: 'x' } });
      const issue = errors(files).find((i) => i.file === `data/${dir}/thing.json`);
      expect(issue?.message, dir).toContain('no schema registered yet');
    }
  });

  it('rejects an unrecognised file at the top level', () => {
    const files = clone();
    files.push({ path: 'data/stuff.json', content: {} });
    expect(
      errors(files).some((i) => i.file === 'data/stuff.json' && i.message.includes('Unrecognised')),
    ).toBe(true);
  });

  it('requires calendar.json and settings.json', () => {
    for (const required of ['data/calendar.json', 'data/settings.json']) {
      const files = clone().filter((f) => f.path !== required);
      expect(errors(files)).toContainEqual(
        expect.objectContaining({ file: required, message: 'Required data file is missing' }),
      );
    }
  });

  it('ignores .gitkeep and README files', () => {
    const files = clone();
    files.push(
      { path: 'data/races/.gitkeep', content: undefined },
      { path: 'data/events/README.md', content: undefined },
    );
    expect(loadGameData(files).ok).toBe(true);
  });
});

describe('duplicates, arrays and conventions', () => {
  it('finds the same id defined in two files', () => {
    const files = clone();
    files.push({
      path: 'data/traits/zzz_copy.json',
      content: structuredClone(content(files, 'test_brawler.json')),
    });
    const dupe = errors(files).find((i) => i.message.startsWith('Duplicate trait id'));
    expect(dupe).toBeDefined();
    expect(dupe?.hint).toMatch(/already defined in data\/traits\//);
  });

  it('accepts a file holding an array of items and reports [index] paths', () => {
    const files = clone();
    const base = content(files, 'test_brawler.json');
    files.push({
      path: 'data/traits/pack.json',
      content: [
        { ...base, id: 'trait_pack_one' },
        {
          ...base,
          id: 'trait_pack_two',
          statMods: [{ stat: 'strength', value: 'x', kind: 'flat' }],
        },
      ],
    });
    const found = errors(files);
    expect(found).toContainEqual(
      expect.objectContaining({ file: 'data/traits/pack.json', field: '[1].statMods[0].value' }),
    );
    expect(found.filter((i) => i.file === 'data/traits/pack.json')).toHaveLength(1);
  });

  it('resolves references to items that live in array files', () => {
    const files = clone();
    const base = content(files, 'test_harbor.json');
    files.push({ path: 'data/locations/pack.json', content: [{ ...base, id: 'loc_pack_cove' }] });
    // Every place needs a sea lane (Phase 3), and lanes live in array files too.
    files.push({
      path: 'data/lanes/pack.json',
      content: [
        { id: 'lane_pack', from: 'loc_pack_cove', to: 'loc_test_harbor', miles: 80, danger: 0 },
      ],
    });
    content(files, 'test_crossroads.json')['conditions'][1].location = 'loc_pack_cove';
    expect(loadGameData(files).ok).toBe(true);
  });

  it('warns, but stays valid, when an id does not match its file name', () => {
    const files = clone();
    find(files, 'test_quick.json').path = 'data/traits/renamed.json';
    const result = loadGameData(files);
    expect(result.ok).toBe(true);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        severity: 'warning',
        file: 'data/traits/renamed.json',
        hint: expect.stringContaining('trait_renamed'),
      }),
    );
  });
});

describe('error quality', () => {
  it('reports every problem, not just the first', () => {
    const files = clone();
    content(files, 'test_brawler.json')['statMods'][0].value = 'x';
    content(files, 'test_notice.json')['text'] = '{nope}';
    content(files, 'test_harbor.json')['region'] = 'atlantis';
    expect(new Set(errors(files).map((i) => i.file)).size).toBe(3);
  });

  it('does not report a reference twice when the target exists but is itself invalid', () => {
    const files = clone();
    content(files, 'test_brawler.json')['statMods'][0].value = 'eight';
    const found = errors(files);
    expect(found.some((i) => i.message.startsWith('Unknown trait'))).toBe(false);
    expect(found).toHaveLength(1);
  });

  it('suggests close matches', () => {
    const files = clone();
    content(files, 'test_crossroads.json')['conditions'][0].trait = 'trait_test_brawlr';
    const issue = errors(files)[0];
    expect(issue?.hint).toBe('did you mean "trait_test_brawler"?');
  });

  it('formats an issue as file, field and message on one line', () => {
    const files = clone();
    content(files, 'test_brawler.json')['statMods'][0].value = 'eight';
    const line = formatIssue(errors(files)[0]!);
    expect(line).toMatch(/^data\/traits\/test_brawler\.json › statMods\[0\]\.value: /);
  });

  it('formats field paths', () => {
    expect(formatPath(['choices', 1, 'effects', 0, 'eventId'])).toBe(
      'choices[1].effects[0].eventId',
    );
    expect(formatPath([0, 'x'])).toBe('[0].x');
    expect(formatPath([])).toBe('(file)');
  });

  it('didYouMean ranks by closeness and ignores distant strings', () => {
    expect(didYouMean('trait_quik', ['trait_quick', 'trait_brawler', 'weapon_cutlass'])).toEqual([
      'trait_quick',
    ]);
    expect(didYouMean('zzzzzz', ['trait_quick'])).toEqual([]);
  });
});

describe('hashing sanity', () => {
  it('data hash is the canonical hash of the sorted path/content pairs', () => {
    const files = [...rawFiles]
      .filter((f) => !/\.gitkeep$/.test(f.path))
      .sort((a, b) => (a.path < b.path ? -1 : 1));
    expect(dataHash).toBe(hashValue(files.map((f) => [f.path, f.content ?? null])));
  });
});
