import type { ConnectionStatus } from '../background/bridgeClient.ts';
import { renderAgentList } from '../settings/agentList.ts';
import { analyticsAvailable, bindAnalyticsToggle } from '../settings/analyticsToggle.ts';
import { bindInstanceName } from '../settings/instanceName.ts';

const PRIVACY_URL = 'https://github.com/lx223/agent-bridge-browser-extension/blob/main/PRIVACY.md';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

$<HTMLAnchorElement>('privacy-link').href = PRIVACY_URL;
bindInstanceName($<HTMLInputElement>('instance-name'), $('instance-id'));

const STATUS_TEXT: Record<ConnectionStatus['state'], string> = {
  connected: 'Agent connected',
  connecting: 'Looking for your agent…',
  disconnected: 'No agent connected',
};

function render(status: ConnectionStatus | undefined) {
  const state = status?.state ?? 'disconnected';
  $('connection').dataset.state = state;
  $('status-text').textContent = STATUS_TEXT[state];
  renderAgentList($('agents'), status?.agents ?? []);
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'STATUS_CHANGED') render(message.status);
});
void chrome.runtime.sendMessage({ type: 'GET_STATUS' }).then(render, () => render(undefined));

if (analyticsAvailable) {
  bindAnalyticsToggle($<HTMLInputElement>('analytics-enabled'));
} else {
  $('analytics-setting').hidden = true;
  $('analytics-unavailable').hidden = false;
}
