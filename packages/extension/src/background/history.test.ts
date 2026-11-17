import { describe, expect, it } from 'vitest';
import { installFakeDebugger } from '../test/fakeDebugger.ts';
import { send } from './debugger.ts';
import { stepHistory } from './history.ts';

const MISSING = 'Cannot find a next page in history.';

function install(options: { currentIndex?: number; native?: 'ok' | 'missing' | 'other'; navigateFails?: boolean } = {}) {
  const { currentIndex = 1, native = 'missing', navigateFails = false } = options;
  const fake = installFakeDebugger({
    'Page.getNavigationHistory': () => ({ currentIndex, entries: [{ id: 10 }, { id: 20 }, { id: 30 }] }),
    'Page.navigateToHistoryEntry': () => {
      if (navigateFails) throw new Error('No entry with passed id');
      return {};
    },
  });
  const nativeCalls: string[] = [];
  const step = (name: string) => async () => {
    nativeCalls.push(name);
    if (native === 'missing') throw new Error(MISSING);
    if (native === 'other') throw new Error('No tab with id: 1.');
  };
  Object.assign((globalThis as unknown as { chrome: { tabs: object } }).chrome.tabs, { goBack: step('back'), goForward: step('forward') });
  return { ...fake, nativeCalls };
}

const navigations = (commands: { method: string; params: Record<string, unknown> }[]) =>
  commands.filter((command) => command.method === 'Page.navigateToHistoryEntry').map((command) => command.params.entryId);

describe('stepHistory', () => {
  it('uses the tabs API without touching the debugger when Chrome allows the step', async () => {
    const { commands, attachedTabs, nativeCalls } = install({ native: 'ok' });
    await (await stepHistory(1, 'back'))();
    await (await stepHistory(1, 'forward'))();
    expect(nativeCalls).toEqual(['back', 'forward']);
    expect(commands).toEqual([]);
    expect(attachedTabs.size).toBe(0);
  });

  it('falls back to the debugger and detaches again once released', async () => {
    const { commands, attachedTabs } = install();
    const release = await stepHistory(2, 'back');
    expect(navigations(commands)).toEqual([10]);
    expect(attachedTabs.has(2)).toBe(true);
    await release();
    expect(attachedTabs.has(2)).toBe(false);
  });

  it('steps forward to the next entry', async () => {
    const { commands } = install();
    await (await stepHistory(3, 'forward'))();
    expect(navigations(commands)).toEqual([30]);
  });

  it('keeps the debugger attached when it was attached before the step', async () => {
    const { commands, attachedTabs } = install();
    await send(4, 'Page.enable');
    await (await stepHistory(4, 'back'))();
    expect(navigations(commands)).toEqual([10]);
    expect(attachedTabs.has(4)).toBe(true);
  });

  it('reports the edge of history and detaches', async () => {
    const first = install({ currentIndex: 0 });
    await expect(stepHistory(5, 'back')).rejects.toThrow('Cannot go back: the tab is on the first page of its history.');
    expect(first.attachedTabs.has(5)).toBe(false);

    install({ currentIndex: 2 });
    await expect(stepHistory(6, 'forward')).rejects.toThrow('Cannot go forward: the tab is on the last page of its history.');
  });

  it('explains a failed fallback and detaches', async () => {
    const { attachedTabs } = install({ navigateFails: true });
    await expect(stepHistory(7, 'back')).rejects.toThrow(/Cannot go back: Chrome refused the history step and the debugger fallback failed \(No entry with passed id\)/);
    expect(attachedTabs.has(7)).toBe(false);
  });

  it('rethrows other tabs API errors unchanged', async () => {
    const { commands } = install({ native: 'other' });
    await expect(stepHistory(8, 'back')).rejects.toThrow('No tab with id: 1.');
    expect(commands).toEqual([]);
  });

  it('rethrows the tabs API error where there is no debugger', async () => {
    install();
    delete (globalThis as unknown as { chrome: { debugger?: unknown } }).chrome.debugger;
    await expect(stepHistory(9, 'back')).rejects.toThrow(MISSING);
  });
});
