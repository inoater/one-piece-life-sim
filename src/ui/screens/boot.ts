import type { DataIssue } from '../../engine/data/issues';
import { h } from '../dom';

export function renderLoading(): HTMLElement {
  return h(
    'div',
    { class: 'boot' },
    h('p', { class: 'boot__text', role: 'status' }, 'Starting the simulation...'),
  );
}

/** Group issues by file so a content author can work through them one file at a time. */
function groupIssues(issues: readonly DataIssue[]): Map<string, DataIssue[]> {
  const groups = new Map<string, DataIssue[]>();
  for (const issue of issues) {
    const list = groups.get(issue.file) ?? [];
    list.push(issue);
    groups.set(issue.file, list);
  }
  return groups;
}

/** The game cannot start. Say why, and for data problems name every file and field. */
export function renderFatal(error: {
  message: string;
  issues?: readonly DataIssue[] | undefined;
}): HTMLElement {
  const issues = (error.issues ?? []).filter((i) => i.severity === 'error');
  if (issues.length === 0) {
    return h(
      'div',
      { class: 'boot boot--error', role: 'alert' },
      h('h1', { class: 'boot__title' }, 'The game could not start'),
      h('p', null, error.message),
      h(
        'p',
        { class: 'muted' },
        'Reloading the page may help. If it keeps happening, the message above says what went wrong.',
      ),
    );
  }
  return h(
    'div',
    { class: 'boot boot--error', role: 'alert' },
    h('h1', { class: 'boot__title' }, 'The game data has a problem'),
    h(
      'p',
      null,
      'Fix the files below and reload. The same check runs from the terminal with ',
      h('code', null, 'npm run validate'),
      '.',
    ),
    [...groupIssues(issues)].map(([file, list]) =>
      h(
        'section',
        { class: 'issue-file' },
        h('h2', { class: 'issue-file__name' }, h('code', null, file)),
        h(
          'ul',
          { class: 'issue-file__list' },
          list.map((issue) =>
            h(
              'li',
              null,
              h('code', { class: 'issue__field' }, issue.field),
              ' ',
              issue.message,
              issue.hint ? h('span', { class: 'issue__hint' }, ` (${issue.hint})`) : null,
            ),
          ),
        ),
      ),
    ),
  );
}
