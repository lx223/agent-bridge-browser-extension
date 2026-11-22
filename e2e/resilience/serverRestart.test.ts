import { execFileSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SERVER_RUNS_LAUNCHER, startHarness, type Harness, type Tab } from '../support/harness.ts';

let harness: Harness;

beforeAll(async () => {
  harness = await startHarness();
});

afterAll(async () => {
  await harness?.close();
});

function workerPid(): number {
  const launcher = harness.agent.serverPid();
  if (launcher === null) throw new Error('The MCP server is not running');
  const children = execFileSync('pgrep', ['-P', String(launcher)], { encoding: 'utf-8' }).trim().split('\n').filter(Boolean).map(Number);
  if (children.length !== 1) throw new Error(`Expected one server process under the launcher, found ${children.length}`);
  return children[0]!;
}

async function stopWorker() {
  const pid = workerPid();
  process.kill(pid, 'SIGKILL');
  await expect.poll(() => {
    try {
      return workerPid() !== pid;
    } catch {
      return false;
    }
  }, { timeout: 10_000 }).toBe(true);
}

describe.runIf(SERVER_RUNS_LAUNCHER)('when the MCP server process stops in the middle of a session', () => {
  it('starts a new one and keeps answering the agent', async () => {
    const opened = await harness.openFixture('second.html');
    const before = workerPid();
    await stopWorker();
    const listed = await harness.agent.call<Tab[]>('chrome_tabs_list');
    expect(listed.map((tab) => tab.id)).toContain(opened.id);
    expect(workerPid()).not.toBe(before);
  });

  it('tells the agent that a tool it cut off may or may not have finished', async () => {
    const tab = await harness.openFixture('form.html');
    const waiting = harness.agent.raw('chrome_tabs_wait_for', { tabId: tab.id, url: '*never*', timeoutMs: 60_000 }).catch((err: Error) => err);
    await new Promise((resolve) => setTimeout(resolve, 300));
    await stopWorker();
    expect(await waiting).toHaveProperty('message', expect.stringMatching(/may or may not have taken effect/));
    expect((await harness.agent.call<Tab[]>('chrome_tabs_list')).map((t) => t.id)).toContain(tab.id);
  });
});
