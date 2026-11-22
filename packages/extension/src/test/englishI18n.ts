import english from '../../public/_locales/en/messages.json' with { type: 'json' };

const messages: Record<string, { message: string }> = english;

export const englishI18n = {
  getUILanguage: () => 'en',
  getMessage: (key: string, substitutions: string[] = []) => {
    const message = messages[key]?.message;
    if (message === undefined) return '';
    return message.replace(/\$(\$|[1-9])/g, (_, slot: string) => (slot === '$' ? '$' : (substitutions[Number(slot) - 1] ?? '')));
  },
};

const scope = globalThis as unknown as { chrome?: { i18n?: unknown } };
scope.chrome = { ...scope.chrome, i18n: englishI18n };
