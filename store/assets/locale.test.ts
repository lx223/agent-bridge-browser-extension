import { describe, expect, it } from 'vitest';
import { availableLocales, CHROME_WEB_STORE_LOCALES, compareToReference, fill, listingLanguages, loadLocale, REFERENCE_LOCALE, textDirection } from './locale.ts';

describe('store screenshot locales', () => {
  it.each(availableLocales())('%s has every string the reference locale has', (code) => {
    expect(() => loadLocale(code)).not.toThrow();
  });

  it('names every locale file with a Chrome Web Store locale code', () => {
    expect(availableLocales().filter((code) => !CHROME_WEB_STORE_LOCALES.includes(code))).toEqual([]);
  });

  it('covers every language the store listing has a description for', () => {
    expect(listingLanguages().filter((code) => !availableLocales().includes(code))).toEqual([]);
  });

  it('lays out Arabic, Persian and Hebrew from right to left', () => {
    expect(['ar', 'fa', 'he', 'en', 'zh-TW', 'pt_BR'].map(textDirection)).toEqual(['rtl', 'rtl', 'rtl', 'ltr', 'ltr', 'ltr']);
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
