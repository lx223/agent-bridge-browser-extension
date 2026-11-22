import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentSession } from '@agent-browser-bridge/protocol';
import { EXTENSION_DIST } from '../../e2e/support/harness.ts';
import { openSetupPageAsSafari } from '../../e2e/support/safari/setupPage.ts';
import { FULL_WINDOW, PRODUCT_NAME, scaled, screenshotBody, SIDE_WINDOW, type ChatMessage, type Slide, type Stage } from './frame.ts';
import { escapeHtml } from './html.ts';
import type { Caption } from './locale.ts';

const WELCOME_PAGE_SCALE = 0.8;
const CAPTURE_SCALE = 2;
const EXTENSION_ORIGIN = 'safari-web-extension://5f0c2b7e-8d4a-4c1e-9b63-2a7d1e4f8c90';
const INSTANCE_ID = '7c3e9a14';
const SERVER_VERSION: string = JSON.parse(readFileSync(join(import.meta.dirname, '../../packages/server/package.json'), 'utf-8')).version;

const CAPTIONS = {
  setup: {
    headline: 'Connect Safari to the agent you already use',
    subline: 'Claude Code, Cursor, VS Code, Claude Desktop or any MCP client. Everything runs on your Mac.',
  },
  tabs: {
    headline: 'Let your AI agent manage Safari tabs',
    subline: 'List, open, navigate, move and close tabs and windows in the Safari you already use.',
  },
} satisfies Record<string, Caption>;

export const SAFARI_VIDEO = {
  tagline: 'Let your AI agent use the Safari you already use.',
  closing: 'Works with Claude Code, Cursor, VS Code and any MCP client. Everything runs on your Mac.',
};

const SEARCH_COLOR = '#8e8e93';

const TABS = {
  prompt: 'Open the Lisbon trip pages and close the old search tabs.',
  reply: 'Done. I opened 3 pages for your Lisbon trip and closed 2 old search tabs.',
  createdUrl: 'https://flights.example.com/lisbon',
  closed: '2 tabs',
  searches: [
    { title: 'lisbon flights – Search', url: 'search.example.com/?q=lisbon+flights', color: SEARCH_COLOR, active: true },
    { title: 'alfama hotels – Search', url: 'search.example.com/?q=alfama+hotels', color: SEARCH_COLOR, active: false },
  ],
  pages: [
    { title: 'Flights to Lisbon – compare prices', url: 'flights.example.com/lisbon', color: '#0a84ff', active: true },
    { title: 'Hotels in Alfama', url: 'stays.example.com/lisbon/alfama', color: '#30a46c', active: false },
    { title: 'Lisbon: top 10 things to do', url: 'guides.example.com/lisbon/top-10', color: '#f76b15', active: false },
  ],
};

interface SafariTabView {
  title: string;
  url: string;
  color: string;
  active: boolean;
}

const tabListStyles = `
  .safari-tabs { padding: 18px 22px; display: flex; flex-direction: column; gap: 14px; background: #f8fafc; height: 100%; }
  .safari-tabs .address { display: flex; align-items: center; gap: 10px; padding-bottom: 14px; border-bottom: 1px solid #e2e8f0; }
  .safari-tabs .url { flex: 1; min-width: 0; font-size: 14px; color: #334155; background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 7px 12px; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .safari-tabs .count { flex: none; color: #fff; background: #0a84ff; font-size: 13px; font-weight: 600; padding: 4px 10px; border-radius: 8px; white-space: nowrap; }
  .safari-tabs h3 { margin: 0; font-size: 15px; color: #0f172a; }
  .safari-tabs ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
  .safari-tabs li { display: flex; align-items: center; gap: 12px; background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px 14px; }
  .safari-tabs li.active { border-color: #0a84ff; box-shadow: 0 0 0 1px #0a84ff; }
  .safari-tabs li i { flex: none; width: 28px; height: 28px; border-radius: 7px; color: #fff; font: 600 14px/28px system-ui, sans-serif; text-align: center; font-style: normal; }
  .safari-tabs li div { min-width: 0; flex: 1; }
  .safari-tabs li b { display: block; font-size: 15px; font-weight: 600; color: #0f172a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .safari-tabs li small { display: block; margin-top: 2px; font-size: 13px; color: #64748b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
`;

function safariTabsBody(tabs: SafariTabView[]) {
  const active = tabs.find((tab) => tab.active) ?? tabs[0]!;
  const items = tabs.map(
    (tab) =>
      `<li class="${tab.active ? 'active' : ''}"><i style="background: ${tab.color}">${escapeHtml([...tab.title][0] ?? '')}</i><div><b>${escapeHtml(tab.title)}</b><small>${escapeHtml(tab.url)}</small></div></li>`,
  );
  return `<style>${tabListStyles}</style><div class="safari-tabs" data-fit><div class="address"><span class="url">${escapeHtml(active.url)}</span><span class="count">${tabs.length} tabs</span></div><h3>Window 1</h3><ul>${items.join('')}</ul></div>`;
}

function connectedStatus() {
  const now = Date.now();
  const session: AgentSession = {
    serverVersion: SERVER_VERSION,
    client: { name: 'claude-code', version: '2.1.0' },
    sessionId: 'safari-screenshot-session',
    startedAt: now - 12 * 60_000,
    project: { name: 'trip-planner', path: '/Users/me/trip-planner' },
    activity: {
      lastUsedAt: now - 5_000,
      lastTool: 'safari_tabs_list',
      calls: 6,
      instances: [{ browser: 'safari', instanceId: INSTANCE_ID, label: 'Safari' }],
    },
  };
  return { state: 'connected', url: 'ws://127.0.0.1:17373', since: now - 12 * 60_000, agents: [session], instanceId: INSTANCE_ID };
}

async function answer(message: unknown) {
  const type = (message as { type?: unknown } | null)?.type;
  if (type === 'GET_STATUS' || type === 'RECONNECT') return connectedStatus();
  return undefined;
}

async function setup() {
  const viewport = scaled(FULL_WINDOW, 1 / WELCOME_PAGE_SCALE);
  const setupPage = await openSetupPageAsSafari({ extensionDir: EXTENSION_DIST, extensionOrigin: EXTENSION_ORIGIN, sendMessage: answer });
  try {
    const { page } = setupPage;
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setDeviceMetricsOverride', { ...viewport, deviceScaleFactor: CAPTURE_SCALE, mobile: false });
    await page.setViewportSize(viewport);
    await page.waitForSelector('#status[data-state="connected"] ~ #agents li');
    await page.evaluate(() => document.fonts.ready);
    const visibleText = await page.locator('main').innerText();
    if (!visibleText.includes('Safari') || /With Chrome open|chrome_plan_apply/.test(visibleText)) {
      throw new Error('The setup page did not switch to the Safari wording.');
    }
    if (setupPage.errors.length) throw new Error(`The setup page reported errors: ${setupPage.errors.join('; ')}`);
    const png = await page.screenshot();
    return { messages: [], window: { title: PRODUCT_NAME, size: FULL_WINDOW, states: [{ step: 0, body: screenshotBody(png, FULL_WINDOW) }] } } satisfies Stage;
  } finally {
    await setupPage.close();
  }
}

function tabs(): Stage {
  const messages: ChatMessage[] = [
    { kind: 'user', text: TABS.prompt },
    { kind: 'tool', name: 'safari_tabs_list' },
    { kind: 'tool', name: 'safari_tabs_create', detail: TABS.createdUrl },
    { kind: 'tool', name: 'safari_tabs_close', detail: TABS.closed },
    { kind: 'agent', text: TABS.reply },
  ];
  const inactive = (tab: SafariTabView) => ({ ...tab, active: false });
  return {
    messages,
    window: {
      title: 'Safari',
      size: SIDE_WINDOW,
      states: [
        { step: 0, body: safariTabsBody(TABS.searches) },
        { step: 2, body: safariTabsBody([...TABS.searches.map(inactive), ...TABS.pages]) },
        { step: 3, body: safariTabsBody(TABS.pages) },
      ],
    },
  };
}

export async function safariSlides(): Promise<Array<Slide & { file: string }>> {
  return [
    { file: '1-setup', caption: CAPTIONS.setup, stage: await setup() },
    { file: '2-tabs', caption: CAPTIONS.tabs, stage: tabs() },
  ];
}
