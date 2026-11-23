import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'protocol', root: 'packages/protocol', environment: 'node' } },
      { test: { name: 'server', root: 'packages/server', environment: 'node' } },
      { test: { name: 'extension', root: 'extensions/browser', environment: 'node', css: true, setupFiles: ['src/test/englishI18n.ts'] } },
      { test: { name: 'store', root: 'store', environment: 'node' } },
      { test: { name: 'plugins', root: 'plugins', environment: 'node' } },
      { test: { name: 'site', root: 'site', environment: 'node' } },
    ],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts', 'extensions/*/src/**/*.ts'],
      exclude: [
        '**/*.test.ts',
        '**/*.d.ts',
        'extensions/browser/src/test/**',
        'extensions/browser/src/background/index.ts',
        'extensions/browser/src/background/handlers.ts',
        'extensions/browser/src/background/navigation.ts',
        'extensions/browser/src/background/popover.ts',
        'extensions/browser/src/background/serialize.ts',
        'extensions/browser/src/settings/**',
        'extensions/browser/src/welcome/main.ts',
        'extensions/browser/src/sidepanel/main.ts',
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
