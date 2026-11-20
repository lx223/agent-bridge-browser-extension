import { describe, expect, it } from 'vitest';
import { sampleTabs } from './naming.ts';

describe('sampleTabs', () => {
  it('prefers web pages, then active tabs, then the most recently used', () => {
    const tabs = [
      { title: 'Settings', url: 'chrome://settings/', active: true, lastAccessed: 99 },
      { title: 'Old', url: 'https://old.example/', lastAccessed: 1 },
      { title: 'Recent', url: 'https://recent.example/', lastAccessed: 50 },
      { title: 'Focused', url: 'http://focused.example/', active: true, lastAccessed: 2 },
    ];
    expect(sampleTabs(tabs, 3)).toEqual([
      { title: 'Focused', site: 'focused.example' },
      { title: 'Recent', site: 'recent.example' },
      { title: 'Old', site: 'old.example' },
    ]);
  });

  it('falls back to browser pages and shortens long titles', () => {
    const [tab] = sampleTabs([{ title: 'x'.repeat(200), url: 'chrome://newtab/' }], 5);
    expect(tab).toEqual({ title: 'x'.repeat(80), site: 'newtab' });
  });

  it('copes with missing or unparsable urls and titles', () => {
    expect(sampleTabs([{ url: 'not a url' }, {}], 5)).toEqual([
      { title: '', site: '' },
      { title: '', site: '' },
    ]);
    expect(sampleTabs([{ title: 'Blank', url: 'about:blank' }], 5)).toEqual([{ title: 'Blank', site: 'about' }]);
  });
});
