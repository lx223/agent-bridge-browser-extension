import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startAgent, startHarness, type Agent, type Harness, type Tab } from '../support/harness.ts';

let harness: Harness;
const others: Agent[] = [];

beforeAll(async () => {
  harness = await startHarness();
});

afterAll(async () => {
  await Promise.all(others.map((agent) => agent.close().catch(() => {})));
  await harness?.close();
});

const tabs = () => harness.agent.call<Tab[]>('chrome_tabs_list');

async function joinAgent(name: string) {
  const agent = await startAgent(name);
  others.push(agent);
  return agent;
}

describe('several agent sessions sharing one browser', () => {
  it('serves a second agent session through the first', async () => {
    const second = await joinAgent('e2e-second');
    const status = await second.waitUntilConnected();
    expect(status.role).toBe('relay');
    expect((await second.call<Tab[]>('chrome_tabs_list')).map((t) => t.id)).toEqual((await tabs()).map((t) => t.id));
  });

  it('keeps serving the other sessions when the session hosting the bridge ends', async () => {
    const opened = await harness.openFixture('second.html');
    const second = await joinAgent('e2e-survivor');
    expect((await second.waitUntilConnected()).role).toBe('relay');
    await harness.agent.close();
    const listed = await second.call<Tab[]>('chrome_tabs_list');
    expect(listed.map((tab) => tab.id)).toContain(opened.id);
  });
});
