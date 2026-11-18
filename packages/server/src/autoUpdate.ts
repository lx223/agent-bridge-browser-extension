import { spawn } from 'node:child_process';
import { SERVER_PACKAGE } from '@agent-browser-bridge/protocol';
import { Launcher, type WorkerProcess } from './launcher.ts';
import { latestPublishedVersion } from './registry.ts';
import pkg from '../package.json' with { type: 'json' };

const log = (msg: string) => process.stderr.write(`[agent-browser-bridge] ${msg}\n`);

const workerCommand = (version: string | null): [string, string[]] =>
  version === null ? [process.execPath, [process.argv[1]!]] : ['npx', ['-y', `${SERVER_PACKAGE}@${version}`]];

function spawnWorker(version: string | null): WorkerProcess {
  const [command, args] = workerCommand(version);
  const child = spawn(command, args, {
    stdio: ['pipe', 'pipe', 'inherit'],
    env: { ...process.env, AGENT_BROWSER_BRIDGE_WORKER: '1' },
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

const minutes = (name: string, fallback: number) => {
  const value = Number(process.env[name]);
  return (Number.isFinite(value) && value > 0 ? value : fallback) * 60_000;
};

export function runLauncher() {
  const launcher = new Launcher({
    input: process.stdin,
    output: process.stdout,
    version: pkg.version,
    spawnWorker,
    latestVersion: () => latestPublishedVersion(),
    exit: (code) => process.exit(code),
    log,
    checkIntervalMs: minutes('AGENT_BROWSER_BRIDGE_UPDATE_CHECK_MINUTES', 60),
  });
  launcher.scheduleUpdateChecks();
  process.on('SIGINT', () => launcher.shutdown());
  process.on('SIGTERM', () => launcher.shutdown());
}
