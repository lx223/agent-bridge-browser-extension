import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..', '..');
const LOCALES_DIR = join(ROOT, 'public', '_locales');
const DEFAULT_LOCALE = 'en';
const MAX_DESCRIPTION_LENGTH = 132;

const CHROME_LOCALES = new Set(
  'ar am bg bn ca cs da de el en en_AU en_GB en_US es es_419 et fa fi fil fr gu he hi hr hu id it ja kn ko lt lv ml mr ms nl no pl pt_BR pt_PT ro ru sk sl sr sv sw ta te th tr uk vi zh_CN zh_TW'.split(' '),
);

type Messages = Record<string, { message: string; description?: string }>;

const readMessages = (locale: string): Messages => JSON.parse(readFileSync(join(LOCALES_DIR, locale, 'messages.json'), 'utf-8'));
const locales = readdirSync(LOCALES_DIR).sort();
const english = readMessages(DEFAULT_LOCALE);
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;
const pluralBases = Object.keys(english).flatMap((key) => (key.endsWith('_other') ? [key.slice(0, -'_other'.length)] : []));
const slots = (message: string) => [...new Set(message.match(/\$[1-9]/g) ?? [])].sort().join(' ');
const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? sourceFiles(join(dir, entry.name)) : /\.(ts|html)$/.test(entry.name) && !entry.name.endsWith('.test.ts') ? [join(dir, entry.name)] : [],
  );
const source = [...sourceFiles(join(ROOT, 'src')), join(ROOT, 'public', 'manifest.json')].map((file) => readFileSync(file, 'utf-8')).join('\n');

function problems(locale: string): string[] {
  const messages = readMessages(locale);
  const language = locale.replace('_', '-');
  const categories = new Intl.PluralRules(language).resolvedOptions().pluralCategories;
  const required = new Set([...Object.keys(english), ...pluralBases.flatMap((base) => categories.map((category) => `${base}_${category}`))]);
  const found: string[] = [];
  if (!CHROME_LOCALES.has(locale)) found.push(`${locale} is not a locale Chrome supports`);
  if (messages.locale?.message !== locale) found.push(`locale: should be ${locale}`);
  for (const key of required) if (!(key in messages)) found.push(`${key}: missing`);
  for (const [key, { message }] of Object.entries(messages)) {
    const base = key.replace(PLURAL_SUFFIX, '');
    const reference = english[key] ?? (pluralBases.includes(base) ? english[`${base}_other`] : undefined);
    if (!reference) {
      found.push(`${key}: not in ${DEFAULT_LOCALE}`);
      continue;
    }
    if (typeof message !== 'string' || !message.trim()) found.push(`${key}: is empty`);
    else if (slots(message) !== slots(reference.message)) found.push(`${key}: uses ${slots(message) || 'no'} substitutions, ${DEFAULT_LOCALE} uses ${slots(reference.message)}`);
    else if (/\$(?![1-9$])/.test(message.replace(/\$\$/g, ''))) found.push(`${key}: a literal $ must be written $$`);
  }
  if ((messages.extDescription?.message.length ?? 0) > MAX_DESCRIPTION_LENGTH) found.push(`extDescription: longer than ${MAX_DESCRIPTION_LENGTH} characters`);
  return found;
}

describe('extension translations', () => {
  it.each(locales)('%s has every message, with the same substitutions as English', (locale) => {
    expect(problems(locale)).toEqual([]);
  });

  it('uses every English message somewhere in the extension', () => {
    const unused = Object.keys(english)
      .map((key) => key.replace(PLURAL_SUFFIX, ''))
      .filter((key) => key !== 'locale' && !source.includes(`'${key}'`) && !source.includes(`"${key}"`) && !source.includes(`__MSG_${key}__`));
    expect([...new Set(unused)]).toEqual([]);
  });

  it('knows every message the pages ask for', () => {
    const asked = [...source.matchAll(/data-i18n(?:-placeholder|-aria-label|-title)?="([^"]+)"/g)].map((match) => match[1]!);
    expect(asked.filter((key) => !(key in english))).toEqual([]);
  });
});
