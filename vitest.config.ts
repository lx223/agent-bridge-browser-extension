import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'protocol', root: 'packages/protocol', environment: 'node' } },
      { test: { name: 'server', root: 'packages/server', environment: 'node' } },
      { test: { name: 'extension', root: 'packages/extension', environment: 'node' } },
    ],
  },
});
