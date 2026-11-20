import { afterEach, describe, expect, it, vi } from 'vitest';
import { latestPublishedVersion } from './registry.ts';

const respond = (status: number, body: unknown) => vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify(body), { status }));

afterEach(() => vi.unstubAllEnvs());

describe('latestPublishedVersion', () => {
  it('reads the latest version from the npm registry', async () => {
    vi.stubEnv('npm_config_registry', '');
    const fetch = respond(200, { name: 'agent-browser-bridge-mcp', version: '0.4.0' });
    await expect(latestPublishedVersion(fetch)).resolves.toBe('0.4.0');
    expect(fetch.mock.calls[0]![0]).toBe('https://registry.npmjs.org/agent-browser-bridge-mcp/latest');
  });

  it('uses the registry npm is configured with', async () => {
    vi.stubEnv('npm_config_registry', 'https://npm.example.com/repo');
    const fetch = respond(200, { version: '0.4.0' });
    await latestPublishedVersion(fetch);
    expect(fetch.mock.calls[0]![0]).toBe('https://npm.example.com/repo/agent-browser-bridge-mcp/latest');
  });

  it('gives no version when the registry fails', async () => {
    await expect(latestPublishedVersion(respond(404, { error: 'not found' }))).resolves.toBeUndefined();
  });

  it('gives no version when the answer has none', async () => {
    await expect(latestPublishedVersion(respond(200, { name: 'x' }))).resolves.toBeUndefined();
  });
});
