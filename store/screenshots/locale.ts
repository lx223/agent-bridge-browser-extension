import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

export const LOCALES_DIR = join(import.meta.dirname, 'locales');
export const REFERENCE_LOCALE = 'en';

export const topics = ['travel', 'work', 'recipes'] as const;
export type Topic = (typeof topics)[number];

export const sceneNames = ['tabs', 'pages', 'profiles', 'setup'] as const;
export type SceneName = (typeof sceneNames)[number];

export interface Caption {
  headline: string;
  subline: string;
}

export interface LocaleStrings {
  captions: Record<SceneName, Caption>;
  chat: { you: string; agent: string };
  tabs: {
    prompt: string;
    reply: string;
    groups: Record<Topic, string>;
    pages: Record<Topic, string[]>;
  };
  booking: {
    prompt: string;
    reply: string;
    restaurant: string;
    heading: string;
    name: string;
    guests: string;
    when: string;
    tonight: string;
    submit: string;
    confirmation: string;
    guestName: string;
  };
  profiles: {
    prompt: string;
    reply: string;
    name: string;
  };
}

export interface Locale {
  code: string;
  languageTag: string;
  strings: LocaleStrings;
}

export const availableLocales = (): string[] =>
  readdirSync(LOCALES_DIR)
    .filter((file) => file.endsWith('.json'))
    .map((file) => basename(file, '.json'))
    .sort();

const readJson = (code: string): unknown => JSON.parse(readFileSync(join(LOCALES_DIR, `${code}.json`), 'utf-8'));

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

export function compareToReference(reference: unknown, candidate: unknown, path = ''): string[] {
  const where = path || '(root)';
  if (typeof reference === 'string') {
    if (typeof candidate !== 'string') return [`${where}: expected text`];
    if (!candidate.trim()) return [`${where}: is empty`];
    const expected = placeholders(reference).join(',');
    const actual = placeholders(candidate).join(',');
    return expected === actual ? [] : [`${where}: placeholders {${actual}} should be {${expected}}`];
  }
  if (Array.isArray(reference)) {
    if (!Array.isArray(candidate)) return [`${where}: expected a list`];
    if (candidate.length !== reference.length) return [`${where}: expected ${reference.length} entries, found ${candidate.length}`];
    return reference.flatMap((item, index) => compareToReference(item, candidate[index], `${path}[${index}]`));
  }
  if (typeof reference === 'object' && reference !== null) {
    if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) return [`${where}: expected an object`];
    const extra = Object.keys(candidate).filter((key) => !(key in reference)).map((key) => `${path ? `${path}.` : ''}${key}: not in ${REFERENCE_LOCALE}.json`);
    const nested = Object.entries(reference).flatMap(([key, value]) =>
      key in candidate
        ? compareToReference(value, (candidate as Record<string, unknown>)[key], path ? `${path}.${key}` : key)
        : [`${path ? `${path}.` : ''}${key}: missing`],
    );
    return [...nested, ...extra];
  }
  return [];
}

export function loadLocale(code: string): Locale {
  if (!availableLocales().includes(code)) {
    throw new Error(`No locale file for "${code}". Available: ${availableLocales().join(', ')}`);
  }
  const strings = readJson(code);
  const problems = compareToReference(readJson(REFERENCE_LOCALE), strings);
  if (problems.length) throw new Error(`locales/${code}.json does not match ${REFERENCE_LOCALE}.json:\n  ${problems.join('\n  ')}`);
  return { code, languageTag: code.replace('_', '-'), strings: strings as LocaleStrings };
}

export const fill = (template: string, values: Record<string, string | number>) =>
  template.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? String(values[key]) : match));
