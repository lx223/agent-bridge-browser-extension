import { defineConfig, type ResolvedConfig } from 'vite';
import { resolve } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';

function injectManifestVersion() {
  let outDir = resolve(__dirname, 'dist');
  return {
    name: 'inject-manifest-version',
    configResolved(config: ResolvedConfig) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8'));
      const manifestPath = resolve(outDir, 'manifest.json');
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
