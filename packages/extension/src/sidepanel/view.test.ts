import { describe, expect, it } from 'vitest';
import type { AgentSession } from '@agent-browser-bridge/protocol';
import type { Conversation } from '../background/chat.ts';
import { chooseConversation, panelView } from './view.ts';

const NOW = 1_700_000_000_000;

const conversation = (sessionId: string, extra: Partial<Conversation> = {}): Conversation => ({
  id: `conversation-${sessionId}`,
  key: sessionId,
  sessionId,
  title: `claude-code in ${sessionId}`,
  messages: [],
  nextSeq: 1,
  acknowledged: 0,
  delivered: 0,
  seenByUser: 0,
  listeningUntil: 0,
  ended: false,
  updatedAt: NOW,
  ...extra,
});

const session = (sessionId: string, extra: Partial<AgentSession> = {}): AgentSession => ({
  serverVersion: '1.0.0',
  client: { name: 'claude-code', version: '2.0.0' },
  sessionId,
  ...extra,
});

describe('panelView', () => {
  it('explains how to start when there is no conversation', () => {
    const view = panelView({}, [], NOW);
    expect(view).toMatchObject({ title: 'Agent chat', canSend: false, options: [] });
    expect(view.selected).toBeUndefined();
  });

  it('shows a waiting agent and lets the user reply', () => {
    const view = panelView({ a: conversation('a', { listeningUntil: NOW + 1_000 }) }, [session('a')], NOW);
    expect(view).toMatchObject({ selected: 'a', state: 'waiting', status: 'Waiting for your reply', canSend: true, canEnd: true, canRemove: false });
  });

  it('shows what a working agent last did', () => {
    const agents = [session('a', { activity: { lastUsedAt: NOW - 10_000, lastTool: 'chrome_page_click', calls: 3, instances: [] } })];
    const view = panelView({ a: conversation('a') }, agents, NOW);
    expect(view).toMatchObject({ state: 'working', status: 'Working: used chrome_page_click just now', canSend: true });
    expect(view.composerHint).toMatch(/reads your message when it next checks/);
    const chatting = [session('a', { activity: { lastUsedAt: NOW, lastTool: 'browser_chat_receive', calls: 4, instances: [] } })];
    expect(panelView({ a: conversation('a') }, chatting, NOW).status).toBe('Working');
  });

  it('keeps the chat open while a dropped agent reconnects', () => {
    const view = panelView({ a: conversation('a', { goneAt: NOW - 1_000 }) }, [], NOW);
    expect(view).toMatchObject({ state: 'reconnecting', status: 'Agent reconnecting', canSend: true, canEnd: true, canRemove: false });
    expect(view.composerHint).toMatch(/wait here until it reconnects/);
    expect(panelView({ a: conversation('a', { goneAt: NOW - 11 * 60_000 }) }, [], NOW).state).toBe('disconnected');
  });

  it('stops replies once the agent session closes or the chat ends', () => {
    expect(panelView({ a: conversation('a') }, [], NOW)).toMatchObject({ state: 'disconnected', canSend: false, canEnd: false, canRemove: true });
    expect(panelView({ a: conversation('a', { ended: true }) }, [session('a')], NOW)).toMatchObject({ state: 'ended', canSend: false, canRemove: true });
  });

  it('marks which of the user messages the agent has read', () => {
    const messages = [
      { seq: 1, from: 'agent' as const, text: 'What next?', at: NOW },
      { seq: 2, from: 'user' as const, text: 'Group tabs', at: NOW },
      { seq: 3, from: 'user' as const, text: 'Also pin mail', at: NOW },
    ];
    const view = panelView({ a: conversation('a', { messages, delivered: 2 }) }, [session('a')], NOW);
    expect(view.messages.map((message) => message.meta.split(' · ')[1])).toEqual([undefined, 'read by the agent', 'not read yet']);
  });

  it('lists other conversations with their unseen messages', () => {
    const conversations = {
      a: conversation('a', { updatedAt: NOW }),
      b: conversation('b', { updatedAt: NOW - 5, messages: [{ seq: 1, from: 'agent', text: 'Done', at: NOW - 5 }] }),
    };
    const view = panelView(conversations, [session('a'), session('b')], NOW);
    expect(view.options).toEqual([
      { key: 'a', label: 'claude-code in a' },
      { key: 'b', label: 'claude-code in b (1 new)' },
    ]);
  });
});

describe('chooseConversation', () => {
  it('keeps the one the user picked and otherwise prefers the latest open conversation', () => {
    const conversations = {
      old: conversation('old', { updatedAt: NOW - 100 }),
      ended: conversation('ended', { updatedAt: NOW, ended: true }),
    };
    expect(chooseConversation(conversations)).toBe('old');
    expect(chooseConversation(conversations, 'ended')).toBe('ended');
    expect(chooseConversation(conversations, 'gone')).toBe('old');
  });
});
