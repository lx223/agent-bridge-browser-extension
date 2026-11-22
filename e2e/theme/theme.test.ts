import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'playwright';
import { startHarness, type Harness } from '../support/harness.ts';

let harness: Harness;

beforeAll(async () => {
  harness = await startHarness();
});

afterAll(async () => {
  await harness?.close();
});

const PAGES = [
  { name: 'chat panel', path: 'src/sidepanel/index.html', ready: '#empty' },
  { name: 'options page', path: 'src/welcome/index.html', ready: '#status[data-state="connected"]' },
];

const style = (page: Page, selector: string, property: string) =>
  page.evaluate<string>(`getComputedStyle(document.querySelector(${JSON.stringify(selector)})).getPropertyValue(${JSON.stringify(property)})`);

const luminance = (color: string) => {
  const [red, green, blue] = color.match(/\d+(\.\d+)?/g)!.map(Number);
  return 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!;
};

async function themeOf(page: Page, scheme: 'light' | 'dark') {
  await page.emulateMedia({ colorScheme: scheme });
  return {
    background: luminance(await style(page, 'body', 'background-color')),
    text: luminance(await style(page, 'body', 'color')),
    accent: (await style(page, ':root', '--accent-text')).trim(),
    colorScheme: await style(page, ':root', 'color-scheme'),
  };
}

describe('light and dark appearance', () => {
  for (const { name, path, ready } of PAGES) {
    it(`follows the system colour scheme on the ${name}`, async () => {
      const errors: string[] = [];
      const page = await harness.context.newPage();
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(`chrome-extension://${harness.extensionId}/${path}`);
      await page.waitForSelector(ready);

      const light = await themeOf(page, 'light');
      const dark = await themeOf(page, 'dark');

      expect(light.colorScheme).toBe('light dark');
      expect(light.background).toBeGreaterThan(200);
      expect(light.text).toBeLessThan(60);
      expect(dark.background).toBeLessThan(60);
      expect(dark.text).toBeGreaterThan(200);
      expect(dark.accent).not.toBe(light.accent);
      expect(errors).toEqual([]);
      await page.close();
    });
  }

  it('uses the same colours on the chat panel and the options page', async () => {
    const pages = await Promise.all(
      PAGES.map(async ({ path, ready }) => {
        const page = await harness.context.newPage();
        await page.goto(`chrome-extension://${harness.extensionId}/${path}`);
        await page.waitForSelector(ready);
        return page;
      }),
    );
    for (const scheme of ['light', 'dark'] as const) {
      const [chat, options] = await Promise.all(pages.map((page) => themeOf(page, scheme)));
      expect(chat!.text).toBe(options!.text);
      expect(chat!.accent).toBe(options!.accent);
    }
    await Promise.all(pages.map((page) => page.close()));
  });
});
