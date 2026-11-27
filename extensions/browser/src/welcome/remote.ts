import { REMOTE_SERVER_NAME, remoteUrls } from '@agent-browser-bridge/protocol';
import type { ConnectionStatus } from '../background/bridgeClient.ts';
import {
  isValidAddress,
  isValidBrowserToken,
  loadRemoteSettings,
  readRemoteSettings,
  remoteAgentConfig,
  REMOTE_SETTINGS_KEY,
  setBrowserToken,
  setRemoteAddress,
  setRemoteEnabled,
  type RemoteSettings,
} from '../background/remote.ts';
import { t } from '../i18n/messages.ts';
import { renderSessionList } from '../settings/sessionList.ts';

export type RemoteState = 'connected' | 'connecting' | 'offline' | 'problem';

export interface RemoteStatusCopy {
  state: RemoteState;
  text: string;
}

export function describeRemoteStatus(settings: RemoteSettings, status: ConnectionStatus | null | undefined): RemoteStatusCopy {
  if (!isValidAddress(settings.address)) return { state: 'offline', text: t('remoteStatusNoAddress') };
  if (!isValidBrowserToken(settings.browserToken)) return { state: 'offline', text: t('remoteStatusNoToken') };
  if (status?.state === 'connected') return { state: 'connected', text: t('remoteStatusConnected') };
  if (status?.problem === 'untrusted') return { state: 'problem', text: t('remoteStatusUntrusted') };
  if (status?.problem === 'rejected') return { state: 'problem', text: t('remoteStatusRejected') };
  if (status?.state === 'connecting' || !status) return { state: 'connecting', text: t('remoteStatusConnecting') };
  return { state: 'offline', text: t('remoteStatusOffline') };
}

export const relayHost = (address: string) => {
  try {
    return remoteUrls(address).host;
  } catch {
    return address;
  }
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const showFieldError = (input: HTMLInputElement, error: HTMLElement, valid: boolean) => {
  error.hidden = valid;
  input.setAttribute('aria-invalid', String(!valid));
};

export function bindRemoteAccess(defaultAddress: string) {
  const storage = chrome.storage.local;
  const enabled = $<HTMLInputElement>('remote-enabled');
  const body = $('remote-body');
  const address = $<HTMLInputElement>('remote-address');
  const addressError = $('remote-address-error');
  const token = $<HTMLInputElement>('remote-browser-token');
  const tokenError = $('remote-browser-token-error');
  const statusBox = $('remote-status');
  const statusText = $('remote-status-text');
  const privacy = $('privacy');
  const privacyNote = $('remote-privacy');
  let settings = readRemoteSettings(undefined, defaultAddress);
  let status: ConnectionStatus | null = null;

  const renderStatus = () => {
    const copy = describeRemoteStatus(settings, status);
    statusBox.dataset.state = copy.state;
    statusText.textContent = copy.text;
    renderSessionList($('remote-agents'), status?.state === 'connected' ? status.agents : [], status?.instanceId);
  };

  const render = () => {
    enabled.checked = settings.enabled;
    body.hidden = !settings.enabled;
    if (document.activeElement !== address) address.value = settings.address;
    if (document.activeElement !== token) token.value = settings.browserToken;
    const mcpUrl = isValidAddress(settings.address) ? remoteUrls(settings.address).mcp : 'https://relay.example.com/mcp';
    const config = remoteAgentConfig(mcpUrl, REMOTE_SERVER_NAME);
    $('remote-claude-code').textContent = config.claudeCode;
    $('remote-json').textContent = config.json;
    const remoteOn = settings.enabled && isValidAddress(settings.address);
    privacy.classList.toggle('remote-on', remoteOn);
    privacyNote.hidden = !remoteOn;
    privacyNote.textContent = remoteOn ? t('remotePrivacy', relayHost(settings.address)) : '';
    renderStatus();
  };

  const show = (next: RemoteSettings) => {
    settings = next;
    render();
  };

  enabled.addEventListener('change', () => void setRemoteEnabled(storage, enabled.checked, defaultAddress).then(show));

  address.addEventListener('change', () => {
    const valid = !address.value.trim() || isValidAddress(address.value);
    showFieldError(address, addressError, valid);
    if (valid) void setRemoteAddress(storage, address.value, defaultAddress).then(show);
  });

  token.addEventListener('change', () => {
    const valid = !token.value.trim() || isValidBrowserToken(token.value.trim());
    showFieldError(token, tokenError, valid);
    if (valid) void setBrowserToken(storage, token.value, defaultAddress).then(show);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && REMOTE_SETTINGS_KEY in changes) show(readRemoteSettings(changes[REMOTE_SETTINGS_KEY].newValue, defaultAddress));
  });
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== 'REMOTE_STATUS_CHANGED') return;
    status = message.status;
    renderStatus();
  });

  const poll = () =>
    chrome.runtime.sendMessage({ type: 'GET_REMOTE_STATUS' }).then(
      (next: ConnectionStatus | null) => {
        status = next;
        renderStatus();
      },
      () => undefined,
    );

  void loadRemoteSettings(storage, defaultAddress).then((loaded) => {
    show(loaded);
    void poll();
  });
  setInterval(poll, 3000);
}
