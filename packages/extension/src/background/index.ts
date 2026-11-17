import { DEFAULT_PORT } from '@agent-browser-bridge/protocol';
import { BridgeClient, type ConnectionState } from './bridgeClient.ts';
import { dispatch } from './handlers.ts';

const WELCOME_PAGE = 'src/welcome/index.html';
const RECONNECT_ALARM = 'agent-browser-bridge-reconnect';

const showStatus = (state: ConnectionState) => {
  const icon = state === 'connected' ? 'connected' : 'disconnected';
  void chrome.action.setIcon({ path: { 16: `icons/${icon}-16.png`, 32: `icons/${icon}-32.png` } });
  void chrome.action.setTitle({
    title: state === 'connected' ? 'Agent Browser Bridge: agent connected' : 'Agent Browser Bridge: no agent connected',
  });
};

const client = new BridgeClient(`ws://127.0.0.1:${DEFAULT_PORT}`, dispatch, (status) => {
  showStatus(status.state);
  chrome.runtime.sendMessage({ type: 'STATUS_CHANGED', status }).catch(() => {
    /* no welcome page open */
  });
});

const openWelcome = () => chrome.tabs.create({ url: chrome.runtime.getURL(WELCOME_PAGE) });

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === chrome.runtime.OnInstalledReason.INSTALL) void openWelcome();
});

chrome.action.onClicked.addListener(() => void openWelcome());

// The service worker may be stopped while no agent is running; the alarm wakes it
// periodically so it notices when an MCP server appears.
chrome.alarms.create(RECONNECT_ALARM, { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RECONNECT_ALARM) client.connect();
});

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return false;
  if (message?.type === 'GET_STATUS') {
    respond(client.status);
  } else if (message?.type === 'RECONNECT') {
    client.connect();
    respond(client.status);
  }
  return false;
});

client.connect();
