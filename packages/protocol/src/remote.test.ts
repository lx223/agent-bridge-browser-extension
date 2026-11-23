import { describe, expect, it } from 'vitest';
import {
  extensionToRemote,
  newRemoteKey,
  newRemoteToken,
  remoteKey,
  remoteSpaceId,
  remoteTokenHash,
  remoteUrls,
  spaceOfToken,
} from './index.ts';

describe('remote keys and tokens', () => {
  it('creates keys the relay accepts', () => {
    const key = newRemoteKey();
    expect(remoteKey.safeParse(key).success).toBe(true);
    expect(newRemoteKey()).not.toBe(key);
  });

  it('derives the same space from the same key', async () => {
    const key = newRemoteKey();
    const space = await remoteSpaceId(key);
    expect(space).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(await remoteSpaceId(key)).toBe(space);
    expect(await remoteSpaceId(newRemoteKey())).not.toBe(space);
  });

  it('puts the space in each token', async () => {
    const space = await remoteSpaceId(newRemoteKey());
    const token = newRemoteToken(space);
    expect(spaceOfToken(token)).toBe(space);
    expect(newRemoteToken(space)).not.toBe(token);
  });

  it('reads the space from tokens whose space contains underscores', () => {
    const space = 'a_b-c_d_e_f_g_h_i_j_kl';
    expect(spaceOfToken(newRemoteToken(space))).toBe(space);
  });

  it('rejects malformed tokens', () => {
    expect(spaceOfToken('abb_short_token')).toBeUndefined();
    expect(spaceOfToken(`xyz_${'a'.repeat(22)}_${'b'.repeat(43)}`)).toBeUndefined();
    expect(spaceOfToken(`abb_${'a'.repeat(22)}_${'b'.repeat(43)}x`)).toBeUndefined();
  });

  it('hashes tokens to lowercase hex', async () => {
    expect(await remoteTokenHash('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('parses auth and token updates', async () => {
    const hash = await remoteTokenHash('token');
    expect(extensionToRemote.parse({ type: 'remoteAuth', key: newRemoteKey(), tokens: [hash] }).type).toBe('remoteAuth');
    expect(extensionToRemote.parse({ type: 'remoteTokens', tokens: [] }).type).toBe('remoteTokens');
    expect(extensionToRemote.safeParse({ type: 'remoteTokens', tokens: ['not-a-hash'] }).success).toBe(false);
    expect(extensionToRemote.safeParse({ type: 'remoteAuth', key: 'short', tokens: [] }).success).toBe(false);
  });
});

describe('remoteUrls', () => {
  it('derives the extension socket and MCP endpoint from an https address', () => {
    expect(remoteUrls('https://relay.example.com/')).toEqual({
      base: 'https://relay.example.com',
      extension: 'wss://relay.example.com/extension',
      mcp: 'https://relay.example.com/mcp',
    });
  });

  it('keeps a path prefix and the port', () => {
    expect(remoteUrls(' http://localhost:8080/bridge// ')).toEqual({
      base: 'http://localhost:8080/bridge',
      extension: 'ws://localhost:8080/bridge/extension',
      mcp: 'http://localhost:8080/bridge/mcp',
    });
  });

  it('rejects other schemes and extra parts', () => {
    expect(() => remoteUrls('ftp://relay.example.com')).toThrow(/https/);
    expect(() => remoteUrls('https://relay.example.com/?x=1')).toThrow();
    expect(() => remoteUrls('https://user:pw@relay.example.com')).toThrow();
    expect(() => remoteUrls('relay.example.com')).toThrow();
  });
});
