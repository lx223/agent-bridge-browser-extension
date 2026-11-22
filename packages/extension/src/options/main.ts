import type { ConnectionStatus } from '../background/bridgeClient.ts';
import { renderSessionList } from '../settings/sessionList.ts';
import { analyticsAvailable, bindAnalyticsToggle } from '../settings/analyticsToggle.ts';
import { bindInstanceName } from '../settings/instanceName.ts';
import { PRIVACY_URL } from '../settings/privacy.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

$<HTMLAnchorElement>('privacy-link').href = PRIVACY_URL;
bindInstanceName($<HTMLInputElement>('instance-name'), $('instance-id'));

const STATUS_TEXT: Record<ConnectionStatus['state'], string> = {
  connected: 'Agent connected',
  connecting: 'Looking for your agent…',
  disconnected: 'No agent connected',
};

let latest: ConnectionStatus | undefined;

function render(status: ConnectionStatus | undefined) {
  latest = status;
  const state = status?.state ?? 'disconnected';
  const sessions = status?.agents.length ?? 0;
  $('connection').dataset.state = state;
  $('status-text').textContent = state === 'connected' && sessions > 1 ? `${sessions} agent sessions connected` : STATUS_TEXT[state];
  renderSessionList($('agents'), status?.agents ?? [], status?.instanceId);
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'STATUS_CHANGED') render(message.status);
});
void chrome.runtime.sendMessage({ type: 'GET_STATUS' }).then(render, () => render(undefined));
setInterval(() => render(latest), 30_000);

if (analyticsAvailable) {
  bindAnalyticsToggle($<HTMLInputElement>('analytics-enabled'));
} else {
  $('analytics-setting').hidden = true;
  $('analytics-unavailable').hidden = false;
}
