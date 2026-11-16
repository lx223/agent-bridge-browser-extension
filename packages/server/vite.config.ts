import { defineConfig } from 'vite';

// Bundles the server (and the source-only protocol package) into one ESM file.
// npm dependencies stay external and are installed by `npx`.
export default defineConfig({
  build: {
    ssr: 'src/index.ts',
    target: 'node20',
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: { entryFileNames: 'index.js', banner: '#!/usr/bin/env node' },
    },
  },
  ssr: { noExternal: ['@agent-browser-bridge/protocol'] },
});
