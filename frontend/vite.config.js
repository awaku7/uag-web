import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import path from 'path';

export default defineConfig(({ command }) => ({
  plugins: [svelte()],
  root: '.',
  base: command === 'serve' ? '/' : '/static/',
  build: {
    outDir: path.resolve(__dirname, '..', 'src', 'uag_web', 'static'),
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(__dirname, 'index.html'),
      output: {
        entryFileNames: 'assets/index.js',
        chunkFileNames: 'assets/index.js',
        assetFileNames: 'assets/index.[ext]',
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/auth': 'http://localhost:8000',
      '/static': 'http://localhost:8000',
      '/api': 'http://localhost:8000',
      '/ws': {
        target: 'ws://localhost:8000',
        ws: true,
      },
      '/upload': 'http://localhost:8000',
      '/local-file': 'http://localhost:8000',
    },
  },
}));
