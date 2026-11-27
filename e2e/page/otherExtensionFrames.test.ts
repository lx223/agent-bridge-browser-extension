import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Page } from 'playwright';
import { OTHER_EXTENSION, startHarness, type Harness } from '../support/harness.ts';

let harness: Harness;
let tabId: number;
let page: Page;

const REMOVE_OTHER_EXTENSION_FRAMES = `
  document.querySelectorAll('iframe[src^="chrome-extension://"], other-extension-menu').forEach((element) => element.remove());
  document.querySelectorAll('iframe').length
`;

const otherExtensionFrames = () => page.frames().filter((frame) => frame.url().startsWith('chrome-extension://')).length;
const executeScript = (code: string, allFrames?: boolean) => harness.agent.call<Array<{ frameId: number; result?: unknown; error?: string }>>('chrome_scripting_execute_script', { tabId, code, allFrames });

beforeAll(async () => {
  harness = await startHarness({ otherExtensions: [OTHER_EXTENSION] });
});

afterAll(async () => {
  await harness?.close();
});

beforeEach(async () => {
  const opened = harness.context.waitForEvent('page');
  tabId = (await harness.openFixture('form.html')).id;
  page = await opened;
  await page.waitForLoadState('load');
  await expect.poll(otherExtensionFrames).toBe(2);
});

describe('a tab where another extension added frames', () => {
  it('refuses the debugger, so page tools fail', async () => {
    const snapshot = await harness.agent.raw('chrome_page_snapshot', { tabId });
    const screenshot = await harness.agent.raw('chrome_page_screenshot', { tabId });

    expect(snapshot).toMatchObject({ isError: true, text: expect.stringContaining('chrome-extension:// URL of different extension') });
    expect(screenshot).toMatchObject({ isError: true, text: expect.stringContaining('chrome-extension:// URL of different extension') });
  });

  it('still runs scripts, which can remove those frames so snapshot and screenshot work', async () => {
    expect(await executeScript('document.title')).toEqual([{ frameId: 0, result: 'Fixture form' }]);

    expect(await executeScript(REMOVE_OTHER_EXTENSION_FRAMES)).toEqual([{ frameId: 0, result: 0 }]);
    await expect.poll(otherExtensionFrames).toBe(0);

    expect(await harness.agent.text('chrome_page_snapshot', { tabId })).toMatch(/button "Press me" \[ref=e\d+\]/);
    const screenshot = await harness.agent.raw('chrome_page_screenshot', { tabId });
    expect(screenshot.isError).toBe(false);
    expect(screenshot.content[0]).toMatchObject({ type: 'image', mimeType: 'image/png' });
  });

  it('reports errors thrown by the script', async () => {
    expect(await executeScript(`throw new Error('boom')`)).toEqual([{ frameId: 0, error: 'Error: boom' }]);
  });
});
