import { env } from 'node:process';

const runsWorkerDirectly = env.AGENT_BROWSER_BRIDGE_WORKER === '1' || env.AGENT_BROWSER_BRIDGE_AUTO_UPDATE === '0';

if (runsWorkerDirectly) {
  const { runWorker } = await import('./worker.ts');
  await runWorker();
} else {
  const { runLauncher } = await import('./autoUpdate.ts');
  runLauncher();
}
