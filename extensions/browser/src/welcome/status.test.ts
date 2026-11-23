import { describe, expect, it } from 'vitest';
import type { AgentSession } from '@agent-browser-bridge/protocol';
import { describeStatus } from './status.ts';

const session: AgentSession = { serverVersion: '1.0.0', client: { name: 'claude-code', version: '2.1.3' } };

describe('describeStatus', () => {
  it('asks for setup until an agent connects', () => {
    expect(describeStatus(undefined)).toEqual({ headline: 'Not connected yet', hint: 'Connect your agent below, then start a new session in it.' });
    expect(describeStatus({ state: 'connecting', agents: [] }).headline).toBe('Looking for your agent…');
  });

  it('confirms the connection and points at the prompts to try', () => {
    expect(describeStatus({ state: 'connected', agents: [session] })).toEqual({
      headline: 'Connected',
      hint: 'Your agent can use this browser. Try one of the prompts below.',
    });
  });

  it('counts the agent sessions when there is more than one', () => {
    expect(describeStatus({ state: 'connected', agents: [session, session] }).headline).toBe('Connected to 2 agent sessions');
  });
});
