import { describe, expect, it } from 'vitest';
import { initialAgentTab, tabAfterKey } from './agentTabs.ts';

describe('initialAgentTab', () => {
  it('reopens the agent picked last time', () => {
    expect(initialAgentTab('cursor')).toBe('cursor');
  });

  it('starts with Claude Code otherwise', () => {
    expect(initialAgentTab(null)).toBe('claude-code');
    expect(initialAgentTab('windsurf')).toBe('claude-code');
  });
});

describe('tabAfterKey', () => {
  it('moves along the tabs with the arrow keys and wraps around', () => {
    expect(tabAfterKey(1, 'ArrowRight', 5)).toBe(2);
    expect(tabAfterKey(4, 'ArrowRight', 5)).toBe(0);
    expect(tabAfterKey(0, 'ArrowLeft', 5)).toBe(4);
  });

  it('jumps to the first and last tab', () => {
    expect(tabAfterKey(2, 'Home', 5)).toBe(0);
    expect(tabAfterKey(2, 'End', 5)).toBe(4);
  });

  it('ignores other keys', () => {
    expect(tabAfterKey(2, 'Enter', 5)).toBeUndefined();
  });
});
