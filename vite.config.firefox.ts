import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { resolve } from 'path'

// Firefox-specific config - bundles everything inline to avoid module issues
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
        // Use ES modules but inline everything for background/content
        format: 'es',
        // Inline all dynamic imports for background and content scripts
        inlineDynamicImports: false,
        manualChunks: (id) => {
          // Keep background script dependencies bundled together
          if (id.includes('src/background/') || 
              (id.includes('src/services/') && !id.includes('node_modules')) ||
              (id.includes('src/shared/') && !id.includes('node_modules'))) {
            return undefined; // Bundle with entry point
          }
          return undefined;
        },
      },
    },
    outDir: 'dist-firefox',
    emptyOutDir: true,
    target: 'esnext',
    minify: false,
  },
  publicDir: 'public',
})
