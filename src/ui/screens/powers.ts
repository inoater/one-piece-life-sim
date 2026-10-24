import type { PowersView } from '../../worker/protocol';
import type { App } from '../app';
import { confirmButton } from '../components/confirm-button';
import { h, type Child } from '../dom';
import { formatInteger, plural } from '../format';
import type { UiState } from '../store';

/**
 * The Powers page (Phase 4): every power the character has or could have, as one kind of thing, a
 * track of named stages. For each: the stage reached, the progress to the next and what stands in
 * the way, the stages ahead ("???" for those nobody has told them of), and where a teacher can be
 * found. Then the moveset with each technique's numbers, the technique creator, combinations,
 * gear, and the actions a fight would offer (what Phase 5's battle engine will read).
 *
 * Every button is an action sent to the simulation; the page never decides what is allowed (the
 * locks come from the same code the month runs).
 */

type TrackView = PowersView['tracks'][number];

const FAMILY_LABEL: Record<string, string> = {
  haki: 'Haki',
  fruit: 'Devil Fruit',
  style: 'Fighting style',
  sword: 'Swordsmanship',
  six_powers: 'The Six Powers',
  weapon: 'Weapon',
};

function bar(value: number, label: string): HTMLElement {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return h(
    'span',
    { class: 'power-bar', role: 'img', 'aria-label': `${label}: ${pct} percent` },
    h('span', { class: 'power-bar__fill', style: `width: ${pct}%` }),
  );
}

function trackRow(track: TrackView, app: App, busy: boolean): HTMLElement {
  const focus =
    track.family !== 'haki' && track.family !== 'fruit'
      ? h(
          'button',
          {
            class: 'button button--tiny',
            type: 'button',
            'aria-pressed': String(track.focus),
            disabled: busy,
            onclick: () =>
              void app.dispatch(
                { type: 'powers/focus', track: track.focus ? null : track.id },
                track.focus
                  ? `${track.name} is no longer your focus.`
                  : `Sparring and open drills now go to ${track.name}.`,
              ),
          },
          track.focus ? 'Focus' : 'Make focus',
        )
      : null;
  const next = track.next;
  return h(
    'li',
    { class: 'power-track', dataset: { family: track.family, open: String(track.open) } },
    h(
      'div',
      { class: 'power-track__head' },
      h('span', { class: 'power-track__name' }, track.name),
      h('span', { class: 'power-track__family' }, FAMILY_LABEL[track.family] ?? track.family),
      focus,
    ),
    track.stage
      ? h(
          'p',
          { class: 'power-track__stage' },
          h('strong', null, track.stage.name),
          ` · ${track.stage.level}`,
          track.rusting ? ' · rusting from disuse' : null,
        )
      : null,
    next
      ? h(
          'div',
          { class: 'power-track__next' },
          bar(next.progress, `Toward ${next.name}`),
          h('span', { class: 'power-track__next-label' }, `Next: ${next.name} (${next.level})`),
          next.locks.length > 0
            ? h(
                'ul',
                { class: 'power-track__locks' },
                next.locks.map((l) => h('li', null, l)),
              )
            : null,
        )
      : track.open
        ? h(
            'p',
            { class: 'muted' },
            track.ceiling ?? 'The last stage: there is nowhere further to go.',
          )
        : null,
    track.ceiling && next ? h('p', { class: 'muted' }, track.ceiling) : null,
    h(
      'details',
      { class: 'power-track__stages' },
      h('summary', null, plural(track.stages.length, 'stage')),
      h(
        'ol',
        null,
        track.stages.map((s) =>
          h(
            'li',
            { dataset: { reached: String(s.reached), current: String(s.current) } },
            h('span', { class: 'stage__name' }, s.name),
            h('span', { class: 'stage__level' }, s.level),
            h('span', { class: 'stage__desc' }, s.description),
            s.techniques.length > 0
              ? h('span', { class: 'stage__techs' }, `Teaches: ${s.techniques.join(', ')}`)
              : null,
            s.combat > 0
              ? h('span', { class: 'stage__combat' }, `+${s.combat} Combat Power`)
              : null,
          ),
        ),
      ),
      track.where.length > 0
        ? h('p', { class: 'power-track__where' }, `Taught by ${track.where.join('; ')}.`)
        : null,
    ),
  );
}

function learnRow(track: TrackView, app: App, busy: boolean): HTMLElement {
  return h(
    'li',
    { class: 'power-learn' },
    h('span', { class: 'power-learn__name' }, track.name),
    h('span', { class: 'power-learn__desc' }, track.description),
    track.where.length > 0
      ? h('span', { class: 'power-learn__where' }, `Taught by ${track.where.join('; ')}.`)
      : null,
    track.learnLock
      ? h('span', { class: 'power-learn__lock' }, track.learnLock)
      : h(
          'button',
          {
            class: 'button',
            type: 'button',
            disabled: busy,
            onclick: () =>
              void app.dispatch(
                { type: 'powers/learn', track: track.id },
                `You began ${track.name}.`,
              ),
          },
          track.teacherHere ? `Learn from ${track.teacherHere}` : 'Begin on your own',
        ),
  );
}

function movesTable(view: PowersView, app: App, busy: boolean): HTMLElement {
  if (view.moves.length === 0) {
    return h(
      'p',
      { class: 'muted' },
      'No techniques yet. Learn a style, wake your haki, eat a fruit, or invent one below.',
    );
  }
  return h(
    'table',
    { class: 'moves' },
    h(
      'thead',
      null,
      h(
        'tr',
        null,
        ['Technique', 'From', 'Form', 'Power', 'Hit', 'Cost', 'Mastery', 'Used', ''].map((t) =>
          h('th', { scope: 'col' }, t),
        ),
      ),
    ),
    h(
      'tbody',
      null,
      view.moves.map((m) => {
        const rename = h('input', {
          class: 'moves__rename',
          type: 'text',
          value: m.name,
          maxlength: 40,
          'aria-label': `Rename ${m.name}`,
          hidden: true,
        });
        const nameEl = h('span', { class: 'moves__name' }, m.name);
        const renameButton = h(
          'button',
          { class: 'button button--tiny', type: 'button', disabled: busy },
          'Rename',
        );
        renameButton.addEventListener('click', () => {
          if (rename.hidden) {
            rename.hidden = false;
            nameEl.hidden = true;
            renameButton.textContent = 'Save';
            rename.focus();
            return;
          }
          void app.dispatch(
            { type: 'powers/rename', move: m.id, name: rename.value },
            rename.value.trim() ? `Renamed it ${rename.value.trim()}.` : 'Back to its own name.',
          );
        });
        return h(
          'tr',
          { dataset: { faded: String(m.faded), locked: String(m.lock !== null) } },
          h(
            'td',
            null,
            nameEl,
            rename,
            m.original ? h('span', { class: 'moves__original' }, ` (${m.original})`) : null,
            m.signature ? h('span', { class: 'moves__badge' }, 'Signature') : null,
            m.finisher
              ? h('span', { class: 'moves__badge moves__badge--finisher' }, 'Finisher')
              : null,
            m.lock ? h('span', { class: 'moves__lock' }, m.lock) : null,
          ),
          h('td', null, m.source),
          h('td', null, `${m.form} · ${m.tags.join(', ')}`),
          h('td', { class: 'num' }, String(m.power)),
          h('td', { class: 'num' }, `${m.accuracy}%`),
          h('td', { class: 'num' }, String(m.cost)),
          h('td', { class: 'num' }, String(m.mastery)),
          h('td', { class: 'num' }, String(m.uses)),
          h('td', null, renameButton),
        );
      }),
    ),
  );
}

function inventForm(view: PowersView, app: App, busy: boolean): HTMLElement {
  if (view.invent.sources.length === 0) {
    return h(
      'p',
      { class: 'muted' },
      'You need a power to build on: a style, a haki colour, or a fruit you understand.',
    );
  }
  const source = h('select', { 'aria-label': 'Built on', disabled: busy });
  for (const s of view.invent.sources) source.append(h('option', { value: s.id }, s.label));
  const form = h('select', { 'aria-label': 'Form', disabled: busy });
  for (const f of view.invent.forms) form.append(h('option', { value: f }, f));
  const tag = h('select', { 'aria-label': 'Element or kind', disabled: busy });
  const fillTags = () => {
    const tags = view.invent.sources.find((s) => s.id === source.value)?.tags ?? [];
    tag.replaceChildren(...tags.map((t) => h('option', { value: t }, t)));
  };
  source.addEventListener('change', fillTags);
  fillTags();
  const name = h('input', {
    type: 'text',
    maxlength: 40,
    placeholder: 'Name it',
    'aria-label': 'Technique name',
    disabled: busy,
  });
  const submit = h(
    'button',
    { class: 'button', type: 'button', disabled: busy },
    'Begin inventing',
  );
  submit.addEventListener('click', () => {
    void app.dispatch(
      {
        type: 'powers/invent',
        source: source.value,
        form: form.value,
        tag: tag.value,
        name: name.value,
      },
      `You began working on ${name.value.trim() || 'a new technique'}. Practise its source to make it work.`,
    );
  });
  return h(
    'div',
    { class: 'invent' },
    h(
      'p',
      { class: 'muted' },
      'Choose what it is built on, its form, its element and a name. It is priced from those parts and how far along you are; each month you practise its source, it may come together.',
    ),
    h('div', { class: 'invent__row' }, source, form, tag, name, submit),
    view.drafts.length > 0
      ? h(
          'ul',
          { class: 'drafts' },
          view.drafts.map((d) =>
            h(
              'li',
              null,
              h('strong', null, d.name),
              ` from ${d.source}: power ${d.power}, ${plural(d.attempts, 'try', 'tries')} so far, about ${d.chance}% a month. `,
              confirmButton({
                label: 'Give up',
                onConfirm: () =>
                  void app.dispatch(
                    { type: 'powers/abandon', draft: d.id },
                    `You gave up on ${d.name}.`,
                  ),
              }),
            ),
          ),
        )
      : null,
  );
}

function comboForm(view: PowersView, app: App, busy: boolean): HTMLElement | null {
  if (view.partners.length === 0) return null;
  const partner = h('select', { 'aria-label': 'Partner', disabled: busy });
  for (const p of view.partners) partner.append(h('option', { value: p.id }, p.name));
  const mine = h('select', { 'aria-label': 'Your technique', disabled: busy });
  for (const m of view.moves.filter((m) => !m.faded))
    mine.append(h('option', { value: m.id }, m.name));
  const theirs = h('select', { 'aria-label': 'Their technique', disabled: busy });
  const fill = () => {
    const moves = view.partners.find((p) => p.id === partner.value)?.moves ?? [];
    theirs.replaceChildren(...moves.map((m) => h('option', { value: m.id }, m.name)));
  };
  partner.addEventListener('change', fill);
  fill();
  const name = h('input', {
    type: 'text',
    maxlength: 40,
    placeholder: 'Name it',
    'aria-label': 'Combination name',
    disabled: busy,
  });
  return h(
    'section',
    { class: 'powers-page__section' },
    h('h3', { class: 'powers-page__heading' }, 'Combination techniques'),
    h(
      'p',
      { class: 'muted' },
      'Two people close enough to trust each other with their backs can put two techniques together.',
    ),
    h(
      'div',
      { class: 'invent__row' },
      partner,
      mine,
      theirs,
      name,
      h(
        'button',
        {
          class: 'button',
          type: 'button',
          disabled: busy,
          onclick: () =>
            void app.dispatch(
              {
                type: 'powers/combine',
                partner: partner.value,
                move: mine.value,
                partnerMove: theirs.value,
                name: name.value,
              },
              'A combination technique.',
            ),
        },
        'Put them together',
      ),
    ),
  );
}

/** Phase 5: your rung on the ladder, your record, how fights are played, and fight kit. */
function fightSettings(state: UiState, app: App, busy: boolean): HTMLElement | null {
  const fight = state.snapshot?.fight;
  if (!fight) return null;
  const r = fight.record;
  const stance = h(
    'select',
    {
      'aria-label': 'Stance when a fight plays itself',
      disabled: busy,
      onchange: (e: Event) =>
        void app.dispatch({ type: 'battle/stance', stance: (e.target as HTMLSelectElement).value }),
    },
    fight.stances.map((s) =>
      h('option', { value: s.id, selected: s.id === fight.stance, title: s.description }, s.name),
    ),
  );
  const mode = (m: 'tactical' | 'quick', label: string) =>
    h(
      'button',
      {
        class: 'button button--tiny',
        type: 'button',
        'aria-pressed': String(fight.mode === m),
        disabled: busy,
        onclick: () => void app.dispatch({ type: 'battle/mode', mode: m }),
      },
      label,
    );
  return h(
    'div',
    { class: 'fight-settings' },
    h(
      'p',
      null,
      h('strong', null, fight.tier),
      ` on the ladder (Combat Power ${formatInteger(fight.cp)}). `,
      `Fights won ${r.won}, lost ${r.lost}, drawn ${r.drawn}; ${r.spars} of them spars.`,
    ),
    h(
      'ol',
      { class: 'fight-ladder', 'aria-label': 'The power ladder' },
      fight.ladder.map((l) =>
        h(
          'li',
          {
            class: l.here ? 'fight-ladder__rung fight-ladder__rung--here' : 'fight-ladder__rung',
            title: l.who,
          },
          h('span', null, l.name),
          h('span', { class: 'muted' }, ` ${formatInteger(l.min)}+`),
        ),
      ),
    ),
    h(
      'p',
      { class: 'fight-settings__row' },
      'Fights: ',
      mode('tactical', 'You choose every exchange'),
      ' ',
      mode('quick', 'Quick, by your stance'),
    ),
    h('label', { class: 'fight-settings__row' }, 'Stance ', stance),
    h(
      'ul',
      { class: 'power-learns' },
      fight.kit.map((k) =>
        h(
          'li',
          { class: 'power-learn' },
          h('span', { class: 'power-learn__name' }, `${k.name}${k.have > 0 ? ` (${k.have})` : ''}`),
          h(
            'span',
            { class: 'power-learn__desc' },
            `${k.description} ${formatInteger(k.price)} Berries.`,
          ),
          k.lock
            ? h('span', { class: 'power-learn__lock' }, k.lock)
            : h(
                'button',
                {
                  class: 'button',
                  type: 'button',
                  disabled: busy,
                  onclick: () =>
                    void app.dispatch(
                      { type: 'battle/buyKit', item: k.id },
                      `You bought ${k.name.toLowerCase()}.`,
                    ),
                },
                'Buy',
              ),
        ),
      ),
    ),
  );
}

export function renderPowers(state: UiState, app: App): (HTMLElement | null)[] {
  const view = state.snapshot?.powers;
  if (!view) {
    return [
      h('p', { class: 'muted' }, 'Nobody alive is being played. Start a life to grow powers.'),
    ];
  }
  const busy = state.busy !== null;
  const open = view.tracks.filter((t) => t.open);
  const learnable = view.tracks.filter(
    (t) => !t.open && t.family !== 'haki' && t.family !== 'fruit',
  );
  const sleeping = view.tracks.filter((t) => !t.open && t.family === 'haki');
  const fruit = view.fruit;
  const section = (id: string, title: string, ...children: Child[]) =>
    h(
      'section',
      { class: 'powers-page__section', 'aria-labelledby': id },
      h('h3', { class: 'powers-page__heading', id }, title),
      ...children,
    );
  return [
    h(
      'header',
      { class: 'powers-page__header' },
      h('h2', { class: 'powers-page__title', id: 'powers-title' }, 'Powers'),
      h(
        'p',
        { class: 'powers-page__lead' },
        `Combat Power ${formatInteger(view.combat.total)}`,
        view.doriki !== null ? ` (${formatInteger(view.doriki)} Doriki)` : '',
        view.stamina
          ? `. Haki stamina ${view.stamina.current} of ${view.stamina.pool}.`
          : '. No haki has woken in you yet.',
        view.sixPowersMastered > 0 ? ` Six Powers mastered: ${view.sixPowersMastered} of 6.` : '',
      ),
      view.combat.bonus.length > 0
        ? h(
            'ul',
            { class: 'powers-page__bonus' },
            view.combat.bonus.map((b) =>
              h('li', null, `${b.value >= 0 ? '+' : ''}${b.value} ${b.source}`),
            ),
          )
        : h('p', { class: 'muted' }, 'Nothing adds to your Combat Power yet but your body.'),
    ),
    fruit
      ? section(
          'fruit-title',
          'Your Devil Fruit',
          h(
            'p',
            null,
            h('strong', null, fruit.name),
            fruit.type ? ` · ${fruit.type}${fruit.model ? `, ${fruit.model}` : ''}` : '',
            fruit.awakened ? ' · awakened' : '',
          ),
          fruit.dud
            ? h(
                'p',
                { class: 'muted' },
                'It was a failed SMILE: no power came with it, only the smile.',
              )
            : null,
          fruit.description
            ? h('p', null, fruit.description)
            : h(
                'p',
                { class: 'muted' },
                'You do not yet know what it does; it will show you, a little at a time.',
              ),
          fruit.secret ? h('p', null, `Its truth: ${fruit.secret}.`) : null,
          h(
            'div',
            { class: 'power-track__next' },
            bar(fruit.mastery / 100, 'Mastery'),
            h('span', { class: 'power-track__next-label' }, `Mastery ${fruit.mastery} of 100`),
          ),
          fruit.cursed
            ? h(
                'p',
                { class: 'power-warning' },
                'The sea or seastone has hold of you: your power is gone and your strength drained until it lets go.',
              )
            : null,
          fruit.weaknesses.length > 0
            ? h(
                'ul',
                { class: 'power-track__locks' },
                fruit.weaknesses.map((w) => h('li', null, w)),
              )
            : null,
          h('p', null, h('a', { href: '#/fruits' }, 'Devil Fruits you know of')),
        )
      : null,
    section(
      'tracks-title',
      'What you are learning',
      open.length > 0
        ? h(
            'ol',
            { class: 'power-tracks' },
            open.map((t) => trackRow(t, app, busy)),
          )
        : h('p', { class: 'muted' }, 'Nothing yet. Below is what can be learned, and where.'),
      sleeping.length > 0
        ? h(
            'p',
            { class: 'muted' },
            `Asleep in you, as in everyone: ${sleeping.map((t) => t.name).join(', ')}. Train your spirit, face a crisis, or find a teacher, and one may wake.`,
          )
        : null,
    ),
    section(
      'learn-title',
      'What could be learned',
      learnable.length > 0
        ? h(
            'ul',
            { class: 'power-learns' },
            learnable.map((t) => learnRow(t, app, busy)),
          )
        : h('p', { class: 'muted' }, 'You have begun everything you know of.'),
    ),
    section('moves-title', 'Techniques', movesTable(view, app, busy)),
    section('invent-title', 'Invent a technique', inventForm(view, app, busy)),
    comboForm(view, app, busy),
    section(
      'gear-title',
      'Gear',
      h(
        'p',
        null,
        `Swords ${view.gear['swords'] ?? 0}, guns ${view.gear['gun'] ?? 0}, bows ${view.gear['bow'] ?? 0}.`,
      ),
      h(
        'ul',
        { class: 'power-learns' },
        view.shop.map((w) =>
          h(
            'li',
            { class: 'power-learn' },
            h('span', { class: 'power-learn__name' }, w.name),
            h('span', { class: 'power-learn__desc' }, `${formatInteger(w.price)} Berries`),
            w.lock
              ? h('span', { class: 'power-learn__lock' }, w.lock)
              : h(
                  'button',
                  {
                    class: 'button',
                    type: 'button',
                    disabled: busy,
                    onclick: () =>
                      void app.dispatch(
                        { type: 'powers/buyGear', weapon: w.id },
                        `You bought a ${w.name.toLowerCase()}.`,
                      ),
                  },
                  'Buy',
                ),
          ),
        ),
        h(
          'li',
          { class: 'power-learn' },
          h('span', { class: 'power-learn__name' }, 'Devil Fruit Encyclopedia'),
          h(
            'span',
            { class: 'power-learn__desc' },
            `${formatInteger(view.encyclopedia.price)} Berries: names any Devil Fruit by its look.`,
          ),
          view.encyclopedia.lock
            ? h('span', { class: 'power-learn__lock' }, view.encyclopedia.lock)
            : h(
                'button',
                {
                  class: 'button',
                  type: 'button',
                  disabled: busy,
                  onclick: () =>
                    void app.dispatch(
                      { type: 'powers/buyEncyclopedia' },
                      'You bought the Devil Fruit Encyclopedia.',
                    ),
                },
                'Buy',
              ),
        ),
      ),
    ),
    section(
      'fight-title',
      'In a fight',
      fightSettings(state, app, busy),
      h('p', { class: 'muted' }, 'What you can do in a fight, besides your techniques:'),
      h(
        'ul',
        { class: 'fight-actions' },
        view.actions.map((a) =>
          h(
            'li',
            { dataset: { kind: a.kind } },
            a.name,
            a.power > 0 ? h('span', { class: 'muted' }, ` ${a.power}`) : null,
            a.signature ? h('span', { class: 'moves__badge' }, 'Signature') : null,
          ),
        ),
      ),
    ),
  ];
}

export interface PowersPage {
  el: HTMLElement;
  show(state: UiState): void;
}

export function createPowersPage(app: App): PowersPage {
  const body = h('div', { class: 'powers-page__body' });
  const el = h('section', { class: 'powers-page', 'aria-labelledby': 'powers-title' }, body);
  return {
    el,
    show(state) {
      body.replaceChildren(...renderPowers(state, app).filter((e): e is HTMLElement => e !== null));
    },
  };
}
