import { describe, expect, it } from 'vitest';
import { toolDefinitions, type Method } from '@agent-browser-bridge/protocol';
import { installFakeDebugger } from '../test/fakeDebugger.ts';
import { dispatch } from './handlers.ts';
import { listenForPageToolEvents } from './pageTools.ts';

type Responder = (params: Record<string, unknown>) => unknown;

const call = (method: Method, params: unknown) => dispatch(method, toolDefinitions[method].params.parse(params));
const searchTool = { name: 'search', description: 'Search the catalogue', inputSchema: { type: 'object' }, frameId: 'main' };

function installPage(tabId: number, tools: object[], responders: (emit: (method: string, params: object) => void) => Record<string, Responder> = () => ({})) {
  const fake = installFakeDebugger({
    'WebMCP.enable': () => {
      fake.emit(tabId, 'WebMCP.toolsAdded', { tools });
      return {};
    },
    ...responders((method, params) => fake.emit(tabId, method, params)),
  });
  listenForPageToolEvents();
  return fake;
}

describe('page tools registered through WebMCP', () => {
  it('lists the tools the page registered without internal fields', async () => {
    installPage(101, [{ ...searchTool, toolId: 't1', annotations: { readOnly: true }, stackTrace: { callFrames: [] } }]);
    expect(await call('page.listTools', { tabId: 101 })).toEqual({
      tools: [{ name: 'search', description: 'Search the catalogue', inputSchema: { type: 'object' }, annotations: { readOnly: true }, frameId: 'main' }],
    });
  });

  it('drops tools from the previous page when listing again', async () => {
    const tools: object[] = [searchTool];
    installPage(102, tools);
    await call('page.listTools', { tabId: 102 });
    tools.splice(0, 1, { ...searchTool, name: 'checkout' });
    const listed = (await call('page.listTools', { tabId: 102 })) as { tools: { name: string }[] };
    expect(listed.tools.map((tool) => tool.name)).toEqual(['checkout']);
  });

  it('explains an empty list', async () => {
    installPage(103, []);
    expect(await call('page.listTools', { tabId: 103 })).toMatchObject({ tools: [], note: expect.stringContaining('snapshot_page') });
  });

  it('reports Chrome versions without the WebMCP domain', async () => {
    installFakeDebugger({
      'WebMCP.enable': () => {
        throw new Error("'WebMCP.enable' wasn't found");
      },
    });
    await expect(call('page.listTools', { tabId: 104 })).rejects.toThrow('does not support WebMCP');
  });

  it('invokes by tool id and returns the output from the response event', async () => {
    const { commands } = installPage(105, [{ ...searchTool, toolId: 't9' }], (emit) => ({
      'WebMCP.invokeTool': () => {
        setTimeout(() => emit('WebMCP.toolResponded', { invocationId: 'i1', status: 'Completed', output: { hits: 3 } }), 0);
        return { invocationId: 'i1' };
      },
    }));
    expect(await call('page.callTool', { tabId: 105, name: 'search', input: { q: 'tea' } })).toEqual({ output: { hits: 3 } });
    expect(commands.at(-1)).toEqual({ method: 'WebMCP.invokeTool', params: { frameId: 'main', toolId: 't9', input: { q: 'tea' } } });
  });

  it('invokes by name when Chrome reports no tool id and accepts a response that arrives first', async () => {
    const { commands } = installPage(106, [searchTool], (emit) => ({
      'WebMCP.invokeTool': () => {
        emit('WebMCP.toolResponded', { invocationId: 'i2', status: 'Completed', output: 'done' });
        return { invocationId: 'i2' };
      },
    }));
    expect(await call('page.callTool', { tabId: 106, name: 'search' })).toEqual({ output: 'done' });
    expect(commands.at(-1)!.params).toEqual({ frameId: 'main', toolName: 'search', input: {} });
  });

  it('surfaces the exception a tool threw', async () => {
    installPage(107, [searchTool], (emit) => ({
      'WebMCP.invokeTool': () => {
        setTimeout(() => emit('WebMCP.toolResponded', { invocationId: 'i3', status: 'Error', errorText: '', exception: { description: 'Error: kaput\n    at execute' } }), 0);
        return { invocationId: 'i3' };
      },
    }));
    await expect(call('page.callTool', { tabId: 107, name: 'search' })).rejects.toThrow('Page tool "search" failed: Error: kaput');
  });

  it('names the available tools when the requested one is missing', async () => {
    installPage(108, [searchTool]);
    await expect(call('page.callTool', { tabId: 108, name: 'buy' })).rejects.toThrow('No page tool named "buy" is registered. Available: search.');
  });

  it('asks for a frame when two frames register the same name', async () => {
    const { commands } = installPage(109, [searchTool, { ...searchTool, frameId: 'child' }], (emit) => ({
      'WebMCP.invokeTool': () => {
        setTimeout(() => emit('WebMCP.toolResponded', { invocationId: 'i4', status: 'Completed' }), 0);
        return { invocationId: 'i4' };
      },
    }));
    await expect(call('page.callTool', { tabId: 109, name: 'search' })).rejects.toThrow('pass frameId, one of: main, child');
    expect(await call('page.callTool', { tabId: 109, name: 'search', frameId: 'child' })).toEqual({ output: null });
    expect(commands.at(-1)!.params).toMatchObject({ frameId: 'child' });
  });

  it('cancels the invocation when the tool does not answer in time', async () => {
    const { commands } = installPage(110, [searchTool], () => ({ 'WebMCP.invokeTool': () => ({ invocationId: 'i5' }) }));
    await expect(call('page.callTool', { tabId: 110, name: 'search', timeoutMs: 10 })).rejects.toThrow('did not answer within 10ms');
    expect(commands.at(-1)).toEqual({ method: 'WebMCP.cancelInvocation', params: { invocationId: 'i5' } });
  });

  it('fails a pending call when the debugger detaches', async () => {
    installPage(111, [searchTool], () => ({ 'WebMCP.invokeTool': () => ({ invocationId: 'i6' }) }));
    const pending = call('page.callTool', { tabId: 111, name: 'search' });
    await new Promise((resolve) => setTimeout(resolve, 10));
    await call('cdp.detach', { tabId: 111 });
    await expect(pending).rejects.toThrow('debugger detached');
  });
});
