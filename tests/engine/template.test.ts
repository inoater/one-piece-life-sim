import { describe, expect, it } from 'vitest';
import {
  checkTemplate,
  parseTemplate,
  renderTemplate,
  TemplateError,
} from '../../src/engine/template';

describe('templates', () => {
  it('fills variables', () => {
    expect(
      renderTemplate('Posted in {monthName}, Year {year}.', { monthName: 'March', year: '12' }),
    ).toBe('Posted in March, Year 12.');
  });

  it('supports literal braces by doubling them', () => {
    expect(renderTemplate('Use {{this}} and {x}', { x: '1' })).toBe('Use {this} and 1');
  });

  it('parses into text and variable tokens', () => {
    expect(parseTemplate('a{b}c')).toEqual({
      ok: true,
      tokens: [
        { type: 'text', text: 'a' },
        { type: 'var', name: 'b' },
        { type: 'text', text: 'c' },
      ],
    });
  });

  it('reports malformed templates', () => {
    expect(parseTemplate('oops {unclosed')).toMatchObject({ ok: false });
    expect(parseTemplate('stray } brace')).toMatchObject({ ok: false });
    expect(parseTemplate('bad {1name}')).toMatchObject({ ok: false });
    expect(parseTemplate('empty {}')).toMatchObject({ ok: false });
  });

  it('checks variables against the registry and lists the valid ones', () => {
    expect(checkTemplate('fine {date} and {season}')).toEqual([]);
    const problems = checkTemplate('typo {monthname}');
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('Unknown template variable "{monthname}"');
    expect(problems[0]).toContain('{monthName}');
  });

  it('reports each unknown variable once', () => {
    expect(checkTemplate('{zzz} {zzz} {yyy}')).toHaveLength(2);
  });

  it('refuses to render an unknown variable instead of printing "undefined"', () => {
    expect(() => renderTemplate('Hello {nobody}', {})).toThrow(TemplateError);
  });
});
