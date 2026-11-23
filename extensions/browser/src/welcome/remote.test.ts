import { describe, expect, it } from 'vitest';
import type { RemoteSettings } from '../background/remote.ts';
import { describeRemoteStatus, relayHost } from './remote.ts';

const settings = (address: string): RemoteSettings => ({ enabled: true, address, key: '', tokens: [] });
const status = (state: 'connected' | 'connecting' | 'disconnected') => ({ state, url: 'wss://relay.example.com/extension', since: 0, agents: [] });

describe('describeRemoteStatus', () => {
  it('asks for an address until there is a valid one', () => {
    expect(describeRemoteStatus(settings(''), null)).toEqual({ state: 'offline', text: 'Enter the relay address to connect.' });
    expect(describeRemoteStatus(settings('relay'), status('connected')).state).toBe('offline');
  });

  it('follows the relay connection', () => {
    const relay = settings('https://relay.example.com');
    expect(describeRemoteStatus(relay, null)).toEqual({ state: 'connecting', text: 'Connecting to the relay…' });
    expect(describeRemoteStatus(relay, status('connecting')).state).toBe('connecting');
    expect(describeRemoteStatus(relay, status('connected'))).toEqual({ state: 'connected', text: 'Connected to the relay' });
    expect(describeRemoteStatus(relay, status('disconnected'))).toEqual({ state: 'offline', text: "Can't reach the relay. Retrying…" });
  });
});

describe('relayHost', () => {
  it('shows the host of the relay', () => {
    expect(relayHost('https://relay.example.com/base/')).toBe('relay.example.com');
    expect(relayHost('http://localhost:8080')).toBe('localhost:8080');
    expect(relayHost('not a url')).toBe('not a url');
  });
});
