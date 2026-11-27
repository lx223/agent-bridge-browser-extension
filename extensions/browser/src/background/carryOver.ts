import { CHAT_STORAGE_KEY } from './chat.ts';
import { PLAN_SNAPSHOT_KEY } from './plan.ts';

export const CARRY_OVER_KEY = 'reloadCarryOver';
export const CARRIED_OVER_KEYS = [CHAT_STORAGE_KEY, PLAN_SNAPSHOT_KEY];
export const CARRY_OVER_MAX_AGE_MS = 2 * 60_000;

export interface CarryOverStorage {
  get(keys: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

interface CarryOver {
  savedAt: number;
  items: Record<string, unknown>;
}

export async function saveForReload(session: CarryOverStorage, local: CarryOverStorage, now = Date.now()): Promise<void> {
  const items = await session.get(CARRIED_OVER_KEYS);
  if (!Object.keys(items).length) return;
  await local.set({ [CARRY_OVER_KEY]: { savedAt: now, items } satisfies CarryOver });
}

export async function restoreAfterReload(session: CarryOverStorage, local: CarryOverStorage, now = Date.now()): Promise<void> {
  const carryOver = (await local.get(CARRY_OVER_KEY))[CARRY_OVER_KEY] as CarryOver | undefined;
  if (!carryOver) return;
  await local.remove(CARRY_OVER_KEY);
  const age = now - carryOver.savedAt;
  if (age < 0 || age > CARRY_OVER_MAX_AGE_MS) return;
  const present = await session.get(CARRIED_OVER_KEYS);
  const missing = Object.fromEntries(Object.entries(carryOver.items).filter(([key]) => !(key in present)));
  if (Object.keys(missing).length) await session.set(missing);
}
