import { DEFAULT_PORT, isAskMethod, isChatMethod, type AgentInfo } from '@agent-browser-bridge/protocol';
import { Analytics, ANALYTICS_ENABLED_KEY, isPageEvent, type Properties } from './analytics.ts';
import { sessionTitle } from '../settings/sessionList.ts';
import { AskManager, chromeAskNotifier, debuggerPrompt, scriptingPrompt, type PagePrompt } from './ask.ts';
import { t } from '../i18n/messages.ts';
import { BridgeClient, type ConnectionStatus } from './bridgeClient.ts';
import { ChatPanel } from './chatPanel.ts';
import { restoreAfterReload, saveForReload } from './carryOver.ts';
import { INSTANCE_NAME_KEY } from './browser.ts';
import { listenForDetach, send } from './debugger.ts';
import { listenForPageToolEvents } from './pageTools.ts';
import { applyUpdatesWhenIdle } from './update.ts';
import { dispatch } from './handlers.ts';
import { UsageTracker } from './usage.ts';
import { loadRemoteSettings, readRemoteSettings, RemoteConnection, REMOTE_SETTINGS_KEY } from './remote.ts';

const WELCOME_PAGE = 'src/welcome/index.html';
const RECONNECT_ALARM = 'agent-browser-bridge-reconnect';
const BRIDGE_PORT = Number(import.meta.env.VITE_BRIDGE_PORT || DEFAULT_PORT);
const DEFAULT_RELAY = import.meta.env.VITE_RELAY_URL ?? '';

const statusTitle = ({ state, agents }: ConnectionStatus) => {
  if (state !== 'connected') return t('actionTitleDisconnected');
  if (!agents.length) return t('actionTitleConnected');
  return t('actionTitleConnectedTo', agents.map(sessionTitle).join(', '));
};

const showStatus = (status: ConnectionStatus) => {
  const icon = status.state === 'connected' ? 'connected' : 'disconnected';
  void chrome.action.setIcon({ path: { 16: `icons/${icon}-16.png`, 32: `icons/${icon}-32.png` } });
  void chrome.action.setTitle({ title: statusTitle(status) });
};

const analytics = new Analytics({
  apiKey: import.meta.env.VITE_POSTHOG_KEY,
  host: import.meta.env.VITE_POSTHOG_HOST ?? 'https://eu.i.posthog.com',
  version: chrome.runtime.getManifest().version,
  storage: chrome.storage.local,
  fetch: (...args) => fetch(...args),
});

const usage = new UsageTracker({
  analytics,
  storage: chrome.storage.local,
  countBrowser: async () => {
    const windows = await chrome.windows.getAll({ populate: true });
    return { windows: windows.length, tabs: windows.reduce((sum, w) => sum + (w.tabs?.length ?? 0), 0) };
  },
  installType: async () => (await chrome.management.getSelf()).installType,
});

const carriedOver = restoreAfterReload(chrome.storage.session, chrome.storage.local).catch(() => undefined);

const chatPanel = chrome.sidePanel ? new ChatPanel(carriedOver) : undefined;

const pagePrompt = (): PagePrompt | undefined => {
  const extension = chrome as Partial<typeof chrome>;
  if (extension.debugger) return debuggerPrompt(send);
  if (extension.scripting) return scriptingPrompt(extension.scripting);
  return undefined;
};

const notifications = (chrome as Partial<typeof chrome>).notifications;
const asks: AskManager = new AskManager({
  prompt: pagePrompt(),
  tabs: chrome.tabs,
  focusWindow: (windowId) => chrome.windows.update(windowId, { focused: true }),
  ...(notifications && { notifier: chromeAskNotifier(notifications, (askId) => void asks.reveal(askId)) }),
});
chrome.tabs.onRemoved.addListener((tabId) => asks.tabClosed(tabId));

const trackedDispatch = async (method: string, params: unknown, agent: AgentInfo | null) => {
  await carriedOver;
  if (isAskMethod(method)) return asks.dispatch(method, params, agent);
  if (isChatMethod(method)) {
    if (!chatPanel) throw new Error('This browser has no chat panel yet. Continue in your own window.');
    return chatPanel.store.dispatch(method, params, agent);
  }
  const started = Date.now();
  try {
    const result = await dispatch(method, params);
    void usage.toolCalled({ method, params, agent, result, durationMs: Date.now() - started });
    return result;
  } catch (error) {
    void usage.toolCalled({ method, params, agent, error, durationMs: Date.now() - started });
    throw error;
  }
};

const combinedStatus = (): ConnectionStatus => {
  const local = client.status;
  const remoteStatus = remote.status;
  if (!remoteStatus) return local;
  const connected = local.state === 'connected' || remoteStatus.state === 'connected';
  return { ...local, state: connected ? 'connected' : local.state, agents: [...local.agents, ...remoteStatus.agents] };
};

const statusChanged = () => {
  const status = combinedStatus();
  usage.setConnected(status.state === 'connected');
  chatPanel?.agentsChanged(status.agents);
  if (status.state === 'connected') void usage.milestone('first_connected');
  showStatus(status);
};

const client: BridgeClient = new BridgeClient(`ws://127.0.0.1:${BRIDGE_PORT}`, trackedDispatch, (status) => {
  statusChanged();
  chrome.runtime.sendMessage({ type: 'STATUS_CHANGED', status }).catch(() => undefined);
});

const remote: RemoteConnection = new RemoteConnection(trackedDispatch, (status) => {
  statusChanged();
  chrome.runtime.sendMessage({ type: 'REMOTE_STATUS_CHANGED', status: status ?? null }).catch(() => undefined);
});

void loadRemoteSettings(chrome.storage.local, DEFAULT_RELAY).then((settings) => remote.apply(settings));

const syncUninstallSurvey = async () => {
  const survey = import.meta.env.VITE_UNINSTALL_SURVEY_URL;
  if (!survey) return;
  if (!(await analytics.isEnabled())) return chrome.runtime.setUninstallURL('');
  const url = new URL(survey);
  url.searchParams.set('distinct_id', await analytics.distinctId());
  await chrome.runtime.setUninstallURL(url.toString());
};
void syncUninstallSurvey();
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (ANALYTICS_ENABLED_KEY in changes) void syncUninstallSurvey();
  if (INSTANCE_NAME_KEY in changes) {
    client.reintroduce();
    remote.reintroduce();
  }
  if (REMOTE_SETTINGS_KEY in changes) remote.apply(readRemoteSettings(changes[REMOTE_SETTINGS_KEY].newValue, DEFAULT_RELAY));
});

listenForDetach();
listenForPageToolEvents();

const openWelcome = () => chrome.tabs.create({ url: chrome.runtime.getURL(WELCOME_PAGE) });

const clients = {
  whenIdle: async () => void (await Promise.all([client.whenIdle(), remote.whenIdle()])),
  announceReload: async () => void (await Promise.all([client.announceReload(), remote.announceReload()])),
};

applyUpdatesWhenIdle(chrome.runtime, clients, {
  beforeReload: () => saveForReload(chrome.storage.session, chrome.storage.local),
});

chrome.runtime.onInstalled.addListener(({ reason, previousVersion }) => {
  if (reason === 'install') {
    void openWelcome();
    void usage.installed();
  } else if (reason === 'update') {
    void analytics.capture('extension_updated', { previous_version: previousVersion ?? null });
  }
});

chrome.action.onClicked.addListener(() => {
  void openWelcome();
  void analytics.capture('setup_page_opened');
});

// The service worker may be stopped while no agent is running; the alarm wakes it
// periodically so it notices when an MCP server appears.
chrome.alarms.create(RECONNECT_ALARM, { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== RECONNECT_ALARM) return;
  client.connect();
  remote.connect();
  void usage.dailyActive();
});

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return false;
  if (chatPanel?.handles(message)) {
    chatPanel.handle(message).then(
      () => respond({ ok: true }),
      (error: unknown) => respond({ ok: false, error: error instanceof Error ? error.message : String(error) }),
    );
    return true;
  }
  if (message?.type === 'GET_STATUS') {
    respond(client.status);
  } else if (message?.type === 'RECONNECT') {
    client.connect();
    remote.connect();
    respond(client.status);
  } else if (message?.type === 'GET_REMOTE_STATUS') {
    respond(remote.status ?? null);
  } else if (message?.type === 'TRACK' && isPageEvent(message.event)) {
    void analytics.capture(message.event, (message.properties ?? {}) as Properties);
  }
  return false;
});

client.connect();
void usage.dailyActive();
