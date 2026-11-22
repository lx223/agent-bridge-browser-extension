import type { PageEvent, Properties } from '../background/analytics.ts';
import type { ConnectionStatus } from '../background/bridgeClient.ts';
import { detectBrowser } from '../background/browser.ts';
import { renderSessionList } from '../settings/sessionList.ts';
import { analyticsAvailable, bindAnalyticsToggle } from '../settings/analyticsToggle.ts';
import { showContentFor } from '../settings/browserContent.ts';
import { bindInstanceName } from '../settings/instanceName.ts';
import { PRIVACY_URL } from '../settings/privacy.ts';
import { AGENT_TAB_KEY, initialAgentTab, isAgentTab, tabAfterKey } from './agentTabs.ts';
import { agentSetupPrompt, claudeCodeCommand, claudeDesktopExtensionUrl, cursorInstallUrl, LAUNCH_SPEC, mcpJsonConfig, vscodeInstallUrl } from './install.ts';
import { profileInitial } from './profile.ts';
import { describeStatus } from './status.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

showContentFor(detectBrowser(chrome.runtime.getURL('')), document.querySelectorAll<HTMLElement>('[data-browser]'));
document.querySelectorAll('[data-pkg]').forEach((el) => (el.textContent = LAUNCH_SPEC));
$('claude-code-cmd').textContent = claudeCodeCommand;
$('json-config').textContent = mcpJsonConfig;
$('agent-prompt').textContent = agentSetupPrompt;
$<HTMLAnchorElement>('cursor-link').href = cursorInstallUrl();
$<HTMLAnchorElement>('vscode-link').href = vscodeInstallUrl();
$<HTMLAnchorElement>('claude-desktop-link').href = claudeDesktopExtensionUrl;
$<HTMLAnchorElement>('privacy-link').href = PRIVACY_URL;

const profileName = $<HTMLInputElement>('instance-name');
const showInitial = (name: string) => ($('profile-avatar').textContent = profileInitial(name));
bindInstanceName(profileName, $('instance-id'), showInitial);
profileName.addEventListener('input', () => showInitial(profileName.value));
const profileSaved = $('profile-saved');
let nameBeforeEdit = '';
let savedTimer: ReturnType<typeof setTimeout> | undefined;
profileName.addEventListener('focus', () => (nameBeforeEdit = profileName.value));
profileName.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    profileName.value = nameBeforeEdit;
    showInitial(nameBeforeEdit);
  }
  if (event.key === 'Enter' || event.key === 'Escape') profileName.blur();
});
profileName.addEventListener('change', () => {
  profileSaved.textContent = profileName.value ? 'Saved' : 'Name removed';
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => (profileSaved.textContent = ''), 2000);
});

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
    button.textContent = 'Copied';
    button.dataset.copied = 'true';
    setTimeout(() => {
      button.textContent = label;
      delete button.dataset.copied;
    }, 1500);
  });
});

const tabs = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')];

function selectTab(selected: HTMLButtonElement, focus = false) {
  for (const tab of tabs) {
    const active = tab === selected;
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
    $(tab.getAttribute('aria-controls')!).hidden = !active;
  }
  if (focus) selected.focus();
  if (isAgentTab(selected.dataset.agent)) localStorage.setItem(AGENT_TAB_KEY, selected.dataset.agent);
}

tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => selectTab(tab));
  tab.addEventListener('keydown', (event) => {
    const next = tabAfterKey(index, event.key, tabs.length);
    if (next === undefined) return;
    event.preventDefault();
    selectTab(tabs[next]!, true);
  });
});
const firstAgent = initialAgentTab(localStorage.getItem(AGENT_TAB_KEY));
selectTab(tabs.find((tab) => tab.dataset.agent === firstAgent) ?? tabs[0]!);

const setup = $<HTMLDetailsElement>('setup');
let setupPlaced = false;

function render(status: ConnectionStatus | undefined) {
  const state = status?.state ?? 'disconnected';
  const { headline, hint } = describeStatus(status);
  $('status').dataset.state = state;
  $('status-text').textContent = headline;
  $('status-hint').textContent = hint;
  setup.dataset.done = String(state === 'connected');
  renderSessionList($('agents'), status?.agents ?? [], status?.instanceId);
  if (status && state !== 'connecting' && !setupPlaced) {
    setupPlaced = true;
    setup.open = state !== 'connected';
  }
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'STATUS_CHANGED') render(message.status);
});

const poll = () => chrome.runtime.sendMessage({ type: 'RECONNECT' }).then(render, () => render(undefined));
void poll();
setInterval(poll, 3000);

if (analyticsAvailable) {
  bindAnalyticsToggle($<HTMLInputElement>('analytics-enabled'));
} else {
  $('analytics-setting').hidden = true;
}
