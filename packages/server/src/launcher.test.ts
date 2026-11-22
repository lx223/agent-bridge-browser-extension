import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Launcher, LAUNCHER_INIT_ID, type WorkerProcess } from './launcher.ts';

interface Message {
  jsonrpc?: string;
  id?: string | number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: unknown;
}

interface FakeWorker extends WorkerProcess {
  version: string;
  received: Message[];
  held: Message[];
  stdinEnded: boolean;
  killed: boolean;
  reply(msg: Message): void;
  emit(msg: Message): void;
  exit(code: number): void;
}

interface FakeWorkerOptions {
  holdCalls?: boolean;
  failInitialize?: boolean;
  silent?: boolean;
}

function fakeWorker(version: string, { holdCalls = false, failInitialize = false, silent = false }: FakeWorkerOptions = {}): FakeWorker {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  let resolveExit: (code: number | null) => void = () => {};
  const exited = new Promise<number | null>((resolve) => (resolveExit = resolve));
  const worker: FakeWorker = {
    version,
    stdin,
    stdout,
    exited,
    received: [],
    held: [],
    stdinEnded: false,
    killed: false,
    kill: () => {
      worker.killed = true;
      resolveExit(null);
    },
    reply: (msg) => stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...msg })}\n`),
    emit: (msg) => worker.reply(msg),
    exit: (code) => resolveExit(code),
  };
  let buffer = '';
  stdin.on('data', (chunk: Buffer) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop()!;
    for (const line of lines) {
      const msg = JSON.parse(line) as Message;
      worker.received.push(msg);
      if (silent || msg.id === undefined || !msg.method) continue;
      if (msg.method === 'initialize') {
        if (failInitialize) worker.reply({ id: msg.id, error: { code: -1, message: 'nope' } });
        else worker.reply({ id: msg.id, result: { serverInfo: { name: 'bridge', version } } });
      } else if (holdCalls) {
        worker.held.push(msg);
      } else {
        worker.reply({ id: msg.id, result: { from: version, method: msg.method } });
      }
    }
  });
  stdin.on('end', () => {
    worker.stdinEnded = true;
    resolveExit(0);
  });
  return worker;
}

interface Harness {
  launcher: Launcher;
  workers: FakeWorker[];
  spawned: (string | null)[];
  reasons: string[];
  output: Message[];
  exits: number[];
  send(msg: Message): void;
  endInput(): void;
}

const launchers: Launcher[] = [];

afterEach(() => {
  for (const launcher of launchers.splice(0)) launcher.shutdown();
});

function harness(make: (version: string | null) => FakeWorker = (version) => fakeWorker(version ?? '1.0.0'), latest = async (): Promise<string | undefined> => undefined): Harness {
  const input = new PassThrough();
  const outputStream = new PassThrough();
  const output: Message[] = [];
  let buffer = '';
  outputStream.on('data', (chunk: Buffer) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop()!;
    for (const line of lines) output.push(JSON.parse(line));
  });
  const workers: FakeWorker[] = [];
  const spawned: (string | null)[] = [];
  const reasons: string[] = [];
  const exits: number[] = [];
  const launcher = new Launcher({
    input,
    output: outputStream,
    version: '1.0.0',
    spawnWorker: (version, reason) => {
      spawned.push(version);
      reasons.push(reason);
      const worker = make(version);
      workers.push(worker);
      return worker;
    },
    latestVersion: latest,
    exit: (code) => exits.push(code),
    initTimeoutMs: 200,
    drainTimeoutMs: 500,
    stopTimeoutMs: 200,
    restartDelayMs: 20,
    maxRestartDelayMs: 100,
  });
  launchers.push(launcher);
  return {
    launcher,
    workers,
    spawned,
    reasons,
    output,
    exits,
    send: (msg) => input.write(`${JSON.stringify({ jsonrpc: '2.0', ...msg })}\n`),
    endInput: () => input.end(),
  };
}

const initialize = { id: 0, method: 'initialize', params: { protocolVersion: '2025-06-18', clientInfo: { name: 'agent', version: '1' } } };
const initialized = { method: 'notifications/initialized' };
const call = (id: number) => ({ id, method: 'tools/call', params: { name: 'chrome_tabs_list' } });

async function initializedHarness(...args: Parameters<typeof harness>) {
  const h = harness(...args);
  h.send(initialize);
  h.send(initialized);
  await expect.poll(() => h.output.find((msg) => msg.id === 0)).toBeTruthy();
  await expect.poll(() => h.workers[0]!.received.length).toBe(2);
  return h;
}

const listChanged = [
  { jsonrpc: '2.0', method: 'notifications/tools/list_changed' },
  { jsonrpc: '2.0', method: 'notifications/prompts/list_changed' },
];

const isListChanged = (msg: Message) => msg.method?.endsWith('/list_changed') ?? false;

describe('Launcher', () => {
  it('runs the bundled server and passes messages through both ways', async () => {
    const h = await initializedHarness();
    expect(h.spawned).toEqual([null]);
    h.send(call(1));
    await expect.poll(() => h.output.find((msg) => msg.id === 1)).toMatchObject({ result: { from: '1.0.0' } });
    h.workers[0]!.emit({ method: 'notifications/message', params: { level: 'info' } });
    await expect.poll(() => h.output.at(-1)).toMatchObject({ method: 'notifications/message' });
  });

  it('does not check for updates before the client has initialized', async () => {
    let asked = 0;
    const h = harness(undefined, async () => {
      asked++;
      return '2.0.0';
    });
    await expect(h.launcher.checkForUpdate()).resolves.toBe(false);
    expect(asked).toBe(0);
    expect(h.spawned).toEqual([null]);
  });

  it('ignores a published version that is not newer', async () => {
    const h = await initializedHarness(undefined, async () => '1.0.0');
    await expect(h.launcher.checkForUpdate()).resolves.toBe(false);
    expect(h.spawned).toEqual([null]);
  });

  it('survives a failing update check', async () => {
    const h = await initializedHarness(undefined, async () => {
      throw new Error('offline');
    });
    await expect(h.launcher.checkForUpdate()).resolves.toBe(false);
    expect(h.launcher.version).toBe('1.0.0');
  });

  it('switches to a newer published version without the client reconnecting', async () => {
    const h = await initializedHarness((version) => fakeWorker(version ?? '1.0.0'), async () => '1.1.0');
    await expect(h.launcher.checkForUpdate()).resolves.toBe(true);
    expect(h.spawned).toEqual([null, '1.1.0']);
    expect(h.reasons).toEqual(['start', 'update']);
    expect(h.launcher.version).toBe('1.1.0');

    const [, next] = h.workers;
    expect(next!.received.map((msg) => msg.method)).toEqual(['initialize', 'notifications/initialized']);
    expect(next!.received[0]).toMatchObject({ id: LAUNCHER_INIT_ID, params: initialize.params });
    expect(h.output.filter((msg) => msg.id === LAUNCHER_INIT_ID)).toEqual([]);
    expect(h.output.slice(-2)).toEqual(listChanged);

    await expect.poll(() => h.workers[0]!.stdinEnded).toBe(true);
    h.send(call(7));
    await expect.poll(() => h.output.find((msg) => msg.id === 7)).toMatchObject({ result: { from: '1.1.0' } });
    expect(h.exits).toEqual([]);
  });

  it('lets the old server finish requests already in flight', async () => {
    const h = await initializedHarness((version) => fakeWorker(version ?? '1.0.0', { holdCalls: version === null }));
    const [old] = h.workers;
    h.send(call(1));
    await expect.poll(() => old!.held.length).toBe(1);

    await h.launcher.upgradeTo('1.1.0');
    h.send(call(2));
    await expect.poll(() => h.output.find((msg) => msg.id === 2)).toMatchObject({ result: { from: '1.1.0' } });
    expect(old!.stdinEnded).toBe(false);

    old!.reply({ id: 1, result: { from: '1.0.0' } });
    await expect.poll(() => h.output.find((msg) => msg.id === 1)).toMatchObject({ result: { from: '1.0.0' } });
    await expect.poll(() => old!.stdinEnded).toBe(true);
  });

  it('sends cancellations to the server that owns the request', async () => {
    const h = await initializedHarness((version) => fakeWorker(version ?? '1.0.0', { holdCalls: version === null }));
    const [old] = h.workers;
    h.send(call(1));
    await expect.poll(() => old!.held.length).toBe(1);
    await h.launcher.upgradeTo('1.1.0');
    h.send({ method: 'notifications/cancelled', params: { requestId: 1 } });
    await expect.poll(() => old!.received.at(-1)).toMatchObject({ method: 'notifications/cancelled' });
    expect(h.workers[1]!.received.some((msg) => msg.method === 'notifications/cancelled')).toBe(false);
  });

  it('answers requests the old server dropped while draining', async () => {
    const h = await initializedHarness((version) => fakeWorker(version ?? '1.0.0', { holdCalls: version === null }));
    const [old] = h.workers;
    h.send(call(1));
    await expect.poll(() => old!.held.length).toBe(1);
    await h.launcher.upgradeTo('1.1.0');
    old!.exit(1);
    await expect.poll(() => h.output.find((msg) => msg.id === 1)).toMatchObject({ error: { message: expect.stringMatching(/updated/) } });
    expect(h.exits).toEqual([]);
  });

  it('stops a draining server that never finishes', async () => {
    const h = await initializedHarness((version) => fakeWorker(version ?? '1.0.0', { holdCalls: version === null }));
    const [old] = h.workers;
    h.send(call(1));
    await expect.poll(() => old!.held.length).toBe(1);
    await h.launcher.upgradeTo('1.1.0');
    await expect.poll(() => old!.stdinEnded, { timeout: 2_000 }).toBe(true);
    await expect.poll(() => h.output.find((msg) => msg.id === 1)).toMatchObject({ error: {} });
  });

  it.each([
    ['rejects initialize', { failInitialize: true }],
    ['never answers', { silent: true }],
  ])('stays on the current version when the new one %s', async (_, options) => {
    const h = await initializedHarness((version) => fakeWorker(version ?? '1.0.0', version ? options : {}));
    await expect(h.launcher.upgradeTo('1.1.0')).resolves.toBe(false);
    expect(h.launcher.version).toBe('1.0.0');
    expect(h.workers[1]!.killed).toBe(true);
    h.send(call(3));
    await expect.poll(() => h.output.find((msg) => msg.id === 3)).toMatchObject({ result: { from: '1.0.0' } });
    expect(h.output.filter(isListChanged)).toEqual([]);
  });

  it('stays on the current version when the new one exits during start-up', async () => {
    const h = await initializedHarness((version) => fakeWorker(version ?? '1.0.0', { silent: version !== null }));
    const upgrade = h.launcher.upgradeTo('1.1.0');
    await expect.poll(() => h.workers.length).toBe(2);
    h.workers[1]!.exit(1);
    await expect(upgrade).resolves.toBe(false);
    expect(h.exits).toEqual([]);
  });

  describe('when the server stops on its own', () => {
    it('restarts it without the client reconnecting', async () => {
      const h = await initializedHarness();
      h.workers[0]!.exit(3);
      await expect.poll(() => h.workers.length).toBe(2);
      expect(h.spawned).toEqual([null, null]);
      expect(h.reasons).toEqual(['start', 'restart']);
      await expect.poll(() => h.workers[1]!.received.map((msg) => msg.method)).toEqual(['initialize', 'notifications/initialized']);
      expect(h.workers[1]!.received[0]).toMatchObject({ id: LAUNCHER_INIT_ID, params: initialize.params });
      h.send(call(5));
      await expect.poll(() => h.output.find((msg) => msg.id === 5)).toMatchObject({ result: { from: '1.0.0' } });
      expect(h.exits).toEqual([]);
      expect(h.output.filter((msg) => msg.id === LAUNCHER_INIT_ID)).toEqual([]);
      expect(h.output.filter(isListChanged)).toEqual([]);
    });

    it('answers a tool call it cut off with an error and repeats other requests', async () => {
      let spawnedSoFar = 0;
      const h = await initializedHarness((version) => fakeWorker(version ?? '1.0.0', { holdCalls: spawnedSoFar++ === 0 }));
      const [first] = h.workers;
      h.send(call(1));
      h.send({ id: 2, method: 'tools/list' });
      await expect.poll(() => first!.held.length).toBe(2);
      first!.exit(1);
      await expect.poll(() => h.output.find((msg) => msg.id === 1)).toMatchObject({ error: { message: expect.stringMatching(/may or may not have taken effect/) } });
      await expect.poll(() => h.output.find((msg) => msg.id === 2)).toMatchObject({ result: { method: 'tools/list' } });
      expect(h.workers[1]!.received.some((msg) => msg.id === 1)).toBe(false);
    });

    it('holds requests that arrive while it restarts and sends them on', async () => {
      const h = await initializedHarness();
      h.workers[0]!.exit(1);
      await new Promise((resolve) => setTimeout(resolve, 5));
      h.send(call(6));
      await expect.poll(() => h.output.find((msg) => msg.id === 6)).toMatchObject({ result: { from: '1.0.0' } });
      expect(h.workers).toHaveLength(2);
      expect(h.workers[0]!.received.some((msg) => msg.id === 6)).toBe(false);
    });

    it('answers held requests with an error when a restart attempt fails, and keeps trying', async () => {
      let spawnedSoFar = 0;
      const h = await initializedHarness((version) => fakeWorker(version ?? '1.0.0', { silent: spawnedSoFar++ === 1 }));
      h.workers[0]!.exit(1);
      await new Promise((resolve) => setTimeout(resolve, 5));
      h.send(call(7));
      await expect.poll(() => h.output.find((msg) => msg.id === 7)).toMatchObject({ error: { message: expect.stringMatching(/restarting/) } });
      await expect.poll(() => h.workers.length).toBe(3);
      h.send(call(8));
      await expect.poll(() => h.output.find((msg) => msg.id === 8)).toMatchObject({ result: { from: '1.0.0' } });
    });

    it('falls back to the bundled version when an updated server keeps stopping', async () => {
      const h = await initializedHarness((version) => fakeWorker(version ?? '1.0.0'));
      await h.launcher.upgradeTo('1.1.0');
      h.workers[1]!.exit(1);
      await expect.poll(() => h.launcher.version).toBe('1.1.0');
      await expect.poll(() => h.workers.length).toBe(3);
      await expect.poll(() => h.workers[2]!.received.length).toBe(2);
      h.workers[2]!.exit(1);
      await expect.poll(() => h.spawned).toEqual([null, '1.1.0', '1.1.0', null]);
      await expect.poll(() => h.launcher.version).toBe('1.0.0');
      await expect.poll(() => h.output.slice(-2)).toEqual(listChanged);
      expect(h.output.filter(isListChanged)).toEqual([...listChanged, ...listChanged]);
      h.send(call(9));
      await expect.poll(() => h.output.find((msg) => msg.id === 9)).toMatchObject({ result: { from: '1.0.0' } });
    });

    it('restarts it before the client has initialized', async () => {
      const h = harness();
      h.workers[0]!.exit(1);
      await expect.poll(() => h.workers.length).toBe(2);
      h.send(initialize);
      await expect.poll(() => h.output.find((msg) => msg.id === 0)).toMatchObject({ result: {} });
    });

    it('exits cleanly when the client goes away during a restart', async () => {
      const h = await initializedHarness();
      h.workers[0]!.exit(1);
      h.endInput();
      await expect.poll(() => h.exits).toEqual([0]);
    });
  });

  it('stops the server and exits cleanly when the client goes away', async () => {
    const h = await initializedHarness();
    h.endInput();
    await expect.poll(() => h.workers[0]!.stdinEnded).toBe(true);
    await expect.poll(() => h.exits).toEqual([0]);
  });

  it('checks for updates a minute after starting and then every hour', async () => {
    let asked = 0;
    const h = await initializedHarness(undefined, async () => {
      asked++;
      return undefined;
    });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    try {
      h.launcher.scheduleUpdateChecks();
      await vi.advanceTimersByTimeAsync(59_999);
      expect(asked).toBe(0);
      await vi.advanceTimersByTimeAsync(1);
      expect(asked).toBe(1);
      await vi.advanceTimersByTimeAsync(60 * 60_000);
      expect(asked).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps upgrading as newer versions are published', async () => {
    let latest = '1.1.0';
    const h = await initializedHarness((version) => fakeWorker(version ?? '1.0.0'), async () => latest);
    await h.launcher.checkForUpdate();
    latest = '1.2.0';
    await h.launcher.checkForUpdate();
    expect(h.spawned).toEqual([null, '1.1.0', '1.2.0']);
    const second = h.workers[2]!;
    expect(second.received[0]).toMatchObject({ method: 'initialize', params: initialize.params });
    await expect.poll(() => h.workers[1]!.stdinEnded).toBe(true);
  });
});
