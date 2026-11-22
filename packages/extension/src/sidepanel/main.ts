import type { AgentSession, ChatTab } from '@agent-browser-bridge/protocol';
import type { ConnectionStatus } from '../background/bridgeClient.ts';
import { CHAT_STORAGE_KEY, type Conversations } from '../background/chat.ts';
import { CHAT_PANEL_PORT, type ChatPanelMessage } from '../background/chatPanel.ts';
import { panelView, type MessageView } from './view.ts';
import { t } from '../i18n/messages.ts';
import { localizePage } from '../i18n/page.ts';

const REFRESH_MS = 5_000;
const RECONNECT_MS = 1_000;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

localizePage();

const title = $('title');
const picker = $<HTMLSelectElement>('conversation');
const status = $('status');
const empty = $('empty');
const list = $<HTMLOListElement>('messages');
const composer = $<HTMLFormElement>('composer');
const input = $<HTMLTextAreaElement>('input');
const hint = $('composer-hint');
const endButton = $<HTMLButtonElement>('end');
const removeButton = $<HTMLButtonElement>('remove');
const sendButton = $<HTMLButtonElement>('send');
const errorText = $('error');

let conversations: Conversations = {};
let agents: AgentSession[] = [];
let chosen: string | undefined;
let selected: string | undefined;
let sending = false;
let renderedMessages = '';

async function post(message: ChatPanelMessage) {
  const answer = (await chrome.runtime.sendMessage(message)) as { ok: boolean; error?: string } | undefined;
  if (answer && !answer.ok) throw new Error(answer.error ?? t('chatError'));
}

function showError(error: unknown) {
  errorText.textContent = error instanceof Error ? error.message : String(error);
  errorText.hidden = false;
}

function renderMessages(messages: MessageView[]) {
  const signature = JSON.stringify(messages);
  if (signature === renderedMessages) return;
  renderedMessages = signature;
  const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
  list.replaceChildren(
    ...messages.map((message) => {
      const item = document.createElement('li');
      item.className = `message from-${message.from}`;
      const text = document.createElement('div');
      text.className = 'text';
      text.textContent = message.text;
      const meta = document.createElement('span');
      meta.className = 'meta';
      meta.textContent = message.meta;
      item.append(text, meta);
      return item;
    }),
  );
  if (atBottom || messages.at(-1)?.from === 'user') list.scrollTop = list.scrollHeight;
}

function render() {
  const view = panelView(conversations, agents, Date.now(), chosen);
  selected = view.selected;
  document.body.dataset.state = view.state ?? 'none';
  title.textContent = view.title;
  title.title = view.title;
  picker.hidden = view.options.length < 2;
  picker.replaceChildren(
    ...view.options.map((option) => {
      const element = document.createElement('option');
      element.value = option.key;
      element.textContent = option.label;
      element.selected = option.key === view.selected;
      return element;
    }),
  );
  status.textContent = view.status;
  empty.hidden = view.selected !== undefined;
  list.hidden = view.selected === undefined;
  composer.hidden = view.selected === undefined;
  renderMessages(view.messages);
  input.disabled = !view.canSend;
  sendButton.disabled = !view.canSend || sending;
  hint.textContent = view.composerHint;
  endButton.hidden = !view.canEnd;
  removeButton.hidden = !view.canRemove;
  markSeen();
}

function markSeen() {
  if (selected === undefined || document.visibilityState !== 'visible') return;
  const conversation = conversations[selected];
  const latestAgent = conversation?.messages.filter((message) => message.from === 'agent').at(-1)?.seq ?? 0;
  if (!conversation || latestAgent <= conversation.seenByUser) return;
  void post({ type: 'CHAT_SEEN', key: selected }).catch(() => undefined);
}

async function currentTab(): Promise<ChatTab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []);
  return tab?.url ? { title: tab.title ?? '', url: tab.url } : undefined;
}

async function send() {
  const text = input.value.trim();
  if (!text || selected === undefined || sending) return;
  sending = true;
  errorText.hidden = true;
  render();
  try {
    const tab = await currentTab();
    await post({ type: 'CHAT_POST', key: selected, text, ...(tab && { tab }) });
    input.value = '';
  } catch (error) {
    showError(error);
  } finally {
    sending = false;
    render();
    input.focus();
  }
}

function connectPort() {
  const port = chrome.runtime.connect({ name: CHAT_PANEL_PORT });
  port.onDisconnect.addListener(() => setTimeout(connectPort, RECONNECT_MS));
}

composer.addEventListener('submit', (event) => {
  event.preventDefault();
  void send();
});

input.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
  event.preventDefault();
  void send();
});

picker.addEventListener('change', () => {
  chosen = picker.value;
  renderedMessages = '';
  render();
});

endButton.addEventListener('click', () => {
  if (selected === undefined) return;
  void post({ type: 'CHAT_END', key: selected }).catch(showError);
});

removeButton.addEventListener('click', () => {
  if (selected === undefined) return;
  const removing = selected;
  chosen = undefined;
  void post({ type: 'CHAT_REMOVE', key: removing }).catch(showError);
});

document.addEventListener('visibilitychange', markSeen);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'session' || !(CHAT_STORAGE_KEY in changes)) return;
  conversations = (changes[CHAT_STORAGE_KEY].newValue ?? {}) as Conversations;
  render();
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== 'STATUS_CHANGED') return;
  agents = (message.status as ConnectionStatus).agents;
  render();
});

connectPort();
setInterval(render, REFRESH_MS);
void Promise.all([
  chrome.storage.session.get(CHAT_STORAGE_KEY).then((items) => {
    conversations = (items[CHAT_STORAGE_KEY] ?? {}) as Conversations;
  }),
  chrome.runtime.sendMessage({ type: 'GET_STATUS' }).then((current: ConnectionStatus | undefined) => {
    agents = current?.agents ?? [];
  }),
])
  .catch(() => undefined)
  .finally(render);
