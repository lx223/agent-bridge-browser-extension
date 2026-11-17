import type { Browser } from '@agent-browser-bridge/protocol';

const INSTANCE_KEY = 'bridgeInstanceId';

type InstanceStorage = Pick<chrome.storage.StorageArea, 'get' | 'set'>;

export function detectBrowser(extensionUrl: string): Browser {
  return extensionUrl.startsWith('safari-web-extension:') ? 'safari' : 'chrome';
}

export function browserLabel(extensionUrl: string, userAgent: string, isBrave: boolean): string {
  if (detectBrowser(extensionUrl) === 'safari') return 'Safari';
  if (isBrave) return 'Brave';
  if (/\bEdg\//.test(userAgent)) return 'Edge';
  return 'Chrome';
}

export async function instanceId(storage: InstanceStorage): Promise<string> {
  const stored = (await storage.get(INSTANCE_KEY))[INSTANCE_KEY];
  if (typeof stored === 'string' && stored) return stored;
  const created = crypto.randomUUID().slice(0, 8);
  await storage.set({ [INSTANCE_KEY]: created });
  return created;
}
