import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { refOf, startHarness, type Harness, type Tab } from './harness.ts';

let harness: Harness;
let tabId: number;

beforeAll(async () => {
  harness = await startHarness();
});

afterAll(async () => {
  await harness?.close();
});

beforeEach(async () => {
  tabId = (await harness.openFixture('form.html')).id;
});

const evaluate = async (expression: string) => (await harness.agent.call<{ value: unknown }>('chrome_evaluate', { tabId, expression })).value;
const textOf = (id: string) => evaluate(`document.getElementById(${JSON.stringify(id)}).textContent`);
const snapshot = () => harness.agent.text('chrome_snapshot_page', { tabId });

describe('page control through the built server and extension', () => {
  it('snapshots the page as an accessibility tree with refs', async () => {
    const tree = await snapshot();
    expect(tree).toContain('Page: Fixture form');
    expect(tree).toContain(`URL: ${harness.fixture('form.html')}`);
    expect(tree).toMatch(/heading "Fixture form"/);
    expect(tree).toMatch(/button "Press me" \[ref=e\d+\]/);
    expect(tree).toMatch(/textbox "Name" \[ref=e\d+\]/);
  });

  it('clicks elements by ref and by coordinates', async () => {
    const ref = refOf(await snapshot(), /button "Press me"/);
    const { clicked } = await harness.agent.call<{ clicked: { x: number; y: number } }>('chrome_click', { tabId, ref });
    expect(await textOf('status')).toBe('pressed');

    await evaluate(`document.getElementById('status').textContent = 'idle'`);
    await harness.agent.call('chrome_click', { tabId, x: clicked.x, y: clicked.y, clickCount: 2 });
    expect(await textOf('status')).toBe('double pressed');
  });

  it('hovers over elements', async () => {
    const ref = refOf(await snapshot(), /button "Hover target"/);
    await harness.agent.call('chrome_hover', { tabId, ref });
    expect(await textOf('status')).toBe('hovered');
  });

  it('types into a field, replacing its value, and submits', async () => {
    const ref = refOf(await snapshot(), /textbox "Name"/);
    const typed = await harness.agent.call('chrome_type_text', { tabId, ref, text: 'Ada', clear: true, submit: true });
    expect(typed).toEqual({ typed: 3, submitted: true });
    expect(await evaluate(`document.getElementById('name').value`)).toBe('Ada');
    expect(await textOf('greeting-output')).toBe('Hello, Ada');
  });

  it('appends to a field when not clearing', async () => {
    const ref = refOf(await snapshot(), /textbox "Name"/);
    await harness.agent.call('chrome_type_text', { tabId, ref, text: '!' });
    expect(await evaluate(`document.getElementById('name').value`)).toContain('!');
  });

  it('presses keys and key combinations', async () => {
    await harness.agent.call('chrome_press_key', { tabId, key: 'Escape' });
    expect(await textOf('last-key')).toBe('key:Escape');
    await harness.agent.call('chrome_press_key', { tabId, key: 'Control+Shift+K' });
    expect(await textOf('last-key')).toMatch(/^key:ctrlKey\+shiftKey\+k$/i);
  });

  it('scrolls the viewport', async () => {
    expect(await evaluate('window.scrollY')).toBe(0);
    await harness.agent.call('chrome_scroll', { tabId, deltaY: 600 });
    await expect.poll(() => evaluate('window.scrollY')).toBeGreaterThan(0);
  });

  it('captures viewport and full-page screenshots', async () => {
    const png = await harness.agent.raw('chrome_screenshot', { tabId });
    expect(png.isError).toBe(false);
    expect(png.content[0]).toMatchObject({ type: 'image', mimeType: 'image/png' });
    const viewport = Buffer.from(png.content[0]!.data!, 'base64');
    expect(viewport.subarray(1, 4).toString('latin1')).toBe('PNG');

    const jpeg = await harness.agent.raw('chrome_screenshot', { tabId, fullPage: true, format: 'jpeg', quality: 50 });
    expect(jpeg.content[0]).toMatchObject({ type: 'image', mimeType: 'image/jpeg' });
    const fullPage = Buffer.from(jpeg.content[0]!.data!, 'base64');
    expect([...fullPage.subarray(0, 2)]).toEqual([0xff, 0xd8]);
    expect(fullPage.readUInt16BE(0)).not.toBe(viewport.readUInt16BE(0));
  });

  it('waits for text to appear and times out when it never does', async () => {
    await evaluate('window.revealLater()');
    const waited = await harness.agent.call<{ matched: boolean }>('chrome_wait_for', { tabId, text: 'Arrived late' });
    expect(waited.matched).toBe(true);

    const gone = await harness.agent.call<{ matched: boolean }>('chrome_wait_for', { tabId, text: 'Never rendered', gone: true });
    expect(gone.matched).toBe(true);

    const missing = await harness.agent.raw('chrome_wait_for', { tabId, text: 'Never rendered', timeoutMs: 300 });
    expect(missing.isError).toBe(true);
    expect(missing.text).toMatch(/Timed out after 300ms/);
  });

  it('evaluates expressions, awaiting promises and surfacing exceptions', async () => {
    expect(await evaluate('Promise.resolve({ sum: 1 + 2 })')).toEqual({ sum: 3 });
    const thrown = await harness.agent.raw('chrome_evaluate', { tabId, expression: `throw new Error('boom')` });
    expect(thrown.isError).toBe(true);
    expect(thrown.text).toContain('boom');
  });

  it('navigates to a url and reloads', async () => {
    const go = (to: string) => harness.agent.call<Tab>('chrome_navigate', { tabId, to });
    expect(await go(harness.fixture('second.html'))).toMatchObject({ title: 'Second page', url: harness.fixture('second.html'), loaded: true });
    expect(await go('reload')).toMatchObject({ url: harness.fixture('second.html'), loaded: true });
    expect(await snapshot()).toMatch(/link "Back to the form"/);
  });

  it('goes back and forward through history created by a click', async () => {
    const go = (to: string) => harness.agent.call<Tab>('chrome_navigate', { tabId, to });
    await go(harness.fixture('second.html'));
    await harness.agent.call('chrome_click', { tabId, ref: refOf(await snapshot(), /link "Back to the form"/) });
    await harness.agent.call('chrome_wait_for', { tabId, text: 'Press me' });
    expect(await go('back')).toMatchObject({ url: harness.fixture('second.html'), loaded: true });
    expect(await go('forward')).toMatchObject({ url: harness.fixture('form.html'), loaded: true });
  });

  it('goes back and forward directly after navigating to a url', async () => {
    const go = (to: string) => harness.agent.call<Tab>('chrome_navigate', { tabId, to });
    await go(harness.fixture('second.html'));
    expect(await go('back')).toMatchObject({ title: 'Fixture form', url: harness.fixture('form.html'), loaded: true });
    expect(await go('forward')).toMatchObject({ title: 'Second page', url: harness.fixture('second.html'), loaded: true });
    expect(await harness.agent.call('chrome_detach_debugger', { tabId })).toEqual({ detached: false });
  });

  it('keeps the debugger attached when stepping through history during page control', async () => {
    const go = (to: string) => harness.agent.call<Tab>('chrome_navigate', { tabId, to });
    await go(harness.fixture('second.html'));
    expect(await snapshot()).toContain('Page: Second page');
    expect(await go('back')).toMatchObject({ url: harness.fixture('form.html'), loaded: true });
    expect(await harness.agent.call('chrome_detach_debugger', { tabId })).toEqual({ detached: true });
  });

  it('reports the edge of history when there is nowhere to go', async () => {
    const back = await harness.agent.raw('chrome_navigate', { tabId, to: 'back' });
    expect(back.isError).toBe(true);
    expect(back.text).toContain('Cannot go back: the tab is on the first page of its history.');
    const forward = await harness.agent.raw('chrome_navigate', { tabId, to: 'forward' });
    expect(forward.isError).toBe(true);
    expect(forward.text).toContain('Cannot go forward: the tab is on the last page of its history.');
  });

  it('asks for a new snapshot when a ref points at an element removed from the page', async () => {
    const tree = await snapshot();
    const attempts = [
      { tool: 'chrome_click', ref: refOf(tree, /button "Press me"/), args: {} },
      { tool: 'chrome_hover', ref: refOf(tree, /button "Hover target"/), args: {} },
      { tool: 'chrome_scroll', ref: refOf(tree, /button "Press me"/), args: { deltaY: 100 } },
      { tool: 'chrome_type_text', ref: refOf(tree, /textbox "Name"/), args: { text: 'Ada' } },
    ];
    await evaluate(`document.querySelectorAll('button, input').forEach((element) => element.remove())`);
    for (const { tool, ref, args } of attempts) {
      const result = await harness.agent.raw(tool, { tabId, ref, ...args });
      expect(result.isError, tool).toBe(true);
      expect(result.text, tool).toBe(`Element ${ref} no longer exists; take a new chrome_snapshot_page.`);
    }
  });

  it.each([
    ['reloaded', () => 'reload'],
    ['navigated to another page', () => harness.fixture('second.html')],
  ])('asks for a new snapshot when a ref is used after the tab %s', async (_change, destination) => {
    const tree = await snapshot();
    const attempts = [
      { tool: 'chrome_click', ref: refOf(tree, /button "Press me"/), args: {} },
      { tool: 'chrome_hover', ref: refOf(tree, /button "Hover target"/), args: {} },
      { tool: 'chrome_type_text', ref: refOf(tree, /textbox "Name"/), args: { text: 'Ada', clear: true } },
    ];
    await harness.agent.call('chrome_navigate', { tabId, to: destination() });
    for (const { tool, ref, args } of attempts) {
      const result = await harness.agent.raw(tool, { tabId, ref, ...args });
      expect(result.isError, tool).toBe(true);
      expect(result.text, tool).toBe(`Element ${ref} no longer exists; take a new chrome_snapshot_page.`);
    }
  });

  it('sends raw CDP commands and detaches the debugger', async () => {
    const result = await harness.agent.call<{ result: { value: number } }>('chrome_cdp_send', {
      tabId,
      method: 'Runtime.evaluate',
      params: { expression: '6 * 7', returnByValue: true },
    });
    expect(result.result.value).toBe(42);
    expect(await harness.agent.call('chrome_detach_debugger', { tabId })).toEqual({ detached: true });
    expect(await harness.agent.call('chrome_detach_debugger', { tabId })).toEqual({ detached: false });
    expect(await textOf('status')).toBe('idle');
  });

  it('rejects page tools for tabs that do not exist', async () => {
    const result = await harness.agent.raw('chrome_snapshot_page', { tabId: 999_999_999 });
    expect(result.isError).toBe(true);
  });
});
