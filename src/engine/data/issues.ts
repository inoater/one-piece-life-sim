/**
 * Problems found while loading /data. Every issue names the file and the field, because that is
 * what a content author needs to fix it.
 */

export type Severity = 'error' | 'warning';

export interface DataIssue {
  severity: Severity;
  /** Path relative to the project root, e.g. "data/events/test_crossroads.json". */
  file: string;
  /** Field path inside the file, e.g. "choices[1].effects[0].eventId"; "(file)" for whole-file problems. */
  field: string;
  message: string;
  hint?: string;
}

export class DataValidationError extends Error {
  constructor(readonly issues: readonly DataIssue[]) {
    super(formatIssues(issues));
    this.name = 'DataValidationError';
  }
}

/** [ "choices", 1, "id" ] -> "choices[1].id" */
export function formatPath(path: readonly PropertyKey[]): string {
  let out = '';
  for (const part of path) {
    if (typeof part === 'number') out += `[${part}]`;
    else out += out === '' ? String(part) : `.${String(part)}`;
  }
  return out === '' ? '(file)' : out;
}

/** Single line, suitable for build errors: `file › field: message (hint)`. */
export function formatIssue(issue: DataIssue): string {
  const hint = issue.hint ? ` (${issue.hint})` : '';
  return `${issue.file} › ${issue.field}: ${issue.message}${hint}`;
}

export function formatIssues(issues: readonly DataIssue[]): string {
  const errors = issues.filter((i) => i.severity === 'error');
  const lines = errors.map((i) => `  ${formatIssue(i)}`);
  const noun = errors.length === 1 ? 'problem' : 'problems';
  return `Data validation failed with ${errors.length} ${noun}:\n${lines.join('\n')}`;
}

function distance(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = prev[0] as number;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = prev[j] as number;
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      prev[j] = Math.min(above + 1, (prev[j - 1] as number) + 1, diagonal + cost);
      diagonal = above;
    }
  }
  return prev[b.length] as number;
}

/** Candidates close to `input`, nearest first. Used for "did you mean ...?" hints. */
export function didYouMean(input: string, candidates: Iterable<string>, max = 3): string[] {
  const scored: { candidate: string; score: number }[] = [];
  for (const candidate of candidates) {
    const score = distance(input, candidate);
    const limit = Math.max(2, Math.floor(Math.max(input.length, candidate.length) / 3));
    if (score <= limit) scored.push({ candidate, score });
  }
  scored.sort((a, b) => a.score - b.score || a.candidate.localeCompare(b.candidate));
  return scored.slice(0, max).map((s) => s.candidate);
}
