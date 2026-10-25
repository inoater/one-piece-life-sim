import type { HandsView } from '../../worker/protocol';
import type { App } from '../app';
import { confirmButton } from '../components/confirm-button';
import { h, type Child } from '../dom';
import { formatInteger, plural } from '../format';
import type { UiState } from '../store';

/**
 * The Gear page (Phase 6): what the character carries (weapons with their grade, edge, wear,
 * blackness and curse; gear with charges; maps and cards), their skill with each family of weapon
 * and each craft, the market here (gear, and trade goods with the hold's room), the workshop (the
 * project at the bench and every recipe, with what stands in the way), the Den Den Mushi and Vivre
 * Cards, and the gambling tables. Every button is an action; the page never decides what is
 * allowed (the locks come from the same code the month runs).
 */

type Item = HandsView['carried'][number];

const CRAFT_LABEL: Record<string, string> = {
  smithing: 'Smithing',
  gunsmithing: 'Gunsmithing',
  shipbuilding: 'Shipbuilding',
  medicine: 'Medicine',
  cooking: 'Cooking',
  invention: 'Invention',
};

const berries = (n: number) => `${formatInteger(n)} Berries`;

function bar(value: number, max: number, label: string): HTMLElement {
  const pct = Math.round(Math.max(0, Math.min(1, max <= 0 ? 0 : value / max)) * 100);
  return h(
    'span',
    { class: 'power-bar', role: 'img', 'aria-label': `${label}: ${pct} percent` },
    h('span', { class: 'power-bar__fill', style: `width: ${pct}%` }),
  );
}

function button(label: string, busy: boolean, onclick: () => void, extra = ''): HTMLButtonElement {
  return h(
    'button',
    { class: `button button--tiny ${extra}`.trim(), type: 'button', disabled: busy, onclick },
    label,
  );
}

function itemRow(item: Item, app: App, busy: boolean): HTMLElement {
  const send = (action: unknown, note: string) => void app.dispatch(action, note);
  const facts: Child[] = [];
  if (item.grade) facts.push(h('span', { class: 'chip-fact chip-fact--grade' }, item.grade));
  if (item.black) facts.push(h('span', { class: 'chip-fact chip-fact--black' }, 'Black blade'));
  if (item.attack !== null) facts.push(h('span', { class: 'chip-fact' }, `Attack ${item.attack}`));
  facts.push(h('span', { class: 'chip-fact' }, `Quality ${item.quality}`));
  if (item.sharpness !== null)
    facts.push(h('span', { class: 'chip-fact' }, `Edge ${item.sharpness}`));
  if (item.durability)
    facts.push(
      h('span', { class: 'chip-fact' }, `Wear ${item.durability.now}/${item.durability.max}`),
    );
  if (item.charges !== null)
    facts.push(h('span', { class: 'chip-fact' }, plural(item.charges, 'charge')));
  if (item.wielded) facts.push(h('span', { class: 'moves__badge' }, 'In hand'));
  if (item.worn) facts.push(h('span', { class: 'moves__badge' }, 'Worn'));
  const buttons: Child[] = [];
  if (item.weapon)
    buttons.push(
      button(item.wielded ? 'Put away' : 'Take up', busy, () =>
        send(
          { type: 'hands/wield', item: item.id, on: !item.wielded },
          item.wielded ? `${item.name} put away.` : `You took up ${item.name}.`,
        ),
      ),
    );
  if (item.wearable)
    buttons.push(
      button(item.worn ? 'Take off' : 'Wear', busy, () =>
        send(
          { type: 'hands/wear', item: item.worn ? null : item.id },
          item.worn ? 'Armour off.' : `You put on ${item.name}.`,
        ),
      ),
    );
  if (item.usable)
    buttons.push(
      button('Use', busy, () =>
        send({ type: 'hands/use', item: item.id }, `You used ${item.name}.`),
      ),
    );
  if (item.sharpen !== null)
    buttons.push(
      button(`Sharpen (${berries(item.sharpen)})`, busy, () =>
        send({ type: 'hands/sharpen', item: item.id }, 'Sharpened.'),
      ),
    );
  if (item.mend !== null)
    buttons.push(
      button(`Mend (${berries(item.mend)})`, busy, () =>
        send({ type: 'hands/mend', item: item.id }, 'Mended.'),
      ),
    );
  if (item.curse?.act === 'fate')
    buttons.push(
      confirmButton({
        label: 'Test your fate',
        confirmLabel: 'Hold out your arm?',
        className: 'button button--tiny',
        disabled: busy,
        onConfirm: () => send({ type: 'hands/fate', item: item.id }, 'You tossed the blade.'),
      }),
    );
  if (item.curse?.act === 'cleanse')
    buttons.push(
      button('Have it cleansed', busy, () =>
        send({ type: 'hands/cleanse', item: item.id }, 'The rite is done.'),
      ),
    );
  if (item.weapon && item.temper === null)
    buttons.push(
      button('Temper it', busy, () =>
        send({ type: 'hands/temper', item: item.id }, 'The tempering has begun.'),
      ),
    );
  if (item.sell !== null)
    buttons.push(
      confirmButton({
        label: `Sell (${berries(item.sell)})`,
        confirmLabel: 'Press again to sell',
        className: 'button button--tiny button--quiet',
        disabled: busy,
        onConfirm: () => send({ type: 'hands/sell', item: item.id }, `Sold ${item.name}.`),
      }),
    );
  buttons.push(
    confirmButton({
      label: 'Discard',
      confirmLabel: 'Press again to leave it',
      className: 'button button--tiny button--quiet',
      disabled: busy,
      onConfirm: () =>
        send({ type: 'hands/discard', item: item.id }, `You left ${item.name} behind.`),
    }),
  );
  return h(
    'li',
    { class: 'power-learn gear-item', dataset: { item: item.id, kind: item.kind } },
    h('span', { class: 'power-learn__name' }, item.name),
    h('span', { class: 'power-learn__where' }, item.kind),
    item.description ? h('span', { class: 'power-learn__desc' }, item.description) : null,
    h('span', { class: 'gear-item__facts' }, facts),
    item.blackening !== null
      ? h(
          'span',
          { class: 'gear-item__black' },
          'Turning black: ',
          bar(item.blackening, 1, 'Toward a black blade'),
        )
      : null,
    item.curse
      ? h(
          'span',
          {
            class: item.curse.tamed
              ? 'gear-item__curse gear-item__curse--tamed'
              : 'gear-item__curse',
          },
          `${item.curse.tamed ? 'Tamed curse' : 'Cursed'}: ${item.curse.name}. ${item.curse.tamed ? '' : item.curse.how}`,
        )
      : null,
    item.vivre
      ? h(
          'span',
          { class: 'power-learn__desc' },
          item.vivre.burn === 'ashes'
            ? `${item.vivre.name}'s card has burned away.`
            : `It creeps toward ${item.vivre.toward}${item.vivre.burn === 'low' ? ', burning low' : ''}.`,
        )
      : null,
    item.map
      ? h(
          'span',
          { class: 'power-learn__desc' },
          `An X somewhere on ${item.map}. Hunt for treasure there to find out if it is real.`,
        )
      : null,
    item.weapon && item.temper
      ? h('span', { class: 'power-learn__lock' }, `Tempering: ${item.temper}`)
      : null,
    h('span', { class: 'power-learn__buttons' }, buttons),
  );
}

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

function marketSection(view: HandsView, app: App, busy: boolean): HTMLElement | null {
  if (view.place.atSea || view.stock.length === 0) return null;
  return section(
    'gear-market-title',
    `For sale at ${view.place.name}`,
    h(
      'ul',
      { class: 'power-learns' },
      view.stock.map((line) =>
        h(
          'li',
          { class: 'power-learn', dataset: { stock: line.key } },
          h(
            'span',
            { class: 'power-learn__name' },
            line.name,
            line.grade ? h('span', { class: 'moves__badge' }, line.grade) : null,
          ),
          h(
            'span',
            { class: 'power-learn__where' },
            `${line.kind}${line.black ? ', black market' : ''}${line.unique ? ', one of a kind' : ''}`,
          ),
          line.description ? h('span', { class: 'power-learn__desc' }, line.description) : null,
          h(
            'span',
            { class: 'power-learn__buttons' },
            line.lock
              ? h('span', { class: 'power-learn__lock' }, line.lock)
              : button(
                  `Buy (${berries(line.price)})`,
                  busy,
                  () =>
                    void app.dispatch({ type: 'hands/buy', key: line.key }, `Bought ${line.name}.`),
                ),
          ),
        ),
      ),
    ),
  );
}

function tradeSection(view: HandsView, app: App, busy: boolean): HTMLElement {
  const g = view.goods;
  const trade = (good: string, qty: number, note: string) =>
    void app.dispatch({ type: 'hands/trade', good, qty }, note);
  const rows = g.list.filter((x) => x.buy !== null || x.have > 0);
  return section(
    'gear-trade-title',
    'Trade goods',
    h(
      'p',
      { class: 'muted' },
      `Hold: ${g.used} of ${g.capacity} units. Prices move as you trade: buy where a good is made, sell where it is wanted. The dealer's margin is ${g.spread}% each way.`,
    ),
    rows.length === 0
      ? h(
          'p',
          { class: 'muted' },
          view.place.atSea ? 'No market at sea.' : 'Nobody here deals in trade goods.',
        )
      : h(
          'table',
          { class: 'trade-table' },
          h(
            'thead',
            null,
            h(
              'tr',
              null,
              h('th', null, 'Good'),
              h('th', null, 'Buy'),
              h('th', null, 'Sell'),
              h('th', null, 'Held'),
              h('th', null, ''),
            ),
          ),
          h(
            'tbody',
            null,
            rows.map((x) =>
              h(
                'tr',
                { dataset: { good: x.id } },
                h(
                  'td',
                  null,
                  x.name,
                  x.black ? h('span', { class: 'muted' }, ' (black market)') : null,
                ),
                h('td', null, x.buy !== null ? formatInteger(x.buy) : '-'),
                h('td', null, x.sell !== null ? formatInteger(x.sell) : '-'),
                h(
                  'td',
                  null,
                  x.have > 0
                    ? `${x.have}${x.paid !== null ? ` (paid ${formatInteger(x.paid)})` : ''}`
                    : '-',
                ),
                h(
                  'td',
                  { class: 'trade-table__buttons' },
                  x.buy !== null
                    ? button('Buy 1', busy, () => trade(x.id, 1, `Bought ${x.name.toLowerCase()}.`))
                    : null,
                  x.buy !== null
                    ? button('Buy 10', busy, () =>
                        trade(x.id, 10, `Bought ${x.name.toLowerCase()}.`),
                      )
                    : null,
                  x.sell !== null && x.have > 0
                    ? button('Sell 1', busy, () => trade(x.id, -1, `Sold ${x.name.toLowerCase()}.`))
                    : null,
                  x.sell !== null && x.have > 0
                    ? button('Sell all', busy, () =>
                        trade(x.id, -x.have, `Sold ${x.name.toLowerCase()}.`),
                      )
                    : null,
                ),
              ),
            ),
          ),
        ),
  );
}

function workshopSection(view: HandsView, app: App, busy: boolean): HTMLElement {
  const p = view.project;
  const crafts = [...new Set(view.recipes.map((r) => r.craft))];
  return section(
    'gear-workshop-title',
    'Workshop',
    p
      ? h(
          'div',
          { class: 'gear-project' },
          h(
            'p',
            null,
            h('strong', null, p.name),
            ` at ${p.place}: ${Math.round(p.done * 10) / 10} of ${p.needed} months done. Quality so far ${p.quality}.`,
          ),
          bar(p.done, p.needed, 'Project progress'),
          p.here
            ? h(
                'p',
                { class: 'muted' },
                'Put "Work on your project" in your month (Hard, and pushed past Hard, goes faster).',
              )
            : h('p', { class: 'power-learn__lock' }, `It waits at ${p.place}.`),
          confirmButton({
            label: 'Abandon it',
            className: 'button button--tiny button--quiet',
            disabled: busy,
            onConfirm: () => void app.dispatch({ type: 'hands/abandon' }, 'Project abandoned.'),
          }),
        )
      : h(
          'p',
          { class: 'muted' },
          'No project. Start one below, then put "Work on your project" in your month.',
        ),
    crafts.map((craft) =>
      h(
        'details',
        { class: 'gear-craft', dataset: { craft } },
        h(
          'summary',
          null,
          `${CRAFT_LABEL[craft] ?? craft} (skill ${view.crafts.find((c) => c.id === craft)?.value ?? 0}${(view.crafts.find((c) => c.id === craft)?.school ?? 1) > 1 ? ', a school here' : ''})`,
        ),
        h(
          'ul',
          { class: 'power-learns' },
          view.recipes
            .filter((r) => r.craft === craft)
            .map((r) =>
              h(
                'li',
                { class: 'power-learn', dataset: { recipe: r.id } },
                h('span', { class: 'power-learn__name' }, r.name),
                h(
                  'span',
                  { class: 'power-learn__where' },
                  `Makes ${r.makes}. ${r.months} month${r.months === 1 ? '' : 's'} of work. Skill ${r.skill}.${r.cost !== null ? ` Materials ${berries(r.cost)}.` : ''}`,
                ),
                h('span', { class: 'power-learn__desc' }, r.description),
                r.lock
                  ? h('span', { class: 'power-learn__lock' }, r.lock)
                  : h(
                      'span',
                      { class: 'power-learn__buttons' },
                      button(
                        'Start',
                        busy,
                        () =>
                          void app.dispatch(
                            { type: 'hands/craft', recipe: r.id },
                            `You set to work: ${r.name.toLowerCase()}.`,
                          ),
                      ),
                    ),
              ),
            ),
        ),
      ),
    ),
  );
}

function callsSection(view: HandsView, app: App, busy: boolean): HTMLElement | null {
  const c = view.calls;
  if (!c || c.people.length === 0) return null;
  return section(
    'gear-calls-title',
    'People you know',
    h(
      'p',
      { class: 'muted' },
      c.hasSnail
        ? 'Ring them on your Den Den Mushi: an hour on the line warms them, and their harbour news reaches you now.'
        : 'Buy a Den Den Mushi in a market to call them. In the New World you can ask for a scrap of their Vivre Card.',
    ),
    h(
      'ul',
      { class: 'power-learns' },
      c.people.map((person) =>
        h(
          'li',
          { class: 'power-learn', dataset: { person: person.id } },
          h('span', { class: 'power-learn__name' }, person.name),
          h(
            'span',
            { class: 'power-learn__buttons' },
            c.hasSnail
              ? button(
                  person.called ? 'Called this month' : 'Call',
                  busy || person.called,
                  () =>
                    void app.dispatch(
                      { type: 'hands/call', target: person.id },
                      `You called ${person.name}.`,
                    ),
                )
              : null,
            person.vivre === null
              ? button(
                  'Ask for their Vivre Card',
                  busy,
                  () =>
                    void app.dispatch(
                      { type: 'hands/vivre', target: person.id },
                      'A scrap of their card.',
                    ),
                )
              : null,
          ),
        ),
      ),
    ),
  );
}

function tablesSection(view: HandsView, app: App, busy: boolean): HTMLElement | null {
  const g = view.gambling;
  if (!g) return null;
  const stake = h('input', {
    class: 'input gear-stake',
    type: 'number',
    min: '100',
    step: '100',
    value: '1000',
    'aria-label': 'Stake in Berries',
  });
  return section(
    'gear-tables-title',
    'The tables',
    h(
      'p',
      { class: 'muted' },
      `${plural(g.betsLeft, 'bet')} left this month. Some dens cheat; sharp eyes see it.`,
    ),
    h('label', { class: 'gear-stake-label' }, 'Stake ', stake),
    h(
      'ul',
      { class: 'power-learns' },
      g.games.map((game) =>
        h(
          'li',
          { class: 'power-learn', dataset: { game: game.id } },
          h('span', { class: 'power-learn__name' }, game.name),
          h(
            'span',
            { class: 'power-learn__desc' },
            `${game.description} A win pays ${game.payout} times the stake.`,
          ),
          h(
            'span',
            { class: 'power-learn__buttons' },
            g.lock && g.betsLeft === 0
              ? h('span', { class: 'power-learn__lock' }, g.lock)
              : button('Bet', busy, () => {
                  const value = Math.max(1, Math.floor(Number(stake.value) || 0));
                  void app.dispatch(
                    { type: 'hands/gamble', game: game.id, stake: value },
                    'The dice are thrown.',
                  );
                }),
          ),
        ),
      ),
    ),
  );
}

export function renderGear(state: UiState, app: App): (HTMLElement | null)[] {
  const view = state.snapshot?.hands;
  if (!view)
    return [
      h('p', { class: 'muted' }, 'Nobody alive is being played. Start a life to carry anything.'),
    ];
  const busy = state.busy !== null;
  const weapons = view.carried.filter((i) => i.weapon);
  const other = view.carried.filter((i) => !i.weapon);
  return [
    h(
      'header',
      { class: 'powers-page__header' },
      h('h2', { class: 'powers-page__title', id: 'gear-title' }, 'Gear'),
      h(
        'p',
        { class: 'powers-page__lead' },
        view.weapon
          ? `In hand: ${view.weapon.name}, attack ${view.weapon.attack}, adding ${formatInteger(view.weapon.combat)} to your Combat Power${view.weapon.seastone ? ', and it carries seastone' : ''}.`
          : 'Nothing in hand: you fight with your fists.',
        view.armour > 0 ? ` Armour ${view.armour}.` : '',
        ` ${berries(view.berries)} at ${view.place.atSea ? 'sea' : view.place.name}.`,
      ),
    ),
    section(
      'gear-weapons-title',
      'Weapons',
      weapons.length === 0
        ? h(
            'p',
            { class: 'muted' },
            'No weapons. A market or a smithy sells them; a forge makes them.',
          )
        : h(
            'ul',
            { class: 'power-learns' },
            weapons.map((i) => itemRow(i, app, busy)),
          ),
    ),
    section(
      'gear-carried-title',
      'Carried',
      other.length === 0
        ? h(
            'p',
            { class: 'muted' },
            'Nothing else: dials, snails, charts, medicine and maps would be listed here.',
          )
        : h(
            'ul',
            { class: 'power-learns' },
            other.map((i) => itemRow(i, app, busy)),
          ),
    ),
    section(
      'gear-skills-title',
      'Skills',
      h(
        'ul',
        { class: 'gear-skills' },
        [
          ...view.skills.map((s) => ({ name: s.name, value: s.value })),
          ...view.crafts.map((c) => ({ name: CRAFT_LABEL[c.id] ?? c.id, value: c.value })),
        ].map((s) =>
          h(
            'li',
            null,
            h('span', null, s.name),
            bar(s.value, 100, s.name),
            h('span', { class: 'muted' }, String(Math.floor(s.value))),
          ),
        ),
      ),
    ),
    marketSection(view, app, busy),
    tradeSection(view, app, busy),
    workshopSection(view, app, busy),
    callsSection(view, app, busy),
    tablesSection(view, app, busy),
    view.treasure.found > 0
      ? h('p', { class: 'muted' }, `${plural(view.treasure.found, 'treasure')} dug up so far.`)
      : null,
  ];
}

export interface GearPage {
  el: HTMLElement;
  show(state: UiState): void;
}

export function createGearPage(app: App): GearPage {
  const body = h('div', { class: 'powers-page__body' });
  const el = h(
    'section',
    { class: 'powers-page gear-page', 'aria-labelledby': 'gear-title' },
    body,
  );
  return {
    el,
    show(state) {
      body.replaceChildren(...renderGear(state, app).filter((e): e is HTMLElement => e !== null));
    },
  };
}
