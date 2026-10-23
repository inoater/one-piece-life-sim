import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { RawFile } from '../../src/engine/data/loader';

/**
 * Read every .json file under <root>/data as a RawFile (Node only).
 * JSON syntax errors become `parseError` so the loader can report them like any other issue,
 * with the line and column.
 */

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name.endsWith('.json')) out.push(full);
  }
}

function describeParseError(text: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const at = /position (\d+)/.exec(message);
  if (!at) return message;
  const position = Number(at[1]);
  const before = text.slice(0, position);
  const line = before.split('\n').length;
  const column = position - before.lastIndexOf('\n');
  return `${message} (line ${line}, column ${column})`;
}

export function readDataDir(root: string): RawFile[] {
  const dataDir = join(root, 'data');
  const paths: string[] = [];
  try {
    walk(dataDir, paths);
  } catch {
    return [];
  }
  return paths.map((full): RawFile => {
    const path = relative(root, full).split(sep).join('/');
    const text = readFileSync(full, 'utf8');
    try {
      return { path, content: JSON.parse(text) as unknown };
    } catch (error) {
      return { path, parseError: describeParseError(text, error) };
    }
  });
}
