import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { startHarness, type Harness } from '../support/harness.ts';

const LOCALES = resolve(import.meta.dirname, '../../packages/extension/dist/_locales');
const messages = (locale: string): Record<string, { message: string }> => JSON.parse(readFileSync(resolve(LOCALES, locale, 'messages.json'), 'utf-8'));

let harness: Harness | undefined;

afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

async function openWelcomePage(locale: string) {
  harness = await startHarness({ locale });
  const errors: string[] = [];
  const page = await harness.context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`chrome-extension://${harness.extensionId}/src/welcome/index.html`);
  await page.waitForSelector('#status[data-state="connected"]');
  return { page, errors };
}

describe.skipIf(process.platform === 'darwin')('the extension in another language', () => {
  it('shows the setup page in German and keeps the code and links inside the text', async () => {
    const german = messages('de');
    const { page, errors } = await openWelcomePage('de');
    expect(await page.getAttribute('html', 'lang')).toBe('de');
    expect(await page.getAttribute('html', 'dir')).toBe('ltr');
    expect(await page.textContent('[data-i18n="welcomeStepAdd"]')).toBe(german.welcomeStepAdd!.message);
    expect(await page.textContent('#status-text')).toBe(german.welcomeConnected!.message);
    expect(await page.getAttribute('#instance-name', 'placeholder')).toBe(german.instanceNamePlaceholder!.message);
    expect(await page.textContent('#cursor-link')).toBe(german.welcomeAddTo!.message.replace('$1', 'Cursor'));
    expect(await page.locator('[data-i18n="welcomeStepAddHint"] code [data-pkg]').count()).toBe(1);
    expect(await page.locator('[data-i18n="welcomeInstanceNameHint"] #instance-id').textContent()).toMatch(/\S/);
    expect(errors).toEqual([]);
  });

  it('lays out a right-to-left language from right to left', async () => {
    const { page, errors } = await openWelcomePage('ar');
    expect(await page.getAttribute('html', 'lang')).toBe('ar');
    expect(await page.getAttribute('html', 'dir')).toBe('rtl');
    expect(await page.textContent('[data-i18n="welcomeStepAdd"]')).toBe(messages('ar').welcomeStepAdd!.message);
    expect(errors).toEqual([]);
  });
});
