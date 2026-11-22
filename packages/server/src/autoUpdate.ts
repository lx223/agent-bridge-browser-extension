import { spawn } from 'node:child_process';
import { SERVER_PACKAGE } from '@agent-browser-bridge/protocol';
import { Launcher, type WorkerProcess } from './launcher.ts';
import { latestPublishedVersion } from './registry.ts';
import { newSessionEnv } from './session.ts';
import pkg from '../package.json' with { type: 'json' };

const log = (msg: string) => process.stderr.write(`[agent-browser-bridge] ${msg}\n`);
const describe = (reason: unknown) => (reason instanceof Error ? (reason.stack ?? reason.message) : String(reason));
const sessionEnv = newSessionEnv();

const workerCommand = (version: string | null): [string, string[]] =>
  version === null ? [process.execPath, [process.argv[1]!]] : ['npx', ['-y', `${SERVER_PACKAGE}@${version}`]];

function spawnWorker(version: string | null): WorkerProcess {
  const [command, args] = workerCommand(version);
  const child = spawn(command, args, {
    stdio: ['pipe', 'pipe', 'inherit'],
    env: { ...process.env, ...sessionEnv, AGENT_BROWSER_BRIDGE_WORKER: '1' },
    shell: version !== null && process.platform === 'win32',
  });
  const exited = new Promise<number | null>((resolve) => {
    child.once('exit', (code) => resolve(code));
    child.once('error', (err) => {
      log(`Could not start ${command}: ${err.message}`);
      resolve(1);
    });
  });
  return { stdin: child.stdin, stdout: child.stdout, exited, kill: () => child.kill() };
}

export function runLauncher() {
  const launcher = new Launcher({
    input: process.stdin,
    output: process.stdout,
    version: pkg.version,
    spawnWorker,
    latestVersion: () => latestPublishedVersion(),
    exit: (code) => process.exit(code),
    log,
  });
  launcher.scheduleUpdateChecks();
  process.on('SIGINT', () => launcher.shutdown());
  process.on('SIGTERM', () => launcher.shutdown());
  process.stdout.on('error', () => launcher.shutdown());
  process.on('uncaughtException', (err) => log(`Unexpected error in the launcher: ${err.stack ?? err.message}`));
  process.on('unhandledRejection', (reason) => log(`Unhandled rejection in the launcher: ${describe(reason)}`));
}
