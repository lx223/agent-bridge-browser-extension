import { describe, expect, it } from 'vitest';
import type { AgentSession } from '@agent-browser-bridge/protocol';
import { agentLabel, relativeTime, sessionTitle, sessionViews } from './sessionList.ts';

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
    lastTool: 'chrome_list_tabs',
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

describe('relativeTime', () => {
  const hours = (n: number) => minutes(n * 60);

  it('rounds to the nearest sensible unit', () => {
    expect(relativeTime(NOW - 10_000, NOW)).toBe('just now');
    expect(relativeTime(NOW + 5_000, NOW)).toBe('just now');
    expect(relativeTime(minutes(1), NOW)).toBe('1 min ago');
    expect(relativeTime(minutes(89), NOW)).toBe('89 min ago');
    expect(relativeTime(hours(3), NOW)).toBe('3 h ago');
    expect(relativeTime(hours(35), NOW)).toBe('35 h ago');
  });

  it('counts whole days after a day and a half', () => {
    expect(relativeTime(hours(36), NOW)).toBe('1 day ago');
    expect(relativeTime(hours(47), NOW)).toBe('1 day ago');
    expect(relativeTime(hours(48), NOW)).toBe('2 days ago');
    expect(relativeTime(hours(24 * 5 + 3), NOW)).toBe('5 days ago');
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
        details: ['Started 2 h ago', 'Last used chrome_list_tabs 1 min ago, 12 calls'],
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
        details: ['Started 5 min ago', 'Has not used a browser yet'],
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
    expect(first!.details[1]).toBe('Last used chrome_list_tabs 30 min ago, 1 call');
    expect(second).toEqual({ key: 'session-1', client: 'Agent starting up', serverVersion: '0.4.0', details: ['Has not used a browser yet'], instances: [], active: false });
  });
});
