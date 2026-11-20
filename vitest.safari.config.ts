import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'real-safari',
    include: ['e2e/real-safari/**/*.safari.ts'],
    environment: 'node',
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 240_000,
  },
});
