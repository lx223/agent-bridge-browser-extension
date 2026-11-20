import { describe, expect, it } from 'vitest';
import { toolDefinitions, type Method } from '@agent-browser-bridge/protocol';
import { installFakeDebugger } from '../test/fakeDebugger.ts';
import { dispatch } from './handlers.ts';

const call = (method: Method, params: unknown) => dispatch(method, toolDefinitions[method].params.parse(params));

describe('page tools', () => {
  it('clicks the centre of an element after scrolling it into view', async () => {
    const { commands } = installFakeDebugger({
      'DOM.getContentQuads': () => ({ quads: [[10, 20, 30, 20, 30, 40, 10, 40]] }),
    });
    expect(await call('page.click', { tabId: 1, ref: 'e7' })).toEqual({ clicked: { x: 20, y: 30 } });
    expect(commands.map((c) => `${c.method}${c.params.type ? `:${c.params.type}` : ''}`)).toEqual([
      'DOM.scrollIntoViewIfNeeded',
      'DOM.getContentQuads',
      'Input.dispatchMouseEvent:mouseMoved',
      'Input.dispatchMouseEvent:mousePressed',
      'Input.dispatchMouseEvent:mouseReleased',
    ]);
    expect(commands[0]!.params).toEqual({ backendNodeId: 7 });
  });

  it.each([
    ['DOM.scrollIntoViewIfNeeded', 'No node with given id found'],
    ['DOM.scrollIntoViewIfNeeded', '{"code":-32000,"message":"No node found for given backend id"}'],
    ['DOM.scrollIntoViewIfNeeded', '{"code":-32000,"message":"Node is detached from document"}'],
    ['DOM.scrollIntoViewIfNeeded', '{"code":-32000,"message":"Node does not have a layout object"}'],
    ['DOM.getContentQuads', '{"code":-32000,"message":"Could not find node with given id"}'],
  ])('explains stale refs when %s fails with %s', async (method, message) => {
    installFakeDebugger({
      [method]: () => {
        throw new Error(message);
      },
    });
    const hint = 'Element e9 no longer exists; take a new chrome_page_snapshot.';
    await expect(call('page.hover', { tabId: 2, ref: 'e9' })).rejects.toThrow(hint);
    await expect(call('page.click', { tabId: 2, ref: 'e9' })).rejects.toThrow(hint);
    await expect(call('page.scroll', { tabId: 2, ref: 'e9', deltaY: 100 })).rejects.toThrow(hint);
  });

  it.each(['Node is detached from document', 'Node does not have a layout object'])('explains stale refs when typing fails with %s', async (message) => {
    installFakeDebugger({
      'DOM.focus': () => {
        throw new Error(JSON.stringify({ code: -32000, message }));
      },
    });
    await expect(call('page.type', { tabId: 2, ref: 'e9', text: 'hello' })).rejects.toThrow('Element e9 no longer exists; take a new chrome_page_snapshot.');
  });

  it('leaves unrelated debugger errors untouched', async () => {
    const message = '{"code":-32000,"message":"Cannot find context with specified id"}';
    installFakeDebugger({
      'DOM.scrollIntoViewIfNeeded': () => {
        throw new Error(message);
      },
    });
    await expect(call('page.hover', { tabId: 2, ref: 'e9' })).rejects.toThrow(message);
  });

  it('focuses, clears, inserts text and submits', async () => {
    const { commands } = installFakeDebugger({ 'DOM.resolveNode': () => ({ object: { objectId: 'obj-1' } }) });
    await call('page.type', { tabId: 3, ref: 'e5', text: 'hello', clear: true, submit: true });
    expect(commands.map((c) => c.method)).toEqual([
      'DOM.scrollIntoViewIfNeeded',
      'DOM.focus',
      'DOM.resolveNode',
      'Runtime.callFunctionOn',
      'Input.insertText',
      'Input.dispatchKeyEvent',
      'Input.dispatchKeyEvent',
    ]);
    expect(commands[4]!.params).toEqual({ text: 'hello' });
  });

  it('formats the accessibility tree with a page header', async () => {
    installFakeDebugger({
      'Accessibility.getFullAXTree': () => ({
        nodes: [{ nodeId: '1', ignored: false, role: { value: 'RootWebArea' }, name: { value: 'Example' }, backendDOMNodeId: 1 }],
      }),
    });
    expect(await call('page.snapshot', { tabId: 4 })).toBe('Page: Example\nURL: https://example.com/\n\n- RootWebArea "Example" [ref=e1]');
  });

  it('returns screenshots as images', async () => {
    installFakeDebugger({ 'Page.captureScreenshot': () => ({ data: 'aW1n' }) });
    expect(await call('page.screenshot', { tabId: 5, format: 'jpeg' })).toEqual({ data: 'aW1n', mimeType: 'image/jpeg' });
  });

  it('surfaces exceptions from evaluate', async () => {
    installFakeDebugger({
      'Runtime.evaluate': () => ({ result: { type: 'object' }, exceptionDetails: { text: 'Uncaught', exception: { description: 'ReferenceError: x' } } }),
    });
    await expect(call('page.evaluate', { tabId: 6, expression: 'x' })).rejects.toThrow('ReferenceError: x');
  });

  it('re-attaches when Chrome dropped the debugger session', async () => {
    const { attachedTabs, commands } = installFakeDebugger();
    await call('cdp.send', { tabId: 8, method: 'Page.enable' });
    attachedTabs.delete(8);
    await call('cdp.send', { tabId: 8, method: 'Page.reload' });
    expect(commands.map((c) => c.method)).toEqual(['Page.enable', 'Page.reload']);
    expect(await call('cdp.detach', { tabId: 8 })).toEqual({ detached: true });
  });
});
