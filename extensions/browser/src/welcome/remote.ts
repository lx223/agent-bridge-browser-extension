import { REMOTE_SERVER_NAME, remoteUrls } from '@agent-browser-bridge/protocol';
import type { ConnectionStatus } from '../background/bridgeClient.ts';
import {
  createRemoteToken,
  isValidAddress,
  loadRemoteSettings,
  readRemoteSettings,
  remoteAgentConfig,
  REMOTE_SETTINGS_KEY,
  revokeRemoteToken,
  setRemoteAddress,
  setRemoteEnabled,
  type RemoteSettings,
  type RemoteToken,
} from '../background/remote.ts';
import { relativeTime, t } from '../i18n/messages.ts';
import { renderSessionList } from '../settings/sessionList.ts';

export type RemoteState = 'connected' | 'connecting' | 'offline';

export interface RemoteStatusCopy {
  state: RemoteState;
  text: string;
}

export function describeRemoteStatus(settings: RemoteSettings, status: ConnectionStatus | null | undefined): RemoteStatusCopy {
  if (!isValidAddress(settings.address)) return { state: 'offline', text: t('remoteStatusNoAddress') };
  if (status?.state === 'connected') return { state: 'connected', text: t('remoteStatusConnected') };
  if (status?.state === 'connecting' || !status) return { state: 'connecting', text: t('remoteStatusConnecting') };
  return { state: 'offline', text: t('remoteStatusOffline') };
}

export const relayHost = (address: string) => {
  try {
    return new URL(remoteUrls(address).base).host;
  } catch {
    return address;
  }
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function renderToken(token: RemoteToken, onRevoke: (id: string) => void, now: number): HTMLLIElement {
  const item = document.createElement('li');
  item.className = 'token';
  const text = document.createElement('div');
  const name = document.createElement('strong');
  name.textContent = token.name;
  const created = document.createElement('span');
  created.className = 'hint';
  created.textContent = t('remoteTokenCreatedAt', relativeTime(token.createdAt, now));
  text.append(name, created);
  const revoke = document.createElement('button');
  revoke.type = 'button';
  revoke.className = 'secondary';
  revoke.textContent = t('remoteRevoke');
  revoke.addEventListener('click', () => onRevoke(token.id));
  item.append(text, revoke);
  return item;
}

export function bindRemoteAccess(defaultAddress: string) {
  const storage = chrome.storage.local;
  const enabled = $<HTMLInputElement>('remote-enabled');
  const body = $('remote-body');
  const address = $<HTMLInputElement>('remote-address');
  const addressError = $('remote-address-error');
  const statusBox = $('remote-status');
  const statusText = $('remote-status-text');
  const tokens = $('remote-tokens');
  const noTokens = $('remote-no-tokens');
  const form = $<HTMLFormElement>('remote-new-token');
  const tokenName = $<HTMLInputElement>('remote-token-name');
  const created = $('remote-created');
  const privacy = $('privacy');
  const privacyNote = $('remote-privacy');
  let settings = readRemoteSettings(undefined, defaultAddress);
  let status: ConnectionStatus | null = null;

  const renderStatus = () => {
    const copy = describeRemoteStatus(settings, status);
    statusBox.dataset.state = copy.state;
    statusText.textContent = copy.text;
    renderSessionList($('remote-agents'), status?.agents ?? [], status?.instanceId);
  };

  const render = () => {
    enabled.checked = settings.enabled;
    body.hidden = !settings.enabled;
    if (document.activeElement !== address) address.value = settings.address;
    tokens.replaceChildren(...settings.tokens.map((token) => renderToken(token, (id) => void revokeRemoteToken(storage, id, defaultAddress), Date.now())));
    noTokens.hidden = settings.tokens.length > 0;
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

  enabled.addEventListener('change', () => {
    created.hidden = true;
    void setRemoteEnabled(storage, enabled.checked, defaultAddress).then(show);
  });

  address.addEventListener('change', () => {
    const valid = !address.value.trim() || isValidAddress(address.value);
    addressError.hidden = valid;
    address.setAttribute('aria-invalid', String(!valid));
    if (valid) void setRemoteAddress(storage, address.value, defaultAddress).then(show);
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const name = tokenName.value.trim();
    if (!name) return;
    void createRemoteToken(storage, name, Date.now(), defaultAddress).then(({ token, settings: next }) => {
      tokenName.value = '';
      const mcpUrl = isValidAddress(next.address) ? remoteUrls(next.address).mcp : 'https://relay.example.com/mcp';
      const config = remoteAgentConfig(mcpUrl, token, REMOTE_SERVER_NAME);
      $('remote-claude-code').textContent = config.claudeCode;
      $('remote-json').textContent = config.json;
      created.hidden = false;
      show(next);
    });
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
