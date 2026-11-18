import type { PageEvent, Properties } from '../background/analytics.ts';
import type { ConnectionStatus } from '../background/bridgeClient.ts';
import { renderAgentList } from '../settings/agentList.ts';
import { analyticsAvailable, bindAnalyticsToggle } from '../settings/analyticsToggle.ts';
import { claudeCodeCommand, cursorInstallUrl, LAUNCH_SPEC, mcpJsonConfig, vscodeInstallUrl } from './install.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

document.querySelectorAll('[data-pkg]').forEach((el) => (el.textContent = LAUNCH_SPEC));
$('claude-code-cmd').textContent = claudeCodeCommand;
$('json-config').textContent = mcpJsonConfig;
$<HTMLAnchorElement>('cursor-link').href = cursorInstallUrl();
$<HTMLAnchorElement>('vscode-link').href = vscodeInstallUrl();

const track = (event: PageEvent, properties: Properties) =>
  chrome.runtime.sendMessage({ type: 'TRACK', event, properties }).catch(() => undefined);

$('cursor-link').addEventListener('click', () => void track('setup_link_clicked', { agent: 'cursor' }));
$('vscode-link').addEventListener('click', () => void track('setup_link_clicked', { agent: 'vscode' }));

document.querySelectorAll<HTMLButtonElement>('button[data-copy]').forEach((button) => {
  button.addEventListener('click', async () => {
    void track('setup_snippet_copied', { snippet: button.dataset.copy! });
    await navigator.clipboard.writeText($(button.dataset.copy!).textContent ?? '');
    button.textContent = 'Copied';
    setTimeout(() => (button.textContent = 'Copy'), 1500);
  });
});

const STATUS_TEXT: Record<ConnectionStatus['state'], string> = {
  connected: 'Connected: your agent can use the browser.',
  connecting: 'Looking for your agent…',
  disconnected: 'Waiting for your agent. Set it up below, then start a session.',
};

function render(status: ConnectionStatus | undefined) {
  const state = status?.state ?? 'disconnected';
  $('status').dataset.state = state;
  $('status-text').textContent = STATUS_TEXT[state];
  renderAgentList($('agents'), status?.agents ?? []);
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'STATUS_CHANGED') render(message.status);
});

// Nudge the service worker to retry immediately while this page is open.
const poll = () => chrome.runtime.sendMessage({ type: 'RECONNECT' }).then(render, () => render(undefined));
void poll();
setInterval(poll, 3000);

if (analyticsAvailable) {
  bindAnalyticsToggle($<HTMLInputElement>('analytics-enabled'));
} else {
  $('analytics-setting').hidden = true;
}
