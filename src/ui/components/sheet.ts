import type { CharacterSheet, StatView } from '../../worker/protocol';
import type { SheetPerson, SheetStat } from '../../systems/genesis/sheet';
import { h, type Child } from '../dom';
import { formatInteger, formatValue } from '../format';
import { prefersReducedMotion } from '../motion';
import { attachBreakdownTooltip, statBreakdownTable } from './breakdown';
import { renderPoster } from './poster';
import { renderStatChart } from './stat-chart';

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
  /**
   * The sheet shown before this one in the same place. Stats that changed get a chip ("+0.6") and
   * their bars grow from the old value; the compass morphs from the old shape.
   */
  previous?: CharacterSheet | null;
  /** Where the sheet is shown ("preview", "character"): keeps each place's compass animation apart. */
  place?: string;
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

/** Health, work, reputation and deeds: the life as it is being lived (Phase 2). */
function lifeBlock(life: NonNullable<CharacterSheet['life']>): HTMLElement {
  const pct =
    life.health.max > 0 ? Math.min(100, (life.health.current / life.health.max) * 100) : 0;
  const ailments = [
    ...life.injuries.map((i) => `${i.name} (${i.severity}, heals ${i.heals})`),
    ...life.illnesses.map((i) => `${i.name} (over by ${i.heals})`),
  ];
  const facts: [string, string][] = [
    ['Work', life.job ?? 'None'],
    ['Fame', formatValue(life.fame)],
    ['Infamy', formatValue(life.infamy)],
  ];
  if (life.married) facts.push(['Married', 'Yes']);
  if (life.gang) facts.push(['Runs with', life.gang]);
  return section(
    'Life',
    h(
      'div',
      { class: 'sheet__health' },
      h('span', null, `Health ${life.health.current} of ${life.health.max}`),
      h(
        'span',
        { class: 'meter', dataset: { tone: pct < 35 ? 'bad' : 'health' }, 'aria-hidden': 'true' },
        h('span', { class: 'meter__fill', style: `width: ${pct.toFixed(1)}%` }),
      ),
      life.exhausted ? h('span', { class: 'sheet__flag' }, 'Exhausted') : null,
    ),
    ailments.length > 0
      ? h(
          'ul',
          { class: 'scars' },
          ailments.map((a) => h('li', null, a)),
        )
      : null,
    h(
      'dl',
      { class: 'derived' },
      facts.map(([label, value]) =>
        h('div', { class: 'derived__row' }, h('dt', null, label), h('dd', null, value)),
      ),
    ),
    life.deeds.length > 0
      ? h(
          'ol',
          { class: 'sheet__deeds' },
          life.deeds.slice(-5).map((d) => h('li', null, `${d.date}: ${d.text}`)),
        )
      : null,
  );
}

export function renderSheet(sheet: CharacterSheet, options: SheetRenderOptions): SheetHandle {
  const cleanups: (() => void)[] = [];
  const { tick, compact = false, previous = null, place = 'sheet' } = options;
  const before = new Map((previous?.stats ?? []).map((s) => [s.id, s.total]));
  const animate = previous !== null && !prefersReducedMotion();
  const grow: { fill: HTMLElement; to: string }[] = [];

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
    const was = before.get(stat.id);
    const delta = was === undefined ? 0 : stat.total - was;
    const changed = Math.abs(delta) >= 0.05;
    const fill = h('span', {
      class: 'stat-row__fill',
      style: `width: ${pct(animate && was !== undefined ? was : stat.total)}`,
    });
    if (animate && was !== undefined && changed) grow.push({ fill, to: pct(stat.total) });
    return h(
      'li',
      {
        class: `stat-row${changed ? ' is-changed' : ''}`,
        dataset: { stat: stat.id, hidden: String(stat.hidden) },
      },
      h('span', { class: 'stat-row__label' }, stat.label),
      h(
        'span',
        { class: 'stat-row__bar', 'aria-hidden': 'true' },
        fill,
        stat.potential
          ? h('span', {
              class: 'stat-row__potential',
              style: `left: ${pct(stat.potential.total)}`,
              title: stat.potential.description,
            })
          : null,
      ),
      total,
      changed
        ? h(
            'span',
            { class: 'stat-row__delta', dataset: { sign: delta > 0 ? 'up' : 'down' } },
            `${delta > 0 ? '+' : '\u2212'}${formatValue(Math.abs(delta))}`,
          )
        : stat.potential
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
      renderPoster(sheet, { compact }),
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
      h(
        'div',
        { class: 'sheet__stats' },
        renderStatChart(sheet.stats, place),
        h('ul', { class: 'stat-rows' }, sheet.stats.map(statRow)),
      ),
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
    sheet.life && !compact ? lifeBlock(sheet.life) : null,
    section(
      'Berries',
      h(
        'p',
        { class: 'sheet__berries', dataset: { debt: String(sheet.berries < 0) } },
        formatInteger(sheet.berries),
        sheet.berries < 0 ? ' (in debt)' : '',
        sheet.life && sheet.life.debt > 0 ? `, and ${formatInteger(sheet.life.debt)} owed` : '',
      ),
    ),
    sheet.backstory
      ? section('Backstory', h('p', { class: 'sheet__backstory' }, sheet.backstory))
      : null,
  );

  // Bars that changed start at their old width and grow (or shrink) to the new one.
  if (grow.length > 0 && typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(() =>
      window.requestAnimationFrame(() => {
        for (const { fill, to } of grow) fill.style.width = to;
      }),
    );
  } else {
    for (const { fill, to } of grow) fill.style.width = to;
  }

  return {
    el,
    destroy() {
      for (const cleanup of cleanups.splice(0)) cleanup();
    },
  };
}
