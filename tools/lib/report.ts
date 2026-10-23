import type { DataIssue } from '../../src/engine/data/issues';
import type { LoadResult } from '../../src/engine/data/loader';

/** Human-readable validation report, grouped by file. Used by the CLI and the Vite build gate. */

export interface Style {
  red: (s: string) => string;
  yellow: (s: string) => string;
  green: (s: string) => string;
  dim: (s: string) => string;
  bold: (s: string) => string;
}

const plain: Style = {
  red: (s) => s,
  yellow: (s) => s,
  green: (s) => s,
  dim: (s) => s,
  bold: (s) => s,
};

export function makeStyle(color: boolean): Style {
  if (!color) return plain;
  const wrap = (open: number, close: number) => (s: string) =>
    `\u001b[${open}m${s}\u001b[${close}m`;
  return {
    red: wrap(31, 39),
    yellow: wrap(33, 39),
    green: wrap(32, 39),
    dim: wrap(2, 22),
    bold: wrap(1, 22),
  };
}

export function shouldColor(stream: { isTTY?: boolean } = process.stdout): boolean {
  return Boolean(stream.isTTY) && !process.env['NO_COLOR'];
}

function groupByFile(issues: readonly DataIssue[]): Map<string, DataIssue[]> {
  const groups = new Map<string, DataIssue[]>();
  for (const issue of issues) {
    const list = groups.get(issue.file) ?? [];
    list.push(issue);
    groups.set(issue.file, list);
  }
  return groups;
}

export function renderIssues(issues: readonly DataIssue[], style: Style = plain): string {
  const lines: string[] = [];
  for (const [file, list] of groupByFile(issues)) {
    lines.push(style.bold(file));
    for (const issue of list) {
      const tag = issue.severity === 'error' ? style.red('error  ') : style.yellow('warning');
      const hint = issue.hint ? style.dim(` (${issue.hint})`) : '';
      lines.push(`  ${tag} ${issue.field}: ${issue.message}${hint}`);
    }
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

export function renderSummary(result: LoadResult, style: Style = plain): string {
  const errors = result.issues.filter((i) => i.severity === 'error').length;
  const warnings = result.issues.length - errors;
  const counts = Object.entries(result.counts)
    .map(([kind, n]) => `${kind} ${n}`)
    .join(', ');
  if (errors > 0) {
    const files = new Set(result.issues.filter((i) => i.severity === 'error').map((i) => i.file))
      .size;
    return style.red(
      `Data is invalid: ${errors} problem${errors === 1 ? '' : 's'} in ${files} file${files === 1 ? '' : 's'}.`,
    );
  }
  const tail = warnings > 0 ? `, ${warnings} warning${warnings === 1 ? '' : 's'}` : '';
  return style.green(
    `Data is valid: ${result.fileCount} files (${counts}), data hash ${result.dataHash.slice(0, 12)}${tail}.`,
  );
}
