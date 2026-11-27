import { describe, expect, it } from 'vitest';
import {
  MIN_REMOTE_TOKEN_LENGTH,
  newRemoteNonce,
  newRemoteToken,
  remoteAuthMessage,
  remoteChallengeMessage,
  remoteProof,
  remoteTokenProblem,
  remoteUrls,
  remoteWelcomeMessage,
  sameProof,
} from './index.ts';

describe('remote tokens and nonces', () => {
  it('creates long random tokens the relay accepts', () => {
    const token = newRemoteToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(remoteTokenProblem(token)).toBeUndefined();
    expect(newRemoteToken()).not.toBe(token);
  });

  it('explains what is wrong with a token', () => {
    expect(remoteTokenProblem(undefined)).toBe('is not set');
    expect(remoteTokenProblem('')).toBe('is not set');
    expect(remoteTokenProblem('x'.repeat(MIN_REMOTE_TOKEN_LENGTH - 1))).toMatch(/shorter/);
    expect(remoteTokenProblem(` ${'x'.repeat(40)}`)).toMatch(/spaces/);
    expect(remoteTokenProblem('x'.repeat(600))).toMatch(/longer/);
    expect(remoteTokenProblem('x'.repeat(MIN_REMOTE_TOKEN_LENGTH))).toBeUndefined();
  });

  it('creates nonces that fit the handshake messages', () => {
    const nonce = newRemoteNonce();
    expect(remoteChallengeMessage.safeParse({ type: 'remoteChallenge', nonce }).success).toBe(true);
    expect(remoteChallengeMessage.safeParse({ type: 'remoteChallenge', nonce: 'short' }).success).toBe(false);
  });
});

describe('remoteProof', () => {
  const input = (relayNonce: string, browserNonce: string, role: 'browser' | 'relay' = 'browser', relayHost = 'relay.example.com') => ({
    role,
    relayHost,
    relayNonce,
    browserNonce,
  });

  it('is a stable HMAC for the token, role, relay host and both nonces', async () => {
    const token = newRemoteToken();
    const [relay, browser] = [newRemoteNonce(), newRemoteNonce()];
    const proof = await remoteProof(token, input(relay, browser));
    expect(proof).toMatch(/^[0-9a-f]{64}$/);
    expect(await remoteProof(token, input(relay, browser))).toBe(proof);
    expect(remoteAuthMessage.parse({ type: 'remoteAuth', nonce: browser, proof }).proof).toBe(proof);
    expect(remoteWelcomeMessage.parse({ type: 'remoteWelcome', proof }).proof).toBe(proof);
  });

  it('differs for each role, host, nonce and token', async () => {
    const token = newRemoteToken();
    const [relay, browser] = [newRemoteNonce(), newRemoteNonce()];
    const proof = await remoteProof(token, input(relay, browser));
    expect(await remoteProof(token, input(relay, browser, 'relay'))).not.toBe(proof);
    expect(await remoteProof(token, input(relay, browser, 'browser', 'relay.example.net'))).not.toBe(proof);
    expect(await remoteProof(token, input(newRemoteNonce(), browser))).not.toBe(proof);
    expect(await remoteProof(token, input(relay, newRemoteNonce()))).not.toBe(proof);
    expect(await remoteProof(newRemoteToken(), input(relay, browser))).not.toBe(proof);
  });

  it('ignores the case of the host and matches a known HMAC-SHA256 value', async () => {
    expect(await remoteProof('key', input('a', 'b', 'relay', 'Relay.Example.com'))).toBe('f5d71072613b1146e92ec326fd8f1b550ff83c864e94baf120a6edef4b8b60ad');
  });

  it('compares proofs', () => {
    expect(sameProof('abc', 'abc')).toBe(true);
    expect(sameProof('abc', 'abd')).toBe(false);
    expect(sameProof('abc', 'ab')).toBe(false);
  });
});

describe('remoteUrls', () => {
  it('derives the extension socket and MCP endpoint from an https address', () => {
    expect(remoteUrls('https://Relay.Example.com/')).toEqual({
      base: 'https://relay.example.com',
      host: 'relay.example.com',
      extension: 'wss://relay.example.com/extension',
      mcp: 'https://relay.example.com/mcp',
    });
  });

  it('keeps a path prefix and the port', () => {
    expect(remoteUrls(' https://relay.example.com:8443/bridge// ')).toEqual({
      base: 'https://relay.example.com:8443/bridge',
      host: 'relay.example.com:8443',
      extension: 'wss://relay.example.com:8443/bridge/extension',
      mcp: 'https://relay.example.com:8443/bridge/mcp',
    });
  });

  it('allows plain http only on this computer', () => {
    expect(remoteUrls('http://localhost:8080').extension).toBe('ws://localhost:8080/extension');
    expect(remoteUrls('http://127.0.0.1:8080').extension).toBe('ws://127.0.0.1:8080/extension');
    expect(remoteUrls('http://[::1]:8080').extension).toBe('ws://[::1]:8080/extension');
    expect(() => remoteUrls('http://relay.example.com')).toThrow(/https/);
    expect(() => remoteUrls('http://192.168.1.5:8080')).toThrow(/https/);
  });

  it('rejects other schemes and extra parts', () => {
    expect(() => remoteUrls('ftp://relay.example.com')).toThrow(/https/);
    expect(() => remoteUrls('https://relay.example.com/?x=1')).toThrow();
    expect(() => remoteUrls('https://user:pw@relay.example.com')).toThrow();
    expect(() => remoteUrls('relay.example.com')).toThrow();
  });
});
