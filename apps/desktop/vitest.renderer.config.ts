import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    resolve: {
        alias: {
            '@renderer': fileURLToPath(new URL('./src/renderer', import.meta.url)),
            '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
        },
    },
    test: {
        name: 'renderer',
        environment: 'jsdom',
        setupFiles: ['./tests/renderer/setup.ts'],
        testTimeout: 30_000,
        include: ['tests/renderer/**/*.test.ts', 'tests/renderer/**/*.test.tsx'],
        clearMocks: true,
        restoreMocks: true,
    },
});
