import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness, type Harness, type Tab } from './harness.ts';

interface ReadingListEntry {
  url: string;
  title: string;
  hasBeenRead: boolean;
  creationTime: number;
}

interface BookmarkNode {
  id: string;
  parentId?: string;
  title: string;
  url?: string;
  children?: BookmarkNode[];
}

interface DownloadItem {
  id: number;
  url: string;
  filename: string;
  state: string;
  exists: boolean;
}

let harness: Harness;

beforeAll(async () => {
  harness = await startHarness();
});

afterAll(async () => {
  await harness?.close();
});

const call = <T>(tool: string, args?: Record<string, unknown>) => harness.agent.call<T>(tool, args);
const readingList = () => call<ReadingListEntry[]>('chrome_reading_list_query');

describe('bookmarks, reading list, downloads, search and notifications', () => {
  it('adds, updates and removes a reading list entry', async () => {
    const url = harness.fixture('second.html');
    await call('chrome_reading_list_add_entry', { url, title: 'Second page' });
    expect(await readingList()).toEqual([expect.objectContaining({ url, title: 'Second page', hasBeenRead: false })]);

    const updated = await call<ReadingListEntry>('chrome_reading_list_update_entry', { url, hasBeenRead: true, title: 'Read later' });
    expect(updated).toMatchObject({ url, title: 'Read later', hasBeenRead: true });
    expect(await call<ReadingListEntry[]>('chrome_reading_list_query', { hasBeenRead: false })).toEqual([]);

    expect((await harness.agent.raw('chrome_reading_list_add_entry', { url, title: 'Again' })).isError).toBe(true);

    await call('chrome_reading_list_remove_entry', { url });
    expect(await readingList()).toEqual([]);
  });

  it('creates, finds, moves, renames and removes bookmarks', async () => {
    const roots = await call<BookmarkNode[]>('chrome_bookmarks_get_children', { id: '0' });
    expect(roots.map((node) => node.id)).toEqual(expect.arrayContaining(['1', '2']));

    const folder = await call<BookmarkNode>('chrome_bookmarks_create', { title: 'Acme renewal' });
    expect(folder.url).toBeUndefined();
    const url = harness.fixture('form.html');
    const bookmark = await call<BookmarkNode>('chrome_bookmarks_create', { parentId: folder.id, title: 'Renewal form', url });
    expect(bookmark).toMatchObject({ parentId: folder.id, url });

    expect((await call<BookmarkNode[]>('chrome_bookmarks_search', { query: 'Renewal' })).map((node) => node.id)).toContain(bookmark.id);
    expect((await call<BookmarkNode[]>('chrome_bookmarks_search', { url })).map((node) => node.id)).toEqual([bookmark.id]);
    expect((await call<BookmarkNode[]>('chrome_bookmarks_get_recent', { numberOfItems: 1 }))[0]!.id).toBe(bookmark.id);

    const renamed = await call<BookmarkNode>('chrome_bookmarks_update', { id: bookmark.id, title: 'Signed renewal' });
    expect(renamed.title).toBe('Signed renewal');
    const moved = await call<BookmarkNode>('chrome_bookmarks_move', { id: bookmark.id, parentId: '1' });
    expect(moved.parentId).toBe('1');
    await call('chrome_bookmarks_move', { id: bookmark.id, parentId: folder.id });

    const [tree] = await call<BookmarkNode[]>('chrome_bookmarks_get_sub_tree', { id: folder.id });
    expect(tree!.children!.map((node) => node.id)).toEqual([bookmark.id]);

    expect((await harness.agent.raw('chrome_bookmarks_remove', { id: folder.id })).isError).toBe(true);
    await call('chrome_bookmarks_remove', { id: bookmark.id });
    await call('chrome_bookmarks_remove_tree', { id: folder.id });
    expect(await call('chrome_bookmarks_search', { title: 'Acme renewal' })).toEqual([]);
  });

  it('downloads a file, finds it, shows it and erases it from the list', async () => {
    const { downloadId } = await call<{ downloadId: number }>('chrome_downloads_download', {
      url: harness.fixture('second.html'),
      filename: 'agent-bridge-download.html',
    });
    const find = async () => (await call<DownloadItem[]>('chrome_downloads_search', { id: downloadId }))[0];
    await expect.poll(async () => (await find())?.state).toBe('complete');
    const item = (await find())!;
    expect(item).toMatchObject({ url: harness.fixture('second.html'), exists: true });

    const byUrl = await call<DownloadItem[]>('chrome_downloads_search', { urlRegex: 'second\\.html$', state: 'complete' });
    expect(byUrl.map((download) => download.id)).toContain(downloadId);

    expect(await call('chrome_downloads_show', { downloadId })).toEqual({ shown: downloadId });
    expect(await call('chrome_downloads_erase', { downloadId })).toEqual({ erased: [downloadId] });
    expect(await find()).toBeUndefined();
  });

  it('lists the most visited sites', async () => {
    const sites = await call<Array<{ url: string; title: string }>>('chrome_top_sites_get');
    for (const site of sites) expect(site).toEqual({ url: expect.any(String), title: expect.any(String) });
  });

  it('searches with the default search engine in a new tab', async () => {
    const before = (await call<Tab[]>('chrome_tabs_list')).map((tab) => tab.id);
    expect(await call('chrome_search_query', { text: 'agent bridge e2e' })).toEqual({ searched: 'agent bridge e2e', disposition: 'NEW_TAB' });
    await expect
      .poll(async () => (await call<Tab[]>('chrome_tabs_list')).find((tab) => !before.includes(tab.id))?.url ?? '')
      .toMatch(/agent(\+|%20)bridge(\+|%20)e2e/);
    const opened = (await call<Tab[]>('chrome_tabs_list')).filter((tab) => !before.includes(tab.id));
    await call('chrome_tabs_close', { tabIds: opened.map((tab) => tab.id) });
  });

  it('shows and clears a notification', async () => {
    const { notificationId } = await call<{ notificationId: string }>('chrome_notifications_create', {
      title: 'Tabs organised',
      message: 'Grouped 12 tabs into 3 groups.',
    });
    expect(notificationId).toEqual(expect.any(String));
    expect(await call('chrome_notifications_clear', { notificationId })).toEqual({ cleared: true });
    expect(await call('chrome_notifications_clear', { notificationId })).toEqual({ cleared: false });
  });
});
