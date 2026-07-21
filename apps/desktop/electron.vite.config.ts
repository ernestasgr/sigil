import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
    main: {
        build: {
            externalizeDeps: true,
            lib: {
                entry: {
                    index: resolve(__dirname, 'src/main/index.ts'),
                    worker: resolve(__dirname, 'src/engine/core/worker.ts'),
                    'plugin-worker': resolve(__dirname, 'src/engine/plugins/plugin-node-worker.ts'),
                },
                formats: ['es'],
            },
            rollupOptions: {
                external: ['better-sqlite3', '@sigil/schema'],
            },
        },
        resolve: {
            alias: {
                '@shared': resolve(__dirname, 'src/shared'),
            },
        },
    },
    preload: {
        build: {
            externalizeDeps: false,
            lib: {
                entry: resolve(__dirname, 'src/preload/index.ts'),
                fileName: 'index',
                formats: ['cjs'],
            },
            rollupOptions: {
                external: ['electron'],
            },
        },
        resolve: {
            alias: {
                '@shared': resolve(__dirname, 'src/shared'),
            },
        },
    },
    renderer: {
        root: 'src/renderer',
        resolve: {
            alias: {
                '@renderer': resolve(__dirname, 'src/renderer'),
                '@shared': resolve(__dirname, 'src/shared'),
            },
        },
        build: {
            rollupOptions: {
                input: resolve(__dirname, 'src/renderer/index.html'),
            },
        },
        plugins: [react(), tailwindcss()],
    },
});
