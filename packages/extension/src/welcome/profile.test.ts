import { describe, expect, it } from 'vitest';
import { profileInitial } from './profile.ts';

describe('profileInitial', () => {
  it('uses the first letter of the name, in capitals', () => {
    expect(profileInitial('work')).toBe('W');
    expect(profileInitial('  Personal')).toBe('P');
  });

  it('keeps a leading emoji whole', () => {
    expect(profileInitial('🏠 Home')).toBe('🏠');
  });

  it('is empty for an unnamed profile', () => {
    expect(profileInitial('')).toBe('');
    expect(profileInitial('   ')).toBe('');
  });
});
