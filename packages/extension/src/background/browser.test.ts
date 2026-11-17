import { describe, expect, it } from 'vitest';
import { detectBrowser } from './browser.ts';

describe('detectBrowser', () => {
  it('recognises Safari by its extension URL scheme', () => {
    expect(detectBrowser('safari-web-extension://1234-ABCD/')).toBe('safari');
  });

  it('treats Chromium browsers as Chrome', () => {
    expect(detectBrowser('chrome-extension://abcdefghijklmnop/')).toBe('chrome');
  });
});
