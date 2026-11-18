import { describe, expect, it } from 'vitest';
import { isNewerVersion } from './version.ts';

describe('isNewerVersion', () => {
  it.each([
    ['0.3.2', '0.3.1', true],
    ['0.4.0', '0.3.9', true],
    ['1.0.0', '0.99.99', true],
    ['0.10.0', '0.9.0', true],
    ['0.3.1', '0.3.1', false],
    ['0.3.0', '0.3.1', false],
    ['v0.3.2', '0.3.1', true],
    ['0.3.2-beta.1', '0.3.1', true],
    ['not-a-version', '0.3.1', false],
    ['0.3.2', 'unknown', false],
  ])('%s newer than %s is %s', (candidate, current, expected) => {
    expect(isNewerVersion(candidate, current)).toBe(expected);
  });
});
