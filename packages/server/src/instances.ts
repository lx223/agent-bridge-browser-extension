import { IDENTIFY_INSTANCES_TOOL, NAME_INSTANCE_TOOL, type HelloMessage } from '@agent-browser-bridge/protocol';

export function describeInstance(hello: HelloMessage): string {
  const browser = hello.label ?? hello.browser;
  const id = hello.instanceId ?? 'unknown';
  return hello.name ? `"${hello.name}" (${browser}, ${id})` : `${id} (${browser})`;
}

const describeAll = (instances: HelloMessage[]) => (instances.length ? instances.map(describeInstance).join(', ') : 'none');

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function findInstance(candidates: HelloMessage[], browser: string, requested: string): HelloMessage | undefined {
  const byId = candidates.find((hello) => hello.browser === browser && hello.instanceId === requested);
  if (byId) return byId;
  const byName = candidates.filter((hello) => hello.browser === browser && hello.name !== undefined && sameName(hello.name, requested));
  if (byName.length > 1) {
    throw new Error(`Several ${browser} instances are named "${requested}": ${describeAll(byName)}. Pass the instance id instead.`);
  }
  return byName[0];
}

export const identifyHint = `If you cannot tell which one the user means, call ${IDENTIFY_INSTANCES_TOOL}, show the user their sample tabs, ask, and save the answer with ${NAME_INSTANCE_TOOL}.`;

export interface Selection {
  instance?: string;
  answeredBy?: HelloMessage;
}

export class InstanceSelector {
  private pinned = new Map<string, HelloMessage>();

  constructor(private readonly connected: () => HelloMessage[]) {}

  select(browser: string, requested?: string): Selection {
    const candidates = this.connected().filter((hello) => hello.browser === browser && hello.instanceId !== undefined);
    if (requested !== undefined) return this.choose(browser, requested, candidates);

    const pinned = this.pinned.get(browser);
    if (pinned) {
      const current = candidates.find((hello) => hello.instanceId === pinned.instanceId);
      if (current) return this.pin(browser, current);
      throw new Error(
        `The ${browser} instance this session was using, ${describeInstance(pinned)}, is not connected right now. ` +
          `Tab, window and group ids from it do not apply to other instances. ` +
          `Connected ${browser} instances: ${describeAll(candidates)}. ` +
          `Wait for it to reconnect, or pass instance to switch and list tabs again.`,
      );
    }

    if (candidates.length === 1) return this.pin(browser, candidates[0]!);
    return {};
  }

  private choose(browser: string, requested: string, candidates: HelloMessage[]): Selection {
    const found = findInstance(candidates, browser, requested);
    if (found) return this.pin(browser, found);
    if (!candidates.length) return { instance: requested };
    throw new Error(
      `No connected ${browser} instance has the id or name "${requested}". Connected ${browser} instances: ${describeAll(candidates)}. ${identifyHint}`,
    );
  }

  private pin(browser: string, hello: HelloMessage): Selection {
    this.pinned.set(browser, hello);
    return { instance: hello.instanceId, answeredBy: hello };
  }
}
