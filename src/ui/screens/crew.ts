import type { CrewView, RecruitProfile } from '../../worker/protocol';
import type { App } from '../app';
import { h, svg, type Child } from '../dom';
import { errorMessage, formatInteger } from '../format';
import { navigate } from '../router';
import type { UiState } from '../store';

/**
 * The Crew pages (Phase 8). `#/crew`: with no crew, the creator (kind, name and symbol, creed,
 * command, structure, pay, home, colours and dress, or a crew file to start from); with one, its
 * tabs: the crew itself (creed, limits, morale, purse, traditions), the roster (sort and filter by
 * role, stat, loyalty, morale, injury and bounty; pin; compare two side by side; training plans),
 * the positions (a drawing of the ship with its stations, a line-up per situation, fit in words
 * and numbers, the cost of an empty post, locks and the auto-fill), recruits (the board, the
 * cells, the auction block, open quests, rumoured legends), command (missions, the fleet,
 * alliances, bases, prisoners) and the log (the captain's log, who left, people you know).
 * `#/recruit/<id>`: a recruit's profile, only what the player has learned, and the scene of
 * winning them over. Every button is an action; locks come from the same code the month runs.
 */

type Crew = NonNullable<CrewView['crew']>;
type Member = Crew['members'][number];
type Situation = keyof Crew['posts'];

const TABS = ['crew', 'roster', 'posts', 'recruit', 'command', 'log'] as const;
type Tab = (typeof TABS)[number];
const TAB_LABEL: Record<Tab, string> = {
  crew: 'Crew',
  roster: 'Roster',
  posts: 'Positions',
  recruit: 'Recruit',
  command: 'Command',
  log: 'Log',
};
const SITUATION_LABEL: Record<Situation, string> = {
  sea: 'At sea',
  battle: 'In battle',
  port: 'In port',
  storm: 'In a storm',
};

/** Page state the person keeps while on it (not the world's). */
interface Local {
  tab: Tab;
  situation: Situation | null;
  sort: 'role' | 'loyalty' | 'morale' | 'cp' | 'bounty' | 'name' | string;
  filter: string;
  compare: string[];
  creating: boolean;
}

function button(label: string, busy: boolean, onclick: () => void, extra = ''): HTMLButtonElement {
  return h(
    'button',
    { class: `button button--tiny ${extra}`.trim(), type: 'button', disabled: busy, onclick },
    label,
  );
}

function lockedButton(
  label: string,
  lock: string | null,
  busy: boolean,
  onclick: () => void,
): HTMLElement {
  return h(
    'span',
    { class: 'crew-act' },
    h(
      'button',
      {
        class: 'button button--tiny',
        type: 'button',
        disabled: busy || lock !== null,
        title: lock ?? '',
        onclick,
      },
      label,
    ),
    lock ? h('span', { class: 'crew-lock' }, lock) : null,
  );
}

function section(title: string, ...children: (Child | readonly Child[])[]): HTMLElement {
  return h(
    'section',
    { class: 'powers-page__section crew-section' },
    h('h3', { class: 'powers-page__heading' }, title),
    ...children,
  );
}

function facts(rows: [string, Child][]): HTMLElement {
  return h(
    'dl',
    { class: 'heart-facts' },
    rows.map(([k, v]) => h('div', null, h('dt', null, k), h('dd', null, v))),
  );
}

function select(
  label: string,
  options: { value: string; text: string; disabled?: boolean }[],
  value: string | null,
  onchange?: (v: string) => void,
): HTMLSelectElement {
  const el = h(
    'select',
    {
      class: 'heart-input',
      'aria-label': label,
      onchange: onchange
        ? (e: Event) => onchange((e.target as HTMLSelectElement).value)
        : undefined,
    },
    options.map((o) =>
      h('option', { value: o.value, selected: o.value === value, disabled: o.disabled }, o.text),
    ),
  );
  return el;
}

function meterRow(name: string, value: number, max = 100): HTMLElement {
  const pct = Math.max(0, Math.min(100, Math.round((value / max) * 100)));
  return h(
    'div',
    { class: 'heart-meter', role: 'group', 'aria-label': `${name} ${value}` },
    h('span', { class: 'heart-meter__name' }, name),
    h(
      'span',
      { class: 'heart-meter__track', 'aria-hidden': 'true' },
      h('span', { class: 'heart-meter__fill', style: `left: 0; width: ${pct}%` }),
    ),
    h('span', { class: 'heart-meter__value' }, String(value)),
  );
}

// ---- The creator -----------------------------------------------------------------------------------

function creator(
  view: CrewView,
  app: App,
  busy: boolean,
  editing: Crew | null,
  done: () => void,
): HTMLElement {
  const o = view.options;
  const kindSel = select(
    'Kind',
    o.kinds.map((k) => ({ value: k.id, text: k.name })),
    editing?.kind ?? 'pirate',
  );
  kindSel.disabled = editing !== null;
  const name = h('input', {
    class: 'heart-input',
    'aria-label': 'Name',
    maxlength: '60',
    value: editing?.name ?? '',
    placeholder: o.kinds[0]?.defaultName ?? '',
  });
  const symbol = h('input', {
    class: 'heart-input',
    'aria-label': 'Symbol',
    maxlength: '120',
    value: editing?.symbol ?? '',
    placeholder: 'A skull in a straw hat',
  });
  const colours = h('input', {
    class: 'heart-input',
    'aria-label': 'Colours',
    maxlength: '120',
    value: editing?.colours ?? '',
    placeholder: 'Red and gold',
  });
  const dress = h('input', {
    class: 'heart-input',
    'aria-label': 'Dress',
    maxlength: '120',
    value: editing?.dress ?? '',
    placeholder: 'No uniform',
  });
  const creed = new Map<string, HTMLSelectElement>();
  const creedRows = o.creed.map((rule) => {
    const sel = select(
      rule.name,
      rule.options.map((x) => ({ value: x.id, text: `${x.name}: ${x.text}` })),
      editing?.creed.find((c) => c.rule === rule.id)?.option ?? null,
    );
    creed.set(rule.id, sel);
    return h('label', { class: 'crew-field' }, h('span', null, rule.name), sel);
  });
  const fixedOf = () =>
    o.kinds.find((k) => k.id === kindSel.value)?.fixed ?? {
      command: null,
      structure: null,
      pay: null,
    };
  const command = select(
    'Command style',
    o.commands.map((x) => ({ value: x.id, text: `${x.name}: ${x.text}` })),
    editing?.command ?? null,
  );
  const structure = select(
    'Structure',
    o.structures.map((x) => ({ value: x.id, text: `${x.name}: ${x.text}` })),
    editing?.structure ?? null,
  );
  const pay = select(
    'Pay',
    o.pays.map((x) => ({ value: x.id, text: `${x.name}: ${x.text}` })),
    editing?.pay ?? null,
  );
  const home = select(
    'Home',
    [
      { value: 'ship', text: 'A ship' },
      { value: 'base', text: 'A base' },
      { value: 'none', text: 'None' },
    ],
    null,
  );
  const note = h('p', { class: 'muted crew-note' });
  const syncFixed = () => {
    const f = fixedOf();
    const kind = o.kinds.find((k) => k.id === kindSel.value);
    if (!editing && kind) {
      // A new crew starts from its kind's own ways (a Marine unit's creed is not a pirate's).
      name.placeholder = kind.defaultName;
      command.value = kind.defaults.command;
      structure.value = kind.defaults.structure;
      pay.value = kind.defaults.pay;
      for (const [rule, sel] of creed) sel.value = kind.defaults.creed[rule] ?? sel.value;
    }
    for (const [sel, value] of [
      [command, f.command],
      [structure, f.structure],
      [pay, f.pay],
    ] as const) {
      sel.disabled = value !== null;
      if (value) sel.value = value;
    }
    note.textContent =
      f.command || f.structure || f.pay
        ? `A ${kind?.name.toLowerCase() ?? 'group'}: some of its ways are fixed for it.`
        : '';
  };
  kindSel.addEventListener('change', syncFixed);
  syncFixed();
  const file = h('textarea', {
    class: 'heart-input crew-file',
    'aria-label': 'A crew file',
    rows: '3',
    placeholder: 'Paste a crew file to start from it',
  });
  const submit = () => {
    const spec: Record<string, unknown> = {
      ...(name.value.trim() ? { name: name.value.trim() } : {}),
      symbol: symbol.value,
      colours: colours.value,
      dress: dress.value,
      creed: Object.fromEntries([...creed.entries()].map(([k, s]) => [k, s.value])),
      ...(command.disabled ? {} : { command: command.value }),
      ...(structure.disabled ? {} : { structure: structure.value }),
      ...(pay.disabled ? {} : { pay: pay.value }),
      home: home.value,
    };
    void app
      .dispatch(
        editing
          ? { type: 'crew/edit', ...spec }
          : { type: 'crew/found', kind: kindSel.value, ...spec },
        editing ? 'Changed.' : 'Founded.',
      )
      .then((ok) => {
        if (ok) done();
      });
  };
  return section(
    editing ? `Change ${editing.name}` : 'Found a crew',
    h(
      'div',
      { class: 'crew-form' },
      h('label', { class: 'crew-field' }, h('span', null, 'Kind'), kindSel),
      h('label', { class: 'crew-field' }, h('span', null, 'Name'), name),
      h('label', { class: 'crew-field' }, h('span', null, 'Symbol'), symbol),
      h('label', { class: 'crew-field' }, h('span', null, 'Colours'), colours),
      h('label', { class: 'crew-field' }, h('span', null, 'Dress'), dress),
      h('label', { class: 'crew-field' }, h('span', null, 'Command'), command),
      h('label', { class: 'crew-field' }, h('span', null, 'Structure'), structure),
      h('label', { class: 'crew-field' }, h('span', null, 'Pay'), pay),
      editing ? null : h('label', { class: 'crew-field' }, h('span', null, 'Home'), home),
    ),
    note,
    h('h4', { class: 'heart-subhead' }, 'The creed'),
    h('div', { class: 'crew-form' }, creedRows),
    h(
      'div',
      { class: 'crew-actions' },
      button(editing ? 'Save' : 'Found it', busy, submit),
      editing ? button('Cancel', busy, done) : null,
    ),
    editing
      ? null
      : h(
          'details',
          { class: 'crew-import' },
          h('summary', null, 'Start from a crew file'),
          file,
          button(
            'Import',
            busy,
            () => void app.dispatch({ type: 'crew/import', text: file.value }, 'Imported.'),
          ),
        ),
  );
}

// ---- Tabs -----------------------------------------------------------------------------------------

function crewTab(
  crew: Crew,
  view: CrewView,
  app: App,
  busy: boolean,
  local: Local,
  redraw: () => void,
): HTMLElement[] {
  const deposit = h('input', {
    class: 'heart-input',
    type: 'number',
    min: '0',
    step: '1000',
    value: '10000',
    'aria-label': 'Berries',
  });
  return [
    section(
      crew.name,
      facts([
        ['Kind', crew.kindName],
        [crew.mark, crew.symbol || '—'],
        ['Colours', crew.colours || '—'],
        ['Dress', crew.dress || '—'],
        [
          'Command',
          `${crew.commandName}${crew.fixed.command ? ` (${crew.fixed.command.toLowerCase()})` : ''}`,
        ],
        [
          'Structure',
          `${crew.structureName}${crew.fixed.structure ? ` (${crew.fixed.structure.toLowerCase()})` : ''}`,
        ],
        ['Pay', crew.payName],
        ['Home', crew.home],
        ['Founded', crew.founded],
      ]),
      button('Change it', busy, () => {
        local.creating = true;
        redraw();
      }),
      button('Export as a file', busy, () => {
        void app.host.call('crew/export', {}).then((text) => {
          if (!text) return;
          const blob = new Blob([text], { type: 'application/json' });
          const a = h('a', {
            href: URL.createObjectURL(blob),
            download: `${crew.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.crew.json`,
          });
          a.click();
        });
      }),
    ),
    section(
      'The creed',
      h(
        'ul',
        { class: 'crew-creed' },
        crew.creed.map((c) =>
          h('li', null, h('strong', null, `${c.ruleName}: ${c.optionName}. `), c.text),
        ),
      ),
    ),
    section(
      'How it stands',
      meterRow(`Morale (${crew.moraleWords})`, crew.morale),
      facts([
        ['Aboard', `${crew.size} of ${crew.limit} before morale strains`],
        ['The limit', crew.limitParts.map((p) => `${p.source} ${p.value}`).join(', ')],
        [
          'The purse',
          `${formatInteger(crew.treasury)} Berries${crew.unpaid > 0 ? ` (pay ${crew.unpaid} month${crew.unpaid === 1 ? '' : 's'} behind)` : ''}`,
        ],
        ['Total bounty', `${formatInteger(crew.totalBounty)} Berries`],
        [
          'Record',
          `${crew.tally['won'] ?? 0} battles won, ${crew.tally['lost'] ?? 0} lost, ${crew.tally['voyages'] ?? 0} voyages, ${crew.tally['missions'] ?? 0} missions`,
        ],
      ]),
      h(
        'div',
        { class: 'crew-actions' },
        deposit,
        button(
          'Into the purse',
          busy,
          () =>
            void app.dispatch({ type: 'crew/treasury', amount: Math.round(Number(deposit.value)) }),
        ),
        button(
          'Out of the purse',
          busy,
          () =>
            void app.dispatch({
              type: 'crew/treasury',
              amount: -Math.round(Number(deposit.value)),
            }),
        ),
      ),
    ),
    section(
      'Traditions',
      crew.traditions.length > 0
        ? h(
            'ul',
            { class: 'heart-rep' },
            crew.traditions.map((t) => h('li', null, `${t.name}, since ${t.since}`)),
          )
        : h('p', { class: 'muted' }, 'None yet: a crew grows its own rituals with time.'),
    ),
  ];
  void view;
}

function sortValue(m: Member, key: string): number | string {
  switch (key) {
    case 'name':
      return m.name;
    case 'role':
      return m.roleName;
    case 'loyalty':
      return -m.loyalty;
    case 'morale':
      return -m.morale;
    case 'cp':
      return -m.cp;
    case 'bounty':
      return -m.bounty;
    case 'injury':
      return m.hurt ? 0 : 1;
    default:
      return -(m.stats[key] ?? 0);
  }
}

function rosterTab(
  crew: Crew,
  view: CrewView,
  app: App,
  busy: boolean,
  local: Local,
  redraw: () => void,
): HTMLElement[] {
  const roles = [...new Set(crew.members.map((m) => m.roleName))].sort();
  const sortSel = select(
    'Sort by',
    [
      { value: 'role', text: 'Role' },
      { value: 'name', text: 'Name' },
      { value: 'loyalty', text: 'Loyalty' },
      { value: 'morale', text: 'Morale' },
      { value: 'cp', text: 'Combat Power' },
      { value: 'bounty', text: 'Bounty' },
      { value: 'injury', text: 'Injured first' },
      ...Object.keys(crew.members[0]?.stats ?? {}).map((s) => ({
        value: s,
        text: s.charAt(0).toUpperCase() + s.slice(1),
      })),
    ],
    local.sort,
    (v) => {
      local.sort = v;
      redraw();
    },
  );
  const filterSel = select(
    'Filter',
    [
      { value: '', text: 'Everyone' },
      { value: 'hurt', text: 'Injured' },
      { value: 'away', text: 'Away' },
      { value: 'officers', text: 'Officers' },
      ...roles.map((r) => ({ value: `role:${r}`, text: r })),
    ],
    local.filter,
    (v) => {
      local.filter = v;
      redraw();
    },
  );
  const shown = crew.members
    .filter(
      (m) =>
        !local.filter ||
        (local.filter === 'hurt'
          ? m.hurt
          : local.filter === 'away'
            ? m.away !== null
            : local.filter === 'officers'
              ? m.officer
              : m.roleName === local.filter.slice(5)),
    )
    .sort(
      (a, b) =>
        Number(b.pinned) - Number(a.pinned) ||
        (sortValue(a, local.sort) < sortValue(b, local.sort)
          ? -1
          : sortValue(a, local.sort) > sortValue(b, local.sort)
            ? 1
            : a.name.localeCompare(b.name)),
    );
  const rows = shown.map((m) =>
    h(
      'tr',
      { class: m.pinned ? 'is-pinned' : '' },
      h(
        'td',
        null,
        h('a', { href: `#/recruit/${m.id}` }, m.name),
        m.epithet ? h('span', { class: 'muted' }, ` “${m.epithet}”`) : null,
        m.titles.length > 0 ? h('div', { class: 'muted' }, m.titles.join(', ')) : null,
      ),
      h('td', null, `${m.roleName}${m.officer ? ' (officer)' : ''}${m.rank ? `, ${m.rank}` : ''}`),
      h('td', null, `${m.loyalty} (${m.loyaltyWords})`),
      h('td', null, String(m.morale)),
      h('td', null, String(m.cp)),
      h('td', null, m.bounty > 0 ? formatInteger(m.bounty) : '—'),
      h('td', null, m.hurt ? 'laid up' : (m.away ?? (m.bound ? `bound for ${m.bound}` : 'aboard'))),
      h(
        'td',
        { class: 'crew-row-acts' },
        button(
          m.pinned ? 'Unpin' : 'Pin',
          busy,
          () => void app.dispatch({ type: 'crew/pin', member: m.id, on: !m.pinned }),
        ),
        h(
          'label',
          { class: 'heart-toggle' },
          h('input', {
            type: 'checkbox',
            checked: local.compare.includes(m.id),
            onchange: () => {
              local.compare = local.compare.includes(m.id)
                ? local.compare.filter((x) => x !== m.id)
                : [...local.compare.slice(-1), m.id];
              redraw();
            },
          }),
          'Compare',
        ),
      ),
    ),
  );
  const pair = local.compare
    .map((id) => crew.members.find((m) => m.id === id))
    .filter((m): m is Member => m !== undefined);
  const compare =
    pair.length === 2
      ? section(
          `${pair[0]?.name} and ${pair[1]?.name}`,
          h(
            'table',
            { class: 'crew-table crew-compare' },
            h(
              'thead',
              null,
              h(
                'tr',
                null,
                h('th', null, ''),
                pair.map((m) => h('th', null, m.name)),
              ),
            ),
            h(
              'tbody',
              null,
              [
                ['Role', (m: Member) => m.roleName],
                ['Loyalty', (m: Member) => String(m.loyalty)],
                ['Morale', (m: Member) => String(m.morale)],
                ['Combat Power', (m: Member) => String(m.cp)],
                ['Bounty', (m: Member) => formatInteger(m.bounty)],
                ...Object.keys(pair[0]?.stats ?? {}).map(
                  (s) =>
                    [
                      s.charAt(0).toUpperCase() + s.slice(1),
                      (m: Member) => String(m.stats[s] ?? 0),
                    ] as const,
                ),
                [
                  'Best at',
                  (m: Member) =>
                    m.fits
                      .map((f) => `${f.name} (${f.words})`)
                      .slice(0, 2)
                      .join(', '),
                ],
              ].map(([label, f]) =>
                h(
                  'tr',
                  null,
                  h('th', { scope: 'row' }, label as string),
                  pair.map((m) => h('td', null, (f as (m: Member) => string)(m))),
                ),
              ),
            ),
          ),
          pair[0] && pair[1]
            ? h(
                'p',
                { class: 'muted' },
                `Between them: ${pair[0].chemistry.find((c) => c.id === pair[1]?.id)?.words ?? 'easy'}.`,
              )
            : null,
        )
      : null;
  const details = shown.map((m) => memberDetail(m, crew, view, app, busy));
  return [
    section(
      'The roster',
      h(
        'div',
        { class: 'crew-actions' },
        h('label', { class: 'crew-field' }, h('span', null, 'Sort'), sortSel),
        h('label', { class: 'crew-field' }, h('span', null, 'Show'), filterSel),
      ),
      crew.members.length === 0
        ? h(
            'p',
            { class: 'muted' },
            'Nobody yet. The Recruit tab lists who is looking for a ship here.',
          )
        : h(
            'div',
            { class: 'crew-table-wrap' },
            h(
              'table',
              { class: 'crew-table' },
              h(
                'thead',
                null,
                h(
                  'tr',
                  null,
                  ['Name', 'Role', 'Loyalty', 'Morale', 'Combat Power', 'Bounty', 'Where', ''].map(
                    (x) => h('th', { scope: 'col' }, x),
                  ),
                ),
              ),
              h('tbody', null, rows),
            ),
          ),
    ),
    ...(compare ? [compare] : []),
    ...details,
  ];
}

function memberDetail(m: Member, crew: Crew, view: CrewView, app: App, busy: boolean): HTMLElement {
  const focus = select(
    'Train',
    view.options.focuses.map((f) => ({ value: f.id, text: f.name })),
    m.plan.focus,
  );
  const effort = select(
    'Effort',
    [
      { value: 'light', text: 'Light' },
      { value: 'normal', text: 'Normal' },
      { value: 'hard', text: 'Hard' },
    ],
    m.plan.effort,
  );
  const partner = select(
    'With',
    [
      { value: '', text: 'Alone (or whoever teaches)' },
      ...crew.members.filter((x) => x.id !== m.id).map((x) => ({ value: x.id, text: x.name })),
    ],
    m.plan.partner ?? '',
  );
  const role = select('Role', view.options.focuses.length > 0 ? crewRoles(crew, m) : [], m.role);
  const mission = select(
    'Mission',
    view.options.missions.map((x) => ({ value: x.id, text: `${x.name} (${x.months} months)` })),
    view.options.missions[0]?.id ?? null,
  );
  const target = h('input', {
    class: 'heart-input',
    'aria-label': 'Where or whom (an id)',
    placeholder: 'Place or person id, if it needs one',
  });
  return h(
    'details',
    { class: 'crew-member' },
    h('summary', null, `${m.name}: ${m.roleName}`),
    facts([
      ['Joined', `${m.joined} (${m.months} months)`],
      [
        'Bars',
        `Loyalty ${m.loyalty}, Morale ${m.morale}, Belonging ${m.belonging}, Respect ${m.respect}`,
      ],
      ['Best at', m.fits.map((f) => `${f.name} ${f.score} (${f.words})`).join('; ')],
      [
        'Role skill',
        Object.entries(m.mastery)
          .map(([k, v]) => `${k.replace(/_/g, ' ')} ${v}`)
          .join(', ') || '—',
      ],
      [
        'Stories',
        m.arcs
          .map((a) => `${a.name}${a.done ? ' (told)' : ` (${a.step} of ${a.steps})`}`)
          .join('; ') || '—',
      ],
      ['Taught by crewmates', m.taught.join(', ') || '—'],
      ['With the others', m.chemistry.map((c) => `${c.name}: ${c.words}`).join(', ') || '—'],
      ...(m.spy ? [['Spy', m.spy] as [string, Child]] : []),
    ]),
    h(
      'div',
      { class: 'crew-actions' },
      h('label', { class: 'crew-field' }, h('span', null, 'Role'), role),
      button(
        'Set role',
        busy,
        () => void app.dispatch({ type: 'crew/role', member: m.id, role: role.value }),
      ),
    ),
    h(
      'div',
      { class: 'crew-actions' },
      h('label', { class: 'crew-field' }, h('span', null, 'Train'), focus),
      effort,
      partner,
      button(
        'Set the plan',
        busy,
        () =>
          void app.dispatch({
            type: 'crew/plan',
            member: m.id,
            focus: focus.value,
            effort: effort.value,
            partner: partner.value || null,
          }),
      ),
    ),
    h(
      'div',
      { class: 'crew-actions' },
      mission,
      target,
      button(
        'Send',
        busy || m.away !== null,
        () =>
          void app.dispatch({
            type: 'crew/send',
            member: m.id,
            mission: mission.value,
            target: target.value.trim() || null,
          }),
      ),
    ),
    h(
      'div',
      { class: 'crew-actions' },
      m.officer
        ? null
        : button(
            'Make an officer',
            busy,
            () => void app.dispatch({ type: 'crew/promote', member: m.id }),
          ),
      button(
        'Dismiss',
        busy,
        () => void app.dispatch({ type: 'crew/dismiss', member: m.id }),
        'button--danger',
      ),
    ),
  );
}

function crewRoles(crew: Crew, m: Member): { value: string; text: string }[] {
  const known = new Map<string, string>();
  for (const x of crew.members) for (const f of x.fits) known.set(f.role, f.name);
  for (const p of Object.values(crew.posts).flat()) known.set(p.role, p.roleName);
  known.delete('captain');
  return [...known.entries()]
    .sort((a, b) => a[1].localeCompare(b[1]))
    .map(([value, text]) => ({
      value,
      text: `${text}${m.fits.find((f) => f.role === value) ? ` (${m.fits.find((f) => f.role === value)?.words})` : ''}`,
    }));
}

/** The positions screen: a drawing of the ship with its stations. */
function postsTab(
  crew: Crew,
  app: App,
  busy: boolean,
  local: Local,
  redraw: () => void,
): HTMLElement[] {
  const situation = local.situation ?? crew.situationNow;
  const posts = crew.posts[situation];
  const tabs = h(
    'div',
    { class: 'crew-subtabs', role: 'tablist' },
    (Object.keys(SITUATION_LABEL) as Situation[]).map((s) =>
      h(
        'button',
        {
          class: `button button--tiny ${s === situation ? 'is-on' : ''}`,
          type: 'button',
          role: 'tab',
          'aria-selected': String(s === situation),
          onclick: () => {
            local.situation = s;
            redraw();
          },
        },
        `${SITUATION_LABEL[s]}${s === crew.situationNow ? ' (now)' : ''}`,
      ),
    ),
  );
  const drawing = svg(
    'svg',
    {
      class: 'crew-ship',
      viewBox: '0 0 100 100',
      role: 'img',
      'aria-label': `The ship's stations ${SITUATION_LABEL[situation].toLowerCase()}`,
    },
    svg('path', {
      class: 'crew-ship__hull',
      d: 'M4 50 Q8 20 50 18 Q88 18 97 50 Q88 82 50 82 Q8 80 4 50 Z',
    }),
    svg('line', { class: 'crew-ship__mast', x1: '50', y1: '18', x2: '50', y2: '82' }),
    posts.map((p) =>
      svg(
        'g',
        { class: `crew-station ${p.empty ? 'is-empty' : p.hands ? 'is-hands' : 'is-filled'}` },
        svg('circle', { cx: String(p.x), cy: String(p.y), r: '3.2' }),
        svg(
          'text',
          { x: String(p.x), y: String(p.y + 7), 'text-anchor': 'middle' },
          p.name.split(',')[0] ?? p.name,
        ),
        svg(
          'title',
          null,
          `${p.name}: ${p.whoName ?? (p.hands ? 'deck hands' : 'nobody')}. ${p.empty ? p.emptyText : p.effects.join('; ')}`,
        ),
      ),
    ),
  );
  const rows = posts.map((p) => {
    const who = select(
      p.name,
      [
        { value: '', text: 'Nobody' },
        ...p.options.map((o) => ({ value: o.id, text: `${o.name}: ${o.score} (${o.words})` })),
      ],
      p.who ?? '',
    );
    return h(
      'tr',
      { class: p.empty ? 'is-empty' : '' },
      h('th', { scope: 'row' }, p.name, h('div', { class: 'muted' }, p.roleName)),
      h(
        'td',
        null,
        p.whoName ?? (p.hands ? 'Deck hands' : 'Nobody'),
        p.double ? h('div', { class: 'muted' }, 'double duty') : null,
        p.problem ? h('div', { class: 'crew-lock' }, p.problem) : null,
      ),
      h('td', null, p.empty ? '—' : `${p.score} (${p.words})`),
      h(
        'td',
        null,
        p.empty ? h('span', { class: 'crew-cost' }, p.emptyText) : p.effects.join('; '),
      ),
      h(
        'td',
        { class: 'crew-row-acts' },
        who,
        button(
          'Set',
          busy,
          () =>
            void app.dispatch({
              type: 'crew/post',
              situation,
              post: p.id,
              member: who.value || null,
            }),
        ),
        button(
          p.locked ? 'Unlock' : 'Lock',
          busy,
          () => void app.dispatch({ type: 'crew/lock', situation, post: p.id, on: !p.locked }),
        ),
      ),
    );
  });
  return [
    section(
      'Positions aboard',
      tabs,
      h(
        'p',
        { class: 'muted' },
        'A role says what someone is good at; a post says where they stand and when. Each situation has its own line-up, and the ship switches between them by itself.',
      ),
      h(
        'label',
        { class: 'heart-toggle' },
        h('input', {
          type: 'checkbox',
          checked: crew.auto,
          disabled: busy,
          onchange: () => void app.dispatch({ type: 'crew/auto', on: !crew.auto }),
        }),
        'Fill the posts by role every month (locked posts stay)',
      ),
      drawing,
      h(
        'div',
        { class: 'crew-table-wrap' },
        h(
          'table',
          { class: 'crew-table crew-posts' },
          h(
            'thead',
            null,
            h(
              'tr',
              null,
              ['Post', 'Who', 'Fit', 'What it does', ''].map((x) => h('th', { scope: 'col' }, x)),
            ),
          ),
          h('tbody', null, rows),
        ),
      ),
    ),
  ];
}

function candidateRow(
  c: CrewView['recruits']['board'][number],
  extra: Child | readonly Child[],
): HTMLElement {
  return h(
    'li',
    { class: 'crew-candidate' },
    h('a', { href: `#/recruit/${c.id}` }, c.name),
    ` ${c.age}, ${c.race.toLowerCase()}${c.job ? `, ${c.job.toLowerCase()}` : ''}: ${c.estimate}; best as ${c.best}.`,
    c.price !== null ? ` ${formatInteger(c.price)} Berries.` : '',
    ' ',
    extra,
  );
}

function recruitTab(view: CrewView, app: App, busy: boolean): HTMLElement[] {
  const r = view.recruits;
  return [
    section(
      r.here ? `Looking for a ship in ${r.here}` : 'At sea',
      r.board.length > 0
        ? h(
            'ul',
            { class: 'crew-candidates' },
            r.board.map((c) =>
              candidateRow(
                c,
                h('a', { href: `#/recruit/${c.id}`, class: 'button button--tiny' }, 'Talk to them'),
              ),
            ),
          )
        : h(
            'p',
            { class: 'muted' },
            r.here ? 'Nobody on the board here this quarter.' : 'The lists are ashore.',
          ),
    ),
    section(
      'The cells',
      r.prison.length > 0
        ? h(
            'ul',
            { class: 'crew-candidates' },
            r.prison.map((c) =>
              candidateRow(c, [
                button(
                  'Pay the bail',
                  busy,
                  () => void app.dispatch({ type: 'crew/free', target: c.id, how: 'bail' }),
                ),
                button(
                  'Break them out',
                  busy,
                  () => void app.dispatch({ type: 'crew/free', target: c.id, how: 'break' }),
                  'button--danger',
                ),
              ]),
            ),
          )
        : h('p', { class: 'muted' }, 'No cells here, or nobody in them worth the trouble.'),
    ),
    section(
      'The auction block',
      r.auction.length > 0
        ? h(
            'ul',
            { class: 'crew-candidates' },
            r.auction.map((c) =>
              candidateRow(
                c,
                button(
                  'Buy their freedom',
                  busy,
                  () => void app.dispatch({ type: 'crew/free', target: c.id, how: 'buy' }),
                ),
              ),
            ),
          )
        : h('p', { class: 'muted' }, 'No auction here.'),
    ),
    section(
      'Won over, or nearly',
      r.open.length > 0
        ? h(
            'ul',
            { class: 'crew-candidates' },
            r.open.map((o) =>
              h(
                'li',
                null,
                h('a', { href: `#/recruit/${o.id}` }, o.name),
                `: ${o.state}${o.tracker ? `. ${o.tracker}.` : '.'}`,
              ),
            ),
          )
        : h(
            'p',
            { class: 'muted' },
            'Nobody is weighing up your offer. Anyone you know can be asked: their profile is a click away on the People page.',
          ),
    ),
    section(
      'Legends, by rumour',
      r.legends.length > 0
        ? h(
            'ul',
            { class: 'crew-candidates' },
            r.legends.map((l) =>
              h(
                'li',
                null,
                l.found ? h('a', { href: `#/recruit/${l.id}` }, l.name) : l.name,
                `, ${l.found ? 'found' : 'said to be'} at ${l.where}.`,
              ),
            ),
          )
        : h('p', { class: 'muted' }, 'No rumours yet. Ask around in port, and explore.'),
    ),
  ];
}

function commandTab(crew: Crew, view: CrewView, app: App, busy: boolean): HTMLElement[] {
  const baseKind = select(
    'Kind of base',
    view.options.baseKinds.map((k) => ({
      value: k.id,
      text: `${k.name}: ${formatInteger(k.cost)} Berries${k.lock ? ` (${k.lock})` : ''}`,
    })),
    view.options.baseKinds[0]?.id ?? null,
  );
  const captain = select(
    'Captain',
    view.captains.map((c) => ({ value: c.id, text: c.name })),
    null,
  );
  const ship = select(
    'Ship',
    view.ships.map((s) => ({ value: s.id, text: s.name })),
    null,
  );
  const officer = select(
    'Officer',
    crew.members.filter((m) => m.officer).map((m) => ({ value: m.id, text: m.name })),
    null,
  );
  return [
    section(
      'The fleet',
      crew.fleet.length > 0
        ? h(
            'ul',
            { class: 'crew-candidates' },
            crew.fleet.map((f) => {
              const sel = select(
                'Order',
                view.options.orders.map((o) => ({ value: o.id, text: `${o.name}: ${o.text}` })),
                null,
              );
              return h(
                'li',
                null,
                `${f.name} under ${f.captain}: ${f.order}${f.target ? ` (${f.target})` : ''}. Loyalty ${f.loyalty}, ambition ${f.ambition}. `,
                sel,
                button('Order', busy, () => {
                  const needsPlace =
                    view.options.orders.find((o) => o.id === sel.value)?.target === 'place';
                  void app.dispatch({
                    type: 'crew/order',
                    crew: f.crew,
                    order: sel.value,
                    target: needsPlace ? view.recruits.hereId : null,
                  });
                }),
              );
            }),
          )
        : h(
            'p',
            { class: 'muted' },
            'No crew is sworn to you. A captain who respects or fears you enough may drink from your cup; an officer with a ship of their own may sail under your flag.',
          ),
      h(
        'div',
        { class: 'crew-actions' },
        captain,
        button(
          'Ask them to swear',
          busy || view.captains.length === 0,
          () => void app.dispatch({ type: 'crew/swear', captain: captain.value }),
        ),
      ),
      h(
        'div',
        { class: 'crew-actions' },
        officer,
        ship,
        button(
          'Give them the ship',
          busy || view.ships.length < 2,
          () => void app.dispatch({ type: 'crew/detach', member: officer.value, ship: ship.value }),
        ),
      ),
    ),
    section(
      'Alliances',
      crew.alliances.length > 0
        ? h(
            'ul',
            { class: 'crew-candidates' },
            crew.alliances.map((a) =>
              h('li', null, `${a.captain}: ${a.goal} (${a.status}, since ${a.since})`),
            ),
          )
        : h('p', { class: 'muted' }, 'None.'),
      h(
        'div',
        { class: 'crew-actions' },
        captain.cloneNode(true) as HTMLElement,
        button(
          'Hold together for half a year',
          busy || view.captains.length === 0,
          () =>
            void app.dispatch({
              type: 'crew/ally',
              captain: captain.value,
              goal: 'hold',
              target: null,
            }),
        ),
      ),
    ),
    section(
      'Bases',
      crew.bases.length > 0
        ? h(
            'ul',
            { class: 'crew-candidates' },
            crew.bases.map((b) => {
              const room = select(
                'Room',
                view.options.rooms.map((r) => ({
                  value: r.id,
                  text: `${r.name}: ${formatInteger(r.cost)} (upkeep ${formatInteger(r.upkeep)})`,
                })),
                null,
              );
              return h(
                'li',
                null,
                `${b.name} (${b.kind}, ${b.place}): defence ${b.defence}. Rooms: ${b.rooms.map((r) => `${r.name}${r.level > 1 ? ` ${r.level}` : ''}`).join(', ') || 'none'}.${b.lastRaid ? ` Raided ${b.lastRaid}.` : ''} `,
                room,
                button(
                  'Build',
                  busy,
                  () => void app.dispatch({ type: 'crew/build', base: b.id, room: room.value }),
                ),
              );
            }),
          )
        : h('p', { class: 'muted' }, 'No base. A cove, a fortress, a ship graveyard, a capital.'),
      h(
        'div',
        { class: 'crew-actions' },
        baseKind,
        button(
          'Claim it here',
          busy,
          () => void app.dispatch({ type: 'crew/claimBase', kind: baseKind.value }),
        ),
      ),
    ),
    section(
      `Prisoners (${crew.prisoners.length} of ${crew.prisonRoom})`,
      crew.prisoners.length > 0
        ? h(
            'ul',
            { class: 'crew-candidates' },
            crew.prisoners.map((x) =>
              h(
                'li',
                null,
                `${x.name}, held in the ${x.where === 'base' ? 'cells' : 'brig'} since ${x.since}. `,
                ...(['interrogate', 'ransom', 'marines', 'recruit', 'release'] as const).map(
                  (act) =>
                    button(
                      act === 'marines'
                        ? 'Hand to the Marines'
                        : act === 'ransom'
                          ? `Ransom (${formatInteger(x.ransom)})`
                          : act.charAt(0).toUpperCase() + act.slice(1),
                      busy || (act === 'interrogate' && x.interrogated),
                      () => void app.dispatch({ type: 'crew/prisoner', prisoner: x.id, act }),
                    ),
                ),
              ),
            ),
          )
        : h('p', { class: 'muted' }, 'Nobody in irons.'),
    ),
  ];
}

function logTab(crew: Crew, view: CrewView): HTMLElement[] {
  return [
    section(
      'The captain’s log',
      crew.log.length > 0
        ? h(
            'ol',
            { class: 'crew-log' },
            crew.log.map((l) =>
              h('li', null, h('span', { class: 'muted' }, `${l.date}: `), l.text),
            ),
          )
        : h('p', { class: 'muted' }, 'Nothing written yet.'),
    ),
    section(
      'People you know',
      view.people.length > 0
        ? h(
            'ol',
            { class: 'crew-log' },
            view.people.map((l) =>
              h('li', null, h('span', { class: 'muted' }, `${l.date}: `), l.text),
            ),
          )
        : h('p', { class: 'muted' }, 'No news of them yet.'),
    ),
    section(
      'Who has gone',
      crew.former.length > 0
        ? h(
            'ul',
            { class: 'crew-log' },
            crew.former.map((f) => h('li', null, `${f.name}: ${f.why} (${f.date})`)),
          )
        : h('p', { class: 'muted' }, 'Nobody yet.'),
    ),
  ];
}

export interface CrewPage {
  el: HTMLElement;
  show(state: UiState): Promise<void>;
}

export function createCrewPage(app: App): CrewPage {
  const body = h('div', { class: 'powers-page__body' });
  const el = h(
    'section',
    { class: 'powers-page crew-page', 'aria-labelledby': 'crew-title' },
    body,
  );
  const local: Local = {
    tab: 'crew',
    situation: null,
    sort: 'role',
    filter: '',
    compare: [],
    creating: false,
  };
  let last: { view: CrewView | null; state: UiState } | null = null;
  const draw = () => {
    if (!last) return;
    const { view, state } = last;
    const busy = state.busy !== null;
    if (!view) {
      body.replaceChildren(h('p', { class: 'muted' }, 'Nobody alive is being played.'));
      return;
    }
    const title = h(
      'h2',
      { class: 'powers-page__title', id: 'crew-title' },
      view.crew ? view.crew.name : 'Crew',
    );
    if (!view.crew || local.creating) {
      body.replaceChildren(
        title,
        creator(view, app, busy, local.creating ? view.crew : null, () => {
          local.creating = false;
          draw();
        }),
        ...(view.crew ? [] : recruitTab(view, app, busy)),
      );
      return;
    }
    const crew = view.crew;
    const tabs = h(
      'div',
      { class: 'crew-tabs', role: 'tablist' },
      TABS.map((t) =>
        h(
          'button',
          {
            class: `button button--tiny ${t === local.tab ? 'is-on' : ''}`,
            type: 'button',
            role: 'tab',
            'aria-selected': String(t === local.tab),
            onclick: () => {
              local.tab = t;
              draw();
            },
          },
          TAB_LABEL[t],
        ),
      ),
    );
    const content =
      local.tab === 'crew'
        ? crewTab(crew, view, app, busy, local, draw)
        : local.tab === 'roster'
          ? rosterTab(crew, view, app, busy, local, draw)
          : local.tab === 'posts'
            ? postsTab(crew, app, busy, local, draw)
            : local.tab === 'recruit'
              ? recruitTab(view, app, busy)
              : local.tab === 'command'
                ? commandTab(crew, view, app, busy)
                : logTab(crew, view);
    body.replaceChildren(
      title,
      h(
        'p',
        { class: 'muted crew-sub' },
        `${crew.kindName}, ${crew.size} aboard, ${crew.moraleWords}.`,
      ),
      tabs,
      ...content,
    );
  };
  return {
    el,
    async show(state) {
      try {
        const view = await app.host.call('crew/view', {
          view: { omniscient: state.omniscient, hash: false },
        });
        last = { view, state };
        draw();
      } catch (error) {
        body.replaceChildren(h('p', { class: 'muted' }, errorMessage(error)));
      }
    },
  };
}

// ---- A recruit's profile ---------------------------------------------------------------------------

export function recruitIdOf(hash: string): string | null {
  return hash.replace(/^#\/?/, '').split('/')[1] ?? null;
}

function profile(p: RecruitProfile, app: App, busy: boolean): HTMLElement[] {
  const j = p.joining;
  const scene: HTMLElement[] = [];
  if (j.inCrew) scene.push(h('p', null, `${p.name} sails with you.`));
  else if (j.quest)
    scene.push(
      h(
        'p',
        null,
        h('strong', null, `${j.quest.name}: `),
        `${j.quest.tracker}.`,
        j.quest.met ? ' Done: they will join at the month’s end.' : '',
      ),
      h(
        'div',
        { class: 'crew-actions' },
        j.quest.acts.map((a) =>
          lockedButton(
            a.label,
            a.lock,
            busy,
            () => void app.dispatch({ type: 'crew/quest', target: p.id, act: a.id }),
          ),
        ),
      ),
    );
  else if (j.listening && j.objections.length > 0)
    for (const o of j.objections)
      scene.push(
        h(
          'div',
          { class: 'crew-objection' },
          h('p', null, o.line),
          h(
            'div',
            { class: 'crew-actions' },
            o.answers.map((a) =>
              button(
                `${a.label}${a.amount > 0 ? ` (${formatInteger(a.amount)} Berries)` : ''}`,
                busy,
                () =>
                  void app.dispatch({
                    type: 'crew/answer',
                    target: p.id,
                    objection: o.id,
                    answer: a.id,
                  }),
              ),
            ),
          ),
        ),
      );
  else
    scene.push(
      j.lock
        ? h('p', { class: 'crew-lock' }, j.lock)
        : h(
            'p',
            { class: 'muted' },
            j.refused
              ? `They said no in ${j.refused}. Try something they have not heard, or show them something new.`
              : 'What do you offer them?',
          ),
      h(
        'ul',
        { class: 'crew-pitches' },
        j.pitches.map((x) =>
          h(
            'li',
            null,
            button(
              `${x.name}${x.berries > 0 ? ` (${formatInteger(x.berries)})` : ''}`,
              busy || j.lock !== null,
              () => void app.dispatch({ type: 'crew/pitch', target: p.id, pitch: x.id }),
            ),
            ` ${x.text} `,
            h('span', { class: 'muted' }, `${x.words}${x.tried ? ', tried' : ''}`),
          ),
        ),
      ),
    );
  return [
    h('h2', { class: 'powers-page__title', id: 'recruit-title' }, p.name),
    h(
      'p',
      { class: 'muted' },
      `${p.known === 'crewmate' ? 'In your crew' : p.known === 'acquaintance' ? 'Someone you know' : 'A stranger'}. Your read on them: ${p.read} of 100.`,
    ),
    section(
      'Who they are',
      facts([
        ['Born', p.background.born],
        ['Age', String(p.background.age)],
        ['Race', p.background.race],
        ['Trade', p.background.job ?? '—'],
        ['Family', p.background.family.join(', ') || '—'],
        ['Found', p.background.source ?? 'met in passing'],
        ['Nature', p.nature.join(', ') || '—'],
        ['Values', p.values.join(', ')],
        ['Dream', p.dream ? `To ${p.dream}` : 'You do not know them well enough to know'],
        ['Traits', p.traits.join(', ') || '—'],
      ]),
      p.background.history ? h('p', { class: 'crew-history' }, p.background.history) : null,
    ),
    section(
      'What they can do',
      h('p', null, `Strength in a fight: ${p.combat}. ${p.potential}`),
      h(
        'ul',
        { class: 'crew-stats' },
        p.stats.map((s) =>
          h(
            'li',
            null,
            h('strong', null, `${s.label}: `),
            s.value !== null ? `${s.value} (${s.words})` : s.words,
          ),
        ),
      ),
      h('h4', { class: 'heart-subhead' }, 'Role fit'),
      h(
        'ul',
        { class: 'crew-fits' },
        p.fits.map((f) =>
          h(
            'li',
            null,
            h('strong', null, `${f.name}: ${f.words}`),
            ` (${f.score}). ${f.reasons.join('; ')}.`,
          ),
        ),
      ),
      p.powers.length > 0
        ? h('p', null, `Powers: ${p.powers.join(', ')}.`)
        : h('p', { class: 'muted' }, 'You have not seen them fight.'),
    ),
    section(
      'Where they stand',
      facts([
        [
          'Bounty',
          p.status.bounty > 0
            ? `${formatInteger(p.status.bounty)} Berries${p.status.epithet ? `, “${p.status.epithet}”` : ''}`
            : 'None',
        ],
        ['Answers to', p.status.captain ?? p.status.crew ?? 'Nobody'],
        ['Loyalty', p.status.loyalty !== null ? String(p.status.loyalty) : '—'],
        ['In debt', p.status.debt ? 'Yes' : 'Not that you know'],
        ['Ties', p.ties.map((t) => `${t.name} (${t.how})`).join(', ') || '—'],
        ['Secrets', p.secret ?? 'None that you know of'],
      ]),
    ),
    section('Winning them over', ...scene),
    h(
      'p',
      null,
      h('a', { href: `#/person/${p.id}` }, 'Their person page'),
      ' · ',
      h('a', { href: '#/crew' }, 'The crew'),
    ),
  ];
}

export function createRecruitPage(app: App): CrewPage {
  const body = h('div', { class: 'powers-page__body' });
  const el = h(
    'section',
    { class: 'powers-page recruit-page', 'aria-labelledby': 'recruit-title' },
    body,
  );
  return {
    el,
    async show(state) {
      const id = recruitIdOf(window.location.hash);
      if (!id) {
        navigate('crew');
        return;
      }
      try {
        const view = await app.host.call('crew/recruit', {
          id,
          view: { omniscient: state.omniscient, hash: false },
        });
        body.replaceChildren(
          ...(view
            ? profile(view, app, state.busy !== null)
            : [h('p', { class: 'muted' }, 'Nobody of that name.')]),
        );
      } catch (error) {
        body.replaceChildren(h('p', { class: 'muted' }, errorMessage(error)));
      }
    },
  };
}
