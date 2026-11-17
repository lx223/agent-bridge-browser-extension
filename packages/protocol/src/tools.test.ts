import { describe, expect, it } from 'vitest';
import { methods, toolDefinitions } from './index.ts';

describe('toolDefinitions', () => {
  it('uses unique snake_case tool names', () => {
    const names = methods.map((m) => toolDefinitions[m].tool);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).toMatch(/^[a-z][a-z_]*$/);
  });

  it('fills plan defaults', () => {
    expect(toolDefinitions['plan.apply'].params.parse({})).toEqual({ groups: [], ungroupTabIds: [], dryRun: false });
  });

  it('rejects unknown colors and empty tab lists', () => {
    expect(() => toolDefinitions['tabs.group'].params.parse({ tabIds: [1], color: 'magenta' })).toThrow();
    expect(() => toolDefinitions['tabs.group'].params.parse({ tabIds: [] })).toThrow();
  });
});

describe('page tool params', () => {
  it('requires refs shaped like snapshot refs', () => {
    expect(() => toolDefinitions['page.click'].params.parse({ tabId: 1, ref: '12' })).toThrow();
    expect(toolDefinitions['page.click'].params.parse({ tabId: 1, ref: 'e12' })).toMatchObject({ button: 'left', clickCount: 1 });
  });

  it('accepts only Domain.method names for raw CDP', () => {
    expect(() => toolDefinitions['cdp.send'].params.parse({ tabId: 1, method: 'eval' })).toThrow();
    expect(toolDefinitions['cdp.send'].params.parse({ tabId: 1, method: 'Network.getCookies' }).params).toEqual({});
  });
});
