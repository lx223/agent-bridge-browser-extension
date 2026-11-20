import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import { isNewerVersion } from './version.ts';

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
  spawnWorker: (version: string | null) => WorkerProcess;
  latestVersion: () => Promise<string | undefined>;
  exit: (code: number) => void;
  log?: (msg: string) => void;
  firstCheckMs?: number;
  checkIntervalMs?: number;
  initTimeoutMs?: number;
  drainTimeoutMs?: number;
  stopTimeoutMs?: number;
}

type JsonRpcId = string | number;

interface JsonRpcMessage {
  id?: JsonRpcId | null;
  method?: string;
  params?: { requestId?: JsonRpcId } & Record<string, unknown>;
}

interface Worker {
  process: WorkerProcess;
  version: string;
  state: 'warming' | 'active' | 'draining' | 'gone';
  clientRequests: Set<string>;
  serverRequests: Set<string>;
  onInitialized?: (ok: boolean) => void;
}

export const LAUNCHER_INIT_ID = 'agent-browser-bridge-launcher-initialize';
const RESTARTED_DURING_UPDATE = -32603;

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
  private closing = false;
  private readonly timers: NodeJS.Timeout[] = [];
  private readonly log: (msg: string) => void;

  constructor(private readonly opts: LauncherOptions) {
    this.log = opts.log ?? (() => {});
    this.active = this.startWorker(null, opts.version, 'active');
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
    if (this.updating || this.closing || !this.initializeRequest) return false;
    const latest = await this.opts.latestVersion().catch(() => undefined);
    if (!latest || !isNewerVersion(latest, this.active.version)) return false;
    return this.upgradeTo(latest);
  }

  async upgradeTo(version: string): Promise<boolean> {
    if (this.updating || this.closing || !this.initializeRequest) return false;
    this.updating = true;
    try {
      this.log(`Starting agent-browser-bridge-mcp ${version} alongside ${this.active.version}`);
      const next = this.startWorker(version, version, 'warming');
      if (!(await this.warmUp(next))) {
        this.log(`agent-browser-bridge-mcp ${version} did not start; staying on ${this.active.version}`);
        next.state = 'gone';
        next.process.kill();
        return false;
      }
      const previous = this.active;
      next.state = 'active';
      this.active = next;
      this.drain(previous);
      this.toClient(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' }));
      this.log(`Switched to agent-browser-bridge-mcp ${version}`);
      return true;
    } finally {
      this.updating = false;
    }
  }

  private startWorker(spawnVersion: string | null, version: string, state: Worker['state']): Worker {
    const child = this.opts.spawnWorker(spawnVersion);
    const worker: Worker = { process: child, version, state, clientRequests: new Set(), serverRequests: new Set() };
    child.stdin.on('error', () => {});
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
    this.send(this.routeClientMessage(msg), line);
  }

  private routeClientMessage(msg: JsonRpcMessage | undefined): Worker {
    if (!msg) return this.active;
    if (msg.method === 'notifications/cancelled' && isRequestId(msg.params?.requestId)) {
      return this.ownerOf(keyOf(msg.params.requestId), 'clientRequests') ?? this.active;
    }
    if (!isRequestId(msg.id)) return this.active;
    if (msg.method) {
      this.active.clientRequests.add(keyOf(msg.id));
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
      this.failOutstanding(worker);
      return;
    }
    if (!this.closing) this.log(`agent-browser-bridge-mcp ${worker.version} exited with code ${code}`);
    this.finish(code ?? 1);
  }

  private failOutstanding(worker: Worker) {
    for (const key of worker.clientRequests) {
      const raw = key.slice(key.indexOf(':') + 1);
      const id = key.startsWith('number:') ? Number(raw) : raw;
      const error = { code: RESTARTED_DURING_UPDATE, message: 'The browser bridge server was updated while handling this request; please retry.' };
      this.toClient(JSON.stringify({ jsonrpc: '2.0', id, error }));
    }
    worker.clientRequests.clear();
  }

  shutdown() {
    if (this.closing) return;
    this.closing = true;
    for (const timer of this.timers) clearTimeout(timer);
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
    this.opts.output.write(`${line}\n`);
  }
}
