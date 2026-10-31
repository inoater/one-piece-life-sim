import type { App } from '../app';
import { h } from '../dom';
import { errorMessage, formatInteger } from '../format';
import type { UiState } from '../store';
import type { Catalog } from '../../worker/protocol';
import type { DebugTab } from './tab';

/**
 * The sandbox: everything that can be handed out, by type, with a search box (weapons by family
 * and grade, items by kind, the world's Devil Fruits by where they are, traits by kind, power
 * tracks by family), the player's stats, money, fame, infamy and bounty to set, haki to wake, and
 * crew tools (a crewmate made here and brought aboard, a planted spy, a member's loyalty).
 */
export function createSandboxTab(app: App): DebugTab {
  const search = h('input', {
    class: 'debug__input sandbox__search',
    type: 'search',
    placeholder: 'Find anything: a sword, a dial, a trait...',
    'aria-label': 'Find in the sandbox',
  });
  const note = h('p', { class: 'debug__note', role: 'status' });
  const body = h('div', { class: 'sandbox' });
  let catalog: Catalog | null = null;
  let playerId: string | null = null;
  const open = new Set<string>(['Your numbers']);

  const act = (action: unknown, done: string) => {
    void app.dispatch(action, done).then(() => refresh());
  };
  const tiny = (label: string, onclick: () => void, extra = '') =>
    h('button', { class: `button button--tiny ${extra}`.trim(), type: 'button', onclick }, label);
  const numberInput = (value: number, label: string, step = '1') =>
    h('input', {
      class: 'debug__input debug__input--short',
      type: 'number',
      value: String(value),
      step,
      'aria-label': label,
    });

  function block(title: string, ...children: (Node | null)[]): HTMLElement {
    const el = h(
      'details',
      {
        class: 'sandbox__block',
        open: open.has(title),
        ontoggle: (e: Event) =>
          (e.target as HTMLDetailsElement).open ? open.add(title) : open.delete(title),
      },
      h('summary', { class: 'sandbox__title' }, title),
      ...children,
    );
    return el;
  }

  function list(
    groups: Catalog['weapons'],
    buttons: (entry: Catalog['weapons'][number]['entries'][number], group: string) => Node[],
    filter: string,
  ): Node[] {
    const out: Node[] = [];
    for (const g of groups) {
      const shown = g.entries.filter(
        (e) => !filter || `${e.name} ${e.id} ${g.group} ${e.note}`.toLowerCase().includes(filter),
      );
      if (shown.length === 0) continue;
      out.push(
        h('h5', { class: 'sandbox__group' }, `${g.group} (${shown.length})`),
        h(
          'ul',
          { class: 'sandbox__list' },
          shown.map((e) =>
            h(
              'li',
              { class: 'sandbox__row' },
              h('span', { class: 'sandbox__name', title: e.id }, e.name),
              e.note ? h('span', { class: 'sandbox__meta' }, e.note) : null,
              h('span', { class: 'sandbox__acts' }, buttons(e, g.group)),
            ),
          ),
        ),
      );
    }
    return out.length > 0 ? out : [h('p', { class: 'debug__note' }, 'Nothing matches.')];
  }

  function draw(): void {
    if (!catalog) return;
    const c = catalog;
    const filter = search.value.trim().toLowerCase();
    const numbers = block(
      'Your numbers',
      h(
        'div',
        { class: 'sandbox__grid' },
        c.stats.map((s) => {
          const input = numberInput(s.value, s.label, '1');
          return h(
            'label',
            { class: 'sandbox__field' },
            h('span', null, s.label),
            input,
            tiny(
              'Set',
              () =>
                playerId &&
                act(
                  {
                    type: 'debug/setStat',
                    entityId: playerId,
                    stat: s.id,
                    value: Number(input.value),
                  },
                  `${s.label} set.`,
                ),
            ),
          );
        }),
        (['berries', 'fame', 'infamy', 'bounty'] as const).map((field) => {
          const input = numberInput(
            c.money[field],
            field,
            field === 'berries' || field === 'bounty' ? '1000' : '1',
          );
          return h(
            'label',
            { class: 'sandbox__field' },
            h('span', null, field.charAt(0).toUpperCase() + field.slice(1)),
            input,
            tiny('Set', () =>
              act({ type: 'debug/money', field, value: Number(input.value) }, `${field} set.`),
            ),
          );
        }),
      ),
      h(
        'div',
        { class: 'sandbox__acts' },
        (['observation', 'armament', 'conqueror'] as const).map((haki) =>
          tiny(`Wake ${haki}`, () => act({ type: 'debug/wakeHaki', haki }, `${haki} haki woke.`)),
        ),
        tiny(
          'A minor injury',
          () =>
            act(
              { type: 'debug/injure', severity: 'minor', area: 'arms' },
              'Hurt a little (to test healing).',
            ),
          'button--ghost',
        ),
      ),
    );
    const weapons = block(
      'Weapons',
      ...list(
        c.weapons,
        (e) => [
          tiny('Give', () => act({ type: 'debug/giveItem', item: e.id }, `Given: ${e.name}.`)),
        ],
        filter,
      ),
    );
    const items = block(
      'Items',
      ...list(
        c.items,
        (e) => [
          tiny('Give', () => act({ type: 'debug/giveItem', item: e.id }, `Given: ${e.name}.`)),
        ],
        filter,
      ),
    );
    const fruits = block(
      'Devil Fruits',
      ...list(
        c.fruits,
        (e, group) =>
          group === 'Eaten'
            ? []
            : [
                tiny('Give', () =>
                  act({ type: 'debug/giveFruit', fruit: e.id }, `Given: ${e.name}.`),
                ),
              ],
        filter,
      ),
    );
    const traits = block(
      'Traits',
      ...list(
        c.traits,
        (e) => [
          e.note === 'has it'
            ? tiny(
                'Remove',
                () =>
                  act({ type: 'debug/trait', trait: e.id, remove: true }, `Removed: ${e.name}.`),
                'button--ghost',
              )
            : tiny('Give', () =>
                act({ type: 'debug/trait', trait: e.id, remove: false }, `Given: ${e.name}.`),
              ),
        ],
        filter,
      ),
    );
    const tracks = block(
      'Powers and styles',
      ...list(
        c.tracks,
        (e) => [
          tiny('+100', () =>
            act(
              { type: 'debug/powerPoints', track: e.id, points: 100, breakthrough: false },
              `${e.name}: +100.`,
            ),
          ),
          tiny('+1,000', () =>
            act(
              { type: 'debug/powerPoints', track: e.id, points: 1000, breakthrough: false },
              `${e.name}: +1,000.`,
            ),
          ),
          tiny(
            'Breakthrough',
            () =>
              act(
                { type: 'debug/powerPoints', track: e.id, points: 0, breakthrough: true },
                `${e.name}: a breakthrough.`,
              ),
            'button--ghost',
          ),
        ],
        filter,
      ),
    );
    const strength = numberInput(1, 'How strong, times an ordinary person', '0.1');
    const member = h(
      'select',
      { class: 'debug__input', 'aria-label': 'Crewmate' },
      (c.crew?.members ?? []).map((m) => h('option', { value: m.id }, m.name)),
    );
    const faction = h(
      'select',
      { class: 'debug__input', 'aria-label': 'Spying for' },
      ['org_marines', 'org_world_government', 'org_underworld'].map((f) =>
        h('option', { value: f }, f.replace('org_', '').replace(/_/g, ' ')),
      ),
    );
    const loyalty = numberInput(50, 'Loyalty', '5');
    const crew = block(
      'Crew',
      h(
        'p',
        { class: 'debug__note' },
        c.crew
          ? `${c.crew.name}: ${c.crew.size} aboard.`
          : 'No crew yet: adding a crewmate founds one.',
      ),
      h(
        'div',
        { class: 'sandbox__acts' },
        h('span', null, 'Strength ×'),
        strength,
        tiny('Add a crewmate', () =>
          act(
            { type: 'debug/addCrewmate', strength: Number(strength.value) },
            'A crewmate came aboard.',
          ),
        ),
      ),
      c.crew && c.crew.members.length > 0
        ? h(
            'div',
            { class: 'sandbox__acts' },
            member,
            faction,
            tiny('Plant a spy', () =>
              act(
                { type: 'debug/plantSpy', member: member.value, faction: faction.value },
                'A spy is aboard.',
              ),
            ),
            loyalty,
            tiny('Set loyalty', () =>
              act(
                {
                  type: 'debug/heart',
                  target: member.value,
                  axis: 'loyalty',
                  value: Number(loyalty.value),
                },
                'Loyalty set.',
              ),
            ),
          )
        : null,
    );
    body.replaceChildren(numbers, weapons, items, fruits, traits, tracks, crew);
  }

  async function refresh(): Promise<void> {
    try {
      catalog = await app.host.call('debug/catalog', {});
      playerId = app.store.get().snapshot?.player?.id ?? null;
      note.textContent =
        catalog.stats.length > 0 ? `Berries ${formatInteger(catalog.money.berries)}.` : '';
      draw();
    } catch (error) {
      note.textContent = errorMessage(error);
    }
  }

  search.addEventListener('input', () => {
    // Searching opens every list that has a match.
    if (search.value.trim())
      for (const t of ['Weapons', 'Items', 'Devil Fruits', 'Traits', 'Powers and styles'])
        open.add(t);
    draw();
  });
  const el = h('div', { class: 'debug__section sandbox-tab' }, search, note, body);
  return {
    el,
    refresh,
    sync(_state: UiState) {
      void _state;
    },
  };
}
