import type { ParamsOf } from '@agent-browser-bridge/protocol';
import { onSessionEnded, send } from './debugger.ts';

interface PageTool {
  toolId?: string;
  name: string;
  description: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
  annotations?: Record<string, boolean>;
  frameId: string;
}

interface RemovedTool {
  toolId?: string;
  name: string;
  frameId: string;
}

interface ToolResponse {
  invocationId: string;
  status: 'Completed' | 'Canceled' | 'Error';
  output?: unknown;
  errorText?: string;
  exception?: { description?: string };
}

interface Invocations {
  starting: number;
  early: Map<string, ToolResponse>;
  waiting: Map<string, (response: ToolResponse) => void>;
  failures: Set<(err: Error) => void>;
}

const NO_TOOLS_NOTE =
  'This page has not registered any WebMCP tools. Use chrome_snapshot_page and the input tools instead. Tools inside cross-origin iframes are not listed.';

const toolsByTab = new Map<number, Map<string, PageTool>>();
const refreshes = new Map<number, Promise<PageTool[]>>();
const invocationsByTab = new Map<number, Invocations>();

const toolKey = (tool: RemovedTool) => tool.toolId ?? `${tool.frameId}\n${tool.name}`;
const isUnsupportedError = (err: unknown) => err instanceof Error && /wasn't found|not found|unknown (command|method)/i.test(err.message);

function toolsFor(tabId: number): Map<string, PageTool> {
  let tools = toolsByTab.get(tabId);
  if (!tools) toolsByTab.set(tabId, (tools = new Map()));
  return tools;
}

function invocationsFor(tabId: number): Invocations {
  let invocations = invocationsByTab.get(tabId);
  if (!invocations) {
    invocations = { starting: 0, early: new Map(), waiting: new Map(), failures: new Set() };
    invocationsByTab.set(tabId, invocations);
  }
  return invocations;
}

function handleEvent(source: chrome.debugger.Debuggee, method: string, params?: object) {
  const tabId = source.tabId;
  if (tabId === undefined || !method.startsWith('WebMCP.')) return;
  if (method === 'WebMCP.toolsAdded') {
    for (const tool of (params as { tools: PageTool[] }).tools) toolsFor(tabId).set(toolKey(tool), tool);
  } else if (method === 'WebMCP.toolsRemoved') {
    for (const tool of (params as { tools: RemovedTool[] }).tools) toolsFor(tabId).delete(toolKey(tool));
  } else if (method === 'WebMCP.toolResponded') {
    const response = params as ToolResponse;
    const invocations = invocationsByTab.get(tabId);
    if (!invocations) return;
    const deliver = invocations.waiting.get(response.invocationId);
    if (deliver) deliver(response);
    else if (invocations.starting > 0) invocations.early.set(response.invocationId, response);
  }
}

function handleSessionEnded(tabId: number) {
  toolsByTab.delete(tabId);
  const invocations = invocationsByTab.get(tabId);
  invocationsByTab.delete(tabId);
  for (const fail of invocations?.failures ?? []) fail(new Error('The debugger detached from the tab before the page tool answered.'));
}

export function listenForPageToolEvents() {
  chrome.debugger?.onEvent.addListener(handleEvent);
  onSessionEnded(handleSessionEnded);
}

async function loadTools(tabId: number): Promise<PageTool[]> {
  toolsFor(tabId).clear();
  try {
    await send(tabId, 'WebMCP.enable');
  } catch (err) {
    if (isUnsupportedError(err)) throw new Error('This version of Chrome does not support WebMCP page tools.');
    throw err;
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
  return [...toolsFor(tabId).values()];
}

function refreshTools(tabId: number): Promise<PageTool[]> {
  const running = refreshes.get(tabId);
  if (running) return running;
  const refresh = loadTools(tabId).finally(() => refreshes.delete(tabId));
  refreshes.set(tabId, refresh);
  return refresh;
}

function describeTool({ name, description, inputSchema, outputSchema, annotations, frameId }: PageTool) {
  return {
    name,
    description,
    ...(inputSchema !== undefined && { inputSchema }),
    ...(outputSchema !== undefined && { outputSchema }),
    ...(annotations !== undefined && { annotations }),
    frameId,
  };
}

function pickTool(tools: PageTool[], name: string, frameId: string | undefined): PageTool {
  const matches = tools.filter((tool) => tool.name === name && (frameId === undefined || tool.frameId === frameId));
  if (matches.length === 1) return matches[0]!;
  if (matches.length > 1) {
    throw new Error(`Several frames register a page tool named "${name}"; pass frameId, one of: ${matches.map((tool) => tool.frameId).join(', ')}.`);
  }
  const available = tools.map((tool) => tool.name).join(', ');
  throw new Error(`No page tool named "${name}" is registered${frameId ? ` in frame ${frameId}` : ''}. ${available ? `Available: ${available}.` : NO_TOOLS_NOTE}`);
}

function failureMessage(name: string, response: ToolResponse): string {
  if (response.status === 'Canceled') return `Page tool "${name}" was cancelled.`;
  const reason = response.errorText || response.exception?.description?.split('\n')[0] || 'unknown error';
  return `Page tool "${name}" failed: ${reason}`;
}

export async function listPageTools({ tabId }: ParamsOf<'page.listTools'>) {
  const tools = (await refreshTools(tabId)).map(describeTool);
  return tools.length ? { tools } : { tools, note: NO_TOOLS_NOTE };
}

export async function callPageTool({ tabId, name, input, frameId, timeoutMs }: ParamsOf<'page.callTool'>) {
  const tool = pickTool(await refreshTools(tabId), name, frameId);
  const invocations = invocationsFor(tabId);
  let invocationId: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let fail: (err: Error) => void = () => {};
  const interrupted = new Promise<never>((_, reject) => (fail = reject));
  interrupted.catch(() => {});
  invocations.failures.add(fail);
  invocations.starting++;
  try {
    const started = send<{ invocationId: string }>(tabId, 'WebMCP.invokeTool', {
      frameId: tool.frameId,
      ...(tool.toolId !== undefined ? { toolId: tool.toolId } : { toolName: tool.name }),
      input,
    }).finally(() => invocations.starting--);
    ({ invocationId } = await Promise.race([started, interrupted]));
    const id = invocationId;
    const early = invocations.early.get(id);
    if (invocations.starting === 0) invocations.early.clear();
    const responded = early ? Promise.resolve(early) : new Promise<ToolResponse>((resolve) => invocations.waiting.set(id, resolve));
    timer = setTimeout(() => {
      void send(tabId, 'WebMCP.cancelInvocation', { invocationId: id }).catch(() => {});
      fail(new Error(`Page tool "${name}" did not answer within ${timeoutMs}ms.`));
    }, timeoutMs);
    const response = await Promise.race([responded, interrupted]);
    if (response.status !== 'Completed') throw new Error(failureMessage(name, response));
    return { output: response.output ?? null };
  } finally {
    clearTimeout(timer);
    invocations.failures.delete(fail);
    if (invocationId !== undefined) invocations.waiting.delete(invocationId);
  }
}
