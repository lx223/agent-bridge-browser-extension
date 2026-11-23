import { argv, env, exit, stderr, stdout } from 'node:process';
import pkg from '../package.json' with { type: 'json' };

const [command, ...args] = argv.slice(2);

if (env.AGENT_BROWSER_BRIDGE_WORKER === '1') {
  const { runWorker } = await import('./worker.ts');
  await runWorker();
} else if (command === 'http') {
  const { runRemoteServer } = await import('./remote.ts');
  try {
    await runRemoteServer(args, pkg.version);
  } catch (err) {
    stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    exit(2);
  }
} else if (command === '--help' || command === '-h') {
  const { cliUsage } = await import('./remote.ts');
  stdout.write(`${cliUsage}\n`);
} else if (command === undefined || command === 'stdio') {
  const { runLauncher } = await import('./autoUpdate.ts');
  runLauncher();
} else {
  const { cliUsage } = await import('./remote.ts');
  stderr.write(`Unknown command ${command}\n\n${cliUsage}\n`);
  exit(2);
}
