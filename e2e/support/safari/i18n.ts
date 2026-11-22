import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export type Messages = Record<string, { message: string }>;

export const defaultLocaleMessages = (extensionDir: string): Messages =>
  JSON.parse(readFileSync(join(extensionDir, '_locales', 'en', 'messages.json'), 'utf-8'));

export function getMessage(messages: Messages, key: string, substitutions: string | string[] = []): string {
  if (key === '@@bidi_dir') return 'ltr';
  const values = Array.isArray(substitutions) ? substitutions : [substitutions];
  const message = messages[key]?.message ?? '';
  return message.replace(/\$(\$|[1-9])/g, (_, slot: string) => (slot === '$' ? '$' : (values[Number(slot) - 1] ?? '')));
}
