import type { BattleView, DecisionView } from '../../worker/protocol';
import type { App } from '../app';
import { h, type Child } from '../dom';
import { formatInteger } from '../format';

/**
 * The battle panel (Phase 5): shown in the chronicle where a decision would be, while the player
 * is in a fight. Both sides with Health, stamina and haki as bars; the actions, each with its
 * chance in words ("likely", "a long shot") and as a number on hover; whom to aim at; the stance
 * and team orders; the match-up board, the fronts or the ships, as the fight has them; the running
 * log; and when it is over, the post-fight card and the fate of the beaten.
 *
 * Every button sends an action; the simulation decides what happens (rule 7).
 */

type FighterView = BattleView['fighters'][number];

/** The target the player has picked, per battle (view state only: never sent until they act). */
const picked = new Map<number, string>();

function meter(value: number, max: number, label: string, kind: string): HTMLElement {
  const pct = max > 0 ? Math.round(Math.max(0, Math.min(1, value / max)) * 100) : 0;
  return h(
    'span',
    {
      class: `battle-bar battle-bar--${kind}`,
      role: 'img',
      'aria-label': `${label} ${value} of ${max}`,
      title: `${label} ${value} of ${max}`,
    },
    h('span', { class: 'battle-bar__fill', style: `width: ${pct}%` }),
  );
}

function fighterCard(f: FighterView, chosen: boolean, pick: (() => void) | null): HTMLElement {
  const out = f.down !== null || f.away !== null;
  const DOWN: Record<string, string> = {
    ko: 'Down',
    dead: 'Dead',
    fled: 'Fled',
    captured: 'Captured',
    surrendered: 'Surrendered',
    yielded: 'Yielded',
  };
  return h(
    'li',
    {
      class: `battle-fighter${f.player ? ' battle-fighter--you' : ''}${chosen ? ' battle-fighter--target' : ''}${out ? ' battle-fighter--out' : ''}`,
      dataset: { fighter: f.id },
    },
    h(
      'div',
      { class: 'battle-fighter__head' },
      pick && !out
        ? h(
            'button',
            {
              class: 'battle-fighter__name link-button',
              type: 'button',
              'aria-pressed': String(chosen),
              onclick: pick,
            },
            f.name,
          )
        : h('span', { class: 'battle-fighter__name' }, f.player ? `${f.name} (you)` : f.name),
      h(
        'span',
        { class: 'battle-fighter__tier', title: `Combat Power ${formatInteger(f.cp)}` },
        f.tier,
      ),
    ),
    h(
      'div',
      { class: 'battle-fighter__bars' },
      meter(f.hp, f.maxHp, 'Health', 'hp'),
      meter(f.stamina, f.maxStamina, 'Stamina', 'stamina'),
      f.maxHaki > 0 ? meter(f.haki, f.maxHaki, 'Haki', 'haki') : null,
    ),
    h(
      'p',
      { class: 'battle-fighter__meta' },
      `${f.role}, ${f.zone.toLowerCase()}`,
      f.fruit ? ` · ${f.fruit}` : '',
      f.down ? ` · ${DOWN[f.down] ?? f.down}` : f.away ? ` · ${f.away}` : '',
    ),
    f.status.length > 0 ? h('p', { class: 'battle-fighter__status' }, f.status.join(', ')) : null,
  );
}

function sideList(
  view: BattleView,
  side: 0 | 1,
  target: string | null,
  rerender: () => void,
): HTMLElement {
  const s = view.sides[side] as BattleView['sides'][number];
  const fighters = view.fighters.filter((f) => f.side === side);
  return h(
    'section',
    { class: `battle-side battle-side--${side === 0 ? 'mine' : 'theirs'}`, 'aria-label': s.name },
    h(
      'h4',
      { class: 'battle-side__name' },
      s.name,
      s.ranks > 0 ? h('span', { class: 'muted' }, ` and ${formatInteger(s.ranks)} more`) : null,
    ),
    fighters.length > 1 || s.ranks > 0
      ? h(
          'p',
          { class: 'battle-side__morale' },
          meter(s.morale, 100, 'Morale', 'morale'),
          s.broken ? ' Broken' : '',
        )
      : null,
    h(
      'ul',
      { class: 'battle-fighters' },
      fighters.map((f) =>
        fighterCard(
          f,
          f.id === target,
          side === 1 && view.canAct
            ? () => {
                picked.set(view.id, f.id);
                rerender();
              }
            : null,
        ),
      ),
    ),
  );
}

function actionButton(
  view: BattleView,
  a: BattleView['actions'][number],
  target: string | null,
  busy: boolean,
  app: App,
): HTMLElement {
  const pct = a.chance === null ? '' : `${Math.round(a.chance * 100)}% to land. `;
  return h(
    'li',
    { class: 'battle-action' },
    h(
      'button',
      {
        class: 'battle-action__button',
        type: 'button',
        disabled: busy || a.lock !== null,
        title: `${pct}${a.detail}`,
        onclick: () =>
          void app.dispatch({
            type: 'battle/act',
            verb: a.verb,
            ...(a.move ? { move: a.move } : {}),
            ...(a.haki ? { haki: a.haki } : {}),
            ...(a.talk ? { talk: a.talk } : {}),
            ...(a.item ? { item: a.item } : {}),
            ...(a.needsTarget && target ? { target } : {}),
          }),
      },
      h('span', { class: 'battle-action__label' }, a.label),
      h('span', { class: 'battle-action__words' }, a.lock ?? a.words),
    ),
  );
  void view;
}

function stanceControls(
  view: BattleView,
  decision: DecisionView,
  busy: boolean,
  app: App,
): HTMLElement {
  const select = h(
    'select',
    {
      class: 'battle-stance',
      'aria-label': 'Stance when the fight plays itself',
      disabled: busy,
      onchange: (e: Event) =>
        void app.dispatch({ type: 'battle/stance', stance: (e.target as HTMLSelectElement).value }),
    },
    view.stances.map((s) =>
      h('option', { value: s.id, selected: s.id === view.stance, title: s.description }, s.name),
    ),
  );
  return h(
    'div',
    { class: 'battle-controls' },
    h('label', { class: 'battle-controls__label' }, 'Stance ', select),
    h(
      'button',
      {
        class: 'button',
        type: 'button',
        disabled: busy,
        onclick: () => void app.resolveDecision(decision.id, 'auto'),
      },
      decision.choices[0]?.label ?? 'Let it play out',
    ),
  );
}

function orderControls(
  view: BattleView,
  target: string | null,
  busy: boolean,
  app: App,
): HTMLElement | null {
  const mine = view.fighters.filter((f) => f.side === 0);
  const side = view.sides[0] as BattleView['sides'][number];
  if (mine.length < 2 && side.ranks <= 0) return null;
  const select = h(
    'select',
    {
      class: 'battle-order',
      'aria-label': 'Order to your side',
      disabled: busy,
      onchange: (e: Event) => {
        const order = (e.target as HTMLSelectElement).value;
        const who =
          order === 'protect'
            ? (mine.find((f) => !f.player && f.down === null)?.id ?? null)
            : order === 'focus'
              ? target
              : null;
        void app.dispatch({ type: 'battle/order', order, target: who });
      },
    },
    view.orders.map((o) =>
      h('option', { value: o.id, selected: o.id === side.order, title: o.text }, o.name),
    ),
  );
  return h(
    'div',
    { class: 'battle-controls' },
    h('label', { class: 'battle-controls__label' }, 'Order ', select),
  );
}

function navalControls(view: BattleView, busy: boolean, app: App): HTMLElement {
  const moves: ['close' | 'hold' | 'flee', string][] = [
    ['close', 'Close'],
    ['hold', 'Hold range'],
    ['flee', 'Run'],
  ];
  const attacks: ['fire' | 'ram' | 'board' | 'none', string][] =
    view.range === 'adjacent'
      ? [
          ['board', 'Board them'],
          ['ram', 'Ram'],
        ]
      : [
          ['fire', 'Fire the guns'],
          ['none', 'Hold fire'],
        ];
  return h(
    'ul',
    { class: 'battle-actions' },
    moves.flatMap(([move, ml]) =>
      attacks.map(([attack, al]) =>
        h(
          'li',
          { class: 'battle-action' },
          h(
            'button',
            {
              class: 'battle-action__button',
              type: 'button',
              disabled: busy,
              onclick: () => void app.dispatch({ type: 'battle/naval', move, attack }),
            },
            h('span', { class: 'battle-action__label' }, `${ml}, ${al.toLowerCase()}`),
          ),
        ),
      ),
    ),
  );
}

function extras(view: BattleView, busy: boolean, app: App): Child[] {
  const out: Child[] = [];
  if (view.ships.length > 0) {
    out.push(
      h(
        'ul',
        { class: 'battle-ships' },
        view.ships.map((s) =>
          h(
            'li',
            null,
            h('span', { class: 'battle-ships__name' }, s.name),
            meter(s.hull, s.maxHull, 'Hull', 'hull'),
            ` ${s.cannons} guns`,
            s.fire ? ' · on fire' : '',
            s.sunk ? ' · sunk' : s.struck ? ' · struck' : '',
          ),
        ),
      ),
      view.range ? h('p', { class: 'muted' }, `Range: ${view.range}.`) : null,
    );
  }
  if (view.board.length > 0) {
    out.push(
      h('h4', { class: 'battle-sub' }, 'The match-up board'),
      h(
        'ul',
        { class: 'battle-board' },
        view.board.map((b) =>
          h(
            'li',
            { title: `${Math.round(b.chance * 100)}%` },
            `${b.aName} against ${b.bName}: ${b.words}`,
          ),
        ),
      ),
    );
  }
  if (view.fronts.length > 0) {
    out.push(
      h('h4', { class: 'battle-sub' }, 'The fronts'),
      h(
        'ul',
        { class: 'battle-fronts' },
        view.fronts.map((fr, i) =>
          h(
            'li',
            { class: fr.here ? 'battle-front battle-front--here' : 'battle-front' },
            h('span', { class: 'battle-front__name' }, fr.name),
            ` ${formatInteger(fr.strength[0])} against ${formatInteger(fr.strength[1])}`,
            fr.broken[0] ? ' · your line broke' : fr.broken[1] ? ' · theirs broke' : '',
            fr.here
              ? h('span', { class: 'muted' }, ' · you are here')
              : !fr.broken[0] && !fr.broken[1]
                ? h(
                    'button',
                    {
                      class: 'button button--tiny',
                      type: 'button',
                      disabled: busy,
                      onclick: () => void app.dispatch({ type: 'battle/front', index: i }),
                    },
                    'Stand here',
                  )
                : null,
          ),
        ),
      ),
    );
  }
  return out;
}

function logList(view: BattleView): HTMLElement {
  return h(
    'ol',
    { class: 'battle-log', 'aria-label': 'What happened', role: 'log' },
    view.log.map((l) =>
      h(
        'li',
        { class: `battle-log__line battle-log__line--${l.tone}` },
        l.exchange > 0 ? h('span', { class: 'battle-log__n' }, `${l.exchange}`) : null,
        l.text,
      ),
    ),
  );
}

/** The battle panel for a decision that holds a fight (or the fate of those it beat). */
export function renderBattle(
  view: BattleView,
  decision: DecisionView,
  busy: boolean,
  app: App,
  rerender: () => void,
): HTMLElement {
  const titleId = `battle-${view.id}`;
  const enemies = view.fighters.filter((f) => f.side === 1 && f.down === null && f.away === null);
  const target = enemies.some((e) => e.id === picked.get(view.id))
    ? (picked.get(view.id) as string)
    : (enemies[0]?.id ?? null);
  const header = h(
    'header',
    { class: 'battle__head' },
    h('h3', { class: 'battle__title', id: titleId }, view.contest ?? view.title),
    h(
      'p',
      { class: 'battle__counter' },
      view.result
        ? 'Over'
        : view.scale === 'naval' && view.ships.length > 0
          ? `Round ${view.round + 1}`
          : `Exchange ${view.exchange + 1}`,
      view.round > 0 && view.scale !== 'naval' ? ` · round ${view.round}` : '',
    ),
  );
  const sides = h(
    'div',
    { class: 'battle__sides' },
    sideList(view, 0, target, rerender),
    sideList(view, 1, target, rerender),
  );
  let body: Child[];
  if (view.result) {
    body = [
      h(
        'section',
        { class: 'battle-card', 'aria-label': 'After the fight' },
        h(
          'h4',
          { class: 'battle-sub' },
          view.result.how === 'won'
            ? 'You won'
            : view.result.how === 'lost'
              ? 'You lost'
              : view.result.how === 'fled'
                ? 'It ended in flight'
                : 'Neither side won',
        ),
        h(
          'ul',
          { class: 'battle-card__lines' },
          view.card.map((l) => h('li', { class: `battle-log__line--${l.tone}` }, l.text)),
        ),
      ),
      h(
        'ul',
        { class: 'decision__choices' },
        decision.choices.map((c) =>
          h(
            'li',
            null,
            h(
              'button',
              {
                class: 'choice',
                type: 'button',
                disabled: busy,
                onclick: () => void app.resolveDecision(decision.id, c.id),
              },
              h('span', { class: 'choice__label' }, c.label),
            ),
          ),
        ),
      ),
    ];
  } else if (view.naval) {
    body = [navalControls(view, busy, app), stanceControls(view, decision, busy, app)];
  } else if (view.canAct) {
    const chosen = view.targets.find((t) => t.id === target);
    body = [
      chosen
        ? h(
            'p',
            { class: 'battle__aim' },
            `Aiming at ${chosen.name}: a plain blow is ${chosen.words}.`,
            chosen.touchable ? '' : ' Blows pass through them without haki.',
          )
        : null,
      h(
        'ul',
        { class: 'battle-actions' },
        view.actions.map((a) => actionButton(view, a, target, busy, app)),
      ),
      orderControls(view, target, busy, app),
      stanceControls(view, decision, busy, app),
    ];
  } else {
    body = [
      h('p', { class: 'muted' }, 'You are out of it for now; the fight goes on.'),
      stanceControls(view, decision, busy, app),
    ];
  }
  return h(
    'section',
    { class: 'battle decision', 'aria-labelledby': titleId, dataset: { scale: view.scale } },
    header,
    sides,
    ...extras(view, busy, app),
    ...body,
    logList(view),
  );
}
