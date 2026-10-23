import type { CharacterSheet, GenesisPreview, GenesisSetup } from '../../worker/protocol';
import type { App } from '../app';
import { confirmButton } from '../components/confirm-button';
import { renderCapBars } from '../components/cap-bars';
import type { WorldMap } from '../map/world-map';
import { renderSheet, type SheetHandle } from '../components/sheet';
import { flash } from '../motion';
import { h, type Child } from '../dom';
import { errorMessage, formatInteger } from '../format';
import { navigate } from '../router';

/**
 * New Life: seven screens that turn choices into a character, with the finished sheet beside
 * every one of them.
 *
 *   1 World   2 Race   3 Birthplace   4 Family   5 Entry   6 Appearance   7 Review
 *
 * The page keeps only a draft of the choices. Every change asks the simulation for a preview,
 * which is the very function that starts the life, so what the preview shows is exactly what
 * "Start this life" makes. Anything not chosen is rolled; each section has its own reroll, and
 * rerolling one never changes another.
 */

interface Draft {
  seed: string;
  canonMode: string;
  difficulty: string;
  rareRaces: boolean;
  race: string;
  birthplace: string;
  legacy: string;
  focus: string;
  entryYear: number;
  entryAge: number;
  pronouns: 'he' | 'she' | 'they';
  givenName: string;
  familyName: string;
  locks: Record<string, string>;
  rolls: {
    race: number;
    birthplace: number;
    family: number;
    backstory: number;
    name: number;
    appearance: Record<string, number>;
  };
}

const STEPS = [
  {
    id: 'world',
    title: 'World',
    lead: 'The seed decides everything that is rolled; the same seed and choices always make the same person.',
  },
  {
    id: 'race',
    title: 'Race',
    lead: 'Race sets the ceiling on every stat, how fast you grow up and how long you live.',
  },
  {
    id: 'birthplace',
    title: 'Birthplace',
    lead: 'Where you were born decides your first trait, your family’s fortunes and what your childhood trained.',
  },
  {
    id: 'family',
    title: 'Family',
    lead: 'Your family’s legacy gives starting money, a trait, and a story that will find you later.',
  },
  {
    id: 'entry',
    title: 'Entry',
    lead: 'Choose when the story starts and how old you are. The years before are lived for you, one compressed pass per year.',
  },
  {
    id: 'appearance',
    title: 'Appearance',
    lead: 'Reroll any feature, pick one outright, or lock it so nothing else changes it.',
  },
  {
    id: 'review',
    title: 'Review',
    lead: 'This is who you will be. Everything here can still change until you start.',
  },
] as const;
type StepId = (typeof STEPS)[number]['id'];

const RANDOM = 'random';
const PRONOUN_LABEL = { he: 'He', she: 'She', they: 'They' } as const;
const STAT_SHORT: Record<string, string> = {
  strength: 'Str',
  speed: 'Spd',
  endurance: 'End',
  durability: 'Dur',
  dexterity: 'Dex',
  intellect: 'Int',
  willpower: 'Wil',
  charisma: 'Cha',
  perception: 'Per',
};

function capText(capMods: Record<string, number>): string {
  const parts = Object.entries(capMods)
    .filter(([, v]) => v !== 0)
    .map(([stat, v]) => `${STAT_SHORT[stat] ?? stat} ${v > 0 ? '+' : '−'}${Math.abs(v)}%`);
  return parts.length > 0 ? parts.join(', ') : 'All caps ±0';
}

interface Card {
  value: string;
  title: string;
  summary?: string;
  details?: string;
  /** A small picture beside the text (the race's cap bars). */
  extra?: Node;
  disabled?: boolean;
  disabledReason?: string;
}

let groupCounter = 0;

/** A radio group drawn as cards. */
function radioCards(
  label: string,
  cards: readonly Card[],
  current: string,
  onChange: (value: string) => void,
): HTMLElement {
  const name = `nl-${++groupCounter}`;
  return h(
    'fieldset',
    { class: 'cards' },
    h('legend', { class: 'cards__legend' }, label),
    cards.map((card) => {
      const input = h('input', {
        type: 'radio',
        name,
        value: card.value,
        checked: card.value === current,
        disabled: card.disabled === true,
      });
      input.addEventListener('change', () => {
        if (input.checked) onChange(card.value);
      });
      return h(
        'label',
        { class: 'card', dataset: { value: card.value, disabled: String(card.disabled === true) } },
        input,
        h(
          'span',
          { class: 'card__body' },
          h('span', { class: 'card__title' }, card.title),
          card.summary ? h('span', { class: 'card__summary' }, card.summary) : null,
          card.details ? h('span', { class: 'card__details' }, card.details) : null,
          card.extra ?? null,
          card.disabled && card.disabledReason
            ? h('span', { class: 'card__details' }, card.disabledReason)
            : null,
        ),
      );
    }),
  );
}

function field(label: string, control: HTMLElement, hint?: Child): HTMLElement {
  return h(
    'label',
    { class: 'field' },
    h('span', { class: 'field__label' }, label),
    control,
    hint ? h('span', { class: 'field__hint' }, hint) : null,
  );
}

export interface NewLifeScreen {
  el: HTMLElement;
  /** Called whenever the route shows the screen. Loads the choices the first time. */
  show(): void;
}

export function createNewLife(app: App): NewLifeScreen {
  let setup: GenesisSetup | null = null;
  let draft: Draft | null = null;
  let step: StepId = 'world';
  let preview: GenesisPreview | null = null;
  let previewError: string | null = null;
  let loading = false;
  let sequence = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let sheet: SheetHandle | null = null;
  // The world map on the Birthplace screen is built once and kept, with its zoom, between visits.
  let worldMap: WorldMap | null = null;
  let onMapPick: (id: string) => void = () => {};
  // The map's drawing and data load only when the Birthplace screen first needs them.
  const birthMap = async (pick: (id: string) => void): Promise<WorldMap> => {
    onMapPick = pick;
    if (!worldMap) {
      const { createWorldMap } = await import('../map/world-map');
      worldMap ??= createWorldMap({
        label: 'World map of birthplaces',
        className: 'world-map--chooser',
        onPin: (id) => onMapPick(id),
      });
    }
    return worldMap;
  };
  /** The sheet in the preview pane now, so the next one can show what a choice changed. */
  let shownSheet: CharacterSheet | null = null;
  let stepUpdate: ((p: GenesisPreview | null) => void) | null = null;

  const heading = h('h2', { class: 'newlife__title', tabindex: '-1' }, 'New Life');
  const nav = h('ol', { class: 'steps', 'aria-label': 'New Life steps' });
  const form = h('div', { class: 'newlife__form' });
  const previewStatus = h('p', { class: 'newlife__status', role: 'status' });
  const previewBody = h('div', { class: 'newlife__sheet', id: 'newlife-sheet' });
  const mini = h('p', { class: 'newlife__mini' });
  const backButton = h('button', { class: 'button', type: 'button' }, 'Back');
  const nextButton = h('button', { class: 'button button--primary', type: 'button' }, 'Next');
  const startSlot = h('span', { class: 'newlife__start' });
  const cancelLink = h('a', { class: 'button button--quiet', href: '#/feed' }, 'Back to the world');

  const el = h(
    'section',
    { class: 'newlife', 'aria-labelledby': 'newlife-title' },
    h('header', { class: 'newlife__header' }, heading, nav),
    h(
      'div',
      { class: 'newlife__body' },
      h('div', { class: 'newlife__main' }, mini, form),
      h(
        'aside',
        { class: 'newlife__preview', 'aria-label': 'Live preview of the character sheet' },
        h(
          'div',
          { class: 'newlife__preview-head' },
          h('h3', { class: 'newlife__preview-title' }, 'Preview'),
          previewStatus,
        ),
        previewBody,
      ),
    ),
    h(
      'footer',
      { class: 'newlife__footer' },
      cancelLink,
      h('span', { class: 'newlife__spacer' }),
      backButton,
      nextButton,
      startSlot,
    ),
  );
  heading.id = 'newlife-title';

  const stepIndex = () => STEPS.findIndex((s) => s.id === step);
  const go = (id: StepId) => {
    step = id;
    renderStep();
    heading.focus();
  };
  form.addEventListener('click', (event) => {
    const dice = (event.target as Element | null)?.closest?.('.reroll');
    if (dice) flash(dice, 'is-rolling');
  });
  backButton.addEventListener('click', () => {
    const i = stepIndex();
    if (i > 0) go((STEPS[i - 1] as (typeof STEPS)[number]).id);
  });
  nextButton.addEventListener('click', () => {
    const i = stepIndex();
    if (i < STEPS.length - 1) go((STEPS[i + 1] as (typeof STEPS)[number]).id);
  });

  // ---- Talking to the simulation ------------------------------------------------------------

  function optionsOf(d: Draft): Record<string, unknown> {
    const out: Record<string, unknown> = {
      seed: d.seed,
      canonMode: d.canonMode,
      difficulty: d.difficulty,
      rareRaces: d.rareRaces,
      race: d.race,
      birthplace: d.birthplace,
      legacy: d.legacy,
      focus: d.focus,
      entryYear: d.entryYear,
      entryAge: d.entryAge,
      pronouns: d.pronouns,
      locks: { ...d.locks },
      rolls: { ...d.rolls, appearance: { ...d.rolls.appearance } },
    };
    if (d.givenName.trim() !== '') out['givenName'] = d.givenName.trim();
    if (d.familyName.trim() !== '') out['familyName'] = d.familyName.trim();
    return out;
  }

  function requestPreview(delay = 60): void {
    if (!draft) return;
    const id = ++sequence;
    loading = true;
    renderStatus();
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!draft) return;
      app.host
        .call('genesis/preview', { options: optionsOf(draft), view: app.view() })
        .then((result) => {
          if (id !== sequence || !draft) return;
          preview = result;
          previewError = null;
          draft.seed = result.options.seed;
        })
        .catch((error) => {
          if (id !== sequence) return;
          previewError = errorMessage(error);
        })
        .finally(() => {
          if (id !== sequence) return;
          loading = false;
          renderPreview();
          stepUpdate?.(preview);
          renderFooter();
        });
    }, delay);
  }

  /** Change the draft, then refresh. `rebuild` redraws the step (when its choices changed). */
  function change(mutate: (d: Draft) => void, rebuild = false): void {
    if (!draft) return;
    mutate(draft);
    if (rebuild) renderStep();
    requestPreview();
  }

  // ---- Rendering ------------------------------------------------------------------------------

  function renderNav(): void {
    nav.replaceChildren(
      ...STEPS.map((s, i) =>
        h(
          'li',
          null,
          h(
            'button',
            {
              class: 'steps__item',
              type: 'button',
              'aria-current': s.id === step ? 'step' : undefined,
              'aria-label': `Step ${i + 1}: ${s.title}`,
              onclick: () => go(s.id),
            },
            h('span', { class: 'steps__number' }, String(i + 1)),
            h('span', { class: 'steps__label' }, s.title),
          ),
        ),
      ),
    );
  }

  function renderStatus(): void {
    previewStatus.textContent = loading
      ? 'Rolling…'
      : preview
        ? `Generated in ${Math.max(1, Math.round(preview.ms))} ms`
        : '';
  }

  function renderPreview(): void {
    renderStatus();
    sheet?.destroy();
    sheet = null;
    if (previewError) {
      previewBody.replaceChildren(h('p', { class: 'newlife__error', role: 'alert' }, previewError));
      mini.textContent = '';
      return;
    }
    if (!preview) {
      previewBody.replaceChildren(h('p', { class: 'muted' }, 'Rolling your first character…'));
      return;
    }
    if (!preview.sheet) {
      previewBody.replaceChildren(
        h(
          'p',
          { class: 'newlife__error', role: 'alert' },
          preview.error ?? 'These choices cannot make a character.',
        ),
      );
      mini.textContent = '';
      return;
    }
    sheet = renderSheet(preview.sheet, {
      tick: preview.entry?.tick ?? 0,
      compact: true,
      previous: shownSheet,
      place: 'preview',
    });
    shownSheet = preview.sheet;
    previewBody.replaceChildren(sheet.el);
    const s = preview.sheet;
    mini.replaceChildren(
      h('strong', null, s.name),
      ` · ${s.race.name} · ${s.age === 0 ? 'newborn' : `age ${s.age}`} · ${s.birthplace.shortName} `,
      h(
        'a',
        {
          href: '#newlife-sheet',
          class: 'newlife__jump',
          onclick: (e: Event) => {
            e.preventDefault();
            previewBody.scrollIntoView({ behavior: 'smooth' });
          },
        },
        'See the sheet',
      ),
    );
  }

  function renderFooter(): void {
    const i = stepIndex();
    backButton.disabled = i === 0;
    const last = i === STEPS.length - 1;
    nextButton.hidden = last;
    const canStart = preview?.canStart === true && preview.sheet !== null && !loading;
    const lifeInProgress = app.store.get().snapshot?.player != null;
    const start = async () => {
      if (!draft) return;
      const ok = await app.startLife(optionsOf(draft));
      if (ok) {
        // The next visit to New Life starts from these choices with a fresh seed.
        draft.seed = '';
        preview = null;
        navigate('feed');
      }
    };
    const startButton = lifeInProgress
      ? confirmButton({
          label: 'Start this life',
          confirmLabel: 'Press again: your current life ends here',
          className: 'button button--primary',
          disabled: !canStart,
          onConfirm: () => void start(),
        })
      : h(
          'button',
          {
            class: 'button button--primary',
            type: 'button',
            disabled: !canStart,
            onclick: () => void start(),
          },
          'Start this life',
        );
    if (!canStart && preview && !loading) {
      const blocking = preview.warnings.find((w) => w.level === 'error');
      startButton.title = blocking?.text ?? preview.error ?? '';
    }
    startSlot.replaceChildren(last ? startButton : h('span'));
    cancelLink.hidden = app.store.get().snapshot?.player == null;
  }

  function resolvedName<T extends { id: string; name: string }>(
    list: readonly T[],
    id: string | undefined,
  ): string {
    return list.find((x) => x.id === id)?.name ?? '';
  }

  // ---- The steps ------------------------------------------------------------------------------

  function worldStep(s: GenesisSetup, d: Draft) {
    const seed = h('input', {
      class: 'input',
      type: 'text',
      name: 'seed',
      value: d.seed,
      maxlength: 80,
      spellcheck: 'false',
      autocomplete: 'off',
    });
    seed.addEventListener('input', () => {
      if (!draft) return;
      draft.seed = seed.value;
      if (seed.value.trim() !== '') requestPreview(250);
    });
    const reseed = h(
      'button',
      { class: 'button', type: 'button', onclick: () => change((x) => (x.seed = '')) },
      'New seed',
    );
    const rare = h('input', { type: 'checkbox', checked: d.rareRaces });
    rare.addEventListener('change', () =>
      change((x) => {
        x.rareRaces = rare.checked;
        if (!rare.checked && s.races.find((r) => r.id === x.race)?.rare) x.race = RANDOM;
      }),
    );
    const el = h(
      'div',
      { class: 'step' },
      field(
        'Seed',
        h('span', { class: 'field__row' }, seed, reseed),
        'Share a seed and the same choices to share a character.',
      ),
      radioCards(
        'Canon mode',
        s.canonModes.map((m) => ({ value: m.id, title: m.name, summary: m.summary })),
        d.canonMode,
        (v) => change((x) => (x.canonMode = v)),
      ),
      h(
        'p',
        { class: 'field__hint' },
        'The canon story arrives in a later update; the mode you choose is kept with this world.',
      ),
      radioCards(
        'Difficulty',
        s.difficulties.map((x) => ({ value: x.id, title: x.name, summary: x.summary })),
        d.difficulty,
        (v) => change((x) => (x.difficulty = v)),
      ),
      h('label', { class: 'check' }, rare, ' Allow rare races (Lunarians)'),
    );
    return {
      el,
      update() {
        if (document.activeElement !== seed && draft) seed.value = draft.seed;
      },
    };
  }

  function raceStep(s: GenesisSetup, d: Draft) {
    const rolled = h('span', { class: 'rolled' });
    const reroll = h(
      'button',
      {
        class: 'button button--tiny reroll',
        type: 'button',
        onclick: () => change((x) => (x.rolls.race += 1)),
      },
      'Reroll race',
    );
    const cards: Card[] = [
      { value: RANDOM, title: 'Random', summary: 'Weighted by how common each race is.' },
      ...s.races.map((r) => ({
        value: r.id,
        title: r.name,
        summary: capText(r.capMods),
        details: `Child until ${r.anchors.childEnds}, prime from ${r.anchors.primeStarts}, elder from ${r.anchors.elderStarts}; lives ${r.lifespan.min}–${r.lifespan.max} years. ${r.traits.map((t) => t.name).join(', ')}.`,
        extra: renderCapBars(r.capMods),
        disabled: r.rare && !d.rareRaces,
        disabledReason: 'A rare unlock: allow rare races on the World screen.',
      })),
    ];
    const el = h(
      'div',
      { class: 'step' },
      h('p', { class: 'step__random' }, rolled, ' ', reroll),
      radioCards('Race', cards, d.race, (v) =>
        change((x) => {
          x.race = v;
          const race = s.races.find((r) => r.id === v);
          if (race && x.birthplace !== RANDOM && !race.birthplaces.includes(x.birthplace))
            x.birthplace = RANDOM;
        }),
      ),
    );
    return {
      el,
      update(p: GenesisPreview | null) {
        const isRandom = draft?.race === RANDOM;
        reroll.hidden = !isRandom;
        const text =
          isRandom && p?.resolved ? `Rolled: ${resolvedName(s.races, p.resolved.race)}.` : '';
        if (text !== rolled.textContent && text !== '') flash(rolled);
        rolled.textContent = text;
      },
    };
  }

  function birthplaceStep(s: GenesisSetup, d: Draft, p: GenesisPreview | null) {
    const raceId = d.race !== RANDOM ? d.race : p?.resolved?.race;
    const race = s.races.find((r) => r.id === raceId);
    const allowed = s.birthplaces.filter((b) => !race || race.birthplaces.includes(b.id));
    const closed = s.birthplaces.filter((b) => race && !race.birthplaces.includes(b.id));
    const rolled = h('span', { class: 'rolled' });
    const reroll = h(
      'button',
      {
        class: 'button button--tiny reroll',
        type: 'button',
        onclick: () => change((x) => (x.rolls.birthplace += 1)),
      },
      'Reroll birthplace',
    );
    const chart = h('div', { class: 'chart-box' });
    const pickPlace = (v: string) =>
      change((x) => {
        // A birthplace only fits some races: pin the race that was rolled, so it cannot change under it.
        if (x.race === RANDOM && preview?.resolved) x.race = preview.resolved.race;
        x.birthplace = v;
      }, true);
    const drawChart = (next: GenesisPreview | null) => {
      const openIds = new Set(race ? race.birthplaces : s.birthplaces.map((b) => b.id));
      const chosen = draft?.birthplace ?? RANDOM;
      const rolled = chosen === RANDOM ? (next?.resolved?.birthplace ?? null) : null;
      if (!chart.firstChild) chart.append(h('p', { class: 'muted' }, 'Unrolling the chart…'));
      void birthMap(pickPlace).then((map) => {
        if (!chart.isConnected) return;
        map.setPins(
          s.birthplaces
            .filter((b) => b.map)
            .map((b) => {
              const open = openIds.has(b.id);
              const kind =
                chosen === b.id ? 'chosen' : rolled === b.id ? 'rolled' : open ? 'open' : 'closed';
              return {
                id: b.id,
                x: b.map?.x ?? 0,
                y: b.map?.y ?? 0,
                label: b.shortName,
                kind,
                labelled: kind === 'chosen' || kind === 'rolled',
                title: open
                  ? `${b.name}${kind === 'chosen' ? ' (chosen)' : kind === 'rolled' ? ' (rolled)' : ''}`
                  : `${b.name}: closed to a ${race?.name ?? 'this race'}`,
              };
            }),
        );
        if (map.el.parentElement !== chart) {
          chart.replaceChildren(
            map.el,
            h(
              'p',
              { class: 'field__hint' },
              'Drag and zoom the map; pick a pin or a card. Grey pins are closed to your race.',
            ),
          );
          requestAnimationFrame(() => map.measure());
        }
      });
    };
    const el = h(
      'div',
      { class: 'step' },
      chart,
      h('p', { class: 'step__random' }, rolled, ' ', reroll),
      radioCards(
        race ? `Birthplace for a ${race.name}` : 'Birthplace',
        [
          { value: RANDOM, title: 'Random', summary: 'Any place your race can be born.' },
          ...allowed.map((b) => ({
            value: b.id,
            title: b.name,
            summary: b.description,
            details: `Wealth ${b.wealth}, safety ${b.safety.replace('_', ' ')}. Traits: ${b.traits.join(', ')}. ${b.opens}.`,
          })),
        ],
        d.birthplace,
        (v) =>
          change((x) => {
            // A birthplace only fits some races: pin the race that was rolled, so it cannot change under it.
            if (x.race === RANDOM && preview?.resolved) x.race = preview.resolved.race;
            x.birthplace = v;
          }),
      ),
      race && closed.length > 0
        ? h(
            'p',
            { class: 'field__hint' },
            `Closed to a ${race.name}: ${closed.map((b) => b.shortName).join(', ')}.`,
          )
        : null,
    );
    return {
      el,
      update(next: GenesisPreview | null) {
        const isRandom = draft?.birthplace === RANDOM;
        reroll.hidden = !isRandom;
        const text =
          isRandom && next?.resolved
            ? `Rolled: ${resolvedName(s.birthplaces, next.resolved.birthplace)}.`
            : '';
        if (text !== rolled.textContent && text !== '') flash(rolled);
        rolled.textContent = text;
        drawChart(next);
      },
    };
  }

  function familyStep(s: GenesisSetup, d: Draft) {
    const rolled = h('span', { class: 'rolled' });
    const given = h('input', {
      class: 'input',
      type: 'text',
      name: 'givenName',
      value: d.givenName,
      maxlength: 40,
      autocomplete: 'off',
    });
    const family = h('input', {
      class: 'input',
      type: 'text',
      name: 'familyName',
      value: d.familyName,
      maxlength: 40,
      autocomplete: 'off',
    });
    given.addEventListener('input', () => {
      if (draft) draft.givenName = given.value;
      requestPreview(300);
    });
    family.addEventListener('input', () => {
      if (draft) draft.familyName = family.value;
      requestPreview(300);
    });
    const el = h(
      'div',
      { class: 'step' },
      radioCards(
        'Pronouns',
        (['he', 'she', 'they'] as const).map((p) => ({ value: p, title: PRONOUN_LABEL[p] })),
        d.pronouns,
        (v) => change((x) => (x.pronouns = v as Draft['pronouns'])),
      ),
      field(
        'Given name',
        h(
          'span',
          { class: 'field__row' },
          given,
          h(
            'button',
            {
              class: 'button',
              type: 'button',
              onclick: () =>
                change((x) => {
                  x.givenName = '';
                  x.rolls.name += 1;
                }, true),
            },
            'Random name',
          ),
        ),
        'Leave it empty to roll one from where you were born.',
      ),
      field('Family name', family, 'Leave it empty to roll one. Your family shares it.'),
      h(
        'p',
        { class: 'step__random' },
        rolled,
        ' ',
        h(
          'button',
          {
            class: 'button button--tiny reroll',
            type: 'button',
            onclick: () => change((x) => (x.rolls.family += 1)),
          },
          'Reroll family',
        ),
      ),
      radioCards(
        'Family legacy',
        [
          { value: RANDOM, title: 'Random', summary: 'Weighted by where you were born.' },
          ...s.legacies.map((l) => ({
            value: l.id,
            title: l.name,
            summary: l.description,
            details: `Trait: one of ${l.traits.join(' or ')}.`,
          })),
        ],
        d.legacy,
        (v) => change((x) => (x.legacy = v)),
      ),
    );
    return {
      el,
      update(p: GenesisPreview | null) {
        given.placeholder = p?.sheet?.givenName ?? '';
        family.placeholder = p?.sheet?.familyName ?? '';
        const legacy = p?.resolved ? resolvedName(s.legacies, p.resolved.legacy) : '';
        rolled.textContent =
          draft?.legacy === RANDOM && legacy
            ? `Rolled: ${legacy}.`
            : 'Rerolling the family changes parents, brothers and sisters, and wealth.';
      },
    };
  }

  function entryStep(s: GenesisSetup, d: Draft) {
    const { entry } = s;
    const numberInput = (name: string, value: number, min: number, max: number, label: string) =>
      h('input', {
        'aria-label': label,
        class: 'input input--number',
        type: 'number',
        name,
        value: String(value),
        min: String(min),
        max: String(max),
        step: '1',
        inputmode: 'numeric',
      });
    const rangeInput = (name: string, value: number, min: number, max: number, label: string) =>
      h('input', {
        class: 'range',
        type: 'range',
        name,
        value: String(value),
        min: String(min),
        max: String(max),
        step: '1',
        'aria-label': label,
      });
    const yearNumber = numberInput(
      'entryYear',
      d.entryYear,
      entry.minYear,
      entry.maxYear,
      'Entry year',
    );
    const yearRange = rangeInput(
      'entryYearRange',
      d.entryYear,
      entry.minYear,
      entry.maxYear,
      'Entry year',
    );
    const ageNumber = numberInput('entryAge', d.entryAge, entry.minAge, entry.maxAge, 'Entry age');
    const ageRange = rangeInput(
      'entryAgeRange',
      d.entryAge,
      entry.minAge,
      entry.maxAge,
      'Entry age',
    );
    const yearNote = h('span', { class: 'field__hint' });
    const summary = h('p', { class: 'entry-summary' });
    const warnings = h('ul', { class: 'warnings', 'aria-live': 'polite' });
    const focusBox = h('div', { class: 'focus-box' });

    const setYear = (raw: string) => {
      const n = Math.round(Number(raw));
      if (!Number.isFinite(n) || raw.trim() === '') return;
      const v = Math.min(entry.maxYear, Math.max(entry.minYear, n));
      if (draft) draft.entryYear = v;
      yearRange.value = String(v);
      if (document.activeElement !== yearNumber) yearNumber.value = String(v);
      yearNote.textContent = `Year ${v} is ${v + s.canonYearOffset} on the old calendar; the present is Year ${s.presentYear}.`;
      requestPreview(120);
    };
    const setAge = (raw: string) => {
      const n = Math.round(Number(raw));
      if (!Number.isFinite(n) || raw.trim() === '') return;
      const v = Math.min(entry.maxAge, Math.max(entry.minAge, n));
      if (draft) draft.entryAge = v;
      ageRange.value = String(v);
      if (document.activeElement !== ageNumber) ageNumber.value = String(v);
      requestPreview(120);
    };
    yearNumber.addEventListener('input', () => setYear(yearNumber.value));
    yearRange.addEventListener('input', () => {
      yearNumber.value = yearRange.value;
      setYear(yearRange.value);
    });
    ageNumber.addEventListener('input', () => setAge(ageNumber.value));
    ageRange.addEventListener('input', () => {
      ageNumber.value = ageRange.value;
      setAge(ageRange.value);
    });
    yearNote.textContent = `Year ${d.entryYear} is ${d.entryYear + s.canonYearOffset} on the old calendar; the present is Year ${s.presentYear}.`;

    const el = h(
      'div',
      { class: 'step' },
      field('Entry year', h('span', { class: 'field__row' }, yearNumber, yearRange), yearNote),
      field(
        'Entry age',
        h('span', { class: 'field__row' }, ageNumber, ageRange),
        `From ${entry.minAge} (born that month) to ${entry.maxAge}.`,
      ),
      summary,
      warnings,
      focusBox,
    );

    return {
      el,
      update(p: GenesisPreview | null) {
        if (!draft) return;
        if (p?.entry && p.sheet) {
          summary.textContent = `Born ${p.entry.birthLabel}; the story starts ${p.entry.label}. You would turn ${draft.entryAge + s.presentYear - draft.entryYear} in Year ${s.presentYear}, when the present arrives.`;
        } else summary.textContent = '';
        warnings.replaceChildren(
          ...(p?.warnings ?? []).map((w) =>
            h(
              'li',
              { class: 'warning', dataset: { level: w.level, id: w.id } },
              h('span', { class: 'warning__text' }, w.text),
              w.suggestions.map((sg) =>
                h(
                  'button',
                  {
                    class: 'button button--tiny',
                    type: 'button',
                    onclick: () => {
                      ageNumber.value = String(sg.entryAge);
                      setAge(String(sg.entryAge));
                    },
                  },
                  sg.label,
                ),
              ),
            ),
          ),
        );
        if (!p || !p.focusApplies) {
          focusBox.replaceChildren(
            h(
              'p',
              { class: 'field__hint' },
              `A backstory focus is chosen when you enter older than ${s.entry.focusAboveAge} (in your race’s terms).`,
            ),
          );
          return;
        }
        const focusName = resolvedName(s.foci, p.resolved?.focus ?? undefined);
        focusBox.replaceChildren(
          h(
            'p',
            { class: 'step__random' },
            h(
              'span',
              { class: 'rolled' },
              draft.focus === RANDOM && focusName ? `Rolled: ${focusName}.` : '',
            ),
            ' ',
            h(
              'button',
              {
                class: 'button button--tiny reroll',
                type: 'button',
                onclick: () => change((x) => (x.rolls.backstory += 1)),
              },
              'Reroll backstory',
            ),
          ),
          radioCards(
            'Backstory focus',
            [
              {
                value: RANDOM,
                title: 'Random',
                summary: 'Weighted by your birthplace and family.',
              },
              ...s.foci.map((f) => ({ value: f.id, title: f.name, summary: f.description })),
            ],
            draft.focus,
            (v) => change((x) => (x.focus = v)),
          ),
        );
      },
    };
  }

  function appearanceStep() {
    const sentence = h('p', { class: 'appearance-sentence' });
    const rows = h('div', { class: 'appearance-rows' });
    const notes = h('ul', { class: 'warnings' });
    const rerollAll = h(
      'button',
      {
        class: 'button',
        type: 'button',
        onclick: () =>
          change((x) => {
            for (const row of preview?.appearance ?? []) {
              if (x.locks[row.field] === undefined)
                x.rolls.appearance[row.field] = (x.rolls.appearance[row.field] ?? 0) + 1;
            }
          }),
      },
      'Reroll everything unlocked',
    );
    const el = h('div', { class: 'step' }, sentence, h('p', null, rerollAll), notes, rows);
    return {
      el,
      update(p: GenesisPreview | null) {
        sentence.textContent = p?.sheet?.appearance.sentence ?? '';
        notes.replaceChildren(
          ...(p?.notes ?? []).map((n) =>
            h('li', { class: 'warning', dataset: { level: 'info' } }, n),
          ),
        );
        rows.replaceChildren(
          ...(p?.appearance ?? []).map((row) => {
            const select = h(
              'select',
              { class: 'input', name: `appearance-${row.field}`, 'aria-label': row.label },
              row.options.map((o) =>
                h('option', { value: o.id, selected: o.id === row.optionId }, o.label || 'None'),
              ),
            );
            select.addEventListener('change', () =>
              change((x) => (x.locks[row.field] = select.value)),
            );
            const lock = h('input', {
              type: 'checkbox',
              checked: row.locked,
              'aria-label': `Lock ${row.label.toLowerCase()}`,
            });
            lock.addEventListener('change', () =>
              change((x) => {
                if (lock.checked) x.locks[row.field] = row.optionId;
                else delete x.locks[row.field];
              }),
            );
            const reroll = h(
              'button',
              {
                class: 'button button--tiny reroll',
                type: 'button',
                disabled: row.locked,
                title: row.locked ? 'Unlock it to reroll' : '',
                onclick: () =>
                  change((x) => {
                    delete x.locks[row.field];
                    x.rolls.appearance[row.field] = (x.rolls.appearance[row.field] ?? 0) + 1;
                  }),
              },
              'Reroll',
            );
            return h(
              'div',
              {
                class: 'appearance-row',
                dataset: { field: row.field, locked: String(row.locked) },
              },
              h('span', { class: 'appearance-row__label' }, row.label),
              select,
              h('label', { class: 'check' }, lock, ' Lock'),
              reroll,
            );
          }),
        );
      },
    };
  }

  function reviewStep(s: GenesisSetup) {
    const list = h('dl', { class: 'facts review' });
    const warnings = h('ul', { class: 'warnings' });
    const el = h('div', { class: 'step' }, list, warnings);
    return {
      el,
      update(p: GenesisPreview | null) {
        if (!draft) return;
        const r = p?.resolved;
        const pick = (
          chosen: string,
          resolved: string | null | undefined,
          names: readonly { id: string; name: string }[],
        ) =>
          `${resolvedName(names, resolved ?? undefined) || '—'}${chosen === RANDOM ? ' (rolled)' : ''}`;
        const row = (label: string, value: string, target: StepId) =>
          h(
            'div',
            { class: 'facts__row' },
            h('dt', null, label),
            h(
              'dd',
              null,
              value,
              ' ',
              h(
                'button',
                { class: 'link-button', type: 'button', onclick: () => go(target) },
                'Change',
              ),
            ),
          );
        list.replaceChildren(
          row('Seed', draft.seed, 'world'),
          row('Canon mode', resolvedName(s.canonModes, draft.canonMode), 'world'),
          row('Difficulty', resolvedName(s.difficulties, draft.difficulty), 'world'),
          row('Race', pick(draft.race, r?.race, s.races), 'race'),
          row('Birthplace', pick(draft.birthplace, r?.birthplace, s.birthplaces), 'birthplace'),
          row('Family', pick(draft.legacy, r?.legacy, s.legacies), 'family'),
          row(
            'Entry',
            p?.entry
              ? `${p.entry.label}, age ${draft.entryAge}`
              : `Year ${draft.entryYear}, age ${draft.entryAge}`,
            'entry',
          ),
          row(
            'Backstory focus',
            r?.focus ? pick(draft.focus, r.focus, s.foci) : 'none (too young)',
            'entry',
          ),
          row('Starting Berries', p?.sheet ? formatInteger(p.sheet.berries) : '—', 'family'),
        );
        warnings.replaceChildren(
          ...(p?.warnings ?? [])
            .filter((w) => w.level !== 'info')
            .map((w) => h('li', { class: 'warning', dataset: { level: w.level } }, w.text)),
          ...(p?.notes ?? []).map((n) =>
            h('li', { class: 'warning', dataset: { level: 'info' } }, n),
          ),
        );
      },
    };
  }

  function renderStep(): void {
    renderNav();
    renderFooter();
    if (!setup || !draft) {
      form.replaceChildren(h('p', { class: 'muted' }, 'Loading the choices…'));
      stepUpdate = null;
      return;
    }
    const meta = STEPS[stepIndex()] as (typeof STEPS)[number];
    const built =
      step === 'world'
        ? worldStep(setup, draft)
        : step === 'race'
          ? raceStep(setup, draft)
          : step === 'birthplace'
            ? birthplaceStep(setup, draft, preview)
            : step === 'family'
              ? familyStep(setup, draft)
              : step === 'entry'
                ? entryStep(setup, draft)
                : step === 'appearance'
                  ? appearanceStep()
                  : reviewStep(setup);
    form.replaceChildren(
      h('h3', { class: 'step__title' }, `${stepIndex() + 1}. ${meta.title}`),
      h('p', { class: 'step__lead' }, meta.lead),
      built.el,
    );
    stepUpdate = built.update;
    built.update(preview);
    flash(form, 'is-entering');
  }

  async function load(): Promise<void> {
    try {
      setup = await app.host.call('genesis/setup', {});
      const defaults = setup.defaults;
      draft = {
        seed: defaults.seed,
        canonMode: defaults.canonMode,
        difficulty: defaults.difficulty,
        rareRaces: defaults.rareRaces,
        race: defaults.race,
        birthplace: defaults.birthplace,
        legacy: defaults.legacy,
        focus: defaults.focus,
        entryYear: defaults.entryYear,
        entryAge: defaults.entryAge,
        pronouns: defaults.pronouns,
        givenName: '',
        familyName: '',
        locks: {},
        rolls: { race: 0, birthplace: 0, family: 0, backstory: 0, name: 0, appearance: {} },
      };
      renderStep();
      requestPreview(0);
    } catch (error) {
      setup = null;
      form.replaceChildren(h('p', { class: 'newlife__error', role: 'alert' }, errorMessage(error)));
    }
  }

  renderStep();
  renderPreview();

  return {
    el,
    show() {
      if (!setup) {
        void load();
        return;
      }
      renderFooter();
      if (!preview && draft) requestPreview(0);
    },
  };
}
