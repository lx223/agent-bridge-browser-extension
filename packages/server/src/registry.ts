import { SERVER_PACKAGE } from '@agent-browser-bridge/protocol';

export async function latestPublishedVersion(fetchImpl: typeof fetch = fetch): Promise<string | undefined> {
  const registry = (process.env.npm_config_registry || 'https://registry.npmjs.org/').replace(/\/?$/, '/');
  const response = await fetchImpl(`${registry}${SERVER_PACKAGE}/latest`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) return undefined;
  const body = (await response.json()) as { version?: unknown };
  return typeof body.version === 'string' ? body.version : undefined;
}
