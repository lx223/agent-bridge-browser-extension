import type { ParamsOf } from '@agent-browser-bridge/protocol';

export async function evaluateInPage(code: string): Promise<{ result: unknown } | { error: string }> {
  try {
    return { result: await (0, eval)(code) };
  } catch (error) {
    return { error: String(error) };
  }
}

export async function executeScript({ tabId, code, allFrames }: ParamsOf<'scripting.executeScript'>) {
  const scripting = (chrome as Partial<typeof chrome>).scripting;
  if (!scripting) throw new Error('This browser does not support chrome.scripting.');
  const frames = await scripting.executeScript({ target: { tabId, allFrames }, world: 'MAIN', func: evaluateInPage, args: [code] });
  return frames.map(({ frameId, result: outcome }) =>
    outcome && 'error' in outcome ? { frameId, error: outcome.error } : { frameId, result: outcome?.result ?? null },
  );
}
