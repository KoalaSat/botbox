import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { resolve } from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [svelte()],
  base: './', // Use relative paths for browser extension
  build: {
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'popup.html'),
        contacts: resolve(__dirname, 'contacts.html'),
        relays: resolve(__dirname, 'relays.html'),
        background: resolve(__dirname, 'src/background/background.ts'),
        content: resolve(__dirname, 'src/content/content.ts'),
      },
      output: {
        entryFileNames: (chunkInfo) => {
          // Keep background and content scripts at root level with .js extension
          if (chunkInfo.name === 'background' || chunkInfo.name === 'content') {
            return '[name].js';
          }
          return 'assets/[name]-[hash].js';
        },
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
        format: 'es', // Use ES modules format
        // Prevent code splitting for background and content scripts
        manualChunks: undefined,
      },
    },
    outDir: 'dist',
    emptyOutDir: true,
    target: 'esnext',
    minify: false,
  },
  publicDir: 'public',
})
