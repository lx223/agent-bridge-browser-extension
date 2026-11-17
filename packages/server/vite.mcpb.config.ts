import { defineConfig } from 'vite';

export default defineConfig({
  define: {
    'process.env.WS_NO_BUFFER_UTIL': JSON.stringify('1'),
    'process.env.WS_NO_UTF_8_VALIDATE': JSON.stringify('1'),
  },
  build: {
    ssr: 'src/index.ts',
    target: 'node20',
    outDir: 'mcpb-dist/server',
    emptyOutDir: true,
    rollupOptions: {
      output: { entryFileNames: 'index.js' },
    },
  },
  ssr: { noExternal: true },
});
