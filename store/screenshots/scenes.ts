import { IDENTIFY_INSTANCES_TOOL, NAME_INSTANCE_TOOL } from '@agent-browser-bridge/protocol';
import { refOf, type Harness, type Tab, type TabGroup } from '../../e2e/support/harness.ts';
import type { DemoSite } from './demo.ts';
import { chatCard, FULL_WINDOW, popupBody, scaled, screenshotBody, SIDE_WINDOW, tabGroupsBody, windowCard, type ChatMessage, type Size } from './frame.ts';
import { fill, topics, type Locale, type SceneName, type Topic } from './locale.ts';

export interface SceneContext {
  harness: Harness;
  demo: DemoSite;
  locale: Locale;
}

export type SceneCapture = (context: SceneContext) => Promise<string>;

const PRODUCT_NAME = 'Agent Browser Bridge';
const OPTIONS_POPUP_WIDTH = 420;
const OPTIONS_POPUP_SCALE = 1.45;
const WELCOME_PAGE_SCALE = 0.8;
const TOPIC_COLORS: Record<Topic, string> = { travel: 'blue', work: 'purple', recipes: 'orange' };

const extensionUrl = ({ harness }: SceneContext, path: string) => `chrome-extension://${harness.extensionId}/${path}`;

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const snapshotLine = (snapshot: string, pattern: RegExp) =>
  snapshot
    .split('\n')
    .find((line) => pattern.test(line))!
    .replace(/\s*\[ref=e\d+\]/, '')
    .replace(/^[\s-]+/, '');

async function closeDemoTabs(context: SceneContext) {
  const tabs = await context.harness.agent.call<Tab[]>('chrome_tabs_list');
  const ours = tabs.filter((tab) => tab.url.startsWith(context.demo.url('/')));
  if (ours.length) await context.harness.agent.call('chrome_tabs_close', { tabIds: ours.map((tab) => tab.id) });
}

async function capturePage(context: SceneContext, url: string, size: Size, ready: string) {
  const page = await context.harness.context.newPage();
  try {
    await page.setViewportSize(size);
    await page.goto(url);
    await page.waitForSelector(ready);
    return await page.screenshot();
  } finally {
    await page.close();
  }
}

async function tabs(context: SceneContext) {
  const { harness, demo, locale } = context;
  const text = locale.strings.tabs;
  const longest = Math.max(...topics.map((topic) => text.pages[topic].length));
  const order = Array.from({ length: longest }, (_, index) => topics.map((topic) => ({ topic, index }))).flat();
  const opened = new Map<number, Topic>();
  for (const { topic, index } of order.filter(({ topic, index }) => index < text.pages[topic].length)) {
    const tab = await harness.agent.call<Tab>('chrome_tabs_create', { url: demo.url(demo.tabPath(topic, index)), active: false });
    opened.set(tab.id, topic);
  }

  const plan = topics.map((topic) => ({
    title: text.groups[topic],
    color: TOPIC_COLORS[topic],
    tabIds: [...opened].filter(([, owner]) => owner === topic).map(([id]) => id),
  }));
  await harness.agent.call('chrome_plan_apply', { groups: plan });

  const groups = await harness.agent.call<TabGroup[]>('chrome_tab_groups_list');
  const titles = new Map((await harness.agent.call<Tab[]>('chrome_tabs_list')).map((tab) => [tab.id, tab.title]));
  const views = plan.map(({ title }) => {
    const group = groups.find((candidate) => candidate.title === title)!;
    return { title: group.title, color: group.color, tabs: group.tabIds.map((id) => titles.get(id)!) };
  });
  await closeDemoTabs(context);

  const messages: ChatMessage[] = [
    { kind: 'user', text: text.prompt },
    { kind: 'tool', name: 'chrome_tabs_list' },
    { kind: 'tool', name: 'chrome_plan_apply', detail: views.map((view) => view.title).join(' · ') },
    { kind: 'agent', text: fill(text.reply, { tabs: opened.size, groups: views.length }) },
  ];
  return chatCard(locale.strings.chat, messages) + windowCard({ size: SIDE_WINDOW, body: tabGroupsBody(views) });
}

async function pages(context: SceneContext) {
  const { harness, demo, locale } = context;
  const text = locale.strings.booking;
  const url = demo.url('/booking');
  const tab = await harness.agent.call<Tab>('chrome_tabs_create', { url });
  const page = harness.context.pages().find((candidate) => candidate.url() === url)!;
  await page.setViewportSize(SIDE_WINDOW);

  const snapshot = await harness.agent.text('chrome_page_snapshot', { tabId: tab.id });
  const fields = [
    { pattern: new RegExp(`textbox "${escapeRegExp(text.name)}"`), value: text.guestName },
    { pattern: new RegExp(`spinbutton "${escapeRegExp(text.guests)}"`), value: '4' },
  ];
  const submit = new RegExp(`button "${escapeRegExp(text.submit)}"`);

  const messages: ChatMessage[] = [
    { kind: 'user', text: text.prompt },
    { kind: 'tool', name: 'chrome_page_snapshot', detail: text.restaurant },
  ];
  for (const field of fields) {
    await harness.agent.call('chrome_page_type', { tabId: tab.id, ref: refOf(snapshot, field.pattern), text: field.value });
    messages.push({ kind: 'tool', name: 'chrome_page_type', detail: `${snapshotLine(snapshot, field.pattern)} ← "${field.value}"` });
  }
  await harness.agent.call('chrome_page_click', { tabId: tab.id, ref: refOf(snapshot, submit) });
  messages.push({ kind: 'tool', name: 'chrome_page_click', detail: snapshotLine(snapshot, submit) });
  await page.waitForSelector('#confirmation:not([hidden])');
  messages.push({ kind: 'agent', text: text.reply });

  const shot = await harness.agent.raw('chrome_page_screenshot', { tabId: tab.id });
  const image = shot.content.find((item) => item.type === 'image');
  if (shot.isError || !image?.data) throw new Error(`chrome_page_screenshot failed: ${shot.text}`);
  await closeDemoTabs(context);

  return chatCard(locale.strings.chat, messages) + windowCard({ title: text.restaurant, size: SIDE_WINDOW, body: screenshotBody(Buffer.from(image.data, 'base64'), SIDE_WINDOW) });
}

async function profiles(context: SceneContext) {
  const { harness, locale } = context;
  const text = locale.strings.profiles;
  const { instances } = await harness.agent.call<{ instances: Array<{ instanceId: string }> }>(IDENTIFY_INSTANCES_TOOL, { sampleSize: 5 });
  const instance = instances[0]!.instanceId;
  await harness.agent.call(NAME_INSTANCE_TOOL, { browser: 'chrome', instance, name: text.name });

  const page = await harness.context.newPage();
  let popup: Buffer;
  let height: number;
  try {
    await page.setViewportSize({ width: OPTIONS_POPUP_WIDTH, height: 600 });
    await page.goto(extensionUrl(context, 'src/options/index.html'));
    await page.waitForSelector('#connection[data-state="connected"] #agents li');
    await page.waitForFunction((name) => (document.getElementById('instance-name') as HTMLInputElement | null)?.value === name, text.name);
    const box = (await page.locator('#instance-setting').boundingBox())!;
    height = Math.ceil(box.y + box.height + 16);
    popup = await page.screenshot({ clip: { x: 0, y: 0, width: OPTIONS_POPUP_WIDTH, height } });
  } finally {
    await page.close();
  }

  const messages: ChatMessage[] = [
    { kind: 'user', text: text.prompt },
    { kind: 'tool', name: IDENTIFY_INSTANCES_TOOL },
    { kind: 'tool', name: NAME_INSTANCE_TOOL, detail: `"${text.name}"` },
    { kind: 'agent', text: text.reply },
  ];
  const size = scaled({ width: OPTIONS_POPUP_WIDTH, height }, OPTIONS_POPUP_SCALE);
  return chatCard(locale.strings.chat, messages) + windowCard({ title: PRODUCT_NAME, size: SIDE_WINDOW, body: popupBody(popup, size) });
}

async function setup(context: SceneContext) {
  const viewport = scaled(FULL_WINDOW, 1 / WELCOME_PAGE_SCALE);
  const png = await capturePage(context, extensionUrl(context, 'src/welcome/index.html'), viewport, '#status[data-state="connected"] ~ #agents li');
  return windowCard({ title: PRODUCT_NAME, size: FULL_WINDOW, body: screenshotBody(png, FULL_WINDOW) });
}

export const scenes: Record<SceneName, SceneCapture> = { tabs, pages, profiles, setup };

export const captureOrder: SceneName[] = ['profiles', 'setup', 'tabs', 'pages'];
