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
 * `player.*` and `role.*` variables arrive with character creation and the event engine.
 */

export const TEMPLATE_VARS = ['date', 'year', 'month', 'monthName', 'season'] as const;
export type TemplateVarName = (typeof TEMPLATE_VARS)[number];

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
