import { CANON_ID, GENERATED_ID, ID_FORMAT_HINT } from '../../src/engine/ids';
import type { RawFile } from '../../src/engine/data/loader';
import { ENTITY_TYPES } from '../../src/engine/state';

/**
 * Lint rules for the canon: the cast (data/cast), the factions and crews (data/factions), the
 * places of the map (data/locations), and the story's beats (data/canon).
 *
 * Phase 0 set the rules that exist before any lore does: canon ids are readable, typed slugs,
 * unique across every canon file, never in the generated `gen_` namespace, and consistent with
 * the entity type and origin they declare. Phase 3 adds the folders the lore lives in (each with
 * its own id prefix), beat ids, and the keyframe rule: a character's keyframes never overlap.
 * Everything else about these files is checked by their schemas (npm run validate).
 */

export interface CanonIssue {
  file: string;
  field: string;
  message: string;
}

const PREFIX_TO_TYPE: Record<string, string> = {
  char: 'character',
  org: 'organization',
  ship: 'ship',
  item: 'item',
  fruit: 'fruit',
  loc: 'location',
};

/** Canon folders: which id prefix each holds (null: any canon entity prefix), and whether places may be invented. */
const FOLDERS: Record<string, { prefix: string | null; beats?: boolean; inventedOk?: boolean }> = {
  'data/cast/': { prefix: 'char' },
  'data/factions/': { prefix: 'org' },
  'data/locations/': { prefix: 'loc', inventedOk: true },
  'data/canon/': { prefix: null, beats: true },
};

const BEAT_ID = /^beat_[a-z0-9]+(?:_[a-z0-9]+)*$/;

interface When {
  year: number;
  month?: number;
}

const tickOf = (w: When) => w.year * 12 + ((w.month ?? 1) - 1);

function isWhen(v: unknown): v is When {
  return typeof v === 'object' && v !== null && typeof (v as When).year === 'number';
}

function folderOf(path: string) {
  for (const [dir, rule] of Object.entries(FOLDERS)) if (path.startsWith(dir)) return { dir, rule };
  return null;
}

export function lintCanon(files: readonly RawFile[]): {
  issues: CanonIssue[];
  checkedFiles: number;
  checkedItems: number;
} {
  const issues: CanonIssue[] = [];
  const seen = new Map<string, string>();
  let checkedFiles = 0;
  let checkedItems = 0;

  for (const file of files) {
    const folder = folderOf(file.path);
    if (!folder || !file.path.endsWith('.json')) continue;
    const { rule } = folder;
    checkedFiles += 1;
    if (file.parseError !== undefined) {
      issues.push({
        file: file.path,
        field: '(file)',
        message: `Invalid JSON: ${file.parseError}`,
      });
      continue;
    }
    const items = Array.isArray(file.content) ? file.content : [file.content];
    items.forEach((item, index) => {
      const at = (field: string) => (Array.isArray(file.content) ? `[${index}].${field}` : field);
      const issue = (field: string, message: string) =>
        issues.push({ file: file.path, field: at(field), message });
      if (typeof item !== 'object' || item === null || Array.isArray(item)) {
        issues.push({
          file: file.path,
          field: Array.isArray(file.content) ? `[${index}]` : '(file)',
          message: 'Expected an object',
        });
        return;
      }
      checkedItems += 1;
      const record = item as Record<string, unknown>;
      const id = record['id'];
      if (typeof id !== 'string') {
        issue('id', 'Every canon entry needs a string id');
        return;
      }
      if (rule.beats) {
        if (!BEAT_ID.test(id))
          issue('id', `"${id}" is not a valid beat id; use a slug such as "beat_god_valley"`);
      } else if (GENERATED_ID.test(id)) {
        issue('id', `"${id}" is in the generated id namespace; canon ids must be readable slugs`);
      } else if (!CANON_ID.test(id)) {
        issue('id', `"${id}" is not a valid canon id; use ${ID_FORMAT_HINT}`);
      } else {
        const prefix = id.slice(0, id.indexOf('_'));
        if (rule.prefix && prefix !== rule.prefix) {
          issue(
            'id',
            `"${id}" is in ${folder.dir} but its prefix says ${PREFIX_TO_TYPE[prefix] ?? prefix}`,
          );
        }
        const expectedType = PREFIX_TO_TYPE[prefix];
        const type = record['type'];
        if (type !== undefined && !rule.prefix) {
          if (typeof type !== 'string' || !(ENTITY_TYPES as readonly string[]).includes(type)) {
            issue('type', `"${String(type)}" is not an entity type (${ENTITY_TYPES.join(', ')})`);
          } else if (type !== expectedType) {
            issue(
              'type',
              `id prefix "${prefix}_" means type "${expectedType}", but type is "${type}"`,
            );
          }
        }
      }
      const origin = record['origin'];
      if (
        origin !== undefined &&
        origin !== 'canon' &&
        !(rule.inventedOk && origin === 'generated')
      ) {
        issue('origin', `canon entries must have origin "canon", got "${String(origin)}"`);
      }
      const earlier = seen.get(id);
      if (earlier !== undefined) {
        issue('id', `Duplicate canon id "${id}" (also in ${earlier})`);
      } else {
        seen.set(id, file.path);
      }
      // A character is in one place at a time: keyframes may not overlap.
      const keyframes = record['keyframes'];
      if (Array.isArray(keyframes)) {
        keyframes.forEach((k: unknown, i: number) => {
          const next = keyframes[i + 1] as { from?: unknown } | undefined;
          const to = (k as { to?: unknown }).to;
          if (isWhen(to) && next && isWhen(next.from) && tickOf(to) >= tickOf(next.from)) {
            issue(`keyframes[${i}].to`, 'overlaps the next keyframe (one place at a time)');
          }
        });
      }
    });
  }
  return { issues, checkedFiles, checkedItems };
}
