import { DEFAULT_PORT, type AgentInfo } from '@agent-browser-bridge/protocol';
import { Analytics, ANALYTICS_ENABLED_KEY, isPageEvent, type Properties } from './analytics.ts';
import { BridgeClient } from './bridgeClient.ts';
import { listenForDetach } from './debugger.ts';
import { dispatch } from './handlers.ts';
import { UsageTracker } from './usage.ts';

const WELCOME_PAGE = 'src/welcome/index.html';
const RECONNECT_ALARM = 'agent-browser-bridge-reconnect';

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
});

const trackedDispatch = async (method: string, params: unknown, agent: AgentInfo | null) => {
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

const client = new BridgeClient(
  `ws://127.0.0.1:${DEFAULT_PORT}`,
  trackedDispatch,
  (status) => {
    usage.setConnected(status.state === 'connected');
    if (status.state === 'connected') void usage.milestone('first_connected');
    void chrome.action.setBadgeText({ text: status.state === 'connected' ? 'on' : '' });
    void chrome.action.setBadgeBackgroundColor({ color: '#16a34a' });
    chrome.runtime.sendMessage({ type: 'STATUS_CHANGED', status }).catch(() => {
      /* no welcome page open */
    });
  },
);

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
  if (area === 'local' && ANALYTICS_ENABLED_KEY in changes) void syncUninstallSurvey();
});

listenForDetach();

const openWelcome = () => chrome.tabs.create({ url: chrome.runtime.getURL(WELCOME_PAGE) });

chrome.runtime.onInstalled.addListener(({ reason, previousVersion }) => {
  if (reason === chrome.runtime.OnInstalledReason.INSTALL) {
    void openWelcome();
    void usage.installed();
  } else if (reason === chrome.runtime.OnInstalledReason.UPDATE) {
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
  void usage.dailyActive();
});

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return false;
  if (message?.type === 'GET_STATUS') {
    respond(client.status);
  } else if (message?.type === 'RECONNECT') {
    client.connect();
    respond(client.status);
  } else if (message?.type === 'TRACK' && isPageEvent(message.event)) {
    void analytics.capture(message.event, (message.properties ?? {}) as Properties);
  }
  return false;
});

client.connect();
void usage.dailyActive();
