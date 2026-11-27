import type english from '../../public/_locales/en/messages.json';

export type MessageKey = keyof typeof english;
export type PluralMessage = MessageKey extends infer Key ? (Key extends `${infer Base}_other` ? Base : never) : never;

type Substitution = string | number;

const lookup = (key: string, substitutions: Substitution[]) => chrome.i18n.getMessage(key, substitutions.map(String));

export const t = (key: MessageKey, ...substitutions: Substitution[]) => lookup(key, substitutions);

export const uiLocale = () => t('locale').replace('_', '-') || 'en';

const RIGHT_TO_LEFT = new Set(['ar', 'fa', 'he']);

export const textDirection = () => (RIGHT_TO_LEFT.has(uiLocale().split('-')[0]!) ? 'rtl' : 'ltr');

export function plural(base: PluralMessage, count: number, ...substitutions: Substitution[]) {
  const locale = uiLocale();
  const values = [count.toLocaleString(locale), ...substitutions];
  return lookup(`${base}_${new Intl.PluralRules(locale).select(count)}`, values) || lookup(`${base}_other`, values);
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function relativeTime(at: number, now: number): string {
  const elapsed = Math.max(0, now - at);
  if (elapsed < 45_000) return t('justNow');
  const format = new Intl.RelativeTimeFormat(uiLocale(), { numeric: 'auto' });
  if (elapsed < 90 * MINUTE) return format.format(-Math.max(1, Math.round(elapsed / MINUTE)), 'minute');
  if (elapsed < 36 * HOUR) return format.format(-Math.round(elapsed / HOUR), 'hour');
  return format.format(-Math.floor(elapsed / DAY), 'day');
}

export const clockTime = (at: number) => new Date(at).toLocaleTimeString(uiLocale(), { hour: '2-digit', minute: '2-digit' });

const SLOT = 0xe000;

export function splitAroundSlots(message: string, slots: number): (string | number)[] {
  const parts: (string | number)[] = [];
  let text = '';
  for (const character of message) {
    const slot = character.charCodeAt(0) - SLOT;
    if (slot >= 0 && slot < slots) {
      if (text) parts.push(text);
      parts.push(slot);
      text = '';
    } else {
      text += character;
    }
  }
  if (text) parts.push(text);
  return parts;
}

export const slotMarkers = (slots: number) => Array.from({ length: slots }, (_, index) => String.fromCharCode(SLOT + index));
