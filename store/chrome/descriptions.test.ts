import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const DESCRIPTIONS_DIR = join(import.meta.dirname, 'descriptions');
const EXTENSION_LOCALES_DIR = join(import.meta.dirname, '../../packages/extension/public/_locales');
const DEFAULT_LOCALE = 'en';
const MAX_DESCRIPTION_LENGTH = 16_000;

const translatedLocales = readdirSync(EXTENSION_LOCALES_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name !== DEFAULT_LOCALE)
  .map((entry) => entry.name)
  .sort();

const descriptionLocales = readdirSync(DESCRIPTIONS_DIR)
  .filter((file) => file.endsWith('.md'))
  .map((file) => basename(file, '.md'))
  .sort();

describe('Chrome Web Store descriptions', () => {
  it.each(translatedLocales)('%s has a description within the store limit', (code) => {
    expect(descriptionLocales).toContain(code);
    const text = readFileSync(join(DESCRIPTIONS_DIR, `${code}.md`), 'utf-8').trim();
    expect(text).not.toBe('');
    expect([...text].length).toBeLessThanOrEqual(MAX_DESCRIPTION_LENGTH);
  });

  it('has no description without a matching extension locale', () => {
    expect(descriptionLocales.filter((code) => !translatedLocales.includes(code))).toEqual([]);
  });
});
