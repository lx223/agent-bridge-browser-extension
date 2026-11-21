import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentInfo, AgentSession } from '@agent-browser-bridge/protocol';
import { CHAT_PANEL_PORT, ChatPanel } from './chatPanel.ts';

type Listener<T extends unknown[]> = (...args: T) => void;

interface FakePort {
  name: string;
  onDisconnect: { addListener: (listener: Listener<[]>) => void };
  disconnect: () => void;
}

function installChrome() {
  const items: Record<string, unknown> = {};
  const connectListeners: Listener<[FakePort]>[] = [];
  const clickListeners: Listener<[string]>[] = [];
  const fake = {
    storage: {
      session: {
        get: async (key: string) => (key in items ? { [key]: structuredClone(items[key]) } : {}),
        set: async (next: Record<string, unknown>) => void Object.assign(items, structuredClone(next)),
      },
    },
    runtime: {
      getURL: (path: string) => `chrome-extension://test/${path}`,
      onConnect: { addListener: (listener: Listener<[FakePort]>) => connectListeners.push(listener) },
    },
    action: {
      setBadgeText: vi.fn(async () => undefined),
      setBadgeBackgroundColor: vi.fn(async () => undefined),
    },
    sidePanel: {
      setPanelBehavior: vi.fn(async () => undefined),
      open: vi.fn(async () => undefined),
    },
    notifications: {
      create: vi.fn(async () => 'id'),
      clear: vi.fn(async () => true),
      onClicked: { addListener: (listener: Listener<[string]>) => clickListeners.push(listener) },
    },
    windows: {
      getLastFocused: vi.fn(async () => ({ id: 7 })),
      update: vi.fn(async () => ({})),
    },
  };
  vi.stubGlobal('chrome', fake);
  const openPanel = () => {
    const disconnects: Listener<[]>[] = [];
    const port: FakePort = {
      name: CHAT_PANEL_PORT,
      onDisconnect: { addListener: (listener) => disconnects.push(listener) },
      disconnect: () => disconnects.forEach((listener) => listener()),
    };
    connectListeners.forEach((listener) => listener(port));
    return port;
  };
  const clickNotification = (id: string) => clickListeners.forEach((listener) => listener(id));
  return { fake, openPanel, clickNotification };
}

const agent = (sessionId: string): AgentInfo => ({ serverVersion: '1.0.0', client: { name: 'claude-code', version: '2.0.0' }, sessionId });
const session = (sessionId: string): AgentSession => agent(sessionId);
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('ChatPanel', () => {
  let chrome: ReturnType<typeof installChrome>;

  beforeEach(() => {
    chrome = installChrome();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('badges unseen agent messages and clears the badge once seen', async () => {
    const panel = new ChatPanel();
    await panel.store.agentSays(agent('a'), 'What next?');
    expect(chrome.fake.action.setBadgeText).toHaveBeenLastCalledWith({ text: '1' });
    await panel.handle({ type: 'CHAT_SEEN', sessionId: 'a' });
    expect(chrome.fake.action.setBadgeText).toHaveBeenLastCalledWith({ text: '' });
  });

  it('opens the panel from the toolbar only while a connected agent has an open chat', async () => {
    const panel = new ChatPanel();
    await panel.store.agentSays(agent('a'), 'What next?');
    expect(chrome.fake.sidePanel.setPanelBehavior).toHaveBeenLastCalledWith({ openPanelOnActionClick: false });
    panel.agentsChanged([session('a')]);
    expect(chrome.fake.sidePanel.setPanelBehavior).toHaveBeenLastCalledWith({ openPanelOnActionClick: true });
    await panel.handle({ type: 'CHAT_END', sessionId: 'a' });
    expect(chrome.fake.sidePanel.setPanelBehavior).toHaveBeenLastCalledWith({ openPanelOnActionClick: false });
  });

  it('notifies about agent messages only while no chat panel is open', async () => {
    const panel = new ChatPanel();
    await panel.store.agentSays(agent('a'), 'x'.repeat(300));
    expect(chrome.fake.notifications.create).toHaveBeenCalledTimes(1);
    expect(chrome.fake.notifications.create).toHaveBeenCalledWith(
      'agent-browser-bridge-chat',
      expect.objectContaining({ title: 'claude-code 2.0.0', message: `${'x'.repeat(199)}…` }),
    );
    const port = chrome.openPanel();
    await panel.store.agentSays(agent('a'), 'Still there?');
    expect(chrome.fake.notifications.create).toHaveBeenCalledTimes(1);
    port.disconnect();
    await panel.store.agentSays(agent('a'), 'Hello?');
    expect(chrome.fake.notifications.create).toHaveBeenCalledTimes(2);
  });

  it('opens the side panel when the notification is clicked, or focuses the window if Chrome refuses', async () => {
    new ChatPanel();
    chrome.clickNotification('agent-browser-bridge-chat');
    await settle();
    expect(chrome.fake.sidePanel.open).toHaveBeenCalledWith({ windowId: 7 });
    chrome.fake.sidePanel.open.mockRejectedValueOnce(new Error('sidePanel.open() may only be called in response to a user gesture.'));
    chrome.clickNotification('agent-browser-bridge-chat');
    await settle();
    await settle();
    expect(chrome.fake.windows.update).toHaveBeenCalledWith(7, { focused: true });
    chrome.clickNotification('other');
    expect(chrome.fake.sidePanel.open).toHaveBeenCalledTimes(2);
  });

  it('accepts only well-formed panel messages', async () => {
    const panel = new ChatPanel();
    expect(panel.handles({ type: 'CHAT_POST', sessionId: 'a', text: 'hi' })).toBe(true);
    expect(panel.handles({ type: 'CHAT_POST', sessionId: '', text: 'hi' })).toBe(false);
    expect(panel.handles({ type: 'GET_STATUS' })).toBe(false);
    await panel.store.agentSays(agent('a'), 'What next?');
    await panel.handle({ type: 'CHAT_POST', sessionId: 'a', text: 'Group my tabs' });
    await panel.handle({ type: 'CHAT_REMOVE', sessionId: 'a' });
    expect(await panel.store.conversations()).toEqual({});
  });
});
