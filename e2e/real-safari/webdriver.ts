import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

const DRIVER_START_TIMEOUT_MS = 20_000;

export interface SafariSession {
  sessionId: string;
  capabilities: Record<string, unknown>;
  command<T = unknown>(method: string, path: string, body?: unknown): Promise<T>;
  loadExtension(directory: string): Promise<unknown>;
  pages(): Promise<SafariPage[]>;
  runInPage<T = unknown>(handle: string, script: string): Promise<T>;
  driverOutput(): string;
  close(): Promise<void>;
}

export interface SafariPage {
  handle: string;
  url: string;
  title: string;
}

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const server = createServer();
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      server.close(() => done(port));
    });
  });
}

export async function startSafariSession(): Promise<SafariSession> {
  const port = await freePort();
  const output: string[] = [];
  const driver = spawn('safaridriver', ['--port', String(port)], { stdio: ['ignore', 'pipe', 'pipe'] });
  driver.stdout.on('data', (chunk: Buffer) => output.push(chunk.toString()));
  driver.stderr.on('data', (chunk: Buffer) => output.push(chunk.toString()));
  const driverOutput = () => output.join('');

  const request = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      ...(body !== undefined && { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${method} ${path} failed with ${response.status}: ${text}`);
    return (JSON.parse(text) as { value: T }).value;
  };

  try {
    const deadline = Date.now() + DRIVER_START_TIMEOUT_MS;
    for (;;) {
      const ready = await request('GET', '/status').then(
        () => true,
        () => false,
      );
      if (ready) break;
      if (Date.now() > deadline) throw new Error(`safaridriver did not start: ${driverOutput()}`);
      await sleep(200);
    }

    const created = await request<{ sessionId: string; capabilities: Record<string, unknown> }>('POST', '/session', {
      capabilities: { alwaysMatch: { browserName: 'safari' } },
    });
    const command = <T>(method: string, path: string, body?: unknown) => request<T>(method, `/session/${created.sessionId}${path}`, body);

    return {
      sessionId: created.sessionId,
      capabilities: created.capabilities,
      command,
      loadExtension: (directory) => command('POST', '/webextension', { type: 'path', path: directory }),
      async pages() {
        const listed: SafariPage[] = [];
        for (const handle of await command<string[]>('GET', '/window/handles')) {
          await command('POST', '/window', { handle });
          listed.push({ handle, url: await command<string>('GET', '/url'), title: await command<string>('GET', '/title') });
        }
        return listed;
      },
      async runInPage<T>(handle: string, script: string) {
        await command('POST', '/window', { handle });
        await command('POST', '/timeouts', { script: 30_000 });
        return command<T>('POST', '/execute/async', { script, args: [] });
      },
      driverOutput,
      async close() {
        await command('DELETE', '').catch(() => {});
        driver.kill();
      },
    };
  } catch (error) {
    driver.kill();
    throw error;
  }
}
