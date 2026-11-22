import { existsSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SERVER_PACKAGE } from '@agent-browser-bridge/protocol';
import { EXTENSION_VERSION, startHarness, type Harness } from '../support/harness.ts';

const DIST = resolve(import.meta.dirname, '../../packages/extension/dist');
let harness: Harness;

beforeAll(async () => {
  harness = await startHarness();
});

afterAll(async () => {
  await harness?.close();
});

async function openExtensionPage(path: string) {
  const errors: string[] = [];
  const page = await harness.context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`chrome-extension://${harness.extensionId}/${path}`);
  return { page, errors };
}

describe('the packaged extension', () => {
  it('ships a manifest whose version and files match the build', () => {
    const manifest = JSON.parse(readFileSync(join(DIST, 'manifest.json'), 'utf-8'));
    expect(manifest.version).toBe(EXTENSION_VERSION);
    const referenced = [
      manifest.background.service_worker,
      manifest.options_ui.page,
      manifest.side_panel.default_path,
      ...Object.values<string>(manifest.icons),
      ...Object.values<string>(manifest.action.default_icon),
      'icons/connected-16.png',
      'icons/connected-32.png',
      'src/welcome/index.html',
    ];
    expect(referenced.filter((file) => !existsSync(join(DIST, file)))).toEqual([]);
  });

  it('shows a connected status and setup snippets on the welcome page', async () => {
    const { page, errors } = await openExtensionPage('src/welcome/index.html');
    await page.waitForSelector('#status[data-state="connected"]');
    expect(await page.textContent('#status-text')).toMatch(/^Connected/);
    expect(await page.textContent('#extension-version')).toBe(`v${EXTENSION_VERSION}`);
    await harness.agent.call('chrome_windows_list');
    const session = page.locator('#agents li.session');
    await expect.poll(() => session.locator('.chip').allTextContents()).toEqual(['Chrome, this browser']);
    expect(await session.locator('.session-head strong').textContent()).toBe('e2e 0.0.0');
    expect(await session.locator('.session-project').textContent()).toBe(basename(process.cwd()));
    expect(await session.locator('.session-details').textContent()).toMatch(/^Started just now · Last used chrome_windows_list just now, \d+ calls?$/);
    expect(await session.getAttribute('title')).toMatch(/^Session [0-9a-f-]{36} · server \d+\.\d+\.\d+/);
    const visibleText = await page.locator('main').innerText();
    expect(visibleText).toContain('With Chrome open, ask your agent:');
    expect(visibleText).not.toMatch(/With Safari open|Safari tabs/);
    expect(await page.locator('[data-browser="safari"]:visible').count()).toBe(0);

    expect(await page.textContent('#claude-code-cmd')).toContain(SERVER_PACKAGE);
    expect(JSON.parse((await page.textContent('#json-config'))!)).toBeTypeOf('object');
    expect(await page.getAttribute('#cursor-link', 'href')).toMatch(/^cursor:/);
    expect(await page.getAttribute('#vscode-link', 'href')).toMatch(/^vscode:/);
    expect(errors).toEqual([]);
    await page.close();
  });

  it('names this browser profile from the top of the welcome page', async () => {
    const { page, errors } = await openExtensionPage('src/welcome/index.html');
    const name = page.locator('#instance-name');
    await name.fill('Home');
    await name.press('Enter');
    expect(await page.textContent('#profile-saved')).toBe('Saved');
    expect(await page.textContent('#profile-avatar')).toBe('H');
    await expect.poll(async () => (await harness.agent.raw('chrome_windows_list', { instance: 'home' })).isError).toBe(false);

    await name.fill('');
    await name.press('Enter');
    expect(await page.textContent('#profile-saved')).toBe('Name removed');
    expect(await page.textContent('#profile-avatar')).toBe('');
    expect(errors).toEqual([]);
    await page.close();
  });

  it('renders the options page', async () => {
    const { page, errors } = await openExtensionPage('src/options/index.html');
    await page.waitForSelector('#connection[data-state="connected"] #agents li.session');
    expect(await page.textContent('#agents li .session-head strong')).toBe('e2e 0.0.0');
    expect(await page.getAttribute('#privacy-link', 'href')).toMatch(/PRIVACY\.md$/);
    const settingHidden = await page.locator('#analytics-setting').isHidden();
    const noticeHidden = await page.locator('#analytics-unavailable').isHidden();
    expect(settingHidden).not.toBe(noticeHidden);
    expect(errors).toEqual([]);
    await page.close();
  });

  it('reconnects when a new agent session replaces the old one', async () => {
    const { page } = await openExtensionPage('src/welcome/index.html');
    await page.waitForSelector('#status[data-state="connected"]');

    const agent = await harness.restartAgent();
    const status = await agent.waitUntilConnected();
    expect(status.browsers.map((b) => b.extensionVersion)).toEqual([EXTENSION_VERSION]);
    await page.waitForSelector('#status[data-state="connected"]');
    expect((await agent.call<unknown[]>('chrome_tabs_list')).length).toBeGreaterThan(0);
    await page.close();
  });
});
