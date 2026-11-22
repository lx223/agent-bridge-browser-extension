import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ASK_USER_TOOL,
  browserApis,
  browsers,
  browserToolName,
  CHAT_RECEIVE_TOOL,
  CHAT_SEND_TOOL,
  IDENTIFY_INSTANCES_TOOL,
  NAME_INSTANCE_TOOL,
  PROTOCOL_VERSION,
  STATUS_TOOL,
} from '@agent-browser-bridge/protocol';
import { EXTENSION_VERSION, startHarness, type Harness, type Tab } from '../support/harness.ts';

let harness: Harness;

beforeAll(async () => {
  harness = await startHarness();
});

afterAll(async () => {
  await harness?.close();
});

describe('connecting an agent to the browser', () => {
  it('connects the packaged extension to the packaged server', async () => {
    const status = await harness.agent.waitUntilConnected();
    expect(status).toMatchObject({
      state: 'connected',
      role: 'host',
      browsers: [{ browser: 'chrome', label: 'Chrome', extensionVersion: EXTENSION_VERSION, protocolVersion: PROTOCOL_VERSION }],
    });
    expect(status.browsers[0]!.instanceId).toMatch(/^[0-9a-f]{8}$/);
  });

  it('exposes the status tool and every browser tool', async () => {
    const { tools } = await harness.agent.client.listTools();
    const expected = [
      STATUS_TOOL,
      IDENTIFY_INSTANCES_TOOL,
      NAME_INSTANCE_TOOL,
      CHAT_SEND_TOOL,
      CHAT_RECEIVE_TOOL,
      ASK_USER_TOOL,
      ...browsers.flatMap((browser) => browserApis[browser].map((method) => browserToolName(browser, method))),
    ];
    expect(tools.map((t) => t.name).sort()).toEqual(expected.sort());
  });

  it('accepts the connected instance id and rejects an unknown one', async () => {
    const { browsers: connected } = await harness.agent.waitUntilConnected();
    const listed = await harness.agent.call<Tab[]>('chrome_tabs_list', { instance: connected[0]!.instanceId });
    expect(listed.length).toBeGreaterThan(0);
    expect((await harness.agent.raw('chrome_tabs_list', { instance: 'missing' })).isError).toBe(true);
    const tagged = await harness.agent.raw('chrome_windows_list');
    expect(tagged.content.at(-1)).toEqual({ type: 'text', text: `Browser instance: ${connected[0]!.instanceId} (Chrome)` });
  });

  it('lets the agent identify the profile, name it, and address it by name', async () => {
    const opened = await harness.openFixture('second.html');
    const { instances } = await harness.agent.call<{ instances: Array<{ instanceId: string; name: string | null; sampleTabs: Array<{ title: string; site: string }> }> }>(
      IDENTIFY_INSTANCES_TOOL,
      { sampleSize: 20 },
    );
    expect(instances).toHaveLength(1);
    expect(instances[0]!.name).toBeNull();
    expect(instances[0]!.sampleTabs.map((tab) => tab.site)).toContain(new URL(harness.fixture('second.html')).hostname);

    const id = instances[0]!.instanceId;
    expect(await harness.agent.call(NAME_INSTANCE_TOOL, { browser: 'chrome', instance: id, name: 'Work' })).toEqual({ browser: 'chrome', instanceId: id, name: 'Work' });
    const { browsers: connected } = await harness.agent.waitUntilConnected();
    expect(connected[0]).toMatchObject({ instanceId: id, name: 'Work' });

    const byName = await harness.agent.raw('chrome_windows_list', { instance: 'work' });
    expect(byName.isError).toBe(false);
    expect(byName.content.at(-1)).toEqual({ type: 'text', text: `Browser instance: "Work" (Chrome, ${id})` });

    await harness.agent.call(NAME_INSTANCE_TOOL, { browser: 'chrome', instance: 'Work', name: '' });
    expect((await harness.agent.waitUntilConnected()).browsers[0]).not.toHaveProperty('name');
    await harness.agent.call('chrome_tabs_close', { tabIds: [opened.id] });
  });

  it('reports Safari as not connected', async () => {
    const result = await harness.agent.raw('safari_tabs_list');
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/not connected in safari/i);
  });
});
