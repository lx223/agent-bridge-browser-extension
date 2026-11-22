import { describe, expect, it } from 'vitest';
import { availableLocales, compareToReference, fill, loadLocale, REFERENCE_LOCALE } from './locale.ts';

describe('store screenshot locales', () => {
  it.each(availableLocales())('%s has every string the reference locale has', (code) => {
    expect(() => loadLocale(code)).not.toThrow();
  });

  it('includes the reference locale', () => {
    expect(availableLocales()).toContain(REFERENCE_LOCALE);
  });

  it('reports missing, extra, empty and mismatched strings', () => {
    const reference = { a: 'Hi {name}', b: ['x', 'y'], c: { d: 'z' } };
    expect(compareToReference(reference, { a: 'Hallo', b: ['x'], c: { d: ' ' }, e: 'extra' })).toEqual([
      'a: placeholders {} should be {name}',
      'b: expected 2 entries, found 1',
      'c.d: is empty',
      'e: not in en.json',
    ]);
    expect(compareToReference(reference, { a: 'Hallo {name}', b: ['x', 'y'] })).toEqual(['c: missing']);
  });

  it('fills placeholders and leaves unknown ones', () => {
    expect(fill('{tabs} tabs in {groups} groups {other}', { tabs: 8, groups: 3 })).toBe('8 tabs in 3 groups {other}');
  });
});
