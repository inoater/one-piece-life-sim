import type { DesignPreview, HandsView } from '../../worker/protocol';
import type { App } from '../app';
import { confirmButton } from '../components/confirm-button';
import { h, type Child } from '../dom';
import { errorMessage, formatInteger } from '../format';
import type { UiState } from '../store';

/**
 * The Ship page (Phase 6): the player's ship (her numbers, hull, history), a ship on the slipway,
 * and the ship creator: hull and length, material, rig, extra drives, rooms, weapons, figurehead
 * and look, with live numbers from the simulation as the design changes (speed, hull, cargo,
 * berths, comfort, stealth, upkeep, cost and months to build), the problems that stop it being
 * built and what a yard or your own hands would charge. Designs can be saved, loaded, shared as
 * text and read back in.
 */

type Design = HandsView['creator']['designs'][number];
type Creator = HandsView['creator'];

const berries = (n: number) => `${formatInteger(n)} Berries`;

function section(
  id: string,
  title: string,
  ...children: (Child | readonly Child[])[]
): HTMLElement {
  return h(
    'section',
    { class: 'powers-page__section', 'aria-labelledby': id },
    h('h3', { class: 'powers-page__heading', id }, title),
    ...children,
  );
}

function bar(value: number, max: number, label: string): HTMLElement {
  const pct = Math.round(Math.max(0, Math.min(1, max <= 0 ? 0 : value / max)) * 100);
  return h(
    'span',
    { class: 'power-bar', role: 'img', 'aria-label': `${label}: ${pct} percent` },
    h('span', { class: 'power-bar__fill', style: `width: ${pct}%` }),
  );
}

function statList(stats: DesignPreview['stats']): HTMLElement {
  const rows: [string, string][] = [
    ['Speed', `${stats.speed} miles a month`],
    ['Hull', String(stats.hull)],
    ['Cargo', String(stats.cargo)],
    ['Berths', `${stats.berths} (needs ${stats.minCrew} hands)`],
    ['Rooms', `${stats.rooms.used} of ${stats.rooms.max}`],
    ['Guns', String(stats.cannons)],
    ['Comfort', String(stats.comfort)],
    ['Stealth', String(stats.stealth)],
    ['Upkeep', `${berries(stats.upkeep)} a month`],
    [
      'In a calm',
      stats.calm > 0
        ? `${Math.round(stats.calm * 100)}% of her speed${stats.calmBelt ? ', crosses a Calm Belt' : ''}`
        : 'Becalmed',
    ],
    ['Rot', stats.rot === null ? 'Never' : `After ${stats.rot} years`],
    ['Shipwright skill', String(stats.skill)],
  ];
  if (stats.seaKingProof) rows.push(['Sea Kings', 'Cannot sense her']);
  return h(
    'dl',
    { class: 'ship-stats' },
    rows.flatMap(([k, v]) => [h('dt', null, k), h('dd', null, v)]),
  );
}

function blankDesign(creator: Creator): Design {
  return {
    name: 'New ship',
    hull: creator.hulls[1]?.id ?? creator.hulls[0]?.id ?? 'dinghy',
    length: 1,
    material: creator.materials[0]?.id ?? 'common_wood',
    rig: creator.rigs[0]?.id ?? 'square',
    drives: [],
    rooms: [],
    weapons: {},
    figurehead: 'none',
    hullColour: 'black',
    sailColour: 'white',
  };
}

export interface ShipPage {
  el: HTMLElement;
  show(state: UiState): void;
}

export function createShipPage(app: App): ShipPage {
  const body = h('div', { class: 'powers-page__body' });
  const el = h(
    'section',
    { class: 'powers-page ship-page', 'aria-labelledby': 'ship-title' },
    body,
  );
  let draft: Design | null = null;
  let mode: 'build' | 'refit' = 'build';
  let preview: DesignPreview | null = null;
  let previewFor = '';
  let latest: UiState | null = null;
  const statsSlot = h('div', { class: 'ship-preview', 'aria-live': 'polite' });

  async function refresh(): Promise<void> {
    if (!draft) return;
    const key = JSON.stringify(draft);
    previewFor = key;
    try {
      const result = await app.host.call('hands/design', { design: draft });
      if (previewFor !== key) return;
      preview = result;
    } catch (error) {
      preview = null;
      statsSlot.replaceChildren(h('p', { class: 'power-learn__lock' }, errorMessage(error)));
      return;
    }
    drawPreview();
  }

  function drawPreview(): void {
    const state = latest;
    const busy = state?.busy !== null;
    if (!preview || !draft) {
      statsSlot.replaceChildren(h('p', { class: 'muted' }, 'Working out her numbers...'));
      return;
    }
    const p = preview;
    const d = draft;
    const actions: Child[] = [];
    if (mode === 'refit' && p.refit) {
      actions.push(
        p.refit.lock
          ? h('p', { class: 'power-learn__lock' }, `Refit: ${p.refit.lock}`)
          : h(
              'button',
              {
                class: 'button',
                type: 'button',
                disabled: busy,
                onclick: () =>
                  void app.dispatch({ type: 'ship/refit', design: d }, 'The yard sets to work.'),
              },
              `Refit her (${berries(p.refit.price)})`,
            ),
      );
    } else {
      for (const by of ['yard', 'self'] as const) {
        const lock = p.lock[by];
        actions.push(
          lock
            ? h(
                'p',
                { class: 'power-learn__lock' },
                `${by === 'yard' ? 'A yard' : 'Your own hands'}: ${lock}`,
              )
            : h(
                'button',
                {
                  class: 'button',
                  type: 'button',
                  disabled: busy,
                  onclick: () =>
                    void app.dispatch({ type: 'ship/build', design: d, by }, 'The keel is laid.'),
                },
                by === 'yard'
                  ? `Have the yard build her (${berries(p.price.yard)}, ${p.months.yard} months)`
                  : `Build her yourself (${berries(p.price.self)} in materials, ${p.months.self} months of work)`,
              ),
        );
      }
    }
    statsSlot.replaceChildren(
      ...[
        h(
          'p',
          { class: 'powers-page__lead' },
          `Cost ${berries(p.stats.cost)}, ${p.stats.months} months to build.${p.yard ? ` Here: ${p.yard.name} (shipwrights ${p.yard.skill}, up to size ${p.yard.size}).` : ' There is no yard here.'}`,
        ),
        statList(p.stats),
        p.stats.errors.length > 0
          ? h(
              'ul',
              { class: 'ship-errors' },
              p.stats.errors.map((e) => h('li', null, e)),
            )
          : null,
        p.stats.warnings.length > 0
          ? h(
              'ul',
              { class: 'ship-warnings' },
              p.stats.warnings.map((e) => h('li', null, e)),
            )
          : null,
        h('div', { class: 'ship-actions' }, actions),
      ].filter((x): x is HTMLElement => x !== null),
    );
  }

  function change(mutate: (d: Design) => void): void {
    if (!draft) return;
    mutate(draft);
    void refresh();
  }

  function select(
    label: string,
    value: string,
    options: { id: string; name: string }[],
    onChange: (v: string) => void,
  ): HTMLElement {
    return h(
      'label',
      { class: 'ship-field' },
      h('span', null, label),
      h(
        'select',
        { class: 'input', onchange: (e: Event) => onChange((e.target as HTMLSelectElement).value) },
        options.map((o) => h('option', { value: o.id, selected: o.id === value }, o.name)),
      ),
    );
  }

  function creatorForm(creator: Creator, locked: boolean): HTMLElement {
    const d = draft as Design;
    const hull = creator.hulls.find((x) => x.id === d.hull);
    const lengthOut = h('output', null, `${Math.round(d.length * 100)}%`);
    return h(
      'form',
      { class: 'ship-form', onsubmit: (e: Event) => e.preventDefault() },
      h(
        'label',
        { class: 'ship-field' },
        h('span', null, 'Name'),
        h('input', {
          class: 'input',
          type: 'text',
          maxlength: '60',
          value: d.name ?? '',
          onchange: (e: Event) =>
            change((x) => (x.name = (e.target as HTMLInputElement).value.trim() || undefined)),
        }),
      ),
      locked
        ? h(
            'p',
            { class: 'muted' },
            `Hull: ${hull?.name ?? d.hull}, ${Math.round(d.length * 100)}% length, ${creator.materials.find((m) => m.id === d.material)?.name ?? d.material} (a refit keeps these).`,
          )
        : [
            select('Hull', d.hull, creator.hulls, (v) => change((x) => (x.hull = v))),
            h(
              'label',
              { class: 'ship-field' },
              h('span', null, 'Length '),
              h('input', {
                type: 'range',
                min: String(hull?.length.min ?? 0.8),
                max: String(hull?.length.max ?? 1.25),
                step: '0.05',
                value: String(d.length),
                oninput: (e: Event) =>
                  (lengthOut.textContent = `${Math.round(Number((e.target as HTMLInputElement).value) * 100)}%`),
                onchange: (e: Event) =>
                  change((x) => (x.length = Number((e.target as HTMLInputElement).value))),
              }),
              lengthOut,
            ),
            select('Material', d.material, creator.materials, (v) =>
              change((x) => (x.material = v)),
            ),
          ],
      select('Rig', d.rig, creator.rigs, (v) => change((x) => (x.rig = v))),
      h(
        'fieldset',
        { class: 'ship-checks' },
        h('legend', null, 'Extra drives'),
        creator.drives.map((dr) =>
          h(
            'label',
            { title: dr.description },
            h('input', {
              type: 'checkbox',
              checked: d.drives.includes(dr.id),
              onchange: (e: Event) =>
                change((x) => {
                  x.drives = (e.target as HTMLInputElement).checked
                    ? [...x.drives, dr.id]
                    : x.drives.filter((y) => y !== dr.id);
                }),
            }),
            ` ${dr.name} (${berries(dr.cost)})`,
          ),
        ),
      ),
      h(
        'fieldset',
        { class: 'ship-checks' },
        h('legend', null, 'Rooms'),
        creator.rooms.map((r) =>
          h(
            'label',
            { title: r.description },
            h('input', {
              type: 'checkbox',
              checked: d.rooms.includes(r.id),
              onchange: (e: Event) =>
                change((x) => {
                  x.rooms = (e.target as HTMLInputElement).checked
                    ? [...x.rooms, r.id]
                    : x.rooms.filter((y) => y !== r.id);
                }),
            }),
            ` ${r.name} (${berries(r.cost)})`,
          ),
        ),
      ),
      h(
        'fieldset',
        { class: 'ship-checks' },
        h('legend', null, 'Weapons'),
        creator.weapons.map((w) =>
          h(
            'label',
            { title: w.description },
            h('input', {
              class: 'input ship-count',
              type: 'number',
              min: '0',
              max: '60',
              value: String(d.weapons[w.id] ?? 0),
              'aria-label': `${w.name}: how many`,
              onchange: (e: Event) =>
                change((x) => {
                  const n = Math.max(
                    0,
                    Math.floor(Number((e.target as HTMLInputElement).value) || 0),
                  );
                  if (n > 0) x.weapons = { ...x.weapons, [w.id]: n };
                  else {
                    const next = { ...x.weapons };
                    delete next[w.id];
                    x.weapons = next;
                  }
                }),
            }),
            ` ${w.name} (${berries(w.cost)} each)`,
          ),
        ),
      ),
      select('Figurehead', d.figurehead, creator.figureheads, (v) =>
        change((x) => (x.figurehead = v)),
      ),
      select(
        'Hull colour',
        d.hullColour,
        creator.colours.map((c) => ({ id: c, name: c })),
        (v) => change((x) => (x.hullColour = v)),
      ),
      select(
        'Sail colour',
        d.sailColour,
        creator.colours.map((c) => ({ id: c, name: c })),
        (v) => change((x) => (x.sailColour = v)),
      ),
      h(
        'label',
        { class: 'ship-field' },
        h('span', null, 'Jolly Roger'),
        h('input', {
          class: 'input',
          type: 'text',
          maxlength: '120',
          placeholder: 'A skull in a straw hat',
          value: d.jollyRoger ?? '',
          onchange: (e: Event) =>
            change(
              (x) => (x.jollyRoger = (e.target as HTMLInputElement).value.trim() || undefined),
            ),
        }),
      ),
    );
  }

  function designsList(view: HandsView, busy: boolean): HTMLElement {
    const c = view.creator;
    const importBox = h('textarea', {
      class: 'input ship-import',
      rows: '3',
      placeholder: 'Paste a shared design here',
      'aria-label': 'A shared design',
    });
    const load = (d: Design) => {
      draft = structuredClone(d);
      mode = 'build';
      show(latest as UiState);
    };
    return h(
      'div',
      { class: 'ship-designs' },
      h(
        'ul',
        { class: 'power-learns' },
        [
          ...c.blueprints.map((d) => ({ d, i: -1, label: 'Blueprint' })),
          ...c.designs.map((d, i) => ({ d, i, label: 'Saved' })),
        ].map(({ d, i, label }) =>
          h(
            'li',
            { class: 'power-learn' },
            h('span', { class: 'power-learn__name' }, d.name ?? 'Unnamed'),
            h('span', { class: 'power-learn__where' }, label),
            h(
              'span',
              { class: 'power-learn__buttons' },
              h(
                'button',
                { class: 'button button--tiny', type: 'button', onclick: () => load(d) },
                'Load',
              ),
              h(
                'button',
                {
                  class: 'button button--tiny button--quiet',
                  type: 'button',
                  onclick: () => {
                    void navigator.clipboard
                      ?.writeText(JSON.stringify(d, null, 2))
                      .catch(() => undefined);
                    importBox.value = JSON.stringify(d, null, 2);
                  },
                },
                'Share',
              ),
              i >= 0
                ? confirmButton({
                    label: 'Delete',
                    className: 'button button--tiny button--quiet',
                    disabled: busy,
                    onConfirm: () =>
                      void app.dispatch({ type: 'ship/deleteDesign', index: i }, 'Design deleted.'),
                  })
                : null,
            ),
          ),
        ),
      ),
      h(
        'div',
        { class: 'ship-actions' },
        h(
          'button',
          {
            class: 'button',
            type: 'button',
            disabled: busy || !draft,
            onclick: () =>
              draft &&
              void app.dispatch({ type: 'ship/saveDesign', design: draft }, 'Design saved.'),
          },
          'Save this design',
        ),
      ),
      importBox,
      h(
        'button',
        {
          class: 'button button--tiny',
          type: 'button',
          disabled: busy,
          onclick: () =>
            importBox.value.trim() &&
            void app.dispatch(
              { type: 'ship/importDesign', text: importBox.value },
              'Design added.',
            ),
        },
        'Add a shared design',
      ),
    );
  }

  function show(state: UiState): void {
    latest = state;
    const view = state.snapshot?.hands;
    if (!view) {
      body.replaceChildren(
        h('p', { class: 'muted' }, 'Nobody alive is being played. Start a life to sail.'),
      );
      return;
    }
    const busy = state.busy !== null;
    if (!draft) draft = structuredClone(view.ship?.design ?? blankDesign(view.creator));
    const ship = view.ship;
    const build = view.build;
    body.replaceChildren(
      ...[
        h(
          'header',
          { class: 'powers-page__header' },
          h('h2', { class: 'powers-page__title', id: 'ship-title' }, 'Ship'),
          h(
            'p',
            { class: 'powers-page__lead' },
            ship
              ? `The ${ship.name.replace(/^the /i, '')}: ${ship.here ? `moored at ${view.place.name}` : view.place.atSea ? 'at sea' : 'not here'}.`
              : 'You have no ship.',
            ` Shipbuilding skill ${view.creator.shipbuilding}.`,
          ),
        ),
        ship
          ? section(
              'ship-own-title',
              'Your ship',
              h(
                'p',
                null,
                `Hull ${ship.hull} of ${ship.maxHull} `,
                bar(ship.hull, ship.maxHull, 'Hull'),
              ),
              ship.inYard
                ? h(
                    'p',
                    { class: 'power-learn__lock' },
                    'In the yard being refitted: she cannot sail this month.',
                  )
                : null,
              statList(ship.stats),
              ship.here && view.place.yard
                ? h(
                    'button',
                    {
                      class: 'button',
                      type: 'button',
                      disabled: busy,
                      onclick: () => {
                        draft = structuredClone(ship.design);
                        mode = 'refit';
                        show(state);
                      },
                    },
                    'Refit her',
                  )
                : null,
              ship.history.length > 0
                ? h(
                    'ol',
                    { class: 'ship-history' },
                    ship.history.map((x) => h('li', null, x.text)),
                  )
                : null,
            )
          : null,
        build
          ? section(
              'ship-build-title',
              'On the slipway',
              h(
                'p',
                null,
                `${build.name} at ${build.place}: ${Math.round(build.done * 10) / 10} of ${build.needed} months.`,
              ),
              bar(build.done, build.needed, 'Build progress'),
              build.by === 'yard'
                ? h(
                    'button',
                    {
                      class: 'button button--tiny',
                      type: 'button',
                      disabled: busy,
                      onclick: () =>
                        void app.dispatch(
                          { type: 'ship/hasten', months: 1 },
                          'More hands on the slipway.',
                        ),
                    },
                    'Pay to hurry it a month',
                  )
                : h(
                    'p',
                    { class: 'muted' },
                    'Put "Work on your project" in your month, here at her yard.',
                  ),
            )
          : null,
        section(
          'ship-creator-title',
          mode === 'refit' ? 'Refit' : 'Ship creator',
          mode === 'refit'
            ? h(
                'button',
                {
                  class: 'button button--tiny button--quiet',
                  type: 'button',
                  onclick: () => {
                    mode = 'build';
                    draft = blankDesign(view.creator);
                    show(state);
                  },
                },
                'Back to a new design',
              )
            : null,
          h(
            'div',
            { class: 'ship-creator' },
            creatorForm(view.creator, mode === 'refit'),
            statsSlot,
          ),
        ),
        section('ship-designs-title', 'Designs and blueprints', designsList(view, busy)),
      ].filter((x): x is HTMLElement => x !== null),
    );
    if (preview && previewFor === JSON.stringify(draft)) drawPreview();
    void refresh();
  }

  return { el, show };
}
