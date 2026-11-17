import { describe, expect, it } from 'vitest';
import { agentLabel } from './agentList.ts';

describe('agentLabel', () => {
  it('names the agent by its MCP client and version', () => {
    expect(agentLabel({ serverVersion: '1.0.0', client: { name: 'claude-code', version: '2.1.3' } })).toBe('claude-code 2.1.3');
  });

  it('describes a session whose client has not introduced itself yet', () => {
    expect(agentLabel({ serverVersion: '1.0.0', client: null })).toBe('Agent starting up');
  });
});
