import type { ImageResult, ParamsOf } from '@agent-browser-bridge/protocol';
import { detach, send } from './debugger.ts';
import { parseKeyCombo } from './keys.ts';
import { backendNodeIdFromRef, formatSnapshot, type AXNode } from './snapshot.ts';

const SCREENSHOT_TIMEOUT_MS = 10_000;
const WAIT_POLL_MS = 250;

const SELECT_CONTENTS = `function () {
  if (typeof this.select === 'function') { this.select(); return; }
  const range = document.createRange();
  range.selectNodeContents(this);
  const selection = getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}`;

interface Point {
  x: number;
  y: number;
}

interface EvaluateResult {
  result: { type: string; value?: unknown; description?: string };
  exceptionDetails?: { text: string; exception?: { description?: string } };
}

async function withStaleRefHint<T>(ref: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/no node|could not find node|node with given id/i.test(message)) {
      throw new Error(`Element ${ref} no longer exists; take a new chrome_snapshot_page.`);
    }
    throw err;
  }
}

export function quadCenter(quad: number[]): Point {
  const xs = [quad[0]!, quad[2]!, quad[4]!, quad[6]!];
  const ys = [quad[1]!, quad[3]!, quad[5]!, quad[7]!];
  return { x: xs.reduce((a, b) => a + b) / 4, y: ys.reduce((a, b) => a + b) / 4 };
}

async function elementCenter(tabId: number, ref: string): Promise<Point> {
  const backendNodeId = backendNodeIdFromRef(ref);
  return withStaleRefHint(ref, async () => {
    await send(tabId, 'DOM.scrollIntoViewIfNeeded', { backendNodeId });
    const { quads } = await send<{ quads: number[][] }>(tabId, 'DOM.getContentQuads', { backendNodeId });
    const quad = quads[0];
    if (!quad) throw new Error(`Element ${ref} has no visible area to interact with.`);
    return quadCenter(quad);
  });
}

async function viewportCenter(tabId: number): Promise<Point> {
  const { cssLayoutViewport } = await send<{ cssLayoutViewport: { clientWidth: number; clientHeight: number } }>(
    tabId,
    'Page.getLayoutMetrics',
  );
  return { x: cssLayoutViewport.clientWidth / 2, y: cssLayoutViewport.clientHeight / 2 };
}

async function targetPoint(tabId: number, p: { ref?: string; x?: number; y?: number }): Promise<Point> {
  if (p.ref) return elementCenter(tabId, p.ref);
  if (p.x !== undefined && p.y !== undefined) return { x: p.x, y: p.y };
  throw new Error('Pass either ref or both x and y.');
}

async function pressKey(tabId: number, combo: string) {
  for (const event of parseKeyCombo(combo)) await send(tabId, 'Input.dispatchKeyEvent', { ...event });
}

async function evaluate(tabId: number, expression: string): Promise<unknown> {
  const { result, exceptionDetails } = await send<EvaluateResult>(tabId, 'Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true,
  });
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
  return result.value ?? null;
}

function timeout<T>(ms: number, message: string, work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error(message)), ms)));
  return Promise.race([work, expired]).finally(() => clearTimeout(timer));
}

export async function snapshot({ tabId, interestingOnly, maxNodes }: ParamsOf<'page.snapshot'>) {
  const { nodes } = await send<{ nodes: AXNode[] }>(tabId, 'Accessibility.getFullAXTree');
  const tab = await chrome.tabs.get(tabId);
  const header = `Page: ${tab.title ?? ''}\nURL: ${tab.url ?? tab.pendingUrl ?? ''}\n`;
  return `${header}\n${formatSnapshot(nodes, { interestingOnly, maxNodes })}`;
}

export async function click(p: ParamsOf<'page.click'>) {
  const { x, y } = await targetPoint(p.tabId, p);
  await send(p.tabId, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  for (let count = 1; count <= p.clickCount; count++) {
    const base = { x, y, button: p.button, clickCount: count };
    await send(p.tabId, 'Input.dispatchMouseEvent', { type: 'mousePressed', ...base });
    await send(p.tabId, 'Input.dispatchMouseEvent', { type: 'mouseReleased', ...base });
  }
  return { clicked: { x, y } };
}

export async function hover({ tabId, ref }: ParamsOf<'page.hover'>) {
  const { x, y } = await elementCenter(tabId, ref);
  await send(tabId, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  return { hovered: { x, y } };
}

export async function typeText({ tabId, ref, text, clear, submit }: ParamsOf<'page.type'>) {
  if (ref) {
    const backendNodeId = backendNodeIdFromRef(ref);
    await withStaleRefHint(ref, async () => {
      await send(tabId, 'DOM.scrollIntoViewIfNeeded', { backendNodeId });
      await send(tabId, 'DOM.focus', { backendNodeId });
      if (clear) {
        const { object } = await send<{ object: { objectId: string } }>(tabId, 'DOM.resolveNode', { backendNodeId });
        await send(tabId, 'Runtime.callFunctionOn', { objectId: object.objectId, functionDeclaration: SELECT_CONTENTS });
        if (!text) await pressKey(tabId, 'Backspace');
      }
    });
  }
  if (text) await send(tabId, 'Input.insertText', { text });
  if (submit) await pressKey(tabId, 'Enter');
  return { typed: text.length, submitted: submit };
}

export async function pressKeyHandler({ tabId, key }: ParamsOf<'page.pressKey'>) {
  await pressKey(tabId, key);
  return { pressed: key };
}

export async function scroll({ tabId, ref, deltaX, deltaY }: ParamsOf<'page.scroll'>) {
  const { x, y } = ref ? await elementCenter(tabId, ref) : await viewportCenter(tabId);
  await send(tabId, 'Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX, deltaY });
  return { scrolled: { deltaX, deltaY } };
}

export async function screenshot({ tabId, fullPage, format, quality }: ParamsOf<'page.screenshot'>): Promise<ImageResult> {
  const params: Record<string, unknown> = { format, ...(format === 'jpeg' && quality !== undefined && { quality }) };
  if (fullPage) {
    const { cssContentSize } = await send<{ cssContentSize: { width: number; height: number } }>(tabId, 'Page.getLayoutMetrics');
    params.captureBeyondViewport = true;
    params.clip = { x: 0, y: 0, width: cssContentSize.width, height: cssContentSize.height, scale: 1 };
  }
  const { data } = await timeout(
    SCREENSHOT_TIMEOUT_MS,
    'Screenshot timed out. Chrome may not be painting this tab because it is in the background; bring it to the front and retry.',
    send<{ data: string }>(tabId, 'Page.captureScreenshot', params),
  );
  return { data, mimeType: `image/${format}` };
}

export async function waitFor({ tabId, text, gone, timeoutMs }: ParamsOf<'page.waitFor'>) {
  const started = Date.now();
  const expression = `Boolean(document.body && document.body.innerText.includes(${JSON.stringify(text)}))`;
  for (;;) {
    const present = (await evaluate(tabId, expression)) === true;
    if (present !== gone) return { matched: true, elapsedMs: Date.now() - started };
    if (Date.now() - started >= timeoutMs) {
      throw new Error(`Timed out after ${timeoutMs}ms waiting for "${text}" to ${gone ? 'disappear' : 'appear'}.`);
    }
    await new Promise((resolve) => setTimeout(resolve, WAIT_POLL_MS));
  }
}

export async function evaluateHandler({ tabId, expression }: ParamsOf<'page.evaluate'>) {
  return { value: await evaluate(tabId, expression) };
}

export async function cdpSend({ tabId, method, params }: ParamsOf<'cdp.send'>) {
  return (await send(tabId, method, params)) ?? {};
}

export async function cdpDetach({ tabId }: ParamsOf<'cdp.detach'>) {
  return { detached: await detach(tabId) };
}
