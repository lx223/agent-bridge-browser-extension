import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NAME_INSTANCE_TOOL, STATUS_TOOL } from '@agent-browser-bridge/protocol';
import { startHarness, type BridgeStatus, type BrowserProfile, type Harness, type Tab } from '../support/harness.ts';

let harness: Harness;
let second: BrowserProfile;
let firstId: string;
let secondId: string;

const status = () => harness.agent.call<BridgeStatus>(STATUS_TOOL);
const instanceIds = async () => (await status()).browsers.map((hello) => hello.instanceId!);
const tabUrls = async (instance: string) => (await harness.agent.call<Tab[]>('chrome_tabs_list', { instance })).map((tab) => tab.url);

async function secondInstance(): Promise<string> {
  const deadline = Date.now() + 20_000;
  for (;;) {
    const other = (await instanceIds()).find((id) => id !== firstId);
    if (other) return other;
    if (Date.now() > deadline) throw new Error('The second profile did not connect');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

beforeAll(async () => {
  harness = await startHarness();
  [firstId] = await instanceIds();
  second = await harness.openAnotherProfile();
  secondId = await secondInstance();
});

afterAll(async () => {
  await harness?.close();
});

describe('two Chrome profiles connected at once', () => {
  it('gives each profile its own instance', () => {
    expect(firstId).toMatch(/^[0-9a-f]{8}$/);
    expect(secondId).toMatch(/^[0-9a-f]{8}$/);
    expect(secondId).not.toBe(firstId);
  });

  it('asks which profile to use when the session has not picked one', async () => {
    const result = await harness.agent.raw('chrome_tabs_list');
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/Several chrome instances are connected.*Pass instance/);
  });

  it('opens and lists tabs in the profile it is given, and stays on it', async () => {
    const opened = await harness.agent.call<Tab>('chrome_tabs_create', { url: harness.fixture('second.html'), instance: secondId });
    expect(await tabUrls(firstId)).not.toContain(opened.url);
    expect(await tabUrls(secondId)).toContain(opened.url);
    expect(second.context.pages().map((page) => page.url())).toContain(opened.url);

    const stayed = await harness.agent.raw('chrome_tabs_list');
    expect(stayed.isError).toBe(false);
    expect(stayed.content.at(-1)).toEqual({ type: 'text', text: `Browser instance: ${secondId} (Chrome)` });
  });

  it('addresses a profile by the name the user gave it', async () => {
    await harness.agent.call(NAME_INSTANCE_TOOL, { browser: 'chrome', instance: firstId, name: 'Work' });
    const byName = await harness.agent.raw('chrome_windows_list', { instance: 'work' });
    expect(byName.isError).toBe(false);
    expect(byName.content.at(-1)).toEqual({ type: 'text', text: `Browser instance: "Work" (Chrome, ${firstId})` });
  });

  it('drops a profile from the status once its browser closes', async () => {
    await second.close();
    await expect.poll(instanceIds, { timeout: 20_000 }).toEqual([firstId]);
  });
});
