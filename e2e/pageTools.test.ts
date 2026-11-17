import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness, type Harness } from './harness.ts';

interface ListedTools {
  tools: { name: string; description: string; inputSchema?: { required?: string[] }; frameId: string }[];
  note?: string;
}

let harness: Harness;
let tabId: number;

beforeAll(async () => {
  harness = await startHarness();
  tabId = (await harness.openFixture('tools.html')).id;
});

afterAll(async () => {
  await harness?.close();
});

const callTool = (args: Record<string, unknown>) => harness.agent.raw('chrome_call_page_tool', { tabId, ...args });

describe('WebMCP page tools through the built server and extension', () => {
  it('lists the tools the page registered', async () => {
    const { tools, note } = await harness.agent.call<ListedTools>('chrome_list_page_tools', { tabId });
    expect(note).toBeUndefined();
    expect(tools.map((tool) => tool.name).sort()).toEqual(['add', 'explode', 'stall']);
    const add = tools.find((tool) => tool.name === 'add')!;
    expect(add.description).toBe('Add two numbers');
    expect(add.inputSchema?.required).toEqual(['a', 'b']);
    expect(add.frameId).toMatch(/\S/);
  });

  it('calls a tool and returns what the page returned', async () => {
    const result = await harness.agent.call<{ output: unknown }>('chrome_call_page_tool', { tabId, name: 'add', input: { a: 2, b: 3 } });
    expect(result.output).toEqual({ content: [{ type: 'text', text: '5' }] });
    const { value } = await harness.agent.call<{ value: string }>('chrome_evaluate', {
      tabId,
      expression: `document.getElementById('status').textContent`,
    });
    expect(value).toBe('added 2 and 3');
  });

  it('reports the error a tool threw', async () => {
    const result = await callTool({ name: 'explode' });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('Page tool "explode" failed: Error: kaput');
  });

  it('names the registered tools when asked for an unknown one', async () => {
    const result = await callTool({ name: 'missing' });
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/No page tool named "missing" is registered\. Available: .*add/);
  });

  it('gives up on a tool that does not answer in time', async () => {
    const result = await callTool({ name: 'stall', timeoutMs: 500 });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('did not answer within 500ms');
  });

  it('returns an empty list with a note after navigating to a page without tools', async () => {
    await harness.agent.call('chrome_navigate', { tabId, to: harness.fixture('second.html') });
    const { tools, note } = await harness.agent.call<ListedTools>('chrome_list_page_tools', { tabId });
    expect(tools).toEqual([]);
    expect(note).toContain('chrome_snapshot_page');
  });
});
