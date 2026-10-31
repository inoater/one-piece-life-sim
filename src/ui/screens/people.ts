import type { HeartSelfView, PersonView, WebView } from '../../worker/protocol';
import type { App } from '../app';
import { attachBreakdownTooltip } from '../components/breakdown';
import { h, svg, type Child } from '../dom';
import { errorMessage, formatInteger } from '../format';
import { navigate } from '../router';
import type { UiState } from '../store';

/**
 * The People pages (Phase 7). `#/people`: the player's own heart (mood, morale, conscience, their
 * tendencies, what is said of them), the Contacts list (labels, last seen, Den Den Mushi numbers
 * and Vivre Cards), the web of family and crew, what they have been told, and the scenes (a feast,
 * a crew meeting, adopting, an animal). `#/person/<id>`: a person page with a portrait slot (art
 * in Phase 14), who they are as far as the player knows, every axis and bar with its breakdown
 * traced to the events behind it, their memories of the player, and the intent menu with the
 * chances in words. Every button is an action; locks come from the same code the talk runs.
 */

type Breakdown = PersonView['theirs'][number];

const GROUP_LABEL: Record<string, string> = {
  friendly: 'Friendly',
  information: 'Information',
  requests: 'Requests',
  pressure: 'Pressure',
  conflict: 'Conflict',
  bonds: 'Bonds',
};

function button(label: string, busy: boolean, onclick: () => void, extra = ''): HTMLButtonElement {
  return h(
    'button',
    { class: `button button--tiny ${extra}`.trim(), type: 'button', disabled: busy, onclick },
    label,
  );
}

function breakdownTable(b: Breakdown): HTMLElement {
  const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n)}`;
  return h(
    'table',
    { class: 'breakdown heart-breakdown' },
    h(
      'tbody',
      null,
      h(
        'tr',
        { class: 'breakdown__row' },
        h('th', { scope: 'row' }, 'Base'),
        h('td', null, String(b.base)),
        h('td', { class: 'breakdown__note' }, b.baseNote),
      ),
      b.lines.map((l) =>
        h(
          'tr',
          { class: 'breakdown__row' },
          h('th', { scope: 'row' }, l.source),
          h('td', null, signed(l.value)),
          h('td', { class: 'breakdown__note' }, l.what ? `${l.when}: ${l.what}` : ''),
        ),
      ),
      h(
        'tr',
        { class: 'breakdown__row breakdown__row--total' },
        h('th', { scope: 'row' }, 'Total'),
        h('td', null, String(b.value)),
        h('td', { class: 'breakdown__note' }, ''),
      ),
    ),
  );
}

/** One axis or bar: a meter whose breakdown opens on hover or focus (rule 3). */
function meter(b: Breakdown): HTMLElement {
  const span = b.max - b.min;
  const pct = span <= 0 ? 0 : Math.round(((b.value - b.min) / span) * 100);
  const zero = b.min < 0 ? Math.round((-b.min / span) * 100) : 0;
  const row = h(
    'div',
    {
      class: 'heart-meter',
      tabindex: '0',
      role: 'group',
      'aria-label': `${b.name} ${b.value}. ${b.lines.length} things behind it.`,
    },
    h('span', { class: 'heart-meter__name' }, b.name),
    h(
      'span',
      { class: 'heart-meter__track', 'aria-hidden': 'true' },
      b.min < 0 ? h('span', { class: 'heart-meter__zero', style: `left: ${zero}%` }) : null,
      h('span', {
        class: `heart-meter__fill ${b.value < 0 ? 'is-negative' : ''}`,
        style:
          b.min < 0
            ? b.value >= 0
              ? `left: ${zero}%; width: ${pct - zero}%`
              : `left: ${pct}%; width: ${zero - pct}%`
            : `left: 0; width: ${pct}%`,
      }),
    ),
    h('span', { class: 'heart-meter__value' }, String(b.value)),
  );
  attachBreakdownTooltip(row, () => breakdownTable(b));
  return row;
}

// ---- The People page --------------------------------------------------------------------------

function selfSection(view: HeartSelfView, app: App, busy: boolean): HTMLElement {
  return h(
    'section',
    { class: 'powers-page__section heart-self' },
    h('h3', { class: 'powers-page__heading' }, 'You'),
    h(
      'dl',
      { class: 'heart-facts' },
      h('div', null, h('dt', null, 'Mood'), h('dd', null, view.mood)),
      h('div', null, h('dt', null, 'Morale'), h('dd', null, `${view.morale} of 100`)),
      h(
        'div',
        null,
        h('dt', null, 'Conscience'),
        h('dd', null, `${view.conscienceWords} (${view.conscience})`),
      ),
      h('div', null, h('dt', null, 'You value'), h('dd', null, view.values.join(', '))),
      h('div', null, h('dt', null, 'Your dream'), h('dd', null, `To ${view.dream}`)),
      h('div', null, h('dt', null, 'You speak'), h('dd', null, view.voice)),
    ),
    view.tendencies.length > 0
      ? h(
          'ul',
          { class: 'heart-tendencies' },
          view.tendencies.map((t) => h('li', null, `${t}.`)),
        )
      : h('p', { class: 'muted' }, 'Nobody could say yet what sort of person you are.'),
    h('h4', { class: 'heart-subhead' }, 'What is said of you here'),
    h(
      'ul',
      { class: 'heart-rep' },
      view.repHere.map((r) =>
        h(
          'li',
          null,
          h('span', null, r.name),
          h(
            'span',
            { class: 'muted' },
            r.value >= 10 ? r.high : r.value <= -10 ? r.low : 'nothing much',
          ),
        ),
      ),
    ),
    view.reputation.length > 0
      ? h(
          'p',
          { class: 'muted' },
          `Elsewhere: ${view.reputation.map((r) => `${r.place} (${r.words})`).join('; ')}.`,
        )
      : null,
    h(
      'label',
      { class: 'heart-toggle' },
      h('input', {
        type: 'checkbox',
        checked: view.romance,
        disabled: busy,
        onchange: (e: Event) =>
          void app.dispatch(
            { type: 'heart/romance', on: (e.target as HTMLInputElement).checked },
            (e.target as HTMLInputElement).checked ? 'Romance is on.' : 'Romance is off.',
          ),
      }),
      ' Romance (adults only)',
    ),
  );
}

function contactsSection(view: HeartSelfView): HTMLElement {
  return h(
    'section',
    { class: 'powers-page__section' },
    h('h3', { class: 'powers-page__heading' }, `Contacts (${view.contacts.length})`),
    view.contacts.length === 0
      ? h('p', { class: 'muted' }, 'You do not know anyone yet.')
      : h(
          'ul',
          { class: 'contacts' },
          view.contacts.map((c) =>
            h(
              'li',
              { class: 'contact' },
              h('a', { class: 'contact__name', href: `#/person/${c.id}` }, c.name),
              h('span', { class: 'chip-fact' }, c.label),
              c.here ? h('span', { class: 'moves__badge' }, 'Here') : null,
              h(
                'span',
                { class: 'contact__meta muted' },
                [
                  c.bond,
                  c.lastSeen ? `last seen ${c.lastSeen}` : null,
                  c.where ? `in ${c.where}` : null,
                  c.number ? 'has their number' : null,
                  c.vivre ? 'carrying their Vivre Card' : null,
                ]
                  .filter(Boolean)
                  .join(' · '),
              ),
            ),
          ),
        ),
  );
}

function scenesSection(view: HeartSelfView, app: App, busy: boolean): HTMLElement {
  const send = (action: unknown, note: string) => void app.dispatch(action, note);
  const nameInput = h('input', {
    class: 'heart-input',
    type: 'text',
    maxlength: '30',
    placeholder: 'Name (optional)',
    'aria-label': 'Name for the animal',
  });
  const heirSelect = h(
    'select',
    { class: 'heart-input', 'aria-label': 'Heir' },
    view.contacts
      .filter(
        (c) => ['child', 'protege', 'sibling', 'crewmate', 'friend'].includes(c.kind) && !c.animal,
      )
      .map((c) => h('option', { value: c.id }, `${c.name} (${c.label})`)),
  );
  return h(
    'section',
    { class: 'powers-page__section' },
    h('h3', { class: 'powers-page__heading' }, 'Together'),
    h(
      'div',
      { class: 'heart-scenes' },
      button(`Throw a feast (${view.guestsHere} here)`, busy || view.guestsHere === 0, () =>
        send({ type: 'heart/banquet' }, 'A feast.'),
      ),
      button('Crew meeting: decide', busy || view.crewHere === 0, () =>
        send({ type: 'heart/meeting', mode: 'rule' }, 'You decided.'),
      ),
      button('Crew meeting: put it to a vote', busy || view.crewHere === 0, () =>
        send({ type: 'heart/meeting', mode: 'ask' }, 'You asked them.'),
      ),
      button('Adopt a child', busy || !view.canAdopt, () =>
        send({ type: 'heart/adopt' }, 'A child came home with you.'),
      ),
    ),
    h(
      'div',
      { class: 'heart-scenes' },
      heirSelect,
      button('Name as heir', busy || heirSelect.options.length === 0, () =>
        send({ type: 'heart/will', heir: heirSelect.value }, 'Your will is made.'),
      ),
      view.heir ? h('span', { class: 'muted' }, `Heir: ${view.heir}`) : null,
    ),
    view.companionsHere.length > 0
      ? h(
          'div',
          { class: 'heart-companions' },
          h('h4', { class: 'heart-subhead' }, 'Animals to be had here'),
          nameInput,
          h(
            'ul',
            { class: 'power-learns' },
            view.companionsHere.map((s) =>
              h(
                'li',
                { class: 'power-learn' },
                h('span', { class: 'power-learn__name' }, `${s.name} (${s.kind})`),
                h('span', { class: 'power-learn__desc' }, s.description),
                h(
                  'span',
                  { class: 'power-learn__buttons' },
                  button(
                    s.price > 0 ? `${formatInteger(s.price)} Berries` : 'Take it in',
                    busy,
                    () =>
                      send(
                        {
                          type: 'heart/companion',
                          species: s.id,
                          ...(nameInput.value.trim() ? { name: nameInput.value.trim() } : {}),
                        },
                        `A ${s.name} is yours.`,
                      ),
                  ),
                ),
              ),
            ),
          ),
        )
      : null,
  );
}

function factsSection(view: HeartSelfView): HTMLElement | null {
  if (view.facts.length === 0) return null;
  return h(
    'section',
    { class: 'powers-page__section' },
    h('h3', { class: 'powers-page__heading' }, 'What you have been told'),
    h(
      'ul',
      { class: 'heart-told' },
      view.facts
        .slice(0, 20)
        .map((f) =>
          h(
            'li',
            { class: f.truth === false ? 'is-false' : '' },
            h('span', null, `${f.text.charAt(0).toUpperCase()}${f.text.slice(1)}.`),
            h(
              'span',
              { class: 'muted' },
              ` Told by ${f.from}, ${f.when}.${f.checked === 'false' ? ' It was a lie.' : f.checked === 'confirmed' ? ' True.' : f.truth === false ? ' (False.)' : ''}`,
            ),
          ),
        ),
    ),
  );
}

const GROUP_COLOUR: Record<string, string> = {
  you: 'var(--ink)',
  family: 'var(--cat-family)',
  crew: 'var(--cat-world)',
  love: 'var(--squall)',
  friends: 'var(--cat-news)',
  other: 'var(--mist)',
};

/** The web: the player in the middle, the people around, and how they stand with each other. */
export function renderWeb(web: WebView): HTMLElement {
  const size = 360;
  const c = size / 2;
  const others = web.nodes.filter((n) => n.group !== 'you');
  const pos = new Map<string, { x: number; y: number }>();
  pos.set(web.nodes[0]?.id ?? '', { x: c, y: c });
  others.forEach((n, i) => {
    const angle = (i / Math.max(1, others.length)) * Math.PI * 2 - Math.PI / 2;
    const r = c - 40;
    pos.set(n.id, { x: c + r * Math.cos(angle), y: c + r * Math.sin(angle) });
  });
  const lines = web.edges.map((e) => {
    const a = pos.get(e.a);
    const b = pos.get(e.b);
    if (!a || !b) return null;
    return svg('line', {
      x1: a.x,
      y1: a.y,
      x2: b.x,
      y2: b.y,
      class: `web__edge ${e.affection < 0 ? 'is-cold' : ''}`,
      'stroke-width': 1 + Math.min(3, Math.abs(e.affection) / 30),
    });
  });
  const dots = web.nodes.map((n) => {
    const p = pos.get(n.id) ?? { x: c, y: c };
    const short = n.name.split(' ')[0] ?? n.name;
    return svg(
      'g',
      { class: 'web__node' },
      svg('circle', {
        cx: p.x,
        cy: p.y,
        r: n.group === 'you' ? 10 : 7,
        fill: GROUP_COLOUR[n.group] ?? 'currentColor',
      }),
      svg('text', { x: p.x, y: p.y + 20, 'text-anchor': 'middle', class: 'web__label' }, short),
      svg('title', null, `${n.name}: ${n.label}`),
    );
  });
  return h(
    'figure',
    { class: 'web' },
    svg(
      'svg',
      {
        viewBox: `0 0 ${size} ${size}`,
        role: 'img',
        'aria-label': 'Your family, crew and closest, and how they stand with each other',
      },
      lines,
      dots,
    ),
    h(
      'figcaption',
      { class: 'muted' },
      'Family, crew, love and friends. Thicker lines are stronger feelings; dashed are cold ones.',
    ),
  );
}

export function renderPeople(state: UiState, app: App, web: WebView | null): Child[] {
  const view = state.snapshot?.heart;
  const busy = state.busy !== null;
  if (!view) return [h('p', { class: 'muted' }, 'Nobody alive is being played.')];
  return [
    h(
      'header',
      { class: 'powers-page__header' },
      h('h2', { class: 'powers-page__title', id: 'people-title' }, 'People'),
      h(
        'p',
        { class: 'powers-page__lead' },
        'Everyone you know, and who you are to them. Open a person to talk, ask, press or make a promise.',
      ),
    ),
    selfSection(view, app, busy),
    contactsSection(view),
    web && web.nodes.length > 1
      ? h(
          'section',
          { class: 'powers-page__section' },
          h('h3', { class: 'powers-page__heading' }, 'The web'),
          renderWeb(web),
        )
      : null,
    scenesSection(view, app, busy),
    factsSection(view),
  ];
}

export interface PeoplePage {
  el: HTMLElement;
  show(state: UiState): Promise<void>;
}

export function createPeoplePage(app: App): PeoplePage {
  const body = h('div', { class: 'powers-page__body' });
  const el = h(
    'section',
    { class: 'powers-page people-page', 'aria-labelledby': 'people-title' },
    body,
  );
  return {
    el,
    async show(state) {
      let web: WebView | null = null;
      try {
        web = await app.host.call('heart/web', {});
      } catch {
        web = null;
      }
      body.replaceChildren(...(renderPeople(state, app, web).filter((e) => e) as Node[]));
    },
  };
}

// ---- A person -----------------------------------------------------------------------------------

function intentMenu(view: PersonView, app: App, busy: boolean): HTMLElement {
  const remote = !view.here;
  const person = h(
    'select',
    { class: 'heart-input', 'aria-label': 'Ask about whom' },
    view.topics.people.map((p) => h('option', { value: p.id }, p.name)),
  );
  const place = h(
    'select',
    { class: 'heart-input', 'aria-label': 'Ask about where' },
    view.topics.places.map((p) => h('option', { value: p.id }, p.name)),
  );
  const amount = h('input', {
    class: 'heart-input',
    type: 'number',
    min: '1',
    step: '100',
    value: '500',
    'aria-label': 'Berries',
  });
  const groups = new Map<string, PersonView['intents']>();
  for (const i of view.intents) groups.set(i.group, [...(groups.get(i.group) ?? []), i]);
  return h(
    'section',
    { class: 'powers-page__section heart-intents' },
    h('h3', { class: 'powers-page__heading' }, remote ? 'Over the Den Den Mushi' : 'Talk'),
    h(
      'p',
      { class: 'muted' },
      `${view.talksLeft} more ${view.talksLeft === 1 ? 'talk' : 'talks'} with ${view.name.split(' ')[0]} this month.${remote ? ' At a distance: harder, and half the effect.' : ''}`,
    ),
    h(
      'div',
      { class: 'heart-topics' },
      h('label', null, 'About whom ', person),
      h('label', null, 'Where ', place),
      h('label', null, 'Berries ', amount),
    ),
    [...groups.entries()].map(([group, list]) =>
      h(
        'div',
        { class: 'heart-group' },
        h('h4', { class: 'heart-subhead' }, GROUP_LABEL[group] ?? group),
        h(
          'ul',
          { class: 'heart-intent-list' },
          list.map((i) => {
            const lock = remote ? i.remoteLock : i.lock;
            return h(
              'li',
              { class: `heart-intent ${lock ? 'is-locked' : ''}` },
              button(
                i.name,
                busy || lock !== null,
                () =>
                  void app.dispatch(
                    {
                      type: 'heart/talk',
                      target: view.id,
                      intent: i.id,
                      ...(remote ? { remote: true } : {}),
                      ...(i.topic === 'person' && person.value ? { topic: person.value } : {}),
                      ...(i.topic === 'place' && place.value ? { topic: place.value } : {}),
                      ...(i.topic === 'amount'
                        ? { amount: Math.max(1, Math.round(Number(amount.value) || 500)) }
                        : {}),
                    },
                    `${i.name}: done.`,
                  ),
              ),
              h(
                'span',
                { class: 'heart-intent__odds' },
                lock ?? (i.fight ? `a fight: ${i.chance}` : i.chance),
              ),
              h('span', { class: 'heart-intent__desc muted' }, i.description),
            );
          }),
        ),
      ),
    ),
  );
}

export function renderPerson(view: PersonView, app: App, busy: boolean): Child[] {
  const p = view.profile;
  return [
    h(
      'header',
      { class: 'powers-page__header person-head' },
      h('div', { class: 'portrait', 'aria-hidden': 'true' }, view.initials),
      h(
        'div',
        null,
        h('h2', { class: 'powers-page__title', id: 'person-title' }, view.name),
        h(
          'p',
          { class: 'powers-page__lead' },
          [
            view.label,
            view.alive ? (view.age !== null ? `${view.age}` : null) : 'Dead',
            view.race,
            view.occupation,
            view.here ? 'here with you' : view.where ? `in ${view.where}` : null,
          ]
            .filter(Boolean)
            .join(' · '),
        ),
        h(
          'p',
          { class: 'muted' },
          `${view.bond}, since ${view.sinceText}. ${view.mood}${view.morale ? `, ${view.morale.toLowerCase()}` : ''}.${view.sworn ? ' Sworn sibling.' : ''}`,
        ),
      ),
      h(
        'div',
        { class: 'person-head__links' },
        h('a', { class: 'button button--tiny', href: '#/people' }, 'All people'),
        // Phase 8: what the player knows of them as a recruit, and the scene of winning them over.
        view.alive && !view.animal
          ? h('a', { class: 'button button--tiny', href: `#/recruit/${view.id}` }, 'As a recruit')
          : null,
      ),
    ),
    h(
      'section',
      { class: 'powers-page__section' },
      h('h3', { class: 'powers-page__heading' }, 'Who they are'),
      p.known
        ? h(
            'dl',
            { class: 'heart-facts' },
            h(
              'div',
              null,
              h('dt', null, 'Nature'),
              h('dd', null, p.personality.join(', ') || 'Even-tempered in every way'),
            ),
            h('div', null, h('dt', null, 'Values'), h('dd', null, p.values.join(', '))),
            h('div', null, h('dt', null, 'Likes'), h('dd', null, p.likes.join(', '))),
            h('div', null, h('dt', null, 'Dislikes'), h('dd', null, p.dislikes.join(', '))),
            p.voice ? h('div', null, h('dt', null, 'Speaks'), h('dd', null, p.voice)) : null,
            p.fear ? h('div', null, h('dt', null, 'Afraid of'), h('dd', null, p.fear)) : null,
          )
        : h(
            'p',
            { class: 'muted' },
            'You do not know them well enough yet. Time, and talk, will tell.',
          ),
      h(
        'p',
        null,
        p.dream
          ? `Their dream: to ${p.dream}.`
          : h('span', { class: 'muted' }, 'You have never asked about their dream.'),
      ),
    ),
    h(
      'section',
      { class: 'powers-page__section' },
      h('h3', { class: 'powers-page__heading' }, 'How they feel about you'),
      h('div', { class: 'heart-meters' }, view.theirs.map(meter)),
      h('h4', { class: 'heart-subhead' }, view.bond),
      h('div', { class: 'heart-meters' }, view.bars.map(meter)),
      view.milestones.length > 0
        ? h(
            'ul',
            { class: 'heart-milestones' },
            view.milestones.map((m) =>
              h(
                'li',
                { class: m.reached ? 'is-reached' : '' },
                h('span', null, m.label),
                h('span', { class: 'muted' }, m.reached ? 'reached' : m.needs),
              ),
            ),
          )
        : null,
      h('h4', { class: 'heart-subhead' }, 'How you feel about them'),
      h('div', { class: 'heart-meters' }, view.mine.map(meter)),
    ),
    view.memories.length > 0
      ? h(
          'section',
          { class: 'powers-page__section' },
          h('h3', { class: 'powers-page__heading' }, 'What they remember of you'),
          h(
            'ul',
            { class: 'heart-memories' },
            view.memories.map((m) =>
              h(
                'li',
                null,
                `${m.where.charAt(0).toUpperCase()}${m.where.slice(1)} (${m.when}), remembered ${m.feeling}${m.heard ? `, heard from ${m.heard}` : ''}.`,
              ),
            ),
          ),
        )
      : null,
    view.facts.length > 0
      ? h(
          'section',
          { class: 'powers-page__section' },
          h('h3', { class: 'powers-page__heading' }, 'What you know'),
          h(
            'ul',
            { class: 'heart-told' },
            view.facts.map((f) =>
              h(
                'li',
                null,
                `${f.text}. `,
                h('span', { class: 'muted' }, `Told by ${f.from}, ${f.when}.`),
              ),
            ),
          ),
        )
      : null,
    view.alive ? intentMenu(view, app, busy) : null,
  ];
}

export interface PersonPage {
  el: HTMLElement;
  show(state: UiState): Promise<void>;
}

/** The id in `#/person/<id>`. */
export function personIdOf(hash: string): string | null {
  return hash.replace(/^#\/?/, '').split('/')[1] ?? null;
}

export function createPersonPage(app: App): PersonPage {
  const body = h('div', { class: 'powers-page__body' });
  const el = h(
    'section',
    { class: 'powers-page person-page', 'aria-labelledby': 'person-title' },
    body,
  );
  return {
    el,
    async show(state) {
      const id = personIdOf(window.location.hash);
      if (!id) {
        navigate('people');
        return;
      }
      try {
        const view = await app.host.call('heart/person', {
          id,
          view: { omniscient: state.omniscient, hash: false },
        });
        body.replaceChildren(
          ...((view
            ? renderPerson(view, app, state.busy !== null)
            : [h('p', { class: 'muted' }, 'You do not know them.')]
          ).filter((e) => e) as Node[]),
        );
      } catch (error) {
        body.replaceChildren(h('p', { class: 'muted' }, errorMessage(error)));
      }
    },
  };
}
