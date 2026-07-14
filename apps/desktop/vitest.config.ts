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
        environment: 'node',
        testTimeout: 30_000,
        include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    },
});
