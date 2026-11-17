import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';

function injectManifestVersion() {
  return {
    name: 'inject-manifest-version',
    closeBundle() {
      const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8'));
      const manifestPath = resolve(__dirname, 'dist/manifest.json');
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
      manifest.version = pkg.version;
      writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    },
  };
}

export default defineConfig(({ mode }) => ({
  publicDir: false,
  plugins: [injectManifestVersion()],
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    copyPublicDir: false,
    lib: {
      entry: resolve(__dirname, 'src/background/index.ts'),
      name: 'agentBrowserBridgeBackground',
      formats: ['iife'],
      fileName: () => 'background.js',
    },
    sourcemap: mode === 'development',
  },
}));
