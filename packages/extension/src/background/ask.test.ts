import { describe, expect, it, vi } from 'vitest';
import { ASK_CANCEL_METHOD, ASK_SHOW_METHOD, ASK_WAIT_METHOD, type AgentInfo } from '@agent-browser-bridge/protocol';
import { AskManager, chromeAskNotifier, debuggerPrompt, scriptingPrompt, type AskNotifier, type AskTabs, type PagePrompt } from './ask.ts';
import type { PopoverAnswer, PopoverContent } from './popover.ts';
import '../test/englishI18n.ts';

const agent = { client: { name: 'claude-code', version: '2.0.0' } } as AgentInfo;

const tab = (id: number, extra: Partial<chrome.tabs.Tab> = {}) =>
  ({ id, windowId: 1, title: `Tab ${id}`, url: `https://example.com/${id}`, active: false, ...extra }) as chrome.tabs.Tab;

function fakePrompt() {
  const shown = new Map<string, { tabId: number; content: PopoverContent; answer: PopoverAnswer }>();
  const prompt: PagePrompt = {
    show: vi.fn(async (tabId: number, content: PopoverContent) => void shown.set(content.askId, { tabId, content, answer: 'pending' })),
    read: vi.fn(async (_tabId: number, askId: string) => shown.get(askId)?.answer ?? 'gone'),
    remove: vi.fn(async (_tabId: number, askId: string) => {
      const entry = shown.get(askId);
      shown.delete(askId);
      return entry !== undefined;
    }),
  };
  const answer = (askId: string, value: PopoverAnswer) => void (shown.get(askId)!.answer = value);
  return { prompt, shown, answer };
}

function setup({ open = [tab(1), tab(2, { active: true })] }: { open?: chrome.tabs.Tab[] } = {}) {
  const tabs = new Map(open.map((t) => [t.id!, t]));
  const fakeTabs: AskTabs = {
    get: vi.fn(async (tabId: number) => {
      const found = tabs.get(tabId);
      if (!found) throw new Error(`No tab with id: ${tabId}.`);
      return found;
    }),
    query: vi.fn(async () => [...tabs.values()].filter((t) => t.active)),
    update: vi.fn(async (tabId: number) => tabs.get(tabId)),
  };
  const notifier: AskNotifier = { show: vi.fn(), clear: vi.fn() };
  const focusWindow = vi.fn(async () => undefined);
  const page = fakePrompt();
  let ids = 0;
  const manager = new AskManager({ prompt: page.prompt, tabs: fakeTabs, notifier, focusWindow, pollMs: 1, newId: () => `ask-${++ids}` });
  return { manager, tabs, fakeTabs, notifier, focusWindow, page };
}

describe('AskManager', () => {
  it('brings the tab to the front, shows the question with the agent name and notifies', async () => {
    const { manager, fakeTabs, focusWindow, notifier, page } = setup();

    const shown = await manager.dispatch(ASK_SHOW_METHOD, { tabId: 1, title: 'Submit?', message: 'This sends the form.' }, agent);

    expect(shown).toEqual({ askId: 'ask-1', tab: { id: 1, title: 'Tab 1', url: 'https://example.com/1' } });
    expect(fakeTabs.update).toHaveBeenCalledWith(1, { active: true });
    expect(focusWindow).toHaveBeenCalledWith(1);
    expect(page.prompt.show).toHaveBeenCalledWith(1, {
      askId: 'ask-1',
      heading: 'claude-code asks',
      title: 'Submit?',
      message: 'This sends the form.',
      confirmLabel: 'Confirm',
      cancelLabel: 'Cancel',
      confirmedText: 'Confirmed. claude-code will go ahead.',
      cancelledText: 'Cancelled. claude-code will not go ahead.',
      dragHint: 'Drag to move',
      dir: 'ltr',
    });
    expect(notifier.show).toHaveBeenCalledWith('ask-1', 'claude-code', { title: 'Submit?', message: 'This sends the form.', url: 'https://example.com/1' });
  });

  it('asks in the active tab when no tab is given, and names an unknown agent plainly', async () => {
    const { manager, page } = setup();

    await manager.dispatch(ASK_SHOW_METHOD, { message: 'Go?' }, null);

    expect(page.prompt.show).toHaveBeenCalledWith(2, expect.objectContaining({ heading: 'Your agent asks', confirmedText: 'Confirmed. Your agent will go ahead.' }));
  });

  it('uses the button labels the agent chose', async () => {
    const { manager, page } = setup();

    await manager.dispatch(ASK_SHOW_METHOD, { tabId: 1, message: 'Pay?', confirmLabel: 'Pay £42', cancelLabel: 'Not now' }, agent);

    expect(page.prompt.show).toHaveBeenCalledWith(1, expect.objectContaining({ confirmLabel: 'Pay £42', cancelLabel: 'Not now' }));
  });

  it('waits until the user answers, then clears the notification', async () => {
    const { manager, notifier, page } = setup();
    await manager.dispatch(ASK_SHOW_METHOD, { tabId: 1, message: 'Go?' }, agent);

    expect(await manager.dispatch(ASK_WAIT_METHOD, { askId: 'ask-1', waitMs: 0 }, agent)).toEqual({ answer: 'pending' });
    setTimeout(() => page.answer('ask-1', 'confirmed'), 5);
    expect(await manager.dispatch(ASK_WAIT_METHOD, { askId: 'ask-1', waitMs: 1_000 }, agent)).toEqual({ answer: 'confirmed' });
    expect(notifier.clear).toHaveBeenCalledWith('ask-1');
    expect(await manager.dispatch(ASK_WAIT_METHOD, { askId: 'ask-1', waitMs: 0 }, agent)).toEqual({ answer: 'confirmed' });
  });

  it('reports navigated when the question disappears from an open tab', async () => {
    const { manager, page } = setup();
    await manager.dispatch(ASK_SHOW_METHOD, { tabId: 1, message: 'Go?' }, agent);
    page.shown.clear();

    expect(await manager.dispatch(ASK_WAIT_METHOD, { askId: 'ask-1', waitMs: 0 }, agent)).toEqual({ answer: 'navigated' });
  });

  it('reports tabClosed when the tab goes away', async () => {
    const { manager, tabs, page } = setup();
    await manager.dispatch(ASK_SHOW_METHOD, { tabId: 1, message: 'Go?' }, agent);
    tabs.delete(1);
    page.shown.clear();

    expect(await manager.dispatch(ASK_WAIT_METHOD, { askId: 'ask-1', waitMs: 0 }, agent)).toEqual({ answer: 'tabClosed' });
  });

  it('marks a question answered tabClosed as soon as the browser says the tab closed', async () => {
    const { manager } = setup();
    await manager.dispatch(ASK_SHOW_METHOD, { tabId: 1, message: 'Go?' }, agent);

    manager.tabClosed(1);

    expect(await manager.dispatch(ASK_WAIT_METHOD, { askId: 'ask-1', waitMs: 0 }, agent)).toEqual({ answer: 'tabClosed' });
  });

  it('cancels a question by removing it from the page', async () => {
    const { manager, notifier, page } = setup();
    await manager.dispatch(ASK_SHOW_METHOD, { tabId: 1, message: 'Go?' }, agent);

    expect(await manager.dispatch(ASK_CANCEL_METHOD, { askId: 'ask-1' }, agent)).toEqual({ removed: true });
    expect(page.prompt.remove).toHaveBeenCalledWith(1, 'ask-1');
    expect(notifier.clear).toHaveBeenCalledWith('ask-1');
    expect(await manager.dispatch(ASK_WAIT_METHOD, { askId: 'ask-1', waitMs: 0 }, agent)).toEqual({ answer: 'cancelled' });
    expect(await manager.dispatch(ASK_CANCEL_METHOD, { askId: 'ask-1' }, agent)).toEqual({ removed: false });
  });

  it('refuses a second question in a tab that is already asking', async () => {
    const { manager } = setup();
    await manager.dispatch(ASK_SHOW_METHOD, { tabId: 1, message: 'First' }, agent);

    await expect(manager.dispatch(ASK_SHOW_METHOD, { tabId: 1, message: 'Second' }, agent)).rejects.toThrow(/already showing a question/);
    await expect(manager.dispatch(ASK_SHOW_METHOD, { tabId: 2, message: 'Elsewhere' }, agent)).resolves.toMatchObject({ askId: 'ask-2' });
  });

  it('answers expired for a question it does not know, such as after a restart', async () => {
    const { manager } = setup();

    expect(await manager.dispatch(ASK_WAIT_METHOD, { askId: 'unknown', waitMs: 0 }, agent)).toEqual({ answer: 'expired' });
    expect(await manager.dispatch(ASK_CANCEL_METHOD, { askId: 'unknown' }, agent)).toEqual({ removed: false });
  });

  it('reveals the tab of a question when its notification is clicked', async () => {
    const { manager, fakeTabs, focusWindow } = setup();
    await manager.dispatch(ASK_SHOW_METHOD, { tabId: 1, message: 'Go?' }, agent);
    vi.mocked(fakeTabs.update).mockClear();
    focusWindow.mockClear();

    await manager.reveal('ask-1');

    expect(fakeTabs.update).toHaveBeenCalledWith(1, { active: true });
    expect(focusWindow).toHaveBeenCalledWith(1);
  });

  it('rejects invalid params and browsers that cannot show questions', async () => {
    const { manager } = setup();
    await expect(manager.dispatch(ASK_SHOW_METHOD, { message: '' }, agent)).rejects.toThrow(/Invalid params for ask.show/);

    const unsupported = new AskManager({ tabs: setup().fakeTabs });
    await expect(unsupported.dispatch(ASK_SHOW_METHOD, { message: 'Go?' }, agent)).rejects.toThrow(/cannot show questions/);
  });
});

const content: PopoverContent = {
  askId: 'ask-1',
  heading: 'claude-code asks',
  message: 'Go?',
  confirmLabel: 'Confirm',
  cancelLabel: 'Cancel',
  confirmedText: 'Confirmed. claude-code will go ahead.',
  cancelledText: 'Cancelled. claude-code will not go ahead.',
  dragHint: 'Drag to move',
  dir: 'ltr',
};

describe('debuggerPrompt', () => {
  function fakeDebugger(value: unknown = 'pending') {
    const send = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
      if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'main' } } };
      if (method === 'Page.createIsolatedWorld') return { executionContextId: 42 };
      if (method === 'Runtime.evaluate' && String(params?.expression).includes('readPopover') && value instanceof Error) throw value;
      return { result: { value } };
    });
    return send;
  }

  it('shows the popover in an isolated world and reads the answer from that same world', async () => {
    const send = fakeDebugger('confirmed');
    const prompt = debuggerPrompt(send as never);

    await prompt.show(5, content);
    expect(send).toHaveBeenCalledWith(5, 'Page.createIsolatedWorld', { frameId: 'main', worldName: 'agent-browser-bridge-ask' });
    const shownWith = send.mock.calls.find(([, method]) => method === 'Runtime.evaluate')![2]!;
    expect(shownWith).toMatchObject({ contextId: 42, returnByValue: true });
    expect(shownWith.expression).toContain(JSON.stringify(content));

    expect(await prompt.read(5, 'ask-1')).toBe('confirmed');
    expect(send).toHaveBeenLastCalledWith(5, 'Runtime.evaluate', expect.objectContaining({ contextId: 42 }));
  });

  it('treats a destroyed world as the question being gone', async () => {
    const prompt = debuggerPrompt(fakeDebugger(new Error('Cannot find context with specified id')) as never);
    await prompt.show(5, content);

    expect(await prompt.read(5, 'ask-1')).toBe('gone');
    expect(await prompt.read(5, 'other')).toBe('gone');
  });

  it('reports page errors and removes the popover only once', async () => {
    const send = vi.fn(async (_tabId: number, method: string) => {
      if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'main' } } };
      if (method === 'Page.createIsolatedWorld') return { executionContextId: 42 };
      return { result: { value: true } };
    });
    const prompt = debuggerPrompt(send as never);
    await prompt.show(5, content);

    expect(await prompt.remove(5, 'ask-1')).toBe(true);
    expect(await prompt.remove(5, 'ask-1')).toBe(false);

    send.mockResolvedValueOnce({ frameTree: { frame: { id: 'main' } } }).mockResolvedValueOnce({ executionContextId: 43 }).mockResolvedValueOnce({
      result: {},
      exceptionDetails: { text: 'Uncaught', exception: { description: 'TypeError: boom' } },
    } as never);
    await expect(prompt.show(5, content)).rejects.toThrow('TypeError: boom');
  });
});

describe('scriptingPrompt', () => {
  it('runs the popover functions in the tab and reads their results', async () => {
    const results: unknown[] = [undefined, 'cancelled', true];
    const executeScript = vi.fn(async () => [{ result: results.shift() }]);
    const prompt = scriptingPrompt({ executeScript } as unknown as typeof chrome.scripting);

    await prompt.show(9, content);
    expect(executeScript).toHaveBeenCalledWith({ target: { tabId: 9 }, func: expect.any(Function), args: [content] });
    expect(await prompt.read(9, 'ask-1')).toBe('cancelled');
    expect(await prompt.remove(9, 'ask-1')).toBe(true);
  });

  it('treats a page without the popover as gone', async () => {
    const prompt = scriptingPrompt({ executeScript: async () => [] } as unknown as typeof chrome.scripting);

    expect(await prompt.read(9, 'ask-1')).toBe('gone');
  });
});

describe('chromeAskNotifier', () => {
  it('keeps a notification up until the question is answered and reveals the tab when clicked', async () => {
    vi.stubGlobal('chrome', { ...globalThis.chrome, runtime: { getURL: (path: string) => `chrome-extension://id/${path}` } });
    let clicked: ((id: string) => void) | undefined;
    const notifications = {
      create: vi.fn(async () => 'id'),
      clear: vi.fn(async () => true),
      onClicked: { addListener: (listener: (id: string) => void) => (clicked = listener) },
    };
    const reveal = vi.fn();
    const notifier = chromeAskNotifier(notifications as unknown as typeof chrome.notifications, reveal);

    notifier.show('ask-1', 'claude-code', { title: 'Submit?', message: 'This sends the form.', url: 'https://shop.example/checkout' });
    expect(notifications.create).toHaveBeenCalledWith('agent-browser-bridge-ask:ask-1', {
      type: 'basic',
      iconUrl: 'chrome-extension://id/icons/icon-128.png',
      title: 'claude-code needs your answer',
      message: 'Submit?',
      contextMessage: 'shop.example',
      requireInteraction: true,
    });

    clicked?.('someone-else');
    expect(reveal).not.toHaveBeenCalled();
    clicked?.('agent-browser-bridge-ask:ask-1');
    expect(reveal).toHaveBeenCalledWith('ask-1');

    notifier.clear('ask-1');
    expect(notifications.clear).toHaveBeenLastCalledWith('agent-browser-bridge-ask:ask-1');
    vi.unstubAllGlobals();
  });
});
