/**
 * Text templates for event text, news and log lines: "Posted in {monthName}, Year {year}."
 *
 * Syntax: `{name}` inserts a variable; `{{` and `}}` produce literal braces.
 *
 * The set of variables the engine can fill is a registry (TEMPLATE_VARS). The data validator
 * checks every template in /data against it, so a typo such as `{monthname}` stops the build and
 * names the file and field instead of printing "undefined" in the middle of a story.
 *
 * Adding a variable is one line here plus one line where templates are rendered.
 * `player.*` and `legacy.*` arrived with character creation (Phase 1); `role.*` arrives with the
 * event engine (Phase 3).
 *
 * Three registries, because three kinds of text are filled from different facts:
 *  - TEMPLATE_VARS: events, log lines and news, rendered while the world runs;
 *  - BACKSTORY_VARS: backstory lines, rendered while a character's past is generated;
 *  - APPEARANCE_VARS: the appearance sentence, assembled from the appearance fields.
 */

/** Marks a registry that accepts `{role.<name>.<field>}` (see `roleOfVar`). */
export const ROLE_WILDCARD = 'role.*';

/** The world's variables: dates, the player, and (Phase 3) places. */
const WORLD_VARS = [
  'date',
  'year',
  'month',
  'monthName',
  'season',
  'player.name',
  'player.givenName',
  'player.familyName',
  'player.race',
  'player.home',
  'legacy.parent',
  'legacy.parentName',
  // Phase 3: where things happen, and the people an event casts in its roles.
  'place',
  'destination',
  'ship',
] as const;

/** Event, log and news text: the world's variables, plus the people an event casts. */
export const TEMPLATE_VARS = [...WORLD_VARS, ROLE_WILDCARD] as const;
export type TemplateVarName = (typeof TEMPLATE_VARS)[number];

/**
 * `{role.<name>.<field>}` names a person an event casts (Phase 3): `{role.rival.name}`,
 * `{role.captain.title}`, `{role.stranger.they}`. A registry that lists this wildcard accepts any
 * such variable; the event's schema then checks that the role is declared.
 */
export const ROLE_FIELDS = ['name', 'title', 'they', 'them', 'their'] as const;
const ROLE_VAR = /^role\.([a-z][a-z0-9_]*)\.(name|title|they|them|their)$/;

/** The role a `{role.x.field}` variable names, or null. */
export function roleOfVar(name: string): string | null {
  return ROLE_VAR.exec(name)?.[1] ?? null;
}

export const BACKSTORY_VARS = [
  'age',
  'home',
  'race',
  'familyName',
  'parent',
  'parentName',
  'sibling',
  'other',
  'monthName',
  'season',
] as const;

/**
 * Life-loop text (Phase 2): activity outcomes, job shifts and the lines the life loop writes. The
 * world's variables plus the people, places and numbers of one month of a life. A variable that
 * names a person ({parent}, {friend}) must be guaranteed by the outcome's conditions; the schema
 * checks that, as it does for backstory text.
 */
export const LIFE_VARS = [
  ...WORLD_VARS,
  'age',
  'ageWords',
  'home',
  'other',
  'job',
  'amount',
  'parent',
  'sibling',
  'friend',
  'spouse',
  'child',
  'mentor',
  'sweetheart',
  'protege',
  'injury',
  'illness',
  'stage',
  'gang',
  'title',
  'cause',
  'stat',
  'months',
  'name',
] as const;

/**
 * The canon layer's own lines (Phase 3): the world's variables, plus who it is about ({name},
 * {title}), the beat ({beat}), why ({cause}), and who takes over ({successor}, {crew}, {fruit}).
 */
export const CANON_VARS = [
  ...WORLD_VARS,
  'name',
  'title',
  'beat',
  'cause',
  'successor',
  'crew',
  'fruit',
] as const;

export const APPEARANCE_VARS = [
  'a',
  'adjectives',
  'noun',
  'face',
  'skin',
  'hair',
  'eyes',
  'extras',
] as const;

/** Every {variable} a template uses, in order of first use. Empty if the template does not parse. */
export function templateVarsUsed(text: string): string[] {
  const parsed = parseTemplate(text);
  if (!parsed.ok) return [];
  const names: string[] = [];
  for (const token of parsed.tokens) {
    if (token.type === 'var' && !names.includes(token.name)) names.push(token.name);
  }
  return names;
}

export type TemplateToken = { type: 'text'; text: string } | { type: 'var'; name: string };

export type ParsedTemplate = { ok: true; tokens: TemplateToken[] } | { ok: false; error: string };

const VAR_NAME = /^[A-Za-z][A-Za-z0-9_.]*$/;

export function parseTemplate(text: string): ParsedTemplate {
  const tokens: TemplateToken[] = [];
  let buffer = '';
  let i = 0;
  const flush = () => {
    if (buffer.length > 0) tokens.push({ type: 'text', text: buffer });
    buffer = '';
  };
  while (i < text.length) {
    const ch = text.charAt(i);
    const next = text.charAt(i + 1);
    if (ch === '{' && next === '{') {
      buffer += '{';
      i += 2;
    } else if (ch === '}' && next === '}') {
      buffer += '}';
      i += 2;
    } else if (ch === '{') {
      const close = text.indexOf('}', i + 1);
      if (close === -1) return { ok: false, error: `Unclosed "{" at character ${i}` };
      const name = text.slice(i + 1, close);
      if (!VAR_NAME.test(name)) {
        return { ok: false, error: `"{${name}}" is not a valid variable name (character ${i})` };
      }
      flush();
      tokens.push({ type: 'var', name });
      i = close + 1;
    } else if (ch === '}') {
      return {
        ok: false,
        error: `Unmatched "}" at character ${i}; write "}}" for a literal brace`,
      };
    } else {
      buffer += ch;
      i += 1;
    }
  }
  flush();
  return { ok: true, tokens };
}

/** Problems with a template, as readable messages. Empty means the template is fine. */
export function checkTemplate(text: string, known: readonly string[] = TEMPLATE_VARS): string[] {
  const parsed = parseTemplate(text);
  if (!parsed.ok) return [parsed.error];
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const token of parsed.tokens) {
    if (token.type !== 'var' || seen.has(token.name)) continue;
    seen.add(token.name);
    if (known.includes(ROLE_WILDCARD) && roleOfVar(token.name) !== null) continue;
    if (!known.includes(token.name)) {
      problems.push(
        `Unknown template variable "{${token.name}}". Known variables: ${known.map((k) => `{${k}}`).join(', ')}`,
      );
    }
  }
  return problems;
}

export class TemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TemplateError';
  }
}

export function renderTemplate(text: string, vars: Readonly<Record<string, string>>): string {
  const parsed = parseTemplate(text);
  if (!parsed.ok) throw new TemplateError(parsed.error);
  let out = '';
  for (const token of parsed.tokens) {
    if (token.type === 'text') {
      out += token.text;
    } else {
      const value = vars[token.name];
      if (value === undefined)
        throw new TemplateError(`No value for template variable "{${token.name}}"`);
      out += value;
    }
  }
  return out;
}
