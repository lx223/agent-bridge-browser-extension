import { describe, expect, it } from 'vitest';
import { newRemoteToken } from '@agent-browser-bridge/protocol';
import type { ConnectionStatus } from '../background/bridgeClient.ts';
import type { RemoteSettings } from '../background/remote.ts';
import { describeRemoteStatus, relayHost } from './remote.ts';

const TOKEN = newRemoteToken();
const settings = (address: string, browserToken = TOKEN): RemoteSettings => ({ enabled: true, address, browserToken });
const status = (state: ConnectionStatus['state'], problem?: ConnectionStatus['problem']): ConnectionStatus => ({
  state,
  url: 'wss://relay.example.com/extension',
  since: 0,
  agents: [],
  ...(problem && { problem }),
});

describe('describeRemoteStatus', () => {
  it('asks for an address, then a token', () => {
    expect(describeRemoteStatus(settings(''), null)).toEqual({ state: 'offline', text: 'Enter the relay address to connect.' });
    expect(describeRemoteStatus(settings('http://relay.example.com'), status('connected')).state).toBe('offline');
    expect(describeRemoteStatus(settings('https://relay.example.com', ''), null)).toEqual({ state: 'offline', text: 'Enter the browser token to connect.' });
  });

  it('follows the relay connection', () => {
    const relay = settings('https://relay.example.com');
    expect(describeRemoteStatus(relay, null)).toEqual({ state: 'connecting', text: 'Connecting to the relay…' });
    expect(describeRemoteStatus(relay, status('connecting')).state).toBe('connecting');
    expect(describeRemoteStatus(relay, status('connected'))).toEqual({ state: 'connected', text: 'Connected to the relay' });
    expect(describeRemoteStatus(relay, status('disconnected'))).toEqual({ state: 'offline', text: "Can't reach the relay. Retrying…" });
  });

  it('explains a rejected token and a relay that cannot prove the token, even while retrying', () => {
    const relay = settings('https://relay.example.com');
    expect(describeRemoteStatus(relay, status('disconnected', 'rejected')).text).toMatch(/didn't accept this browser token/);
    expect(describeRemoteStatus(relay, status('connecting', 'rejected')).state).toBe('problem');
    expect(describeRemoteStatus(relay, status('connecting', 'untrusted'))).toEqual({
      state: 'problem',
      text: "This relay couldn't prove it knows the browser token. Check the address: it may not be your relay.",
    });
  });
});

describe('relayHost', () => {
  it('shows the host of the relay', () => {
    expect(relayHost('https://Relay.Example.com/base/')).toBe('relay.example.com');
    expect(relayHost('http://localhost:8080')).toBe('localhost:8080');
    expect(relayHost('not a url')).toBe('not a url');
  });
});
