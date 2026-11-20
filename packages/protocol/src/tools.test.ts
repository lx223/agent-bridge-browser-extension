import { describe, expect, it } from 'vitest';
import { browserApis, browsers, browserToolName, methods, STATUS_TOOL, toolDefinitions } from './index.ts';

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

describe('history and session params', () => {
  it('fills history search defaults', () => {
    expect(toolDefinitions['history.search'].params.parse({})).toEqual({ text: '', maxResults: 100 });
  });

  it('caps recently closed results at the browser limit', () => {
    expect(toolDefinitions['sessions.getRecentlyClosed'].params.parse({})).toEqual({ maxResults: 25 });
    expect(() => toolDefinitions['sessions.getRecentlyClosed'].params.parse({ maxResults: 26 })).toThrow();
  });

  it('restores the most recent session when no id is given', () => {
    expect(toolDefinitions['sessions.restore'].params.parse({})).toEqual({});
    expect(() => toolDefinitions['sessions.restore'].params.parse({ sessionId: '' })).toThrow();
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

describe('browser namespaces', () => {
  it('prefixes every tool with its browser', () => {
    expect(browserToolName('chrome', 'tabs.list')).toBe('chrome_list_tabs');
    expect(browserToolName('safari', 'tabs.list')).toBe('safari_list_tabs');
    expect(browserToolName('chrome', 'cdp.send')).toBe('chrome_cdp_send');
  });

  it('keeps tool names unique across browsers', () => {
    const names = [STATUS_TOOL, ...browsers.flatMap((browser) => browserApis[browser].map((method) => browserToolName(browser, method)))];
    expect(new Set(names).size).toBe(names.length);
  });

  it('gives Chrome every tool and Safari neither tab groups, history, sessions nor page control', () => {
    expect(browserApis.chrome).toEqual(methods);
    for (const method of browserApis.safari) {
      expect(method).not.toMatch(/^(page|cdp|plan|tabGroups|history|sessions)\./);
      expect(['tabs.group', 'tabs.ungroup']).not.toContain(method);
    }
  });
});
