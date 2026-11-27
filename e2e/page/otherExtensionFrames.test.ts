import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Page } from 'playwright';
import { OTHER_EXTENSION, refOf, startHarness, type Harness } from '../support/harness.ts';

let harness: Harness;
let tabId: number;
let page: Page;

const otherExtensionFrames = () => page.frames().filter((frame) => frame.url().startsWith('chrome-extension://')).length;

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

describe('page control in a tab where another extension added frames', () => {
  it('snapshots the page without the other extension frames and puts them back', async () => {
    const tree = await harness.agent.text('chrome_page_snapshot', { tabId });

    expect(tree).toContain('Page: Fixture form');
    expect(tree).toMatch(/button "Press me" \[ref=e\d+\]/);
    expect(tree).not.toContain('Fill password');
    await expect.poll(otherExtensionFrames).toBe(2);
  });

  it('captures a screenshot and puts the other extension frames back', async () => {
    const shot = await harness.agent.raw('chrome_page_screenshot', { tabId });

    expect(shot.isError).toBe(false);
    expect(shot.content[0]).toMatchObject({ type: 'image', mimeType: 'image/png' });
    expect(Buffer.from(shot.content[0]!.data!, 'base64').subarray(1, 4).toString()).toBe('PNG');
    await expect.poll(otherExtensionFrames).toBe(2);
  });

  it('keeps snapshot refs usable for the next page tool', async () => {
    const ref = refOf(await harness.agent.text('chrome_page_snapshot', { tabId }), /button "Press me"/);

    await harness.agent.call('chrome_page_click', { tabId, ref });

    expect(await page.textContent('#status')).toBe('pressed');
    await expect.poll(otherExtensionFrames).toBe(2);
  });
});
