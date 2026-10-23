import { CANON_ID, GENERATED_ID, ID_FORMAT_HINT } from '../../src/engine/ids';
import type { RawFile } from '../../src/engine/data/loader';
import { ENTITY_TYPES } from '../../src/engine/state';

/**
 * Lint rules for data/canon (the hand-written cast and story beats).
 *
 * Phase 0 enforces the rules that exist before any lore does: canon ids are readable, typed
 * slugs, unique across every canon file, never in the generated `gen_` namespace, and consistent
 * with the entity type and origin they declare. Phase 3 adds the cast and beat schemas and the
 * keyframe rules (sorted, non-overlapping) here.
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
    if (!file.path.startsWith('data/canon/') || !file.path.endsWith('.json')) continue;
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
        issues.push({
          file: file.path,
          field: at('id'),
          message: 'Every canon entry needs a string id',
        });
        return;
      }
      if (GENERATED_ID.test(id)) {
        issues.push({
          file: file.path,
          field: at('id'),
          message: `"${id}" is in the generated id namespace; canon ids must be readable slugs`,
        });
      } else if (!CANON_ID.test(id)) {
        issues.push({
          file: file.path,
          field: at('id'),
          message: `"${id}" is not a valid canon id; use ${ID_FORMAT_HINT}`,
        });
      } else {
        const prefix = id.slice(0, id.indexOf('_'));
        const expectedType = PREFIX_TO_TYPE[prefix];
        const type = record['type'];
        if (type !== undefined) {
          if (typeof type !== 'string' || !(ENTITY_TYPES as readonly string[]).includes(type)) {
            issues.push({
              file: file.path,
              field: at('type'),
              message: `"${String(type)}" is not an entity type (${ENTITY_TYPES.join(', ')})`,
            });
          } else if (type !== expectedType) {
            issues.push({
              file: file.path,
              field: at('type'),
              message: `id prefix "${prefix}_" means type "${expectedType}", but type is "${type}"`,
            });
          }
        }
      }
      const origin = record['origin'];
      if (origin !== undefined && origin !== 'canon') {
        issues.push({
          file: file.path,
          field: at('origin'),
          message: `canon entries must have origin "canon", got "${String(origin)}"`,
        });
      }
      const earlier = seen.get(id);
      if (earlier !== undefined) {
        issues.push({
          file: file.path,
          field: at('id'),
          message: `Duplicate canon id "${id}" (also in ${earlier})`,
        });
      } else {
        seen.set(id, file.path);
      }
    });
  }
  return { issues, checkedFiles, checkedItems };
}
