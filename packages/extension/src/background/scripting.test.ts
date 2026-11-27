import { afterEach, describe, expect, it, vi } from 'vitest';
import { toolDefinitions } from '@agent-browser-bridge/protocol';
import { dispatch } from './handlers.ts';
import { evaluateInPage } from './scripting.ts';

const call = (params: unknown) => dispatch('scripting.executeScript', toolDefinitions['scripting.executeScript'].params.parse(params));

afterEach(() => vi.unstubAllGlobals());

describe('scripting.executeScript', () => {
  it('runs the code in the main world of the tab and returns each frame result', async () => {
    const executeScript = vi.fn(async () => [
      { frameId: 0, documentId: 'a', result: { result: 'Sign in' } },
      { frameId: 3, documentId: 'b', result: { result: undefined } },
      { frameId: 4, documentId: 'c', result: { error: 'EvalError: eval is blocked' } },
      { frameId: 5, documentId: 'd', result: undefined },
    ]);
    vi.stubGlobal('chrome', { scripting: { executeScript } });

    expect(await call({ tabId: 7, code: 'document.title', allFrames: true })).toEqual([
      { frameId: 0, result: 'Sign in' },
      { frameId: 3, result: null },
      { frameId: 4, error: 'EvalError: eval is blocked' },
      { frameId: 5, result: null },
    ]);
    expect(executeScript).toHaveBeenCalledWith({ target: { tabId: 7, allFrames: true }, world: 'MAIN', func: evaluateInPage, args: ['document.title'] });
  });

  it('runs only in the top frame by default', async () => {
    const executeScript = vi.fn(async () => []);
    vi.stubGlobal('chrome', { scripting: { executeScript } });

    await call({ tabId: 7, code: '1' });

    expect(executeScript).toHaveBeenCalledWith(expect.objectContaining({ target: { tabId: 7, allFrames: false } }));
  });

  it('passes on what Chrome reports when it cannot run the code', async () => {
    vi.stubGlobal('chrome', { scripting: { executeScript: async () => Promise.reject(new Error('Cannot access contents of the page.')) } });

    await expect(call({ tabId: 7, code: '1' })).rejects.toThrow('Cannot access contents of the page.');
  });

  it('explains when the browser has no scripting API', async () => {
    vi.stubGlobal('chrome', {});

    await expect(call({ tabId: 7, code: '1' })).rejects.toThrow('This browser does not support chrome.scripting.');
  });

  it('evaluates the code and returns the value of its last expression', async () => {
    expect(await evaluateInPage('const answer = 6 * 7; answer')).toEqual({ result: 42 });
    expect(await evaluateInPage('Promise.resolve(42)')).toEqual({ result: 42 });
  });

  it('returns what the code threw, since Chrome drops errors from injected scripts', async () => {
    expect(await evaluateInPage(`throw new Error('boom')`)).toEqual({ error: 'Error: boom' });
    expect(await evaluateInPage('Promise.reject(new TypeError("nope"))')).toEqual({ error: 'TypeError: nope' });
  });
});
