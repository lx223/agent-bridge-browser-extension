import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EXTENSION_DIST, LOCAL_ONLY, requireFreeBridge, startAgent, type Agent, type Tab } from './harness.ts';

let agent: Agent;
let browser: ChildProcess;
let profile: string;

beforeAll(async () => {
  await requireFreeBridge();
  profile = mkdtempSync(join(tmpdir(), 'agent-browser-bridge-e2e-'));
  agent = await startAgent();
  browser = spawn(
    chromium.executablePath(),
    [
      '--headless=new',
      '--no-sandbox',
      '--no-first-run',
      `--user-data-dir=${profile}`,
      `--disable-extensions-except=${EXTENSION_DIST}`,
      `--load-extension=${EXTENSION_DIST}`,
      LOCAL_ONLY,
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  await agent.waitUntilConnected();
});

afterAll(async () => {
  await agent?.close();
  if (browser && browser.exitCode === null) {
    const exited = new Promise((done) => browser.once('exit', done));
    browser.kill();
    await exited;
  }
  if (profile) rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

const open = (title: string) => agent.call<Tab>('chrome_open_tab', { url: `data:text/html,<title>${title}</title>${title}` });

interface DiscardResult {
  discarded: Array<Tab & { discarded: boolean }>;
  failed: Array<{ tabId: number; error: string }>;
}

describe('discarding tabs in a browser without Playwright attached', () => {
  it('discards tabs and reports the ones it could not discard', async () => {
    const first = await open('First');
    const second = await open('Second');

    const result = await agent.call<DiscardResult>('chrome_discard_tabs', { tabIds: [first.id] });
    expect(result.discarded).toEqual([expect.objectContaining({ id: first.id, discarded: true })]);
    expect(result.failed).toEqual([]);

    const again = await agent.call<DiscardResult>('chrome_discard_tabs', { tabIds: [first.id, second.id] });
    expect(again.discarded.map((tab) => tab.id)).toEqual([second.id]);
    expect(again.failed).toEqual([{ tabId: first.id, error: expect.stringMatching(/Cannot discard tab/) }]);

    const listed = await agent.call<Tab[]>('chrome_list_tabs', { discarded: true });
    expect(listed.map((tab) => tab.id).sort()).toEqual([first.id, second.id].sort());

    const copy = await agent.call<Tab>('chrome_duplicate_tab', { tabId: second.id });
    expect(copy.id).not.toBe(second.id);
  });
});
