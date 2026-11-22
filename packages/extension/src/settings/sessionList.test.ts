import { describe, expect, it } from 'vitest';
import type { AgentSession } from '@agent-browser-bridge/protocol';
import { agentLabel, sessionTitle, sessionViews } from './sessionList.ts';

const NOW = 10 * 24 * 60 * 60_000;
const minutes = (n: number) => NOW - n * 60_000;

const claude: AgentSession = {
  serverVersion: '1.0.0',
  client: { name: 'claude-code', version: '2.1.3' },
  sessionId: 'session-claude',
  startedAt: minutes(120),
  project: { name: 'shop', path: '/work/shop' },
  activity: {
    lastUsedAt: minutes(1),
    lastTool: 'chrome_tabs_list',
    calls: 12,
    instances: [
      { browser: 'chrome', instanceId: 'aaaa1111', label: 'Chrome', name: 'Work' },
      { browser: 'safari', instanceId: 'cccc3333', label: 'Safari' },
    ],
  },
};

const codex: AgentSession = {
  serverVersion: '1.0.0',
  client: { name: 'codex-mcp-client', version: '0.9.0' },
  sessionId: 'session-codex',
  startedAt: minutes(5),
};

describe('agentLabel', () => {
  it('names the agent by its MCP client and version', () => {
    expect(agentLabel(claude)).toBe('claude-code 2.1.3');
  });

  it('describes a session whose client has not introduced itself yet', () => {
    expect(agentLabel({ serverVersion: '1.0.0', client: null })).toBe('Agent starting up');
  });
});

describe('sessionTitle', () => {
  it('adds the project when it is known', () => {
    expect(sessionTitle(claude)).toBe('claude-code 2.1.3 in shop');
    expect(sessionTitle(codex)).toBe('codex-mcp-client 0.9.0');
  });
});

describe('sessionViews', () => {
  it('describes each session, most recently active first', () => {
    expect(sessionViews([codex, claude], NOW, 'aaaa1111')).toEqual([
      {
        key: 'session-claude',
        client: 'claude-code 2.1.3',
        serverVersion: '1.0.0',
        project: 'shop',
        projectPath: '/work/shop',
        sessionId: 'session-claude',
        details: ['Started 2 hours ago', 'Last used chrome_tabs_list 1 minute ago, 12 calls'],
        instances: [
          { text: 'Work (Chrome)', current: true },
          { text: 'Safari', current: false },
        ],
        active: true,
      },
      {
        key: 'session-codex',
        client: 'codex-mcp-client 0.9.0',
        serverVersion: '1.0.0',
        sessionId: 'session-codex',
        details: ['Started 5 minutes ago', 'Has not used a browser yet'],
        instances: [],
        active: false,
      },
    ]);
  });

  it('copes with sessions from older servers', () => {
    const legacy: AgentSession = { serverVersion: '0.4.0', client: null };
    const quiet: AgentSession = { ...claude, activity: { ...claude.activity!, lastUsedAt: minutes(30), calls: 1, instances: [{ browser: 'chrome' }] } };
    const [first, second] = sessionViews([legacy, quiet], NOW);
    expect(first).toMatchObject({ client: 'claude-code 2.1.3', active: false, instances: [{ text: 'chrome', current: false }] });
    expect(first!.details[1]).toBe('Last used chrome_tabs_list 30 minutes ago, 1 call');
    expect(second).toEqual({ key: 'session-1', client: 'Agent starting up', serverVersion: '0.4.0', details: ['Has not used a browser yet'], instances: [], active: false });
  });
});
