import type { CharacterSheet, StatView } from '../../worker/protocol';
import type { SheetPerson, SheetStat } from '../../systems/genesis/sheet';
import { h, type Child } from '../dom';
import { formatInteger, formatValue } from '../format';
import { attachBreakdownTooltip, statBreakdownTable } from './breakdown';

/**
 * The character sheet as text, used twice: the live preview beside every New Life screen, and
 * the Character tab once a life has started. Every stat explains itself on hover or focus (rule
 * 3), and what nobody knows (potential, talent, Luck) appears only in omniscient mode (rule 4).
 */

export interface SheetHandle {
  el: HTMLElement;
  /** Remove any tooltip this sheet opened. Call before replacing it. */
  destroy(): void;
}

export interface SheetRenderOptions {
  tick: number;
  /** The preview beside New Life: shorter family list, no flags. */
  compact?: boolean;
}

function section(title: string, ...children: (Child | readonly Child[])[]): HTMLElement {
  return h(
    'section',
    { class: 'sheet__section' },
    h('h4', { class: 'sheet__heading' }, title),
    ...children,
  );
}

function personLine(p: SheetPerson): HTMLElement {
  const facts = [
    p.alive ? (p.age !== null ? `${p.age}` : '') : '',
    p.occupation ?? '',
    ...p.notes,
  ].filter((t) => t !== '');
  return h(
    'li',
    { class: 'person', dataset: { alive: String(p.alive) } },
    h('span', { class: 'person__relation' }, p.relation),
    h('span', { class: 'person__name' }, p.name),
    facts.length > 0 ? h('span', { class: 'person__facts' }, facts.join(', ')) : null,
    p.death ? h('span', { class: 'person__death' }, p.death) : null,
    p.traits.length > 0 ? h('span', { class: 'person__traits' }, p.traits.join(', ')) : null,
  );
}

export function renderSheet(sheet: CharacterSheet, options: SheetRenderOptions): SheetHandle {
  const cleanups: (() => void)[] = [];
  const { tick, compact = false } = options;

  const scale = Math.max(
    100,
    ...sheet.stats.map((s) => Math.max(s.total, s.potential?.total ?? 0)),
  );
  const statRow = (stat: SheetStat): HTMLElement => {
    const total = h(
      'button',
      {
        class: 'stat-row__value',
        type: 'button',
        'aria-label': `${stat.description}. Show the breakdown.`,
      },
      formatValue(stat.total),
    );
    cleanups.push(attachBreakdownTooltip(total, () => statBreakdownTable(stat as StatView, tick)));
    const pct = (n: number) => `${Math.max(0, Math.min(100, (n / scale) * 100)).toFixed(1)}%`;
    return h(
      'li',
      { class: 'stat-row', dataset: { stat: stat.id, hidden: String(stat.hidden) } },
      h('span', { class: 'stat-row__label' }, stat.label),
      h(
        'span',
        { class: 'stat-row__bar', 'aria-hidden': 'true' },
        h('span', { class: 'stat-row__fill', style: `width: ${pct(stat.total)}` }),
        stat.potential
          ? h('span', {
              class: 'stat-row__potential',
              style: `left: ${pct(stat.potential.total)}`,
              title: stat.potential.description,
            })
          : null,
      ),
      total,
      stat.potential
        ? h(
            'span',
            { class: 'stat-row__cap', title: stat.potential.description },
            `/ ${formatValue(stat.potential.total)}`,
          )
        : null,
    );
  };

  const family = sheet.family;
  const el = h(
    'article',
    {
      class: `sheet${compact ? ' sheet--compact' : ''}`,
      'aria-label': `Character sheet: ${sheet.name}`,
    },
    h(
      'header',
      { class: 'sheet__header' },
      h('h3', { class: 'sheet__name' }, sheet.name),
      h(
        'p',
        { class: 'sheet__identity' },
        `${sheet.age === 0 ? 'Newborn' : `Age ${sheet.age}`}, ${sheet.stage.name.toLowerCase()}. ${sheet.race.name}, born ${sheet.born.label}, ${sheet.birthplace.bornIn}.`,
      ),
      sheet.born.beforeGodValley
        ? h('p', { class: 'sheet__badge' }, 'Born before God Valley')
        : null,
    ),
    h(
      'p',
      { class: 'sheet__appearance' },
      sheet.appearance.sentence,
      ` Height ${sheet.appearance.height}.`,
    ),
    sheet.talentHint ? h('p', { class: 'sheet__hint' }, sheet.talentHint) : null,

    section(
      'Stats',
      h('ul', { class: 'stat-rows' }, sheet.stats.map(statRow)),
      sheet.stats.some((s) => s.id === 'luck')
        ? null
        : h(
            'p',
            { class: 'sheet__note' },
            'Luck is hidden: it nudges what happens, and cannot be trained.',
          ),
    ),
    section(
      'Derived',
      h(
        'dl',
        { class: 'derived' },
        sheet.derived.map((d) =>
          h(
            'div',
            { class: 'derived__row', title: d.note ?? '' },
            h('dt', null, d.name),
            h(
              'dd',
              null,
              h('strong', null, formatValue(d.value)),
              h('span', { class: 'derived__formula' }, d.formula.replace(/^[^=]*= /, '= ')),
            ),
          ),
        ),
        h(
          'div',
          { class: 'derived__row' },
          h('dt', null, 'Training gains'),
          h(
            'dd',
            null,
            h(
              'strong',
              null,
              `${sheet.growth.traitPct >= 0 ? '+' : ''}${formatValue(sheet.growth.traitPct)}%`,
            ),
            h(
              'span',
              { class: 'derived__formula' },
              sheet.growth.lines.length > 0
                ? sheet.growth.lines
                    .map((l) => `${l.pct >= 0 ? '+' : ''}${l.pct}% ${l.source}`)
                    .join(', ')
                : 'no trait changes it',
              sheet.growth.talentMult !== undefined
                ? `; talent x${formatValue(sheet.growth.talentMult)}`
                : '',
            ),
          ),
        ),
      ),
    ),
    section(
      'Traits',
      h(
        'ul',
        { class: 'traits' },
        sheet.traits.map((t) =>
          h(
            'li',
            { class: 'trait', dataset: { category: t.category }, title: t.description },
            h('span', { class: 'trait__name' }, t.name),
            compact ? null : h('span', { class: 'trait__description' }, t.description),
          ),
        ),
      ),
    ),
    sheet.hidden
      ? section(
          'Hidden (omniscient)',
          h(
            'p',
            { class: 'sheet__secret' },
            `Talent: ${sheet.hidden.talent.name} (potential x${formatValue(sheet.hidden.talent.potentialMult)}, growth x${formatValue(sheet.hidden.talent.growthMult)}). Luck ${formatValue(sheet.hidden.luck)}.`,
          ),
        )
      : null,
    family
      ? section(
          'Family',
          h(
            'p',
            { class: 'sheet__family' },
            `${family.legacy.name}. ${family.wealth.name}. ${family.birthOrder}.`,
            family.expected > 0
              ? ` ${family.expected === 1 ? 'A brother or sister is' : `${family.expected} more children are`} still to come.`
              : '',
          ),
          h('ul', { class: 'people' }, family.members.map(personLine)),
        )
      : null,
    sheet.relationships.length > 0
      ? section('People', h('ul', { class: 'people' }, sheet.relationships.map(personLine)))
      : null,
    sheet.scars.length > 0
      ? section(
          'Scars',
          h(
            'ul',
            { class: 'scars' },
            sheet.scars.map((s) => h('li', null, `${s.text} (${s.area}, age ${s.age})`)),
          ),
        )
      : null,
    section(
      'Berries',
      h(
        'p',
        { class: 'sheet__berries', dataset: { debt: String(sheet.berries < 0) } },
        formatInteger(sheet.berries),
        sheet.berries < 0 ? ' (in debt)' : '',
      ),
    ),
    sheet.backstory
      ? section('Backstory', h('p', { class: 'sheet__backstory' }, sheet.backstory))
      : null,
  );

  return {
    el,
    destroy() {
      for (const cleanup of cleanups.splice(0)) cleanup();
    },
  };
}
