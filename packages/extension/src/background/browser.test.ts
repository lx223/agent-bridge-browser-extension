import { describe, expect, it } from 'vitest';
import { browserLabel, detectBrowser, instanceId } from './browser.ts';

const CHROME_URL = 'chrome-extension://abcdefghijklmnop/';
const CHROME_UA = 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function fakeStorage(initial: Record<string, unknown> = {}) {
  const data = { ...initial };
  return {
    data,
    get: async (key: string) => ({ [key]: data[key] }),
    set: async (items: Record<string, unknown>) => void Object.assign(data, items),
  } as unknown as Parameters<typeof instanceId>[0] & { data: Record<string, unknown> };
}

describe('detectBrowser', () => {
  it('recognises Safari by its extension URL scheme', () => {
    expect(detectBrowser('safari-web-extension://1234-ABCD/')).toBe('safari');
  });

  it('treats Chromium browsers as Chrome', () => {
    expect(detectBrowser(CHROME_URL)).toBe('chrome');
  });
});

describe('browserLabel', () => {
  it('names the actual browser', () => {
    expect(browserLabel('safari-web-extension://1234-ABCD/', 'Version/18.0 Safari/605.1.15', false)).toBe('Safari');
    expect(browserLabel(CHROME_URL, CHROME_UA, false)).toBe('Chrome');
    expect(browserLabel(CHROME_URL, `${CHROME_UA} Edg/131.0.0.0`, false)).toBe('Edge');
    expect(browserLabel(CHROME_URL, CHROME_UA, true)).toBe('Brave');
  });
});

describe('instanceId', () => {
  it('creates an id once and reuses it afterwards', async () => {
    const storage = fakeStorage();
    const first = await instanceId(storage);
    expect(first).toMatch(/^[0-9a-f]{8}$/);
    await expect(instanceId(storage)).resolves.toBe(first);
  });

  it('returns the stored id', async () => {
    await expect(instanceId(fakeStorage({ bridgeInstanceId: 'cafe1234' }))).resolves.toBe('cafe1234');
  });
});
