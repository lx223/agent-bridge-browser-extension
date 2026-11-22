import { englishI18n } from './englishI18n.ts';

type Responder = (params: Record<string, unknown>) => unknown;

export function installFakeDebugger(responders: Record<string, Responder> = {}) {
  const commands: { method: string; params: Record<string, unknown> }[] = [];
  const attachedTabs = new Set<number>();
  const eventListeners = new Set<(source: { tabId: number }, method: string, params?: object) => void>();
  const emit = (tabId: number, method: string, params: object) => {
    for (const listener of eventListeners) listener({ tabId }, method, params);
  };
  const fake = {
    i18n: englishI18n,
    debugger: {
      onEvent: { addListener: (listener: (source: { tabId: number }, method: string, params?: object) => void) => eventListeners.add(listener) },
      attach: async ({ tabId }: { tabId: number }) => {
        if (attachedTabs.has(tabId)) throw new Error(`Another debugger is already attached to the tab with id: ${tabId}.`);
        attachedTabs.add(tabId);
      },
      detach: async ({ tabId }: { tabId: number }) => {
        if (!attachedTabs.delete(tabId)) throw new Error(`Debugger is not attached to the tab with id: ${tabId}.`);
      },
      sendCommand: async ({ tabId }: { tabId: number }, method: string, params: Record<string, unknown> = {}) => {
        if (!attachedTabs.has(tabId)) throw new Error(`Debugger is not attached to the tab with id: ${tabId}.`);
        commands.push({ method, params });
        const respond = responders[method];
        return respond ? respond(params) : {};
      },
    },
    tabs: {
      get: async (tabId: number) => ({ id: tabId, title: 'Example', url: 'https://example.com/' }),
    },
  };
  (globalThis as unknown as { chrome: unknown }).chrome = fake;
  return { commands, attachedTabs, emit };
}
