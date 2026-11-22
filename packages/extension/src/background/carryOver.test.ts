import { describe, expect, it } from 'vitest';
import { toolDefinitions, type AgentInfo } from '@agent-browser-bridge/protocol';
import { installFakeChrome } from '../test/fakeChrome.ts';
import { CARRY_OVER_KEY, CARRY_OVER_MAX_AGE_MS, restoreAfterReload, saveForReload } from './carryOver.ts';
import { CHAT_STORAGE_KEY, ChatStore } from './chat.ts';
import { applyPlan, PLAN_SNAPSHOT_KEY, undoLastPlan } from './plan.ts';
import { applyUpdatesWhenIdle } from './update.ts';

const agent: AgentInfo = {
  serverVersion: '1.0.0',
  client: { name: 'claude-code', version: '2.0.0' },
  sessionId: 'session-1',
  project: { name: 'shop', path: '/work/shop' },
};

const plan = (input: unknown) => toolDefinitions['plan.apply'].params.parse(input);

function browser() {
  const fake = installFakeChrome([{ groupId: 100 }, { groupId: 100 }, {}, {}], [{ id: 100, title: 'Old', color: 'red' }]);
  const session = chrome.storage.session as unknown as Parameters<typeof saveForReload>[0];
  const local = chrome.storage.local as unknown as Parameters<typeof saveForReload>[1];
  const clearSession = () => Object.keys(fake.state.session).forEach((key) => delete fake.state.session[key]);
  let clock = 1_000_000;
  const now = () => clock;

  const startWorker = () => {
    const ready = restoreAfterReload(session, local, now());
    return { ready, chat: new ChatStore(session, { ready, now }) };
  };

  const update = async () => {
    let announce = () => {};
    const reloaded = new Promise<void>((resolve) =>
      applyUpdatesWhenIdle(
        {
          onUpdateAvailable: { addListener: (callback) => (announce = callback) },
          reload: () => {
            clearSession();
            resolve();
          },
        },
        { whenIdle: async () => {}, announceReload: async () => {} },
        { beforeReload: () => saveForReload(session, local, now()) },
      ),
    );
    announce();
    await reloaded;
    clock += 3_000;
  };

  const restartBrowser = (afterMs: number) => {
    clearSession();
    clock += afterMs;
  };

  return { ...fake, session, local, startWorker, update, restartBrowser };
}

async function chatAndApplyPlan(chat: ChatStore) {
  await chat.agentSays(agent, 'Shall I group your tabs?');
  await chat.userSays('session-1', 'Yes please');
  const inbox = await chat.receive(agent, { waitMs: 0 });
  await applyPlan(plan({ groups: [{ title: 'New', tabIds: [4, 1] }], ungroupTabIds: [2] }));
  return inbox.messages.at(-1)!.seq;
}

describe('carrying session state over an extension reload', () => {
  it('keeps the chat and the plan undo snapshot across an update', async () => {
    const chrome = browser();
    const cursor = await chatAndApplyPlan(chrome.startWorker().chat);

    await chrome.update();
    expect(chrome.state.session).toEqual({});

    const { chat, ready } = chrome.startWorker();
    const conversation = (await chat.conversations())['session-1'];
    expect(conversation.messages.map(({ from, text }) => ({ from, text }))).toEqual([
      { from: 'agent', text: 'Shall I group your tabs?' },
      { from: 'user', text: 'Yes please' },
    ]);

    await chat.agentSays(agent, 'Done. Anything else?');
    await chat.userSays('session-1', 'No, thanks');
    await expect(chat.receive(agent, { waitMs: 0, after: cursor })).resolves.toMatchObject({ messages: [{ seq: cursor + 2, text: 'No, thanks' }] });

    await ready;
    await expect(undoLastPlan()).resolves.toMatchObject({ restored: true, tabs: 4, groups: 1 });
    expect(chrome.layout()).toEqual(['1:Old 2:Old 3 4']);
    expect(chrome.state.local).toEqual({});
  });

  it('restores the copy only once, so a later worker restart keeps newer state', async () => {
    const chrome = browser();
    await chatAndApplyPlan(chrome.startWorker().chat);
    await chrome.update();
    await chrome.startWorker().ready;
    await undoLastPlan();

    await chrome.startWorker().ready;
    expect(chrome.state.session[PLAN_SNAPSHOT_KEY]).toBeUndefined();
    expect(chrome.state.local[CARRY_OVER_KEY]).toBeUndefined();
  });

  it('clears the chat and the plan snapshot when the browser restarts', async () => {
    const chrome = browser();
    await chatAndApplyPlan(chrome.startWorker().chat);

    chrome.restartBrowser(60 * 60_000);
    const { chat, ready } = chrome.startWorker();

    expect(await chat.conversations()).toEqual({});
    await ready;
    await expect(undoLastPlan()).rejects.toThrow(/Nothing to undo/);
  });

  it('drops a copy left behind when the browser restarted instead of reloading', async () => {
    const chrome = browser();
    await chatAndApplyPlan(chrome.startWorker().chat);
    await saveForReload(chrome.session, chrome.local, 1_000_000);

    chrome.restartBrowser(CARRY_OVER_MAX_AGE_MS + 1);
    const { chat, ready } = chrome.startWorker();

    expect(await chat.conversations()).toEqual({});
    await ready;
    expect(chrome.state.session).toEqual({});
    expect(chrome.state.local).toEqual({});
  });

  it('saves nothing when there is no state to keep', async () => {
    const chrome = browser();
    await saveForReload(chrome.session, chrome.local);
    expect(chrome.state.local).toEqual({});
  });

  it('does not overwrite state written since the reload', async () => {
    const chrome = browser();
    await chatAndApplyPlan(chrome.startWorker().chat);
    await saveForReload(chrome.session, chrome.local, 1_000_000);
    chrome.state.session = {};
    await chrome.session.set({ [CHAT_STORAGE_KEY]: { fresh: true } });

    await restoreAfterReload(chrome.session, chrome.local, 1_000_000);
    expect(chrome.state.session[CHAT_STORAGE_KEY]).toEqual({ fresh: true });
    expect(chrome.state.session[PLAN_SNAPSHOT_KEY]).toBeDefined();
  });
});
