import { createTestBridge, removeTestBridge, shareTestBridge } from './harness.ts';

export default async function setup() {
  const bridge = await createTestBridge();
  shareTestBridge(bridge);
  return () => removeTestBridge(bridge);
}
