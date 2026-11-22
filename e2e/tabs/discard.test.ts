import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LOCAL_ONLY, startAgent, testBridge, type Agent, type Tab } from '../support/harness.ts';

let agent: Agent;
let browser: ChildProcess;
let profile: string;

beforeAll(async () => {
  const { extensionDir } = await testBridge();
  profile = mkdtempSync(join(tmpdir(), 'agent-browser-bridge-e2e-'));
  agent = await startAgent();
  browser = spawn(
    chromium.executablePath(),
    [
      '--headless=new',
      '--no-sandbox',
      '--no-first-run',
      `--user-data-dir=${profile}`,
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
      LOCAL_ONLY,
      'about:blank',
    ],
    { stdio: 'ignore', detached: true },
  );
  await agent.waitUntilConnected();
});

afterAll(async () => {
  await agent?.close();
  if (browser?.pid !== undefined && browser.exitCode === null) {
    const exited = new Promise((done) => browser.once('exit', done));
    process.kill(-browser.pid, 'SIGKILL');
    await exited;
  }
  if (profile) rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

const open = (title: string) => agent.call<Tab>('chrome_tabs_create', { url: `data:text/html,<title>${title}</title>${title}` });

interface DiscardResult {
  discarded: Array<Tab & { discarded: boolean }>;
  failed: Array<{ tabId: number; error: string }>;
}

describe('discarding tabs in a browser without Playwright attached', () => {
  it('discards tabs and reports the ones it could not discard', async () => {
    const first = await open('First');
    const second = await open('Second');

    const result = await agent.call<DiscardResult>('chrome_tabs_discard', { tabIds: [first.id] });
    expect(result.discarded).toEqual([expect.objectContaining({ id: first.id, discarded: true })]);
    expect(result.failed).toEqual([]);

    const again = await agent.call<DiscardResult>('chrome_tabs_discard', { tabIds: [first.id, second.id] });
    expect(again.discarded.map((tab) => tab.id)).toEqual([second.id]);
    expect(again.failed).toEqual([{ tabId: first.id, error: expect.stringMatching(/Cannot discard tab/) }]);

    const listed = await agent.call<Tab[]>('chrome_tabs_list', { discarded: true });
    expect(listed.map((tab) => tab.id).sort()).toEqual([first.id, second.id].sort());

    const copy = await agent.call<Tab>('chrome_tabs_duplicate', { tabId: second.id });
    expect(copy.id).not.toBe(second.id);
  });
});
