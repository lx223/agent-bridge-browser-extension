import type { Browser } from '@agent-browser-bridge/protocol';

export function detectBrowser(extensionUrl: string): Browser {
  return extensionUrl.startsWith('safari-web-extension:') ? 'safari' : 'chrome';
}
