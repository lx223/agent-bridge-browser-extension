import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'playwright';
import { CHAT_RECEIVE_TOOL, CHAT_SEND_TOOL } from '@agent-browser-bridge/protocol';
import { startHarness, type Harness } from '../support/harness.ts';

let harness: Harness;
let panel: Page;
const errors: string[] = [];
const ME = { agentId: 'e2e-agent', agentName: 'Tidy my tabs' };

beforeAll(async () => {
  harness = await startHarness();
  panel = await harness.context.newPage();
  panel.on('pageerror', (error) => errors.push(error.message));
  await panel.goto(`chrome-extension://${harness.extensionId}/src/sidepanel/index.html`);
});

afterAll(async () => {
  await harness?.close();
});

interface Inbox {
  sent?: boolean;
  messages: Array<{ text: string; sentAt: string; viewingTab?: { title: string; url: string } }>;
  ended?: boolean;
  next: string;
}

const worker = () => harness.context.serviceWorkers()[0]!;
const opensPanelFromToolbar = () => worker().evaluate<boolean>('chrome.sidePanel.getPanelBehavior().then((behavior) => behavior.openPanelOnActionClick)');
const badge = () => worker().evaluate<string>('chrome.action.getBadgeText({})');

async function reply(text: string) {
  await panel.fill('#input', text);
  await panel.press('#input', 'Enter');
}

describe('the browser chat panel', () => {
  it('explains how to start a chat before there is one', async () => {
    expect(await panel.isVisible('#empty')).toBe(true);
    expect(await panel.textContent('#empty')).toContain('continue_in_browser');
    expect(await opensPanelFromToolbar()).toBe(false);
  });

  it('badges the toolbar button and opens the panel from it while a chat is open', async () => {
    await panel.close();
    await harness.agent.call(CHAT_SEND_TOOL, { ...ME, text: 'Are you there?', waitForReply: false });
    await expect.poll(badge).toBe('1');
    expect(await opensPanelFromToolbar()).toBe(true);
    panel = await harness.context.newPage();
    panel.on('pageerror', (error) => errors.push(error.message));
    await panel.goto(`chrome-extension://${harness.extensionId}/src/sidepanel/index.html`);
    await panel.waitForSelector('.message.from-agent >> text=Are you there?');
    await expect.poll(badge).toBe('');
  });

  it('shows the agent message and hands the reply typed in the panel back to the agent', async () => {
    const answered = harness.agent.call<Inbox>(CHAT_SEND_TOOL, { ...ME, text: 'I grouped your tabs. What next?', timeoutSeconds: 60 });
    await panel.waitForSelector('.message.from-agent >> text=I grouped your tabs. What next?');
    await panel.waitForSelector('body[data-state="waiting"]');
    expect(await panel.textContent('#title')).toBe('Tidy my tabs');
    await reply('Pin the inbox please');
    const inbox = await answered;
    expect(inbox.messages).toEqual([expect.objectContaining({ text: 'Pin the inbox please', viewingTab: expect.objectContaining({ url: expect.stringContaining('sidepanel') }) })]);
    expect(inbox.next).toContain(CHAT_SEND_TOOL);
    await panel.waitForSelector('.message.from-user .meta >> text=read by the agent');
  });

  it('tells the agent about messages sent while it works', async () => {
    await harness.agent.call(CHAT_SEND_TOOL, { ...ME, text: 'Working on it', waitForReply: false });
    await panel.waitForSelector('.message.from-agent >> text=Working on it');
    await reply('Also close the docs tab');
    await panel.waitForSelector('.message.from-user >> text=Also close the docs tab');
    const result = await harness.agent.raw('chrome_windows_list');
    expect(result.content.at(-1)?.text).toBe(`The user sent a new message in the browser chat. Call ${CHAT_RECEIVE_TOOL} to read it.`);
    const inbox = await harness.agent.call<Inbox>(CHAT_RECEIVE_TOOL, { ...ME, timeoutSeconds: 0 });
    expect(inbox.messages.map((message) => message.text)).toEqual(['Also close the docs tab']);
  });

  it('lets the user end the chat and tells the waiting agent to stop', async () => {
    const answered = harness.agent.call<Inbox>(CHAT_RECEIVE_TOOL, { ...ME, timeoutSeconds: 60 });
    await panel.waitForSelector('body[data-state="waiting"]');
    await panel.click('#end');
    const inbox = await answered;
    expect(inbox).toMatchObject({ ended: true, messages: [] });
    await panel.waitForSelector('body[data-state="ended"]');
    expect(await panel.isDisabled('#input')).toBe(true);
    expect(await panel.textContent('.message.from-notice .text')).toBe('You ended the chat.');
    await expect.poll(opensPanelFromToolbar).toBe(false);
  });

  it('runs without page errors', () => {
    expect(errors).toEqual([]);
  });
});
