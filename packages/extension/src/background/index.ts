import { DEFAULT_PORT } from '@agent-browser-bridge/protocol';
import { BridgeClient } from './bridgeClient.ts';
import { listenForDetach } from './debugger.ts';
import { dispatch } from './handlers.ts';

const WELCOME_PAGE = 'src/welcome/index.html';
const RECONNECT_ALARM = 'agent-browser-bridge-reconnect';

const client = new BridgeClient(`ws://127.0.0.1:${DEFAULT_PORT}`, dispatch, (status) => {
  void chrome.action.setBadgeText({ text: status.state === 'connected' ? 'on' : '' });
  void chrome.action.setBadgeBackgroundColor({ color: '#16a34a' });
  chrome.runtime.sendMessage({ type: 'STATUS_CHANGED', status }).catch(() => {
    /* no welcome page open */
  });
});

listenForDetach();

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
