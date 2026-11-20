import { MAX_INSTANCE_NAME_LENGTH, type Browser } from '@agent-browser-bridge/protocol';

export const INSTANCE_KEY = 'bridgeInstanceId';
export const INSTANCE_NAME_KEY = 'bridgeInstanceName';
export { MAX_INSTANCE_NAME_LENGTH };

type InstanceStorage = Pick<chrome.storage.StorageArea, 'get' | 'set'>;
type NameStorage = Pick<chrome.storage.StorageArea, 'set' | 'remove'>;

export function detectBrowser(extensionUrl: string): Browser {
  return extensionUrl.startsWith('safari-web-extension:') ? 'safari' : 'chrome';
}

export function browserLabel(extensionUrl: string, userAgent: string, isBrave: boolean): string {
  if (detectBrowser(extensionUrl) === 'safari') return 'Safari';
  if (isBrave) return 'Brave';
  if (/\bEdg\//.test(userAgent)) return 'Edge';
  return 'Chrome';
}

export const newInstanceId = () => crypto.randomUUID().slice(0, 8);

export async function instanceId(storage: InstanceStorage): Promise<string> {
  const stored = (await storage.get(INSTANCE_KEY))[INSTANCE_KEY];
  if (typeof stored === 'string' && stored) return stored;
  return storeInstanceId(storage, newInstanceId());
}

export async function storeInstanceId(storage: InstanceStorage, id: string): Promise<string> {
  await storage.set({ [INSTANCE_KEY]: id });
  return id;
}

export function normalizeInstanceName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const name = value.replace(/\s+/g, ' ').trim().slice(0, MAX_INSTANCE_NAME_LENGTH).trim();
  return name || undefined;
}

export async function instanceName(storage: InstanceStorage): Promise<string | undefined> {
  return normalizeInstanceName((await storage.get(INSTANCE_NAME_KEY))[INSTANCE_NAME_KEY]);
}

export async function saveInstanceName(storage: NameStorage, value: string): Promise<string | null> {
  const name = normalizeInstanceName(value);
  if (name) await storage.set({ [INSTANCE_NAME_KEY]: name });
  else await storage.remove(INSTANCE_NAME_KEY);
  return name ?? null;
}
