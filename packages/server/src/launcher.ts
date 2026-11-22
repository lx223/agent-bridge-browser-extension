import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import { isNewerVersion } from './version.ts';

export type WorkerStartReason = 'start' | 'update' | 'restart';

export interface WorkerProcess {
  stdin: Writable;
  stdout: Readable;
  exited: Promise<number | null>;
  kill(): void;
}

export interface LauncherOptions {
  input: Readable;
  output: Writable;
  version: string;
  spawnWorker: (version: string | null, reason: WorkerStartReason) => WorkerProcess;
  latestVersion: () => Promise<string | undefined>;
  exit: (code: number) => void;
  log?: (msg: string) => void;
  firstCheckMs?: number;
  checkIntervalMs?: number;
  initTimeoutMs?: number;
  drainTimeoutMs?: number;
  stopTimeoutMs?: number;
  restartDelayMs?: number;
  maxRestartDelayMs?: number;
  stableAfterMs?: number;
}

type JsonRpcId = string | number;

interface JsonRpcMessage {
  id?: JsonRpcId | null;
  method?: string;
  params?: { requestId?: JsonRpcId } & Record<string, unknown>;
}

interface ClientRequest {
  line: string;
  method: string;
}

interface Worker {
  process: WorkerProcess;
  spawnVersion: string | null;
  version: string;
  state: 'warming' | 'active' | 'draining' | 'gone';
  clientRequests: Map<string, ClientRequest>;
  serverRequests: Set<string>;
  activeSince?: number;
  onInitialized?: (ok: boolean) => void;
}

export const LAUNCHER_INIT_ID = 'agent-browser-bridge-launcher-initialize';
const INTERNAL_ERROR = -32603;
const UPDATED_MESSAGE = 'The browser bridge server was updated while handling this request; please retry.';
const RESTARTED_DURING_TOOL_MESSAGE =
  'The browser bridge server restarted while running this tool, so it may or may not have taken effect; check before trying again.';
const RESTARTING_MESSAGE = 'The browser bridge server is restarting after an error; please retry in a few seconds.';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const keyOf = (id: JsonRpcId) => `${typeof id}:${id}`;
const isRequestId = (id: unknown): id is JsonRpcId => typeof id === 'string' || typeof id === 'number';

const parse = (line: string): JsonRpcMessage | undefined => {
  try {
    const value = JSON.parse(line);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
  } catch {
    return undefined;
  }
};

export class Launcher {
  private active: Worker;
  private readonly draining = new Set<Worker>();
  private initializeRequest?: JsonRpcMessage;
  private initializedNotification?: string;
  private updating = false;
  private restarting = false;
  private closing = false;
  private crashStreak = 0;
  private readonly queued: string[] = [];
  private readonly timers: NodeJS.Timeout[] = [];
  private readonly log: (msg: string) => void;

  constructor(private readonly opts: LauncherOptions) {
    this.log = opts.log ?? (() => {});
    this.active = this.startWorker(null, opts.version, 'active', 'start');
    this.active.activeSince = Date.now();
    createInterface({ input: opts.input, crlfDelay: Infinity }).on('line', (line) => this.fromClient(line));
    opts.input.on('end', () => this.shutdown());
    opts.input.on('close', () => this.shutdown());
  }

  get version() {
    return this.active.version;
  }

  scheduleUpdateChecks() {
    const first = setTimeout(() => void this.checkForUpdate(), this.opts.firstCheckMs ?? 60_000);
    const repeat = setInterval(() => void this.checkForUpdate(), this.opts.checkIntervalMs ?? 60 * 60_000);
    first.unref?.();
    repeat.unref?.();
    this.timers.push(first, repeat);
  }

  async checkForUpdate(): Promise<boolean> {
    if (this.updating || this.restarting || this.closing || !this.initializeRequest) return false;
    const latest = await this.opts.latestVersion().catch(() => undefined);
    if (!latest || !isNewerVersion(latest, this.active.version)) return false;
    return this.upgradeTo(latest);
  }

  async upgradeTo(version: string): Promise<boolean> {
    if (this.updating || this.restarting || this.closing || !this.initializeRequest) return false;
    this.updating = true;
    let switched = false;
    try {
      this.log(`Starting agent-browser-bridge-mcp ${version} alongside ${this.active.version}`);
      const next = this.startWorker(version, version, 'warming', 'update');
      if (!(await this.warmUp(next))) {
        this.log(`agent-browser-bridge-mcp ${version} did not start; staying on ${this.active.version}`);
        next.state = 'gone';
        next.process.kill();
        return false;
      }
      const previous = this.active;
      this.activate(next);
      if (previous.state === 'active') this.drain(previous);
      this.toClient(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' }));
      this.log(`Switched to agent-browser-bridge-mcp ${version}`);
      switched = true;
      return true;
    } finally {
      this.updating = false;
      if (!switched && this.active.state === 'gone' && !this.closing) void this.restart(this.active);
    }
  }

  private activate(worker: Worker) {
    worker.state = 'active';
    worker.activeSince = Date.now();
    this.active = worker;
    for (const line of this.queued.splice(0)) this.fromClient(line);
  }

  private async restart(crashed: Worker) {
    if (this.restarting || this.closing) return;
    this.restarting = true;
    try {
      const quickCrash = crashed.activeSince !== undefined && Date.now() - crashed.activeSince < (this.opts.stableAfterMs ?? 60_000);
      this.crashStreak = quickCrash ? this.crashStreak + 1 : 0;
      for (let attempt = 0; !this.closing; attempt++) {
        const failures = this.crashStreak + attempt;
        if (failures > 0) {
          const base = this.opts.restartDelayMs ?? 1_000;
          await delay(Math.min(base * 2 ** (failures - 1), this.opts.maxRestartDelayMs ?? 30_000));
          if (this.closing) return;
        }
        const spawnVersion = failures < 2 ? crashed.spawnVersion : null;
        const version = spawnVersion ?? this.opts.version;
        this.log(`Restarting agent-browser-bridge-mcp ${version}`);
        if (!this.initializeRequest || this.queued.some((line) => parse(line)?.method === 'initialize')) {
          this.activate(this.startWorker(spawnVersion, version, 'active', 'restart'));
          return;
        }
        const next = this.startWorker(spawnVersion, version, 'warming', 'restart');
        if (await this.warmUp(next)) {
          this.activate(next);
          if (version !== crashed.version) this.toClient(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' }));
          this.log(`Restarted agent-browser-bridge-mcp ${version}`);
          return;
        }
        next.state = 'gone';
        next.process.kill();
        this.log(`agent-browser-bridge-mcp ${version} did not start; trying again`);
        this.rejectQueued(RESTARTING_MESSAGE);
      }
    } finally {
      this.restarting = false;
    }
  }

  private rejectQueued(message: string) {
    for (const line of this.queued.splice(0)) {
      const msg = parse(line);
      if (msg?.method && isRequestId(msg.id)) this.toClient(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: INTERNAL_ERROR, message } }));
    }
  }

  private startWorker(spawnVersion: string | null, version: string, state: Worker['state'], reason: WorkerStartReason): Worker {
    const child = this.opts.spawnWorker(spawnVersion, reason);
    const worker: Worker = { process: child, spawnVersion, version, state, clientRequests: new Map(), serverRequests: new Set() };
    child.stdin.on('error', () => {});
    child.stdout.on('error', () => {});
    createInterface({ input: child.stdout, crlfDelay: Infinity }).on('line', (line) => this.fromWorker(worker, line));
    void child.exited.then((code) => this.workerExited(worker, code));
    return worker;
  }

  private warmUp(worker: Worker): Promise<boolean> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => finish(false), this.opts.initTimeoutMs ?? 120_000);
      const finish = (ok: boolean) => {
        clearTimeout(timer);
        worker.onInitialized = undefined;
        resolve(ok);
      };
      worker.onInitialized = finish;
      this.send(worker, JSON.stringify({ ...this.initializeRequest, id: LAUNCHER_INIT_ID }));
    }).then((ok) => {
      if (ok && this.initializedNotification) this.send(worker, this.initializedNotification);
      return ok as boolean;
    });
  }

  private drain(worker: Worker) {
    worker.state = 'draining';
    this.draining.add(worker);
    const timer = setTimeout(() => this.retire(worker), this.opts.drainTimeoutMs ?? 60_000);
    timer.unref?.();
    this.timers.push(timer);
    this.retireIfIdle(worker);
  }

  private retireIfIdle(worker: Worker) {
    if (worker.state === 'draining' && worker.clientRequests.size === 0 && worker.serverRequests.size === 0) this.retire(worker);
  }

  private retire(worker: Worker) {
    if (worker.state !== 'draining') return;
    worker.state = 'gone';
    this.stopWorker(worker);
  }

  private stopWorker(worker: Worker) {
    worker.process.stdin.end();
    const timer = setTimeout(() => worker.process.kill(), this.opts.stopTimeoutMs ?? 5_000);
    timer.unref?.();
    void worker.process.exited.then(() => clearTimeout(timer));
  }

  private fromClient(line: string) {
    const msg = parse(line);
    if (msg?.method === 'initialize') this.initializeRequest = msg;
    if (msg?.method === 'notifications/initialized') this.initializedNotification = line;
    if (this.active.state !== 'active') {
      this.queued.push(line);
      return;
    }
    this.send(this.routeClientMessage(msg, line), line);
  }

  private routeClientMessage(msg: JsonRpcMessage | undefined, line: string): Worker {
    if (!msg) return this.active;
    if (msg.method === 'notifications/cancelled' && isRequestId(msg.params?.requestId)) {
      return this.ownerOf(keyOf(msg.params.requestId), 'clientRequests') ?? this.active;
    }
    if (!isRequestId(msg.id)) return this.active;
    if (msg.method) {
      this.active.clientRequests.set(keyOf(msg.id), { line, method: msg.method });
      return this.active;
    }
    const owner = this.ownerOf(keyOf(msg.id), 'serverRequests') ?? this.active;
    owner.serverRequests.delete(keyOf(msg.id));
    queueMicrotask(() => this.retireIfIdle(owner));
    return owner;
  }

  private ownerOf(key: string, kind: 'clientRequests' | 'serverRequests'): Worker | undefined {
    return [this.active, ...this.draining].find((worker) => worker[kind].has(key));
  }

  private fromWorker(worker: Worker, line: string) {
    const msg = parse(line);
    if (worker.state === 'warming') {
      if (msg?.id === LAUNCHER_INIT_ID) worker.onInitialized?.(!('error' in msg));
      return;
    }
    if (worker.state === 'gone') return;
    if (msg && isRequestId(msg.id)) {
      if (msg.method) worker.serverRequests.add(keyOf(msg.id));
      else worker.clientRequests.delete(keyOf(msg.id));
    }
    this.toClient(line);
    this.retireIfIdle(worker);
  }

  private workerExited(worker: Worker, code: number | null) {
    const state = worker.state;
    worker.state = 'gone';
    this.draining.delete(worker);
    if (state === 'warming') {
      worker.onInitialized?.(false);
      return;
    }
    if (worker !== this.active) {
      this.failOutstanding(worker, UPDATED_MESSAGE);
      return;
    }
    if (this.closing) {
      this.finish(0);
      return;
    }
    this.log(`agent-browser-bridge-mcp ${worker.version} exited with code ${code}; restarting it`);
    this.requeueOutstanding(worker);
    if (!this.updating) void this.restart(worker);
  }

  private requeueOutstanding(worker: Worker) {
    const replay: string[] = [];
    for (const [key, request] of worker.clientRequests) {
      if (request.method === 'tools/call') this.answerWithError(key, RESTARTED_DURING_TOOL_MESSAGE);
      else replay.push(request.line);
    }
    worker.clientRequests.clear();
    this.queued.unshift(...replay);
  }

  private failOutstanding(worker: Worker, message: string) {
    for (const key of worker.clientRequests.keys()) this.answerWithError(key, message);
    worker.clientRequests.clear();
  }

  private answerWithError(key: string, message: string) {
    const raw = key.slice(key.indexOf(':') + 1);
    const id = key.startsWith('number:') ? Number(raw) : raw;
    this.toClient(JSON.stringify({ jsonrpc: '2.0', id, error: { code: INTERNAL_ERROR, message } }));
  }

  shutdown() {
    if (this.closing) return;
    this.closing = true;
    for (const timer of this.timers) clearTimeout(timer);
    if (this.active.state === 'gone') {
      this.finish(0);
      return;
    }
    for (const worker of [this.active, ...this.draining]) this.stopWorker(worker);
  }

  private finish(code: number) {
    for (const timer of this.timers) clearTimeout(timer);
    for (const worker of this.draining) worker.process.kill();
    this.opts.exit(this.closing ? 0 : code);
  }

  private send(worker: Worker, line: string) {
    if (worker.state !== 'gone') worker.process.stdin.write(`${line}\n`);
  }

  private toClient(line: string) {
    try {
      this.opts.output.write(`${line}\n`);
    } catch {
      this.shutdown();
    }
  }
}
