import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dispatch } from './handlers.ts';

let stored: Record<string, unknown>;

beforeEach(() => {
  stored = { bridgeInstanceId: 'abc12345' };
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: async (key: string) => (key in stored ? { [key]: stored[key] } : {}),
        set: async (items: Record<string, unknown>) => void Object.assign(stored, items),
        remove: async (key: string) => void delete stored[key],
      },
    },
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('dispatch', () => {
  it('names this browser instance on behalf of an agent', async () => {
    await expect(dispatch('instance.setName', { name: '  Work ' })).resolves.toEqual({ instanceId: 'abc12345', name: 'Work' });
    expect(stored.bridgeInstanceName).toBe('Work');
    await expect(dispatch('instance.setName', { name: '' })).resolves.toEqual({ instanceId: 'abc12345', name: null });
    expect(stored).not.toHaveProperty('bridgeInstanceName');
  });

  it('rejects an invalid name', async () => {
    await expect(dispatch('instance.setName', { name: 'x'.repeat(41) })).rejects.toThrow(/Invalid params for instance.setName/);
    await expect(dispatch('instance.setName', undefined)).rejects.toThrow(/Invalid params/);
  });

  it('rejects unknown methods', async () => {
    await expect(dispatch('instance.explode', {})).rejects.toThrow('Unknown method: instance.explode');
  });
});
