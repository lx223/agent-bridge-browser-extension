import { afterEach, describe, expect, it, vi } from 'vitest';
import { englishI18n } from '../test/englishI18n.ts';
import { plural, relativeTime, slotMarkers, splitAroundSlots, t, textDirection, uiLocale } from './messages.ts';

const NOW = 10 * 24 * 60 * 60_000;
const minutes = (n: number) => NOW - n * 60_000;
const hours = (n: number) => minutes(n * 60);

function useLocale(locale: string, messages: Record<string, string>) {
  vi.stubGlobal('chrome', {
    i18n: {
      getMessage: (key: string, substitutions: string[] = []) =>
        key === 'locale' ? locale : (messages[key] ?? '').replace(/\$([1-9])/g, (_, slot: string) => substitutions[Number(slot) - 1] ?? ''),
    },
  });
}

afterEach(() => {
  vi.stubGlobal('chrome', { i18n: englishI18n });
});

describe('t', () => {
  it('fills in substitutions', () => {
    expect(t('sessionInProject', 'claude-code 2.1.3', 'shop')).toBe('claude-code 2.1.3 in shop');
    expect(t('instanceId', 42)).toBe('Instance id: 42');
  });
});

describe('uiLocale', () => {
  it('turns the message folder name into a language tag', () => {
    expect(uiLocale()).toBe('en');
    useLocale('pt_BR', {});
    expect(uiLocale()).toBe('pt-BR');
  });
});

describe('textDirection', () => {
  it('runs right to left for the languages of the messages that need it', () => {
    expect(textDirection()).toBe('ltr');
    useLocale('ar', {});
    expect(textDirection()).toBe('rtl');
    useLocale('fa', {});
    expect(textDirection()).toBe('rtl');
    useLocale('pt_BR', {});
    expect(textDirection()).toBe('ltr');
  });
});

describe('plural', () => {
  it('picks the English singular and plural', () => {
    expect(plural('optionsConnectedMany', 1)).toBe('1 agent session connected');
    expect(plural('optionsConnectedMany', 3)).toBe('3 agent sessions connected');
    expect(plural('sessionLastUsed', 1, 'chrome_tabs_list', 'just now')).toBe('Last used chrome_tabs_list just now, 1 call');
  });

  it('uses the plural categories of the language and formats the number for it', () => {
    useLocale('ru', { chatUnseen_one: '$2 ($1 новое)', chatUnseen_few: '$2 ($1 новых)', chatUnseen_many: '$2 ($1 новых!)', chatUnseen_other: '$2 ($1)' });
    expect(plural('chatUnseen', 21, 'Чат')).toBe('Чат (21 новое)');
    expect(plural('chatUnseen', 3, 'Чат')).toBe('Чат (3 новых)');
    expect(plural('chatUnseen', 5, 'Чат')).toBe('Чат (5 новых!)');
    useLocale('de', { chatTooLong_other: 'Höchstens $1 Zeichen.' });
    expect(plural('chatTooLong', 20_000)).toBe('Höchstens 20.000 Zeichen.');
  });

  it('falls back to the other form when a category is missing', () => {
    useLocale('ja', { chatUnseen_other: '$2（新着 $1 件）' });
    expect(plural('chatUnseen', 1, 'チャット')).toBe('チャット（新着 1 件）');
  });
});

describe('relativeTime', () => {
  it('rounds to the nearest sensible unit', () => {
    expect(relativeTime(NOW - 10_000, NOW)).toBe('just now');
    expect(relativeTime(NOW + 5_000, NOW)).toBe('just now');
    expect(relativeTime(minutes(1), NOW)).toBe('1 minute ago');
    expect(relativeTime(minutes(89), NOW)).toBe('89 minutes ago');
    expect(relativeTime(hours(3), NOW)).toBe('3 hours ago');
    expect(relativeTime(hours(35), NOW)).toBe('35 hours ago');
  });

  it('counts whole days after a day and a half', () => {
    expect(relativeTime(hours(36), NOW)).toBe('yesterday');
    expect(relativeTime(hours(47), NOW)).toBe('yesterday');
    expect(relativeTime(hours(48), NOW)).toBe('2 days ago');
    expect(relativeTime(hours(24 * 5 + 3), NOW)).toBe('5 days ago');
  });

  it('speaks the language of the messages', () => {
    useLocale('de', { justNow: 'gerade eben' });
    expect(relativeTime(NOW, NOW)).toBe('gerade eben');
    expect(relativeTime(hours(3), NOW)).toBe('vor 3 Stunden');
  });
});

describe('splitAroundSlots', () => {
  it('puts each child element where its marker is, in any order', () => {
    const [first, second] = slotMarkers(2);
    expect(splitAroundSlots(`Run ${second} then ${first}.`, 2)).toEqual(['Run ', 1, ' then ', 0, '.']);
    expect(splitAroundSlots(`${first}`, 1)).toEqual([0]);
    expect(splitAroundSlots('No children', 0)).toEqual(['No children']);
  });
});
