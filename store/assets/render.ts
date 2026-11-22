import type { Browser, Page } from 'playwright';
import type { Size } from './frame.ts';

export interface StillOptions {
  html: string;
  size: Size;
  languageTag: string;
  file: string;
  scale?: number;
  omitBackground?: boolean;
}

export async function overflowingElements(page: Page) {
  return page.locator('[data-fit]').evaluateAll((elements) =>
    elements
      .filter((element) => element.scrollHeight > element.clientHeight + 1 || element.scrollWidth > element.clientWidth + 1)
      .map((element) => element.className || element.tagName.toLowerCase()),
  );
}

export async function openDocument(browser: Browser, options: { html: string; size: Size; languageTag: string; scale?: number }) {
  const context = await browser.newContext({ viewport: options.size, deviceScaleFactor: options.scale ?? 1, locale: options.languageTag, colorScheme: 'light' });
  const page = await context.newPage();
  await page.setContent(options.html, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  return { page, close: () => context.close() };
}

export async function renderStill(browser: Browser, options: StillOptions) {
  const { page, close } = await openDocument(browser, options);
  try {
    const overflowing = await overflowingElements(page);
    await page.screenshot({ path: options.file, omitBackground: options.omitBackground });
    return overflowing;
  } finally {
    await close();
  }
}
