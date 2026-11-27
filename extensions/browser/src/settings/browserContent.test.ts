import { describe, expect, it } from 'vitest';
import { showContentFor } from './browserContent.ts';

const page = () => [
  { dataset: { browser: 'chrome' }, hidden: false },
  { dataset: { browser: 'safari' }, hidden: true },
];

describe('showContentFor', () => {
  it('keeps the Chrome wording in Chrome', () => {
    const elements = page();
    showContentFor('chrome', elements);
    expect(elements.map((element) => element.hidden)).toEqual([false, true]);
  });

  it('swaps to the Safari wording in Safari', () => {
    const elements = page();
    showContentFor('safari', elements);
    expect(elements.map((element) => element.hidden)).toEqual([true, false]);
  });
});
