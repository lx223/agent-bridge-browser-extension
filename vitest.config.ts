import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'protocol', root: 'packages/protocol', environment: 'node' } },
      { test: { name: 'server', root: 'packages/server', environment: 'node' } },
      { test: { name: 'extension', root: 'packages/extension', environment: 'node', css: true, setupFiles: ['src/test/englishI18n.ts'] } },
      { test: { name: 'store', root: 'store', environment: 'node' } },
      { test: { name: 'plugins', root: 'plugins', environment: 'node' } },
      { test: { name: 'site', root: 'site', environment: 'node' } },
    ],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts'],
      exclude: [
        '**/*.test.ts',
        '**/*.d.ts',
        'packages/extension/src/test/**',
        'packages/extension/src/background/index.ts',
        'packages/extension/src/background/handlers.ts',
        'packages/extension/src/background/navigation.ts',
        'packages/extension/src/background/popover.ts',
        'packages/extension/src/background/serialize.ts',
        'packages/extension/src/settings/**',
        'packages/extension/src/welcome/main.ts',
        'packages/extension/src/sidepanel/main.ts',
        'packages/server/src/index.ts',
        'packages/server/src/worker.ts',
        'packages/server/src/standalone.ts',
        'packages/server/src/autoUpdate.ts',
      ],
      reporter: ['text', 'html'],
      thresholds: { statements: 85, branches: 70, functions: 88, lines: 88 },
    },
  },
});
