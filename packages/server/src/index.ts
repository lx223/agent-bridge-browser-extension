import { env } from 'node:process';

if (env.AGENT_BROWSER_BRIDGE_WORKER === '1') {
  const { runWorker } = await import('./worker.ts');
  await runWorker();
} else {
  const { runLauncher } = await import('./autoUpdate.ts');
  runLauncher();
}
