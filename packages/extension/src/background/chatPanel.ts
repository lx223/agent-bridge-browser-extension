import { z } from 'zod';
import { chatTab, type AgentSession } from '@agent-browser-bridge/protocol';
import { t } from '../i18n/messages.ts';
import { ChatStore, totalUnseen, type ChatMessage, type Conversation, type Conversations } from './chat.ts';

export const CHAT_PANEL_PORT = 'chat-panel';
const NOTIFICATION_ID = 'agent-browser-bridge-chat';
const NOTIFICATION_ICON = 'icons/icon-128.png';
const NOTIFICATION_PREVIEW_LENGTH = 200;
const BADGE_COLOR = '#2563eb';

const key = z.string().min(1);

export const chatPanelMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('CHAT_POST'), key, text: z.string(), tab: chatTab.optional() }),
  z.object({ type: z.literal('CHAT_END'), key }),
  z.object({ type: z.literal('CHAT_REMOVE'), key }),
  z.object({ type: z.literal('CHAT_SEEN'), key }),
]);

export type ChatPanelMessage = z.infer<typeof chatPanelMessage>;

const sidePanel = () => (chrome as Partial<typeof chrome>).sidePanel;
const notifications = () => (chrome as Partial<typeof chrome>).notifications;

export class ChatPanel {
  readonly store: ChatStore;
  private openPanels = 0;

  constructor(ready?: Promise<void>) {
    this.store = new ChatStore(chrome.storage.session, {
      ready,
      onChange: (all) => this.reflect(all),
      onAgentMessage: (conversation, message) => this.announce(conversation, message),
    });
    chrome.runtime.onConnect.addListener((port) => {
      if (port.name !== CHAT_PANEL_PORT) return;
      this.openPanels++;
      notifications()?.clear(NOTIFICATION_ID).catch(() => undefined);
      port.onDisconnect.addListener(() => this.openPanels--);
    });
    notifications()?.onClicked.addListener((id) => {
      if (id !== NOTIFICATION_ID) return;
      void this.reveal();
      notifications()?.clear(id).catch(() => undefined);
    });
    void sidePanel()?.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);
    void this.store.conversations().then((all) => this.reflect(all));
  }

  agentsChanged(agents: AgentSession[]) {
    const liveSessions = new Set(agents.flatMap((agent) => (agent.sessionId === undefined ? [] : [agent.sessionId])));
    void this.store.sessionsChanged(liveSessions).catch(() => undefined);
  }

  handles(message: unknown): message is ChatPanelMessage {
    return chatPanelMessage.safeParse(message).success;
  }

  async handle(message: ChatPanelMessage): Promise<void> {
    switch (message.type) {
      case 'CHAT_POST':
        return this.store.userSays(message.key, message.text, message.tab);
      case 'CHAT_END':
        return this.store.end(message.key);
      case 'CHAT_REMOVE':
        return this.store.remove(message.key);
      case 'CHAT_SEEN':
        return this.store.markSeen(message.key);
    }
  }

  private reflect(all: Conversations) {
    const unseen = totalUnseen(all);
    void chrome.action.setBadgeText({ text: unseen ? String(Math.min(unseen, 99)) : '' }).catch(() => undefined);
    if (unseen) void chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR }).catch(() => undefined);
  }

  private announce(conversation: Conversation, message: ChatMessage) {
    const api = notifications();
    if (!api || this.openPanels > 0) return;
    const preview = message.text.length > NOTIFICATION_PREVIEW_LENGTH ? `${message.text.slice(0, NOTIFICATION_PREVIEW_LENGTH - 1)}…` : message.text;
    void api
      .create(NOTIFICATION_ID, {
        type: 'basic',
        iconUrl: chrome.runtime.getURL(NOTIFICATION_ICON),
        title: conversation.title,
        message: preview,
        contextMessage: t('notificationReply'),
      })
      .catch(() => undefined);
  }

  private async reveal() {
    const window = await chrome.windows.getLastFocused().catch(() => undefined);
    if (window?.id === undefined) return;
    try {
      await sidePanel()?.open({ windowId: window.id });
    } catch {
      await chrome.windows.update(window.id, { focused: true }).catch(() => undefined);
    }
  }
}
