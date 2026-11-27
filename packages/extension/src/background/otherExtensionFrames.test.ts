import { describe, expect, it } from 'vitest';
import { toolDefinitions, type Method } from '@agent-browser-bridge/protocol';
import { installFakeDebugger } from '../test/fakeDebugger.ts';
import { putBackOtherExtensionFramesInPage, setAsideOtherExtensionFramesInPage } from './framesInPage.ts';
import { dispatch } from './handlers.ts';
import { BLOCKED_BY_OTHER_EXTENSION, isBlockedByOtherExtension } from './otherExtensionFrames.ts';

const call = (method: Method, params: unknown) => dispatch(method, toolDefinitions[method].params.parse(params));

const REFUSAL = 'Cannot access a chrome-extension:// URL of different extension';
const OWN_ORIGIN = 'chrome-extension://ownextensionid/';

interface Injection {
  tabId: number;
  allFrames: boolean;
  func: unknown;
  args: unknown[];
}

function installTabWithOtherExtensionFrame(options: { framesFound?: number; reinjections?: number; scripting?: boolean } = {}) {
  const fake = installFakeDebugger({
    'Accessibility.getFullAXTree': () => ({ nodes: [{ nodeId: '1', ignored: false, role: { value: 'RootWebArea' }, name: { value: 'Sign in' }, backendDOMNodeId: 1 }] }),
    'Page.captureScreenshot': () => ({ data: 'aW1n' }),
  });
  const chromeApi = (globalThis as unknown as { chrome: Record<string, any> }).chrome;
  const page = { framesInPage: 1, framesSetAside: 0, reinjectionsLeft: options.reinjections ?? 0 };
  const injections: Injection[] = [];
  const refuseWhileFramed = <A extends unknown[], R>(original: (...args: A) => Promise<R>) =>
    async (...args: A) => {
      if (page.framesInPage > 0) throw new Error(REFUSAL);
      return original(...args);
    };
  chromeApi.debugger.attach = refuseWhileFramed(chromeApi.debugger.attach);
  chromeApi.debugger.sendCommand = refuseWhileFramed(chromeApi.debugger.sendCommand);
  chromeApi.runtime = { getURL: (path: string) => `${OWN_ORIGIN}${path}` };
  if (options.scripting !== false) {
    chromeApi.scripting = {
      executeScript: async ({ target, func, args = [] }: { target: { tabId: number; allFrames: boolean }; func: unknown; args?: unknown[] }) => {
        injections.push({ tabId: target.tabId, allFrames: target.allFrames, func, args });
        if (func === setAsideOtherExtensionFramesInPage) {
          const found = options.framesFound ?? page.framesInPage;
          page.framesSetAside += found;
          page.framesInPage -= found;
          if (page.reinjectionsLeft > 0) {
            page.reinjectionsLeft--;
            page.framesInPage++;
          }
          return [{ frameId: 0, result: found }];
        }
        page.framesInPage += page.framesSetAside;
        const putBack = page.framesSetAside;
        page.framesSetAside = 0;
        return [{ frameId: 0, result: putBack }];
      },
    };
  }
  return { ...fake, page, injections };
}

const injectedFunctions = (injections: Injection[]) =>
  injections.map((injection) => (injection.func === setAsideOtherExtensionFramesInPage ? 'setAside' : injection.func === putBackOtherExtensionFramesInPage ? 'putBack' : 'other'));

describe('pages with frames from other extensions', () => {
  it('recognises the refusal Chrome gives for another extension frame', () => {
    expect(isBlockedByOtherExtension(new Error(REFUSAL))).toBe(true);
    expect(isBlockedByOtherExtension(new Error('Debugger is not attached to the tab with id: 1.'))).toBe(false);
    expect(isBlockedByOtherExtension(REFUSAL)).toBe(false);
  });

  it('snapshots the page by setting the other extension frame aside, then puts it back', async () => {
    const { page, injections, commands } = installTabWithOtherExtensionFrame();

    expect(await call('page.snapshot', { tabId: 41 })).toBe('Page: Example\nURL: https://example.com/\n\n- RootWebArea "Sign in" [ref=e1]');

    expect(commands.map((c) => c.method)).toEqual(['Accessibility.getFullAXTree']);
    expect(injectedFunctions(injections)).toEqual(['setAside', 'putBack']);
    expect(injections.every((injection) => injection.tabId === 41 && injection.allFrames)).toBe(true);
    expect(injections[0]!.args).toEqual([OWN_ORIGIN]);
    expect(page).toMatchObject({ framesInPage: 1, framesSetAside: 0 });
  });

  it('takes a screenshot by setting the other extension frame aside, then puts it back', async () => {
    const { page, injections } = installTabWithOtherExtensionFrame();

    expect(await call('page.screenshot', { tabId: 42 })).toEqual({ data: 'aW1n', mimeType: 'image/png' });

    expect(injectedFunctions(injections)).toEqual(['setAside', 'putBack']);
    expect(page).toMatchObject({ framesInPage: 1, framesSetAside: 0 });
  });

  it('sets frames aside again when the other extension adds its frame back', async () => {
    const { page, injections } = installTabWithOtherExtensionFrame({ reinjections: 1 });

    expect(await call('page.screenshot', { tabId: 43 })).toEqual({ data: 'aW1n', mimeType: 'image/png' });

    expect(injectedFunctions(injections)).toEqual(['setAside', 'setAside', 'putBack']);
    expect(page.framesSetAside).toBe(0);
  });

  it('gives up with an explanation when the other extension keeps adding its frame back', async () => {
    const { page, injections } = installTabWithOtherExtensionFrame({ reinjections: 10 });

    await expect(call('page.snapshot', { tabId: 44 })).rejects.toThrow(BLOCKED_BY_OTHER_EXTENSION);

    expect(injectedFunctions(injections)).toEqual(['setAside', 'setAside', 'setAside', 'putBack']);
    expect(page.framesSetAside).toBe(0);
  });

  it('explains the refusal when no frame can be found to set aside', async () => {
    const { injections } = installTabWithOtherExtensionFrame({ framesFound: 0 });

    await expect(call('page.snapshot', { tabId: 45 })).rejects.toThrow(BLOCKED_BY_OTHER_EXTENSION);

    expect(injectedFunctions(injections)).toEqual(['setAside']);
  });

  it('explains the refusal when the browser cannot run scripts in pages', async () => {
    installTabWithOtherExtensionFrame({ scripting: false });

    await expect(call('page.screenshot', { tabId: 46 })).rejects.toThrow(BLOCKED_BY_OTHER_EXTENSION);
  });

  it('explains the refusal when Chrome will not run scripts in the tab', async () => {
    installTabWithOtherExtensionFrame();
    const chromeApi = (globalThis as unknown as { chrome: { scripting: { executeScript: () => Promise<never> } } }).chrome;
    chromeApi.scripting.executeScript = async () => {
      throw new Error('Cannot access contents of the page.');
    };

    await expect(call('page.snapshot', { tabId: 47 })).rejects.toThrow(BLOCKED_BY_OTHER_EXTENSION);
  });

  it('puts frames back when the page tool fails after setting them aside', async () => {
    const { page, injections } = installTabWithOtherExtensionFrame();
    const chromeApi = (globalThis as unknown as { chrome: { debugger: { sendCommand: (...args: unknown[]) => Promise<unknown> } } }).chrome;
    const sendCommand = chromeApi.debugger.sendCommand;
    chromeApi.debugger.sendCommand = async (...args: unknown[]) => {
      if (args[1] === 'Runtime.evaluate') return { result: { type: 'object' }, exceptionDetails: { text: 'Uncaught', exception: { description: 'Error: boom' } } };
      return sendCommand(...args);
    };

    await expect(call('page.evaluate', { tabId: 48, expression: 'boom()' })).rejects.toThrow('Error: boom');

    expect(injectedFunctions(injections)).toEqual(['setAside', 'putBack']);
    expect(page).toMatchObject({ framesInPage: 1, framesSetAside: 0 });
  });

  it('leaves pages without other extension frames alone', async () => {
    const { page, injections } = installTabWithOtherExtensionFrame();
    page.framesInPage = 0;

    await call('page.snapshot', { tabId: 49 });

    expect(injections).toEqual([]);
  });
});
