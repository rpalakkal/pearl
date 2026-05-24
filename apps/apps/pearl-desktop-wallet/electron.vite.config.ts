import {resolve} from 'path';
import {defineConfig, externalizeDepsPlugin} from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/main/index.ts'),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/preload/index.ts'),
      },
    },
  },
  renderer: {
    define: {
      process: 'globalThis.process',
      global: 'globalThis',
    },
    resolve: {
      alias: {
        '@renderer': resolve(__dirname, 'src/renderer/src'),
        '@': resolve(__dirname, 'src/renderer/src'),
        crypto: resolve(__dirname, '../../packages/wallet-core/src/nodeCryptoShim.ts'),
        events: resolve(__dirname, 'node_modules/events'),
        stream: resolve(__dirname, 'node_modules/stream-browserify'),
        util: resolve(__dirname, 'node_modules/util'),
      },
    },
    plugins: [react()],
    css: {
      postcss: './postcss.config.mjs',
    },
  },
});
