import type { TravelView } from '../../worker/protocol';
import type { App } from '../app';
import { confirmButton } from '../components/confirm-button';
import { h, type Child } from '../dom';
import { formatInteger, plural } from '../format';

/**
 * Travel in the Actions tab (Phase 3). At sea: where the voyage is bound and how far it has come,
 * the vessel, and (for a captain) the order for the month. Ashore: the harbour, with every route
 * from here and the ways of taking it (the same planner as the Map page), the player's ship and
 * what it needs, and what the port sells. Every button is an action; every lock comes from the
 * simulation.
 */

type Voyage = NonNullable<TravelView['voyage']>;
type Harbour = NonNullable<TravelView['harbour']>;
type RouteView = TravelView['routes'][number];

const REQUIRES: Record<string, string> = {
  none: '',
  log_pose: 'Log Pose route',
  eternal_pose: 'Eternal Pose only',
  coated_ship: 'Coated ship only',
  sky_route: 'Sky route',
};

function meter(value: number, max: number, label: string, tone = 'tide'): HTMLElement {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return h(
    'span',
    { class: 'travel-meter', role: 'img', 'aria-label': label, dataset: { tone } },
    h('span', { class: 'travel-meter__fill', style: `width: ${pct.toFixed(1)}%` }),
  );
}

function fact(label: string, value: Child, extra?: Child): HTMLElement {
  return h(
    'div',
    { class: 'facts__row' },
    h('dt', null, label),
    h('dd', null, value, extra ?? null),
  );
}

function voyageSection(v: Voyage, app: App, busy: boolean): HTMLElement {
  const vessel = v.vessel;
  const left = v.monthsLeft;
  return h(
    'section',
    { class: 'planner__section travel', 'aria-labelledby': 'voyage-title' },
    h('h2', { class: 'side-screen__title', id: 'voyage-title' }, 'At sea'),
    h(
      'p',
      { class: 'planner__lead' },
      `Bound for ${v.to.name} from ${v.from.name}, ${v.modeName.toLowerCase()}. `,
      `${formatInteger(v.done)} of ${formatInteger(v.miles)} miles sailed; about ${plural(left, 'month')} to go.`,
    ),
    meter(v.done, v.miles, `${Math.round((v.done / Math.max(1, v.miles)) * 100)}% of the way`),
    h(
      'dl',
      { class: 'facts' },
      fact('Waters', `${v.zone}, danger ${v.danger} of 5`),
      fact('Months at sea', String(v.months)),
      vessel ? fact('Ship', `${vessel.name} (${vessel.className.toLowerCase()})`) : null,
      vessel?.captainName ? fact('Captain', vessel.captainName) : null,
      vessel
        ? fact(
            'Hull',
            `${vessel.hull} of ${vessel.maxHull}`,
            meter(
              vessel.hull,
              vessel.maxHull,
              'Hull',
              vessel.hull < vessel.maxHull * 0.35 ? 'bad' : 'tide',
            ),
          )
        : null,
      vessel && v.captain ? fact('Hands', String(vessel.crew)) : null,
      vessel && v.captain
        ? fact(
            'Morale',
            String(vessel.morale),
            meter(vessel.morale, 100, 'Morale', vessel.morale < 30 ? 'bad' : 'tide'),
          )
        : null,
      vessel && vessel.suppliesMonths !== null
        ? fact('Stores', `${plural(vessel.suppliesMonths, 'month')} for everyone aboard`)
        : null,
    ),
    v.captain
      ? h(
          'div',
          { class: 'orders', role: 'group', 'aria-label': "Captain's order" },
          h('p', { class: 'orders__label' }, "Captain's order for the month"),
          h(
            'ul',
            { class: 'options' },
            v.orders.map((o) =>
              h(
                'li',
                { class: 'option' },
                h(
                  'div',
                  { class: 'option__main' },
                  h('span', { class: 'option__name' }, o.name),
                  h('span', { class: 'option__text' }, o.description),
                ),
                h(
                  'button',
                  {
                    class: `button button--tiny${o.id === v.order ? ' button--primary' : ''}`,
                    type: 'button',
                    'aria-pressed': String(o.id === v.order),
                    disabled: busy,
                    onclick: () =>
                      void app.dispatch({ type: 'travel/order', order: o.id }, `Order: ${o.name}.`),
                  },
                  o.id === v.order ? 'Ordered' : 'Order',
                ),
              ),
            ),
          ),
        )
      : h(
          'p',
          { class: 'muted' },
          'The captain sets the course. Ship duty, training on deck and study are open to you; most of what you did ashore is not.',
        ),
  );
}

export function sailButtons(route: RouteView, app: App, busy: boolean): HTMLElement {
  const open = route.modes.filter((m) => m.lock === null);
  const shut = route.modes.filter((m) => m.lock !== null);
  return h(
    'div',
    { class: 'route__modes' },
    open.map((m) =>
      h(
        'button',
        {
          class: 'button button--tiny',
          type: 'button',
          disabled: busy,
          title: `${m.route} sets the route. Main risk: ${m.risk}.`,
          onclick: () =>
            void app.dispatch(
              { type: 'travel/sail', lane: route.lane, mode: m.mode },
              `You set out for ${route.to.name}.`,
            ),
        },
        `${m.name} · ${plural(m.months, 'month')}${m.cost > 0 ? ` · ${formatInteger(m.cost)} B` : ''}`,
      ),
    ),
    shut.length > 0
      ? h(
          'details',
          { class: 'planner__more' },
          h('summary', null, `${plural(shut.length, 'way')} closed`),
          h(
            'ul',
            { class: 'route__shut' },
            shut.map((m) => h('li', null, h('strong', null, m.name), `: ${m.lock}`)),
          ),
        )
      : null,
  );
}

function routesSection(t: TravelView, app: App, busy: boolean): HTMLElement {
  const here = t.here;
  return h(
    'section',
    { class: 'planner__section travel', 'aria-labelledby': 'routes-title' },
    h(
      'h2',
      { class: 'side-screen__title', id: 'routes-title' },
      here ? `Leaving ${here.name}` : 'Leaving',
    ),
    here
      ? h(
          'p',
          { class: 'planner__lead' },
          `${here.regionName}. ${here.climate}. `,
          here.poseWait !== null && here.poseWait > 0
            ? `The Log Pose needs ${plural(here.poseWait, 'more month')} to set on the next island.`
            : '',
        )
      : null,
    t.routes.length === 0
      ? h('p', { class: 'muted' }, 'No lane leaves from here.')
      : h(
          'ul',
          { class: 'routes' },
          t.routes.map((r) =>
            h(
              'li',
              { class: 'route' },
              h(
                'div',
                { class: 'route__head' },
                h('strong', { class: 'route__to' }, r.to.name),
                h(
                  'span',
                  { class: 'route__meta' },
                  `${formatInteger(r.miles)} miles · ${r.zoneName} · danger ${r.danger}${REQUIRES[r.requires] ? ` · ${REQUIRES[r.requires]}` : ''}`,
                ),
              ),
              r.description ? h('p', { class: 'route__text' }, r.description) : null,
              sailButtons(r, app, busy),
            ),
          ),
        ),
    h(
      'p',
      null,
      h(
        'a',
        { class: 'button button--quiet button--tiny', href: '#/map' },
        'See the routes on the map',
      ),
    ),
  );
}

function shipSection(harbour: Harbour, app: App, busy: boolean): HTMLElement | null {
  const ship = harbour.ship;
  if (!ship) {
    if (harbour.forSale.length === 0) return null;
    return h(
      'section',
      { class: 'planner__section travel', 'aria-labelledby': 'yard-title' },
      h('h2', { class: 'side-screen__title', id: 'yard-title' }, 'Ships for sale'),
      h(
        'ul',
        { class: 'options' },
        harbour.forSale.map((v) =>
          h(
            'li',
            { class: 'option' },
            h(
              'div',
              { class: 'option__main' },
              h('span', { class: 'option__name' }, v.name),
              h(
                'span',
                { class: 'option__meta' },
                `${formatInteger(v.cost)} Berries. ${v.speed} miles a month, hull ${v.hull}, crew from ${v.minCrew}, cargo ${v.cargo}.`,
              ),
              h('span', { class: 'option__text' }, v.description),
            ),
            h(
              'button',
              {
                class: 'button button--tiny',
                type: 'button',
                disabled: busy,
                onclick: () =>
                  void app.dispatch(
                    { type: 'travel/buyShip', vessel: v.id },
                    `You bought a ${v.name.toLowerCase()}.`,
                  ),
              },
              'Buy',
            ),
          ),
        ),
      ),
    );
  }
  const need = Math.max(0, ship.minCrew - 1 - ship.crew);
  const buttons: (HTMLElement | null)[] = ship.here
    ? [
        need > 0 || ship.crew + 2 <= ship.maxCrew
          ? h(
              'button',
              {
                class: 'button button--tiny',
                type: 'button',
                disabled: busy,
                onclick: () =>
                  void app.dispatch(
                    { type: 'travel/hire', count: Math.max(1, need) },
                    'Hands signed on.',
                  ),
              },
              need > 0
                ? `Hire ${need} (${formatInteger(need * harbour.hireCost)} B)`
                : `Hire a hand (${formatInteger(harbour.hireCost)} B)`,
            )
          : null,
        ship.crew > 0
          ? h(
              'button',
              {
                class: 'button button--quiet button--tiny',
                type: 'button',
                disabled: busy,
                onclick: () =>
                  void app.dispatch({ type: 'travel/dismiss', count: 1 }, 'A hand paid off.'),
              },
              'Pay off a hand',
            )
          : null,
        ship.supplies < ship.capacity
          ? h(
              'button',
              {
                class: 'button button--tiny',
                type: 'button',
                disabled: busy,
                onclick: () =>
                  void app.dispatch(
                    { type: 'travel/provision', months: 3 },
                    'Stores taken aboard.',
                  ),
              },
              `Stock 3 months (${formatInteger(3 * (ship.crew + 1) * harbour.provisionCost)} B)`,
            )
          : null,
        harbour.repairCost !== null
          ? h(
              'button',
              {
                class: 'button button--tiny',
                type: 'button',
                disabled: busy,
                onclick: () => void app.dispatch({ type: 'travel/repair' }, 'Repairs done.'),
              },
              `Repair (${formatInteger(harbour.repairCost)} B)`,
            )
          : null,
        harbour.coating !== null && !ship.coated
          ? h(
              'button',
              {
                class: 'button button--tiny',
                type: 'button',
                disabled: busy,
                onclick: () => void app.dispatch({ type: 'travel/coat' }, 'The hull is coated.'),
              },
              `Coat the hull (${formatInteger(harbour.coating)} B)`,
            )
          : null,
        confirmButton({
          label: 'Sell her',
          confirmLabel: 'Press again to sell',
          className: 'button button--quiet button--tiny',
          disabled: busy,
          onConfirm: () => void app.dispatch({ type: 'travel/sellShip' }, 'Ship sold.'),
        }),
      ]
    : [];
  return h(
    'section',
    { class: 'planner__section travel', 'aria-labelledby': 'ship-title' },
    h('h2', { class: 'side-screen__title', id: 'ship-title' }, `Your ship: ${ship.name}`),
    h(
      'dl',
      { class: 'facts' },
      fact(
        'Class',
        `${ship.className}, ${ship.speed} miles a month${ship.coated ? ', coated' : ''}`,
      ),
      fact('Moored', ship.here ? 'Here' : ship.where),
      fact(
        'Hull',
        `${ship.hull} of ${ship.maxHull}`,
        meter(ship.hull, ship.maxHull, 'Hull', ship.hull < ship.maxHull * 0.35 ? 'bad' : 'tide'),
      ),
      fact(
        'Hands',
        `${ship.crew} (sails with ${ship.minCrew} to ${ship.maxCrew} aboard, you included)`,
      ),
      fact(
        'Morale',
        String(ship.morale),
        meter(ship.morale, 100, 'Morale', ship.morale < 30 ? 'bad' : 'tide'),
      ),
      fact('Stores', `${ship.supplies} of ${ship.capacity} person-months`),
    ),
    h(
      'p',
      { class: 'muted' },
      `Each hand is paid ${formatInteger(harbour.wage)} Berries a month, at sea or not.`,
    ),
    buttons.some((b) => b !== null) ? h('div', { class: 'planner__buttons' }, buttons) : null,
  );
}

function posesSection(harbour: Harbour, app: App, busy: boolean): HTMLElement | null {
  const offers: HTMLElement[] = [];
  if (harbour.logPose !== null && !harbour.hasLogPose) {
    offers.push(
      h(
        'button',
        {
          class: 'button button--tiny',
          type: 'button',
          disabled: busy,
          onclick: () =>
            void app.dispatch({ type: 'travel/pose', kind: 'log' }, 'You bought a Log Pose.'),
        },
        `Buy a Log Pose (${formatInteger(harbour.logPose)} B)`,
      ),
    );
  }
  for (const pose of harbour.eternalPoses) {
    if (pose.owned) continue;
    offers.push(
      h(
        'button',
        {
          class: 'button button--tiny',
          type: 'button',
          disabled: busy,
          onclick: () =>
            void app.dispatch(
              { type: 'travel/pose', kind: 'eternal', target: pose.id },
              `You bought an Eternal Pose to ${pose.name}.`,
            ),
        },
        `Eternal Pose to ${pose.name} (${formatInteger(pose.cost)} B)`,
      ),
    );
  }
  const owned = [
    harbour.hasLogPose ? 'a Log Pose' : null,
    ...harbour.poses.map((p) => `an Eternal Pose to ${p}`),
  ].filter((x): x is string => x !== null);
  if (offers.length === 0 && owned.length === 0) return null;
  return h(
    'section',
    { class: 'planner__section travel', 'aria-labelledby': 'poses-title' },
    h('h2', { class: 'side-screen__title', id: 'poses-title' }, 'Finding the way'),
    owned.length > 0
      ? h('p', null, `You carry ${owned.join(', ')}.`)
      : h('p', { class: 'muted' }, 'You carry no pose.'),
    offers.length > 0 ? h('div', { class: 'planner__buttons' }, offers) : null,
  );
}

/** The travel sections of the Actions tab. */
export function travelSections(travel: TravelView | null, app: App, busy: boolean): HTMLElement[] {
  if (!travel) return [];
  if (travel.voyage) return [voyageSection(travel.voyage, app, busy)];
  const out: (HTMLElement | null)[] = [routesSection(travel, app, busy)];
  if (travel.harbour)
    out.push(shipSection(travel.harbour, app, busy), posesSection(travel.harbour, app, busy));
  return out.filter((x): x is HTMLElement => x !== null);
}
