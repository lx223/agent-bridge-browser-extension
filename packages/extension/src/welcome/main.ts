import type { PageEvent, Properties } from '../background/analytics.ts';
import type { ConnectionStatus } from '../background/bridgeClient.ts';
import { detectBrowser } from '../background/browser.ts';
import { renderSessionList } from '../settings/sessionList.ts';
import { analyticsAvailable, bindAnalyticsToggle } from '../settings/analyticsToggle.ts';
import { showContentFor } from '../settings/browserContent.ts';
import { bindInstanceName } from '../settings/instanceName.ts';
import { plural, t } from '../i18n/messages.ts';
import { localizePage } from '../i18n/page.ts';
import { agentSetupPrompt, claudeCodeCommand, claudeDesktopExtensionUrl, cursorInstallUrl, LAUNCH_SPEC, mcpJsonConfig, vscodeInstallUrl } from './install.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

localizePage();
showContentFor(detectBrowser(chrome.runtime.getURL('')), document.querySelectorAll<HTMLElement>('[data-browser]'));
document.querySelectorAll('[data-pkg]').forEach((el) => (el.textContent = LAUNCH_SPEC));
$('claude-code-cmd').textContent = claudeCodeCommand;
$('json-config').textContent = mcpJsonConfig;
$('agent-prompt').textContent = agentSetupPrompt;
$<HTMLAnchorElement>('cursor-link').href = cursorInstallUrl();
$<HTMLAnchorElement>('vscode-link').href = vscodeInstallUrl();
$<HTMLAnchorElement>('claude-desktop-link').href = claudeDesktopExtensionUrl;
bindInstanceName($<HTMLInputElement>('instance-name'), $('instance-id'));

const track = (event: PageEvent, properties: Properties) =>
  chrome.runtime.sendMessage({ type: 'TRACK', event, properties }).catch(() => undefined);

$('cursor-link').addEventListener('click', () => void track('setup_link_clicked', { agent: 'cursor' }));
$('vscode-link').addEventListener('click', () => void track('setup_link_clicked', { agent: 'vscode' }));
$('claude-desktop-link').addEventListener('click', () => void track('setup_link_clicked', { agent: 'claude_desktop' }));

document.querySelectorAll<HTMLButtonElement>('button[data-copy]').forEach((button) => {
  const label = button.textContent;
  button.addEventListener('click', async () => {
    void track('setup_snippet_copied', { snippet: button.dataset.copy! });
    await navigator.clipboard.writeText($(button.dataset.copy!).textContent ?? '');
    button.textContent = t('copied');
    setTimeout(() => (button.textContent = label), 1500);
  });
});

const STATUS_TEXT: Record<ConnectionStatus['state'], () => string> = {
  connected: () => t('welcomeConnected'),
  connecting: () => t('statusLooking'),
  disconnected: () => t('welcomeDisconnected'),
};

function render(status: ConnectionStatus | undefined) {
  const state = status?.state ?? 'disconnected';
  const sessions = status?.agents.length ?? 0;
  $('status').dataset.state = state;
  $('status-text').textContent =
    state === 'connected' && sessions > 1 ? plural('welcomeConnectedMany', sessions) : STATUS_TEXT[state]();
  renderSessionList($('agents'), status?.agents ?? [], status?.instanceId);
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
