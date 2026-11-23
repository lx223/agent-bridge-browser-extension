import type { Browser } from '@agent-browser-bridge/protocol';

interface BrowserSpecificElement {
  dataset: { browser?: string };
  hidden: boolean;
}

export function showContentFor(browser: Browser, elements: Iterable<BrowserSpecificElement>) {
  for (const element of elements) element.hidden = element.dataset.browser !== browser;
}
