import type { ConnectionStatus } from '../background/bridgeClient.ts';

export interface StatusCopy {
  headline: string;
  hint: string;
}

const SET_UP_HINT = 'Connect your agent below, then start a new session in it.';

export function describeStatus(status: Pick<ConnectionStatus, 'state' | 'agents'> | undefined): StatusCopy {
  const state = status?.state ?? 'disconnected';
  if (state === 'connecting') return { headline: 'Looking for your agent…', hint: SET_UP_HINT };
  if (state === 'disconnected') return { headline: 'Not connected yet', hint: SET_UP_HINT };
  const sessions = status?.agents.length ?? 0;
  return {
    headline: sessions > 1 ? `Connected to ${sessions} agent sessions` : 'Connected',
    hint: 'Your agent can use this browser. Try one of the prompts below.',
  };
}
