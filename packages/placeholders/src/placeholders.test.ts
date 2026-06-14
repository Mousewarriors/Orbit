import { describe, expect, it } from 'vitest';
import {
  collectRequiredInputs,
  formatDate,
  parseTemplate,
  resolveTemplate,
  TemplateError,
} from './index.js';

describe('parseTemplate', () => {
  it('parses literals and placeholders', () => {
    const nodes = parseTemplate('Hello {query}!');
    expect(nodes).toEqual([
      { kind: 'literal', text: 'Hello ' },
      { kind: 'placeholder', name: 'query', arg: undefined, raw: 'query' },
      { kind: 'literal', text: '!' },
    ]);
  });

  it('handles escaped braces', () => {
    const nodes = parseTemplate('{{ literal }} {query}');
    expect(nodes[0]).toEqual({ kind: 'literal', text: '{ literal } ' });
  });

  it('parses arguments after | and :', () => {
    expect(parseTemplate('{date|yyyy}')[0]).toMatchObject({ name: 'date', arg: 'yyyy' });
    expect(parseTemplate('{input:Your Name}')[0]).toMatchObject({ name: 'input', arg: 'Your Name' });
  });

  it('throws on unclosed placeholder', () => {
    expect(() => parseTemplate('hi {query')).toThrow(TemplateError);
  });
});

describe('collectRequiredInputs', () => {
  it('collects text inputs and choices, de-duplicated', () => {
    const nodes = parseTemplate('{input:Name} {input:Name} {choice:low,med,high}');
    const inputs = collectRequiredInputs(nodes);
    expect(inputs).toHaveLength(2);
    expect(inputs[0]).toMatchObject({ kind: 'text', label: 'Name' });
    expect(inputs[1]).toMatchObject({ kind: 'choice', choices: ['low', 'med', 'high'] });
  });
});

describe('formatDate', () => {
  const d = new Date(2026, 5, 14, 16, 7, 9); // 14 June 2026, 16:07:09 local
  it('formats common patterns', () => {
    expect(formatDate(d, 'yyyy-MM-dd')).toBe('2026-06-14');
    expect(formatDate(d, 'HH:mm:ss')).toBe('16:07:09');
    expect(formatDate(d, 'h:mm a')).toBe('4:07 PM');
    expect(formatDate(d, 'EEEE, d MMMM yyyy')).toBe('Sunday, 14 June 2026');
  });
});

describe('resolveTemplate', () => {
  it('substitutes context values', () => {
    const r = resolveTemplate('Hi {input:Name}, copied: {clipboard}', {
      inputs: { 'input:Name': 'Sam' },
      clipboard: 'abc',
    });
    expect(r.text).toBe('Hi Sam, copied: abc');
    expect(r.missing).toHaveLength(0);
  });

  it('reports missing sources', () => {
    const r = resolveTemplate('{selection}', {});
    expect(r.text).toBe('');
    expect(r.missing).toContain('selection');
  });

  it('tracks the cursor position', () => {
    const r = resolveTemplate('Dear {input:Name},\n\n{cursor}\n\nRegards', {
      inputs: { 'input:Name': 'Kate' },
    });
    expect(r.cursor).toBe('Dear Kate,\n\n'.length);
  });

  it('uses an injectable uuid', () => {
    const r = resolveTemplate('id={uuid}', { uuid: () => 'FIXED' });
    expect(r.text).toBe('id=FIXED');
  });

  it('defaults choices to the first option', () => {
    const r = resolveTemplate('{choice:alpha,beta}', {});
    expect(r.text).toBe('alpha');
  });

  it('formats dates from a fixed now', () => {
    const r = resolveTemplate('{date|yyyy}', { now: new Date(2030, 0, 1) });
    expect(r.text).toBe('2030');
  });

  it('preserves unknown placeholders and flags them', () => {
    const r = resolveTemplate('{bogus}', {});
    expect(r.text).toBe('{bogus}');
    expect(r.missing).toContain('bogus');
  });
});
