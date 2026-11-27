import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  browsers,
  IDENTIFY_INSTANCES_TOOL,
  MAX_INSTANCE_NAME_LENGTH,
  NAME_INSTANCE_TOOL,
  NAME_INSTANCES_PROMPT,
  SET_INSTANCE_NAME_METHOD,
  STATUS_TOOL,
  type HelloMessage,
} from '@agent-browser-bridge/protocol';
import type { BrowserBridge } from './bridge.ts';
import { findInstance } from './instances.ts';

interface ListedTab {
  windowId?: number;
  title?: string;
  url?: string;
  active?: boolean;
  lastAccessed?: number;
}

export interface SampleTab {
  title: string;
  site: string;
}

export interface InstanceSample {
  browser: string;
  label: string;
  instanceId: string | null;
  name: string | null;
  windows?: number;
  tabs?: number;
  sampleTabs?: SampleTab[];
  error?: string;
}

const DEFAULT_SAMPLE_SIZE = 5;
const MAX_TITLE_LENGTH = 80;
const NAME_SYNC_TIMEOUT_MS = 3_000;
const NAME_SYNC_POLL_MS = 50;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

const siteOf = (url: string | undefined) => {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    return parsed.hostname || parsed.protocol.replace(/:$/, '');
  } catch {
    return '';
  }
};

const isWebPage = (tab: ListedTab) => /^https?:/.test(tab.url ?? '');

export function sampleTabs(tabs: ListedTab[], size: number): SampleTab[] {
  const ranked = [...tabs].sort(
    (a, b) =>
      Number(isWebPage(b)) - Number(isWebPage(a)) ||
      Number(b.active ?? false) - Number(a.active ?? false) ||
      (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0),
  );
  return ranked.slice(0, size).map((tab) => ({ title: (tab.title ?? '').slice(0, MAX_TITLE_LENGTH), site: siteOf(tab.url) }));
}

const identifyDescription =
  `Show each connected browser instance with a few of its open tabs, so the user can tell which is which. ` +
  `Use it when the user refers to a browser or profile by a name that no connected instance has, such as "close the Jira tabs in my work Chrome", ` +
  `or when several instances are connected and you cannot tell them apart. Show the user each instance's sample tabs, ask which one they mean, ` +
  `then save their answer with ${NAME_INSTANCE_TOOL} so future requests can use the name.`;

const nameDescription =
  `Give a connected browser instance a name, such as "Work" or "Personal". The name is saved in that browser profile, ` +
  `every agent session sees it, and tools accept it as instance from then on. Only name an instance after the user has confirmed which one it is, ` +
  `usually after showing them ${IDENTIFY_INSTANCES_TOOL}. Pass an empty name to remove it.`;

const promptText = (focus?: string) =>
  [
    `Help me name my connected browser profiles so you can tell them apart.`,
    focus ? `I'm looking for the one I call "${focus}".` : '',
    `1. Call ${IDENTIFY_INSTANCES_TOOL}.`,
    `2. Show me each instance as a short list: its current name if it has one, the browser, and its sample tabs (title and site).`,
    `3. Ask me what to call each unnamed instance, suggesting a name from its tabs where it is obvious, such as "Work" for a company domain.`,
    `4. Once I confirm, call ${NAME_INSTANCE_TOOL} for each one and tell me the names you saved.`,
    `If only one instance is connected, still offer to name it so it is recognised when another profile connects later.`,
  ]
    .filter(Boolean)
    .join('\n');

export function registerNamingTools(server: McpServer, bridge: BrowserBridge, connected: () => HelloMessage[]) {
  server.registerTool(
    IDENTIFY_INSTANCES_TOOL,
    {
      description: identifyDescription,
      inputSchema: {
        browser: z.enum(browsers as [string, ...string[]]).optional().describe('Only show instances of this browser.'),
        sampleSize: z.number().int().min(1).max(20).default(DEFAULT_SAMPLE_SIZE).describe('How many tabs to show per instance.'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ browser, sampleSize }) => {
      const instances = connected().filter((hello) => browser === undefined || hello.browser === browser);
      const samples = await Promise.all(instances.map((hello) => identify(bridge, hello, sampleSize)));
      const note = samples.length ? undefined : `No browser is connected. Call ${STATUS_TOOL} and ask the user to open their browser.`;
      return { content: [{ type: 'text' as const, text: JSON.stringify(note ? { instances: samples, note } : { instances: samples }, null, 2) }] };
    },
  );

  server.registerTool(
    NAME_INSTANCE_TOOL,
    {
      description: nameDescription,
      inputSchema: {
        browser: z.enum(browsers as [string, ...string[]]).describe('The browser the instance belongs to.'),
        instance: z.string().describe(`The instanceId from ${IDENTIFY_INSTANCES_TOOL} or ${STATUS_TOOL}, or the instance's current name.`),
        name: z.string().max(MAX_INSTANCE_NAME_LENGTH).describe('The name the user chose, such as "Work". Empty removes the name.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ browser, instance, name }) => {
      try {
        const instanceId = findInstance(connected(), browser, instance)?.instanceId ?? instance;
        const saved = (await bridge.request(browser, SET_INSTANCE_NAME_METHOD, { name }, undefined, instanceId)) as { name: string | null };
        const synced = await waitForName(connected, instanceId, saved.name);
        const result = { browser, instanceId, name: saved.name, ...(synced ? {} : { note: 'Saved; it may take a few seconds to appear in other tools.' }) };
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        const message = errorMessage(err);
        const outdated = message.includes(`Unknown method: ${SET_INSTANCE_NAME_METHOD}`);
        return {
          content: [
            {
              type: 'text' as const,
              text: outdated
                ? 'This browser runs an older Agent Browser Bridge extension that cannot be named by an agent. Ask the user to update the extension, or to name the profile on the extension setup page.'
                : message,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerPrompt(
    NAME_INSTANCES_PROMPT,
    {
      title: 'Name browser profiles',
      description: 'Identify each connected browser and profile from its open tabs and give it a name, such as Work or Personal.',
      argsSchema: { looking_for: z.string().optional().describe('The name you use for the profile you want, such as "work".') },
    },
    ({ looking_for }) => ({ messages: [{ role: 'user', content: { type: 'text', text: promptText(looking_for) } }] }),
  );
}

async function identify(bridge: BrowserBridge, hello: HelloMessage, size: number): Promise<InstanceSample> {
  const base = {
    browser: hello.browser,
    label: hello.label ?? hello.browser,
    instanceId: hello.instanceId ?? null,
    name: hello.name ?? null,
  };
  if (hello.instanceId === undefined) return { ...base, error: 'This browser runs an older extension without an instance id. Ask the user to update it.' };
  try {
    const tabs = (await bridge.request(hello.browser, 'tabs.list', {}, undefined, hello.instanceId)) as ListedTab[];
    return {
      ...base,
      windows: new Set(tabs.map((tab) => tab.windowId)).size,
      tabs: tabs.length,
      sampleTabs: sampleTabs(tabs, size),
    };
  } catch (err) {
    return { ...base, error: errorMessage(err) };
  }
}

async function waitForName(connected: () => HelloMessage[], instance: string, name: string | null): Promise<boolean> {
  const deadline = Date.now() + NAME_SYNC_TIMEOUT_MS;
  for (;;) {
    const hello = connected().find((candidate) => candidate.instanceId === instance);
    if (hello && (hello.name ?? null) === name) return true;
    if (Date.now() >= deadline) return false;
    await delay(NAME_SYNC_POLL_MS);
  }
}
