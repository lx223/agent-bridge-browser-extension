import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'playwright';
import { ASK_USER_TOOL } from '@agent-browser-bridge/protocol';
import { startHarness, type Harness, type Tab } from '../support/harness.ts';

interface Answer {
  answer: string;
  tab: { id: number; url: string };
  next: string;
}

interface DomNode {
  nodeId: number;
  nodeName: string;
  attributes?: string[];
  children?: DomNode[];
  shadowRoots?: DomNode[];
}

const POPOVER = 'agent-browser-bridge-ask';
const ARMED_AFTER_MS = 500;

let harness: Harness;
let opened = 0;

beforeAll(async () => {
  harness = await startHarness({ agentName: 'e2e-agent' });
});

afterAll(async () => {
  await harness?.close();
});

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

async function openPage(): Promise<{ tab: Tab; page: Page }> {
  const tab = await harness.openFixture(`form.html?ask=${++opened}`);
  for (let tries = 0; tries < 50; tries++) {
    const page = harness.context.pages().find((candidate) => candidate.url() === tab.url);
    if (page) return { tab, page };
    await sleep(100);
  }
  throw new Error(`No page for ${tab.url}`);
}

const ask = (args: Record<string, unknown>) => harness.agent.call<Answer>(ASK_USER_TOOL, { browser: 'chrome', ...args });

function findNode(node: DomNode, matches: (node: DomNode) => boolean): DomNode | undefined {
  if (matches(node)) return node;
  for (const child of [...(node.shadowRoots ?? []), ...(node.children ?? [])]) {
    const found = findNode(child, matches);
    if (found) return found;
  }
  return undefined;
}

const classOf = (node: DomNode) => {
  const attributes = node.attributes ?? [];
  const at = attributes.indexOf('class');
  return at === -1 ? undefined : attributes[at + 1];
};

async function popoverText(page: Page): Promise<string> {
  const cdp = await page.context().newCDPSession(page);
  try {
    const { root } = (await cdp.send('DOM.getDocument', { depth: -1, pierce: true })) as { root: DomNode };
    const card = findNode(root, (node) => node.nodeName === 'SECTION' && classOf(node) === 'card');
    if (!card) throw new Error('No popover card');
    const { outerHTML } = await cdp.send('DOM.getOuterHTML', { nodeId: card.nodeId });
    return outerHTML.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  } finally {
    await cdp.detach();
  }
}

async function clickButton(page: Page, className: string) {
  await page.locator(POPOVER).waitFor({ state: 'attached' });
  await sleep(ARMED_AFTER_MS);
  const cdp = await page.context().newCDPSession(page);
  try {
    const { root } = (await cdp.send('DOM.getDocument', { depth: -1, pierce: true })) as { root: DomNode };
    const button = findNode(root, (node) => node.nodeName === 'BUTTON' && classOf(node) === className);
    if (!button) throw new Error(`No ${className} button in the popover`);
    const { model } = (await cdp.send('DOM.getBoxModel', { nodeId: button.nodeId })) as { model: { content: number[] } };
    const [left, top, , , right, bottom] = model.content as [number, number, number, number, number, number];
    await page.mouse.click((left + right) / 2, (top + bottom) / 2);
  } finally {
    await cdp.detach();
  }
}

describe('asking the user in a page', () => {
  it('shows the question in the tab and returns confirmed when the user clicks the confirm button', async () => {
    const { tab, page } = await openPage();
    const answer = ask({ tabId: tab.id, title: 'Submit the form?', message: 'This sends your name to the fixture.', confirmLabel: 'Submit' });

    await page.locator(POPOVER).waitFor({ state: 'attached' });
    const text = await popoverText(page);
    expect(text).toContain('e2e-agent asks');
    expect(text).toContain('Submit the form?');
    expect(text).toContain('This sends your name to the fixture.');
    await clickButton(page, 'confirm');

    const result = await answer;
    expect(result.answer).toBe('confirmed');
    expect(result.tab).toMatchObject({ id: tab.id, url: tab.url });
    expect(result.next).toMatch(/Go ahead/);
    await page.locator(POPOVER).waitFor({ state: 'detached' });
  });

  it('asks in the active tab when no tabId is given and returns cancelled', async () => {
    const { tab, page } = await openPage();
    const answer = ask({ message: 'Delete the draft?' });

    await clickButton(page, 'cancel');

    const result = await answer;
    expect(result.answer).toBe('cancelled');
    expect(result.tab.id).toBe(tab.id);
  });

  it('brings the tab to the front', async () => {
    const { tab } = await openPage();
    const other = await harness.openFixture('second.html');
    expect(other.active).toBe(true);
    const answer = ask({ tabId: tab.id, message: 'Continue here?', timeoutSeconds: 1 });

    await sleep(300);
    const [active] = await harness.agent.call<Tab[]>('chrome_tabs_list', { active: true, windowId: tab.windowId });
    expect(active?.id).toBe(tab.id);
    expect((await answer).answer).toBe('timeout');
  });

  it('returns navigated when the page changes before the user answers', async () => {
    const { tab, page } = await openPage();
    const answer = ask({ tabId: tab.id, message: 'Go ahead?' });

    await page.locator(POPOVER).waitFor({ state: 'attached' });
    await harness.agent.call('chrome_tabs_navigate', { tabId: tab.id, to: harness.fixture('second.html') });

    expect((await answer).answer).toBe('navigated');
  });

  it('keeps the answer away from the page and removes the question when nobody answers in time', async () => {
    const { tab, page } = await openPage();
    const answer = ask({ tabId: tab.id, message: 'Nobody will answer this', timeoutSeconds: 2 });

    await page.locator(POPOVER).waitFor({ state: 'attached' });
    const seenByPage = await page.evaluate(`(() => {
      const host = document.querySelector('${POPOVER}');
      host?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return { shadowRoot: host?.shadowRoot ?? null, state: globalThis.__agentBrowserBridgeAsk ?? null };
    })()`);
    expect(seenByPage).toEqual({ shadowRoot: null, state: null });

    const result = await answer;
    expect(result.answer).toBe('timeout');
    await page.locator(POPOVER).waitFor({ state: 'detached' });
  });

  it('refuses a second question in a tab that is already asking', async () => {
    const { tab, page } = await openPage();
    const first = ask({ tabId: tab.id, message: 'First question' });
    await page.locator(POPOVER).waitFor({ state: 'attached' });

    const second = await harness.agent.raw(ASK_USER_TOOL, { browser: 'chrome', tabId: tab.id, message: 'Second question' });
    expect(second.isError).toBe(true);
    expect(second.text).toMatch(/already showing a question/);

    await clickButton(page, 'confirm');
    expect((await first).answer).toBe('confirmed');
  });
});
