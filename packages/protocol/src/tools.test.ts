import { describe, expect, it } from 'vitest';
import { browserApis, browsers, browserToolName, methods, STATUS_TOOL, toolDefinitions } from './index.ts';

describe('toolDefinitions', () => {
  it('names each tool after its browser API method', () => {
    const names = methods.map((m) => browserToolName('chrome', m));
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).toMatch(/^chrome_[a-z]+(_[a-z]+)+$/);
    expect(browserToolName('chrome', 'sessions.restore')).toBe('chrome_sessions_restore');
    expect(browserToolName('chrome', 'tabGroups.update')).toBe('chrome_tab_groups_update');
    expect(browserToolName('chrome', 'sessions.getRecentlyClosed')).toBe('chrome_sessions_get_recently_closed');
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

describe('bookmark, download and search params', () => {
  it('names the new tools after their API methods', () => {
    expect(browserToolName('chrome', 'readingList.addEntry')).toBe('chrome_reading_list_add_entry');
    expect(browserToolName('chrome', 'topSites.get')).toBe('chrome_top_sites_get');
    expect(browserToolName('chrome', 'bookmarks.removeTree')).toBe('chrome_bookmarks_remove_tree');
  });

  it('fills defaults', () => {
    expect(toolDefinitions['readingList.addEntry'].params.parse({ url: 'https://a.test', title: 'A' })).toEqual({
      url: 'https://a.test',
      title: 'A',
      hasBeenRead: false,
    });
    expect(toolDefinitions['downloads.search'].params.parse({})).toEqual({ orderBy: ['-startTime'], limit: 100 });
    expect(toolDefinitions['bookmarks.getRecent'].params.parse({})).toEqual({ numberOfItems: 20 });
  });

  it('accepts only the browser search dispositions', () => {
    expect(() => toolDefinitions['search.query'].params.parse({ text: 'x', disposition: 'BACKGROUND' })).toThrow();
    expect(() => toolDefinitions['search.query'].params.parse({ text: '' })).toThrow();
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
    expect(browserToolName('chrome', 'tabs.list')).toBe('chrome_tabs_list');
    expect(browserToolName('safari', 'tabs.list')).toBe('safari_tabs_list');
    expect(browserToolName('chrome', 'cdp.send')).toBe('chrome_cdp_send');
  });

  it('keeps tool names unique across browsers', () => {
    const names = [STATUS_TOOL, ...browsers.flatMap((browser) => browserApis[browser].map((method) => browserToolName(browser, method)))];
    expect(new Set(names).size).toBe(names.length);
  });

  it('gives Chrome every tool and Safari neither tab groups, history, sessions nor page control', () => {
    expect(browserApis.chrome).toEqual(methods);
    for (const method of browserApis.safari) {
      expect(method).not.toMatch(/^(page|cdp|plan|tabGroups|history|sessions|readingList|bookmarks|downloads|topSites|search|notifications)\./);
      expect(['tabs.group', 'tabs.ungroup']).not.toContain(method);
    }
  });
});
